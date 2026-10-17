import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { gerarContasDoMes } from '@/lib/financeiro/despesas-fixas';
import { hojeSP, mesSP, mesSeguinte, somarDias } from '@/lib/financeiro/datas';
import { importarDia, stoneConfigurado } from '@/lib/financeiro/stone-conciliacao';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/cron/financeiro
// Vercel cron diario (vercel.json, 09:00 UTC = 06:00 BRT). Auth via Bearer
// CRON_SECRET, mesmo padrao de /api/cron/geocode-enderecos.
//
// Gera as contas a pagar do mes atual e do seguinte a partir das despesas
// fixas. E idempotente (chave despesa_fixa:<id>:<mes>), por isso pode rodar
// todo dia: uma despesa cadastrada no meio do mes entra no dia seguinte, e
// o mes que vem ja aparece no fluxo de 30 dias. Cada etapa tem seu
// try/catch — a falha de um mes nao impede o outro.
//
// Fase 2: com STONE_CONCILIACAO_CHAVE/STONE_CODES configuradas, importa o
// arquivo de conciliacao da Stone de D-1 (disponivel apos 05:00 BRT) e
// casa as vendas do cartao com os pagamentos do sistema.
export async function GET(request: NextRequest) {
  // Comparacao em tempo constante; sem CRON_SECRET o anonimo ve so 401
  // (o motivo fica no log, nao na resposta).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) console.error('[cron financeiro] CRON_SECRET nao configurada no servidor');
  const esperado = Buffer.from(`Bearer ${cronSecret ?? ''}`);
  const recebido = Buffer.from(request.headers.get('authorization') ?? '');
  if (!cronSecret || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const mesAtual = mesSP();
  const meses = [mesAtual, mesSeguinte(mesAtual)];
  const etapas: Array<{ etapa: string; ok: boolean; geradas?: number; ja_existiam?: number; atualizadas?: number; retroativas?: number; ignoradas_sem_valor?: string[]; importacoes?: unknown[]; erro?: string }> = [];

  for (const mes of meses) {
    try {
      const g = await gerarContasDoMes(mes, null);
      etapas.push({
        etapa: `contas ${mes}`, ok: true,
        geradas: g.geradas, ja_existiam: g.ja_existiam, atualizadas: g.atualizadas, retroativas: g.retroativas,
        ignoradas_sem_valor: g.ignoradas_sem_valor,
      });
    } catch (e) {
      console.error(`[cron financeiro] falha ao gerar contas de ${mes}`, e);
      etapas.push({ etapa: `contas ${mes}`, ok: false, erro: e instanceof Error ? e.message : 'Erro interno' });
    }
  }

  if (stoneConfigurado()) {
    const ontem = somarDias(hojeSP(), -1);
    try {
      const importacoes = await importarDia(ontem, false, null);
      etapas.push({
        etapa: `stone ${ontem}`,
        ok: importacoes.every(i => i.status !== 'erro'),
        importacoes: importacoes.map(i => ({ stone_code: i.stone_code, status: i.status, transacoes: i.transacoes, novas: i.novas, liquidacoes: i.liquidacoes, casadas: i.casadas, erro: i.erro })),
      });
    } catch (e) {
      console.error(`[cron financeiro] falha ao importar Stone de ${ontem}`, e);
      etapas.push({ etapa: `stone ${ontem}`, ok: false, erro: e instanceof Error ? e.message : 'Erro interno' });
    }
  }

  const payload = {
    ok: etapas.every(e => e.ok),
    timestamp: new Date().toISOString(),
    meses,
    etapas,
  };
  console.log('[cron financeiro]', JSON.stringify(payload));
  return NextResponse.json(payload, { status: payload.ok ? 200 : 500 });
}
