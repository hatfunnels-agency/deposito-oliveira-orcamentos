import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Tarefa 5: helper para resolver produto principal no estoque compartilhado
async function resolverIdPrincipal(produto_id: string): Promise<string> {
    const { data } = await supabaseAdmin
      .from('produtos')
      .select('estoque_compartilhado_com')
      .eq('id', produto_id)
      .single();
    return data?.estoque_compartilhado_com || produto_id;
}

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
                                    data_entrega, data_retirada, fonte,
                                            data_entrega_original, reagendamentos, bling_pedido_id, motorista_id, leva_id,
                                                    clientes (
                                                              id, nome, telefone, cep, endereco, bairro, cidade, estado,
                                                                        numero, complemento, recebedor
                                                                                ),
                                                                                        orcamento_itens (
                                                                                                  id, produto_id, produto_nome, quantidade, unidade,
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
                  data_entrega, data_retirada, fonte, itens,
                  cliente_nome, cliente_telefone, cliente_cep, cliente_endereco,
                  cliente_numero, cliente_complemento, cliente_recebedor,
                  bling_pedido_id, reagendar, motorista_id, leva_id,
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
          if (motorista_id !== undefined) updateData.motorista_id = motorista_id;
          if (leva_id !== undefined) updateData.leva_id = leva_id;

      // Reschedule logic
      if (data_entrega !== undefined) {
              updateData.data_entrega = data_entrega;
              if (data_retirada !== undefined) updateData.data_retirada = data_retirada || null;
              if (fonte !== undefined) updateData.fonte = fonte;

            if (reagendar) {
                      const { data: current } = await supabaseAdmin
                        .from('orcamentos')
                        .select('data_entrega, data_entrega_original, reagendamentos, status')
                        .eq('id', params.id)
                        .single();

                if (current) {
                            if (!current.data_entrega_original && current.data_entrega) {
                                          updateData.data_entrega_original = current.data_entrega;
                            }
                            updateData.reagendamentos = (current.reagendamentos || 0) + 1;
                            if (current.status === 'ocorrencia') {
                                          updateData.status = 'entrega_pendente';
                            }
                }
            }
      }

      // Update client info
      if (cliente_nome && cliente_telefone) {
              const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
              const clienteData: Record<string, unknown> = {
                        nome: cliente_nome,
                        telefone: telefoneLimpo,
                        cep: cliente_cep || null,
                        endereco: cliente_endereco || null,
                        atualizado_em: new Date().toISOString(),
              };
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
            .select('id, codigo, status, atualizado_em, motorista_id')
            .single();

      if (error) {
              return NextResponse.json({ error: 'Erro ao atualizar orcamento' }, { status: 500 });
      }

      // Stock management
      if (status) {
              const { data: orderItems } = await supabaseAdmin
                .from('orcamento_itens')
                .select('produto_nome, quantidade, produto_id')
                .eq('orcamento_id', params.id);

            const previousStatus = body._previous_status;

            // Baixa de estoque ao confirmar pagamento
            if (status === 'pagamento_ok' && orderItems && orderItems.length > 0) {
                      for (const item of orderItems) {
                                  if (!item.produto_id) continue;

                        // Tarefa 5: sempre operar no produto PRINCIPAL
                        const idPrincipal = await resolverIdPrincipal(item.produto_id);

                        const { data: produto } = await supabaseAdmin
                                    .from('produtos')
                                    .select('id, estoque_atual, fator_conversao')
                                    .eq('id', idPrincipal)
                                    .single();

                        if (produto) {
                                      const fator = Number(produto.fator_conversao) || 1;
                                      const qtdEstoque = Number(item.quantidade) * fator;
                                      const estoqueAnterior = Number(produto.estoque_atual);
                                      const estoqueNovo = Math.max(0, estoqueAnterior - qtdEstoque);

                                    await supabaseAdmin
                                        .from('produtos')
                                        .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
                                        .eq('id', idPrincipal);

                                    await supabaseAdmin.from('movimentacoes_estoque').insert({
                                                    produto_id: idPrincipal,
                                                    tipo: 'saida',
                                                    quantidade: qtdEstoque,
                                                    estoque_anterior: estoqueAnterior,
                                                    estoque_novo: estoqueNovo,
                                                    referencia_tipo: 'orcamento',
                                                    referencia_id: params.id,
                                                    observacoes: `Venda - ${item.produto_nome} x${item.quantidade}`,
                                    });
                        }
                      }
            }

            // Devolucao de estoque ao cancelar
            if (
                      status === 'cancelado' &&
                      previousStatus &&
                      ['pagamento_ok', 'separacao', 'entrega_pendente', 'em_rota'].includes(previousStatus) &&
                      orderItems &&
                      orderItems.length > 0
                    ) {
                      for (const item of orderItems) {
                                  if (!item.produto_id) continue;

                        // Tarefa 5: sempre operar no produto PRINCIPAL
                        const idPrincipal = await resolverIdPrincipal(item.produto_id);

                        const { data: produto } = await supabaseAdmin
                                    .from('produtos')
                                    .select('id, estoque_atual, fator_conversao')
                                    .eq('id', idPrincipal)
                                    .single();

                        if (produto) {
                                      const fator = Number(produto.fator_conversao) || 1;
                                      const qtdEstoque = Number(item.quantidade) * fator;
                                      const estoqueAnterior = Number(produto.estoque_atual);
                                      const estoqueNovo = estoqueAnterior + qtdEstoque;

                                    await supabaseAdmin
                                        .from('produtos')
                                        .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
                                        .eq('id', idPrincipal);

                                    await supabaseAdmin.from('movimentacoes_estoque').insert({
                                                    produto_id: idPrincipal,
                                                    tipo: 'cancelamento',
                                                    quantidade: qtdEstoque,
                                                    estoque_anterior: estoqueAnterior,
                                                    estoque_novo: estoqueNovo,
                                                    referencia_tipo: 'orcamento',
                                                    referencia_id: params.id,
                                                    observacoes: `Cancelamento - ${item.produto_nome} x${item.quantidade}`,
                                    });
                        }
                      }
            }
      }

      if (itens && Array.isArray(itens) && itens.length > 0) {
              await supabaseAdmin.from('orcamento_itens').delete().eq('orcamento_id', params.id);

            const itensToInsert = itens.map((item: {
                      produto_id?: string;
                      produto_nome: string;
                      quantidade: number;
                      unidade?: string;
                      preco_unitario: number;
            }) => ({
                      orcamento_id: params.id,
                      produto_id: item.produto_id || null,
                      produto_nome: item.produto_nome,
                      quantidade: item.quantidade,
                      unidade: item.unidade || 'unidade',
                      preco_unitario: item.preco_unitario,
                      subtotal: item.quantidade * item.preco_unitario,
            }));

            await supabaseAdmin.from('orcamento_itens').insert(itensToInsert);
      }

      // GHL Sync (non-blocking)
      try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
              fetch(`${appUrl}/api/ghl/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orcamento_id: params.id }),
                        cache: 'no-store',
              }).catch(e => console.log('[GHL Sync] Falha (nao bloqueante):', e));
      } catch (e) {
              console.log('[GHL Sync] Falha (nao bloqueante):', e);
      }

      return NextResponse.json(data);
    } catch (error) {
          console.error('Erro ao atualizar orcamento:', error);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
  { params }: { params: { id: string } }
  ) {
    try {
          const { data: orc, error: fetchError } = await supabaseAdmin
            .from('orcamentos').select('id, status').eq('id', params.id).single();

      if (fetchError || !orc) {
              return NextResponse.json({ error: 'Orcamento nao encontrado' }, { status: 404 });
      }

      if (orc.status !== 'orcamento' && orc.status !== 'cancelado') {
              return NextResponse.json(
                { error: 'So e possivel excluir orcamentos com status "orcamento" ou "cancelado"' },
                { status: 400 }
                      );
      }

      await supabaseAdmin.from('orcamento_itens').delete().eq('orcamento_id', params.id);
          await supabaseAdmin.from('orcamentos').delete().eq('id', params.id);

      return NextResponse.json({ success: true });
    } catch (error) {
          console.error('Erro no DELETE orcamento:', error);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}
