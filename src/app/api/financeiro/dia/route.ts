import { NextRequest, NextResponse } from 'next/server';
import { diaBase } from '@/lib/financeiro/dia';
import { hojeSP } from '@/lib/financeiro/datas';
import { exigirPapel } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/financeiro/dia?data=2026-07-15
 *
 * O fechamento do dia em uma tela: o que o SISTEMA diz que vendeu, o que
 * o BANCO diz que entrou, e o que sobrou no CAIXA.
 *
 * As tres fontes nunca batem exatamente, e tudo bem — o util e ver a
 * diferenca e saber de onde ela vem:
 *   - dinheiro nao passa em banco (fica no caixa)
 *   - cartao liquida com atraso (venda hoje, banco depois)
 *   - venda a prazo nem entra
 * A tela mostra as tres colunas em vez de forcar um numero unico.
 *
 * O calculo mora em src/lib/financeiro/dia.ts (diaBase); a versao com
 * taxas e liquido do dia e /api/financeiro/dia-gestao. A resposta daqui
 * continua a mesma (DiaBase).
 */
export async function GET(request: NextRequest) {
  // As saidas do caixa trazem salario/vale por nome: so admin.
  const { negado } = await exigirPapel(request, ['admin'], 'o dia financeiro');
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    const data = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('data') || '') ? sp.get('data')! : hojeSP();
    return NextResponse.json(await diaBase(data));
  } catch (e) {
    console.error('Erro em GET /api/financeiro/dia:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
