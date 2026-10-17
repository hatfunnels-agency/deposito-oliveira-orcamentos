// Contas a pagar: cada boleto, parcela ou fatura, de pendente a pago.
//
// Regras que o resto da lib depende daqui:
//   - pago nao se apaga: estorno volta a conta pra pendente e deixa rastro;
//   - o par conta <-> linha (extrato, caixa, cartao) mora SO em
//     lancamentos_bancarios.conta_pagar_id; ContaPagar.lancamento_id e join
//     reverso;
//   - pagar em dinheiro ou no cartao da empresa CRIA a linha (ja vinculada);
//     pagar por banco nao cria nada — o extrato chega e a conciliacao liga;
//   - fatura de cartao (categoria grupo 'transferencia') e caixa a sair, mas
//     nunca despesa: a despesa entrou na compra, no dia da compra.

import { createHash, randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import type {
  Categoria, ContaPagar, FiltroContasPagar, Fornecedor, GrupoCategoria, GrupoGestao, Metodo, NovaContaPagar,
  OrigemContaPagar, PagamentoConta, ResumoContasPagar, SituacaoConta, StatusContaPagar, TipoConta, TipoFornecedor,
} from './tipos';
import {
  arred2, clampDiaDoMes, diasEntre, ehData, hojeSP, inicioFimMes, mesAnterior, mesDe, mesSeguinte, primeiroDiaDoMes,
  rotuloMes, somarDias, somarMeses,
} from './datas';
import { ErroFinanceiro, ehConflitoUnico, registrarEvento } from './eventos';
import { carregarContasFinanceiras, contaPorTipo } from './saldos';
import { normalizar } from '@/lib/categorizacao';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;
const lista = (v: unknown): Row[] => (Array.isArray(v) ? v : v ? [v as Row] : []);

export const METODOS: Metodo[] = ['pix', 'dinheiro', 'credito', 'debito', 'boleto', 'transferencia', 'outro'];
export const CATEGORIA_FATURA = 'Pagamento de fatura de cartao';
export const CATEGORIA_FOLHA = 'Folha - Salario';

/** Hash de linha criada pela propria lib (nao veio de arquivo): conta|tipo|id. */
export function hashInterno(contaId: string, tipo: string, id: string): string {
  return createHash('sha256').update(`${contaId}|${tipo}|${id}`).digest('hex').slice(0, 32);
}

// ------------------------------------------------------------
// Categorias e fornecedores (compartilhados pela lib)
// ------------------------------------------------------------

export async function carregarCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabaseAdmin
    .from('categorias_financeiras')
    .select('id, nome, grupo, grupo_gestao, entra_no_dre')
    .order('ordem');
  if (error) throw new Error(error.message);
  return ((data || []) as Row[]).map(c => ({
    id: String(c.id),
    nome: String(c.nome),
    grupo: c.grupo as GrupoCategoria,
    grupo_gestao: (c.grupo_gestao as GrupoGestao | null) ?? null,
    entra_no_dre: c.entra_no_dre !== false,
  }));
}

export function categoriaPorNome(categorias: Categoria[], nome: string): Categoria | null {
  const alvo = normalizar(nome);
  return categorias.find(c => normalizar(c.nome) === alvo) ?? null;
}

function mapearFornecedor(r: Row): Fornecedor {
  const cat = um<Row>(r.categorias_financeiras);
  return {
    id: String(r.id),
    nome: String(r.nome),
    documentos: Array.isArray(r.documentos) ? r.documentos.map(String) : [],
    tipo: (r.tipo as TipoFornecedor) || 'fornecedor',
    categoria_padrao_id: r.categoria_padrao_id ? String(r.categoria_padrao_id) : null,
    categoria_padrao_nome: cat?.nome ? String(cat.nome) : null,
    conta_padrao_id: r.conta_padrao_id ? String(r.conta_padrao_id) : null,
    metodo_padrao: (r.metodo_padrao as Metodo | null) ?? null,
    observacoes: (r.observacoes as string | null) ?? null,
    ativo: r.ativo !== false,
  };
}

export const SELECT_FORNECEDOR = '*, categorias_financeiras ( nome )';

export async function carregarFornecedores(incluirInativos = false): Promise<Fornecedor[]> {
  const rows = await lerTudo<Row>(() => {
    let q = supabaseAdmin.from('fornecedores').select(SELECT_FORNECEDOR).order('nome');
    if (!incluirInativos) q = q.eq('ativo', true);
    return q;
  });
  return rows.map(mapearFornecedor);
}

/**
 * Busca por nome (sem distinguir maiusculas) ou cria. O indice unico e em
 * lower(nome) — expressao, que o upsert do PostgREST nao enxerga —, por isso
 * insert e, no 23505 (dois pedidos ao mesmo tempo), releitura.
 */
export async function obterOuCriarFornecedor(
  nome: string,
  extras: { tipo?: TipoFornecedor; categoria_padrao_id?: string | null } = {},
): Promise<Fornecedor> {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) throw new ErroFinanceiro(400, 'Informe o nome do fornecedor.');
  const buscar = async () => {
    const { data } = await supabaseAdmin.from('fornecedores').select(SELECT_FORNECEDOR).ilike('nome', limpo).limit(1).maybeSingle();
    return data ? mapearFornecedor(data as Row) : null;
  };
  const achado = await buscar();
  if (achado) return achado;
  const { data, error } = await supabaseAdmin
    .from('fornecedores')
    .insert({ nome: limpo, tipo: extras.tipo ?? 'fornecedor', categoria_padrao_id: extras.categoria_padrao_id ?? null })
    .select(SELECT_FORNECEDOR)
    .single();
  if (error) {
    if (ehConflitoUnico(error)) {
      const denovo = await buscar();
      if (denovo) return denovo;
    }
    throw new Error(error.message);
  }
  return mapearFornecedor(data as Row);
}

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------

// lancamentos_bancarios tem duas FKs pra contas_pagar (conta_pagar_id e
// fatura_id): o join reverso precisa dizer qual.
export const SELECT_CONTA_PAGAR =
  '*, fornecedores ( nome ), categorias_financeiras ( nome, grupo, grupo_gestao ), contas_financeiras ( nome, tipo ), ' +
  'lancamentos_bancarios!conta_pagar_id ( id, conta_id, data, valor )';

export function situacaoConta(
  c: { status: StatusContaPagar; vencimento: string; precisa_confirmacao: boolean },
  hoje: string,
): SituacaoConta {
  if (c.status === 'pago') return 'paga';
  if (c.status === 'cancelado') return 'cancelada';
  if (c.precisa_confirmacao) return 'confirmar';
  if (c.vencimento < hoje) return 'atrasada';
  if (c.vencimento === hoje) return 'hoje';
  return 'a_vencer';
}

export function origemDaConta(r: { despesa_fixa_id?: string | null; chave_recorrencia?: string | null }): OrigemContaPagar {
  if (r.despesa_fixa_id) return 'fixa';
  if (String(r.chave_recorrencia ?? '').startsWith('fatura:')) return 'fatura';
  return 'manual';
}

export function mapearContaPagar(r: Row, hoje: string = hojeSP()): ContaPagar {
  const forn = um<Row>(r.fornecedores);
  const cat = um<Row>(r.categorias_financeiras);
  const conta = um<Row>(r.contas_financeiras);
  const lanc = lista(r.lancamentos_bancarios)[0] ?? null;
  const status = (r.status as StatusContaPagar) || 'pendente';
  const vencimento = String(r.vencimento);
  // "Ja pagou?" so faz sentido para o que ja venceu: se o vencimento foi
  // movido para hoje ou depois, a conta volta a ser uma conta normal.
  const precisa = r.precisa_confirmacao === true && vencimento < hoje;
  return {
    id: String(r.id),
    descricao: String(r.descricao ?? ''),
    fornecedor_id: r.fornecedor_id ? String(r.fornecedor_id) : null,
    fornecedor_nome: forn?.nome ? String(forn.nome) : null,
    categoria_id: r.categoria_id ? String(r.categoria_id) : null,
    categoria_nome: cat?.nome ? String(cat.nome) : null,
    categoria_grupo: (cat?.grupo as GrupoCategoria | undefined) ?? null,
    grupo_gestao: (cat?.grupo_gestao as GrupoGestao | undefined) ?? null,
    valor: arred2(Number(r.valor)),
    vencimento,
    competencia: String(r.competencia),
    status,
    situacao: situacaoConta({ status, vencimento, precisa_confirmacao: precisa }, hoje),
    dias_atraso: status === 'pendente' && vencimento < hoje ? diasEntre(vencimento, hoje) : 0,
    data_pagamento: r.data_pagamento ? String(r.data_pagamento) : null,
    valor_pago: r.valor_pago == null ? null : arred2(Number(r.valor_pago)),
    ajuste: arred2(Number(r.ajuste) || 0),
    metodo_pagamento: (r.metodo_pagamento as Metodo | null) ?? null,
    conta_id: r.conta_id ? String(r.conta_id) : null,
    conta_nome: conta?.nome ? String(conta.nome) : null,
    conta_tipo: (conta?.tipo as TipoConta | undefined) ?? null,
    lancamento_id: lanc?.id ? String(lanc.id) : null,
    despesa_fixa_id: r.despesa_fixa_id ? String(r.despesa_fixa_id) : null,
    origem: origemDaConta(r),
    chave_recorrencia: (r.chave_recorrencia as string | null) ?? null,
    grupo_parcelas_id: r.grupo_parcelas_id ? String(r.grupo_parcelas_id) : null,
    parcela_num: r.parcela_num == null ? null : Number(r.parcela_num),
    parcelas_total: r.parcelas_total == null ? null : Number(r.parcelas_total),
    editada_manualmente: r.editada_manualmente === true,
    precisa_confirmacao: precisa,
    documento: (r.documento as string | null) ?? null,
    observacoes: (r.observacoes as string | null) ?? null,
    estornado_em: r.estornado_em ? String(r.estornado_em) : null,
    estorno_motivo: (r.estorno_motivo as string | null) ?? null,
    criado_em: String(r.criado_em ?? ''),
  };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lerConta(id: string): Promise<Row> {
  // O id entra interpolado em filtros .or(...) mais abaixo: so uuid passa.
  if (!RE_UUID.test(String(id))) throw new ErroFinanceiro(400, 'Id de conta inválido.');
  const { data, error } = await supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_PAGAR).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErroFinanceiro(404, 'Conta a pagar não encontrada.');
  return data as Row;
}

export async function buscarContaPagar(id: string): Promise<ContaPagar> {
  return mapearContaPagar(await lerConta(id));
}

export async function listarContasPagar(f: FiltroContasPagar = {}): Promise<ContaPagar[]> {
  const hoje = hojeSP();
  const rows = await lerTudo<Row>(() => {
    let q = supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_PAGAR);
    if (f.status && f.status !== 'todas') q = q.eq('status', f.status);
    if (f.de) q = q.gte('vencimento', f.de);
    if (f.ate) q = q.lte('vencimento', f.ate);
    if (f.competencia) {
      const { inicio, fim } = inicioFimMes(f.competencia.slice(0, 7));
      q = q.gte('competencia', inicio).lte('competencia', fim);
    }
    if (f.fornecedor_id) q = q.eq('fornecedor_id', f.fornecedor_id);
    if (f.categoria_id) q = q.eq('categoria_id', f.categoria_id);
    if (f.confirmar) q = q.eq('precisa_confirmacao', true).eq('status', 'pendente');
    return q.order('vencimento', { ascending: true }).order('criado_em', { ascending: true });
  });
  let contas = rows.map(r => mapearContaPagar(r, hoje));
  if (f.busca && f.busca.trim()) {
    // Busca em memoria: o nome do fornecedor esta na tabela embutida e um
    // filtro la excluiria conta sem fornecedor.
    const alvo = normalizar(f.busca);
    contas = contas.filter(c =>
      normalizar(c.descricao).includes(alvo)
      || normalizar(c.fornecedor_nome).includes(alvo)
      || normalizar(c.categoria_nome).includes(alvo)
      || normalizar(c.documento).includes(alvo)
      || normalizar(c.observacoes).includes(alvo));
  }
  return contas;
}

/** Contas pagas com data_pagamento em [de, ate] (inclusive). */
export async function contasPagasNoPeriodo(de: string, ate: string): Promise<ContaPagar[]> {
  const hoje = hojeSP();
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('contas_pagar')
    .select(SELECT_CONTA_PAGAR)
    .eq('status', 'pago')
    .gte('data_pagamento', de)
    .lte('data_pagamento', ate)
    .order('data_pagamento', { ascending: true }));
  return rows.map(r => mapearContaPagar(r, hoje));
}

/** Contas pagas com competencia no mes 'YYYY-MM' (independente de quando foram pagas). */
export async function contasPagasPorCompetencia(mes: string): Promise<ContaPagar[]> {
  const hoje = hojeSP();
  const { inicio, fim } = inicioFimMes(mes);
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('contas_pagar')
    .select(SELECT_CONTA_PAGAR)
    .eq('status', 'pago')
    .gte('competencia', inicio)
    .lte('competencia', fim));
  return rows.map(r => mapearContaPagar(r, hoje));
}

/**
 * Resumo da tela e do Panorama. Atrasado so conta conta confirmada (a
 * retroativa ainda em "ja pagou?" fica em a_confirmar). Faixas: hoje =
 * vence hoje; 7d = (hoje, hoje+7]; 30d = (hoje, hoje+30] (inclui os 7d).
 * Fatura de cartao e caixa a sair (entra nas faixas e no pendente_total),
 * mas nao e despesa (fica fora de pago_no_mes).
 */
export async function resumoContasPagar(hoje: string = hojeSP()): Promise<ResumoContasPagar> {
  const mes = mesDe(hoje);
  const { inicio, fim } = inicioFimMes(mes);
  const [pendentes, pagas] = await Promise.all([
    listarContasPagar({ status: 'pendente' }),
    contasPagasNoPeriodo(inicio, fim),
  ]);
  const d7 = somarDias(hoje, 7);
  const d30 = somarDias(hoje, 30);
  const soma = (xs: ContaPagar[]) => arred2(xs.reduce((a, c) => a + c.valor, 0));
  const atrasadas = pendentes.filter(c => c.vencimento < hoje && !c.precisa_confirmacao);
  const deHoje = pendentes.filter(c => c.vencimento === hoje);
  return {
    atrasado: soma(atrasadas),
    qtd_atrasadas: atrasadas.length,
    hoje: soma(deHoje),
    qtd_hoje: deHoje.length,
    proximos_7d: soma(pendentes.filter(c => c.vencimento > hoje && c.vencimento <= d7)),
    proximos_30d: soma(pendentes.filter(c => c.vencimento > hoje && c.vencimento <= d30)),
    // Retroativa em "ja pagou?" quase sempre ja foi paga: fica fora do total (esta em a_confirmar).
    pendente_total: soma(pendentes.filter(c => !c.precisa_confirmacao)),
    pago_no_mes: arred2(pagas
      .filter(c => c.categoria_grupo !== 'transferencia')
      .reduce((a, c) => a + (c.valor_pago ?? c.valor), 0)),
    a_confirmar: pendentes.filter(c => c.precisa_confirmacao).length,
  };
}

// ------------------------------------------------------------
// Criar / editar
// ------------------------------------------------------------

function validarValor(v: unknown, campo = 'Valor'): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ErroFinanceiro(400, `${campo} inválido: informe um número maior que zero.`);
  return arred2(n);
}

function validarMetodo(m: unknown): Metodo {
  if (!METODOS.includes(m as Metodo)) throw new ErroFinanceiro(400, `Método de pagamento inválido: ${String(m)}.`);
  return m as Metodo;
}

async function resolverFornecedor(dados: { fornecedor_id?: string | null; fornecedor_nome?: string }): Promise<Fornecedor | null> {
  if (dados.fornecedor_id) {
    const { data } = await supabaseAdmin.from('fornecedores').select(SELECT_FORNECEDOR).eq('id', dados.fornecedor_id).maybeSingle();
    if (!data) throw new ErroFinanceiro(404, 'Fornecedor não encontrado.');
    return mapearFornecedor(data as Row);
  }
  if (dados.fornecedor_nome && dados.fornecedor_nome.trim()) return obterOuCriarFornecedor(dados.fornecedor_nome);
  return null;
}

/**
 * Cria uma conta ou, com parcelas > 1, N contas mensais do mesmo grupo.
 * `valor` e o valor de CADA parcela (a tela rotula assim). A chave
 * 'parcelado:<grupo>:<n>' torna o parcelado idempotente: reenviar o mesmo
 * grupo_parcelas_id nao duplica. Com `pagamento`, a conta ja nasce paga.
 */
export async function criarContaPagar(dados: NovaContaPagar, usuarioId: string | null): Promise<ContaPagar[]> {
  const descricao = String(dados.descricao ?? '').trim();
  if (!descricao) throw new ErroFinanceiro(400, 'Descreva a conta.');
  const valor = validarValor(dados.valor);
  if (!ehData(dados.vencimento)) throw new ErroFinanceiro(400, 'Vencimento inválido (AAAA-MM-DD).');
  const parcelas = Math.trunc(Number(dados.parcelas) || 1);
  if (parcelas < 1 || parcelas > 120) throw new ErroFinanceiro(400, 'Número de parcelas inválido (1 a 120).');
  if (dados.competencia && !/^\d{4}-\d{2}(-\d{2})?$/.test(dados.competencia)) {
    throw new ErroFinanceiro(400, 'Competência inválida (AAAA-MM).');
  }
  if (dados.pagamento) validarMetodo(dados.pagamento.metodo_pagamento);

  const fornecedor = await resolverFornecedor(dados);
  const categoriaId = dados.categoria_id ?? fornecedor?.categoria_padrao_id ?? null;
  const competenciaBase = primeiroDiaDoMes(dados.competencia ?? dados.vencimento);
  const dia = Number(dados.vencimento.slice(8, 10));
  const grupo = parcelas > 1 ? (dados.grupo_parcelas_id || randomUUID()) : null;

  const linhas: Row[] = [];
  for (let n = 1; n <= parcelas; n++) {
    const vencimento = n === 1 ? dados.vencimento : clampDiaDoMes(somarMeses(mesDe(dados.vencimento), n - 1), dia);
    linhas.push({
      descricao: parcelas > 1 ? `${descricao} (${n}/${parcelas})` : descricao,
      fornecedor_id: fornecedor?.id ?? null,
      categoria_id: categoriaId,
      valor,
      vencimento,
      competencia: parcelas > 1 ? `${somarMeses(mesDe(competenciaBase), n - 1)}-01` : competenciaBase,
      status: 'pendente',
      chave_recorrencia: grupo ? `parcelado:${grupo}:${n}` : null,
      grupo_parcelas_id: grupo,
      parcela_num: grupo ? n : null,
      parcelas_total: grupo ? parcelas : null,
      documento: dados.documento?.trim() || null,
      observacoes: dados.observacoes?.trim() || null,
      criado_por: usuarioId,
    });
  }

  // ignoreDuplicates: parcela ja existente (reenvio) nao gera erro nem copia;
  // o retorno traz so o que entrou agora.
  const { data: inseridas, error } = await supabaseAdmin
    .from('contas_pagar')
    .upsert(linhas, { onConflict: 'chave_recorrencia', ignoreDuplicates: true })
    .select('id, parcela_num');
  if (error) throw new Error(error.message);
  const novas = (inseridas || []) as Row[];
  const idsNovas = novas.map(r => String(r.id));

  for (const id of idsNovas) {
    await registrarEvento({ entidade: 'conta_pagar', entidade_id: id, acao: 'criar', depois: { descricao, valor, parcelas, grupo }, usuario_id: usuarioId });
  }
  // "Ja paguei" num parcelado quita SO a 1a parcela; as demais nascem pendentes.
  if (dados.pagamento) {
    const primeira = novas.find(r => r.parcela_num == null || Number(r.parcela_num) === 1);
    if (primeira) await pagarConta(String(primeira.id), dados.pagamento, usuarioId);
  }

  const ids = grupo
    ? (await lerTudo<Row>(() => supabaseAdmin.from('contas_pagar').select('id').eq('grupo_parcelas_id', grupo))).map(r => String(r.id))
    : idsNovas;
  const rows = await lerTudoEmLotes<Row>(ids, lote => supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_PAGAR).in('id', lote));
  const hoje = hojeSP();
  return rows.map(r => mapearContaPagar(r, hoje)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/**
 * Edita uma conta. Pendente: tudo; paga: so documento/observacoes (valor e
 * data de uma conta paga se corrigem estornando). Mexer em valor ou
 * vencimento marca editada_manualmente: a despesa fixa para de sobrescrever.
 */
export async function atualizarContaPagar(id: string, dados: Partial<NovaContaPagar>, usuarioId: string | null): Promise<ContaPagar> {
  const atual = await lerConta(id);
  const update: Row = {};
  if (dados.documento !== undefined) update.documento = dados.documento?.trim() || null;
  if (dados.observacoes !== undefined) update.observacoes = dados.observacoes?.trim() || null;

  const mexeNoResto = ['descricao', 'fornecedor_id', 'fornecedor_nome', 'categoria_id', 'valor', 'vencimento', 'competencia']
    .some(k => (dados as Row)[k] !== undefined);
  if (atual.status === 'cancelado') throw new ErroFinanceiro(409, 'Conta cancelada não pode ser editada.');
  if (atual.status === 'pago' && mexeNoResto) {
    throw new ErroFinanceiro(409, 'Conta paga: estorne o pagamento antes de alterar valor, data ou fornecedor.');
  }

  if (atual.status === 'pendente') {
    if (dados.descricao !== undefined) {
      const d = String(dados.descricao).trim();
      if (!d) throw new ErroFinanceiro(400, 'Descreva a conta.');
      update.descricao = d;
    }
    if (dados.fornecedor_id !== undefined || dados.fornecedor_nome !== undefined) {
      const f = await resolverFornecedor({ fornecedor_id: dados.fornecedor_id, fornecedor_nome: dados.fornecedor_nome });
      update.fornecedor_id = f?.id ?? null;
    }
    if (dados.categoria_id !== undefined) update.categoria_id = dados.categoria_id || null;
    if (dados.valor !== undefined) {
      update.valor = validarValor(dados.valor);
      if (update.valor !== arred2(Number(atual.valor))) update.editada_manualmente = true;
    }
    if (dados.vencimento !== undefined) {
      if (!ehData(dados.vencimento)) throw new ErroFinanceiro(400, 'Vencimento inválido (AAAA-MM-DD).');
      update.vencimento = dados.vencimento;
      if (dados.vencimento !== String(atual.vencimento)) update.editada_manualmente = true;
    }
    if (dados.competencia !== undefined) {
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(dados.competencia))) throw new ErroFinanceiro(400, 'Competência inválida (AAAA-MM).');
      update.competencia = primeiroDiaDoMes(String(dados.competencia));
    }
  }

  if (Object.keys(update).length === 0) return mapearContaPagar(atual);
  const { error } = await supabaseAdmin.from('contas_pagar').update(update).eq('id', id);
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'conta_pagar', entidade_id: id, acao: 'editar', antes: resumoEvento(atual), depois: update, usuario_id: usuarioId });
  return buscarContaPagar(id);
}

function resumoEvento(r: Row): Row {
  return {
    status: r.status, valor: r.valor, vencimento: r.vencimento, data_pagamento: r.data_pagamento ?? null,
    valor_pago: r.valor_pago ?? null, metodo_pagamento: r.metodo_pagamento ?? null, conta_id: r.conta_id ?? null,
    editada_manualmente: r.editada_manualmente ?? false, precisa_confirmacao: r.precisa_confirmacao ?? false,
  };
}

/** Linha padrao criada pela lib (caixa, cartao, fatura): revisada e ja conciliada. */
function linhaInterna(base: Row): Row {
  return {
    saldo: null,
    tarifa: 0,
    categoria_origem: 'manual',
    categoria_confianca: 1,
    revisado: true,
    origem_lancamento: 'conta_pagar',
    conciliado_em: new Date().toISOString(),
    conciliacao_origem: 'auto',
    ...base,
  };
}

async function gravarLinhaInterna(linha: Row): Promise<void> {
  // Reexecucao (pagar de novo apos estorno) encontra o hash livre, porque o
  // estorno apagou a linha; se algo sobrou, o upsert a refresca.
  const { error } = await supabaseAdmin.from('lancamentos_bancarios').upsert(linha, { onConflict: 'hash_linha' });
  if (error) throw new Error(error.message);
}

/**
 * Marca a conta como paga e cuida da linha correspondente:
 *   dinheiro (ou conta de tipo caixa) -> linha negativa no caixa, vinculada
 *   cartao de credito                  -> linha negativa na conta do cartao (vira fatura)
 *   banco/adquirente                   -> sem linha; com opcoes.lancamento_id, vincula
 *                                         a linha do extrato que pagou
 *   fatura (grupo 'transferencia', chave 'fatura:') -> alem do acima, linha
 *                                         POSITIVA no cartao (fatura_id) pra o saldo
 *                                         do cartao fechar
 */
export async function pagarConta(
  id: string,
  pg: PagamentoConta,
  usuarioId: string | null,
  opcoes: { lancamento_id?: string; conciliacao_origem?: 'auto' | 'manual' } = {},
): Promise<ContaPagar> {
  const atual = await lerConta(id);
  if (atual.status !== 'pendente') {
    throw new ErroFinanceiro(409, atual.status === 'pago' ? 'Essa conta já está paga.' : 'Conta cancelada não pode ser paga.');
  }
  const metodo = validarMetodo(pg.metodo_pagamento);
  const dataPagamento = pg.data_pagamento ?? hojeSP();
  if (!ehData(dataPagamento)) throw new ErroFinanceiro(400, 'Data de pagamento inválida (AAAA-MM-DD).');
  if (dataPagamento > hojeSP()) throw new ErroFinanceiro(400, 'A data do pagamento não pode ser no futuro. Marque como paga quando pagar.');
  const valor = arred2(Number(atual.valor));
  const valorPago = pg.valor_pago == null ? valor : validarValor(pg.valor_pago, 'Valor pago');

  const contas = await carregarContasFinanceiras();
  let conta = pg.conta_id ? contas.find(c => c.id === pg.conta_id) ?? null : null;
  if (pg.conta_id && !conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada.');
  if (metodo === 'dinheiro' || conta?.tipo === 'caixa') {
    conta = await contaPorTipo('caixa', contas);
    if (!conta) throw new ErroFinanceiro(400, 'Não existe conta de caixa cadastrada.');
  }

  const forn = um<Row>(atual.fornecedores);
  const cat = um<Row>(atual.categorias_financeiras);
  const fornecedorNome = forn?.nome ? String(forn.nome) : null;
  const chave = String(atual.chave_recorrencia ?? '');
  const ehFatura = cat?.grupo === 'transferencia' && chave.startsWith('fatura:');

  // 1. Linha primeiro: se o vinculo falhar (23505), a conta continua pendente.
  const hashesGravados: string[] = [];
  if (opcoes.lancamento_id && conta && (conta.tipo === 'banco' || conta.tipo === 'adquirente')) {
    const { error } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .update({
        conta_pagar_id: id,
        conciliado_em: new Date().toISOString(),
        conciliacao_origem: opcoes.conciliacao_origem ?? 'auto',
        ...(atual.categoria_id ? { categoria_id: atual.categoria_id, categoria_origem: 'regra', categoria_confianca: 1 } : {}),
        revisado: true,
      })
      .eq('id', opcoes.lancamento_id);
    if (error) {
      if (ehConflitoUnico(error)) throw new ErroFinanceiro(409, 'Essa linha do extrato já está vinculada a outra conta.');
      throw new Error(error.message);
    }
  } else if (conta && (conta.tipo === 'caixa' || conta.tipo === 'cartao_credito' || conta.tipo === 'carteira')) {
    let documento: string | null = null;
    if (atual.fornecedor_id) {
      const { data: f } = await supabaseAdmin.from('fornecedores').select('documentos').eq('id', atual.fornecedor_id).maybeSingle();
      documento = Array.isArray(f?.documentos) && f.documentos.length ? String(f.documentos[0]) : null;
    }
    const hash = hashInterno(conta.id, 'cp', id);
    await gravarLinhaInterna(linhaInterna({
      conta_id: conta.id,
      data: dataPagamento,
      descricao: fornecedorNome ? `${atual.descricao} — ${fornecedorNome}` : String(atual.descricao),
      contraparte: fornecedorNome,
      documento,
      valor: -valorPago,
      hash_linha: hash,
      categoria_id: atual.categoria_id ?? null,
      conta_pagar_id: id,
    }));
    hashesGravados.push(hash);
  }

  if (ehFatura) {
    // 'fatura:<conta_cartao>:<mes>'
    const cartaoId = chave.split(':')[1];
    const cartao = contas.find(c => c.id === cartaoId);
    if (cartao) {
      const categorias = await carregarCategorias();
      const catFatura = categoriaPorNome(categorias, CATEGORIA_FATURA);
      const hash = hashInterno(cartao.id, 'fat', id);
      await gravarLinhaInterna(linhaInterna({
        conta_id: cartao.id,
        data: dataPagamento,
        descricao: `Pagamento da fatura — ${rotuloMes(chave.split(':')[2] ?? mesDe(dataPagamento))}`,
        contraparte: cartao.nome,
        documento: null,
        valor: valorPago,
        hash_linha: hash,
        categoria_id: catFatura?.id ?? null,
        fatura_id: id,
      }));
      hashesGravados.push(hash);
    }
  }

  // 2. A conta.
  const update: Row = {
    status: 'pago',
    data_pagamento: dataPagamento,
    valor_pago: valorPago,
    ajuste: arred2(valorPago - valor),
    metodo_pagamento: metodo,
    conta_id: conta?.id ?? null,
    precisa_confirmacao: false,
    estornado_em: null,
    estorno_motivo: null,
  };
  if (pg.observacoes !== undefined && pg.observacoes !== null && String(pg.observacoes).trim()) {
    update.observacoes = String(pg.observacoes).trim();
  }
  const { error: errConta } = await supabaseAdmin.from('contas_pagar').update(update).eq('id', id).eq('status', 'pendente');
  if (errConta) {
    if (hashesGravados.length) await supabaseAdmin.from('lancamentos_bancarios').delete().in('hash_linha', hashesGravados);
    if (opcoes.lancamento_id) {
      await supabaseAdmin.from('lancamentos_bancarios').update({ conta_pagar_id: null, conciliado_em: null, conciliacao_origem: null }).eq('id', opcoes.lancamento_id);
    }
    throw new Error(errConta.message);
  }

  // 3. O modal "Paguei" do proximo mes abre com esta conta/metodo.
  if (atual.fornecedor_id) {
    await supabaseAdmin.from('fornecedores').update({ conta_padrao_id: conta?.id ?? null, metodo_padrao: metodo }).eq('id', atual.fornecedor_id);
  }

  await registrarEvento({
    entidade: 'conta_pagar', entidade_id: id, acao: 'pagar', antes: resumoEvento(atual),
    depois: { ...update, lancamento_id: opcoes.lancamento_id ?? null, conciliacao_origem: opcoes.lancamento_id ? (opcoes.conciliacao_origem ?? 'auto') : null },
    usuario_id: usuarioId,
  });
  return buscarContaPagar(id);
}

// ------------------------------------------------------------
// Estornar / cancelar / excluir / confirmar
// ------------------------------------------------------------

/**
 * Desfaz um pagamento: a conta volta a pendente com rastro (estornado_em,
 * motivo). Linhas que a propria lib criou (caixa, cartao, fatura) somem;
 * linha de extrato so e DESVINCULADA — o dinheiro saiu do banco de verdade,
 * a linha continua existindo com a categoria que tinha.
 */
export async function estornarPagamento(id: string, motivo: string | null, usuarioId: string | null): Promise<ContaPagar> {
  const atual = await lerConta(id);
  if (atual.status !== 'pago') throw new ErroFinanceiro(409, 'Só uma conta paga pode ser estornada.');

  const chave = String(atual.chave_recorrencia ?? '');
  const ehFatura = um<Row>(atual.categorias_financeiras)?.grupo === 'transferencia' && chave.startsWith('fatura:');
  if (!ehFatura) {
    // Compra ja dentro de uma fatura: a linha e lastro da fatura, nao se apaga por aqui.
    const { count } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id', { count: 'exact', head: true })
      .eq('conta_pagar_id', id)
      .not('fatura_id', 'is', null);
    if ((count ?? 0) > 0) throw new ErroFinanceiro(409, 'Compra já incluída numa fatura: estorne ou regere a fatura antes.');
  }

  // Apaga SO as linhas que pagarConta criou pra ESTA conta (hash deterministico).
  // Nunca por fatura_id: as compras do cartao carregam o fatura_id da fatura e
  // sumiriam junto no estorno dela.
  const hashes: string[] = [];
  if (atual.conta_id) hashes.push(hashInterno(String(atual.conta_id), 'cp', id));
  if (ehFatura) hashes.push(hashInterno(chave.split(':')[1], 'fat', id));
  if (hashes.length) {
    const { error: errDel } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .delete()
      .eq('origem_lancamento', 'conta_pagar')
      .in('hash_linha', hashes);
    if (errDel) throw new Error(errDel.message);
  }

  const { error: errDesv } = await supabaseAdmin
    .from('lancamentos_bancarios')
    .update({ conta_pagar_id: null, conciliado_em: null, conciliacao_origem: null })
    .eq('conta_pagar_id', id);
  if (errDesv) throw new Error(errDesv.message);

  const update: Row = {
    status: 'pendente', data_pagamento: null, valor_pago: null, metodo_pagamento: null, conta_id: null, ajuste: 0,
    estornado_em: new Date().toISOString(), estorno_motivo: motivo?.trim() || null,
  };
  const { error } = await supabaseAdmin.from('contas_pagar').update(update).eq('id', id);
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'conta_pagar', entidade_id: id, acao: 'estornar', antes: resumoEvento(atual), depois: update, usuario_id: usuarioId });
  return buscarContaPagar(id);
}

/** Cancela uma conta pendente; 'esta_e_seguintes' leva junto as parcelas seguintes do grupo. */
export async function cancelarConta(id: string, usuarioId: string | null, escopo: 'esta' | 'esta_e_seguintes' = 'esta'): Promise<void> {
  const atual = await lerConta(id);
  if (atual.status !== 'pendente') throw new ErroFinanceiro(409, 'Só conta pendente pode ser cancelada (paga: estorne primeiro).');

  const ids = [id];
  if (escopo === 'esta_e_seguintes' && atual.grupo_parcelas_id) {
    const seguintes = await lerTudo<Row>(() => supabaseAdmin
      .from('contas_pagar')
      .select('id')
      .eq('grupo_parcelas_id', atual.grupo_parcelas_id)
      .eq('status', 'pendente')
      .gt('parcela_num', Number(atual.parcela_num) || 0));
    for (const s of seguintes) ids.push(String(s.id));
  }
  const { error } = await supabaseAdmin.from('contas_pagar').update({ status: 'cancelado' }).in('id', ids).eq('status', 'pendente');
  if (error) throw new Error(error.message);
  if (String(atual.chave_recorrencia ?? '').startsWith('fatura:')) {
    // Fatura cancelada solta as compras: entram na proxima geracao.
    const { error: errLib } = await supabaseAdmin.from('lancamentos_bancarios').update({ fatura_id: null }).eq('fatura_id', id);
    if (errLib) throw new Error(errLib.message);
  }
  for (const x of ids) {
    await registrarEvento({ entidade: 'conta_pagar', entidade_id: x, acao: 'cancelar', antes: x === id ? resumoEvento(atual) : null, depois: { status: 'cancelado', escopo }, usuario_id: usuarioId });
  }
}

/** Apaga de verdade: so pendente/cancelada e sem nenhuma linha apontando pra ela. */
export async function excluirConta(id: string, usuarioId: string | null): Promise<void> {
  const atual = await lerConta(id);
  if (atual.status === 'pago') throw new ErroFinanceiro(409, 'Conta paga não se apaga: estorne o pagamento.');
  const { count } = await supabaseAdmin
    .from('lancamentos_bancarios')
    .select('id', { count: 'exact', head: true })
    .or(`conta_pagar_id.eq.${id},fatura_id.eq.${id}`);
  if ((count ?? 0) > 0) {
    throw new ErroFinanceiro(409, 'Há lançamentos vinculados a esta conta (extrato ou compras da fatura). Desvincule antes.');
  }
  const { error } = await supabaseAdmin.from('contas_pagar').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'conta_pagar', entidade_id: id, acao: 'excluir', antes: { ...resumoEvento(atual), descricao: atual.descricao, chave_recorrencia: atual.chave_recorrencia ?? null }, usuario_id: usuarioId });
}

/**
 * Resposta ao "ja pagou?" da conta gerada retroativamente. Sim -> paga na
 * data informada (ou no vencimento), metodo 'outro', sem conta nem linha —
 * a conciliacao pode ligar a linha do extrato depois.
 */
export async function confirmarRetroativa(id: string, jaPagou: boolean, data: string | null, usuarioId: string | null): Promise<ContaPagar> {
  const atual = await lerConta(id);
  if (atual.status !== 'pendente') throw new ErroFinanceiro(409, 'Essa conta não está pendente.');
  if (data && !ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');
  if (jaPagou && String(atual.vencimento) >= hojeSP() && !data) {
    throw new ErroFinanceiro(400, 'Essa conta ainda não venceu. Use "Paguei" quando pagar.');
  }
  // Sim: pagarConta ja zera precisa_confirmacao; se falhar, a conta continua
  // em "ja pagou?" em vez de virar atrasada.
  const paga = jaPagou
    ? await pagarConta(id, { data_pagamento: data ?? String(atual.vencimento), metodo_pagamento: 'outro', conta_id: null }, usuarioId)
    : null;
  if (!paga) {
    const { error } = await supabaseAdmin.from('contas_pagar').update({ precisa_confirmacao: false }).eq('id', id);
    if (error) throw new Error(error.message);
  }
  await registrarEvento({ entidade: 'conta_pagar', entidade_id: id, acao: 'confirmar', depois: { ja_pagou: jaPagou, data: data ?? null }, usuario_id: usuarioId });
  return paga ?? buscarContaPagar(id);
}

// ------------------------------------------------------------
// Fatura do cartao
// ------------------------------------------------------------

/**
 * Fecha a fatura do mes: soma as compras da conta do cartao ainda sem fatura
 * ate o fechamento do mes (inclui as que ficaram soltas de ciclos anteriores)
 * e cria/atualiza a conta a pagar 'fatura:<conta>:<mes>'. Compras
 * sao linhas negativas; estorno/credito na fatura, positivas (abatem).
 * Soma <= 0 -> nada a pagar, devolve null.
 */
export async function gerarFaturaCartao(contaCartaoId: string, mes: string, usuarioId: string | null): Promise<ContaPagar | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroFinanceiro(400, 'Mês inválido (AAAA-MM).');
  const contas = await carregarContasFinanceiras();
  const cartao = contas.find(c => c.id === contaCartaoId);
  if (!cartao || cartao.tipo !== 'cartao_credito') throw new ErroFinanceiro(404, 'Conta de cartão de crédito não encontrada.');
  if (!cartao.dia_fechamento || !cartao.dia_vencimento) {
    throw new ErroFinanceiro(400, 'Informe o dia de fechamento e o dia de vencimento do cartão antes de gerar a fatura.');
  }

  const inicio = somarDias(clampDiaDoMes(mesAnterior(mes), cartao.dia_fechamento), 1);
  const fim = clampDiaDoMes(mes, cartao.dia_fechamento);
  // Sem limite inferior: compra lancada depois de a fatura do ciclo dela ja
  // estar paga (ou solta por cancelamento) cai na fatura seguinte, como no
  // cartao de verdade, em vez de ficar sem fatura pra sempre.
  const linhas = await lerTudo<Row>(() => supabaseAdmin
    .from('lancamentos_bancarios')
    .select('id, valor')
    .eq('conta_id', cartao.id)
    .is('fatura_id', null)
    .lte('data', fim));
  const total = arred2(-linhas.reduce((a, l) => a + (Number(l.valor) || 0), 0));

  const chave = `fatura:${cartao.id}:${mes}`;
  const { data: existenteRaw } = await supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_PAGAR).eq('chave_recorrencia', chave).maybeSingle();
  const existente = existenteRaw as Row | null;

  if (total <= 0) return existente ? mapearContaPagar(existente) : null;

  const vencimento = cartao.dia_vencimento <= cartao.dia_fechamento
    ? clampDiaDoMes(mesSeguinte(mes), cartao.dia_vencimento)
    : clampDiaDoMes(mes, cartao.dia_vencimento);
  let faturaId: string;
  if (existente) {
    faturaId = String(existente.id);
    if (existente.status === 'cancelado') {
      // A chave e unica: a cancelada e reaberta com as compras soltas do ciclo.
      const { error } = await supabaseAdmin.from('contas_pagar')
        .update({ status: 'pendente', valor: total, vencimento, precisa_confirmacao: false, editada_manualmente: false })
        .eq('id', faturaId);
      if (error) throw new Error(error.message);
    } else if (existente.status === 'pendente' && arred2(Number(existente.valor)) !== total && existente.editada_manualmente !== true) {
      // Pendente acompanha as compras que entraram.
      const { error } = await supabaseAdmin.from('contas_pagar').update({ valor: total }).eq('id', faturaId);
      if (error) throw new Error(error.message);
    }
    // Paga nao muda mais: as compras soltas ficam pra fatura seguinte.
    if (existente.status === 'pago') return mapearContaPagar(existente);
  } else {
    const categorias = await carregarCategorias();
    const categoria = categoriaPorNome(categorias, CATEGORIA_FATURA);
    const fornecedor = await obterOuCriarFornecedor(cartao.nome, { tipo: 'servico', categoria_padrao_id: categoria?.id ?? null });
    const { data: criada, error } = await supabaseAdmin
      .from('contas_pagar')
      .upsert({
        descricao: `Fatura ${cartao.nome} — ${rotuloMes(mes)}`,
        fornecedor_id: fornecedor.id,
        categoria_id: categoria?.id ?? null,
        valor: total,
        vencimento,
        competencia: `${mes}-01`,
        status: 'pendente',
        chave_recorrencia: chave,
        criado_por: usuarioId,
      }, { onConflict: 'chave_recorrencia', ignoreDuplicates: true })
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (criada?.id) faturaId = String(criada.id);
    else {
      const { data: denovo } = await supabaseAdmin.from('contas_pagar').select('id').eq('chave_recorrencia', chave).single();
      faturaId = String(denovo?.id);
    }
  }

  if (linhas.length) {
    const { error } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .update({ fatura_id: faturaId })
      .in('id', linhas.map(l => String(l.id)));
    if (error) throw new Error(error.message);
  }
  await registrarEvento({
    entidade: 'conta_pagar', entidade_id: faturaId, acao: 'gerar_fatura',
    depois: { conta_cartao_id: cartao.id, mes, ciclo: [inicio, fim], total, compras: linhas.length },
    usuario_id: usuarioId,
  });
  return buscarContaPagar(faturaId);
}
