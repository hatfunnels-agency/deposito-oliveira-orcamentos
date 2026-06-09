import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { aplicarTagObraAtiva } from '@/lib/cliente-tags-server';
import { aplicarBaixaItem, ehCommitted, reverterBaixaItem } from '@/lib/estoque-baixa';

export async function GET(
    request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
  ) {
    try {
          const params = await ctx.params;
          const { data, error } = await supabaseAdmin
            .from('orcamentos')
            .select(`
                    id, codigo, tipo_entrega, valor_frete, subtotal, total,
                            status, observacoes, criado_em, atualizado_em,
                                    data_entrega, data_retirada, fonte, forma_pagamento,
                                            status_pagamento,
                                            ferragem_status,
                                            data_entrega_original, reagendamentos, bling_pedido_id, motorista_id, leva_id, endereco_id,
                                                    clientes (
                                                              id, nome, telefone, cep, endereco, bairro, cidade, estado,
                                                                        numero, complemento, recebedor
                                                                                ),
                                                                                        endereco_completo:enderecos_clientes (
                                                                                                  id, cep, rua, numero, complemento, bairro, cidade, estado, lat, lng
                                                                                                                ),
                                                                                        orcamento_itens (
                                                                                                  id, produto_id, produto_nome, quantidade, quantidade_entregue, unidade,
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
  ctx: { params: Promise<{ id: string }> }
  ) {
    try {
          const params = await ctx.params;
          const body = await request.json();
          // Destructuring sem cast pra preservar `any` implicito (estilo
          // do codebase pre-Step 3). O cast `Record<string, unknown>`
          // que estava aqui forcava cliente_telefone/itens/etc. a
          // unknown e quebrava .replace/.length/.map na build de TS.
          // Narrowing pra endereco_id e feito via typeof/=== checks
          // mais abaixo.
          const {
                  status, observacoes, tipo_entrega, valor_frete, subtotal, total,
                  data_entrega, data_retirada, fonte, itens, forma_pagamento, status_pagamento,
                  ferragem_status,
                  cliente_nome, cliente_telefone, cliente_recebedor,
                  bling_pedido_id, reagendar, motorista_id, leva_id,
                  endereco_id: enderecoIdBody,
          } = body;

      // Resolve previousStatus AGORA (antes do UPDATE) pra logica de
      // baixa/devolucao saber qual era o estado anterior. Usa body
      // _previous_status se cliente mandou; senao busca do banco.
      let previousStatusResolvido: string | undefined = body._previous_status;
      if (status && previousStatusResolvido === undefined) {
              const { data: orcAtual } = await supabaseAdmin
                .from('orcamentos')
                .select('status')
                .eq('id', params.id)
                .single();
              previousStatusResolvido = (orcAtual?.status as string | undefined) ?? undefined;
      }

      // Valida ownership do endereco_id quando o caller pede pra
      // trocar. Nao permite vincular o orcamento a um endereco de
      // outro cliente. Permite enderecoIdBody=null pra desvincular.
      let enderecoIdValidado: string | null | undefined = undefined;
      if (enderecoIdBody !== undefined) {
              if (enderecoIdBody === null) {
                      enderecoIdValidado = null;
              } else if (typeof enderecoIdBody === 'string' && enderecoIdBody.length > 0) {
                      const { data: orc } = await supabaseAdmin
                        .from('orcamentos')
                        .select('cliente_id')
                        .eq('id', params.id)
                        .single();
                      if (!orc?.cliente_id) {
                              return NextResponse.json({ error: 'Orcamento sem cliente' }, { status: 400 });
                      }
                      const { data: end } = await supabaseAdmin
                        .from('enderecos_clientes')
                        .select('id, cliente_id')
                        .eq('id', enderecoIdBody)
                        .single();
                      if (!end || end.cliente_id !== orc.cliente_id) {
                              return NextResponse.json(
                                { error: 'endereco_id invalido ou nao pertence ao cliente do orcamento' },
                                { status: 400 },
                              );
                      }
                      enderecoIdValidado = end.id as string;
              }
      }

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
          if (forma_pagamento !== undefined) updateData.forma_pagamento = forma_pagamento;
          if (status_pagamento !== undefined) updateData.status_pagamento = status_pagamento;
          // Pedido completo => pagamento sempre completo (mesmo "pagamento na entrega").
          // Coloca apos a atribuicao explicita para o auto vencer caso o body trouxer divergente.
          if (status === 'completo') updateData.status_pagamento = 'completo';
          if (ferragem_status !== undefined) updateData.ferragem_status = ferragem_status;
          if (enderecoIdValidado !== undefined) updateData.endereco_id = enderecoIdValidado;

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

      // Update client info — endereco vive em enderecos_clientes (Step 4);
      // nao mais sobrescreve clientes.cep/endereco/numero/complemento aqui.
      // Recebedor permanece em clientes.* (atributo per-cliente).
      if (cliente_nome && cliente_telefone) {
              const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
              const clienteData: Record<string, unknown> = {
                        nome: cliente_nome,
                        telefone: telefoneLimpo,
                        atualizado_em: new Date().toISOString(),
              };
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
            .select('id, codigo, status, atualizado_em, motorista_id, cliente_id')
            .single();

      if (error) {
              return NextResponse.json({ error: 'Erro ao atualizar orcamento' }, { status: 500 });
      }

      // Auto-tag: se este PATCH alterou o status para uma venda real,
      // marca o cliente com obra_ativa. Nao bloqueia o request.
      if (status) {
              await aplicarTagObraAtiva(
                data?.cliente_id as string | undefined,
                data?.status as string | undefined,
              );
      }

      // Stock management
      if (status) {
              const { data: orderItems } = await supabaseAdmin
                .from('orcamento_itens')
                .select('produto_nome, quantidade, produto_id')
                .eq('orcamento_id', params.id);

            const previousStatus = previousStatusResolvido;

            // Baixa de estoque na TRANSICAO non-committed -> committed.
            // Substitui a checagem antiga (status === 'entrega_pendente'
            // || 'retirada_pendente') que cobria so 2 dos 6 committed e
            // ainda duplicava em re-PATCH com mesmo status. A regra
            // ehCommitted(new) && !ehCommitted(prev) cobre todas as
            // transicoes relevantes e e idempotente. Awaited; helper
            // trata produto_id null, tipo_estoque sob_demanda etc.
            if (ehCommitted(status) && !ehCommitted(previousStatus) && orderItems && orderItems.length > 0) {
                      for (const item of orderItems) {
                              try {
                                      const r = await aplicarBaixaItem(
                                                {
                                                          produto_id: item.produto_id as string | null,
                                                          produto_nome: item.produto_nome as string,
                                                          quantidade: Number(item.quantidade),
                                                },
                                                params.id,
                                      );
                                      if (!r.ok && !('skipped' in r)) {
                                                console.error('[PATCH orcamentos] baixa falhou', item.produto_nome, r);
                                      }
                              } catch (e) {
                                      console.error('[PATCH orcamentos] excecao na baixa', item.produto_nome, e);
                              }
                      }
            }

            // Devolucao de estoque ao cancelar. As 4 transicoes
            // disparadoras (cancelado a partir de entrega_pendente,
            // entrega_parcial, retirada_pendente, em_rota) sao
            // intencionalmente as mesmas — sem expansao de escopo.
            // O helper reverterBaixaItem trata tipo_estoque
            // (sob_demanda decrementa total_vendido; estocavel
            // restaura estoque_atual + insere movimentacao
            // tipo='cancelamento'). Awaited; falha por item so loga.
            if (
                      status === 'cancelado' &&
                      previousStatus &&
                      ['entrega_pendente', 'entrega_parcial', 'retirada_pendente', 'em_rota'].includes(previousStatus) &&
                      orderItems &&
                      orderItems.length > 0
                    ) {
                      for (const item of orderItems) {
                              try {
                                      const r = await reverterBaixaItem(
                                                {
                                                          produto_id: item.produto_id as string | null,
                                                          produto_nome: item.produto_nome as string,
                                                          quantidade: Number(item.quantidade),
                                                },
                                                params.id,
                                      );
                                      if (!r.ok && !('skipped' in r)) {
                                                console.error('[PATCH orcamentos] devolucao falhou', item.produto_nome, r);
                                      }
                              } catch (e) {
                                      console.error('[PATCH orcamentos] excecao na devolucao', item.produto_nome, e);
                              }
                      }
            }
      }

      if (itens && Array.isArray(itens) && itens.length > 0) {
            // Snapshot dos itens atuais para rollback manual caso o insert falhe
            const { data: itensAntigos } = await supabaseAdmin
              .from('orcamento_itens')
              .select('*')
              .eq('orcamento_id', params.id);

            const itensToInsert = itens.map((item: {
                      produto_id?: string;
                      produto_nome: string;
                      quantidade: number;
                      unidade?: string;
                      preco_unitario: number;
                      preco_custo?: number;
            }) => ({
                      orcamento_id: params.id,
                      produto_id: item.produto_id || null,
                      produto_nome: item.produto_nome,
                      quantidade: item.quantidade,
                      unidade: item.unidade || 'unidade',
                      preco_unitario: item.preco_unitario,
                      subtotal: item.quantidade * item.preco_unitario,
                      preco_custo: typeof item.preco_custo === 'number' ? item.preco_custo : 0,
            }));

            // Substituicao atomica: so apaga os itens antigos depois de ter o payload
            // novo pronto, e restaura o snapshot se o insert falhar. Evita que uma
            // edicao deixe o orcamento sem itens ou acumule orfaos.
            const { error: delItensErr } = await supabaseAdmin
              .from('orcamento_itens')
              .delete()
              .eq('orcamento_id', params.id);
            if (delItensErr) {
              console.error('Erro ao remover itens antigos do orcamento:', delItensErr);
              return NextResponse.json({ error: 'Erro ao atualizar itens do orcamento' }, { status: 500 });
            }

            const { error: insItensErr } = await supabaseAdmin
              .from('orcamento_itens')
              .insert(itensToInsert);
            if (insItensErr) {
              console.error('Erro ao inserir novos itens do orcamento:', insItensErr);
              // Rollback manual: restaura os itens antigos para nao deixar o orcamento vazio
              if (itensAntigos && itensAntigos.length > 0) {
                await supabaseAdmin.from('orcamento_itens').insert(itensAntigos);
              }
              return NextResponse.json({ error: 'Erro ao salvar itens do orcamento' }, { status: 500 });
            }
      }

      // GHL Sync — AWAITED de proposito (nao-bloqueante via try/catch).
      // Fire-and-forget aninhado morre quando esta rota e chamada por
      // outra (ex: /api/entregas/rota delega aqui): a lambda externa
      // termina assim que o response volta, matando o fetch interno
      // antes do GHL responder. Next 14.2 nao tem after() estavel (so
      // unstable_after, que exige flag experimental). Await garante que
      // o sync complete antes do response. Erros continuam logados sem
      // propagar 500 ao caller.
      try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
              await fetch(`${appUrl}/api/ghl/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orcamento_id: params.id }),
                        cache: 'no-store',
              });
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
  ctx: { params: Promise<{ id: string }> }
  ) {
    try {
          const params = await ctx.params;
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
