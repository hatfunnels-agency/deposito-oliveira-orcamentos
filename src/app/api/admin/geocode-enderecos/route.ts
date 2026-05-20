import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildEnderecoString, geocodeAddress } from '@/lib/geocode';

export const dynamic = 'force-dynamic';

const BATCH_PADRAO = 30;
const BATCH_MAX = 50;
const CHUNK = 5; // concorrencia: nao bombardear a Geocoding API

interface EnderecoRow {
  id: string;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}

// Geocoda um endereco e grava o resultado. Retorna o status final.
async function processarEndereco(end: EnderecoRow): Promise<'success' | 'failed' | 'error'> {
  try {
    const coords = await geocodeAddress(buildEnderecoString(end));
    if (coords) {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({
          lat: coords.lat,
          lng: coords.lng,
          geocoded_em: new Date().toISOString(),
          geocode_status: 'success',
        })
        .eq('id', end.id);
      return 'success';
    }
    // null = ZERO_RESULTS / sem key — falha definitiva (nao reprocessa)
    await supabaseAdmin
      .from('enderecos_clientes')
      .update({ geocoded_em: new Date().toISOString(), geocode_status: 'failed' })
      .eq('id', end.id);
    return 'failed';
  } catch (e) {
    // Excecao inesperada — marca 'error' para reprocessar no proximo batch
    console.error('[geocode-backfill] erro no endereco', end.id, e);
    try {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({ geocoded_em: new Date().toISOString(), geocode_status: 'error' })
        .eq('id', end.id);
    } catch {
      /* ignora — fica lat IS NULL e cai no proximo batch */
    }
    return 'error';
  }
}

// POST /api/admin/geocode-enderecos
// Header: x-admin-key. Body opcional: { batch?: number }
export async function POST(request: NextRequest) {
  try {
    // ---- Auth ----
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return NextResponse.json(
        { error: 'ADMIN_API_KEY nao configurada no servidor' },
        { status: 500 },
      );
    }
    if (request.headers.get('x-admin-key') !== adminKey) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    // ---- Batch ----
    let batch = BATCH_PADRAO;
    try {
      const body = await request.json();
      if (body && typeof body.batch === 'number' && Number.isFinite(body.batch)) {
        batch = Math.floor(body.batch);
      }
    } catch {
      /* sem body — usa o padrao */
    }
    batch = Math.min(BATCH_MAX, Math.max(1, batch));

    // ---- Seleciona os enderecos pendentes ----
    const { data: enderecos, error: selErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, rua, numero, complemento, bairro, cidade, estado, cep')
      .is('lat', null)
      .or('geocode_status.is.null,geocode_status.eq.error')
      .order('criado_em', { ascending: true })
      .limit(batch);

    if (selErr) {
      console.error('[geocode-backfill] erro ao buscar enderecos', selErr);
      return NextResponse.json({ error: 'Erro ao buscar enderecos' }, { status: 500 });
    }

    const lista = (enderecos || []) as EnderecoRow[];

    // ---- Processa em chunks de CHUNK (concorrencia limitada) ----
    let success = 0;
    let failed = 0;
    let errored = 0;
    for (let i = 0; i < lista.length; i += CHUNK) {
      const chunk = lista.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(chunk.map(processarEndereco));
      for (const s of settled) {
        const status = s.status === 'fulfilled' ? s.value : 'error';
        if (status === 'success') success++;
        else if (status === 'failed') failed++;
        else errored++;
      }
    }

    // ---- Conta o que ainda falta ----
    const { count: remaining } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('*', { count: 'exact', head: true })
      .is('lat', null)
      .or('geocode_status.is.null,geocode_status.eq.error');

    const resumo = {
      processed: lista.length,
      success,
      failed,
      errored,
      remaining: remaining || 0,
      batch_used: batch,
    };
    console.log('[geocode-backfill]', JSON.stringify(resumo));
    return NextResponse.json(resumo);
  } catch (e) {
    console.error('[geocode-backfill] erro interno', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
