import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  const { pergunta, tipo } = await request.json();

  if (!pergunta && !tipo) {
    return NextResponse.json({ error: 'Pergunta obrigatoria' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key nao configurada' }, { status: 500 });
  }

  try {
    const hoje = new Date().toISOString().split('T')[0];
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: orcamentos } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, status, total, tipo_entrega, forma_pagamento, fonte, criado_em, data_entrega, clientes ( nome, telefone, cidade, bairro ), orcamento_itens ( produto_nome, quantidade, preco_unitario, subtotal, unidade )')
      .gte('criado_em', trintaDiasAtras + 'T00:00:00')
      .order('criado_em', { ascending: false });

    const { data: produtos } = await supabaseAdmin
      .from('produtos')
      .select('nome, codigo, categoria, preco_venda, preco_custo, estoque_atual, estoque_minimo, unidade_venda, ativo')
      .eq('ativo', true);

    const { data: clientes } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, telefone, cidade, criado_em');

    const orcamentosHoje = (orcamentos || []).filter(o => o.criado_em?.startsWith(hoje));
    const orcamentosSemana = (orcamentos || []).filter(o => o.criado_em >= seteDiasAtras + 'T00:00:00');
    const orcamentosMes = orcamentos || [];

    const totalHoje = orcamentosHoje.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalSemana = orcamentosSemana.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalMes = orcamentosMes.reduce((s, o) => s + (Number(o.total) || 0), 0);

    const pedidosNaoCancelados = orcamentosMes.filter(o => o.status !== 'cancelado');
    const ticketMedio = pedidosNaoCancelados.length > 0
      ? pedidosNaoCancelados.reduce((s, o) => s + (Number(o.total) || 0), 0) / pedidosNaoCancelados.length
      : 0;

    const produtoContagem: Record<string, { qtd: number; valor: number }> = {};
    orcamentosMes.forEach(o => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (o.orcamento_itens || []).forEach((item: any) => {
        const nome = item.produto_nome || 'Desconhecido';
        if (!produtoContagem[nome]) produtoContagem[nome] = { qtd: 0, valor: 0 };
        produtoContagem[nome].qtd += Number(item.quantidade) || 0;
        produtoContagem[nome].valor += Number(item.subtotal) || 0;
      });
    });

    const statusCount: Record<string, number> = {};
    orcamentosMes.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1; });

    const canalCount: Record<string, number> = {};
    orcamentosMes.forEach(o => {
      const canal = o.fonte || 'Nao informado';
      canalCount[canal] = (canalCount[canal] || 0) + 1;
    });

    const pagamentoCount: Record<string, number> = {};
    orcamentosMes.forEach(o => {
      const pag = o.forma_pagamento || 'Nao informado';
      pagamentoCount[pag] = (pagamentoCount[pag] || 0) + 1;
    });

    const topProdutos = Object.entries(produtoContagem)
      .sort((a, b) => b[1].valor - a[1].valor)
      .slice(0, 15)
      .map(([nome, d]) => `- ${nome}: ${d.qtd} unidades, R$ ${d.valor.toFixed(2)}`)
      .join('\n');

    const estoqueStr = (produtos || [])
      .map(p => `- ${p.nome} (${p.categoria}): ${p.estoque_atual >= 999 ? 'Sob demanda' : p.estoque_atual + ' ' + p.unidade_venda} | Preco venda: R$${p.preco_venda} | Custo: R$${p.preco_custo} | Margem: ${p.preco_venda > 0 ? (((p.preco_venda - p.preco_custo) / p.preco_venda) * 100).toFixed(0) : 0}%`)
      .join('\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ultimosOrc = (orcamentos || []).slice(0, 20).map((o: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itens = (o.orcamento_itens || []).map((i: any) => `${i.produto_nome} ${i.quantidade}${i.unidade || ''}`).join(', ');
      return `- ${o.codigo} | ${o.clientes?.nome || 'N/A'} | R$${o.total} | ${o.status} | ${o.fonte || 'N/A'} | ${o.forma_pagamento || 'N/A'} | ${o.criado_em?.split('T')[0]} | ${itens}`;
    }).join('\n');

    const contexto = `DADOS DO DEPOSITO OLIVEIRA — ${hoje}
Deposito de materiais de construcao em Carapicuiba/SP. Atende: Carapicuiba, Osasco, Barueri, Cotia (raio ~5km).

METRICAS GERAIS (ultimos 30 dias):
- Total faturado no mes: R$ ${totalMes.toFixed(2)}
- Total faturado na semana: R$ ${totalSemana.toFixed(2)}
- Total faturado hoje: R$ ${totalHoje.toFixed(2)}
- Quantidade de orcamentos no mes: ${orcamentosMes.length}
- Ticket medio: R$ ${ticketMedio.toFixed(2)}
- Total de clientes cadastrados: ${(clientes || []).length}

STATUS DOS ORCAMENTOS (ultimos 30 dias):
${Object.entries(statusCount).map(([s, c]) => `- ${s}: ${c}`).join('\n')}

CANAIS DE VENDA (ultimos 30 dias):
${Object.entries(canalCount).map(([c, n]) => `- ${c}: ${n}`).join('\n')}

FORMAS DE PAGAMENTO (ultimos 30 dias):
${Object.entries(pagamentoCount).map(([p, n]) => `- ${p}: ${n}`).join('\n')}

PRODUTOS MAIS VENDIDOS (ultimos 30 dias):
${topProdutos}

ESTOQUE ATUAL:
${estoqueStr}

ULTIMOS 20 ORCAMENTOS:
${ultimosOrc}`.trim();

    let promptUsuario = pergunta || '';

    if (tipo === 'resumo_dia') {
      promptUsuario = `Faca um resumo executivo do dia de hoje (${hoje}). Inclua: faturamento, quantidade de pedidos, ticket medio, produtos mais vendidos hoje, status dos pedidos, e qualquer observacao relevante. Se nao houve vendas hoje, analise os ultimos dias. Seja direto e pratico.`;
    } else if (tipo === 'relatorio_semanal') {
      promptUsuario = 'Faca um relatorio semanal de performance dos ultimos 7 dias. Inclua: faturamento total, ticket medio, produtos mais vendidos, canais de venda com melhor performance, taxa de conversao (orcamentos vs completados), e 3 recomendacoes praticas para a proxima semana.';
    } else if (tipo === 'analise_clientes') {
      promptUsuario = 'Analise o perfil dos clientes dos ultimos 30 dias. Identifique: clientes que mais compraram (valor e frequencia), clientes que fizeram orcamento mas nao compraram, bairros/regioes com mais pedidos, padroes de compra, e oportunidades de recompra. Sugira acoes praticas.';
    } else if (tipo === 'previsao_estoque') {
      promptUsuario = 'Analise a velocidade de venda de cada produto e preveja quando o estoque vai precisar de reposicao. Para cada produto com estoque fisico (excluir sob demanda/999), calcule: vendas por dia, dias ate acabar, e quando pedir reposicao. Destaque os produtos mais urgentes.';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: 'Voce e o consultor de inteligencia de negocios do Deposito Oliveira, um deposito de materiais de construcao em Carapicuiba/SP. Responda sempre em portugues brasileiro, de forma direta e pratica. Use os dados reais fornecidos. Formate com emojis, negrito (**texto**) e listas quando apropriado. Seja um consultor estrategico — nao so reporte numeros, de insights e recomendacoes acionaveis.',
        messages: [{ role: 'user', content: `${contexto}\n\n---\n\nPERGUNTA DO GESTOR:\n${promptUsuario}` }],
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[AI Chat] Anthropic error:', err);
      return NextResponse.json({ error: 'Erro ao consultar IA' }, { status: 500 });
    }

    const data = await response.json();
    const resposta = data.content?.[0]?.text || 'Sem resposta da IA.';
    return NextResponse.json({ resposta });

  } catch (error) {
    console.error('[AI Chat] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
