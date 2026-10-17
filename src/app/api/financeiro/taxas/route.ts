import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { TaxaMaquininhaEntrada } from '@/lib/financeiro/tipos';
import { carregarTaxas, salvarTaxas } from '@/lib/financeiro/taxas';
import { ehData } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/taxas -> { taxas } (vigentes e passadas)
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    return NextResponse.json({ taxas: await carregarTaxas() });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/taxas');
  }
}

// PUT /api/financeiro/taxas { taxas: TaxaMaquininhaEntrada[], vigencia_inicio } -> { taxas }
// Versiona: a tabela antiga fecha na vespera, nunca e sobrescrita.
export async function PUT(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.taxas)) return NextResponse.json({ error: 'Envie a lista de taxas.' }, { status: 400 });
    if (!ehData(body.vigencia_inicio)) return NextResponse.json({ error: 'Informe a data de início da vigência (AAAA-MM-DD).' }, { status: 400 });
    const taxas = await salvarTaxas(body.taxas as TaxaMaquininhaEntrada[], body.vigencia_inicio, usuario?.id ?? null);
    return NextResponse.json({ taxas });
  } catch (e) {
    return responderErro(e, 'PUT /api/financeiro/taxas');
  }
}
