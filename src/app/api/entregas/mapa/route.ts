import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STATUS_ENTREGA = [
  'aguardando', 'confirmado', 'entrega_pendente', 'entrega_parcial', 'em_rota', 'completo',
];

// Data de hoje no fuso de Sao Paulo, formato YYYY-MM-DD.
function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// GET /api/entregas/mapa?data=YYYY-MM-DD
// Entregas do dia com lat/lng do endereco PADRAO do cliente, para o mapa.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const data = searchParams.get('data') || hojeSaoPaulo();

    const { data: rows, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, status, total, data_entrega, leva_id, observacoes,
        clientes!inner (
          id, nome, telefone,
          enderecos_clientes!inner (
            id, rua, numero, complemento, bairro, cidade, lat, lng, geocode_status, is_padrao
          )
        ),
        orcamento_itens ( produto_nome, quantidade, quantidade_entregue, unidade )
      `)
      .eq('tipo_entrega', 'entrega')
      .in('status', STATUS_ENTREGA)
      .eq('data_entrega', data)
      .eq('clientes.enderecos_clientes.is_padrao', true);

    if (error) {
      console.error('Erro GET /api/entregas/mapa', error);
      return NextResponse.json({ error: 'Erro ao buscar entregas' }, { status: 500 });
    }

    let excluidosSemCoords = 0;
    const entregas: unknown[] = [];

    for (const o of (rows || []) as Array<Record<string, unknown>>) {
      // clientes!inner -> objeto (to-one); enderecos_clientes!inner -> array
      const clienteRaw = o.clientes;
      const cliente = (Array.isArray(clienteRaw) ? clienteRaw[0] : clienteRaw) as
        | Record<string, unknown>
        | null;
      if (!cliente) {
        excluidosSemCoords++;
        continue;
      }
      const ends = cliente.enderecos_clientes;
      const end = (Array.isArray(ends) ? ends[0] : ends) as Record<string, unknown> | null;

      const lat = end?.lat;
      const lng = end?.lng;
      const temCoordenadas =
        !!end && lat !== null && lat !== undefined && lng !== null && lng !== undefined;
      if (!temCoordenadas) {
        excluidosSemCoords++;
        continue;
      }

      entregas.push({
        id: o.id,
        codigo: o.codigo,
        status: o.status,
        total: Number(o.total) || 0,
        leva_id: o.leva_id ?? null,
        observacoes: o.observacoes ?? null,
        cliente: {
          id: cliente.id,
          nome: cliente.nome,
          telefone: cliente.telefone,
        },
        endereco: {
          rua: end!.rua ?? null,
          numero: end!.numero ?? null,
          complemento: end!.complemento ?? null,
          bairro: end!.bairro ?? null,
          cidade: end!.cidade ?? null,
          lat: Number(lat),
          lng: Number(lng),
        },
        itens: (o.orcamento_itens as unknown[]) || [],
      });
    }

    return NextResponse.json({
      data,
      total: entregas.length,
      excluidos_sem_coords: excluidosSemCoords,
      entregas,
    });
  } catch (e) {
    console.error('Erro GET /api/entregas/mapa', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
