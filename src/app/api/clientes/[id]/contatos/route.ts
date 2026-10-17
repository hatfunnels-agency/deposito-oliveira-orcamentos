import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listarContatos, registrarContato, type CanalContato } from '@/lib/contatos';

export const dynamic = 'force-dynamic';

const CANAIS: CanalContato[] = ['whatsapp', 'ligacao', 'loja', 'visita', 'outro'];

// GET /api/clientes/[id]/contatos?limite=20 -> { contatos, notas_contexto } (contatos do mais recente)
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const limite = Number(request.nextUrl.searchParams.get('limite') || 20);
    const [contatos, { data: cli }] = await Promise.all([
      listarContatos(id, Number.isFinite(limite) ? limite : 20),
      supabaseAdmin.from('clientes').select('notas_contexto').eq('id', id).maybeSingle(),
    ]);
    return NextResponse.json({ contatos, notas_contexto: cli?.notas_contexto ?? null });
  } catch (e) {
    console.error('Erro GET /api/clientes/[id]/contatos', e);
    return NextResponse.json({ error: 'Erro ao listar contatos' }, { status: 500 });
  }
}

// POST /api/clientes/[id]/contatos { resumo, canal?, data?, usuario_id? } -> contato manual da atendente
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { resumo?: string; canal?: string; data?: string; usuario_id?: string } | null;
    const resumo = String(body?.resumo ?? '').trim();
    if (!resumo) return NextResponse.json({ error: 'Escreva do que foi o contato.' }, { status: 400 });
    if (resumo.length > 500) return NextResponse.json({ error: 'Resumo muito longo (máx. 500 caracteres).' }, { status: 400 });
    const canal = CANAIS.includes(body?.canal as CanalContato) ? (body!.canal as CanalContato) : 'whatsapp';
    const data = body?.data && !Number.isNaN(Date.parse(body.data)) ? new Date(body.data).toISOString() : undefined;
    await registrarContato({ clienteId: id, origem: 'atendente', canal, resumo, data, usuarioId: body?.usuario_id ?? null });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error('Erro POST /api/clientes/[id]/contatos', e);
    return NextResponse.json({ error: 'Erro ao registrar contato' }, { status: 500 });
  }
}
