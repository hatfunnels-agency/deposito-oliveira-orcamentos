import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import { invalidarContextoAssistente } from '@/lib/assistente-tecnico';

export const dynamic = 'force-dynamic';

const RECURSO = 'a base de conhecimento';

function limpar(body: Record<string, unknown>) {
  const pergunta = String(body.pergunta ?? '').trim().slice(0, 300);
  const resposta = String(body.resposta ?? '').trim().slice(0, 3000);
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : String(body.tags ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  return { pergunta, resposta, tags };
}

// GET /api/base-conhecimento -> { itens } (admin)
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  const { data, error } = await supabaseAdmin.from('base_conhecimento')
    .select('id, pergunta, resposta, tags, origem, ativo, atualizado_em').order('criado_em');
  if (error) return NextResponse.json({ error: 'Erro ao listar' }, { status: 500 });
  return NextResponse.json({ itens: data ?? [] });
}

// POST { pergunta, resposta, tags } -> item (admin)
export async function POST(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { pergunta, resposta, tags } = limpar(body ?? {});
  if (!pergunta || !resposta) return NextResponse.json({ error: 'Informe a pergunta e a resposta.' }, { status: 400 });
  const { data, error } = await supabaseAdmin.from('base_conhecimento')
    .insert({ pergunta, resposta, tags, origem: 'manual' }).select('id, pergunta, resposta, tags, origem, ativo, atualizado_em').single();
  if (error) return NextResponse.json({ error: 'Erro ao salvar' }, { status: 500 });
  invalidarContextoAssistente();
  return NextResponse.json({ item: data }, { status: 201 });
}

// PATCH { id, pergunta?, resposta?, tags?, ativo? } (admin)
export async function PATCH(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.id) return NextResponse.json({ error: 'Informe o id.' }, { status: 400 });
  const update: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  const { pergunta, resposta, tags } = limpar(body);
  if ('pergunta' in body) { if (!pergunta) return NextResponse.json({ error: 'Pergunta vazia.' }, { status: 400 }); update.pergunta = pergunta; }
  if ('resposta' in body) { if (!resposta) return NextResponse.json({ error: 'Resposta vazia.' }, { status: 400 }); update.resposta = resposta; }
  if ('tags' in body) update.tags = tags;
  if (typeof body.ativo === 'boolean') update.ativo = body.ativo;
  const { error } = await supabaseAdmin.from('base_conhecimento').update(update).eq('id', String(body.id));
  if (error) return NextResponse.json({ error: 'Erro ao salvar' }, { status: 500 });
  invalidarContextoAssistente();
  return NextResponse.json({ ok: true });
}

// DELETE ?id= (admin)
export async function DELETE(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Informe o id.' }, { status: 400 });
  const { error } = await supabaseAdmin.from('base_conhecimento').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Erro ao apagar' }, { status: 500 });
  invalidarContextoAssistente();
  return NextResponse.json({ ok: true });
}
