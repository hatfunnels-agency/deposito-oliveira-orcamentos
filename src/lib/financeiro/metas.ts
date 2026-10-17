// Metas e indicadores do mes: estamos indo bem (meta) e estamos no minimo
// para nao fechar no vermelho (ponto de equilibrio)? SERVER-ONLY.
//
// Metas ficam em configuracoes (chave 'financeiro_metas', JSON) porque mudam
// sem deploy. O minimo e calculado, nao configurado:
//   minimo = custos do mes / (margem bruta % - custo liquido do cartao %)
// custos do mes = despesas fixas orcadas do mes (folha, estrutura, operacao,
// comercial, impostos e parcelas de divida). Mercadoria nao entra: ela ja
// esta descontada na margem bruta.

import { supabaseAdmin } from '@/lib/supabase';
import type { DespesaFixa, FechamentoMensal, IndicadoresMes, MetasFinanceiras } from './tipos';
import { arred2, diasUteisNoMes, diasUteisPassados } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';

const CHAVE = 'financeiro_metas';
const VAZIO: MetasFinanceiras = { faturamento_mes: null, ticket_medio: null, margem_pct: null };

const numOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function lerMetas(): Promise<MetasFinanceiras> {
  const { data } = await supabaseAdmin.from('configuracoes').select('valor').eq('chave', CHAVE).maybeSingle();
  if (!data?.valor) return { ...VAZIO };
  try {
    const j = JSON.parse(String(data.valor)) as Partial<MetasFinanceiras>;
    return { faturamento_mes: numOuNull(j.faturamento_mes), ticket_medio: numOuNull(j.ticket_medio), margem_pct: numOuNull(j.margem_pct) };
  } catch {
    return { ...VAZIO };
  }
}

export async function salvarMetas(entrada: Partial<MetasFinanceiras>, usuarioId: string | null): Promise<MetasFinanceiras> {
  const metas: MetasFinanceiras = {
    faturamento_mes: numOuNull(entrada.faturamento_mes),
    ticket_medio: numOuNull(entrada.ticket_medio),
    margem_pct: numOuNull(entrada.margem_pct),
  };
  if (metas.margem_pct !== null && metas.margem_pct >= 100) throw new ErroFinanceiro(400, 'Margem deve ser menor que 100%.');
  const antes = await lerMetas();
  const { error } = await supabaseAdmin.from('configuracoes')
    .upsert({ chave: CHAVE, valor: JSON.stringify(metas), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'configuracao', entidade_id: null, acao: 'metas', antes, depois: metas, usuario_id: usuarioId });
  return metas;
}

/** Indicadores do mes a partir do fechamento parcial e das despesas fixas orcadas. */
export function indicadoresMes(
  mes: string, hoje: string, fech: FechamentoMensal, despesas: DespesaFixa[], metas: MetasFinanceiras,
): IndicadoresMes {
  const total = diasUteisNoMes(mes);
  const passados = diasUteisPassados(mes, hoje);
  // Hoje ainda esta em andamento: para o "quanto falta por dia" conta como restante.
  const restantes = Math.max(0, total - passados + (passados > 0 && passados <= total ? 1 : 0));
  const passadosFechados = Math.max(0, passados - 1);

  const faturamento = fech.vendas.faturamento;
  const mediaDia = passados > 0 ? faturamento / passados : 0;
  const projecao = passados > 0 ? mediaDia * total : 0;

  const composicao: Record<string, number> = {};
  for (const d of despesas) composicao[d.grupo] = arred2((composicao[d.grupo] ?? 0) + d.valor_no_mes);
  const custos = arred2(despesas.reduce((a, d) => a + d.valor_no_mes, 0));

  const margem = fech.vendas.margem_bruta_pct;
  const custoCartaoPct = faturamento > 0 ? (fech.recebimentos.maquininha.custo_liquido_previsto / faturamento) * 100 : 0;
  const contribuicao = margem === null ? null : margem - Math.max(0, custoCartaoPct);
  const minimo = contribuicao !== null && contribuicao > 0 ? arred2(custos / (contribuicao / 100)) : null;

  const porDia = (alvo: number | null) => alvo === null ? null
    : restantes > 0 ? arred2(Math.max(0, alvo - faturamento) / restantes) : null;

  const meta = metas.faturamento_mes;
  let status: IndicadoresMes['status'] = 'sem_dados';
  if (passados > 0 && minimo !== null) {
    status = projecao < minimo ? 'abaixo_minimo' : meta !== null && projecao >= meta ? 'acima_meta' : 'acima_minimo';
  }
  // Resultado estimado no mes se mantiver o ritmo: contribuicao x projecao - custos.
  const resultadoProjetado = contribuicao === null || passados === 0 ? null : arred2(projecao * (contribuicao / 100) - custos);

  return {
    mes,
    metas,
    status,
    faturamento: arred2(faturamento),
    projecao: arred2(projecao),
    media_por_dia: arred2(mediaDia),
    dias_uteis_total: total,
    dias_uteis_passados: passados,
    dias_uteis_restantes: restantes,
    dias_fechados: passadosFechados,
    resultado_projetado: resultadoProjetado,
    minimo: {
      valor: minimo,
      custos_mes: custos,
      composicao,
      margem_pct: margem === null ? null : arred2(margem),
      custo_cartao_pct: arred2(Math.max(0, custoCartaoPct)),
      por_dia: minimo === null ? null : arred2(minimo / total),
      falta_por_dia: porDia(minimo),
      atingido: minimo !== null && faturamento >= minimo,
    },
    meta: {
      valor: meta,
      pct: meta ? arred2((faturamento / meta) * 100) : null,
      projecao_pct: meta ? arred2((projecao / meta) * 100) : null,
      por_dia: meta ? arred2(meta / total) : null,
      falta_por_dia: porDia(meta),
    },
    ticket_medio: arred2(fech.vendas.ticket_medio),
    qtd_pedidos: fech.vendas.qtd_pedidos,
  };
}
