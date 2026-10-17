import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { lerMetas, salvarMetas } from '@/lib/financeiro/metas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';
import type { MetasFinanceiras } from '@/lib/financeiro/tipos';

export const dynamic = 'force-dynamic';

// GET /api/financeiro/metas -> MetasFinanceiras
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'as metas');
  if (negado) return negado;
  try {
    return NextResponse.json(await lerMetas());
  } catch (e) {
    console.error('Erro em GET /api/financeiro/metas:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT /api/financeiro/metas  { faturamento_mes?, ticket_medio?, margem_pct? } (null/vazio = sem meta)
export async function PUT(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'as metas');
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as Partial<MetasFinanceiras> | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
    return NextResponse.json(await salvarMetas(body, usuario?.id ?? null));
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em PUT /api/financeiro/metas:', e);
    return NextResponse.json({ error: e instanceof ErroFinanceiro ? e.message : 'Erro interno' }, { status });
  }
}
