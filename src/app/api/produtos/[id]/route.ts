import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/produtos/[id] - Product details + last 20 movements
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: 'Produto nao encontrado' }, { status: 404 });
    }

    const { data: movimentacoes } = await supabaseAdmin
      .from('movimentacoes_estoque')
      .select('*')
      .eq('produto_id', params.id)
      .order('criado_em', { ascending: false })
      .limit(20);

    return NextResponse.json({
      ...produto,
      movimentacoes: movimentacoes || [],
    });
  } catch (e) {
    console.error('Erro em GET /api/produtos/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT /api/produtos/[id] - Edit product (not stock directly)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    const updateData: Record<string, unknown> = {
      atualizado_em: new Date().toISOString(),
    };

    // Only allow these fields to be updated
    if (body.nome !== undefined) updateData.nome = body.nome;
    if (body.codigo !== undefined) updateData.codigo = body.codigo;
    if (body.categoria !== undefined) updateData.categoria = body.categoria;
    if (body.unidade_venda !== undefined) updateData.unidade_venda = body.unidade_venda;
    if (body.preco_venda !== undefined) updateData.preco_venda = body.preco_venda;
    if (body.preco_custo !== undefined) updateData.preco_custo = body.preco_custo;
    if (body.estoque_minimo !== undefined) updateData.estoque_minimo = body.estoque_minimo;
    if (body.fator_conversao !== undefined) updateData.fator_conversao = body.fator_conversao;
    if (body.ativo !== undefined) updateData.ativo = body.ativo;

    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar produto:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(produto);
  } catch (e) {
    console.error('Erro em PUT /api/produtos/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
