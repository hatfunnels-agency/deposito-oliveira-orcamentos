// Calculo da folha: periodos de pagamento, valor por periodo e encargos.
//
// Funcoes puras sobre datas 'YYYY-MM-DD' (sem fuso: tudo em UTC por
// dentro, so pra aritmetica de dias). Usado pela API e pela tela.

export type Frequencia = 'semanal' | 'quinzenal' | 'mensal';

export const FREQUENCIA_LABELS: Record<Frequencia, string> = {
  semanal: 'Semanal (sábado)',
  quinzenal: 'Quinzenal (dias 5 e 20)',
  mensal: 'Mensal (dia 5)',
};

export interface Periodo {
  inicio: string;     // primeiro dia trabalhado do periodo
  fim: string;        // ultimo dia trabalhado do periodo
  pagamento: string;  // dia de pagar
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => toStr(new Date(Date.UTC(y, m, d)));

export const somarDias = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toStr(d);
};

export const diasEntre = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

/** Hoje no fuso de Sao Paulo (o servidor da Vercel roda em UTC). */
export const hojeSP = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/**
 * Periodo que contem a data `s`.
 *   semanal   -> domingo a sabado, paga no proprio sabado
 *   quinzenal -> 1 a 15 paga dia 20; 16 ao fim do mes paga dia 5 do mes seguinte
 *   mensal    -> mes inteiro, paga dia 5 do mes seguinte
 */
export function periodoContendo(freq: Frequencia, s: string): Periodo {
  const d = toDate(s);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (freq === 'semanal') {
    const inicio = somarDias(s, -d.getUTCDay());
    const fim = somarDias(inicio, 6);
    return { inicio, fim, pagamento: fim };
  }
  if (freq === 'quinzenal') {
    if (d.getUTCDate() <= 15) {
      return { inicio: ymd(y, m, 1), fim: ymd(y, m, 15), pagamento: ymd(y, m, 20) };
    }
    return { inicio: ymd(y, m, 16), fim: ymd(y, m + 1, 0), pagamento: ymd(y, m + 1, 5) };
  }
  return { inicio: ymd(y, m, 1), fim: ymd(y, m + 1, 0), pagamento: ymd(y, m + 1, 5) };
}

/** Valor cheio de um periodo a partir do salario mensal. */
export function valorPeriodo(freq: Frequencia, salarioMensal: number) {
  // mensal x 12 / 52: no ano fecha exato com 12 salarios.
  // (mensal / 4 daria 52 x 1/4 = 13 salarios por ano.)
  const v = freq === 'semanal' ? (salarioMensal * 12) / 52
    : freq === 'quinzenal' ? salarioMensal / 2
    : salarioMensal;
  return Math.round(v * 100) / 100;
}

export interface FuncionarioBase {
  frequencia: Frequencia;
  salario_mensal: number;
  data_admissao: string;
  data_desligamento: string | null;
  controle_desde: string;
}

/**
 * Proximo periodo a pagar.
 * Com historico: o periodo seguinte ao ultimo pago.
 * Sem historico: o primeiro cujo dia de pagar cai a partir de
 * `controle_desde` (e que tenha pelo menos um dia apos a admissao).
 */
export function proximoPeriodo(f: FuncionarioBase, ultimoFimPago: string | null): Periodo {
  if (ultimoFimPago) return periodoContendo(f.frequencia, somarDias(ultimoFimPago, 1));
  let p = periodoContendo(f.frequencia, somarDias(f.controle_desde, -40));
  while (p.pagamento < f.controle_desde || p.fim < f.data_admissao) {
    p = periodoContendo(f.frequencia, somarDias(p.fim, 1));
  }
  return p;
}

/**
 * Bruto do periodo, proporcional se a pessoa entrou ou saiu no meio.
 * Proporcao por dias corridos do periodo.
 */
export function brutoDoPeriodo(f: FuncionarioBase, p: Periodo) {
  const cheio = valorPeriodo(f.frequencia, f.salario_mensal);
  const ini = f.data_admissao > p.inicio ? f.data_admissao : p.inicio;
  const fim = f.data_desligamento && f.data_desligamento < p.fim ? f.data_desligamento : p.fim;
  if (ini === p.inicio && fim === p.fim) return { valor: cheio, proporcional: false, dias: 0, diasPeriodo: 0 };
  const diasPeriodo = diasEntre(p.inicio, p.fim) + 1;
  const dias = Math.max(0, diasEntre(ini, fim) + 1);
  return {
    valor: Math.round((cheio * dias / diasPeriodo) * 100) / 100,
    proporcional: true,
    dias,
    diasPeriodo,
  };
}

/**
 * Custo mensal estimado se a pessoa for registrada (CLT), empresa no
 * Simples Nacional, Anexo I (comercio): o INSS patronal (CPP) ja esta
 * dentro do DAS, entao o custo extra e FGTS + provisao de 13o e ferias.
 * E estimativa — o valor exato vem da contabilidade.
 */
export function encargosMensais(salarioMensal: number) {
  const r = (v: number) => Math.round(v * 100) / 100;
  const fgts = salarioMensal * 0.08;
  const decimoTerceiro = salarioMensal / 12;
  const ferias = (salarioMensal / 12) * (4 / 3); // ferias + 1/3
  const fgtsProvisoes = (decimoTerceiro + ferias) * 0.08;
  const total = salarioMensal + fgts + decimoTerceiro + ferias + fgtsProvisoes;
  return {
    salario: r(salarioMensal),
    fgts: r(fgts),
    decimo_terceiro: r(decimoTerceiro),
    ferias: r(ferias),
    fgts_provisoes: r(fgtsProvisoes),
    custo_total: r(total),
    acrescimo_pct: salarioMensal > 0 ? r(((total / salarioMensal) - 1) * 100) : 0,
  };
}

/** Tempo de casa e proximo aniversario de admissao (vencimento do periodo aquisitivo de ferias). */
export function tempoDeCasa(admissao: string, hoje: string) {
  const a = toDate(admissao);
  const h = toDate(hoje);
  let meses = (h.getUTCFullYear() - a.getUTCFullYear()) * 12 + (h.getUTCMonth() - a.getUTCMonth());
  if (h.getUTCDate() < a.getUTCDate()) meses -= 1;
  meses = Math.max(0, meses);
  const anos = Math.floor(meses / 12);
  let prox = ymd(a.getUTCFullYear() + anos + 1, a.getUTCMonth(), a.getUTCDate());
  if (prox <= hoje) prox = ymd(a.getUTCFullYear() + anos + 2, a.getUTCMonth(), a.getUTCDate());
  return { anos, meses: meses % 12, total_meses: meses, proximo_aniversario: prox };
}

const FREQUENCIAS: Frequencia[] = ['semanal', 'quinzenal', 'mensal'];

/** Valida e normaliza o corpo de criar/editar. Retorna string = erro. */
export function camposFuncionario(body: Record<string, unknown>, parcial: boolean) {
  const out: Record<string, unknown> = {};
  const data = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  if ('nome' in body || !parcial) {
    const nome = String(body.nome ?? '').trim();
    if (!nome) return 'Informe o nome.';
    out.nome = nome;
  }
  if ('frequencia' in body || !parcial) {
    if (!FREQUENCIAS.includes(body.frequencia as Frequencia)) return 'Forma de pagamento inválida.';
    out.frequencia = body.frequencia;
  }
  if ('salario_mensal' in body || !parcial) {
    const s = Number(body.salario_mensal);
    if (!Number.isFinite(s) || s < 0) return 'Salário inválido.';
    out.salario_mensal = s;
  }
  if ('data_admissao' in body || !parcial) {
    if (!data(body.data_admissao)) return 'Data de admissão inválida.';
    out.data_admissao = body.data_admissao;
  }
  if ('data_desligamento' in body) {
    if (body.data_desligamento && !data(body.data_desligamento)) return 'Data de desligamento inválida.';
    out.data_desligamento = body.data_desligamento || null;
  }
  if ('controle_desde' in body) {
    if (!data(body.controle_desde)) return 'Data de início do controle inválida.';
    out.controle_desde = body.controle_desde;
  }
  for (const k of ['funcao', 'telefone', 'observacoes'] as const) {
    if (k in body) out[k] = String(body[k] ?? '').trim() || null;
  }
  for (const k of ['ativo', 'registrado'] as const) {
    if (k in body) out[k] = Boolean(body[k]);
  }
  return out;
}
