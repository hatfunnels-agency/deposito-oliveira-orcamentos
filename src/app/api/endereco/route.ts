import { NextRequest, NextResponse } from 'next/server';

// Feature 7 - Address search by street name using Google Geocoding API

interface GeocodingResult {
  formatted_address: string;
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

interface GeocodingResponse {
  results: GeocodingResult[];
  status: string;
  error_message?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length < 3) {
      return NextResponse.json(
        { error: 'Query deve ter pelo menos 3 caracteres' },
        { status: 400 }
      );
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json(
        { error: 'Google Maps API key não configurada' },
        { status: 500 }
      );
    }

    // Call Google Geocoding API
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=br&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;
    
    const res = await fetch(geocodeUrl, { cache: 'no-store' });
    const data: GeocodingResponse = await res.json();

    if (data.status !== 'OK' || data.results.length === 0) {
      return NextResponse.json({
        error: data.status === 'ZERO_RESULTS' 
          ? 'Endereço não encontrado. Tente ser mais específico.'
          : `Erro na busca: ${data.error_message || data.status}`,
      }, { status: 400 });
    }

    const result = data.results[0];
    
    // Extract address components
    let logradouro = '';
    let bairro = '';
    let cidade = '';
    let estado = '';
    let cep = '';

    for (const component of result.address_components) {
      if (component.types.includes('route')) {
        logradouro = component.long_name;
      }
      if (component.types.includes('sublocality_level_1') || component.types.includes('sublocality')) {
        bairro = component.long_name;
      }
      if (component.types.includes('administrative_area_level_2')) {
        cidade = component.long_name;
      }
      if (component.types.includes('administrative_area_level_1')) {
        estado = component.short_name;
      }
      if (component.types.includes('postal_code')) {
        cep = component.long_name.replace(/\D/g, '');
      }
    }

    const enderecoCompleto = [logradouro, bairro, cidade ? `${cidade}-${estado}` : ''].filter(Boolean).join(', ');

    return NextResponse.json({
      endereco_completo: enderecoCompleto || result.formatted_address,
      logradouro,
      bairro,
      cidade,
      estado,
      cep: cep || null,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
    });
  } catch (error) {
    console.error('Erro ao buscar endereço:', error);
    return NextResponse.json(
      { error: 'Erro interno ao buscar endereço' },
      { status: 500 }
    );
  }
}
