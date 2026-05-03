import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Status reais no banco que contam como vendas (excluindo orcamento e cancelado)
const VENDAS_STATUS = ['entrega_pendente', 'em_entrega', 'retirada_pendente', 'completo']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const dataInicio = searchParams.get('data_inicio')
    const dataFim = searchParams.get('data_fim')
    const produto = searchParams.get('produto')

    if (!dataInicio || !dataFim) {
      return NextResponse.json({ error: 'data_inicio e data_fim sao obrigatorios' }, { status: 400 })
    }

    const inicio = dataInicio + 'T00:00:00'
    const fim = dataFim + 'T23:59:59'

    const { data: orcamentosRaw, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, status, status_pagamento, subtotal, total, valor_frete,
        tipo_entrega, forma_pagamento, fonte, criado_em, cliente_id,
        clientes ( id, nome, telefone, cidade ),
        orcamento_itens ( produto_nome, quantidade, preco_unitario, subtotal, unidade, preco_custo )
      `)
      .gte('criado_em', inicio)
      .lte('criado_em', fim)
      .order('criado_em', { ascending: false })

    if (error) {
      console.error('[Dashboard] Erro:', error)
      return NextResponse.json({ error: 'Erro ao buscar dados' }, { status: 500 })
    }

    const todos = orcamentosRaw ?? []
    const vendas = todos.filter((o: Record<string, unknown>) => VENDAS_STATUS.includes(o.status as string))
    const soOrcamentos = todos.filter((o: Record<string, unknown>) => o.status === 'orcamento')

    const { data: produtosDB } = await supabaseAdmin
      .from('produtos')
      .select('nome, preco_venda, preco_custo, categoria')

    const custoPorProduto: Record<string, number> = {}
    const precoVendaPorProduto: Record<string, number> = {}
    const categoriaPorProduto: Record<string, string> = {}
    ;(produtosDB ?? []).forEach((p: Record<string, unknown>) => {
      const nome = p.nome as string
      custoPorProduto[nome] = Number(p.preco_custo) || 0
      precoVendaPorProduto[nome] = Number(p.preco_venda) || 0
      categoriaPorProduto[nome] = (p.categoria as string) || ''
    })

    const totalFaturado = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0)
    const totalSubtotal = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.subtotal) || 0), 0)
    const totalFrete = vendas.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.valor_frete) || 0), 0)
    const qtdVendas = vendas.length
    const qtdOrcamentos = soOrcamentos.length
    const qtdCancelados = todos.filter((o: Record<string, unknown>) => o.status === 'cancelado').length
    const qtdTotalOrcamentos = todos.length
    const ticketMedio = qtdVendas > 0 ? totalFaturado / qtdVendas : 0

    // Cash collected: soma do total dos pedidos com status_pagamento = 'completo' no periodo
    const cashCollected = todos
      .filter((o: Record<string, unknown>) => o.status_pagamento === 'completo')
      .reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0)

    // Vendas hoje: independente do periodo selecionado, soma vendas criadas hoje
    // (status diferente de 'cancelado' e 'orcamento')
    const hojeStr = new Date().toISOString().slice(0, 10)
    const { data: hojeRows } = await supabaseAdmin
      .from('orcamentos')
      .select('total, status, criado_em')
      .gte('criado_em', hojeStr + 'T00:00:00')
      .lte('criado_em', hojeStr + 'T23:59:59')
    const vendasHoje = (hojeRows ?? [])
      .filter((o: Record<string, unknown>) => o.status !== 'cancelado' && o.status !== 'orcamento')
      .reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0)

    let cmvTotal = 0
    const produtoStats: Record<string, { qtd: number; receita: number; custo: number; margem_valor: number }> = {}

    vendas.forEach((o: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((o.orcamento_itens as any[]) ?? []).forEach((item: Record<string, unknown>) => {
        const nome = (item.produto_nome as string) || 'Desconhecido'
        const qtd = Number(item.quantidade) || 0
        const sub = Number(item.subtotal) || 0
        // Opcao B: priorizar preco_custo do snapshot no item; fallback para custo atual do produto
        const custoSnapshot = Number(item.preco_custo) || 0
        const custoUnit = custoSnapshot > 0 ? custoSnapshot : (custoPorProduto[nome] || 0)
        const custo = custoUnit * qtd
        cmvTotal += custo
        if (!produtoStats[nome]) produtoStats[nome] = { qtd: 0, receita: 0, custo: 0, margem_valor: 0 }
        produtoStats[nome].qtd += qtd
        produtoStats[nome].receita += sub
        produtoStats[nome].custo += custo
        produtoStats[nome].margem_valor += (sub - custo)
      })
    })

    const lucroBruto = totalFaturado - cmvTotal
    const margemBruta = totalFaturado > 0 ? (lucroBruto / totalFaturado) * 100 : 0

    const topProdutos = Object.entries(produtoStats)
      .map(([nome, d]) => ({
        nome,
        categoria: categoriaPorProduto[nome] || '',
        preco_venda: precoVendaPorProduto[nome] || 0,
        qtd: d.qtd,
        receita: d.receita,
        custo: d.custo,
        margem_valor: d.margem_valor,
        margem_pct: d.receita > 0 ? (d.margem_valor / d.receita) * 100 : 0,
      }))
      .sort((a, b) => b.receita - a.receita)

    // Agregado por cliente
    const clienteStats: Record<string, {
      cliente_id: string;
      nome: string;
      telefone: string;
      cidade: string;
      qtd_pedidos: number;
      valor_total: number;
      ultimo_pedido: string;
      produtos: Record<string, number>;
    }> = {}

    vendas.forEach((o: Record<string, unknown>) => {
      const clienteRaw = o.clientes as Record<string, unknown> | null
      const cid = (o.cliente_id as string) || (clienteRaw?.id as string) || 'sem_cliente'
      const nome = (clienteRaw?.nome as string) || 'Sem cliente'
      const telefone = (clienteRaw?.telefone as string) || ''
      const cidade = (clienteRaw?.cidade as string) || ''
      const criado = (o.criado_em as string) || ''
      if (!clienteStats[cid]) {
        clienteStats[cid] = {
          cliente_id: cid,
          nome, telefone, cidade,
          qtd_pedidos: 0,
          valor_total: 0,
          ultimo_pedido: criado,
          produtos: {},
        }
      }
      const cs = clienteStats[cid]
      cs.qtd_pedidos += 1
      cs.valor_total += Number(o.total) || 0
      if (criado > cs.ultimo_pedido) cs.ultimo_pedido = criado
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((o.orcamento_itens as any[]) ?? []).forEach((item: Record<string, unknown>) => {
        const pn = (item.produto_nome as string) || ''
        if (!pn) return
        cs.produtos[pn] = (cs.produtos[pn] || 0) + (Number(item.quantidade) || 0)
      })
    })

    const clientesBreakdown = Object.values(clienteStats)
      .map((c) => {
        const ticketMedioCliente = c.qtd_pedidos > 0 ? c.valor_total / c.qtd_pedidos : 0
        const produtosTop = Object.entries(c.produtos)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([n]) => n)
          .join(', ')
        return {
          cliente_id: c.cliente_id,
          nome: c.nome,
          telefone: c.telefone,
          cidade: c.cidade,
          qtd_pedidos: c.qtd_pedidos,
          valor_total: c.valor_total,
          ticket_medio: ticketMedioCliente,
          ultimo_pedido: c.ultimo_pedido,
          produtos_comprados: produtosTop,
        }
      })
      .sort((a, b) => b.valor_total - a.valor_total)

    const pedidosFiltrados = produto
      ? vendas.filter((o: Record<string, unknown>) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((o.orcamento_itens as any[]) ?? []).some((i: Record<string, unknown>) =>
            (i.produto_nome as string)?.toLowerCase().includes(produto.toLowerCase())
          )
        )
      : vendas

    const totalFiltrado = pedidosFiltrados.reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total) || 0), 0)

    const statusBreakdown: Record<string, { qtd: number; total: number }> = {}
    vendas.forEach((o: Record<string, unknown>) => {
      const s = o.status as string
      if (!statusBreakdown[s]) statusBreakdown[s] = { qtd: 0, total: 0 }
      statusBreakdown[s].qtd += 1
      statusBreakdown[s].total += Number(o.total) || 0
    })

    const pagamentoBreakdown: Record<string, { qtd: number; total: number }> = {}
    vendas.forEach((o: Record<string, unknown>) => {
      const p = (o.forma_pagamento as string) || 'nao_informado'
      if (!pagamentoBreakdown[p]) pagamentoBreakdown[p] = { qtd: 0, total: 0 }
      pagamentoBreakdown[p].qtd += 1
      pagamentoBreakdown[p].total += Number(o.total) || 0
    })

    const entregaBreakdown: Record<string, number> = {}
    vendas.forEach((o: Record<string, unknown>) => {
      const t = (o.tipo_entrega as string) || 'desconhecido'
      entregaBreakdown[t] = (entregaBreakdown[t] || 0) + 1
    })

    const canalBreakdown: Record<string, { qtd: number; total: number }> = {}
    vendas.forEach((o: Record<string, unknown>) => {
      const c = (o.fonte as string) || 'manual'
      if (!canalBreakdown[c]) canalBreakdown[c] = { qtd: 0, total: 0 }
      canalBreakdown[c].qtd += 1
      canalBreakdown[c].total += Number(o.total) || 0
    })

    const porDia: Record<string, { faturado: number; pedidos: number; cmv: number }> = {}
    vendas.forEach((o: Record<string, unknown>) => {
      const dia = ((o.criado_em as string) || '').slice(0, 10)
      if (!porDia[dia]) porDia[dia] = { faturado: 0, pedidos: 0, cmv: 0 }
      porDia[dia].faturado += Number(o.total) || 0
      porDia[dia].pedidos += 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((o.orcamento_itens as any[]) ?? []).forEach((item: Record<string, unknown>) => {
        const nome = (item.produto_nome as string) || ''
        porDia[dia].cmv += (custoPorProduto[nome] || 0) * (Number(item.quantidade) || 0)
      })
    })

    const evolucaoDiaria = Object.entries(porDia)
      .map(([dia, d]) => ({ dia, ...d }))
      .sort((a, b) => a.dia.localeCompare(b.dia))

    return NextResponse.json({
      periodo: { inicio: dataInicio, fim: dataFim },
      resumo: {
        total_faturado: totalFaturado,
        total_subtotal: totalSubtotal,
        total_frete: totalFrete,
        qtd_vendas: qtdVendas,
        qtd_orcamentos: qtdOrcamentos,
        qtd_total_orcamentos: qtdTotalOrcamentos,
        qtd_cancelados: qtdCancelados,
        ticket_medio: ticketMedio,
        cmv_total: cmvTotal,
        lucro_bruto: lucroBruto,
        margem_bruta_pct: margemBruta,
        cash_collected: cashCollected,
        vendas_hoje: vendasHoje,
        total_filtrado_produto: totalFiltrado,
        qtd_filtrado_produto: pedidosFiltrados.length,
      },
      top_produtos: topProdutos,
      clientes_breakdown: clientesBreakdown,
      status_breakdown: statusBreakdown,
      pagamento_breakdown: pagamentoBreakdown,
      entrega_breakdown: entregaBreakdown,
      canal_breakdown: canalBreakdown,
      evolucao_diaria: evolucaoDiaria,
    })

  } catch (error) {
    console.error('[Dashboard] Error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
