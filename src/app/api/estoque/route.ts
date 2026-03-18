import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/estoque - Register stock movement
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { produto_id, tipo, quantidade, observacoes } = body;

    if (!produto_id || !tipo || quantidade === undefined) {
      return NextResponse.json(
        { error: 'produto_id, tipo e quantidade são obrigatórios' },
        { status: 400 }
      );
    }

    if (!['entrada', 'saida', 'ajuste', 'cancelamento'].includes(tipo)) {
      return NextResponse.json(
        { error: 'tipo deve ser: entrada, saida, ajuste ou cancelamento' },
        { status: 400 }
      );
    }

    // Get current product
    const { data: produto, error: prodError } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', produto_id)
      .single();

    if (prodError || !produto) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
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

    // Update product stock
    const { error: updateError } = await supabase
      .from('produtos')
      .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
      .eq('id', produto_id);

    if (updateError) {
      return NextResponse.json({ error: 'Erro ao atualizar estoque' }, { status: 500 });
    }

    // Create movement record
    const { data: movimentacao, error: movError } = await supabase
      .from('movimentacoes_estoque')
      .insert({
        produto_id,
        tipo,
        quantidade: tipo === 'ajuste' ? Math.abs(estoqueNovo - estoqueAnterior) : Number(quantidade),
        estoque_anterior: estoqueAnterior,
        estoque_novo: estoqueNovo,
        referencia_tipo: body.referencia_tipo || null,
        referencia_id: body.referencia_id || null,
        observacoes: observacoes || null,
      })
      .select()
      .single();

    if (movError) {
      console.error('Erro ao registrar movimentação:', movError);
    }

    // Return updated product
    const { data: produtoAtualizado } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', produto_id)
      .single();

    return NextResponse.json({
      produto: produtoAtualizado,
      movimentacao,
      estoque_anterior: estoqueAnterior,
      estoque_novo: estoqueNovo,
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
        { error: 'produto_id é obrigatório' },
        { status: 400 }
      );
    }

    const { data: movimentacoes, error } = await supabase
      .from('movimentacoes_estoque')
      .select('*')
      .eq('produto_id', produtoId)
      .order('criado_em', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar movimentações' }, { status: 500 });
    }

    return NextResponse.json({ movimentacoes: movimentacoes || [] });
  } catch (e) {
    console.error('Erro em GET /api/estoque:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
