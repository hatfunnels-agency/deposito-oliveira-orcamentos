// Simulador de cenarios (12 meses). PURO: sem Supabase, sem relogio — roda
// no cliente enquanto o Roger arrasta os parametros. O que vem do banco
// (baseSimulador) fica em simulador-base.ts.

import type {
  BaseSimulador, CustoFixoSimulado, LinhaSimulada, ParametrosCenario, ResultadoSimulacao,
} from './tipos';

export const TETO_SIMPLES_PADRAO = 4_800_000;
export const MESES_PADRAO = 12;
export const DIAS_UTEIS_MES = 25;

const arred2 = (n: number) => {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return r === 0 ? 0 : r;
};

/** 'YYYY-MM' + n meses (sem depender de datas.ts pra ficar 100% puro). */
export function somarMesesSim(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function custoFixoNoMes(custos: CustoFixoSimulado[], indice: number): number {
  return custos.reduce((a, c) => {
    const ini = c.mes_inicio ?? 1;
    const fim = c.mes_fim ?? Number.POSITIVE_INFINITY;
    return indice >= ini && indice <= fim ? a + (Number(c.valor) || 0) : a;
  }, 0);
}

/**
 * Projeta mes a mes:
 *   faturamento   = base x (1+cresc)^(m-1) x fator de sazonalidade
 *   lucro bruto   = faturamento x margem
 *   imposto       = faturamento x aliquota (muda pra "apos teto" quando os
 *                   12 meses moveis passam do teto; antes do cenario assume
 *                   o faturamento base)
 *   taxas         = faturamento x participacao do cartao x custo liquido
 *   lucro op.     = lucro bruto - fixos - imposto - taxas
 *   caixa livre   = lucro op. - divida ; acumulado desde caixa_inicial
 */
export function simular(p: ParametrosCenario): ResultadoSimulacao {
  const meses = Math.min(60, Math.max(1, Math.trunc(Number(p.meses)) || MESES_PADRAO));
  const base = Number(p.faturamento_mensal) || 0;
  const margem = (Number(p.margem_bruta_pct) || 0) / 100;
  const cresc = (Number(p.crescimento_mensal_pct) || 0) / 100;
  const impostoPct = (Number(p.imposto_pct_faturamento) || 0) / 100;
  const impostoApos = p.imposto_pct_apos_teto == null ? null : (Number(p.imposto_pct_apos_teto) || 0) / 100;
  const teto = Number(p.teto_anual) > 0 ? Number(p.teto_anual) : TETO_SIMPLES_PADRAO;
  const cartao = ((Number(p.cartao?.participacao_pct) || 0) / 100) * ((Number(p.cartao?.custo_liquido_pct) || 0) / 100);
  const sazMeses = new Set((p.sazonalidade?.meses ?? []).map(Number));
  const sazFator = Number(p.sazonalidade?.fator) > 0 ? Number(p.sazonalidade.fator) : 1;

  const alertas: string[] = [];
  const linhas: LinhaSimulada[] = [];
  const faturamentos: number[] = [];
  let acumulado = Number(p.caixa_inicial) || 0;
  let acimaDoTeto = false;
  let somaFixos = 0;
  let somaDivida = 0;

  for (let m = 1; m <= meses; m++) {
    const mes = somarMesesSim(p.mes_inicio, m - 1);
    const mesCalendario = Number(mes.slice(5, 7));
    const faturamento = base * Math.pow(1 + cresc, m - 1) * (sazMeses.has(mesCalendario) ? sazFator : 1);
    faturamentos.push(faturamento);

    if (impostoApos !== null && !acimaDoTeto) {
      // 12 meses moveis: os simulados mais, antes do cenario, o ritmo base.
      let soma12 = 0;
      for (let k = m - 11; k <= m; k++) soma12 += k >= 1 ? faturamentos[k - 1] : base;
      if (soma12 > teto) {
        acimaDoTeto = true;
        alertas.push(`Teto do Simples (${brl(teto)} em 12 meses) ultrapassado em ${mes}: a alíquota passa a ${(impostoApos * 100).toFixed(1)}%.`);
      }
    }
    const aliquota = acimaDoTeto && impostoApos !== null ? impostoApos : impostoPct;

    const lucroBruto = faturamento * margem;
    const imposto = faturamento * aliquota;
    const taxas = faturamento * cartao;
    const custoFixo = custoFixoNoMes(p.custos_fixos ?? [], m);
    const divida = (p.dividas ?? []).reduce((a, d) => (Number(d.parcelas_restantes) || 0) >= m ? a + (Number(d.valor) || 0) : a, 0);
    const lucroOperacao = lucroBruto - custoFixo - imposto - taxas;
    const caixaLivre = lucroOperacao - divida;
    acumulado += caixaLivre;
    somaFixos += custoFixo;
    somaDivida += divida;

    linhas.push({
      mes,
      indice: m,
      faturamento: arred2(faturamento),
      lucro_bruto: arred2(lucroBruto),
      custo_fixo: arred2(custoFixo),
      imposto: arred2(imposto),
      taxas: arred2(taxas),
      lucro_operacao: arred2(lucroOperacao),
      divida: arred2(divida),
      caixa_livre: arred2(caixaLivre),
      caixa_acumulado: arred2(acumulado),
      acima_do_teto: acimaDoTeto,
    });
  }

  const caixaNoPeriodo = linhas.reduce((a, l) => a + l.caixa_livre, 0);
  const pior = linhas.reduce((p, l) => (l.caixa_acumulado < p.caixa_acumulado ? l : p), linhas[0]);
  const mesesNoVermelho = linhas.filter(l => l.caixa_livre < 0).length;

  // Faturamento que zera o caixa livre: fixos + divida = fat x (margem - imposto - cartao).
  const denominador = margem - impostoPct - cartao;
  const breakEven = denominador > 0 ? (somaFixos / meses + somaDivida / meses) / denominador : null;
  if (denominador <= 0) alertas.push('A margem bruta não cobre imposto e taxas de cartão: não existe faturamento que feche a conta.');
  if (mesesNoVermelho > 0) alertas.push(`${mesesNoVermelho} ${mesesNoVermelho === 1 ? 'mês fecha' : 'meses fecham'} no vermelho.`);
  if (pior.caixa_acumulado < 0) alertas.push(`O caixa acumulado fica negativo (pior momento ${brl(pior.caixa_acumulado)} em ${pior.mes}).`);

  return {
    linhas,
    resumo: {
      caixa_no_periodo: arred2(caixaNoPeriodo),
      pior_momento: pior.caixa_acumulado,
      pior_mes: pior.mes,
      media_mes: arred2(caixaNoPeriodo / meses),
      meses_no_vermelho: mesesNoVermelho,
      break_even_faturamento: breakEven === null ? null : arred2(breakEven),
      break_even_por_dia_util: breakEven === null ? null : arred2(breakEven / DIAS_UTEIS_MES),
    },
    alertas,
  };
}

function brl(n: number): string {
  return `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
}

/** Parametros a partir da base real, trocando so nome/faturamento/crescimento. */
export function parametrosDaBase(base: BaseSimulador, nome: string, faturamento: number, crescimentoPct = 0): ParametrosCenario {
  const custos = [...(base.custos_fixos ?? [])];
  if (base.folha > 0 && !custos.some(c => /folha/i.test(c.nome))) custos.unshift({ nome: 'Folha de pagamento', valor: base.folha });
  return {
    nome,
    mes_inicio: base.mes_inicio,
    meses: MESES_PADRAO,
    faturamento_mensal: arred2(faturamento),
    margem_bruta_pct: arred2(base.margem_media_pct),
    crescimento_mensal_pct: crescimentoPct,
    sazonalidade: { meses: [], fator: 1 },
    custos_fixos: custos,
    imposto_pct_faturamento: arred2(base.imposto_pct_atual),
    imposto_pct_apos_teto: null,
    teto_anual: TETO_SIMPLES_PADRAO,
    cartao: { participacao_pct: arred2(base.mix_cartao_pct), custo_liquido_pct: arred2(base.custo_cartao_liquido_pct) },
    dividas: base.dividas ?? [],
    caixa_inicial: arred2(base.caixa_inicial),
  };
}

/** Os 3 cenarios de partida: ritmo do ultimo mes, media de 6 meses, melhor mes. */
export function cenariosPadrao(base: BaseSimulador): ParametrosCenario[] {
  return [
    parametrosDaBase(base, 'Ritmo do último mês', base.faturamento_ultimo_mes),
    parametrosDaBase(base, 'Média 6 meses', base.faturamento_medio_6m),
    parametrosDaBase(base, 'Melhor mês', base.faturamento_melhor_mes),
  ];
}

/** Valida/normaliza parametros vindos da tela ou do JSON salvo. Lanca Error em pt-BR. */
export function normalizarParametros(p: Partial<ParametrosCenario>): ParametrosCenario {
  if (!p || typeof p !== 'object') throw new Error('Parâmetros do cenário inválidos.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.mes_inicio ?? ''))) throw new Error('Mês de início inválido (AAAA-MM).');
  const num = (v: unknown, padrao = 0) => (Number.isFinite(Number(v)) ? Number(v) : padrao);
  return {
    nome: String(p.nome ?? 'Cenário').trim() || 'Cenário',
    mes_inicio: String(p.mes_inicio),
    meses: Math.min(60, Math.max(1, Math.trunc(num(p.meses, MESES_PADRAO)))),
    faturamento_mensal: Math.max(0, num(p.faturamento_mensal)),
    margem_bruta_pct: Math.min(100, Math.max(0, num(p.margem_bruta_pct))),
    crescimento_mensal_pct: num(p.crescimento_mensal_pct),
    sazonalidade: {
      meses: Array.isArray(p.sazonalidade?.meses) ? p.sazonalidade.meses.map(Number).filter(m => m >= 1 && m <= 12) : [],
      fator: num(p.sazonalidade?.fator, 1) > 0 ? num(p.sazonalidade?.fator, 1) : 1,
    },
    custos_fixos: Array.isArray(p.custos_fixos)
      ? p.custos_fixos.map(c => ({
        nome: String(c?.nome ?? '').trim() || 'Custo',
        valor: Math.max(0, num(c?.valor)),
        ...(c?.mes_inicio != null ? { mes_inicio: Math.max(1, Math.trunc(num(c.mes_inicio, 1))) } : {}),
        ...(c?.mes_fim != null ? { mes_fim: Math.max(1, Math.trunc(num(c.mes_fim, 1))) } : {}),
      }))
      : [],
    imposto_pct_faturamento: Math.min(100, Math.max(0, num(p.imposto_pct_faturamento))),
    imposto_pct_apos_teto: p.imposto_pct_apos_teto == null ? null : Math.min(100, Math.max(0, num(p.imposto_pct_apos_teto))),
    teto_anual: num(p.teto_anual, TETO_SIMPLES_PADRAO) > 0 ? num(p.teto_anual, TETO_SIMPLES_PADRAO) : TETO_SIMPLES_PADRAO,
    cartao: {
      participacao_pct: Math.min(100, Math.max(0, num(p.cartao?.participacao_pct))),
      custo_liquido_pct: Math.min(100, Math.max(0, num(p.cartao?.custo_liquido_pct))),
    },
    dividas: Array.isArray(p.dividas)
      ? p.dividas.map(d => ({
        nome: String(d?.nome ?? '').trim() || 'Dívida',
        valor: Math.max(0, num(d?.valor)),
        parcelas_restantes: Math.max(0, Math.trunc(num(d?.parcelas_restantes))),
      }))
      : [],
    caixa_inicial: num(p.caixa_inicial),
  };
}
