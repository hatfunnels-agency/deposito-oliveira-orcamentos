import { NextResponse } from 'next/server';

// ============================================================
// TABELA DE FRETE POR DISTÂNCIA (facilmente configurável)
// ============================================================
const TABELA_FRETE = [
  { distanciaMaxKm: 5,  preco: 0 },      // Grátis até 5km
  { distanciaMaxKm: 10, preco: 50 },      // R$ 50 de 5-10km
  { distanciaMaxKm: 15, preco: 80 },      // R$ 80 de 10-15km
  { distanciaMaxKm: 20, preco: 120 },     // R$ 120 de 15-20km
  { distanciaMaxKm: 30, preco: 180 },     // R$ 180 de 20-30km
];
const DISTANCIA_MAXIMA_KM = 30;

// Coordenadas do Depósito Oliveira
// Av. Inocêncio Seráfico, 4020 - Centro, Carapicuíba - SP, 06380-021
const DEPOSITO_ORIGIN = '-23.5376,-46.8375';

// ============================================================

interface ViaCEPResponse {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

interface DistanceMatrixElement {
  distance: { value: number; text: string };
  duration: { value: number; text: string };
  status: string;
}

interface DistanceMatrixResponse {
  rows: Array<{ elements: DistanceMatrixElement[] }>;
  status: string;
  origin_addresses: string[];
  destination_addresses: string[];
}

function calcularPrecoFrete(distanciaKm: number): number | null {
  if (distanciaKm > DISTANCIA_MAXIMA_KM) return null;
  for (const faixa of TABELA_FRETE) {
    if (distanciaKm <= faixa.distanciaMaxKm) return faixa.preco;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cep } = body;

    if (!cep) {
      return NextResponse.json({ error: 'CEP é obrigatório' }, { status: 400 });
    }

    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      return NextResponse.json({ error: 'CEP inválido' }, { status: 400 });
    }

    // 1. Buscar endereço via ViaCEP
    const viaCepRes = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      cache: 'no-store',
    });
    const viaCepData: ViaCEPResponse = await viaCepRes.json();

    if (viaCepData.erro) {
      return NextResponse.json({ error: 'CEP não encontrado' }, { status: 404 });
    }

    const enderecoCompleto = `${viaCepData.logradouro}, ${viaCepData.bairro}, ${viaCepData.localidade} - ${viaCepData.uf}, ${cepLimpo}`;

    // 2. Chamar Google Maps Distance Matrix API
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Google Maps API key não configurada' }, { status: 500 });
    }

    const destinationEncoded = encodeURIComponent(enderecoCompleto);
    const distanceMatrixUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${DEPOSITO_ORIGIN}&destinations=${destinationEncoded}&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;

    const gmapsRes = await fetch(distanceMatrixUrl, { cache: 'no-store' });
    const gmapsData: DistanceMatrixResponse = await gmapsRes.json();

    if (gmapsData.status !== 'OK') {
      return NextResponse.json({ error: 'Erro ao calcular distância via Google Maps', details: gmapsData.status }, { status: 500 });
    }

    const element = gmapsData.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      return NextResponse.json({ error: 'Não foi possível calcular a rota para este endereço', details: element?.status }, { status: 400 });
    }

    const distanciaKm = Math.round((element.distance.value / 1000) * 10) / 10; // ex: 12.3
    const duracaoMin = Math.round(element.duration.value / 60); // ex: 25
    const frete = calcularPrecoFrete(distanciaKm);
    const dentroArea = frete !== null;

    if (!dentroArea) {
      return NextResponse.json({
        frete: null,
        distancia_km: distanciaKm,
        duracao_min: duracaoMin,
        endereco_completo: enderecoCompleto,
        dentro_area: false,
        mensagem: `Endereço fora da área de entrega (máximo ${DISTANCIA_MAXIMA_KM}km). Distância: ${distanciaKm}km`,
      });
    }

    return NextResponse.json({
      frete,
      distancia_km: distanciaKm,
      duracao_min: duracaoMin,
      endereco_completo: enderecoCompleto,
      dentro_area: true,
      mensagem: frete === 0 ? 'Frete grátis!' : `Frete: R$ ${frete.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Erro ao calcular frete:', error);
    return NextResponse.json({ error: 'Erro interno ao calcular frete' }, { status: 500 });
  }
}
