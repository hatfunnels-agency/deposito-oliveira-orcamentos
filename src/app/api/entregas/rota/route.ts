import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const DEPOSITO_ADDRESS = 'Av. InocÃªncio SerÃ¡fico, 4020 - Centro, CarapicuÃ­ba - SP, 06380-021';
const DEPOSITO_LAT = -23.5237;
const DEPOSITO_LNG = -46.8389;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Get driving distance from depot to one address using Distance Matrix API
async function getDrivingDistanceKm(destAddress: string, apiKey: string): Promise<number | null> {
  try {
    const origin = encodeURIComponent(DEPOSITO_ADDRESS);
    const destination = encodeURIComponent(destAddress);
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (
      data.status === 'OK' &&
      data.rows?.[0]?.elements?.[0]?.status === 'OK'
    ) {
      const meters = data.rows[0].elements[0].distance.value;
      return Math.round(meters / 100) / 10; // meters -> km, 1 decimal
    }
  } catch {}
  return null;
}

interface EntregaItem {
  id: string;
  codigo: string;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  cep: string;
  numero: string;
  complemento: string;
  recebedor: string;
  bairro: string;
  cidade: string;
  status: string;
  total: number;
  itens_resumo: string;
  falta_resumo: string;
  data_entrega: string | null;
  observacoes: string;
  distancia_km: number | null;
  lat: number | null;
  lng: number | null;
}

// GET - carrega entregas do dia (pendentes, em rota e completas)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const data = searchParams.get('data');

    const statusEntrega = ['aguardando', 'confirmado', 'entrega_pendente', 'entrega_parcial', 'em_rota', 'completo'];
    let query = supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, tipo_entrega, status, total, data_entrega, observacoes,
        clientes!inner (
          nome, telefone, recebedor,
          enderecos_clientes!inner (
            cep, rua, numero, complemento, bairro, cidade, estado, lat, lng
          )
        ),
        orcamento_itens (
          produto_nome, quantidade, quantidade_entregue, unidade
        )
      `)
      .eq('tipo_entrega', 'entrega')
      .in('status', statusEntrega)
      .eq('clientes.enderecos_clientes.is_padrao', true)
      .order('criado_em', { ascending: true });

    if (data) {
      query = query.eq('data_entrega', data);
    } else {
      const hoje = new Date().toISOString().slice(0, 10);
      query = query.eq('data_entrega', hoje);
    }

    const { data: entregas, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar entregas' }, { status: 500 });
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

    const entregasComDist: EntregaItem[] = await Promise.all(
      (entregas || []).map(async (e: Record<string, unknown>) => {
        // clientes!inner -> objeto (to-one); enderecos_clientes!inner -> array
        const clienteRaw = e.clientes;
        const cliente = (Array.isArray(clienteRaw) ? clienteRaw[0] : clienteRaw) as
          | Record<string, unknown>
          | null;
        const endsRaw = cliente?.enderecos_clientes;
        const end = (Array.isArray(endsRaw) ? endsRaw[0] : endsRaw) as
          | Record<string, unknown>
          | null;

        const itens = e.orcamento_itens as Array<Record<string, unknown>> | null;
        const itensResumo = (itens || [])
          .map((i) => String(i.quantidade) + (i.unidade === 'unidade' ? 'x' : String(i.unidade)) + ' ' + String(i.produto_nome))
          .join(', ');
        const faltaResumo = (itens || [])
          .map((i) => {
            const total = Number(i.quantidade) || 0;
            const entregue = Number(i.quantidade_entregue) || 0;
            const falta = total - entregue;
            if (falta <= 1e-9) return null;
            const u = String(i.unidade || '');
            return `${falta} ${u} de ${i.produto_nome}`.trim();
          })
          .filter((x): x is string => !!x)
          .join(' · ');

        const endereco = end?.rua ? String(end.rua) : '';
        const numero = end?.numero ? String(end.numero) : '';
        const cep = end?.cep ? String(end.cep) : '';
        const bairro = end?.bairro ? String(end.bairro) : '';
        const cidade = end?.cidade ? String(end.cidade) + '-' + String(end.estado || '') : '';
        const lat = end?.lat !== null && end?.lat !== undefined ? Number(end.lat) : null;
        const lng = end?.lng !== null && end?.lng !== undefined ? Number(end.lng) : null;

        let distanciaKm: number | null = null;
        if (GOOGLE_MAPS_API_KEY && endereco) {
          const fullAddr = [endereco, numero, bairro, cep].filter(Boolean).join(', ') + ', Brasil';
          // Distance Matrix API real driving distance — geocode runtime removido
          // (lat/lng vêm de enderecos_clientes, geocodificados em background).
          distanciaKm = await getDrivingDistanceKm(fullAddr, GOOGLE_MAPS_API_KEY);
          // Fallback: haversine a partir de lat/lng persistidos (sem chamar geocode).
          if (distanciaKm === null && lat !== null && lng !== null) {
            distanciaKm = Math.round(haversineKm(DEPOSITO_LAT, DEPOSITO_LNG, lat, lng) * 10) / 10;
          }
        }

        return {
          id: String(e.id), codigo: String(e.codigo),
          cliente_nome: cliente?.nome ? String(cliente.nome) : 'Sem nome',
          cliente_telefone: cliente?.telefone ? String(cliente.telefone) : '',
          endereco, cep, numero,
          complemento: end?.complemento ? String(end.complemento) : '',
          recebedor: cliente?.recebedor ? String(cliente.recebedor) : '',
          bairro, cidade,
          status: String(e.status), total: Number(e.total),
          itens_resumo: itensResumo,
          falta_resumo: faltaResumo,
          data_entrega: e.data_entrega ? String(e.data_entrega) : null,
          observacoes: e.observacoes ? String(e.observacoes) : '',
          distancia_km: distanciaKm,
          lat,
          lng,
        };
      })
    );

    // Nearest Neighbor heuristic: start from depot, always go to closest unvisited delivery
    const withCoords = entregasComDist.filter(e => e.lat !== null && e.lng !== null);
    const withoutCoords = entregasComDist.filter(e => e.lat === null || e.lng === null);

    const optimized: typeof entregasComDist = [];
    const remaining = [...withCoords];
    let curLat = DEPOSITO_LAT;
    let curLng = DEPOSITO_LNG;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(curLat, curLng, remaining[i].lat!, remaining[i].lng!);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      optimized.push(next);
      curLat = next.lat!;
      curLng = next.lng!;
    }

    // Append entries without coords at the end (sorted by distancia_km)
    withoutCoords.sort((a, b) => {
      if (a.distancia_km === null) return 1;
      if (b.distancia_km === null) return -1;
      return a.distancia_km - b.distancia_km;
    });
    const entregasOrdenadas = [...optimized, ...withoutCoords];

    return NextResponse.json({ entregas: entregasOrdenadas, total: entregasOrdenadas.length });
  } catch (error) {
    console.error('Erro ao carregar entregas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST - gera rota com Google Maps para IDs selecionados
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, distancias } = body as { ids: string[]; distancias?: Record<string, number | null> };

    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: 'Nenhuma entrega selecionada' }, { status: 400 });
    }

    const { data: entregas, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, tipo_entrega, status, total, data_entrega, observacoes,
        clientes (
          nome, telefone, cep, endereco, bairro, cidade, estado,
          numero, complemento, recebedor
        ),
        orcamento_itens (
          produto_nome, quantidade, unidade
        )
      `)
      .in('id', ids);

    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar entregas' }, { status: 500 });
    }

    const entregasFormatadas = (entregas || []).map((e: Record<string, unknown>) => {
      const cliente = e.clientes as Record<string, unknown> | null;
      const itens = e.orcamento_itens as Array<Record<string, unknown>> | null;
      const itensResumo = (itens || [])
        .map((i) => String(i.quantidade) + (i.unidade === 'unidade' ? 'x' : String(i.unidade)) + ' ' + String(i.produto_nome))
        .join(', ');
      return {
        id: String(e.id), codigo: String(e.codigo),
        cliente_nome: cliente?.nome ? String(cliente.nome) : 'Sem nome',
        cliente_telefone: cliente?.telefone ? String(cliente.telefone) : '',
        endereco: cliente?.endereco ? String(cliente.endereco) : '',
        cep: cliente?.cep ? String(cliente.cep) : '',
        numero: cliente?.numero ? String(cliente.numero) : '',
        complemento: cliente?.complemento ? String(cliente.complemento) : '',
        recebedor: cliente?.recebedor ? String(cliente.recebedor) : '',
        bairro: cliente?.bairro ? String(cliente.bairro) : '',
        cidade: cliente?.cidade ? String(cliente.cidade) + '-' + String(cliente.estado || '') : '',
        status: String(e.status), total: Number(e.total),
        itens_resumo: itensResumo,
        data_entrega: e.data_entrega ? String(e.data_entrega) : null,
        observacoes: e.observacoes ? String(e.observacoes) : '',
        distancia_km: distancias ? (distancias[String(e.id)] ?? null) : null,
      };
    });

    const ordered = ids
      .map(id => entregasFormatadas.find((e) => e.id === id))
      .filter(Boolean) as typeof entregasFormatadas;

    // Build Google Maps URL
    const entregasComEnd = ordered.filter(e => e.endereco);
    const waypointsForUrl = entregasComEnd
      .map((e) => encodeURIComponent([e.endereco, e.numero ? 'nÂº ' + e.numero : '', e.cep].filter(Boolean).join(', ')))
      .join('|');
    const mapsUrl = entregasComEnd.length > 0
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(DEPOSITO_ADDRESS)}&destination=${encodeURIComponent(DEPOSITO_ADDRESS)}&waypoints=${waypointsForUrl}&travelmode=driving`
      : null;

    // Sum driving distances (already computed by GET, passed in from frontend)
    let distanciaTotalKm = 0;
    if (distancias) {
      for (const id of ids) {
        const d = distancias[id];
        if (d != null) distanciaTotalKm += d;
      }
      // Add return trip: use last stop distance as estimate
      if (ids.length > 0) {
        const lastId = ids[ids.length - 1];
        const lastDist = distancias[lastId] ?? 0;
        distanciaTotalKm += lastDist > 0 ? lastDist : 5;
      }
    }
    distanciaTotalKm = Math.round(distanciaTotalKm * 10) / 10;

    // Estimated time: 30 km/h average + 15 min per stop for unloading
    const tempoViagem = distanciaTotalKm > 0 ? Math.round((distanciaTotalKm / 30) * 60) : 0;
    const tempoDescargas = ids.length * 15;
    const tempoTotalMin = tempoViagem + tempoDescargas;

    return NextResponse.json({
      entregas: ordered,
      maps_url: mapsUrl,
      total: ordered.length,
      distancia_total_km: distanciaTotalKm,
      tempo_estimado_min: tempoTotalMin,
      duracao_total_min: tempoTotalMin,
      total_entregas: ordered.length,
    });
  } catch (error) {
    console.error('Erro ao gerar rota:', error);
    return NextResponse.json({ error: 'Erro interno ao gerar rota' }, { status: 500 });
  }
}

// PATCH - atualiza status das entregas (em_rota ou completo)
export async function PATCH(request: NextRequest) {
  try {
    const { ids, novoStatus } = await request.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs das entregas sao obrigatorios' }, { status: 400 });
    }
    const statusValidos = ['em_rota', 'completo'];
    const status = statusValidos.includes(novoStatus) ? novoStatus : 'em_rota';
    const { error } = await supabaseAdmin
      .from('orcamentos')
      .update({ status })
      .in('id', ids);
    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar status das entregas' }, { status: 500 });
    }
    return NextResponse.json({ success: true, mensagem: ids.length + ' entrega(s) atualizada(s) para ' + status });
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
