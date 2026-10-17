import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { fechamentoMensal } from '@/lib/financeiro/fechamento';
import { ehMes, mesSP } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';
// Le muitas tabelas (banco em us-west-2, funcao em gru1): folga acima de 60s.
export const maxDuration = 300;

// GET /api/financeiro/fechamento?mes=AAAA-MM -> FechamentoMensal
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const param = request.nextUrl.searchParams.get('mes');
    if (param && !ehMes(param)) return NextResponse.json({ error: 'Mês inválido (use AAAA-MM).' }, { status: 400 });
    return NextResponse.json(await fechamentoMensal(param || mesSP()));
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em GET /api/financeiro/fechamento:', e);
    return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
  }
}
