import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { informarSaldo, saldosAtuais, totalDisponivel } from '@/lib/financeiro/saldos';
import { ehData } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

async function montar() {
  const contas = await saldosAtuais();
  return { contas, total_disponivel: totalDisponivel(contas) };
}

// GET /api/financeiro/saldos -> { contas: SaldoConta[], total_disponivel }
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    return NextResponse.json(await montar());
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/saldos');
  }
}

// POST /api/financeiro/saldos { conta_id, data, saldo } -> saldos ja recalculados
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.conta_id) return NextResponse.json({ error: 'Escolha a conta.' }, { status: 400 });
    if (!ehData(body.data)) return NextResponse.json({ error: 'Data inválida (use AAAA-MM-DD).' }, { status: 400 });
    if (!Number.isFinite(Number(body.saldo))) return NextResponse.json({ error: 'Informe o saldo.' }, { status: 400 });
    await informarSaldo(String(body.conta_id), body.data, Number(body.saldo), usuario?.id ?? null);
    return NextResponse.json({ ok: true, ...(await montar()) }, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/saldos');
  }
}
