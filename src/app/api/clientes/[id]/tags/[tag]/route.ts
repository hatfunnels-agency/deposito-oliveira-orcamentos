import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// DELETE /api/clientes/[id]/tags/[tag]
// Remove uma tag especifica do cliente.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; tag: string }> }
) {
  try {
    const params = await ctx.params;
    // Decodifica o segmento da URL (tags com underscore: obra_ativa, em_negociacao...)
    const tag = decodeURIComponent(params.tag);

    const { data, error } = await supabaseAdmin
      .from('cliente_tags')
      .delete()
      .eq('cliente_id', params.id)
      .eq('tag', tag)
      .select('tag');

    if (error) {
      console.error('Erro DELETE /api/clientes/[id]/tags/[tag]', error);
      return NextResponse.json({ error: 'Erro ao remover tag' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Cliente não tem essa tag' }, { status: 404 });
    }

    // Remove a tag tambem no GHL (non-blocking) pra os workflows nao dispararem
    // por uma tag ja retirada no app.
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
      fetch(`${appUrl}/api/ghl/sync-cliente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: params.id, remover_tags: [tag] }),
        cache: 'no-store',
      }).catch(e => console.log('[GHL Sync Cliente] falha (nao bloqueante):', e));
    } catch (e) {
      console.log('[GHL Sync Cliente] falha (nao bloqueante):', e);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro DELETE /api/clientes/[id]/tags/[tag]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
