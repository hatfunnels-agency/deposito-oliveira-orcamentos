import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Tarefa 1 - Autocomplete de enderecos + detalhes via Google Places API
// type=autocomplete: sugestoes enquanto digita
// type=details&place_id=ChIJ...: detalhes completos do endereco
// sem type: geocoding direto (comportamento original)

interface GeocodingResult {
    formatted_address: string;
    address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
    geometry: { location: { lat: number; lng: number } };
}

export async function GET(request: NextRequest) {
    try {
          const { searchParams } = new URL(request.url);
          const query = searchParams.get('q');
          const type = searchParams.get('type');
          const placeId = searchParams.get('place_id');

      const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
          if (!GOOGLE_MAPS_API_KEY) {
                  return NextResponse.json({ error: 'Google Maps API key nao configurada' }, { status: 500 });
          }

      // Tarefa 1: Autocomplete de enderecos por nome de rua
      if (type === 'autocomplete' && query && query.trim().length >= 3) {
              const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:br&location=-23.5376,-46.8375&radius=30000&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;
              const res = await fetch(url, { cache: 'no-store' });
              const data = await res.json();

            if (data.status === 'REQUEST_DENIED') {
                      return NextResponse.json({ error: 'Places API nao habilitada. Habilite no Google Cloud Console.', sugestoes: [] }, { status: 503 });
            }

            const sugestoes = (data.predictions || []).map((p: { description: string; place_id: string; structured_formatting?: { main_text?: string; secondary_text?: string } }) => ({
                      descricao: p.description,
                      place_id: p.place_id,
                      texto_principal: p.structured_formatting?.main_text || '',
                      texto_secundario: p.structured_formatting?.secondary_text || '',
            }));

            return NextResponse.json({ suggestions: sugestoes, sugestoes });
      }

      // Tarefa 1: Detalhes de um lugar (apos selecionar sugestao)
      if (type === 'details' && placeId) {
              const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_address,address_components,geometry&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;
              const res = await fetch(url, { cache: 'no-store' });
              const data = await res.json();

            if (data.status !== 'OK' || !data.result) {
                      return NextResponse.json({ error: 'Lugar nao encontrado' }, { status: 404 });
            }

            return NextResponse.json(extrairComponentes(data.result));
      }

      // Comportamento original: geocoding direto
      if (!query || query.trim().length < 3) {
              return NextResponse.json({ error: 'Query deve ter pelo menos 3 caracteres' }, { status: 400 });
      }

      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=br&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;
          const res = await fetch(geocodeUrl, { cache: 'no-store' });
          const data = await res.json();

      if (data.status !== 'OK' || !data.results?.length) {
              return NextResponse.json({
                        error: data.status === 'ZERO_RESULTS' ? 'Endereco nao encontrado.' : `Erro: ${data.error_message || data.status}`,
              }, { status: 400 });
      }

      return NextResponse.json(extrairComponentes(data.results[0]));
    } catch (error) {
          console.error('Erro ao buscar endereco:', error);
          return NextResponse.json({ error: 'Erro interno ao buscar endereco' }, { status: 500 });
    }
}

function extrairComponentes(result: GeocodingResult) {
    let logradouro = '', bairro = '', cidade = '', estado = '', cep = '';

  for (const component of result.address_components) {
        if (component.types.includes('route')) logradouro = component.long_name;
        if (component.types.includes('sublocality_level_1') || component.types.includes('sublocality')) bairro = component.long_name;
        if (component.types.includes('administrative_area_level_2')) cidade = component.long_name;
        if (component.types.includes('administrative_area_level_1')) estado = component.short_name;
        if (component.types.includes('postal_code')) cep = component.long_name.replace(/\D/g, '');
  }

  return {
        endereco_completo: result.formatted_address,
        logradouro,
        bairro,
        cidade,
        estado,
        cep: cep || null,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formatted_address: result.formatted_address,
  };
}
