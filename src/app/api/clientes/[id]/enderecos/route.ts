import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { geocodeEnderecoAsync } from '@/lib/geocode';

export const dynamic = 'force-dynamic';

// Campos de endereco aceitos no corpo da requisicao
const CAMPOS_ENDERECO = [
  'apelido', 'cep', 'rua', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'observacoes',
] as const;

// GET /api/clientes/[id]/enderecos
// Lista os enderecos do cliente, com o padrao primeiro.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('*')
      .eq('cliente_id', params.id)
      .order('is_padrao', { ascending: false })
      .order('criado_em', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Erro ao listar enderecos' }, { status: 500 });
    }
    return NextResponse.json({ enderecos: data || [] });
  } catch (e) {
    console.error('Erro GET /api/clientes/[id]/enderecos', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST /api/clientes/[id]/enderecos
// Cria um endereco para o cliente.
// Body: { apelido?, cep?, rua?, numero?, complemento?, bairro?, cidade?, estado?, observacoes?, is_padrao? }
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Confirma que o cliente existe
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('id', params.id)
      .single();
    if (clienteErr || !cliente) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });
    }

    // O primeiro endereco do cliente vira o padrao automaticamente
    const { count } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('*', { count: 'exact', head: true })
      .eq('cliente_id', params.id);
    const isPadrao = (count || 0) === 0 || body.is_padrao === true;

    // So pode haver um endereco padrao por cliente (unique index uk_enderecos_clientes_padrao):
    // zera os demais antes de inserir o novo padrao.
    if (isPadrao) {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({ is_padrao: false })
        .eq('cliente_id', params.id)
        .eq('is_padrao', true);
    }

    const insert: Record<string, unknown> = { cliente_id: params.id, is_padrao: isPadrao };
    for (const campo of CAMPOS_ENDERECO) {
      if (body[campo] !== undefined) insert[campo] = body[campo];
    }

    const { data, error } = await supabaseAdmin
      .from('enderecos_clientes')
      .insert(insert)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'Erro ao criar endereco' }, { status: 500 });
    }
    // Geocoding em background — fire-and-forget, nao bloqueia a resposta
    void geocodeEnderecoAsync(data.id as string);
    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro POST /api/clientes/[id]/enderecos', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
