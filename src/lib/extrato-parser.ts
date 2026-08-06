import { createHash } from 'crypto';
import { lerXlsx, type CelulaXlsx } from '@/lib/xlsx-min';

/**
 * Parsers de extrato. Cada layout vira a mesma estrutura normalizada, pra
 * que categorizacao, conciliacao e DRE nao saibam de onde veio o arquivo.
 *
 * Principio: nunca "dar um jeito" numa linha estranha. Se a data nao
 * parseia ou o valor nao e numero, a linha vai pro array `ignoradas` com
 * o motivo e aparece na tela de importacao. Linha sumida em silencio =
 * DRE errado que ninguem percebe.
 */

export interface LancamentoBruto {
  data: string;          // ISO yyyy-mm-dd
  descricao: string;
  contraparte: string | null;
  documento: string | null;   // CPF/CNPJ so digitos
  valor: number;              // + entrada, - saida
  saldo: number | null;
  tarifa: number;
  hash_linha: string;
}

export interface ResultadoParse {
  lancamentos: LancamentoBruto[];
  ignoradas: Array<{ linha: number; motivo: string; conteudo: string }>;
  periodo_inicio: string | null;
  periodo_fim: string | null;
}

export type Layout = 'itau_xlsx' | 'stone_csv' | 'generico';

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** "1.234,56" | "R$ -1.234,56" | 1234.56 -> number. NaN se nao der. */
export function paraNumero(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  s = s.replace(/R\$/gi, '').replace(/\s/g, '');
  if (/^gr[aá]tis$/i.test(s)) return 0;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()]/g, '').replace(/^-/, '');
  // Formato BR: ponto e milhar, virgula e decimal.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (Number.isNaN(n)) return NaN;
  return negativo ? -n : n;
}

/** dd/mm/aaaa | aaaa-mm-dd | Date -> ISO. null se nao der. */
export function paraDataIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

const soDigitos = (s: unknown): string | null => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 11 ? d : null;   // CPF (11) ou CNPJ (14)
};

const limpar = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Impressao digital da linha, pra reimportar o mesmo periodo sem duplicar.
 * Inclui a conta: o mesmo PIX aparece nos dois extratos (saida na Stone,
 * entrada no Itau) e sao dois lancamentos legitimos, nao duplicata.
 * `seq` desempata linhas identicas de verdade no mesmo dia (ex: duas
 * vendas de R$50 no mesmo cliente).
 */
function hashLinha(contaId: string, data: string, valor: number, descricao: string, extra: string, seq: number): string {
  return createHash('sha256')
    .update([contaId, data, valor.toFixed(2), descricao, extra, seq].join('|'))
    .digest('hex')
    .slice(0, 32);
}

/** CSV com aspas, virgula dentro de campo e quebra de linha em campo. */
export function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroAspas = false;

  const conteudo = texto.replace(/^﻿/, ''); // BOM
  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];
    if (dentroAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += c;
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',' || c === ';') {
      linha.push(campo); campo = '';
    } else if (c === '\n') {
      linha.push(campo); campo = '';
      if (linha.some(x => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else if (c !== '\r') {
      campo += c;
    }
  }
  linha.push(campo);
  if (linha.some(x => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

// ------------------------------------------------------------
// Itau — .xlsx
// Cabecalho em ~9 linhas de metadados; a linha de titulo tem
// Data | Lancamento | Razao Social | CPF/CNPJ | Valor (R$) | Saldo (R$)
// ------------------------------------------------------------
function parseItauXlsx(buffer: Buffer, contaId: string): ResultadoParse {
  const linhas = lerXlsx(buffer);
  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: ResultadoParse['ignoradas'] = [];

  const idxTitulo = linhas.findIndex(l =>
    l.some(c => typeof c === 'string' && /^data$/i.test(c.trim())) &&
    l.some(c => typeof c === 'string' && /lan[cç]amento/i.test(c))
  );
  if (idxTitulo < 0) {
    throw new Error('Nao encontrei a linha de titulo (Data / Lancamento) no arquivo do Itau');
  }

  const titulo = linhas[idxTitulo].map(c => limpar(c).toLowerCase());
  const col = (re: RegExp) => titulo.findIndex(t => re.test(t));
  const cData   = col(/^data$/);
  const cDesc   = col(/lan[cç]amento/);
  const cRazao  = col(/raz[aã]o/);
  const cDoc    = col(/cpf|cnpj/);
  const cValor  = col(/^valor/);
  const cSaldo  = col(/^saldo/);
  if (cData < 0 || cDesc < 0 || cValor < 0) {
    throw new Error('Arquivo do Itau sem as colunas Data, Lancamento ou Valor');
  }

  const vistos = new Map<string, number>();
  for (let i = idxTitulo + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const get = (idx: number): CelulaXlsx => (idx >= 0 ? (l[idx] ?? null) : null);

    const descricao = limpar(get(cDesc));
    const valorBruto = get(cValor);

    // Linha de saldo: tem descricao e saldo, mas nao tem valor. Nao e
    // lancamento — e o retrato do saldo naquele instante.
    if (valorBruto === null || valorBruto === '') {
      if (descricao) ignoradas.push({ linha: i + 1, motivo: 'linha sem valor (saldo/subtotal)', conteudo: descricao });
      continue;
    }

    const data = paraDataIso(get(cData));
    const valor = paraNumero(valorBruto);
    if (!data) { ignoradas.push({ linha: i + 1, motivo: 'data ilegivel', conteudo: `${get(cData)} | ${descricao}` }); continue; }
    if (Number.isNaN(valor)) { ignoradas.push({ linha: i + 1, motivo: 'valor ilegivel', conteudo: `${valorBruto} | ${descricao}` }); continue; }

    const contraparte = limpar(get(cRazao)) || null;
    const chave = `${data}|${valor.toFixed(2)}|${descricao}|${contraparte ?? ''}`;
    const seq = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, seq);

    lancamentos.push({
      data,
      descricao,
      contraparte,
      documento: soDigitos(get(cDoc)),
      valor,
      saldo: (() => { const s = paraNumero(get(cSaldo)); return Number.isNaN(s) ? null : s; })(),
      tarifa: 0,
      hash_linha: hashLinha(contaId, data, valor, descricao, contraparte ?? '', seq),
    });
  }

  return montarResultado(lancamentos, ignoradas);
}

// ------------------------------------------------------------
// Stone — .csv
// Movimentacao (Credito/Debito) | Tipo | Valor | ... | Data | ...
// Origem/Destino identificam a contraparte; o sinal vem de Movimentacao.
// ------------------------------------------------------------
function parseStoneCsv(texto: string, contaId: string): ResultadoParse {
  const linhas = parseCsv(texto);
  if (linhas.length < 2) throw new Error('CSV da Stone vazio ou sem cabecalho');

  const titulo = linhas[0].map(t => limpar(t).toLowerCase());
  const col = (re: RegExp) => titulo.findIndex(t => re.test(t));
  const cMov    = col(/movimenta/);
  const cTipo   = col(/^tipo$/);
  const cValor  = col(/^valor$/);
  const cSaldo  = col(/saldo depois/);
  const cTarifa = col(/^tarifa$/);
  const cData   = col(/^data$/);
  const cOrigem = col(/^origem$/);
  const cOrigDoc = col(/origem documento/);
  const cDest   = col(/^destino$/);
  const cDestDoc = col(/destino documento/);
  const cDesc   = col(/descri/);
  if (cValor < 0 || cData < 0) throw new Error('CSV da Stone sem as colunas Valor ou Data');

  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: ResultadoParse['ignoradas'] = [];
  const vistos = new Map<string, number>();

  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    const get = (idx: number) => (idx >= 0 ? limpar(l[idx]) : '');

    const data = paraDataIso(get(cData));
    let valor = paraNumero(get(cValor));
    if (!data) { ignoradas.push({ linha: i + 1, motivo: 'data ilegivel', conteudo: get(cData) }); continue; }
    if (Number.isNaN(valor)) { ignoradas.push({ linha: i + 1, motivo: 'valor ilegivel', conteudo: get(cValor) }); continue; }

    // A Stone traz Debito ja com sinal negativo em alguns tipos e positivo
    // em outros. O sinal confiavel e a coluna Movimentacao.
    const mov = get(cMov).toLowerCase();
    const ehDebito = mov.startsWith('d');
    valor = ehDebito ? -Math.abs(valor) : Math.abs(valor);

    // Na entrada, quem paga e a Origem. Na saida, quem recebe e o Destino.
    const contraparte = (ehDebito ? get(cDest) : get(cOrigem)) || null;
    const documento = soDigitos(ehDebito ? get(cDestDoc) : get(cOrigDoc));

    const tipo = get(cTipo);
    const desc = get(cDesc);
    const descricao = limpar([tipo, desc].filter(Boolean).join(' — ')) || tipo || 'Movimentacao Stone';

    const chave = `${data}|${valor.toFixed(2)}|${descricao}|${contraparte ?? ''}`;
    const seq = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, seq);

    const tarifa = paraNumero(get(cTarifa));
    lancamentos.push({
      data,
      descricao,
      contraparte,
      documento,
      valor,
      saldo: (() => { const s = paraNumero(get(cSaldo)); return Number.isNaN(s) ? null : s; })(),
      tarifa: Number.isNaN(tarifa) ? 0 : Math.abs(tarifa),
      hash_linha: hashLinha(contaId, data, valor, descricao, contraparte ?? '', seq),
    });
  }

  return montarResultado(lancamentos, ignoradas);
}

// ------------------------------------------------------------
// Generico — CSV com deteccao de coluna
// ------------------------------------------------------------
function parseGenericoCsv(texto: string, contaId: string): ResultadoParse {
  const linhas = parseCsv(texto);
  if (linhas.length < 2) throw new Error('CSV vazio ou sem cabecalho');

  // O cabecalho e a primeira linha que tenha algo parecido com "data".
  const idxTitulo = linhas.findIndex(l => l.some(c => /data|dt\b/i.test(c)));
  if (idxTitulo < 0) throw new Error('Nao encontrei uma coluna de data no CSV');

  const titulo = linhas[idxTitulo].map(t => limpar(t).toLowerCase());
  const col = (re: RegExp) => titulo.findIndex(t => re.test(t));
  const cData  = col(/data|dt\b/);
  const cDesc  = col(/descri|hist[oó]ric|lan[cç]amento|memo/);
  const cValor = col(/valor|montante|amount/);
  const cCred  = col(/cr[eé]dito/);
  const cDeb   = col(/d[eé]bito/);
  const cDoc   = col(/cpf|cnpj|documento/);
  const cParte = col(/raz[aã]o|contrapart|benefici|favorec|origem|destino|nome/);
  const cSaldo = col(/saldo/);
  if (cData < 0 || (cValor < 0 && cCred < 0 && cDeb < 0)) {
    throw new Error('CSV sem coluna de valor reconhecivel');
  }

  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: ResultadoParse['ignoradas'] = [];
  const vistos = new Map<string, number>();

  for (let i = idxTitulo + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const get = (idx: number) => (idx >= 0 ? limpar(l[idx]) : '');

    const data = paraDataIso(get(cData));
    if (!data) { ignoradas.push({ linha: i + 1, motivo: 'data ilegivel', conteudo: l.join(' | ').slice(0, 90) }); continue; }

    let valor: number;
    if (cValor >= 0) {
      valor = paraNumero(get(cValor));
    } else {
      const cr = paraNumero(get(cCred));
      const db = paraNumero(get(cDeb));
      valor = (Number.isNaN(cr) ? 0 : cr) - (Number.isNaN(db) ? 0 : Math.abs(db));
    }
    if (Number.isNaN(valor) || valor === 0) {
      ignoradas.push({ linha: i + 1, motivo: 'valor ilegivel ou zero', conteudo: l.join(' | ').slice(0, 90) });
      continue;
    }

    const descricao = get(cDesc) || '(sem descricao)';
    const contraparte = get(cParte) || null;
    const chave = `${data}|${valor.toFixed(2)}|${descricao}|${contraparte ?? ''}`;
    const seq = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, seq);

    lancamentos.push({
      data, descricao, contraparte,
      documento: soDigitos(get(cDoc)),
      valor,
      saldo: (() => { const s = paraNumero(get(cSaldo)); return Number.isNaN(s) ? null : s; })(),
      tarifa: 0,
      hash_linha: hashLinha(contaId, data, valor, descricao, contraparte ?? '', seq),
    });
  }

  return montarResultado(lancamentos, ignoradas);
}

function montarResultado(
  lancamentos: LancamentoBruto[],
  ignoradas: ResultadoParse['ignoradas']
): ResultadoParse {
  const datas = lancamentos.map(l => l.data).sort();
  return {
    lancamentos,
    ignoradas,
    periodo_inicio: datas[0] ?? null,
    periodo_fim: datas[datas.length - 1] ?? null,
  };
}

/** Ponto de entrada. `layout` vem de contas_financeiras.layout. */
export function parseExtrato(
  buffer: Buffer,
  nomeArquivo: string,
  layout: Layout,
  contaId: string
): ResultadoParse {
  const ehXlsx = /\.xlsx$/i.test(nomeArquivo);

  if (layout === 'itau_xlsx' || (layout === 'generico' && ehXlsx)) {
    if (!ehXlsx) throw new Error('A conta Itau espera arquivo .xlsx');
    return parseItauXlsx(buffer, contaId);
  }
  const texto = buffer.toString('utf8');
  if (layout === 'stone_csv') return parseStoneCsv(texto, contaId);
  return parseGenericoCsv(texto, contaId);
}
