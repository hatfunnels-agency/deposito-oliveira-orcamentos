import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
  ) {
    try {
          const body = await request.json();
          const { status, motorista_id, volume_total, orcamento_id, acao } = body;

          if (orcamento_id && acao) {
                  if (acao === 'adicionar') {
                            await supabaseAdmin.from('orcamentos').update({ leva_id: params.id }).eq('id', orcamento_id);
                          } else if (acao === 'remover') {
                            await supabaseAdmin.from('orcamentos').update({ leva_id: null }).eq('id', orcamento_id).eq('leva_id', params.id);
                          }

                  const { data: orcamentos } = await supabaseAdmin.from('orcamentos').select('orcamento_itens ( quantidade, produto:produto_id ( volume_unitario ) )').eq('leva_id', params.id);

                  let volumeTotal = 0;
                  for (const orc of (orcamentos || [])) {
                            for (const item of ((orc as Record<string, unknown>).orcamento_itens as Array<{ quantidade: number; produto?: { volume_unitario?: number } }> || [])) {
                                        volumeTotal += (Number(item.produto?.volume_unitario) || 0) * (Number(item.quantidade) || 0);
                                      }
                          }

                  await supabaseAdmin.from('levas_entrega').update({ volume_total: Math.round(volumeTotal * 100) / 100 }).eq('id', params.id);
                }

          const updateData: Record<string, unknown> = {};
          if (status) updateData.status = status;
          if (motorista_id !== undefined) updateData.motorista_id = motorista_id;
          if (volume_total !== undefined) updateData.volume_total = volume_total;

          if (Object.keys(updateData).length > 0) {
                  await supabaseAdmin.from('levas_entrega').update(updateData).eq('id', params.id);
                }

          if (status === 'em_rota') {
                  await supabaseAdmin.from('orcamentos').update({ status: 'em_rota' }).eq('leva_id', params.id).in('status', ['entrega_pendente', 'separacao']);
                }

          const { data: leva, error } = await supabaseAdmin.from('levas_entrega').select('id, data, numero_leva, volume_total, status, criado_em, motorista_id, motoristas ( id, nome, veiculo )').eq('id', params.id).single();

          if (error) return NextResponse.json({ error: 'Leva nao encontrada' }, { status: 404 });

          return NextResponse.json(leva);
        } catch (e) {
          console.error('Erro em PATCH /api/levas/[id]:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
        }
  }

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
  ) {
    try {
          await supabaseAdmin.from('orcamentos').update({ leva_id: null }).eq('leva_id', params.id);
          const { error } = await supabaseAdmin.from('levas_entrega').delete().eq('id', params.id);
          if (error) return NextResponse.json({ error: 'Erro ao excluir leva' }, { status: 500 });
          return NextResponse.json({ success: true });
        } catch (e) {
          console.error('Erro em DELETE /api/levas/[id]:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
        }
  }
