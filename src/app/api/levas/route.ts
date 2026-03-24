import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/levas?data=2026-03-24 - listar levas por data
export async function GET(request: NextRequest) {
    try {
          const { searchParams } = new URL(request.url);
          const data = searchParams.get('data');

          let query = supabaseAdmin
            .from('levas_entrega')
            .select(`
                            id, data, numero_leva, volume_total, status, criado_em,
                            motorista_id,
                            motoristas ( id, nome, veiculo )
                          `)
            .order('data', { ascending: false })
            .order('numero_leva', { ascending: true });

          if (data) {
                  query = query.eq('data', data);
                }

          const { data: levas, error } = await query;

          if (error) {
                  return NextResponse.json({ error: 'Erro ao buscar levas' }, { status: 500 });
                }

          // Para cada leva, buscar as entregas associadas
          const levasComEntregas = await Promise.all(
                  (levas || []).map(async (leva) => {
                            const { data: orcamentos } = await supabaseAdmin
                              .from('orcamentos')
                              .select(`
                                                  id, codigo, total, status, data_entrega,
                                                  clientes ( nome, endereco, numero, bairro, cidade ),
                                                  orcamento_itens ( quantidade, unidade, produto_id,
                                                                                 produto:produto_id ( volume_unitario )
                                                                               )
                                                `)
                              .eq('leva_id', leva.id);

                            return { ...leva, orcamentos: orcamentos || [] };
                          })
                );

          return NextResponse.json({ levas: levasComEntregas });
        } catch (e) {
          console.error('Erro em GET /api/levas:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
        }
  }

// POST /api/levas - criar nova leva
export async function POST(request: NextRequest) {
    try {
          const body = await request.json();
          const { data, motorista_id, numero_leva } = body;

          if (!data) {
                  return NextResponse.json({ error: 'data e obrigatoria' }, { status: 400 });
                }

          // Determinar numero da leva automaticamente se nao fornecido
          let levaNumero = numero_leva;
          if (!levaNumero) {
                  const { data: existentes } = await supabaseAdmin
                    .from('levas_entrega')
                    .select('numero_leva')
                    .eq('data', data)
                    .order('numero_leva', { ascending: false })
                    .limit(1);

                  levaNumero = existentes && existentes.length > 0
                    ? (existentes[0].numero_leva + 1)
                    : 1;
                }

          const { data: leva, error } = await supabaseAdmin
            .from('levas_entrega')
            .insert({
                      data,
                      motorista_id: motorista_id || null,
                      numero_leva: levaNumero,
                      volume_total: 0,
                      status: 'pendente',
                    })
            .select(`
                            id, data, numero_leva, volume_total, status, criado_em,
                            motorista_id,
                            motoristas ( id, nome, veiculo )
                          `)
            .single();

          if (error) {
                  return NextResponse.json({ error: error.message }, { status: 400 });
                }

          return NextResponse.json(leva, { status: 201 });
        } catch (e) {
          console.error('Erro em POST /api/levas:', e);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
        }
  }
