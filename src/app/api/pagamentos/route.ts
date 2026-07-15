import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const METODOS = ['pix', 'debito', 'credito', 'dinheiro', 'boleto', 'transferencia', 'outro'];
const ORIGENS = ['manual', 'stone', 'pagarme', 'legado'];

// Tolerancia de 1 centavo — numeric de parcela raramente fecha exato.
const CENTAVO = 0.01;

// GET /api/pagamentos?orcamento_id=uuid — pagamentos de um pedido.
export async function GET(request: NextRequest) {
  try {
    const orcamentoId = request.nextUrl.searchParams.get('orcamento_id');
    if (!orcamentoId) {
      return NextResponse.json({ error: 'orcamento_id e obrigatorio' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('pagamentos')
      .select('id, valor, metodo, parcelas, data_pagamento, origem, gateway_id, observacoes, criado_em')
      .eq('orcamento_id', orcamentoId)
      .order('data_pagamento', { ascending: true });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('Erro ao listar pagamentos:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST /api/pagamentos — registra dinheiro recebido.
// O trigger no Postgres recalcula orcamentos.valor_pago e status_pagamento.
//
// Este endpoint tambem e o destino dos webhooks da Stone/Pagar.me: basta
// mandar origem='stone' e gateway_id=<id da transacao>. O UNIQUE em
// gateway_id faz o reenvio do webhook virar no-op em vez de pagamento dobrado.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orcamento_id,
      valor,
      metodo,
      parcelas,
      data_pagamento,
      origem,
      gateway_id,
      observacoes,
      permitir_excedente,
    } = body;

    if (!orcamento_id) {
      return NextResponse.json({ error: 'orcamento_id e obrigatorio' }, { status: 400 });
    }

    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum === 0) {
      return NextResponse.json(
        { error: 'valor deve ser um numero diferente de zero (negativo = estorno)' },
        { status: 400 },
      );
    }

    if (!METODOS.includes(metodo)) {
      return NextResponse.json(
        { error: `metodo invalido. Use: ${METODOS.join(', ')}` },
        { status: 400 },
      );
    }

    const origemFinal = origem ?? 'manual';
    if (!ORIGENS.includes(origemFinal)) {
      return NextResponse.json(
        { error: `origem invalida. Use: ${ORIGENS.join(', ')}` },
        { status: 400 },
      );
    }

    // Webhook reenviado: pagamento ja existe, devolve o estado atual sem duplicar.
    if (gateway_id) {
      const { data: existente } = await supabaseAdmin
        .from('pagamentos')
        .select('id, orcamento_id')
        .eq('gateway_id', gateway_id)
        .maybeSingle();

      if (existente) {
        const { data: orc } = await supabaseAdmin
          .from('orcamentos')
          .select('id, codigo, total, valor_pago, status_pagamento')
          .eq('id', existente.orcamento_id)
          .single();

        return NextResponse.json({
          duplicado: true,
          pagamento_id: existente.id,
          orcamento: orc,
        });
      }
    }

    const { data: orcamento, error: orcError } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, valor_pago')
      .eq('id', orcamento_id)
      .single();

    if (orcError || !orcamento) {
      return NextResponse.json({ error: 'Orcamento nao encontrado' }, { status: 404 });
    }

    // Trava anti-dedo-gordo: bloqueia registrar duas vezes o mesmo pagamento.
    // Sinal + acerto acima do total (raro) passa com permitir_excedente.
    const saldoResultante = Number(orcamento.total) - (Number(orcamento.valor_pago) + valorNum);
    if (valorNum > 0 && saldoResultante < -CENTAVO && !permitir_excedente) {
      return NextResponse.json(
        {
          error: 'Pagamento excede o saldo em aberto',
          total: Number(orcamento.total),
          ja_pago: Number(orcamento.valor_pago),
          saldo_atual: Number(orcamento.total) - Number(orcamento.valor_pago),
          dica: 'Envie permitir_excedente: true se o excedente for intencional.',
        },
        { status: 409 },
      );
    }

    const { data: pagamento, error } = await supabaseAdmin
      .from('pagamentos')
      .insert({
        orcamento_id,
        valor: valorNum,
        metodo,
        parcelas: Number(parcelas) || 1,
        data_pagamento: data_pagamento || new Date().toISOString(),
        origem: origemFinal,
        gateway_id: gateway_id || null,
        observacoes: observacoes || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Releitura pos-trigger: valor_pago e status_pagamento ja recalculados.
    const { data: atualizado } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, valor_pago, status_pagamento, entregue_sem_pagamento')
      .eq('id', orcamento_id)
      .single();

    // Quitou um pedido que fora entregue sem pagamento? O flag deixa de valer
    // — passa a significar "entregue e ainda em aberto", nao um historico.
    if (
      atualizado?.entregue_sem_pagamento &&
      Number(atualizado.valor_pago) >= Number(atualizado.total) - CENTAVO
    ) {
      await supabaseAdmin
        .from('orcamentos')
        .update({ entregue_sem_pagamento: false, entregue_sem_pagamento_em: null })
        .eq('id', orcamento_id);
    }

    return NextResponse.json({
      pagamento,
      orcamento: atualizado,
      saldo: Number(atualizado?.total ?? 0) - Number(atualizado?.valor_pago ?? 0),
    });
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE /api/pagamentos?id=uuid — apaga pagamento lancado errado.
// O trigger recalcula o saldo do pedido.
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id e obrigatorio' }, { status: 400 });
    }

    const { data: pagamento } = await supabaseAdmin
      .from('pagamentos')
      .select('orcamento_id')
      .eq('id', id)
      .maybeSingle();

    if (!pagamento) {
      return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 });
    }

    const { error } = await supabaseAdmin.from('pagamentos').delete().eq('id', id);
    if (error) throw error;

    const { data: atualizado } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, valor_pago, status_pagamento')
      .eq('id', pagamento.orcamento_id)
      .single();

    return NextResponse.json({ ok: true, orcamento: atualizado });
  } catch (error) {
    console.error('Erro ao remover pagamento:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
