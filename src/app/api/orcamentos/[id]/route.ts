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
        id, codigo, tipo_entrega, valor_frete, subtotal, total, status,
        observacoes, criado_em, atualizado_em, data_entrega,
        data_entrega_original, reagendamentos, bling_pedido_id,
        clientes (
          id, nome, telefone, cep, endereco, bairro, cidade, estado,
          numero, complemento, recebedor
        ),
        orcamento_itens (
          id, produto_id, produto_bling_id, produto_nome, quantidade, unidade,
          preco_unitario, subtotal
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
    const {
      status, observacoes, tipo_entrega, valor_frete, subtotal, total,
      data_entrega, itens, cliente_nome, cliente_telefone, cliente_cep,
      cliente_endereco, cliente_numero, cliente_complemento, cliente_recebedor,
      bling_pedido_id, reagendar
    } = body;

    const updateData: Record<string, unknown> = {
      atualizado_em: new Date().toISOString(),
    };

    if (status) updateData.status = status;
    if (observacoes !== undefined) updateData.observacoes = observacoes;
    if (tipo_entrega !== undefined) updateData.tipo_entrega = tipo_entrega;
    if (valor_frete !== undefined) updateData.valor_frete = valor_frete;
    if (subtotal !== undefined) updateData.subtotal = subtotal;
    if (total !== undefined) updateData.total = total;
    if (bling_pedido_id !== undefined) updateData.bling_pedido_id = bling_pedido_id;

    // Feature 9 - Reschedule logic
    if (data_entrega !== undefined) {
      updateData.data_entrega = data_entrega;
      
      if (reagendar) {
        // Get current data to check original date
        const { data: current } = await supabaseAdmin
          .from('orcamentos')
          .select('data_entrega, data_entrega_original, reagendamentos, status')
          .eq('id', params.id)
          .single();
        
        if (current) {
          // Save original date if first reschedule
          if (!current.data_entrega_original && current.data_entrega) {
            updateData.data_entrega_original = current.data_entrega;
          }
          updateData.reagendamentos = (current.reagendamentos || 0) + 1;
          
          // If status was ocorrencia, move back to entrega_pendente
          if (current.status === 'ocorrencia') {
            updateData.status = 'entrega_pendente';
          }
        }
      }
    }

    // Feature 8 - Update client with new fields
    if (cliente_nome && cliente_telefone) {
      const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
      const clienteData: Record<string, unknown> = {
        nome: cliente_nome,
        telefone: telefoneLimpo,
        cep: cliente_cep || null,
        endereco: cliente_endereco || null,
        atualizado_em: new Date().toISOString(),
      };
      
      // Add new fields if provided
      if (cliente_numero !== undefined) clienteData.numero = cliente_numero;
      if (cliente_complemento !== undefined) clienteData.complemento = cliente_complemento;
      if (cliente_recebedor !== undefined) clienteData.recebedor = cliente_recebedor;
      
      const { data: cliente } = await supabaseAdmin
        .from('clientes')
        .upsert(clienteData, { onConflict: 'telefone', ignoreDuplicates: false })
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

    // Update items if provided
    if (itens && Array.isArray(itens) && itens.length > 0) {
      await supabaseAdmin
        .from('orcamento_itens')
        .delete()
        .eq('orcamento_id', params.id);

      const itensToInsert = itens.map((item: {
        produto_id?: string | number;
        produto_bling_id?: string | number;
        produto_nome: string;
        quantidade: number;
        unidade?: string;
        preco_unitario: number;
      }) => ({
        orcamento_id: params.id,
        produto_id: item.produto_id ? Number(item.produto_id) : null,
        produto_bling_id: item.produto_bling_id ? Number(item.produto_bling_id) : null,
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
