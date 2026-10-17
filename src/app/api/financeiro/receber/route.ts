import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { Papel, ReceberDoCliente } from '@/lib/financeiro/tipos';
import { receberDoCliente, receberPorCliente } from '@/lib/financeiro/receber';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

// Unica rota do /financeiro aberta a atendente: ela da baixa no que o
// cliente pagou, mas nao ve contas a pagar nem folha.
const PAPEIS = ['admin', 'atendente'];
const RECURSO = 'os clientes a receber';

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/receber?dias=30 -> ReceberPorCliente
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, PAPEIS, RECURSO);
  if (negado) return negado;
  try {
    const dias = Number(request.nextUrl.searchParams.get('dias')) || 30;
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) {
      return NextResponse.json({ error: 'Período em dias inválido.' }, { status: 400 });
    }
    return NextResponse.json(await receberPorCliente(dias));
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/receber');
  }
}

// POST /api/financeiro/receber  ReceberDoCliente -> { pagamentos, grupo_recebimento }
// data_pagamento so vale pra admin: atendente sempre registra "agora".
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, PAPEIS, RECURSO);
  if (negado || !usuario) return negado!;
  try {
    const body = (await request.json().catch(() => null)) as ReceberDoCliente | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
    if (!Number.isFinite(Number(body.valor))) return NextResponse.json({ error: 'Informe o valor recebido.' }, { status: 400 });
    const papel = usuario.papel as Papel;
    const resultado = await receberDoCliente({
      cliente_id: body.cliente_id ?? null,
      telefone: body.telefone ?? null,
      orcamento_id: body.orcamento_id ?? null,
      valor: Number(body.valor),
      metodo: body.metodo,
      parcelas: body.parcelas,
      data_pagamento: papel === 'admin' ? body.data_pagamento : undefined,
      observacoes: body.observacoes ?? null,
      usuarioId: usuario.id,
      papel,
    });
    return NextResponse.json(resultado, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/receber');
  }
}
