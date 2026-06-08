// Processamento em batch de geocoding pendente de enderecos_clientes.
// SERVER-ONLY (usa supabaseAdmin + GOOGLE_MAPS_API_KEY). Compartilhado
// entre POST /api/admin/geocode-enderecos (manual, com x-admin-key) e
// GET /api/cron/geocode-enderecos (Vercel cron, Bearer CRON_SECRET).
//
// Selecao: enderecos com lat IS NULL E (geocode_status IS NULL OU
// 'error'), ordem criado_em ASC. 'failed' nao reprocessa (ZERO_RESULTS
// permanente); 'error' reprocessa (excecao transitoria).
//
// Concorrencia: chunks de CHUNK pra nao bombardear a Geocoding API.

import { supabaseAdmin } from '@/lib/supabase';
import { buildEnderecoString, geocodeAddress } from '@/lib/geocode';

export const BATCH_PADRAO = 30;
export const BATCH_MAX = 50;
const CHUNK = 5;

export interface ResultadoGeocodeBatch {
  processed: number;
  success: number;
  failed: number;
  errored: number;
  remaining: number;
  batch_used: number;
}

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
    console.error('[geocode-loop] erro no endereco', end.id, e);
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

export async function processarBatchGeocode(opts: {
  batchSize: number;
}): Promise<ResultadoGeocodeBatch> {
  const batchUsado = Math.min(BATCH_MAX, Math.max(1, Math.floor(opts.batchSize) || BATCH_PADRAO));

  const { data: enderecos, error: selErr } = await supabaseAdmin
    .from('enderecos_clientes')
    .select('id, rua, numero, complemento, bairro, cidade, estado, cep')
    .is('lat', null)
    .or('geocode_status.is.null,geocode_status.eq.error')
    .order('criado_em', { ascending: true })
    .limit(batchUsado);

  if (selErr) {
    console.error('[geocode-loop] erro ao buscar enderecos', selErr);
    throw new Error('Erro ao buscar enderecos');
  }

  const lista = (enderecos || []) as EnderecoRow[];

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

  const { count: remaining } = await supabaseAdmin
    .from('enderecos_clientes')
    .select('*', { count: 'exact', head: true })
    .is('lat', null)
    .or('geocode_status.is.null,geocode_status.eq.error');

  return {
    processed: lista.length,
    success,
    failed,
    errored,
    remaining: remaining || 0,
    batch_used: batchUsado,
  };
}
