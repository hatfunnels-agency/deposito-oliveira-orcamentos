import { NextRequest, NextResponse } from 'next/server';
import { calcularReceber } from '@/lib/financeiro/receber';

export const dynamic = 'force-dynamic';

// GET /api/financeiro?dias=30
//
// Contas a receber = venda confirmada com saldo em aberto (total - valor_pago).
// Inadimplente = saldo em aberto com vencimento ja passado.
//
// "Entregue e nao pago" e reportado a parte porque e o alarme de verdade:
// a mercadoria ja saiu, o dinheiro nao entrou — independente de ter prazo.
//
// O calculo mora em src/lib/financeiro/receber.ts (calcularReceber), que a
// tela /financeiro tambem usa agrupado por cliente. A resposta daqui e a
// mesma de sempre (FinanceiroReceber); a unica mudanca consciente e que
// "hoje" passou a ser o dia comercial de Sao Paulo, nao o UTC do servidor.
export async function GET(request: NextRequest) {
  try {
    const dias = Number(request.nextUrl.searchParams.get('dias')) || 30;
    return NextResponse.json(await calcularReceber(dias));
  } catch (e) {
    console.error('Erro em GET /api/financeiro:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
