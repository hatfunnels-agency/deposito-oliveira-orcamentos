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
  // Saldo da conta no fim do arquivo (vira saldos_conta, origem 'extrato').
  // Itau: linha 'SALDO EM CONTA CORRENTE'; Stone: 'Saldo depois' do ultimo
  // movimento do ultimo dia (pela cadeia de saldos, nao pela ordem do arquivo).
  // null quando o layout nao traz ou a cadeia e ambigua.
  saldo_final: { data: string; saldo: number } | null;
}

// 'ofx' e 'manual' existem em contas_financeiras.layout. OFX e detectado
// pelo conteudo (vale pra qualquer conta); conta manual (caixa/cartao) nao
// importa arquivo e recusa com mensagem clara em vez de importar lixo.
export type Layout = 'itau_xlsx' | 'stone_csv' | 'generico' | 'ofx' | 'manual';

// Stone: linha com Situacao fora deste conjunto (ex.: 'Cancelada', 'Em
// processamento', 'Recusada') nao mexeu no saldo e nao pode virar lancamento.
const SITUACOES_STONE_OK = new Set(['RECEBIDA', 'FINISHED', 'ENVIADO', 'APROVADA', 'CONCLUIDA', 'PAGO', 'PAGA']);
const normalizarSituacao = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

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
  let saldoFinal: ResultadoParse['saldo_final'] = null;
  for (let i = idxTitulo + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const get = (idx: number): CelulaXlsx => (idx >= 0 ? (l[idx] ?? null) : null);

    const descricao = limpar(get(cDesc));
    const valorBruto = get(cValor);

    // Linha de saldo: tem descricao e saldo, mas nao tem valor. Nao e
    // lancamento — e o retrato do saldo naquele instante. So a de 'SALDO EM
    // CONTA CORRENTE' (fim do arquivo) vale como saldo final; 'SALDO DO DIA'
    // e parcial.
    if (valorBruto === null || valorBruto === '') {
      if (descricao) ignoradas.push({ linha: i + 1, motivo: 'linha sem valor (saldo/subtotal)', conteudo: descricao });
      if (/SALDO EM CONTA CORRENTE/i.test(descricao)) {
        const s = paraNumero(get(cSaldo));
        const d = paraDataIso(get(cData));
        if (!Number.isNaN(s)) saldoFinal = { data: d ?? '', saldo: s };
      }
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

  // Sem data na linha de saldo, vale o ultimo dia com lancamento.
  if (saldoFinal && !saldoFinal.data) {
    const ultima = lancamentos.map(l => l.data).sort().pop();
    saldoFinal = ultima ? { ...saldoFinal, data: ultima } : null;
  }
  return montarResultado(lancamentos, ignoradas, saldoFinal);
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
  const cSit    = col(/^situa/);
  if (cValor < 0 || cData < 0) throw new Error('CSV da Stone sem as colunas Valor ou Data');

  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: ResultadoParse['ignoradas'] = [];
  const vistos = new Map<string, number>();

  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    const get = (idx: number) => (idx >= 0 ? limpar(l[idx]) : '');

    if (cSit >= 0) {
      const situacao = normalizarSituacao(get(cSit));
      if (situacao && !SITUACOES_STONE_OK.has(situacao)) {
        ignoradas.push({ linha: i + 1, motivo: 'situacao', conteudo: `${get(cSit)} | ${get(cTipo)} ${get(cValor)}`.trim() });
        continue;
      }
    }

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

  // Saldo final = 'Saldo depois' do ultimo movimento do ultimo dia. Nao da pra
  // confiar na ordem do arquivo (a Stone exporta do mais novo pro mais velho,
  // mas uma planilha reordenada inverte): o ultimo movimento e a linha que
  // nenhuma outra sucede (saldo_b - valor_b == saldo_a). Cadeia ambigua ->
  // sem saldo, em vez de gravar um errado.
  const ultimoDia = lancamentos.reduce((m, l) => (l.data > m ? l.data : m), '');
  const doDia = lancamentos.filter(l => l.data === ultimoDia && l.saldo !== null);
  const ehPredecessora = (a: LancamentoBruto) => doDia.some(b => b !== a && Math.abs((b.saldo as number) - b.valor - (a.saldo as number)) <= 0.011);
  const finais = doDia.filter(l => !ehPredecessora(l));
  let saldoFinal: ResultadoParse['saldo_final'] = null;
  if (doDia.length === 1 || finais.length === 1) saldoFinal = { data: ultimoDia, saldo: (finais[0] ?? doDia[0]).saldo as number };
  else if (doDia.length > 1) ignoradas.push({ linha: 0, motivo: 'saldo final ambiguo', conteudo: `${finais.length} candidatas a ultimo movimento em ${ultimoDia}` });
  return montarResultado(lancamentos, ignoradas, saldoFinal);
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

// ------------------------------------------------------------
// OFX — Itau Empresas (SGML 1.x, CHARSET:1252) e Stone (XML 2.x)
// ------------------------------------------------------------

/** OFX se comeca com OFXHEADER (SGML) ou traz <OFX> (XML). Olha so o inicio. */
export function ehOfx(buffer: Buffer): boolean {
  const cabeca = buffer.subarray(0, 4096).toString('latin1');
  return /OFXHEADER/i.test(cabeca) || /<OFX>/i.test(cabeca);
}

/** UTF-8 quando os bytes sao UTF-8 valido; senao windows-1252/latin1. */
function decodificarOfx(buffer: Buffer): string {
  const latin1 = () => {
    try { return new TextDecoder('windows-1252').decode(buffer); }
    catch { return buffer.toString('latin1'); }
  };
  // UTF-8 valido ganha do cabecalho: a Stone declara CHARSET:1252 mas manda
  // UTF-8 ("Crédito" viraria "CrÃ©dito"). Texto latin1 com acento quase
  // nunca e UTF-8 valido, entao o teste e seguro.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return latin1(); }
}

const ENTIDADES_OFX: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const desescapar = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|nbsp|#(\d+));/gi, (m, nome: string, num?: string) =>
    num ? String.fromCharCode(Number(num)) : (ENTIDADES_OFX[nome.toLowerCase()] ?? m));

/**
 * Campos de um bloco OFX. Serve pro SGML (valor ate a quebra de linha ou o
 * proximo '<') e pro XML (valor ate '</TAG>'). Tag repetida: fica a primeira.
 */
function camposOfx(bloco: string): Record<string, string> {
  const campos: Record<string, string> = {};
  const re = /<([A-Za-z0-9_.]+)>([^<\r\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloco)) !== null) {
    const tag = m[1].toUpperCase();
    const valor = desescapar(m[2]).trim();
    if (!(tag in campos)) campos[tag] = valor;
  }
  return campos;
}

/** AAAAMMDD[HHMMSS[.XXX][-3:BRT]] -> ISO. So a data importa. */
function dataOfx(v: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec((v ?? '').trim());
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** CPF/CNPJ (com ou sem pontuacao) dentro de NAME/MEMO -> so digitos. */
function documentoNoTexto(...textos: string[]): string | null {
  const re = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;
  for (const t of textos) {
    for (const cand of t.match(re) ?? []) {
      const d = cand.replace(/\D/g, '');
      if (d.length === 11 || d.length === 14) return d;
    }
  }
  return null;
}

function parseOfx(buffer: Buffer, contaId: string): ResultadoParse {
  const texto = decodificarOfx(buffer);
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: ResultadoParse['ignoradas'] = [];
  const vistos = new Map<string, number>();

  blocos.forEach((bloco, i) => {
    const c = camposOfx(bloco);
    const nome = limpar(c.NAME);
    const memo = limpar(c.MEMO);
    const resumo = [nome, memo].filter(Boolean).join(' | ').slice(0, 90);

    const data = dataOfx(c.DTPOSTED);
    if (!data) { ignoradas.push({ linha: i + 1, motivo: 'data ilegivel', conteudo: resumo }); return; }

    const valor = paraNumero(c.TRNAMT);
    if (Number.isNaN(valor) || valor === 0) {
      ignoradas.push({ linha: i + 1, motivo: 'valor ilegivel ou zero', conteudo: resumo });
      return;
    }

    // NAME e MEMO costumam repetir o mesmo texto; junta so o que e diferente.
    const partes = [nome, memo].filter((p, idx, arr) => p && arr.indexOf(p) === idx);
    const descricao = partes.join(' — ') || '(sem descricao)';
    // Sem NAME (caso da Stone), o nome vem no MEMO antes do " - ":
    // "FULANO DE TAL - Pix | Maquininha", "L & J DEPOSITO OLIVEIRA LTDA - Transferência | Pix".
    const doMemo = !nome && memo.includes(' - ') ? limpar(memo.split(' - ')[0]) : '';
    const contraparte = nome || (doMemo && !/^RECEBIMENTO|^MENSALIDADE/i.test(doMemo) ? doMemo : '') || null;
    const fitid = limpar(c.FITID);

    let hash: string;
    if (fitid) {
      // FITID e o id unico do banco: reimportar o mesmo periodo nao duplica.
      hash = createHash('sha256').update([contaId, 'ofx', fitid].join('|')).digest('hex').slice(0, 32);
    } else {
      const chave = `${data}|${valor.toFixed(2)}|${descricao}`;
      const seq = (vistos.get(chave) ?? 0) + 1;
      vistos.set(chave, seq);
      hash = hashLinha(contaId, data, valor, descricao, limpar(c.CHECKNUM), seq);
    }

    lancamentos.push({
      data,
      descricao,
      contraparte,
      documento: documentoNoTexto(nome, memo),
      valor,
      saldo: null,            // OFX nao traz saldo por linha
      tarifa: 0,
      hash_linha: hash,
    });
  });

  // LEDGERBAL = saldo da conta na data DTASOF. Arquivo com mais de um
  // extrato: fica o ultimo.
  let saldoFinal: ResultadoParse['saldo_final'] = null;
  for (const bloco of texto.match(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/gi) ?? []) {
    const c = camposOfx(bloco);
    const saldo = paraNumero(c.BALAMT);
    const data = dataOfx(c.DTASOF);
    if (!Number.isNaN(saldo) && data) saldoFinal = { data, saldo };
  }

  return montarResultado(lancamentos, ignoradas, saldoFinal);
}

function montarResultado(
  lancamentos: LancamentoBruto[],
  ignoradas: ResultadoParse['ignoradas'],
  saldoFinal: ResultadoParse['saldo_final'] = null
): ResultadoParse {
  const datas = lancamentos.map(l => l.data).sort();
  return {
    lancamentos,
    ignoradas,
    periodo_inicio: datas[0] ?? null,
    periodo_fim: datas[datas.length - 1] ?? null,
    saldo_final: saldoFinal,
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
  if (layout === 'manual') throw new Error('Conta manual (caixa ou cartão) não importa extrato: lance os movimentos pela tela.');
  // OFX pelo conteudo, antes do layout da conta e da extensao: o Itau e a
  // Stone exportam OFX e o mesmo parser serve pras duas contas.
  if (ehOfx(buffer)) return parseOfx(buffer, contaId);
  if (layout === 'ofx' || /\.ofx$/i.test(nomeArquivo)) {
    throw new Error('O arquivo não parece OFX (sem OFXHEADER nem <OFX>). Exporte de novo: Itaú › Salvar em outros formatos › OFX; Stone › Extrato › Baixar › OFX.');
  }

  if (layout === 'itau_xlsx' || (layout === 'generico' && ehXlsx)) {
    if (!ehXlsx) throw new Error('A conta Itau espera arquivo .xlsx');
    return parseItauXlsx(buffer, contaId);
  }
  const texto = buffer.toString('utf8');
  if (layout === 'stone_csv') return parseStoneCsv(texto, contaId);
  return parseGenericoCsv(texto, contaId);
}
