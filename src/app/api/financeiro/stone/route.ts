import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { ehData, ehMes, hojeSP, somarDias } from '@/lib/financeiro/datas';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';
import { casarVendasComPagamentos, importarDia, statusStone, stoneConfigurado } from '@/lib/financeiro/stone-conciliacao';

export const dynamic = 'force-dynamic';
// O download do arquivo da Stone pode demorar (timeout interno de 120s).
export const maxDuration = 120;

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/stone?mes=AAAA-MM -> StatusStone
// Sem chave configurada responde { configurado: false, ... } (nao e erro).
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const mes = request.nextUrl.searchParams.get('mes');
    return NextResponse.json(await statusStone(ehMes(mes) ? mes : undefined));
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/stone');
  }
}

// POST /api/financeiro/stone
//   { acao: 'importar', data?: 'AAAA-MM-DD' (default D-1), forcar?: boolean } -> { importacoes: StoneImportacao[] }
//   { acao: 'casar', de, ate } -> ResultadoCasamento
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const acao = String(body.acao ?? 'importar');

    if (acao === 'importar') {
      if (!stoneConfigurado()) {
        throw new ErroFinanceiro(400, 'API da Stone não configurada: defina STONE_CONCILIACAO_CHAVE e STONE_CODES na Vercel.');
      }
      const data = ehData(body.data) ? body.data : somarDias(hojeSP(), -1);
      const importacoes = await importarDia(data, body.forcar === true, usuario?.id ?? null);
      return NextResponse.json({ importacoes });
    }

    if (acao === 'casar') {
      if (!ehData(body.de) || !ehData(body.ate) || body.de > body.ate) {
        throw new ErroFinanceiro(400, 'Informe o período (de, ate) em AAAA-MM-DD.');
      }
      return NextResponse.json(await casarVendasComPagamentos(body.de, body.ate, usuario?.id ?? null));
    }

    throw new ErroFinanceiro(400, `Ação desconhecida: ${acao}`);
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/stone');
  }
}
