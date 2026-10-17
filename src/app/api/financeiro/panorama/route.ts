import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { panorama } from '@/lib/financeiro/panorama';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/financeiro/panorama — primeira tela do /financeiro (Panorama).
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    return NextResponse.json(await panorama());
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em GET /api/financeiro/panorama:', e);
    return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
  }
}
