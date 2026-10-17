import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { diaGestao } from '@/lib/financeiro/dia';
import { ehData, hojeSP } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

// GET /api/financeiro/dia-gestao?data=AAAA-MM-DD — o Dia com taxas, pago e
// liquido (DiaFinanceiro). A rota antiga /dia continua so com a base.
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const param = request.nextUrl.searchParams.get('data');
    if (param && !ehData(param)) {
      return NextResponse.json({ error: 'Data inválida (use AAAA-MM-DD).' }, { status: 400 });
    }
    return NextResponse.json(await diaGestao(param || hojeSP()));
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em GET /api/financeiro/dia-gestao:', e);
    return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
  }
}
