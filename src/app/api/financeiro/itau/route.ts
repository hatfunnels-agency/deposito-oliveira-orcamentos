import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';
import { ErroHttpItau, importarItau, itauConfigurado, statusItau, testarItau } from '@/lib/financeiro/itau-extrato';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function responderErro(e: unknown, rotulo: string) {
  if (e instanceof ErroHttpItau) return NextResponse.json({ error: e.message }, { status: 502 });
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/itau -> StatusItau (sem credenciais responde configurado: false, nao e erro)
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    return NextResponse.json(await statusItau());
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/itau');
  }
}

// POST /api/financeiro/itau
//   { acao: 'testar', de?, ate? }   -> TesteItau (baixa e converte, nao grava nada)
//   { acao: 'importar', de?, ate? } -> ResultadoImportacao (default: ultimos 7 dias)
export async function POST(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const acao = String(body.acao ?? 'importar');
    if (!itauConfigurado()) {
      throw new ErroFinanceiro(400, 'API do Itaú não configurada: defina ITAU_CLIENT_ID, ITAU_CLIENT_SECRET, ITAU_CERTIFICADO e ITAU_CHAVE_PRIVADA na Vercel.');
    }
    if (acao === 'testar') return NextResponse.json(await testarItau({ de: body.de, ate: body.ate }));
    if (acao === 'importar') return NextResponse.json(await importarItau({ de: body.de, ate: body.ate }, 'manual'));
    throw new ErroFinanceiro(400, `Ação desconhecida: ${acao}`);
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/itau');
  }
}
