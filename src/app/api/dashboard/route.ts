import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Status que contam como vendas reais (excluindo orcamento, cancelado, ocorrencias)
const VENDAS_STATUS = ['confirmado', 'em_entrega', 'aguardando_retirada', 'entregue'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dataInicio = searchParams.get('data_inicio');
    const dataFim = searchParams.get('data_fim');
    const produto = searchParams.get('produto');

    if (!dataInicio || !dataFim) {
      return NextResponse.json({ error: 'data_inicio e data_fim sao obrigatorios' }, { status: 400 });
    }

    const inicio = dataInicio + 'T00:00:00';
    const fim = dataFim + 'T23:59:59';

    const { data: orcamentosRaw, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, status, subtotal, total, valor_frete,
        tipo_entrega, forma_pagamento, fonte, criado_em,
        clientes ( nome, telefone, cidade, bairro ),
        orcamento_itens ( produto_nome, quantidade, preco_unitario, subtotal, unidade )
      `)
      .gte('criado_em', inicio)
      .lte('criado_em', fim)
      .order('criado_em', { ascending: false });

    if (error) {
      console.error('[Dashboard] Erro:', error);
      return NextResponse.json({ error: 'Erro ao buscar dados' }, { status: 500 });
    }

    const todos = orcamentosRaw || [];

    // Vendas = status confirmado, em_entrega, aguardando_retirada, entregue
    const vendas = todos.filter((o: Record<string, unknown>) => VENDAS_STATUS.includes(o.status as string));
    // Orcamentos = status 'orcamento'
    const soOrcamentos = todos.filter((o: Record<string, unknown>) => o.status === 'orcamento');

    // Buscar custos dos produtos
    const { data: produtosDB } = await supabaseAdmin
      .from('produtos')
      .select('nome, preco_custo, preco_venda');

    const custoPorProduto: Record<string, number> = {};
    (produtosDB || []).forEach((p: Record<string, unknown>) => {
      custoPorProduto[p.nome as string] = Number(p.preco_custo) || 0;
    });

    // ---- METRICAS baseadas apenas em VENDAS ----
    const totalFaturado = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0);
    const totalSubtotal = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.subtotal) || 0), 0);
    const totalFrete = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.valor_frete) || 0), 0);
    const qtdVendas = vendas.length;
    const qtdOrcamentos = soOrcamentos.length;
    const qtdCancelados = todos.filter((o: Record<string, unknown>) => o.status === 'cancelado').length;
    const ticketMedio = qtdVendas > 0 ? totalFaturado / qtdVendas : 0;

    // ---- CMV sobre vendas ----
    let cmvTotal = 0;
    const produtoStats: Record<string, { qtd: number; receita: number; custo: number; margem_valor: number }> = {};

    vendas.forEach((o: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((o.orcamento_itens as any[]) || []).forEach((item: Record<string, unknown>) => {
        const nome = item.produto_nome as string || 'Desconhecido';
        const qtd = Number(item.quantidade) || 0;
        const sub = Number(item.subtotal) || 0;
        const custo = (custoPorProduto[nome] || 0) * qtd;
        cmvTotal += custo;
        if (!produtoStats[nome]) produtoStats[nome] = { qtd: 0, receita: 0, custo: 0, margem_valor: 0 };
        produtoStats[nome].qtd += qtd;
        produtoStats[nome].receita += sub;
        produtoStats[nome].custo += custo;
        produtoStats[nome].margem_valor += (sub - custo);
      });
    });

    const lucroBruto = totalSubtotal - cmvTotal;
    const margemBruta = totalSubtotal > 0 ? (lucroBruto / totalSubtotal) * 100 : 0;

    // ---- TOP PRODUTOS ----
    const topProdutos = Object.entries(produtoStats)
      .map(([nome, d]) => ({
        nome,
        qtd: d.qtd,
        receita: d.receita,
        custo: d.custo,
        margem_valor: d.margem_valor,
        margem_pct: d.receita > 0 ? (d.margem_valor / d.receita) * 100 : 0,
      }))
      .sort((a, b) => b.receita - a.receita);

    // Filtro por produto
    const pedidosFiltrados = produto
      ? vendas.filter((o: Record<string, unknown>) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((o.orcamento_itens as any[]) || []).some((i: Record<string, unknown>) =>
            (i.produto_nome as string)?.toLowerCase().includes(produto.toLowerCase())
          )
        )
      : vendas;

    const totalFiltrado = pedidosFiltrados.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0);

    // ---- STATUS BREAKDOWN (apenas vendas) ----
    const statusBreakdown: Record<string, { qtd: number; total: number }> = {};
    vendas.forEach((o: Record<string, unknown>) => {
      const s = o.status as string || 'desconhecido';
      if (!statusBreakdown[s]) statusBreakdown[s] = { qtd: 0, total: 0 };
      statusBreakdown[s].qtd += 1;
      statusBreakdown[s].total += Number(o.total) || 0;
    });

    // ---- PAGAMENTO (apenas vendas) ----
    const pagamentoBreakdown: Record<string, { qtd: number; total: number }> = {};
    vendas.forEach((o: Record<string, unknown>) => {
      const p = (o.forma_pagamento as string) || 'nao_informado';
      if (!pagamentoBreakdown[p]) pagamentoBreakdown[p] = { qtd: 0, total: 0 };
      pagamentoBreakdown[p].qtd += 1;
      pagamentoBreakdown[p].total += Number(o.total) || 0;
    });

    // ---- ENTREGA vs RETIRADA (apenas vendas) ----
    const entregaBreakdown: Record<string, number> = {};
    vendas.forEach((o: Record<string, unknown>) => {
      const t = (o.tipo_entrega as string) || 'desconhecido';
      entregaBreakdown[t] = (entregaBreakdown[t] || 0) + 1;
    });

    // ---- CANAL (apenas vendas) ----
    const canalBreakdown: Record<string, { qtd: number; total: number }> = {};
    vendas.forEach((o: Record<string, unknown>) => {
      const c = (o.fonte as string) || 'nao_informado';
      if (!canalBreakdown[c]) canalBreakdown[c] = { qtd: 0, total: 0 };
      canalBreakdown[c].qtd += 1;
      canalBreakdown[c].total += Number(o.total) || 0;
    });

    // ---- EVOLUCAO POR DIA (apenas vendas) ----
    const porDia: Record<string, { faturado: number; pedidos: number; cmv: number }> = {};
    vendas.forEach((o: Record<string, unknown>) => {
      const dia = (o.criado_em as string)?.split('T')[0] || '';
      if (!porDia[dia]) porDia[dia] = { faturado: 0, pedidos: 0, cmv: 0 };
      porDia[dia].faturado += Number(o.total) || 0;
      porDia[dia].pedidos += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((o.orcamento_itens as any[]) || []).forEach((item: Record<string, unknown>) => {
        const nome = item.produto_nome as string || '';
        const qtd = Number(item.quantidade) || 0;
        porDia[dia].cmv += (custoPorProduto[nome] || 0) * qtd;
      });
    });

    const evolucaoDiaria = Object.entries(porDia)
      .map(([dia, d]) => ({ dia, ...d }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    return NextResponse.json({
      periodo: { inicio: dataInicio, fim: dataFim },
      resumo: {
        total_faturado: totalFaturado,
        total_subtotal: totalSubtotal,
        total_frete: totalFrete,
        qtd_vendas: qtdVendas,
        qtd_orcamentos: qtdOrcamentos,
        qtd_cancelados: qtdCancelados,
        ticket_medio: ticketMedio,
        cmv_total: cmvTotal,
        lucro_bruto: lucroBruto,
        margem_bruta_pct: margemBruta,
        total_filtrado_produto: totalFiltrado,
        qtd_filtrado_produto: pedidosFiltrados.length,
      },
      top_produtos: topProdutos,
      status_breakdown: statusBreakdown,
      pagamento_breakdown: pagamentoBreakdown,
      entrega_breakdown: entregaBreakdown,
      canal_breakdown: canalBreakdown,
      evolucao_diaria: evolucaoDiaria,
    });

  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
