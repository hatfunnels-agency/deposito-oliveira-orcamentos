// API de Conciliacao da Stone (fase 2): baixa o arquivo diario de cada
// Stone Code, grava as vendas do cartao (bruto, liquido, MDR, antecipacao)
// em stone_vendas, as liquidacoes em stone_liquidacoes, casa venda <->
// pagamento do sistema e liquidacao <-> linha do extrato Stone.
//
// Documentacao lida em 16/10/2026 (conciliacao.stone.com.br/reference):
//   GET https://conciliation.stone.com.br/v2/merchant/{StoneCode}/conciliation-file/{AAAAMMDD}?layout=XML2_4
//   headers: Authorization: Basic base64("<chave>:"), x-user-type: client
//            (obrigatorio, sem ele da 401), Accept-Encoding: gzip.
//   Corpo compactado em gzip (magic 1f 8b) — ou texto, se o fetch ja
//   descomprimiu. 307 -> seguir Location (sem reenviar Authorization).
//   401 chave/formato errado; 403 chave nao e do StoneCode; 429 limite:
//   7 requisicoes por hora por (StoneCode, data) — por isso 'ok' nao se
//   reimporta sem `forcar`.
//
// Arvore XML (layout 2.4) que o parser espera — nomes exatos, prefixos de
// namespace ignorados:
//   Conciliation
//   ├── Header { GenerationDateTime(aaaammddHHmmss), StoneCode, LayoutVersion, FileId, ReferenceDate(aaaammdd) }
//   ├── FinancialTransactions
//   │   └── Transaction (uma por venda; campos marcados * so existem quando Events/Captures = 1)
//   │       ├── Events { CancellationCharges, Cancellations, Captures, ChargebackRefunds, Chargebacks, Payments }
//   │       ├── AcquirerTransactionKey (NSU), InitiatorTransactionKey
//   │       ├── AuthorizationDateTime, CaptureLocalDateTime (aaaammddHHmmss, hora local)
//   │       ├── AccountType* (credit|debit), InstallmentType*, NumberOfInstallments*
//   │       ├── AuthorizedAmount*, CapturedAmount*, CanceledAmount*
//   │       ├── BrandId*, CardNumber* (truncado), Poi/PoiType, EntryMode
//   │       ├── FeeType (1 = MDR e antecipacao separados -> MdrAmount;
//   │       │            2 = taxa unica -> SaleFee; 255 = padrao)
//   │       └── Installments/Installment { InstallmentNumber, GrossAmount, NetAmount,
//   │                      PrevisionPaymentDate(aaaammdd), MdrAmount | SaleFee }
//   ├── FinancialTransactionsAccounts/Transaction/Installments/Installment { ..., PaymentDate, PaymentId }
//   ├── FinancialEventAccounts/Event { EventId, Description, Type, PaymentDate, Amount, PaymentId }
//   ├── Payments/Payment { Id, TotalAmount, FavoredBankAccount { BankCode, BankAccountNumber } }
//   └── Trailer, WalletPosition (ignorados)
// Unidades: todos os valores vem em REAIS DECIMAIS ("1787.51", "8955.000000"),
// nunca em centavos. Datas sem fuso: hora local do estabelecimento (BRT, -03:00).
// Antecipacao por parcela = (GrossAmount - NetAmount) - MdrAmount.

import { ehLinhaCartaoStone } from './stone-extrato';
import { gunzipSync } from 'zlib';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import { normalizar } from '@/lib/categorizacao';
import type { StatusStone, StoneImportacao } from './tipos';
import {
  OFFSET_BRT_HORAS, agoraSP, arred2, dataBRT, ehData, hojeSP, limitesDiaUtc, limitesMesUtc, limitesPeriodoUtc, mesSP, somarDias,
} from './datas';
import { ErroFinanceiro, ehConflitoUnico, registrarEvento } from './eventos';
import { carregarPagamentos, type PagamentoRow } from './taxas';
import { FILTRO_ORIGEM_EXTRATO, carregarContasFinanceiras } from './saldos';
import { achar, descendentes, paraObjeto, parseXml, texto, todos } from '@/lib/xml-min';

type Row = Record<string, any>;

const BASE_URL = 'https://conciliation.stone.com.br';
const TIMEOUT_MS = 120_000;
const USER_AGENT = 'deposito-oliveira-orcamentos/financeiro (conciliacao)';
// Mesmos prefixos que conciliacao.ts usa pra reconhecer a liquidacao do cartao no extrato Stone.
const TOLERANCIA = 0.011;

// ------------------------------------------------------------
// Configuracao
// ------------------------------------------------------------

export function stoneCodes(): string[] {
  return (process.env.STONE_CODES ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function stoneConfigurado(): boolean {
  return Boolean((process.env.STONE_CONCILIACAO_CHAVE ?? '').trim()) && stoneCodes().length > 0;
}

// ------------------------------------------------------------
// Download
// ------------------------------------------------------------

export class ErroHttpStone extends Error {
  status: number;
  corpo: string;
  constructor(status: number, corpo: string) {
    super(`HTTP ${status}: ${corpo.slice(0, 300)}`);
    this.name = 'ErroHttpStone';
    this.status = status;
    this.corpo = corpo.slice(0, 300);
  }
}

const ehGzip = (b: Buffer) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

function descomprimir(buf: Buffer): string {
  const bytes = ehGzip(buf) ? gunzipSync(buf) : buf;
  return bytes.toString('utf8');
}

/**
 * Baixa o arquivo de conciliacao do dia (texto XML). Segue 307 sem
 * reenviar a autorizacao (o destino costuma ser uma URL assinada).
 * Lanca ErroHttpStone com status + inicio do corpo em qualquer erro HTTP.
 */
export async function baixarArquivo(stoneCode: string, data: string): Promise<string> {
  const chave = (process.env.STONE_CONCILIACAO_CHAVE ?? '').trim();
  if (!chave) throw new ErroFinanceiro(400, 'STONE_CONCILIACAO_CHAVE não configurada.');
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');

  const aaaammdd = data.replace(/-/g, '');
  let url: string = `${BASE_URL}/v2/merchant/${encodeURIComponent(stoneCode)}/conciliation-file/${aaaammdd}?layout=XML2_4`;
  const headersAuth: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${chave}:`).toString('base64')}`,
    'x-user-type': 'client',
    'Accept-Encoding': 'gzip',
    'User-Agent': USER_AGENT,
    Accept: 'application/xml, application/gzip, */*',
  };

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    let comAuth = true;
    for (let salto = 0; salto < 4; salto++) {
      const res: Response = await fetch(url, {
        method: 'GET',
        headers: comAuth ? headersAuth : { 'Accept-Encoding': 'gzip', 'User-Agent': USER_AGENT },
        redirect: 'manual',
        signal: controlador.signal,
        cache: 'no-store',
      });
      if (res.status >= 300 && res.status < 400) {
        const destino: string | null = res.headers.get('location');
        if (!destino) throw new ErroHttpStone(res.status, 'redirecionamento sem Location');
        const nova = new URL(destino, url);
        comAuth = nova.origin === new URL(BASE_URL).origin;
        url = nova.toString();
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        let corpo = '';
        try { corpo = descomprimir(buf); } catch { corpo = buf.toString('latin1'); }
        throw new ErroHttpStone(res.status, corpo.replace(/\s+/g, ' ').trim());
      }
      return descomprimir(buf);
    }
    throw new ErroHttpStone(310, 'redirecionamentos demais');
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error(`Stone não respondeu em ${TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Parser do arquivo
// ------------------------------------------------------------

export interface VendaStone {
  stone_code: string;
  nsu: string;
  autorizado_em: string;          // ISO com -03:00
  capturado_em: string | null;
  modalidade: 'credito' | 'debito';
  tipo_parcelamento: string | null;
  parcelas: number;
  bandeira: string | null;
  cartao_final: string | null;
  valor_bruto: number;
  valor_cancelado: number;
  valor_liquido: number;
  taxa_mdr: number;
  taxa_antecipacao: number;
  previsao_pagamento: string | null;
  arquivo_data: string;
  bruto: unknown;
}

export interface LiquidacaoStone {
  stone_code: string;
  payment_id: string;
  data_pagamento: string;
  valor_total: number;
  banco: string | null;
  conta: string | null;
  arquivo_data: string;
}

/** Cancelamento de venda capturada em outro dia: so atualiza valor_cancelado. */
export interface CancelamentoStone { stone_code: string; nsu: string; valor_cancelado: number }

export interface ArquivoConciliacao {
  referencia: string | null;
  vendas: VendaStone[];
  liquidacoes: LiquidacaoStone[];
  cancelamentos: CancelamentoStone[];
}

const num = (s: string | null | undefined): number => {
  if (s == null) return 0;
  const v = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

/** 'aaaammdd' -> 'aaaa-mm-dd' (aceita tambem 'aaaa-mm-dd' e datetime). */
export function dataStone(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.trim().replace(/\D/g, '');
  if (d.length < 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 'aaaammddHHmmss' (hora local BRT) -> ISO com offset -03:00. */
export function dataHoraStone(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.trim().replace(/\D/g, '');
  if (d.length < 8) return null;
  const hh = d.slice(8, 10) || '00', mm = d.slice(10, 12) || '00', ss = d.slice(12, 14) || '00';
  const off = String(OFFSET_BRT_HORAS).padStart(2, '0');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hh}:${mm}:${ss}-${off}:00`;
}

function modalidadeDe(accountType: string | null): 'credito' | 'debito' {
  const t = (accountType ?? '').trim().toLowerCase();
  if (/^(debit|d[eé]bito|2)$/.test(t)) return 'debito';
  // 'credit' e o esperado; valor desconhecido cai em credito (o mais comum;
  // o custo real vem do arquivo de qualquer jeito). Validar com arquivo real.
  return 'credito';
}

export function parseConciliacao(xml: string, stoneCode: string, arquivoData: string): ArquivoConciliacao {
  const raiz = parseXml(xml);
  const cabecalho = achar(raiz, 'Header');
  const referencia = dataStone(texto(cabecalho, 'ReferenceDate')) ?? arquivoData;

  const vendas: VendaStone[] = [];
  const cancelamentos: CancelamentoStone[] = [];
  const transacoes = todos(achar(raiz, 'FinancialTransactions'), 'Transaction');
  for (const t of transacoes) {
    const nsu = texto(t, 'AcquirerTransactionKey');
    if (!nsu) continue;
    const eventos = achar(t, 'Events');
    const capturas = num(texto(eventos, 'Captures'));
    const cancelado = num(texto(t, 'CanceledAmount'));
    const capturadoTxt = texto(t, 'CapturedAmount');
    const autorizadoTxt = texto(t, 'AuthorizedAmount');

    // Transacao sem captura neste arquivo (so cancelamento/chargeback de venda antiga).
    if (capturas <= 0 && capturadoTxt == null && autorizadoTxt == null) {
      if (cancelado > 0) cancelamentos.push({ stone_code: stoneCode, nsu, valor_cancelado: arred2(cancelado) });
      continue;
    }

    const parcelasNode = todos(achar(t, 'Installments'), 'Installment');
    const nParcelas = Math.max(1, Math.trunc(num(texto(t, 'NumberOfInstallments'))) || parcelasNode.length || 1);
    const bruto = num(capturadoTxt ?? autorizadoTxt);
    const feeType = (texto(t, 'FeeType') ?? '').trim();

    let somaBruta = 0, somaLiquida = 0, mdr = 0, taxaUnica = 0;
    let previsao: string | null = null;
    for (const p of parcelasNode) {
      const g = num(texto(p, 'GrossAmount'));
      const l = num(texto(p, 'NetAmount'));
      somaBruta += g;
      somaLiquida += l;
      mdr += num(texto(p, 'MdrAmount'));
      taxaUnica += num(texto(p, 'SaleFee'));
      const d = dataStone(texto(p, 'PrevisionPaymentDate'));
      if (d && (!previsao || d < previsao)) previsao = d;
    }
    const custoTotal = parcelasNode.length > 0 ? somaBruta - somaLiquida : 0;
    let taxaMdr: number, taxaAntecipacao: number;
    if (feeType === '2' || (mdr === 0 && taxaUnica > 0)) {
      // Taxa unica: MDR e antecipacao vem somados — fica tudo em taxa_mdr.
      taxaMdr = taxaUnica > 0 ? taxaUnica : custoTotal;
      taxaAntecipacao = Math.max(0, custoTotal - taxaMdr);
    } else {
      taxaMdr = mdr > 0 ? mdr : custoTotal;
      taxaAntecipacao = Math.max(0, custoTotal - taxaMdr);
    }
    const liquido = parcelasNode.length > 0 ? somaLiquida : bruto;
    const cartao = (texto(t, 'CardNumber') ?? '').replace(/\D/g, '');

    vendas.push({
      stone_code: stoneCode,
      nsu,
      autorizado_em: dataHoraStone(texto(t, 'AuthorizationDateTime')) ?? dataHoraStone(texto(t, 'CaptureLocalDateTime')) ?? `${referencia}T00:00:00-03:00`,
      capturado_em: dataHoraStone(texto(t, 'CaptureLocalDateTime')),
      modalidade: modalidadeDe(texto(t, 'AccountType')),
      tipo_parcelamento: texto(t, 'InstallmentType'),
      parcelas: nParcelas,
      bandeira: texto(t, 'BrandId'),
      cartao_final: cartao.length >= 4 ? cartao.slice(-4) : null,
      valor_bruto: arred2(bruto),
      valor_cancelado: arred2(cancelado),
      valor_liquido: arred2(liquido),
      taxa_mdr: arred2(taxaMdr),
      taxa_antecipacao: arred2(taxaAntecipacao),
      previsao_pagamento: previsao,
      arquivo_data: arquivoData,
      bruto: paraObjeto(t),
    });
  }

  // Data de cada pagamento: eventos/parcelas liquidadas que apontam pro PaymentId.
  const dataPorPagamento = new Map<string, string>();
  for (const ev of todos(achar(raiz, 'FinancialEventAccounts'), 'Event')) {
    const id = texto(ev, 'PaymentId'); const d = dataStone(texto(ev, 'PaymentDate'));
    if (id && d && !dataPorPagamento.has(id)) dataPorPagamento.set(id, d);
  }
  for (const p of descendentes(achar(raiz, 'FinancialTransactionsAccounts'), 'Installment')) {
    const id = texto(p, 'PaymentId'); const d = dataStone(texto(p, 'PaymentDate'));
    if (id && d && !dataPorPagamento.has(id)) dataPorPagamento.set(id, d);
  }

  const liquidacoes: LiquidacaoStone[] = [];
  for (const p of todos(achar(raiz, 'Payments'), 'Payment')) {
    const id = texto(p, 'Id');
    if (!id) continue;
    const total = num(texto(p, 'TotalAmount'));
    if (total <= 0) continue;
    const banco = achar(p, 'FavoredBankAccount');
    liquidacoes.push({
      stone_code: stoneCode,
      payment_id: id,
      data_pagamento: dataPorPagamento.get(id) ?? referencia,
      valor_total: arred2(total),
      banco: texto(banco, 'BankCode'),
      conta: texto(banco, 'BankAccountNumber'),
      arquivo_data: arquivoData,
    });
  }

  return { referencia, vendas, liquidacoes, cancelamentos };
}

// ------------------------------------------------------------
// Importacao
// ------------------------------------------------------------

function mapearImportacao(r: Row): StoneImportacao {
  return {
    stone_code: String(r.stone_code),
    arquivo_data: String(r.arquivo_data),
    status: (r.status === 'ok' || r.status === 'vazio') ? r.status : 'erro',
    transacoes: Number(r.transacoes) || 0,
    novas: Number(r.novas) || 0,
    liquidacoes: Number(r.liquidacoes) || 0,
    casadas: Number(r.casadas) || 0,
    erro: (r.erro as string | null) ?? null,
    criado_em: String(r.criado_em ?? ''),
  };
}

async function gravarImportacao(i: Omit<StoneImportacao, 'criado_em'>): Promise<StoneImportacao> {
  const linha = { ...i, criado_em: new Date().toISOString() };
  const { data, error } = await supabaseAdmin
    .from('stone_importacoes')
    .upsert(linha, { onConflict: 'stone_code,arquivo_data' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapearImportacao(data as Row);
}

async function casadasDoArquivo(stoneCode: string, arquivoData: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('stone_vendas')
    .select('id', { count: 'exact', head: true })
    .eq('stone_code', stoneCode)
    .eq('arquivo_data', arquivoData)
    .not('pagamento_id', 'is', null);
  if (error) return 0;
  return count ?? 0;
}

/**
 * O arquivo do dia D so existe depois das 05:00 BRT de D+1.
 */
function validarDataArquivo(data: string): void {
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');
  const hoje = hojeSP();
  if (data >= hoje) throw new ErroFinanceiro(400, 'O arquivo de um dia só fica disponível a partir das 05:00 do dia seguinte.');
  if (data === somarDias(hoje, -1) && agoraSP().getUTCHours() < 5) {
    throw new ErroFinanceiro(400, 'O arquivo de ontem só fica disponível a partir das 05:00.');
  }
}

/**
 * Importa o arquivo de `data` de todos os Stone Codes. Nunca lanca por
 * erro de um codigo: ele vira stone_importacoes status 'erro'. No fim,
 * casa vendas com pagamentos (data-3..data+1) e liquidacoes com o extrato.
 */
export async function importarDia(data: string, forcar = false, usuarioId: string | null = null): Promise<StoneImportacao[]> {
  if (!stoneConfigurado()) throw new ErroFinanceiro(400, 'API da Stone não configurada (STONE_CONCILIACAO_CHAVE / STONE_CODES).');
  validarDataArquivo(data);

  const codes = stoneCodes();
  const { data: existentes } = await supabaseAdmin
    .from('stone_importacoes').select('*').eq('arquivo_data', data).in('stone_code', codes);
  const existentePor = new Map(((existentes ?? []) as Row[]).map(r => [String(r.stone_code), r]));

  const resultados: StoneImportacao[] = [];
  const pendentesDeCasar: Array<{ stone_code: string }> = [];

  for (const code of codes) {
    const anterior = existentePor.get(code);
    if (anterior && anterior.status === 'ok' && !forcar) {
      resultados.push(mapearImportacao(anterior));
      continue;
    }
    try {
      const xml = await baixarArquivo(code, data);
      const arq = parseConciliacao(xml, code, data);

      // Quantas sao novas: NSUs que ainda nao existem.
      const nsus = arq.vendas.map(v => v.nsu);
      const jaExistem = new Set<string>(
        nsus.length === 0 ? [] : (await lerTudoEmLotes<Row>(nsus, lote => supabaseAdmin
          .from('stone_vendas').select('id, nsu').eq('stone_code', code).in('nsu', lote))).map(r => String(r.nsu)),
      );
      const novas = nsus.filter(n => !jaExistem.has(n)).length;

      for (let i = 0; i < arq.vendas.length; i += 200) {
        // DO UPDATE: cancelamento/valores podem mudar em arquivo reimportado.
        const { error } = await supabaseAdmin
          .from('stone_vendas')
          .upsert(arq.vendas.slice(i, i + 200), { onConflict: 'stone_code,nsu' });
        if (error) throw new Error(`stone_vendas: ${error.message}`);
      }
      for (const c of arq.cancelamentos) {
        await supabaseAdmin.from('stone_vendas')
          .update({ valor_cancelado: c.valor_cancelado })
          .eq('stone_code', c.stone_code).eq('nsu', c.nsu);
      }
      for (let i = 0; i < arq.liquidacoes.length; i += 200) {
        const { error } = await supabaseAdmin
          .from('stone_liquidacoes')
          .upsert(arq.liquidacoes.slice(i, i + 200), { onConflict: 'stone_code,payment_id' });
        if (error) throw new Error(`stone_liquidacoes: ${error.message}`);
      }

      const vazio = arq.vendas.length === 0 && arq.liquidacoes.length === 0 && arq.cancelamentos.length === 0;
      resultados.push(await gravarImportacao({
        stone_code: code, arquivo_data: data, status: vazio ? 'vazio' : 'ok',
        transacoes: arq.vendas.length, novas, liquidacoes: arq.liquidacoes.length, casadas: 0, erro: null,
      }));
      if (!vazio) pendentesDeCasar.push({ stone_code: code });
    } catch (e) {
      const http = e instanceof ErroHttpStone ? e : null;
      // 404 = arquivo (ainda) nao disponivel: fica 'vazio' pra tentar de novo sem precisar forcar.
      const naoDisponivel = http?.status === 404;
      const msg = http ? http.message : (e instanceof Error ? e.message : String(e));
      console.error(`[stone] falha ao importar ${code} ${data}:`, msg);
      try {
        resultados.push(await gravarImportacao({
          stone_code: code, arquivo_data: data, status: naoDisponivel ? 'vazio' : 'erro',
          transacoes: 0, novas: 0, liquidacoes: 0, casadas: 0, erro: msg.slice(0, 400),
        }));
      } catch (e2) {
        console.error('[stone] nao consegui registrar a falha:', e2);
        resultados.push({
          stone_code: code, arquivo_data: data, status: 'erro', transacoes: 0, novas: 0, liquidacoes: 0, casadas: 0,
          erro: msg.slice(0, 400), criado_em: new Date().toISOString(),
        });
      }
    }
  }

  if (pendentesDeCasar.length > 0) {
    let casamento: ResultadoCasamento | null = null;
    try {
      casamento = await casarVendasComPagamentos(somarDias(data, -3), somarDias(data, 1));
    } catch (e) {
      console.error('[stone] falha ao casar vendas com pagamentos:', e);
    }
    try {
      await ligarLiquidacoesAoExtrato(somarDias(data, -1), somarDias(data, 1));
    } catch (e) {
      console.error('[stone] falha ao ligar liquidacoes ao extrato:', e);
    }
    for (const r of resultados) {
      if (r.arquivo_data !== data || r.status !== 'ok') continue;
      const casadas = await casadasDoArquivo(r.stone_code, data);
      if (casadas !== r.casadas) {
        r.casadas = casadas;
        await supabaseAdmin.from('stone_importacoes').update({ casadas }).eq('stone_code', r.stone_code).eq('arquivo_data', data);
      }
    }
    await registrarEvento({
      entidade: 'pagamento', acao: 'stone_importar', usuario_id: usuarioId,
      depois: { data, forcar, importacoes: resultados.map(r => ({ stone_code: r.stone_code, status: r.status, transacoes: r.transacoes, novas: r.novas, liquidacoes: r.liquidacoes, casadas: r.casadas })), casamento },
    });
  } else if (resultados.some(r => r.status === 'erro')) {
    await registrarEvento({
      entidade: 'pagamento', acao: 'stone_importar', usuario_id: usuarioId,
      depois: { data, forcar, importacoes: resultados.map(r => ({ stone_code: r.stone_code, status: r.status, erro: r.erro })) },
    });
  }

  return resultados;
}

// ------------------------------------------------------------
// Casamento venda <-> pagamento do sistema
// ------------------------------------------------------------

export interface ResultadoCasamento {
  casadas: number;
  parcelas_copiadas: number;
  vendas_sem_par: number;
  pagamentos_sem_par: number;
  conflitos: number;
}

interface VendaRow {
  id: string; stone_code: string; nsu: string; autorizado_em: string; modalidade: 'credito' | 'debito';
  parcelas: number; valor_bruto: number; valor_cancelado: number;
}

const MAX_DIST_MS = 36 * 60 * 60 * 1000;

/**
 * Venda da Stone sem pagamento_id <-> pagamento debito/credito sem venda:
 * mesma modalidade, |valor_bruto - valor| <= 0,01, |autorizado_em -
 * data_pagamento| <= 36h, parcelas iguais quando o pagamento as informou.
 * Guloso pela menor distancia de tempo. Se o pagamento nao tinha parcelas
 * informadas, copia as da Stone e marca parcelas_informadas.
 */
export async function casarVendasComPagamentos(de: string, ate: string, usuarioId: string | null = null): Promise<ResultadoCasamento> {
  if (!ehData(de) || !ehData(ate)) throw new ErroFinanceiro(400, 'Período inválido (AAAA-MM-DD).');
  const { inicioUtc, fimUtc } = limitesPeriodoUtc(de, ate);

  const [vendasRows, pagamentos, jaCasados] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin
      .from('stone_vendas')
      .select('id, stone_code, nsu, autorizado_em, modalidade, parcelas, valor_bruto, valor_cancelado')
      .is('pagamento_id', null)
      .gte('autorizado_em', inicioUtc).lt('autorizado_em', fimUtc)),
    // 36h de folga dos dois lados.
    carregarPagamentos(limitesDiaUtc(somarDias(de, -2)).inicioUtc, limitesDiaUtc(somarDias(ate, 2)).fimUtc),
    lerTudo<Row>(() => supabaseAdmin
      .from('stone_vendas').select('id, pagamento_id').not('pagamento_id', 'is', null)
      .gte('autorizado_em', limitesDiaUtc(somarDias(de, -5)).inicioUtc).lt('autorizado_em', limitesDiaUtc(somarDias(ate, 5)).fimUtc)),
  ]);

  const usados = new Set<string>(jaCasados.map(r => String(r.pagamento_id)));
  const vendas: VendaRow[] = vendasRows.map(r => ({
    id: String(r.id), stone_code: String(r.stone_code), nsu: String(r.nsu), autorizado_em: String(r.autorizado_em),
    modalidade: r.modalidade === 'debito' ? 'debito' : 'credito',
    parcelas: Math.max(1, Number(r.parcelas) || 1), valor_bruto: Number(r.valor_bruto) || 0, valor_cancelado: Number(r.valor_cancelado) || 0,
  }));
  const candidatos: PagamentoRow[] = pagamentos.filter(p =>
    (p.metodo === 'debito' || p.metodo === 'credito') && p.valor > 0 && !usados.has(p.id));

  const pares: Array<{ venda: VendaRow; pagamento: PagamentoRow; dist: number }> = [];
  for (const v of vendas) {
    const tv = new Date(v.autorizado_em).getTime();
    for (const p of candidatos) {
      if (p.metodo !== v.modalidade) continue;
      if (Math.abs(v.valor_bruto - p.valor) > TOLERANCIA) continue;
      if (p.parcelas_informadas && v.modalidade === 'credito' && p.parcelas !== v.parcelas) continue;
      const dist = Math.abs(tv - new Date(p.data_pagamento).getTime());
      if (dist > MAX_DIST_MS) continue;
      pares.push({ venda: v, pagamento: p, dist });
    }
  }
  pares.sort((a, b) => a.dist - b.dist);

  const vendasUsadas = new Set<string>();
  const r: ResultadoCasamento = { casadas: 0, parcelas_copiadas: 0, vendas_sem_par: 0, pagamentos_sem_par: 0, conflitos: 0 };
  for (const par of pares) {
    if (vendasUsadas.has(par.venda.id) || usados.has(par.pagamento.id)) continue;
    const { error } = await supabaseAdmin.from('stone_vendas').update({ pagamento_id: par.pagamento.id }).eq('id', par.venda.id);
    if (error) {
      if (ehConflitoUnico(error)) { r.conflitos++; usados.add(par.pagamento.id); continue; }
      throw new Error(error.message);
    }
    vendasUsadas.add(par.venda.id);
    usados.add(par.pagamento.id);
    r.casadas++;

    if (!par.pagamento.parcelas_informadas) {
      const obs = par.pagamento.observacoes?.includes('parcelas da Stone')
        ? par.pagamento.observacoes
        : [par.pagamento.observacoes, 'parcelas da Stone'].filter(Boolean).join(' · ');
      const { error: e2 } = await supabaseAdmin.from('pagamentos')
        .update({ parcelas: par.venda.parcelas, parcelas_informadas: true, observacoes: obs })
        .eq('id', par.pagamento.id);
      if (e2) console.error('[stone] nao consegui copiar parcelas pro pagamento', par.pagamento.id, e2.message);
      else r.parcelas_copiadas++;
    }
  }
  r.vendas_sem_par = vendas.length - vendasUsadas.size;
  r.pagamentos_sem_par = candidatos.filter(p => !usados.has(p.id)).length;

  if (r.casadas > 0) {
    await registrarEvento({ entidade: 'pagamento', acao: 'stone_casar', usuario_id: usuarioId, depois: { de, ate, ...r } });
  }
  return r;
}

// ------------------------------------------------------------
// Liquidacao <-> linha do extrato da conta adquirente
// ------------------------------------------------------------

/**
 * stone_liquidacoes sem lancamento_id <-> linha positiva da(s) conta(s)
 * adquirente com descricao 'Transferência entre contas Stone' / 'Recebível
 * de Cartão': valor_total +-0,01 e data +-1 dia. Guloso pela menor
 * distancia de data. Grava lancamento_id. Devolve quantas ligou.
 */
export async function ligarLiquidacoesAoExtrato(de: string, ate: string): Promise<number> {
  if (!ehData(de) || !ehData(ate)) throw new ErroFinanceiro(400, 'Período inválido (AAAA-MM-DD).');
  const contas = await carregarContasFinanceiras();
  const adquirentes = contas.filter(c => c.tipo === 'adquirente').map(c => c.id);
  if (adquirentes.length === 0) return 0;

  const [liqRows, linhasRows, usadasRows] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin
      .from('stone_liquidacoes').select('id, data_pagamento, valor_total')
      .is('lancamento_id', null).gte('data_pagamento', de).lte('data_pagamento', ate)),
    lerTudo<Row>(() => supabaseAdmin
      .from('lancamentos_bancarios').select('id, data, descricao, valor')
      .in('conta_id', adquirentes).gt('valor', 0)
      .gte('data', somarDias(de, -1)).lte('data', somarDias(ate, 1))
      .or(FILTRO_ORIGEM_EXTRATO)),
    lerTudo<Row>(() => supabaseAdmin
      .from('stone_liquidacoes').select('id, lancamento_id').not('lancamento_id', 'is', null)
      .gte('data_pagamento', somarDias(de, -3)).lte('data_pagamento', somarDias(ate, 3))),
  ]);

  const linhasUsadas = new Set<string>(usadasRows.map(r => String(r.lancamento_id)));
  const linhas = linhasRows
    .filter(l => ehLinhaCartaoStone(String(l.descricao ?? '')))
    .map(l => ({ id: String(l.id), data: String(l.data), valor: Number(l.valor) || 0 }));

  const diaMs = 24 * 60 * 60 * 1000;
  const pares: Array<{ liq: string; linha: string; dist: number }> = [];
  for (const q of liqRows) {
    const valor = Number(q.valor_total) || 0;
    const td = new Date(`${q.data_pagamento}T00:00:00Z`).getTime();
    for (const l of linhas) {
      if (Math.abs(l.valor - valor) > TOLERANCIA) continue;
      const dist = Math.abs(new Date(`${l.data}T00:00:00Z`).getTime() - td);
      if (dist > diaMs) continue;
      pares.push({ liq: String(q.id), linha: l.id, dist });
    }
  }
  pares.sort((a, b) => a.dist - b.dist);

  const liqUsadas = new Set<string>();
  let ligadas = 0;
  for (const par of pares) {
    if (liqUsadas.has(par.liq) || linhasUsadas.has(par.linha)) continue;
    const { error } = await supabaseAdmin.from('stone_liquidacoes').update({ lancamento_id: par.linha }).eq('id', par.liq);
    if (error) { console.error('[stone] falha ao ligar liquidacao', par.liq, error.message); continue; }
    liqUsadas.add(par.liq);
    linhasUsadas.add(par.linha);
    ligadas++;
  }
  return ligadas;
}

// ------------------------------------------------------------
// Status pra tela
// ------------------------------------------------------------

export async function statusStone(mes: string = mesSP()): Promise<StatusStone> {
  const configurado = stoneConfigurado();
  const vendasMes: StatusStone['vendas_mes'] = { mes, qtd: 0, bruto: 0, liquido: 0, taxas: 0, casadas: 0, sem_par: 0 };
  let ultimas: StoneImportacao[] = [];
  try {
    const { data } = await supabaseAdmin
      .from('stone_importacoes').select('*').order('arquivo_data', { ascending: false }).order('criado_em', { ascending: false }).limit(12);
    ultimas = ((data ?? []) as Row[]).map(mapearImportacao);

    const { inicioUtc, fimUtc } = limitesMesUtc(mes);
    const vendas = await lerTudo<Row>(() => supabaseAdmin
      .from('stone_vendas').select('id, valor_bruto, valor_liquido, taxa_mdr, taxa_antecipacao, pagamento_id')
      .gte('autorizado_em', inicioUtc).lt('autorizado_em', fimUtc));
    for (const v of vendas) {
      vendasMes.qtd++;
      vendasMes.bruto += Number(v.valor_bruto) || 0;
      vendasMes.liquido += Number(v.valor_liquido) || 0;
      vendasMes.taxas += (Number(v.taxa_mdr) || 0) + (Number(v.taxa_antecipacao) || 0);
      if (v.pagamento_id) vendasMes.casadas++;
    }
    vendasMes.sem_par = vendasMes.qtd - vendasMes.casadas;
    vendasMes.bruto = arred2(vendasMes.bruto);
    vendasMes.liquido = arred2(vendasMes.liquido);
    vendasMes.taxas = arred2(vendasMes.taxas);
  } catch (e) {
    console.error('[stone] falha ao montar status:', e);
  }
  return { configurado, stone_codes: configurado ? stoneCodes() : [], ultimas_importacoes: ultimas, vendas_mes: vendasMes };
}

/** Dia (BRT) de uma venda, pra agrupar. */
export const diaDaVenda = (v: { autorizado_em: string }) => dataBRT(v.autorizado_em);
