import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1) Produtos ativos. Ordem aqui nao importa — re-sortamos no final
    //    por qtd_vendas DESC, nome ASC pra deixar mais vendidos no topo.
    const { data: produtos, error } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('ativo', true);

    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar produtos', produtos: [], source: 'error' },
        { status: 500 }
      );
    }

        // Tarefa 5: mapa de produtos para resolver estoque compartilhado
        const produtoMap = new Map<string, Record<string, unknown>>();
        for (const p of (produtos || [])) {
                produtoMap.set(p.id as string, p as Record<string, unknown>);
        }

    // Conta vendas por produto_id (excluindo orcamentos cancelados) pra
    // sort por mais vendidos. INNER join via orcamentos!inner +
    // .not status garante exclusao no PostgREST. Falha silenciosa: se
    // a query quebrar, qtd_vendas fica 0 pra todos e o sort cai no
    // alfabetico (sem regressao visivel).
    const vendasPorProduto = new Map<string, number>();
    try {
      const { data: vendasRaw } = await supabaseAdmin
        .from('orcamento_itens')
        .select('produto_id, orcamentos!inner(status)')
        .not('orcamentos.status', 'eq', 'cancelado')
        .limit(100000);
      for (const v of (vendasRaw || []) as Array<{ produto_id: string | null }>) {
        if (!v.produto_id) continue;
        vendasPorProduto.set(v.produto_id, (vendasPorProduto.get(v.produto_id) || 0) + 1);
      }
    } catch (e) {
      console.error('Erro ao contar vendas por produto (sort cai no alfabetico):', e);
    }

    // Ultima atualizacao de preco_custo por produto (Batch B Fase 3).
    // Pega MAX(criado_em) por produto_id da historico_custos. Falha
    // silenciosa: ultima_atualizacao_custo fica null pra todos.
    const ultimaAtualizacaoCustoPorProduto = new Map<string, string>();
    try {
      const { data: histRaw } = await supabaseAdmin
        .from('historico_custos')
        .select('produto_id, criado_em')
        .limit(100000);
      for (const h of (histRaw || []) as Array<{ produto_id: string; criado_em: string }>) {
        const atual = ultimaAtualizacaoCustoPorProduto.get(h.produto_id);
        if (!atual || h.criado_em > atual) {
          ultimaAtualizacaoCustoPorProduto.set(h.produto_id, h.criado_em);
        }
      }
    } catch (e) {
      console.error('Erro ao agregar historico_custos (ultima_atualizacao_custo fica null):', e);
    }

    const produtosFormatados = (produtos || []).map((p: Record<string, unknown>) => {
      const fatorConversao = Number(p.fator_conversao) || 1;
      let   estoqueAtual = Number(p.estoque_atual) || 0;
      let   estoqueMinimo = Number(p.estoque_minimo) || 0;
      // tipo_estoque e total_vendido tambem herdam do principal quando ha
      // estoque_compartilhado_com (o controle do tipo segue o produto que
      // detem o saldo, nao a variante).
      let   tipoEstoque = (p.tipo_estoque as string | null) || 'estocavel';
      let   totalVendido = Number(p.total_vendido) || 0;

            // Tarefa 5: se produto secundario, usar estoque do principal
            if (p.estoque_compartilhado_com) {
                      const principal = produtoMap.get(p.estoque_compartilhado_com as string);
                      if (principal) {
                                  estoqueAtual = Number(principal.estoque_atual) || 0;
                                  estoqueMinimo = Number(principal.estoque_minimo) || 0;
                                  tipoEstoque = (principal.tipo_estoque as string | null) || tipoEstoque;
                                  totalVendido = Number(principal.total_vendido) || 0;
                      }
            }

      const estoqueVenda = fatorConversao !== 1.0
        ? estoqueAtual / fatorConversao
        : estoqueAtual;
      const estoqueMinVenda = fatorConversao !== 1.0
        ? estoqueMinimo / fatorConversao
        : estoqueMinimo;

      return {
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        categoria: p.categoria,
        preco: Number(p.preco_venda),
        preco_custo: Number(p.preco_custo),
        estoque: Math.round(estoqueVenda * 100) / 100,
        unidade: p.unidade_venda,
        estoque_minimo: Math.round(estoqueMinVenda * 100) / 100,
        abaixo_minimo: estoqueVenda <= estoqueMinVenda,
        fator_conversao: fatorConversao,
        unidade_armazenamento: p.unidade,
        estoque_armazenamento: estoqueAtual,
        estoque_compartilhado_com: p.estoque_compartilhado_com || null,
        tipo_estoque: tipoEstoque,
        total_vendido: totalVendido,
        qtd_vendas: vendasPorProduto.get(p.id as string) || 0,
        ultima_atualizacao_custo: ultimaAtualizacaoCustoPorProduto.get(p.id as string) || null,
      };
    });

    // Sort por mais vendidos DESC, alfabetico ASC como tie-breaker.
    produtosFormatados.sort((a, b) => {
      if (b.qtd_vendas !== a.qtd_vendas) return b.qtd_vendas - a.qtd_vendas;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });

    return NextResponse.json({
      source: 'SUPABASE',
      produtos: produtosFormatados,
      mensagem: `${produtosFormatados.length} produtos carregados`,
    });
  } catch (e) {
    console.error('Erro geral em /api/produtos:', e);
    return NextResponse.json(
      { error: 'Erro interno', produtos: [], source: 'error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .insert({
        nome: body.nome,
        codigo: body.codigo || null,
        categoria: body.categoria || 'Geral',
        unidade: body.unidade || 'unidade',
        unidade_venda: body.unidade_venda || body.unidade || 'unidade',
        preco_venda: body.preco_venda,
        preco_custo: body.preco_custo || 0,
        estoque_atual: body.estoque_inicial || 0,
        estoque_minimo: body.estoque_minimo || 0,
        fator_conversao: body.fator_conversao || 1.0,
        ativo: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar produto:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // If there's initial stock, create an entry movement
    if (body.estoque_inicial && body.estoque_inicial > 0) {
      await supabaseAdmin.from('movimentacoes_estoque').insert({
        produto_id: produto.id,
        tipo: 'entrada',
        quantidade: body.estoque_inicial,
        estoque_anterior: 0,
        estoque_novo: body.estoque_inicial,
        observacoes: 'Estoque inicial ao cadastrar produto',
      });
    }

    return NextResponse.json(produto, { status: 201 });
  } catch (e) {
    console.error('Erro ao criar produto:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}


