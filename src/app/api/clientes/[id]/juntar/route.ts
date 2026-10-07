import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// POST /api/clientes/[id]/juntar  { origem_id }
// Junta o cadastro `origem_id` neste (o [id] fica). Pedidos, enderecos, tags,
// tarefas e historico de mensagens passam pra ca; o telefone do outro vira
// "outro telefone" deste; o outro cadastro e apagado. Tudo na funcao
// juntar_clientes do banco (supabase-telefones-extras.sql), numa transacao.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const origem = String(body?.origem_id || '');
    if (!origem || origem === id) {
      return NextResponse.json({ error: 'Informe o outro cadastro (origem_id)' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.rpc('juntar_clientes', { origem, destino: id });
    if (error) {
      console.error('Erro ao juntar clientes', error);
      return NextResponse.json({ error: 'Não foi possível juntar os cadastros' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro POST /api/clientes/[id]/juntar', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
