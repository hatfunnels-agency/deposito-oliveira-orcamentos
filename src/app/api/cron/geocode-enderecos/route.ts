import { NextRequest, NextResponse } from 'next/server';
import { processarBatchGeocode } from '@/lib/geocode-loop';

export const dynamic = 'force-dynamic';

// GET /api/cron/geocode-enderecos
// Vercel cron — schedule em vercel.json. Auth via Bearer CRON_SECRET
// (Vercel injeta automaticamente esse header em invocations internas
// do cron quando CRON_SECRET esta no env do projeto).
// Separado do admin (x-admin-key / ADMIN_API_KEY) pra rotacao
// independente. Batch fixo em 50.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET nao configurada no servidor' },
      { status: 500 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const resumo = await processarBatchGeocode({ batchSize: 50 });
    const payload = {
      ok: true,
      timestamp: new Date().toISOString(),
      ...resumo,
    };
    console.log('[cron geocode-enderecos]', JSON.stringify(payload));
    return NextResponse.json(payload);
  } catch (e) {
    console.error('[cron geocode-enderecos] erro interno', e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message || 'Erro interno' },
      { status: 500 },
    );
  }
}
