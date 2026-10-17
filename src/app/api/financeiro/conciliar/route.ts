import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { VinculoManual } from '@/lib/financeiro/tipos';
import { buscarPedidosParaVincular, conciliar, desvincular, vincular, vincularPedido } from '@/lib/financeiro/conciliacao';
import { ehData, hojeSP, somarDias } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RECURSO = 'a conciliação';
const DIAS_PADRAO = 7;
const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

/** Periodo validado; sem `de`/`ate`, os ultimos 7 dias (o padrao da tela). */
function periodo(de: unknown, ate: unknown): { de: string; ate: string } | { erro: string } {
  const hoje = hojeSP();
  const fim = ate ? String(ate) : hoje;
  const inicio = de ? String(de) : somarDias(fim, -DIAS_PADRAO);
  if (!ehData(inicio) || !ehData(fim)) return { erro: 'Período inválido (use AAAA-MM-DD em de/ate).' };
  if (inicio > fim) return { erro: 'A data inicial é maior que a final.' };
  return { de: inicio, ate: fim };
}

// GET /api/financeiro/conciliar?conta_id=&de=&ate= -> ResultadoConciliacao (previa, nada gravado)
export async function GET(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    // ?buscar_pedido=<codigo|cliente|valor>&valor=<valor da linha> -> { pedidos }
    const busca = sp.get('buscar_pedido');
    if (busca !== null) {
      const v = Number(sp.get('valor'));
      return NextResponse.json({ pedidos: await buscarPedidosParaVincular(busca, Number.isFinite(v) && v > 0 ? v : null) });
    }
    const conta_id = sp.get('conta_id');
    if (!conta_id) return erro400('Escolha a conta.');
    const p = periodo(sp.get('de'), sp.get('ate'));
    if ('erro' in p) return erro400(p.erro);
    return NextResponse.json(await conciliar({ conta_id, de: p.de, ate: p.ate, aplicar: false, usuarioId: usuario?.id ?? null }));
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/conciliar');
  }
}

// POST /api/financeiro/conciliar
//   { acao:'auto', conta_id, de, ate }                       -> ResultadoConciliacao (grava os pares de confianca alta)
//   { acao:'vincular', lancamento_id, pagamento_id? | conta_pagar_id? | funcionario_pagamento_id? | funcionario_vale_id? } -> VinculoAplicado
//   { acao:'desvincular', lancamento_id }                    -> { ok }
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  const usuarioId = usuario?.id ?? null;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    const acao = String(body.acao ?? '');

    if (acao === 'auto') {
      if (!body.conta_id) return erro400('Escolha a conta.');
      const p = periodo(body.de, body.ate);
      if ('erro' in p) return erro400(p.erro);
      return NextResponse.json(await conciliar({ conta_id: String(body.conta_id), de: p.de, ate: p.ate, aplicar: true, usuarioId }));
    }

    if (acao === 'vincular') {
      if (!body.lancamento_id) return erro400('Informe a linha do extrato (lancamento_id).');
      const alvos = ['pagamento_id', 'conta_pagar_id', 'funcionario_pagamento_id', 'funcionario_vale_id'] as const;
      const informados = alvos.filter(k => body[k]);
      if (informados.length !== 1) return erro400('Informe exatamente um alvo: pagamento, conta a pagar, pagamento de funcionário ou vale.');
      const v: VinculoManual = { lancamento_id: String(body.lancamento_id), [informados[0]]: String(body[informados[0]]) };
      return NextResponse.json(await vincular(v, usuarioId));
    }

    // { acao:'vincular_pedido', lancamento_id, orcamento_id } -> ResultadoVinculoPedido
    if (acao === 'vincular_pedido') {
      if (!body.lancamento_id || !body.orcamento_id) return erro400('Informe a linha do extrato e o pedido.');
      return NextResponse.json(await vincularPedido(String(body.lancamento_id), String(body.orcamento_id), usuarioId));
    }

    if (acao === 'desvincular') {
      if (!body.lancamento_id) return erro400('Informe a linha do extrato (lancamento_id).');
      await desvincular(String(body.lancamento_id), usuarioId);
      return NextResponse.json({ ok: true });
    }

    return erro400('Ação desconhecida.');
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/conciliar');
  }
}
