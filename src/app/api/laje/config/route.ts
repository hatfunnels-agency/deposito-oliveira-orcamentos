import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Consumo de concreto da capa por kit + parametros do traco (Batch D).
// Ficam no banco (laje_consumo / laje_parametros) pra serem ajustados sem
// deploy. A calculadora de laje le isso ao abrir.
export async function GET() {
  try {
    const [consumoRes, paramsRes] = await Promise.all([
      supabaseAdmin.from('laje_consumo').select('produto_id, concreto_m3_por_m2'),
      supabaseAdmin.from('laje_parametros').select('chave, valor'),
    ]);

    if (consumoRes.error) throw consumoRes.error;
    if (paramsRes.error) throw paramsRes.error;

    // produto_id -> m3 de concreto por m2 de laje
    const consumo: Record<string, number> = {};
    for (const row of consumoRes.data || []) {
      consumo[row.produto_id] = Number(row.concreto_m3_por_m2);
    }

    const parametros: Record<string, number> = {};
    for (const row of paramsRes.data || []) {
      parametros[row.chave] = Number(row.valor);
    }

    return NextResponse.json({ consumo, parametros });
  } catch (e) {
    console.error('[laje/config] erro:', e);
    return NextResponse.json({ error: 'Erro ao carregar config de laje' }, { status: 500 });
  }
}
