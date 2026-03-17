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
        id,
        codigo,
        tipo_entrega,
        valor_frete,
        subtotal,
        total,
        status,
        observacoes,
        criado_em,
        atualizado_em,
        data_entrega,
        clientes (
          id,
          nome,
          telefone,
          cep,
          endereco,
          bairro,
          cidade,
          estado
        ),
        orcamento_itens (
          id,
          produto_id,
          produto_nome,
          quantidade,
          unidade,
          preco_unitario,
          subtotal
        )
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
    const { status, observacoes, tipo_entrega, valor_frete, subtotal, total, data_entrega, itens, cliente_nome, cliente_telefone, cliente_cep, cliente_endereco } = body;

    const updateData: Record<string, unknown> = {
      atualizado_em: new Date().toISOString(),
    };

    if (status) updateData.status = status;
    if (observacoes !== undefined) updateData.observacoes = observacoes;
    if (tipo_entrega !== undefined) updateData.tipo_entrega = tipo_entrega;
    if (valor_frete !== undefined) updateData.valor_frete = valor_frete;
    if (subtotal !== undefined) updateData.subtotal = subtotal;
    if (total !== undefined) updateData.total = total;
    if (data_entrega !== undefined) updateData.data_entrega = data_entrega;

    if (cliente_nome && cliente_telefone) {
      const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
      const { data: cliente } = await supabaseAdmin
        .from('clientes')
        .upsert(
          {
            nome: cliente_nome,
            telefone: telefoneLimpo,
            cep: cliente_cep || null,
            endereco: cliente_endereco || null,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: 'telefone', ignoreDuplicates: false }
        )
        .select('id')
        .single();

      if (cliente) {
        updateData.cliente_id = cliente.id;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('orcamentos')
      .update(updateData)
      .eq('id', params.id)
      .select('id, codigo, status, atualizado_em')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar orcamento' }, { status: 500 });
    }

    if (itens && Array.isArray(itens) && itens.length > 0) {
      await supabaseAdmin
        .from('orcamento_itens')
        .delete()
        .eq('orcamento_id', params.id);

      const itensToInsert = itens.map((item: {
        produto_id?: string | number;
        produto_nome: string;
        quantidade: number;
        unidade?: string;
        preco_unitario: number;
      }) => ({
        orcamento_id: params.id,
        produto_id: item.produto_id ? Number(item.produto_id) : null,
        produto_nome: item.produto_nome,
        quantidade: item.quantidade,
        unidade: item.unidade || 'unidade',
        preco_unitario: item.preco_unitario,
        subtotal: item.quantidade * item.preco_unitario,
      }));

      await supabaseAdmin
        .from('orcamento_itens')
        .insert(itensToInsert);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao atualizar orcamento:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
