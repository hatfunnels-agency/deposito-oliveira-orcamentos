import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Helper: resolve o produto principal (considera estoque_compartilhado_com)
async function resolverProdutoPrincipal(produto_id: string) {
    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('id', produto_id)
      .single();

  if (error || !produto) return { produto: null, idPrincipal: produto_id };

  // Se este produto é secundário (aponta para outro), usar o principal
  if (produto.estoque_compartilhado_com) {
        const { data: principal } = await supabaseAdmin
          .from('produtos')
          .select('*')
          .eq('id', produto.estoque_compartilhado_com)
          .single();
        return { produto: principal || produto, idPrincipal: produto.estoque_compartilhado_com };
  }

  return { produto, idPrincipal: produto_id };
}

// POST /api/estoque - Register stock movement
export async function POST(request: Request) {
    try {
          const body = await request.json();
          const { produto_id, tipo, quantidade, observacoes } = body;

      if (!produto_id || !tipo || quantidade === undefined) {
              return NextResponse.json(
                { error: 'produto_id, tipo e quantidade sao obrigatorios' },
                { status: 400 }
                      );
      }

      if (!['entrada', 'saida', 'ajuste', 'cancelamento'].includes(tipo)) {
              return NextResponse.json(
                { error: 'tipo deve ser: entrada, saida, ajuste ou cancelamento' },
                { status: 400 }
                      );
      }

      // Tarefa 5: Resolver produto principal (estoque compartilhado)
      const { produto, idPrincipal } = await resolverProdutoPrincipal(produto_id);

      if (!produto) {
              return NextResponse.json({ error: 'Produto nao encontrado' }, { status: 404 });
      }

      const estoqueAnterior = Number(produto.estoque_atual);
          let estoqueNovo: number;

      switch (tipo) {
        case 'entrada':
                  estoqueNovo = estoqueAnterior + Number(quantidade);
                  break;
        case 'saida':
                  if (estoqueAnterior < Number(quantidade)) {
                              return NextResponse.json(
                                { error: `Estoque insuficiente. Atual: ${estoqueAnterior}, solicitado: ${quantidade}` },
                                { status: 400 }
                                          );
                  }
                  estoqueNovo = estoqueAnterior - Number(quantidade);
                  break;
        case 'ajuste':
                  estoqueNovo = Number(quantidade);
                  break;
        case 'cancelamento':
                  estoqueNovo = estoqueAnterior + Number(quantidade);
                  break;
        default:
                  estoqueNovo = estoqueAnterior;
      }

      // Sempre atualizar o produto PRINCIPAL
      const { error: updateError } = await supabaseAdmin
            .from('produtos')
            .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
            .eq('id', idPrincipal);

      if (updateError) {
              return NextResponse.json({ error: 'Erro ao atualizar estoque' }, { status: 500 });
      }

      // Registrar movimentacao no produto informado (pode ser secundario)
      const qtdMovimentacao = tipo === 'ajuste'
            ? Math.abs(estoqueNovo - estoqueAnterior)
              : Number(quantidade);

      const { data: movimentacao, error: movError } = await supabaseAdmin
            .from('movimentacoes_estoque')
            .insert({
                      produto_id: idPrincipal, // sempre registrar no principal
                      tipo,
                      quantidade: qtdMovimentacao,
                      estoque_anterior: estoqueAnterior,
                      estoque_novo: estoqueNovo,
                      referencia_tipo: body.referencia_tipo || null,
                      referencia_id: body.referencia_id || null,
                      observacoes: observacoes || null,
            })
            .select()
            .single();

      if (movError) {
              console.error('Erro ao registrar movimentacao:', movError);
      }

      // Retornar produto atualizado
      const { data: produtoAtualizado } = await supabaseAdmin
            .from('produtos')
            .select('*')
            .eq('id', idPrincipal)
            .single();

      return NextResponse.json({
              produto: produtoAtualizado,
              movimentacao,
              estoque_anterior: estoqueAnterior,
              estoque_novo: estoqueNovo,
              produto_original_id: produto_id,
              produto_principal_id: idPrincipal,
      });
    } catch (e) {
          console.error('Erro em POST /api/estoque:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}

// GET /api/estoque?produto_id={id} - Stock movement history
export async function GET(request: Request) {
    try {
          const { searchParams } = new URL(request.url);
          const produtoId = searchParams.get('produto_id');

      if (!produtoId) {
              return NextResponse.json(
                { error: 'produto_id e obrigatorio' },
                { status: 400 }
                      );
      }

      // Tarefa 5: buscar historico do principal tambem
      const { idPrincipal } = await resolverProdutoPrincipal(produtoId);

      // Buscar movimentacoes tanto do produto informado quanto do principal
        const ids = produtoId === idPrincipal ? [produtoId] : [produtoId, idPrincipal];

      const { data: movimentacoes, error } = await supabaseAdmin
            .from('movimentacoes_estoque')
            .select('*')
            .in('produto_id', ids)
            .order('criado_em', { ascending: false })
            .limit(50);

      if (error) {
              return NextResponse.json({ error: 'Erro ao buscar movimentacoes' }, { status: 500 });
      }

      return NextResponse.json({ movimentacoes: movimentacoes || [] });
    } catch (e) {
          console.error('Erro em GET /api/estoque:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}
