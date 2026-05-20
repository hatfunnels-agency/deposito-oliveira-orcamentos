import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { TAGS_VALIDAS, isTagValida, filtrarTagsObraAtiva } from '@/lib/tags';
import { buscarUltimaCompra } from '@/lib/cliente-tags-server';

export const dynamic = 'force-dynamic';

// GET /api/clientes/[id]/tags
// Lista as tags do cliente (mais recentes primeiro).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('cliente_tags')
      .select('tag, data_aplicacao, origem')
      .eq('cliente_id', params.id)
      .order('data_aplicacao', { ascending: false });

    if (error) {
      console.error('Erro GET /api/clientes/[id]/tags', error);
      return NextResponse.json({ error: 'Erro ao listar tags' }, { status: 500 });
    }

    // Compute-on-read: obra_ativa so aparece se a ultima compra foi ha <= 30 dias
    const ultimaCompra = await buscarUltimaCompra(params.id);
    const tags = filtrarTagsObraAtiva(data || [], ultimaCompra);

    return NextResponse.json({ tags });
  } catch (e) {
    console.error('Erro GET /api/clientes/[id]/tags', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST /api/clientes/[id]/tags
// Body: { tag: string, origem?: 'manual' | 'auto' }
// Aplica uma tag da taxonomia fixa ao cliente.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as { tag?: unknown; origem?: unknown };
    const tag = body.tag;

    // Valida a taxonomia ANTES de qualquer chamada ao Supabase
    if (!isTagValida(tag)) {
      return NextResponse.json(
        {
          error: 'Tag inválida',
          tag_recebida: tag ?? null,
          tags_validas: TAGS_VALIDAS,
        },
        { status: 400 },
      );
    }

    // origem 'manual' por padrao; 'auto' so quando o caller for o sistema
    const origem: 'manual' | 'auto' = body.origem === 'auto' ? 'auto' : 'manual';

    const { data, error } = await supabaseAdmin
      .from('cliente_tags')
      .insert({ cliente_id: params.id, tag, origem })
      .select('tag, data_aplicacao, origem')
      .single();

    if (error) {
      // Trata os erros conhecidos do Postgres sem vazar a mensagem crua
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Cliente já tem essa tag' }, { status: 409 });
      }
      if (error.code === '23503') {
        return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
      }
      if (error.code === '23514') {
        // CHECK chk_tag_valida — defensivo; a validacao acima ja deveria barrar
        return NextResponse.json(
          { error: 'Tag inválida', tag_recebida: tag, tags_validas: TAGS_VALIDAS },
          { status: 400 },
        );
      }
      console.error('Erro POST /api/clientes/[id]/tags', error);
      return NextResponse.json({ error: 'Erro ao adicionar tag' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro POST /api/clientes/[id]/tags', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
