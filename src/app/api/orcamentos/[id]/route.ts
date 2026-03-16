import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, tipo_entrega, valor_frete, subtotal, total,
        status, observacoes, criado_em, atualizado_em,
        clientes ( id, nome, telefone, cep, endereco, bairro, cidade, estado ),
        orcamento_itens ( id, produto_id, produto_nome, quantidade, unidade, preco_unitario, subtotal )
      `)
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Orcamento nao encontrado' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao buscar orcamento:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status, observacoes } = body;

    const updateData: Record<string, string> = {
      atualizado_em: new Date().toISOString(),
    };

    if (status) updateData.status = status;
    if (observacoes !== undefined) updateData.observacoes = observacoes;

    const { data, error } = await supabaseAdmin
      .from('orcamentos')
      .update(updateData)
      .eq('id', params.id)
      .select('id, codigo, status, atualizado_em')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar orcamento' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao atualizar orcamento:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}