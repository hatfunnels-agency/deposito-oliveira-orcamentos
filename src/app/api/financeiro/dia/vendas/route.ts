import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { hojeSP } from '@/lib/financeiro/datas';
import { vendasDoDia } from '@/lib/financeiro/vendas-dia';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

// GET /api/financeiro/dia/vendas?data=AAAA-MM-DD -> VendasDoDia
// Pedidos fechados no dia + pagamentos registrados no dia, com o vinculo ao
// extrato, para conferir na mao.
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'as vendas do dia');
  if (negado) return negado;
  try {
    const d = request.nextUrl.searchParams.get('data') || '';
    return NextResponse.json(await vendasDoDia(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : hojeSP()));
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em GET /api/financeiro/dia/vendas:', e);
    return NextResponse.json({ error: e instanceof ErroFinanceiro ? e.message : 'Erro interno' }, { status });
  }
}
