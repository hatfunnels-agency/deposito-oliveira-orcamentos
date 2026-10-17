import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { resumoMaquininhaMes } from '@/lib/financeiro/fechamento';
import { ehMes, mesSP } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

// GET /api/financeiro/maquininha?mes=AAAA-MM -> ResumoMaquininhaMes
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const param = request.nextUrl.searchParams.get('mes');
    if (param && !ehMes(param)) return NextResponse.json({ error: 'Mês inválido (use AAAA-MM).' }, { status: 400 });
    return NextResponse.json(await resumoMaquininhaMes(param || mesSP()));
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em GET /api/financeiro/maquininha:', e);
    return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
  }
}
