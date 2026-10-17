// Formatacao pt-BR da tela /financeiro. Funcoes puras; rodam no navegador.
import type { Metodo } from './tipos';
import { hojeSP } from '@/lib/folha';

export { dataBR, rotuloMes } from './datas';

export function brl(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// 'R$ 12,3 mil' / 'R$ 1,2 mi' — para eixos de grafico e cartoes apertados.
export function brlCurto(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  const abs = Math.abs(v);
  const sinal = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sinal}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

export function pct(n: number | null | undefined, casas = 1): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function numero(n: number | null | undefined, casas = 0): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Dia comercial = America/Sao_Paulo, mesmo com o celular em outro fuso.
export const hojeBRT = (): string => hojeSP();
export const mesBRT = (): string => hojeSP().slice(0, 7);

// 'DD/MM'. Aceita 'YYYY-MM-DD' ou ISO com hora (corta nos 10 primeiros).
export function dataCurta(d: string | null | undefined): string {
  if (!d) return '—';
  const s = d.slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

export function horaBRT(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

const paraData = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const paraStr = (d: Date) => d.toISOString().slice(0, 10);

export function somarDiasISO(d: string, n: number): string {
  const x = paraData(d);
  x.setUTCDate(x.getUTCDate() + n);
  return paraStr(x);
}

export function diasEntreISO(a: string, b: string): number {
  return Math.round((paraData(b).getTime() - paraData(a).getTime()) / 86400000);
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return paraStr(d).slice(0, 7);
}

export const primeiroDia = (mes: string): string => `${mes}-01`;

export function ultimoDia(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return paraStr(new Date(Date.UTC(a, m, 0)));
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function diaSemanaCurto(d: string): string {
  return DIAS_SEMANA[paraData(d).getUTCDay()] ?? '';
}

// "1.234,56" -> 1234.56. Sem virgula, um ponto seguido de 1-2 digitos no fim e
// decimal ("1234.5"); do contrario o ponto e separador de milhar.
export function parseMoeda(texto: string): number | null {
  const t = String(texto ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!t || t === '-' ) return null;
  let s = t;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{1,2}$/.test(s) && (s.match(/\./g) || []).length === 1) {
    // ja esta em formato decimal
  } else {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const METODOS: Array<{ v: Metodo; l: string }> = [
  { v: 'pix', l: 'Pix' },
  { v: 'debito', l: 'Débito' },
  { v: 'credito', l: 'Crédito' },
  { v: 'dinheiro', l: 'Dinheiro' },
  { v: 'transferencia', l: 'Transferência' },
  { v: 'boleto', l: 'Boleto' },
  { v: 'outro', l: 'Outro' },
];

export function rotuloMetodo(m: string | null | undefined): string {
  if (!m) return '—';
  return METODOS.find(x => x.v === m)?.l ?? m;
}
