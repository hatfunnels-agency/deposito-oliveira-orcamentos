import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Conciliacao bancaria das vendas do dia.
// Fonte: tabela `pagamentos` (o dinheiro que REALMENTE entrou), filtrada por
// data_pagamento no dia — nao pela data do pedido. Assim um pedido de outro
// dia com "pagamento na entrega", pago hoje, aparece na conciliacao de hoje.
//
// Timezone: data_pagamento e timestamptz (UTC). O "dia" e o dia comercial do
// deposito em America/Sao_Paulo (UTC-3 fixo desde o fim do horario de verao
// em 2019). Entao o dia D vai de D 03:00Z (00:00 BRT) ate D+1 03:00Z.
const OFFSET_BRT_HORAS = 3;

function hojeBRT(): string {
  const nowBrt = new Date(Date.now() - OFFSET_BRT_HORAS * 3600 * 1000);
  return nowBrt.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dataParam = searchParams.get('data');
    const data = /^\d{4}-\d{2}-\d{2}$/.test(dataParam || '') ? (dataParam as string) : hojeBRT();

    // Limites do dia em UTC (00:00 e 24:00 no horario de Sao Paulo).
    const inicio = new Date(`${data}T0${OFFSET_BRT_HORAS}:00:00.000Z`);
    const fim = new Date(inicio.getTime() + 24 * 3600 * 1000);

    const { data: rows, error } = await supabaseAdmin
      .from('pagamentos')
      .select(`
        id, valor, metodo, parcelas, data_pagamento, origem, observacoes, orcamento_id,
        orcamentos:orcamento_id (
          codigo, status, tipo_entrega, forma_pagamento,
          clientes ( nome )
        )
      `)
      .gte('data_pagamento', inicio.toISOString())
      .lt('data_pagamento', fim.toISOString())
      .order('data_pagamento', { ascending: true });

    if (error) {
      console.error('[financeiro/conciliacao] erro ao buscar pagamentos', error);
      return NextResponse.json({ error: 'Erro ao carregar conciliacao' }, { status: 500 });
    }

    type OrcEmbed = {
      codigo?: string;
      status?: string;
      tipo_entrega?: string;
      forma_pagamento?: string | null;
      clientes?: { nome?: string } | null;
    };

    const pagamentos = (rows ?? []).map((p) => {
      const orc = (p.orcamentos as OrcEmbed | null) ?? {};
      return {
        id: p.id as string,
        valor: Number(p.valor),
        metodo: p.metodo as string,
        parcelas: Number(p.parcelas) || 1,
        data_pagamento: p.data_pagamento as string,
        origem: p.origem as string,
        observacoes: (p.observacoes as string | null) ?? null,
        orcamento_id: p.orcamento_id as string,
        codigo: orc.codigo ?? '—',
        status: orc.status ?? null,
        tipo_entrega: orc.tipo_entrega ?? null,
        cliente_nome: orc.clientes?.nome ?? 'Cliente',
      };
    });

    // Totais por metodo (estornos com valor negativo, se houver, ja abatem).
    const porMetodo: Record<string, { total: number; qtd: number }> = {};
    let total = 0;
    for (const p of pagamentos) {
      total += p.valor;
      const m = porMetodo[p.metodo] ?? { total: 0, qtd: 0 };
      m.total += p.valor;
      m.qtd += 1;
      porMetodo[p.metodo] = m;
    }

    // Vendas do dia SEM pagamento coletado: pedido que e' venda (nao orcamento/
    // cancelado), sem dinheiro coletado (valor_pago ~ 0), e que "e' do dia" pela
    // uniao — criado hoje OU entregue/retirado hoje. Categoria separada (nao
    // entra nos totais por metodo, que sao dinheiro que entrou). data_entrega/
    // data_retirada sao colunas date (sem tz); criado_em e' timestamptz (usa o
    // mesmo intervalo UTC do dia BRT dos pagamentos).
    const { data: vendasRows, error: vendasErr } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, total, valor_pago, status, tipo_entrega,
        condicao_pagamento, vencimento, entregue_sem_pagamento,
        criado_em, data_entrega, data_retirada,
        clientes ( nome )
      `)
      .not('status', 'in', '(orcamento,cancelado)')
      .or(
        `data_entrega.eq.${data},data_retirada.eq.${data},` +
          `and(criado_em.gte.${inicio.toISOString()},criado_em.lt.${fim.toISOString()})`,
      );
    if (vendasErr) {
      console.error('[financeiro/conciliacao] erro ao buscar vendas do dia', vendasErr);
    }

    type ClienteEmbed = { nome?: string } | null;
    const semPagamentoVendas = (vendasRows ?? [])
      .filter((o) => (Number(o.valor_pago) || 0) <= 0.009)
      .map((o) => {
        const motivo = o.entregue_sem_pagamento
          ? 'entregue sem pagamento'
          : o.condicao_pagamento === 'prazo'
            ? 'a prazo'
            : 'sem pagamento';
        return {
          orcamento_id: o.id as string,
          codigo: (o.codigo as string) ?? '—',
          cliente_nome: ((o.clientes as ClienteEmbed)?.nome) ?? 'Cliente',
          valor: Number(o.total) || 0,
          status: (o.status as string) ?? null,
          tipo_entrega: (o.tipo_entrega as string) ?? null,
          condicao_pagamento: (o.condicao_pagamento as string) ?? null,
          vencimento: (o.vencimento as string | null) ?? null,
          motivo,
        };
      })
      .sort((a, b) => b.valor - a.valor);

    const semPagamentoTotal = semPagamentoVendas.reduce((s, v) => s + v.valor, 0);

    return NextResponse.json({
      data,
      total,
      quantidade: pagamentos.length,
      por_metodo: porMetodo,
      pagamentos,
      sem_pagamento: {
        total: semPagamentoTotal,
        quantidade: semPagamentoVendas.length,
        vendas: semPagamentoVendas,
      },
    });
  } catch (e) {
    console.error('[financeiro/conciliacao] erro interno', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
