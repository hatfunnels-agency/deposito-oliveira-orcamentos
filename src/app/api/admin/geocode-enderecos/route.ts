import { NextRequest, NextResponse } from 'next/server';
import { BATCH_PADRAO, processarBatchGeocode } from '@/lib/geocode-loop';

export const dynamic = 'force-dynamic';

// POST /api/admin/geocode-enderecos
// Header: x-admin-key. Body opcional: { batch?: number }.
// Loop em si vive em src/lib/geocode-loop.ts (compartilhado com o
// cron /api/cron/geocode-enderecos).
export async function POST(request: NextRequest) {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return NextResponse.json(
        { error: 'ADMIN_API_KEY nao configurada no servidor' },
        { status: 500 },
      );
    }
    if (request.headers.get('x-admin-key') !== adminKey) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    let batch = BATCH_PADRAO;
    try {
      const body = await request.json();
      if (body && typeof body.batch === 'number' && Number.isFinite(body.batch)) {
        batch = Math.floor(body.batch);
      }
    } catch {
      /* sem body — usa o padrao */
    }

    const resumo = await processarBatchGeocode({ batchSize: batch });
    console.log('[geocode-backfill]', JSON.stringify(resumo));
    return NextResponse.json(resumo);
  } catch (e) {
    console.error('[geocode-backfill] erro interno', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
