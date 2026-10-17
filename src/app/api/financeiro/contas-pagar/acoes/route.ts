import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { PagamentoConta } from '@/lib/financeiro/tipos';
import {
  METODOS,
  cancelarConta,
  confirmarRetroativa,
  estornarPagamento,
  gerarFaturaCartao,
  pagarConta,
} from '@/lib/financeiro/contas-pagar';
import { gerarContasDoMes } from '@/lib/financeiro/despesas-fixas';
import { ehData, ehMes, hojeSP } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

// POST /api/financeiro/contas-pagar/acoes
//   { acao:'pagar', id, pagamento: PagamentoConta }       -> ContaPagar
//   { acao:'estornar', id, motivo? }                      -> ContaPagar
//   { acao:'cancelar', id, escopo?: 'esta'|'esta_e_seguintes' } -> { ok }
//   { acao:'confirmar', id, ja_pagou: boolean, data? }    -> ContaPagar
//   { acao:'gerar_mes', mes }                             -> GeracaoMes
//   { acao:'gerar_fatura', conta_id, mes }                -> ContaPagar | null
// Tudo que muda dinheiro passa por aqui (nunca por PATCH/DELETE), pra trilha
// de eventos ficar completa.
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'as contas a pagar');
  if (negado) return negado;
  const usuarioId = usuario?.id ?? null;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    const acao = String(body.acao ?? '');

    if (acao === 'gerar_mes') {
      if (!ehMes(body.mes)) return erro400('Mês inválido (use AAAA-MM).');
      return NextResponse.json(await gerarContasDoMes(body.mes, usuarioId));
    }

    if (acao === 'gerar_fatura') {
      if (!body.conta_id) return erro400('Escolha a conta do cartão.');
      if (!ehMes(body.mes)) return erro400('Mês inválido (use AAAA-MM).');
      return NextResponse.json(await gerarFaturaCartao(String(body.conta_id), body.mes, usuarioId));
    }

    const id = String(body.id ?? '');
    if (!id) return erro400('Informe o id da conta.');

    if (acao === 'pagar') {
      const pg = (body.pagamento ?? {}) as PagamentoConta;
      if (!METODOS.includes(pg.metodo_pagamento)) return erro400('Método de pagamento inválido.');
      if (pg.data_pagamento !== undefined && !ehData(pg.data_pagamento)) return erro400('Data de pagamento inválida (use AAAA-MM-DD).');
      if (pg.data_pagamento !== undefined && pg.data_pagamento > hojeSP()) return erro400('Não dá para lançar pagamento em data futura.');
      if (pg.valor_pago !== undefined && (!Number.isFinite(Number(pg.valor_pago)) || Number(pg.valor_pago) <= 0)) return erro400('Valor pago inválido.');
      const dados: PagamentoConta = {
        metodo_pagamento: pg.metodo_pagamento,
        conta_id: pg.conta_id ?? null,
        observacoes: pg.observacoes ?? null,
        ...(pg.data_pagamento !== undefined ? { data_pagamento: pg.data_pagamento } : {}),
        ...(pg.valor_pago !== undefined ? { valor_pago: Number(pg.valor_pago) } : {}),
      };
      return NextResponse.json(await pagarConta(id, dados, usuarioId));
    }

    if (acao === 'estornar') {
      const motivo = String(body.motivo ?? '').trim() || null;
      return NextResponse.json(await estornarPagamento(id, motivo, usuarioId));
    }

    if (acao === 'cancelar') {
      const escopo = body.escopo === 'esta_e_seguintes' ? 'esta_e_seguintes' : 'esta';
      await cancelarConta(id, usuarioId, escopo);
      return NextResponse.json({ ok: true });
    }

    if (acao === 'confirmar') {
      if (typeof body.ja_pagou !== 'boolean') return erro400('Informe se a conta já foi paga (ja_pagou).');
      if (body.data != null && !ehData(body.data)) return erro400('Data inválida (use AAAA-MM-DD).');
      return NextResponse.json(await confirmarRetroativa(id, body.ja_pagou, body.data ?? null, usuarioId));
    }

    return erro400('Ação desconhecida.');
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em POST /api/financeiro/contas-pagar/acoes:', e);
    return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
  }
}
