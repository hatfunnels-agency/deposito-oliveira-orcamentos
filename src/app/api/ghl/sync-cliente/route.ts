import { NextResponse } from 'next/server';
import { sincronizarClienteGHL } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

// POST /api/ghl/sync-cliente
// Body: { cliente_id: string, remover_tags?: string[] }
// Espelha contexto (notas_contexto), data de follow-up e tags do cliente pro
// contato no GHL. Disparado non-blocking pelas rotas de cliente/tags. Non-
// blocking por natureza: qualquer falha e apenas logada, nunca quebra o caller.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clienteId = body?.cliente_id;
    if (!clienteId) {
      return NextResponse.json({ error: 'cliente_id required' }, { status: 400 });
    }
    const removerTags = Array.isArray(body?.remover_tags) ? body.remover_tags : undefined;
    const res = await sincronizarClienteGHL(clienteId, { removerTags });
    return NextResponse.json(res);
  } catch (e) {
    console.log('[GHL Sync Cliente] erro (nao bloqueante):', e);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
