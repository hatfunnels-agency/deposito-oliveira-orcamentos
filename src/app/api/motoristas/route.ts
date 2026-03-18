import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .select('id, nome, telefone, veiculo, ativo')
      .eq('ativo', true)
      .order('nome');

    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar motoristas' }, { status: 500 });
    }

    return NextResponse.json({ motoristas: data || [] });
  } catch (e) {
    console.error('Erro em /api/motoristas:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nome, telefone, veiculo } = body;

    if (!nome) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .insert({ nome, telefone: telefone || null, veiculo: veiculo || null })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error('Erro ao criar motorista:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, nome, telefone, veiculo, ativo } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID é obrigatório' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (nome !== undefined) updateData.nome = nome;
    if (telefone !== undefined) updateData.telefone = telefone;
    if (veiculo !== undefined) updateData.veiculo = veiculo;
    if (ativo !== undefined) updateData.ativo = ativo;

    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro ao atualizar motorista:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
