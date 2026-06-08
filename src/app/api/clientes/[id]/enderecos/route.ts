import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { criarEnderecoCliente } from '@/lib/enderecos';

export const dynamic = 'force-dynamic';

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
// Cria um endereco para o cliente — delega pro helper compartilhado
// src/lib/enderecos.ts (mesma rotina usada pelo POST /api/orcamentos
// quando body.endereco_novo e passado).
// Body: { apelido?, cep?, rua?, numero?, complemento?, bairro?, cidade?, estado?, observacoes?, is_padrao? }
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const r = await criarEnderecoCliente(params.id, body);
    if (!r.ok) {
      if (r.reason === 'cliente_nao_encontrado') {
        return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Erro ao criar endereco' }, { status: 500 });
    }
    return NextResponse.json(r.endereco);
  } catch (e) {
    console.error('Erro POST /api/clientes/[id]/enderecos', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
