import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface ItemEntrega {
  orcamento_item_id: string;
  quantidade: number;
}

// POST /api/entregas-parciais
// Body: { orcamento_id, itens: [{ orcamento_item_id, quantidade }], observacoes?, data_entrega? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orcamento_id, itens, observacoes, data_entrega } = body as {
      orcamento_id: string;
      itens: ItemEntrega[];
      observacoes?: string;
      data_entrega?: string;
    };

    if (!orcamento_id || !Array.isArray(itens) || itens.length === 0) {
      return NextResponse.json({ error: 'orcamento_id e itens sao obrigatorios' }, { status: 400 });
    }

    // 1) Carrega itens atuais do orcamento (para validar e atualizar quantidade_entregue)
    const { data: orcItens, error: itensErr } = await supabaseAdmin
      .from('orcamento_itens')
      .select('id, quantidade, quantidade_entregue, produto_nome')
      .eq('orcamento_id', orcamento_id);

    if (itensErr || !orcItens) {
      return NextResponse.json({ error: 'Erro ao carregar itens do orcamento' }, { status: 500 });
    }

    const itensMap = new Map<string, { id: string; quantidade: number; quantidade_entregue: number; produto_nome: string }>();
    for (const it of orcItens) {
      itensMap.set(it.id, {
        id: it.id,
        quantidade: Number(it.quantidade) || 0,
        quantidade_entregue: Number(it.quantidade_entregue) || 0,
        produto_nome: it.produto_nome,
      });
    }

    // Valida quantidades
    for (const linha of itens) {
      const ref = itensMap.get(linha.orcamento_item_id);
      if (!ref) {
        return NextResponse.json({ error: `Item ${linha.orcamento_item_id} nao pertence ao orcamento` }, { status: 400 });
      }
      const q = Number(linha.quantidade);
      if (!Number.isFinite(q) || q <= 0) {
        return NextResponse.json({ error: `Quantidade invalida para ${ref.produto_nome}` }, { status: 400 });
      }
      const restante = ref.quantidade - ref.quantidade_entregue;
      if (q > restante + 1e-9) {
        return NextResponse.json({
          error: `Quantidade excede o restante de ${ref.produto_nome} (restante: ${restante})`,
        }, { status: 400 });
      }
    }

    // 2) Determina numero_entrega (auto-incremento por orcamento)
    const { data: ultimas } = await supabaseAdmin
      .from('entregas_parciais')
      .select('numero_entrega')
      .eq('orcamento_id', orcamento_id)
      .order('numero_entrega', { ascending: false })
      .limit(1);
    const numeroEntrega = ultimas && ultimas.length > 0 ? Number(ultimas[0].numero_entrega) + 1 : 1;

    // 3) Cria registro entregas_parciais
    const insertEntrega: Record<string, unknown> = {
      orcamento_id,
      numero_entrega: numeroEntrega,
      observacoes: observacoes || null,
    };
    if (data_entrega) insertEntrega.data_entrega = data_entrega;

    const { data: entrega, error: entregaErr } = await supabaseAdmin
      .from('entregas_parciais')
      .insert(insertEntrega)
      .select('id, numero_entrega, data_entrega, observacoes, criado_em')
      .single();

    if (entregaErr || !entrega) {
      return NextResponse.json({ error: 'Erro ao criar entrega parcial' }, { status: 500 });
    }

    // 4) Cria registros entregas_parciais_itens
    const itensInsert = itens.map(linha => ({
      entrega_parcial_id: entrega.id,
      orcamento_item_id: linha.orcamento_item_id,
      quantidade: Number(linha.quantidade),
    }));
    const { error: itensInsertErr } = await supabaseAdmin
      .from('entregas_parciais_itens')
      .insert(itensInsert);
    if (itensInsertErr) {
      // Rollback parcial: remove a entrega criada para nao deixar orfao
      await supabaseAdmin.from('entregas_parciais').delete().eq('id', entrega.id);
      return NextResponse.json({ error: 'Erro ao salvar itens da entrega' }, { status: 500 });
    }

    // 5) Atualiza quantidade_entregue em orcamento_itens (acumula)
    for (const linha of itens) {
      const ref = itensMap.get(linha.orcamento_item_id)!;
      const novaQtd = ref.quantidade_entregue + Number(linha.quantidade);
      await supabaseAdmin
        .from('orcamento_itens')
        .update({ quantidade_entregue: novaQtd })
        .eq('id', linha.orcamento_item_id);
      ref.quantidade_entregue = novaQtd;
    }

    // 6) Verifica se todos os itens foram totalmente entregues e ajusta status do orcamento
    let tudoEntregue = true;
    for (const ref of Array.from(itensMap.values())) {
      if (ref.quantidade_entregue + 1e-9 < ref.quantidade) {
        tudoEntregue = false;
        break;
      }
    }
    const novoStatus = tudoEntregue ? 'completo' : 'entrega_parcial';
    await supabaseAdmin
      .from('orcamentos')
      .update({ status: novoStatus, atualizado_em: new Date().toISOString() })
      .eq('id', orcamento_id);

    return NextResponse.json({
      success: true,
      entrega_parcial: entrega,
      novo_status: novoStatus,
      tudo_entregue: tudoEntregue,
    });
  } catch (e) {
    console.error('Erro POST /api/entregas-parciais', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// GET /api/entregas-parciais?orcamento_id=uuid
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orcamentoId = searchParams.get('orcamento_id');
    if (!orcamentoId) {
      return NextResponse.json({ error: 'orcamento_id obrigatorio' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('entregas_parciais')
      .select(`
        id, numero_entrega, data_entrega, observacoes, criado_em,
        entregas_parciais_itens (
          id, orcamento_item_id, quantidade,
          orcamento_itens:orcamento_item_id ( produto_nome, unidade )
        )
      `)
      .eq('orcamento_id', orcamentoId)
      .order('numero_entrega', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Erro ao listar entregas parciais' }, { status: 500 });
    }

    return NextResponse.json({ entregas: data || [] });
  } catch (e) {
    console.error('Erro GET /api/entregas-parciais', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
