import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busca = searchParams.get('busca');
    const pagina = parseInt(searchParams.get('pagina') || '1');
    const limite = parseInt(searchParams.get('limite') || '20');
    const offset = (pagina - 1) * limite;

    let query = supabaseAdmin
      .from('clientes')
      .select('*', { count: 'exact' })
      .order('atualizado_em', { ascending: false })
      .range(offset, offset + limite - 1);

    if (busca) {
      query = query.or(
        `nome.ilike.%${busca}%,telefone.ilike.%${busca}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
    }

    return NextResponse.json({ clientes: data || [], total: count || 0, pagina, limite });
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nome, telefone, cep, endereco, bairro, cidade, estado } = body;

    if (!nome || !telefone) {
      return NextResponse.json(
        { error: 'Nome e telefone sao obrigatorios' },
        { status: 400 }
      );
    }

    const telefoneLimpo = telefone.replace(/\D/g, '');

    const { data, error } = await supabaseAdmin
      .from('clientes')
      .upsert(
        { nome, telefone: telefoneLimpo, cep, endereco, bairro, cidade, estado, atualizado_em: new Date().toISOString() },
        { onConflict: 'telefone' }
      )
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Erro ao salvar cliente' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}