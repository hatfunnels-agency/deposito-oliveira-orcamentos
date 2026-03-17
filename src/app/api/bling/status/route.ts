export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { blingFetch, isBlingConfigured } from '@/lib/bling-auth';

export async function GET() {
  if (!isBlingConfigured()) {
    return NextResponse.json({
      connected: false,
      mode: 'DEMO',
      message: 'Bling nao configurado. Acesse /api/bling/auth para autorizar.',
      setup_url: '/api/bling/auth',
    });
  }

  try {
    // Usa blingFetch que tem retry automatico em 401
    const testRes = await blingFetch('/produtos?limite=1');

    if (!testRes.ok) {
      let errorBody = '';
      try { errorBody = await testRes.text(); } catch {}
      return NextResponse.json({
        connected: false,
        mode: 'DEMO',
        message: `Bling retornou erro ${testRes.status}: ${errorBody.substring(0, 200)}`,
        setup_url: '/api/bling/auth',
      });
    }

    return NextResponse.json({
      connected: true,
      mode: 'BLING',
      message: 'Bling conectado e funcionando',
      client_id: process.env.BLING_CLIENT_ID?.substring(0, 8) + '...',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({
      connected: false,
      mode: 'DEMO',
      message: `Erro ao conectar com Bling: ${message}`,
      setup_url: '/api/bling/auth',
    });
  }
}
