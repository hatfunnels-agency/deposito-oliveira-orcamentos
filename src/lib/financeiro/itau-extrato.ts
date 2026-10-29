// API Account Statement do Itau (Itau for Developers): puxa o extrato da
// conta corrente direto do banco e grava em lancamentos_bancarios pelo
// mesmo caminho do upload de arquivo (importarLancamentos: dedupe por hash
// e por conteudo, categorizacao, saldo da conta, conciliacao automatica).
// Substitui o xlsx/OFX que o Roger subia a mao; o upload continua como reserva.
//
// Documentacao lida em 29/10/2026 (openapi 1.33.0 + collection do portal):
//   token    producao: POST https://sts.itau.com.br/api/oauth/token  (mTLS: certificado + chave)
//            sandbox:  POST https://sandbox.devportal.itau.com.br/api/oauth/jwt (sem certificado)
//            corpo x-www-form-urlencoded: grant_type=client_credentials&client_id&client_secret
//            resposta { access_token, token_type: 'Bearer', expires_in: 300 }
//   extrato  GET {base}/statements/{statementId}?type=current_account&start_date&end_date&page&page_size
//            statementId = agencia(4) + conta(7) + digito(1) -> ag 3130 cc 0097165-2 = 313000971652
//            headers: Authorization: Bearer, x-itau-apikey: client_id, x-itau-correlationid: uuid
//            producao base: https://account-statement.api.itau.com/account-statement/v1
//            sandbox base:  https://sandbox.devportal.itau.com.br/itau-vw9-api-account-statement-v1-externo/v1
//   resposta { data: { events[], balances[], pending_events[], pagination{page,total_pages} } }
//            — no sandbox `data` vem como LISTA com um item e sem pagination; aceitamos os dois.
//   evento   { id (unico), type: 'lancamento', operation: 'C'|'D', reversal, date{event, accounting},
//              literal{code, shortened, complete}, amount{value}, counterpart{name, document, ...},
//              origin{identifier, type: 'PIX'|..., operation, complement} }
//            counterpart.document pode vir mascarado ("***.456.789-**") -> fica null.
//   saldos   balances[] com type 'saldo_disponivel' por dia (date.event no fim do dia, -03:00).

import { createHash, randomUUID } from 'crypto';
import { request as httpsRequest } from 'https';
import { supabaseAdmin } from '@/lib/supabase';
import type { LancamentoBruto } from '@/lib/extrato-parser';
import type { ResultadoImportacao, StatusItau, TesteItau } from './tipos';
import { dataBRT, ehData, hojeSP, somarDias } from './datas';
import { ErroFinanceiro } from './eventos';
import { importarLancamentos } from './importar-lancamentos';

type Row = Record<string, any>;

const TIMEOUT_MS = 60_000;
const USER_AGENT = 'deposito-oliveira-orcamentos/financeiro (extrato itau)';
const PAGINA = 1000;
const MAX_PAGINAS = 30;
const MAX_DIAS = 92;
const CHAVE_STATUS = 'itau_sincronizacao';
const ROTULO_ARQUIVO = 'Itaú API';

const AMBIENTES = {
  producao: {
    token: 'https://sts.itau.com.br/api/oauth/token',
    base: 'https://account-statement.api.itau.com/account-statement/v1',
  },
  sandbox: {
    token: 'https://sandbox.devportal.itau.com.br/api/oauth/jwt',
    base: 'https://sandbox.devportal.itau.com.br/itau-vw9-api-account-statement-v1-externo/v1',
  },
} as const;
type Ambiente = keyof typeof AMBIENTES;

// ------------------------------------------------------------
// Configuracao (variaveis na Vercel)
// ------------------------------------------------------------

// Certificado/chave em PEM. Na Vercel a variavel pode vir com "\n" literal
// (colado de uma linha so) ou com quebras reais: aceitamos os dois.
const pem = (s: string | undefined): string => (s ?? '').trim().replace(/\\n/g, '\n');

export interface ConfigItau {
  clientId: string;
  clientSecret: string;
  certificado: string;
  chavePrivada: string;
  ambiente: Ambiente;
  statementId: string | null;
}

export function configItau(): ConfigItau {
  const clientId = (process.env.ITAU_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.ITAU_CLIENT_SECRET ?? '').trim();
  const certificado = pem(process.env.ITAU_CERTIFICADO);
  const chavePrivada = pem(process.env.ITAU_CHAVE_PRIVADA);
  const pedido = (process.env.ITAU_AMBIENTE ?? '').trim().toLowerCase();
  const ambiente: Ambiente = pedido === 'sandbox' ? 'sandbox' : pedido === 'producao' ? 'producao' : (certificado && chavePrivada ? 'producao' : 'sandbox');
  const statementId = (process.env.ITAU_STATEMENT_ID ?? '').replace(/\D/g, '') || null;
  return { clientId, clientSecret, certificado, chavePrivada, ambiente, statementId };
}

/** Pronto pra usar: credenciais e, em producao, o certificado mTLS. */
export function itauConfigurado(cfg = configItau()): boolean {
  if (!cfg.clientId || !cfg.clientSecret) return false;
  if (cfg.ambiente === 'producao' && (!cfg.certificado || !cfg.chavePrivada)) return false;
  return true;
}

// ------------------------------------------------------------
// HTTP com certificado de cliente (fetch do Node nao faz mTLS)
// ------------------------------------------------------------

export class ErroHttpItau extends Error {
  status: number;
  corpo: string;
  constructor(status: number, corpo: string) {
    super(`Itaú respondeu HTTP ${status}: ${corpo.slice(0, 300)}`);
    this.name = 'ErroHttpItau';
    this.status = status;
    this.corpo = corpo.slice(0, 300);
  }
}

function requisicao(cfg: ConfigItau, url: string, opts: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<{ status: number; corpo: string }> {
  const u = new URL(url);
  const mtls = cfg.ambiente === 'producao' && cfg.certificado && cfg.chavePrivada;
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opts.method,
      headers: { 'User-Agent': USER_AGENT, ...opts.headers, ...(opts.body ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}) },
      ...(mtls ? { cert: cfg.certificado, key: cfg.chavePrivada } : {}),
      timeout: TIMEOUT_MS,
    }, res => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error(`Itaú não respondeu em ${TIMEOUT_MS / 1000}s`)); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ------------------------------------------------------------
// Token (5 minutos; cache em memoria por instancia)
// ------------------------------------------------------------

let tokenCache: { ambiente: Ambiente; clientId: string; token: string; expiraEm: number } | null = null;

export async function obterToken(cfg = configItau()): Promise<string> {
  if (!itauConfigurado(cfg)) throw new ErroFinanceiro(400, 'API do Itaú não configurada: defina ITAU_CLIENT_ID, ITAU_CLIENT_SECRET e (em produção) ITAU_CERTIFICADO / ITAU_CHAVE_PRIVADA na Vercel.');
  const agora = Date.now();
  if (tokenCache && tokenCache.ambiente === cfg.ambiente && tokenCache.clientId === cfg.clientId && tokenCache.expiraEm > agora + 15_000) return tokenCache.token;

  const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString();
  const r = await requisicao(cfg, AMBIENTES[cfg.ambiente].token, {
    method: 'POST', body: corpo,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  });
  if (r.status < 200 || r.status >= 300) throw new ErroHttpItau(r.status, r.corpo.replace(/\s+/g, ' ').trim());
  let json: Row;
  try { json = JSON.parse(r.corpo); } catch { throw new ErroHttpItau(r.status, `token ilegível: ${r.corpo}`); }
  const token = String(json.access_token ?? '');
  if (!token) throw new ErroHttpItau(r.status, `token sem access_token: ${r.corpo}`);
  const expiresIn = Number(json.expires_in) || 300;
  tokenCache = { ambiente: cfg.ambiente, clientId: cfg.clientId, token, expiraEm: agora + expiresIn * 1000 };
  return token;
}

async function chamarApi(cfg: ConfigItau, caminho: string): Promise<Row> {
  const token = await obterToken(cfg);
  const r = await requisicao(cfg, `${AMBIENTES[cfg.ambiente].base}${caminho}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-itau-apikey': cfg.clientId,
      'x-itau-correlationid': randomUUID(),
      Accept: 'application/json',
    },
  });
  if (r.status === 401) tokenCache = null;
  if (r.status < 200 || r.status >= 300) throw new ErroHttpItau(r.status, r.corpo.replace(/\s+/g, ' ').trim());
  try { return JSON.parse(r.corpo) as Row; } catch { throw new ErroHttpItau(r.status, `resposta ilegível: ${r.corpo.slice(0, 200)}`); }
}

// ------------------------------------------------------------
// Conta do sistema e statementId
// ------------------------------------------------------------

export interface ContaItau { id: string; nome: string; layout: string; agencia: string | null; conta: string | null; statementId: string | null }

export async function contaItau(cfg = configItau()): Promise<ContaItau> {
  const { data, error } = await supabaseAdmin
    .from('contas_financeiras')
    .select('id, nome, layout, agencia, conta, instituicao, ativo')
    .eq('tipo', 'banco').eq('ativo', true)
    .ilike('instituicao', '%itau%')
    .order('nome').limit(1);
  if (error) throw new Error(error.message);
  const c = (data ?? [])[0] as Row | undefined;
  if (!c) throw new ErroFinanceiro(400, 'Nenhuma conta bancária do Itaú ativa em contas_financeiras.');
  // ag(4) + conta(7) + digito(1). Cadastro: agencia '3130', conta '0097165-2'.
  let statementId = cfg.statementId;
  if (!statementId && c.agencia && c.conta) {
    const ag = String(c.agencia).replace(/\D/g, '').padStart(4, '0');
    const [num, dig] = String(c.conta).split('-');
    const n = (num ?? '').replace(/\D/g, '');
    const d = (dig ?? '').replace(/\D/g, '');
    if (ag.length === 4 && n.length >= 1 && n.length <= 7 && d.length === 1) statementId = `${ag}${n.padStart(7, '0')}${d}`;
  }
  return { id: String(c.id), nome: String(c.nome), layout: String(c.layout), agencia: c.agencia ?? null, conta: c.conta ?? null, statementId };
}

// ------------------------------------------------------------
// Extrato -> LancamentoBruto
// ------------------------------------------------------------

export interface ExtratoItau {
  eventos: Row[];
  saldos: Array<{ data: string; saldo: number }>;
  paginas: number;
}

/** Baixa todas as paginas do periodo (eventos + saldos diarios). */
export async function baixarExtrato(cfg: ConfigItau, statementId: string, de: string, ate: string): Promise<ExtratoItau> {
  const eventos: Row[] = [];
  const ids = new Set<string>();
  const saldos = new Map<string, number>();
  let pagina = 1, paginas = 1;
  while (pagina <= paginas && pagina <= MAX_PAGINAS) {
    const q = new URLSearchParams({ type: 'current_account', start_date: de, end_date: ate, page: String(pagina), page_size: String(PAGINA) });
    const json = await chamarApi(cfg, `/statements/${encodeURIComponent(statementId)}?${q.toString()}`);
    const dado: Row = Array.isArray(json.data) ? (json.data[0] ?? {}) : (json.data ?? {});
    // Pagina sem evento novo (o sandbox devolve a mesma pagina sempre): para.
    let novosNaPagina = 0;
    for (const ev of (Array.isArray(dado.events) ? dado.events : [])) {
      const id = String((ev as Row)?.id ?? '');
      if (id && ids.has(id)) continue;
      if (id) ids.add(id);
      eventos.push(ev as Row);
      novosNaPagina++;
    }
    for (const b of (Array.isArray(dado.balances) ? dado.balances : [])) {
      if (String(b?.type) !== 'saldo_disponivel') continue;
      const iso = String(b?.date?.event ?? b?.date?.accounting ?? '');
      const data = ehData(iso) ? iso : (iso ? dataBRT(iso) : '');
      const v = Number(b?.amount?.value);
      if (ehData(data) && Number.isFinite(v)) saldos.set(data, v);
    }
    const totalPaginas = Number(dado.pagination?.total_pages ?? json.pagination?.total_pages);
    paginas = Number.isFinite(totalPaginas) && totalPaginas > 0 ? totalPaginas : 1;
    if (pagina > 1 && novosNaPagina === 0) break;
    pagina++;
  }
  return { eventos, saldos: [...saldos.entries()].map(([data, saldo]) => ({ data, saldo })).sort((a, b) => a.data.localeCompare(b.data)), paginas: pagina - 1 };
}

const limpar = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

function documentoDe(s: unknown): string | null {
  const t = String(s ?? '');
  if (!t || t.includes('*')) return null;
  const d = t.replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? d : null;
}

/**
 * Converte os eventos da API nas linhas que importarLancamentos entende.
 * hash = conta + id do evento (estavel entre chamadas); linhas que o Roger
 * ja subiu pelo xlsx/OFX nao duplicam porque a importacao tambem casa por
 * (data, valor) no periodo.
 */
export function converterEventos(contaId: string, eventos: Row[]): { lancamentos: LancamentoBruto[]; ignoradas: Array<{ linha: number; motivo: string; conteudo: string }> } {
  const lancamentos: LancamentoBruto[] = [];
  const ignoradas: Array<{ linha: number; motivo: string; conteudo: string }> = [];
  const vistos = new Set<string>();
  eventos.forEach((ev, i) => {
    const id = limpar(ev.id);
    const completo = limpar(ev.literal?.complete) || limpar(ev.literal?.shortened);
    const complemento = limpar(ev.origin?.complement);
    const resumo = [completo, complemento].filter(Boolean).join(' | ').slice(0, 90);
    const bruto = Number(ev.amount?.value);
    if (!id) { ignoradas.push({ linha: i + 1, motivo: 'evento sem id', conteudo: resumo }); return; }
    if (vistos.has(id)) { ignoradas.push({ linha: i + 1, motivo: 'evento repetido na resposta', conteudo: resumo }); return; }
    if (!Number.isFinite(bruto) || bruto === 0) { ignoradas.push({ linha: i + 1, motivo: 'valor ilegível ou zero', conteudo: resumo }); return; }
    const contabil = String(ev.date?.accounting ?? '');
    const evento = String(ev.date?.event ?? '');
    const data = ehData(contabil) ? contabil : (evento ? dataBRT(evento) : '');
    if (!ehData(data)) { ignoradas.push({ linha: i + 1, motivo: 'data ilegível', conteudo: resumo }); return; }
    vistos.add(id);
    const op = String(ev.operation ?? '').toUpperCase();
    const valor = Math.round(Math.abs(bruto) * 100) / 100 * (op === 'D' ? -1 : 1);
    const descricao = [completo, complemento && complemento !== completo ? complemento : ''].filter(Boolean).join(' — ') || '(sem descrição)';
    lancamentos.push({
      data,
      descricao,
      contraparte: limpar(ev.counterpart?.name) || null,
      documento: documentoDe(ev.counterpart?.document),
      valor,
      saldo: null,
      tarifa: 0,
      hash_linha: createHash('sha256').update([contaId, 'itau-api', id].join('|')).digest('hex').slice(0, 32),
    });
  });
  return { lancamentos, ignoradas };
}

// ------------------------------------------------------------
// Periodo
// ------------------------------------------------------------

export function periodoPadrao(dias = 7): { de: string; ate: string } {
  const hoje = hojeSP();
  return { de: somarDias(hoje, -dias), ate: hoje };
}

function validarPeriodo(de: unknown, ate: unknown): { de: string; ate: string } {
  if (!ehData(de) || !ehData(ate) || de > ate) throw new ErroFinanceiro(400, 'Informe o período (de, ate) em AAAA-MM-DD.');
  if (ate > hojeSP()) throw new ErroFinanceiro(400, 'A data final não pode ser no futuro.');
  const inicio = new Date(`${de}T00:00:00Z`).getTime(), fim = new Date(`${ate}T00:00:00Z`).getTime();
  if ((fim - inicio) / 86_400_000 > MAX_DIAS) throw new ErroFinanceiro(400, `Período máximo de ${MAX_DIAS} dias por vez.`);
  return { de, ate };
}

// ------------------------------------------------------------
// Testar (nao grava nada) e importar
// ------------------------------------------------------------

export async function testarItau(entrada: { de?: unknown; ate?: unknown }): Promise<TesteItau> {
  const cfg = configItau();
  const conta = await contaItau(cfg);
  if (!conta.statementId) throw new ErroFinanceiro(400, 'Não consegui montar o identificador da conta (agência + conta + dígito). Defina ITAU_STATEMENT_ID.');
  const { de, ate } = ehData(entrada.de) || ehData(entrada.ate) ? validarPeriodo(entrada.de, entrada.ate) : periodoPadrao();
  const extrato = await baixarExtrato(cfg, conta.statementId, de, ate);
  const { lancamentos, ignoradas } = converterEventos(conta.id, extrato.eventos);
  const hashes = lancamentos.map(l => l.hash_linha);
  let jaImportados = 0;
  for (let i = 0; i < hashes.length; i += 500) {
    const { count } = await supabaseAdmin.from('lancamentos_bancarios').select('id', { count: 'exact', head: true }).in('hash_linha', hashes.slice(i, i + 500));
    jaImportados += count ?? 0;
  }
  const entradas = lancamentos.filter(l => l.valor > 0), saidas = lancamentos.filter(l => l.valor < 0);
  return {
    ambiente: cfg.ambiente,
    conta: conta.nome,
    statement_id: conta.statementId,
    periodo: [de, ate],
    eventos: extrato.eventos.length,
    lancamentos: lancamentos.length,
    ja_importados: jaImportados,
    entradas: { qtd: entradas.length, total: Math.round(entradas.reduce((s, l) => s + l.valor, 0) * 100) / 100 },
    saidas: { qtd: saidas.length, total: Math.round(saidas.reduce((s, l) => s + l.valor, 0) * 100) / 100 },
    saldos: extrato.saldos.slice(-5),
    amostra: lancamentos.slice(0, 8).map(l => ({ data: l.data, descricao: l.descricao, contraparte: l.contraparte, valor: l.valor })),
    ignoradas: ignoradas.slice(0, 10),
  };
}

async function gravarStatus(status: Row): Promise<void> {
  const { error } = await supabaseAdmin.from('configuracoes')
    .upsert({ chave: CHAVE_STATUS, valor: JSON.stringify(status), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if (error) console.error('[itau] status nao gravado:', error.message);
}

/**
 * Importa o extrato do periodo. Idempotente: rodar de novo o mesmo periodo
 * nao duplica (hash do evento + conteudo). Sem movimento devolve um
 * resultado vazio sem criar registro de importacao.
 */
export async function importarItau(entrada: { de?: unknown; ate?: unknown }, origemChamada: 'cron' | 'manual'): Promise<ResultadoImportacao> {
  const cfg = configItau();
  const conta = await contaItau(cfg);
  if (!conta.statementId) throw new ErroFinanceiro(400, 'Não consegui montar o identificador da conta (agência + conta + dígito). Defina ITAU_STATEMENT_ID.');
  const { de, ate } = ehData(entrada.de) || ehData(entrada.ate) ? validarPeriodo(entrada.de, entrada.ate) : periodoPadrao();
  const em = new Date().toISOString();
  try {
    const extrato = await baixarExtrato(cfg, conta.statementId, de, ate);
    const { lancamentos, ignoradas } = converterEventos(conta.id, extrato.eventos);
    // Saldo: o ultimo dia fechado do periodo (hoje ainda esta aberto).
    const saldoFinal = [...extrato.saldos].reverse().find(s => s.data <= ate && s.data < hojeSP()) ?? null;

    let resultado: ResultadoImportacao;
    if (lancamentos.length === 0) {
      resultado = {
        importacao_id: null, conta: conta.nome, periodo: [de, ate], total: 0, novos: 0, duplicados: 0, duplicados_por_conteudo: 0,
        classificados_por_regra: 0, classificados_por_ia: 0, sem_categoria: 0, a_revisar: 0, ignoradas, conciliacao: null, saldo_registrado: null,
        mensagem: 'Sem movimento no período.',
      };
    } else {
      const hashArquivo = createHash('sha256').update(lancamentos.map(l => l.hash_linha).join(',')).digest('hex');
      resultado = await importarLancamentos({
        conta: { id: conta.id, nome: conta.nome, layout: conta.layout },
        lancamentos,
        origem: 'conector',
        arquivo: { nome: `${ROTULO_ARQUIVO} ${de} a ${ate}`, hash: hashArquivo },
        saldo_final: saldoFinal,
        ignoradas,
      });
    }
    await gravarStatus({ em, ok: true, origem: origemChamada, ambiente: cfg.ambiente, de, ate, total: resultado.total, novos: resultado.novos, erro: null });
    return resultado;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    await gravarStatus({ em, ok: false, origem: origemChamada, ambiente: cfg.ambiente, de, ate, total: 0, novos: 0, erro: msg });
    throw e;
  }
}

// ------------------------------------------------------------
// Status para a tela
// ------------------------------------------------------------

export async function statusItau(): Promise<StatusItau> {
  const cfg = configItau();
  const configurado = itauConfigurado(cfg);
  let conta: StatusItau['conta'] = null;
  try {
    const c = await contaItau(cfg);
    conta = { nome: c.nome, agencia: c.agencia, conta: c.conta, statement_id: c.statementId };
  } catch { conta = null; }
  const [{ data: st }, { data: imps }] = await Promise.all([
    supabaseAdmin.from('configuracoes').select('valor').eq('chave', CHAVE_STATUS).maybeSingle(),
    conta
      ? supabaseAdmin.from('extratos_importacoes').select('id, arquivo_nome, periodo_inicio, periodo_fim, linhas_total, linhas_novas, criado_em')
          .like('arquivo_nome', `${ROTULO_ARQUIVO}%`).order('criado_em', { ascending: false }).limit(6)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  let ultima: StatusItau['ultima_sincronizacao'] = null;
  if (st?.valor) { try { ultima = JSON.parse(String(st.valor)); } catch { ultima = null; } }
  return {
    configurado,
    ambiente: cfg.ambiente,
    falta: configurado ? [] : [
      ...(!cfg.clientId ? ['ITAU_CLIENT_ID'] : []),
      ...(!cfg.clientSecret ? ['ITAU_CLIENT_SECRET'] : []),
      ...(cfg.ambiente === 'producao' && !cfg.certificado ? ['ITAU_CERTIFICADO'] : []),
      ...(cfg.ambiente === 'producao' && !cfg.chavePrivada ? ['ITAU_CHAVE_PRIVADA'] : []),
    ],
    conta,
    ultima_sincronizacao: ultima,
    importacoes: ((imps ?? []) as Row[]).map(i => ({
      id: String(i.id), arquivo_nome: String(i.arquivo_nome), periodo_inicio: i.periodo_inicio ?? null, periodo_fim: i.periodo_fim ?? null,
      linhas_total: Number(i.linhas_total) || 0, linhas_novas: Number(i.linhas_novas) || 0, criado_em: String(i.criado_em),
    })),
  };
}
