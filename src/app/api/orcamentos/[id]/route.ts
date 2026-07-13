import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { aplicarTagObraAtiva } from '@/lib/cliente-tags-server';
import { aplicarBaixaItem, ehCommitted, reverterBaixaItem } from '@/lib/estoque-baixa';
import { aplicarBaixaFerro, reverterBaixaFerro } from '@/lib/baixa-ferro';
import { criarEnderecoCliente } from '@/lib/enderecos';

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
                                            status_pagamento, valor_pago, condicao_pagamento, vencimento,
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
                                                                                                            preco_unitario, preco_custo, subtotal,
                                                                                                            laje_detalhes (
                                                                                                                      comprimento, largura, area_m2, vao_livre, uso, tem_viga_intermediaria
                                                                                                                            )
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
                  data_entrega, data_retirada, fonte, itens, forma_pagamento,
                  condicao_pagamento, vencimento,
                  ferragem_status,
                  cliente_nome, cliente_telefone, cliente_recebedor,
                  bling_pedido_id, reagendar, motorista_id, leva_id,
                  endereco_id: enderecoIdBody,
                  endereco_novo: enderecoNovoBody,
          } = body;

      // Resolve previousStatus AGORA (antes do UPDATE) pra logica de
      // baixa/devolucao saber qual era o estado anterior. Usa body
      // _previous_status se cliente mandou; senao busca do banco.
      // Tambem traz ferro_baixado (idempotencia do Batch C) na mesma
      // query — zero round-trip extra.
      let previousStatusResolvido: string | undefined = body._previous_status;
      let ferroBaixadoAtual = false;
      if (status) {
              const { data: orcAtual } = await supabaseAdmin
                .from('orcamentos')
                .select('status, ferro_baixado')
                .eq('id', params.id)
                .single();
              if (previousStatusResolvido === undefined) {
                      previousStatusResolvido = (orcAtual?.status as string | undefined) ?? undefined;
              }
              ferroBaixadoAtual = Boolean(orcAtual?.ferro_baixado);
      }

      // Resolve endereco_id final quando o caller pede pra trocar.
      // Aceita 3 formas (simetrico ao POST): endereco_id explicito (com
      // ownership check), endereco_id=null pra desvincular, ou
      // endereco_novo (cria via helper e vincula). Precedencia:
      // endereco_id > endereco_novo. Fetch do orc original e
      // compartilhado entre os 2 caminhos + validacao do Fix 2 abaixo.
      let orcOriginal:
        | { cliente_id: string | null; tipo_entrega: string | null; endereco_id: string | null }
        | null = null;
      const fetchOrcOriginal = async () => {
              if (orcOriginal) return orcOriginal;
              const { data } = await supabaseAdmin
                .from('orcamentos')
                .select('cliente_id, tipo_entrega, endereco_id')
                .eq('id', params.id)
                .single();
              orcOriginal = (data as typeof orcOriginal) ?? null;
              return orcOriginal;
      };

      let enderecoIdValidado: string | null | undefined = undefined;
      const querMexerEndereco =
        enderecoIdBody !== undefined ||
        (enderecoNovoBody && typeof enderecoNovoBody === 'object');
      if (querMexerEndereco) {
              const orc = await fetchOrcOriginal();
              if (!orc?.cliente_id) {
                      return NextResponse.json({ error: 'Orcamento sem cliente' }, { status: 400 });
              }
              if (enderecoIdBody === null) {
                      enderecoIdValidado = null;
              } else if (typeof enderecoIdBody === 'string' && enderecoIdBody.length > 0) {
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
              } else if (enderecoNovoBody && typeof enderecoNovoBody === 'object') {
                      const r = await criarEnderecoCliente(orc.cliente_id as string, enderecoNovoBody);
                      if (!r.ok) {
                              console.error('[PATCH orcamentos] criar endereco_novo falhou', r);
                              return NextResponse.json(
                                { error: 'Falha ao criar endereco novo' },
                                { status: 500 },
                              );
                      }
                      enderecoIdValidado = r.endereco.id;
              }
      }

      // Fix 2: bloqueia PATCH que deixaria o pedido em estado invalido —
      // tipo_entrega='entrega' sem endereco_id. So valida se ESTE PATCH
      // mexeu em tipo_entrega ou endereco (caso contrario assume que o
      // estado anterior era valido OU e legacy; nao revalida).
      if (tipo_entrega !== undefined || enderecoIdValidado !== undefined) {
              const orc = await fetchOrcOriginal();
              const tipoFinal = tipo_entrega !== undefined
                ? tipo_entrega
                : (orc?.tipo_entrega ?? null);
              const enderecoFinal = enderecoIdValidado !== undefined
                ? enderecoIdValidado
                : (orc?.endereco_id ?? null);
              if (tipoFinal === 'entrega' && !enderecoFinal) {
                      return NextResponse.json(
                        { error: 'endereco_id ou endereco_novo e obrigatorio para tipo_entrega=entrega' },
                        { status: 400 },
                      );
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
          if (condicao_pagamento !== undefined) updateData.condicao_pagamento = condicao_pagamento;
          if (vencimento !== undefined) updateData.vencimento = vencimento || null;
          // status_pagamento NAO e mais escrito aqui: e derivado da tabela
          // `pagamentos` por trigger no Postgres. Antes esta rota forcava
          // status_pagamento='completo' sempre que status==='completo' — ou
          // seja, entregue implicava pago, e nenhum pedido entregue podia
          // aparecer como devendo. Pra marcar como pago, registre o dinheiro
          // em POST /api/pagamentos.
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

            // Batch C: baixa/reversao de FERRO. Fluxo SEPARADO do
            // aplicarBaixaItem acima — cobre 2 caminhos que o helper
            // existente nao trata: (a) itens avulsos da calculadora via
            // ferragem_consumo e (b) produtos com baixa_estoque_em_
            // produto_id (proxy). Idempotencia via orcamentos.
            // ferro_baixado — caller seta a flag depois do sucesso.
            if (ehCommitted(status) && !ferroBaixadoAtual) {
                      try {
                              const r = await aplicarBaixaFerro(params.id);
                              if (r.ok) {
                                      await supabaseAdmin
                                        .from('orcamentos')
                                        .update({ ferro_baixado: true })
                                        .eq('id', params.id);
                              } else {
                                      console.error('[PATCH orcamentos] aplicarBaixaFerro falhou', r.erro);
                              }
                      } catch (e) {
                              console.error('[PATCH orcamentos] excecao em aplicarBaixaFerro', e);
                      }
            } else if (status === 'cancelado' && ferroBaixadoAtual) {
                      try {
                              const r = await reverterBaixaFerro(params.id);
                              if (r.ok) {
                                      await supabaseAdmin
                                        .from('orcamentos')
                                        .update({ ferro_baixado: false })
                                        .eq('id', params.id);
                              } else {
                                      console.error('[PATCH orcamentos] reverterBaixaFerro falhou', r.erro);
                              }
                      } catch (e) {
                              console.error('[PATCH orcamentos] excecao em reverterBaixaFerro', e);
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
            //
            // ferragem_consumo nao precisa de DELETE explicito aqui: a FK em
            // orcamento_item_id tem ON DELETE CASCADE, entao o delete em
            // orcamento_itens abaixo ja apaga os filhos automaticamente. Re-
            // insercao acontece depois do insert dos novos itens (Batch B
            // Fase 1).
            const { error: delItensErr } = await supabaseAdmin
              .from('orcamento_itens')
              .delete()
              .eq('orcamento_id', params.id);
            if (delItensErr) {
              console.error('Erro ao remover itens antigos do orcamento:', delItensErr);
              return NextResponse.json({ error: 'Erro ao atualizar itens do orcamento' }, { status: 500 });
            }

            const { data: itensInseridos, error: insItensErr } = await supabaseAdmin
              .from('orcamento_itens')
              .insert(itensToInsert)
              .select('id');
            if (insItensErr) {
              console.error('Erro ao inserir novos itens do orcamento:', insItensErr);
              // Rollback manual: restaura os itens antigos para nao deixar o orcamento vazio
              if (itensAntigos && itensAntigos.length > 0) {
                await supabaseAdmin.from('orcamento_itens').insert(itensAntigos);
              }
              return NextResponse.json({ error: 'Erro ao salvar itens do orcamento' }, { status: 500 });
            }

            // Re-insere ferragem_consumo a partir do detalhamento_ferro do
            // payload (Batch B Fase 1). Aceita opcional — items sem o
            // campo nao geram linhas. Mapeia por indice (insert preserva
            // ordem). Falha so e logada (orcamento ja foi salvo).
            const ferragemRows: Array<{ orcamento_item_id: string; tipo_ferro: string; metros: number }> = [];
            for (let i = 0; i < itens.length; i++) {
              const det = (itens[i] as { detalhamento_ferro?: Array<{ tipo_ferro: string; metros: number }> }).detalhamento_ferro;
              const insertedId = itensInseridos?.[i]?.id as string | undefined;
              if (!insertedId || !det || !Array.isArray(det) || det.length === 0) continue;
              for (const d of det) {
                if (!d.tipo_ferro || typeof d.metros !== 'number' || d.metros <= 0) continue;
                ferragemRows.push({
                  orcamento_item_id: insertedId,
                  tipo_ferro: String(d.tipo_ferro),
                  metros: Number(d.metros),
                });
              }
            }
            if (ferragemRows.length > 0) {
              const { error: fcErr } = await supabaseAdmin.from('ferragem_consumo').insert(ferragemRows);
              if (fcErr) {
                console.error('[ferragem_consumo PATCH] insert falhou (orcamento ja atualizado):', fcErr);
              }
            }

            // Re-insere laje_detalhes (Batch D). Mesma logica: a FK tem ON
            // DELETE CASCADE, entao o delete acima ja limpou os antigos. O
            // cliente reenvia laje_detalhes no payload de edicao, senao os
            // dados da fabrica se perderiam a cada edicao do pedido.
            const lajeRows: Array<{
              orcamento_item_id: string;
              comprimento: number | null;
              largura: number | null;
              area_m2: number;
              vao_livre: number;
              uso: string;
              tem_viga_intermediaria: boolean;
            }> = [];
            for (let i = 0; i < itens.length; i++) {
              const det = (itens[i] as { laje_detalhes?: {
                comprimento?: number | null;
                largura?: number | null;
                area_m2?: number;
                vao_livre?: number;
                uso?: string;
                tem_viga_intermediaria?: boolean;
              } }).laje_detalhes;
              const insertedId = itensInseridos?.[i]?.id as string | undefined;
              if (!insertedId || !det) continue;
              if (!det.uso || typeof det.vao_livre !== 'number' || det.vao_livre <= 0) continue;
              lajeRows.push({
                orcamento_item_id: insertedId,
                comprimento: typeof det.comprimento === 'number' ? det.comprimento : null,
                largura: typeof det.largura === 'number' ? det.largura : null,
                area_m2: Number(det.area_m2) || 0,
                vao_livre: Number(det.vao_livre),
                uso: String(det.uso),
                tem_viga_intermediaria: Boolean(det.tem_viga_intermediaria),
              });
            }
            if (lajeRows.length > 0) {
              const { error: ldErr } = await supabaseAdmin.from('laje_detalhes').insert(lajeRows);
              if (ldErr) {
                console.error('[laje_detalhes PATCH] insert falhou (orcamento ja atualizado):', ldErr);
              }
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

      // Conversao offline Google Ads — dispara quando o pedido ENTRA num
      // status de venda confirmada (Entrega Pendente em diante; exclui
      // ocorrencia e cancelado). So na transicao de-fora-pra-dentro pra
      // evitar reenvio a cada PATCH subsequente; o order_id (codigo) no
      // upload ainda garante dedupe no proprio Google como rede de seguranca.
      // Mesmo padrao awaited+try/catch do GHL sync (Next 14.2 sem after()).
      const STATUS_CONVERSAO_GADS = ['entrega_pendente', 'retirada_pendente', 'entrega_parcial', 'em_rota', 'completo'];
      const entrouEmConversao =
              status !== undefined &&
              STATUS_CONVERSAO_GADS.includes(status) &&
              !STATUS_CONVERSAO_GADS.includes(previousStatusResolvido ?? '');
      if (entrouEmConversao) {
              try {
                      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
                      await fetch(`${appUrl}/api/google-ads/conversion`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ orcamento_id: params.id }),
                                cache: 'no-store',
                      });
              } catch (e) {
                      console.log('[GAds Conv] Falha (nao bloqueante):', e);
              }
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
