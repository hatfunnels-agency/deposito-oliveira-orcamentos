import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/entregas/vagas?data=YYYY-MM-DD[&ignorar=<id do pedido>]
//   -> { data, capacidade, manha, tarde, sem_periodo }
//
// Quantas entregas ja estao marcadas em cada periodo do dia, contra o teto
// (configuracoes.entregas_capacidade_periodo). Conta venda fechada de
// entrega (nao conta orcamento nem cancelado) e as viagens programadas de
// entrega parcial naquele dia (essas nao tem periodo: entram em sem_periodo).
// `ignorar` tira o proprio pedido da conta ao editar/reagendar.
export async function GET(request: NextRequest) {
  try {
    const data = request.nextUrl.searchParams.get('data') || '';
    const ignorar = request.nextUrl.searchParams.get('ignorar') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: 'Data inválida' }, { status: 400 });

    const [{ data: cfg }, { data: pedidos, error }, { data: viagens }] = await Promise.all([
      supabaseAdmin.from('configuracoes').select('valor').eq('chave', 'entregas_capacidade_periodo').maybeSingle(),
      supabaseAdmin.from('orcamentos').select('id, periodo_entrega')
        .eq('tipo_entrega', 'entrega').eq('data_entrega', data)
        .not('status', 'in', '(orcamento,cancelado)'),
      supabaseAdmin.from('entregas_parciais').select('orcamento_id')
        .eq('status', 'programada').eq('data_entrega', data),
    ]);
    if (error) throw error;

    const capacidade = Math.max(1, Number(cfg?.valor) || 8);
    let manha = 0, tarde = 0, semPeriodo = 0;
    const contados = new Set<string>();
    for (const p of pedidos ?? []) {
      const id = String(p.id);
      contados.add(id);
      if (id === ignorar) continue;
      if (p.periodo_entrega === 'manha') manha++;
      else if (p.periodo_entrega === 'tarde') tarde++;
      else semPeriodo++;
    }
    // Viagem programada de pedido cuja data "principal" e outro dia.
    for (const v of viagens ?? []) {
      const id = String(v.orcamento_id);
      if (contados.has(id) || id === ignorar) continue;
      contados.add(id);
      semPeriodo++;
    }
    return NextResponse.json({ data, capacidade, manha, tarde, sem_periodo: semPeriodo });
  } catch (e) {
    console.error('Erro GET /api/entregas/vagas', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
