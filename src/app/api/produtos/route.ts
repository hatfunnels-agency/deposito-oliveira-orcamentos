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

    // metros_reservados por produto de ferro (Batch C Task C.3). Soma:
    //   (a) ferragem_consumo.metros de itens em orcamentos status=
    //       'orcamento' E ferro_baixado=false
    //   (b) orcamento_itens.quantidade * baixa_estoque_fator (do produto
    //       pai) pra itens cujo produto.baixa_estoque_em_produto_id = X,
    //       mesma condicao de orcamento status='orcamento' E
    //       ferro_baixado=false.
    // Pedidos committed ja decrementaram estoque_atual — nao entram
    // como reservado. Falha silenciosa: metros_reservados=0 pra todos
    // se as queries quebrarem.
    const metrosReservadosPorProduto = new Map<string, number>();
    try {
      // 1) IDs de orcamentos rascunho (status='orcamento') sem ferro
      // baixado.
      const { data: orcsRaw } = await supabaseAdmin
        .from('orcamentos')
        .select('id')
        .eq('status', 'orcamento')
        .eq('ferro_baixado', false)
        .limit(100000);
      const orcIds = (orcsRaw || []).map(o => o.id as string);

      if (orcIds.length > 0) {
        // 2) Itens desses orcamentos.
        const { data: itensRaw } = await supabaseAdmin
          .from('orcamento_itens')
          .select('id, produto_id, quantidade')
          .in('orcamento_id', orcIds)
          .limit(100000);
        const itens = (itensRaw || []) as Array<{ id: string; produto_id: string | null; quantidade: number }>;

        // 3) ferragem_consumo dos itens.
        const itemIds = itens.map(i => i.id);
        let ferragemRows: Array<{ tipo_ferro: string; metros: number }> = [];
        if (itemIds.length > 0) {
          const { data: fcRaw } = await supabaseAdmin
            .from('ferragem_consumo')
            .select('tipo_ferro, metros')
            .in('orcamento_item_id', itemIds)
            .limit(100000);
          ferragemRows = (fcRaw || []) as Array<{ tipo_ferro: string; metros: number }>;
        }

        // 4) map tipo_ferro -> produto_id (usando produtosMap ja carregado).
        const ferroMap = new Map<string, string>();
        for (const p of (produtos || []) as Array<{ id: string; tipo_ferro: string | null }>) {
          if (p.tipo_ferro) ferroMap.set(p.tipo_ferro, p.id);
        }

        // 5) map produto_id -> { proxyId, fator } (usando produtosMap).
        const proxyMap = new Map<string, { proxyId: string; fator: number }>();
        for (const p of (produtos || []) as Array<{
          id: string;
          baixa_estoque_em_produto_id: string | null;
          baixa_estoque_fator: number | null;
        }>) {
          if (p.baixa_estoque_em_produto_id) {
            proxyMap.set(p.id, {
              proxyId: p.baixa_estoque_em_produto_id,
              fator: Number(p.baixa_estoque_fator) || 1,
            });
          }
        }

        // 6) Path a: agrega ferragem_consumo por tipo_ferro -> produto_id.
        for (const f of ferragemRows) {
          const produtoFerroId = ferroMap.get(f.tipo_ferro);
          if (!produtoFerroId) continue;
          metrosReservadosPorProduto.set(
            produtoFerroId,
            (metrosReservadosPorProduto.get(produtoFerroId) || 0) + (Number(f.metros) || 0),
          );
        }
        // 7) Path b: agrega itens com produto proxy.
        for (const item of itens) {
          if (!item.produto_id) continue;
          const proxy = proxyMap.get(item.produto_id);
          if (!proxy) continue;
          const qtd = (Number(item.quantidade) || 0) * proxy.fator;
          if (qtd === 0) continue;
          metrosReservadosPorProduto.set(
            proxy.proxyId,
            (metrosReservadosPorProduto.get(proxy.proxyId) || 0) + qtd,
          );
        }
      }
    } catch (e) {
      console.error('Erro ao agregar metros_reservados (fica 0 pra todos):', e);
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
        // Batch C: 3 campos do controle de ferro. metros_reservados
        // sempre presente (0 quando nao aplicavel). tipo_ferro/proxy
        // ficam null pra produtos comuns.
        tipo_ferro: (p.tipo_ferro as string | null) || null,
        baixa_estoque_em_produto_id: (p.baixa_estoque_em_produto_id as string | null) || null,
        baixa_estoque_fator: p.baixa_estoque_fator != null ? Number(p.baixa_estoque_fator) : null,
        metros_reservados: metrosReservadosPorProduto.get(p.id as string) || 0,
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
        tipo_estoque: body.tipo_estoque || 'estocavel',
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


