import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { FiltroContasPagar, NovaContaPagar, StatusContaPagar } from '@/lib/financeiro/tipos';
import {
  atualizarContaPagar,
  criarContaPagar,
  excluirConta,
  listarContasPagar,
  resumoContasPagar,
} from '@/lib/financeiro/contas-pagar';
import { folhaPrevista } from '@/lib/financeiro/despesas-fixas';
import { ehData, ehMes, hojeSP } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const STATUS: Array<StatusContaPagar | 'todas'> = ['pendente', 'pago', 'cancelado', 'todas'];
const RECURSO = 'as contas a pagar';

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/contas-pagar?status=&de=&ate=&competencia=&fornecedor_id=&categoria_id=&busca=&confirmar=1
//   -> { contas, resumo, folha_prevista }
// A folha vem junto so pra leitura: salario se paga em Funcionarios.
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    const f: FiltroContasPagar = {};
    const status = sp.get('status');
    if (status) {
      if (!STATUS.includes(status as StatusContaPagar)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
      f.status = status as FiltroContasPagar['status'];
    }
    for (const k of ['de', 'ate'] as const) {
      const v = sp.get(k);
      if (v) {
        if (!ehData(v)) return NextResponse.json({ error: `Data inválida em "${k}" (use AAAA-MM-DD).` }, { status: 400 });
        f[k] = v;
      }
    }
    const competencia = sp.get('competencia');
    if (competencia) {
      if (!ehMes(competencia)) return NextResponse.json({ error: 'Competência inválida (use AAAA-MM).' }, { status: 400 });
      f.competencia = competencia;
    }
    if (sp.get('fornecedor_id')) f.fornecedor_id = sp.get('fornecedor_id')!;
    if (sp.get('categoria_id')) f.categoria_id = sp.get('categoria_id')!;
    if (sp.get('busca')) f.busca = sp.get('busca')!.trim();
    if (['1', 'true'].includes(sp.get('confirmar') || '')) f.confirmar = true;

    const [contas, resumo, folha] = await Promise.all([listarContasPagar(f), resumoContasPagar(), folhaPrevista()]);
    return NextResponse.json({ contas, resumo, folha_prevista: folha.proximos });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/contas-pagar');
  }
}

// POST /api/financeiro/contas-pagar  NovaContaPagar -> { contas } (201)
// Com parcelas > 1 a lib cria N contas; `valor` e o de CADA parcela.
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as NovaContaPagar | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
    if (!String(body.descricao ?? '').trim()) return NextResponse.json({ error: 'Descreva a conta.' }, { status: 400 });
    if (!Number.isFinite(Number(body.valor)) || Number(body.valor) <= 0) return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 });
    if (!ehData(body.vencimento)) return NextResponse.json({ error: 'Vencimento inválido (use AAAA-MM-DD).' }, { status: 400 });
    if (body.competencia && !ehMes(body.competencia) && !ehData(body.competencia)) {
      return NextResponse.json({ error: 'Competência inválida (use AAAA-MM).' }, { status: 400 });
    }
    if (body.parcelas != null && (!Number.isInteger(Number(body.parcelas)) || Number(body.parcelas) < 1 || Number(body.parcelas) > 120)) {
      return NextResponse.json({ error: 'Número de parcelas inválido.' }, { status: 400 });
    }
    if (body.pagamento && body.pagamento.data_pagamento && !ehData(body.pagamento.data_pagamento)) {
      return NextResponse.json({ error: 'Data de pagamento inválida (use AAAA-MM-DD).' }, { status: 400 });
    }
    // Pagamento nasce de algo que ja aconteceu: data futura nao entra.
    if (body.pagamento?.data_pagamento && body.pagamento.data_pagamento > hojeSP()) {
      return NextResponse.json({ error: 'Não dá para lançar pagamento em data futura.' }, { status: 400 });
    }
    const contas = await criarContaPagar({ ...body, valor: Number(body.valor) }, usuario?.id ?? null);
    return NextResponse.json({ contas }, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/contas-pagar');
  }
}

// PATCH /api/financeiro/contas-pagar { id, ...Partial<NovaContaPagar> } -> ContaPagar
export async function PATCH(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) return NextResponse.json({ error: 'Informe o id da conta.' }, { status: 400 });
    const { id, ...dados } = body as { id: string } & Partial<NovaContaPagar>;
    if (dados.valor !== undefined && (!Number.isFinite(Number(dados.valor)) || Number(dados.valor) <= 0)) {
      return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 });
    }
    if (dados.vencimento !== undefined && !ehData(dados.vencimento)) {
      return NextResponse.json({ error: 'Vencimento inválido (use AAAA-MM-DD).' }, { status: 400 });
    }
    if (dados.competencia && !ehMes(dados.competencia) && !ehData(dados.competencia)) {
      return NextResponse.json({ error: 'Competência inválida (use AAAA-MM).' }, { status: 400 });
    }
    if (dados.valor !== undefined) dados.valor = Number(dados.valor);
    return NextResponse.json(await atualizarContaPagar(String(id), dados, usuario?.id ?? null));
  } catch (e) {
    return responderErro(e, 'PATCH /api/financeiro/contas-pagar');
  }
}

// DELETE /api/financeiro/contas-pagar?id= — so pendente/cancelada sem lancamento.
// Conta paga nao se apaga: estorna (acoes).
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Informe o id da conta.' }, { status: 400 });
    await excluirConta(id, usuario?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return responderErro(e, 'DELETE /api/financeiro/contas-pagar');
  }
}
