// Utilidades de geocoding (Google Maps Geocoding API). SERVER-ONLY:
// usa GOOGLE_MAPS_API_KEY e supabaseAdmin — nunca importar no client.
import { supabaseAdmin } from '@/lib/supabase';

export interface EnderecoParaGeocode {
  rua?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

// Monta a string padronizada de endereco usada nas chamadas de geocoding.
export function buildEnderecoString(e: EnderecoParaGeocode): string {
  const rua = e.rua || '';
  const numero = e.numero || '';
  const complemento = e.complemento ? ` - ${e.complemento}` : '';
  const bairro = e.bairro || '';
  const cidade = e.cidade || '';
  const estado = e.estado || '';
  const cep = e.cep || '';
  return `${rua}, ${numero}${complemento}, ${bairro}, ${cidade}, ${estado}, ${cep}, Brasil`;
}

// Geocoda um endereco textual. Retorna null em qualquer falha
// (sem API key, ZERO_RESULTS, erro de rede, etc).
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return null;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address,
    )}&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (data.status === 'OK' && data.results[0]) {
      const loc = data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch {
    /* falha silenciosa — retorna null abaixo */
  }
  return null;
}

// Geocoda um endereco ja persistido (por id) e grava lat/lng/geocoded_em/
// geocode_status. Fire-and-forget: NUNCA lanca — qualquer erro e so logado,
// para nao quebrar a operacao principal (criacao/edicao do endereco).
export async function geocodeEnderecoAsync(enderecoId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, rua, numero, complemento, bairro, cidade, estado, cep')
      .eq('id', enderecoId)
      .single();
    if (error || !data) return;

    const coords = await geocodeAddress(buildEnderecoString(data));
    if (coords) {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({
          lat: coords.lat,
          lng: coords.lng,
          geocoded_em: new Date().toISOString(),
          geocode_status: 'success',
        })
        .eq('id', enderecoId);
    } else {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({ geocoded_em: new Date().toISOString(), geocode_status: 'failed' })
        .eq('id', enderecoId);
    }
  } catch (e) {
    console.error('[geocode-endereco] falha ao geocodar', enderecoId, e);
  }
}
