import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const DEPOSITO_ADDRESS = 'Av. Inocêncio Seráfico, 4020 - Centro, Carapicuíba - SP, 06380-021';

interface EntregaParaRota {
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
  data_entrega: string | null;
  observacoes: string;
  motorista_id: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data: dataFiltro } = body;
    const dataAlvo = dataFiltro || new Date().toISOString().split('T')[0];
    const statusEntrega = ['pagamento_ok', 'separacao', 'entrega_pendente', 'em_rota'];

    let query = supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, tipo_entrega, status, total, data_entrega, observacoes, motorista_id, leva_id,
        clientes (
          nome, telefone, cep, endereco, bairro, cidade, estado,
          numero, complemento, recebedor
        ),
        orcamento_itens (
          produto_nome, quantidade, unidade
        )
      `)
      .eq('tipo_entrega', 'entrega')
      .in('status', statusEntrega)
      .order('criado_em', { ascending: true });

    if (dataFiltro) {
      query = query.eq('data_entrega', dataAlvo);
    }

    const { data: entregas, error } = await query;

    if (error) {
      console.error('Erro ao buscar entregas:', error);
      return NextResponse.json({ error: 'Erro ao buscar entregas' }, { status: 500 });
    }

    if (!entregas || entregas.length === 0) {
      return NextResponse.json({
        data: dataAlvo, total_entregas: 0, distancia_total_km: 0, duracao_total_min: 0,
        rota_otimizada: [], maps_url: null,
        mensagem: 'Nenhuma entrega encontrada para esta data',
      });
    }

    const entregasParaRota: EntregaParaRota[] = entregas.map((e: Record<string, unknown>) => {
      const cliente = e.clientes as Record<string, string> | null;
      const itens = e.orcamento_itens as Array<Record<string, unknown>> | null;
      const itensResumo = (itens || [])
        .map((i) => String(i.quantidade) + (i.unidade === 'unidade' ? 'x' : String(i.unidade)) + ' ' + String(i.produto_nome))
        .join(', ');
      return {
        id: String(e.id), codigo: String(e.codigo),
        cliente_nome: cliente?.nome || 'Sem nome',
        cliente_telefone: cliente?.telefone || '',
        endereco: cliente?.endereco || '', cep: cliente?.cep || '',
        numero: cliente?.numero || '', complemento: cliente?.complemento || '',
        recebedor: cliente?.recebedor || '', bairro: cliente?.bairro || '',
        cidade: cliente?.cidade ? cliente.cidade + '-' + (cliente.estado || '') : '',
        status: String(e.status), total: Number(e.total),
        itens_resumo: itensResumo,
        data_entrega: e.data_entrega ? String(e.data_entrega) : null,
        observacoes: e.observacoes ? String(e.observacoes) : '',
        motorista_id: e.motorista_id ? String(e.motorista_id) : null,
        leva_id: e.leva_id ? String(e.leva_id) : null,
      };
    });

    const entregasComEndereco = entregasParaRota.filter((e) => e.endereco || e.cep);

    if (entregasComEndereco.length === 0) {
      return NextResponse.json({
        data: dataAlvo, total_entregas: entregasParaRota.length,
        distancia_total_km: 0, duracao_total_min: 0,
        rota_otimizada: entregasParaRota, maps_url: null,
        mensagem: 'Entregas encontradas mas sem endereços válidos para calcular rota',
      });
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Google Maps API key não configurada' }, { status: 500 });
    }

    const waypoints = entregasComEndereco.slice(0, 25).map((e) => {
      const fullAddr = [e.endereco, e.numero ? 'n' + String.fromCharCode(186) + ' ' + e.numero : '', e.bairro, e.cep].filter(Boolean).join(', ');
      return encodeURIComponent(fullAddr);
    });

    const waypointsParam = waypoints.length > 0 ? '&waypoints=optimize:true|' + waypoints.join('|') : '';
    const directionsUrl = 'https://maps.googleapis.com/maps/api/directions/json?origin=' + encodeURIComponent(DEPOSITO_ADDRESS) + '&destination=' + encodeURIComponent(DEPOSITO_ADDRESS) + waypointsParam + '&language=pt-BR&key=' + GOOGLE_MAPS_API_KEY;

    const gmapsRes = await fetch(directionsUrl, { cache: 'no-store' });
    const gmapsData = await gmapsRes.json();

    if (gmapsData.status !== 'OK') {
      const errorDetail = gmapsData.error_message || gmapsData.status;
      console.error('Google Directions API error:', JSON.stringify(gmapsData));
      return NextResponse.json({
        data: dataAlvo, total_entregas: entregasParaRota.length,
        distancia_total_km: 0, duracao_total_min: 0,
        rota_otimizada: entregasParaRota.map((e, idx) => ({ parada: idx + 1, ...e })),
        maps_url: null,
        mensagem: 'Erro ao calcular rota: ' + errorDetail + '. Entregas listadas sem otimizacao.',
      });
    }

    const route = gmapsData.routes[0];
    const waypointOrder: number[] = route.waypoint_order || [];
    let distanciaTotalM = 0, duracaoTotalS = 0;
    for (const leg of route.legs) {
      distanciaTotalM += leg.distance.value;
      duracaoTotalS += leg.duration.value;
    }
    const distanciaTotalKm = Math.round((distanciaTotalM / 1000) * 10) / 10;
    const duracaoTotalMin = Math.round(duracaoTotalS / 60);

    const entregasOtimizadas: EntregaParaRota[] =
      waypointOrder.length > 0
        ? waypointOrder.map((idx: number) => entregasComEndereco[idx])
        : entregasComEndereco;

    const waypointsForUrl = entregasOtimizadas
      .map((e: EntregaParaRota) => encodeURIComponent([e.endereco, e.numero ? 'n' + String.fromCharCode(186) + ' ' + e.numero : '', e.cep].filter(Boolean).join(', ')))
      .join('|');

    const mapsUrl = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(DEPOSITO_ADDRESS) + '&destination=' + encodeURIComponent(DEPOSITO_ADDRESS) + '&waypoints=' + waypointsForUrl + '&travelmode=driving';

    return NextResponse.json({
      data: dataAlvo,
      total_entregas: entregasOtimizadas.length,
      distancia_total_km: distanciaTotalKm,
      duracao_total_min: duracaoTotalMin,
      rota_otimizada: entregasOtimizadas.map((e: EntregaParaRota, idx: number) => ({ parada: idx + 1, ...e })),
      maps_url: mapsUrl,
    });
  } catch (error) {
    console.error('Erro ao calcular rota de entregas:', error);
    return NextResponse.json({ error: 'Erro interno ao calcular rota de entregas' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs das entregas sao obrigatorios' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from('orcamentos').update({ status: 'em_rota' }).in('id', ids);
    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar status das entregas' }, { status: 500 });
    }
    return NextResponse.json({ success: true, mensagem: ids.length + ' entrega(s) marcada(s) como em rota' });
  } catch (error) {
    console.error('Erro ao marcar entregas em rota:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
