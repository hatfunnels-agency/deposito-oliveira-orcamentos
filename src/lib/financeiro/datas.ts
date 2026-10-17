// Datas do modulo financeiro.
//
// O dia comercial e America/Sao_Paulo e o servidor (Vercel) roda em UTC.
// O Brasil nao tem horario de verao desde 2019, entao o deslocamento e
// fixo em -3h — as rotas atuais (dia, conciliacao) ja assumem isso e a lib
// usa o mesmo numero pra bater centavo com elas.
//
// Formatos: data 'YYYY-MM-DD', mes 'YYYY-MM', instante ISO (timestamptz).
// Funcoes puras: podem rodar no cliente.

import { hojeSP, somarDias, diasEntre } from '@/lib/folha';

export { hojeSP, somarDias, diasEntre };

export const OFFSET_BRT_HORAS = 3;
const MS_HORA = 3600 * 1000;
const MS_DIA = 24 * MS_HORA;

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);

export function ehData(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function ehMes(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Arredonda a 2 casas. Devolve 0 (nao -0) pra nao aparecer "-0,00" na tela. */
export function arred2(n: number): number {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Agora, com os campos UTC do Date iguais ao relogio de Sao Paulo. */
export function agoraSP(): Date {
  return new Date(Date.now() - OFFSET_BRT_HORAS * MS_HORA);
}

export function mesSP(): string {
  return hojeSP().slice(0, 7);
}

/** timestamptz (ISO) -> 'YYYY-MM-DD' no dia comercial de Sao Paulo. */
export function dataBRT(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso).slice(0, 10);
  return new Date(ms - OFFSET_BRT_HORAS * MS_HORA).toISOString().slice(0, 10);
}

export function mesDe(d: string): string {
  return d.slice(0, 7);
}

/** 'YYYY-MM' ou 'YYYY-MM-DD' -> primeiro dia do mes ('YYYY-MM-01'). */
export function primeiroDiaDoMes(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function inicioFimMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number);
  return { inicio: `${mes}-01`, fim: toStr(new Date(Date.UTC(a, m, 0))) };
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  return toStr(new Date(Date.UTC(a, m - 1 + n, 1))).slice(0, 7);
}

export function mesAnterior(mes: string): string {
  return somarMeses(mes, -1);
}

export function mesSeguinte(mes: string): string {
  return somarMeses(mes, 1);
}

/** Meses inteiros entre dois meses 'YYYY-MM' (b - a). */
export function mesesEntre(a: string, b: string): number {
  const [aa, am] = a.split('-').map(Number);
  const [ba, bm] = b.split('-').map(Number);
  return (ba - aa) * 12 + (bm - am);
}

/** Dia `dia` do mes, limitado ao ultimo dia (31 em fevereiro vira 28/29). */
export function clampDiaDoMes(mes: string, dia: number): string {
  const ultimo = Number(inicioFimMes(mes).fim.slice(8, 10));
  const d = Math.min(Math.max(1, Math.trunc(dia) || 1), ultimo);
  return `${mes}-${String(d).padStart(2, '0')}`;
}

/** 00:00 e 24:00 de Sao Paulo em UTC — pra filtrar timestamptz por dia. */
export function limitesDiaUtc(data: string): { inicioUtc: string; fimUtc: string } {
  const inicio = toDate(data).getTime() + OFFSET_BRT_HORAS * MS_HORA;
  return { inicioUtc: new Date(inicio).toISOString(), fimUtc: new Date(inicio + MS_DIA).toISOString() };
}

export function limitesPeriodoUtc(de: string, ate: string): { inicioUtc: string; fimUtc: string } {
  return { inicioUtc: limitesDiaUtc(de).inicioUtc, fimUtc: limitesDiaUtc(ate).fimUtc };
}

export function limitesMesUtc(mes: string): { inicioUtc: string; fimUtc: string } {
  const { inicio, fim } = inicioFimMes(mes);
  return limitesPeriodoUtc(inicio, fim);
}

/** 0 = domingo ... 6 = sabado. */
export function diaSemana(data: string): number {
  return toDate(data).getUTCDay();
}

/**
 * Dia em que a Stone deposita: soma dias corridos; se cair no domingo vai
 * pra segunda. Sabado conta (a Stone liquida aos sabados). Com 0 dias
 * (PIX) o dinheiro entra na hora, mesmo domingo.
 */
export function proximoDiaLiquidacao(data: string, dias: number): string {
  const n = Math.max(0, Math.trunc(dias) || 0);
  let d = somarDias(data, n);
  if (n > 0 && diaSemana(d) === 0) d = somarDias(d, 1);
  return d;
}

/** Datas de `de` a `ate`, inclusive. */
export function diasNoIntervalo(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** Dias uteis do deposito = segunda a sabado. */
export function diasUteisNoMes(mes: string): number {
  const { inicio, fim } = inicioFimMes(mes);
  return diasNoIntervalo(inicio, fim).filter(d => diaSemana(d) !== 0).length;
}

/** Dias uteis (seg-sab) do mes ate `hoje` inclusive. 0 antes do mes; o mes todo depois dele. */
export function diasUteisPassados(mes: string, hoje: string): number {
  const { inicio, fim } = inicioFimMes(mes);
  if (hoje < inicio) return 0;
  const ate = hoje > fim ? fim : hoje;
  return diasNoIntervalo(inicio, ate).filter(d => diaSemana(d) !== 0).length;
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'out/2026' */
export function rotuloMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES_CURTOS[(m - 1 + 12) % 12] ?? mes}/${a}`;
}

/** '16/10/2026' (aceita data ou instante ISO: usa os 10 primeiros caracteres). */
export function dataBR(d: string): string {
  const s = String(d ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
