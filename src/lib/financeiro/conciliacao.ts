// Conciliacao: casa cada linha do extrato com o que o sistema ja sabe.
//
//   entrada  <-> pagamento de venda (valor exato, data +-1 dia)
//   saida    <-> conta a pagar (identidade do fornecedor E valor) ou folha
//   cartao   NAO casa por linha: a Stone deposita a venda liquida da taxa,
//            em D+1, agregada — comparamos por dia de liquidacao e tiramos a
//            taxa efetiva real
//
// So confianca ALTA grava; media vira sugestao pra um toque na tela. Toda
// gravacao e individual e em try/catch: indice unico violado (23505) conta
// em `conflitos` e nao derruba o resto. Transferencia entre contas proprias
// nunca entra (nem como sem par).

import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { aprenderComCorrecao, normalizar } from '@/lib/categorizacao';
import type {
  CandidatoConciliacao, CartaoAgregadoDia, Categoria, Confianca, ContaFinanceira, LancamentoResumo, Metodo,
  ResultadoConciliacao, SugestaoConciliacao, TaxaMaquininha, VinculoAplicado, VinculoManual,
} from './tipos';
import { arred2, dataBRT, diasEntre, ehData, limitesDiaUtc, somarDias } from './datas';
import { ErroFinanceiro, ehConflitoUnico, registrarEvento } from './eventos';
import { FILTRO_ORIGEM_EXTRATO, carregarContasFinanceiras } from './saldos';
import { SELECT_PAGAMENTO, calcularCusto, carregarPagamentos, carregarTaxas, paraPagamentoRow, type PagamentoRow } from './taxas';
import {
  CATEGORIA_FOLHA, carregarCategorias, carregarFornecedores, categoriaPorNome, estornarPagamento, pagarConta,
} from './contas-pagar';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;
const CENTAVO = 0.01;
const RE_ESTORNO = /CANCEL|ESTORNO|CHARGEBACK|DEVOLU/i;
// Como o extrato Stone descreve a venda no cartao (ja liquida) e o PIX na maquininha.
const PREFIXOS_CARTAO = ['TRANSFERENCIA ENTRE CONTAS STONE', 'RECEBIVEL DE CARTAO'];
const PREFIXO_PIX_STONE = 'TRANSACAO';
// Razao social do deposito, ja normalizada (& -> E); a Stone escreve dos dois jeitos.
const NOME_PROPRIO = 'L E J DEPOSITO OLIVEIRA';
// Palavras que aparecem em qualquer razao social: nao identificam ninguem.
const TOKENS_GENERICOS = new Set([
  'LTDA', 'EIRELI', 'COMERCIO', 'COMERCIAL', 'INDUSTRIA', 'SERVICOS', 'MATERIAIS', 'MATERIAL', 'CONSTRUCAO',
  'DEPOSITO', 'EMPRESA', 'BRASIL', 'FILIAL', 'PAGAMENTO', 'PAGAMENTOS', 'TRANSPORTES', 'DISTRIBUIDORA',
]);

interface Linha {
  id: string; conta_id: string; data: string; descricao: string; contraparte: string | null; documento: string | null;
  valor: number; tarifa: number; categoria_id: string | null; categoria_origem: string | null; categoria_confianca: number | null;
  pagamento_id: string | null; conta_pagar_id: string | null; funcionario_pagamento_id: string | null; funcionario_vale_id: string | null;
  origem_lancamento: string | null; conciliacao_origem: string | null;
}

const SELECT_LINHA =
  'id, conta_id, data, descricao, contraparte, documento, valor, tarifa, categoria_id, categoria_origem, categoria_confianca, ' +
  'pagamento_id, conta_pagar_id, funcionario_pagamento_id, funcionario_vale_id, origem_lancamento, conciliacao_origem';

function paraLinha(r: Row): Linha {
  return {
    id: String(r.id), conta_id: String(r.conta_id), data: String(r.data), descricao: String(r.descricao ?? ''),
    contraparte: (r.contraparte as string | null) ?? null, documento: r.documento ? String(r.documento).replace(/\D/g, '') : null,
    valor: Number(r.valor) || 0, tarifa: Number(r.tarifa) || 0,
    categoria_id: r.categoria_id ? String(r.categoria_id) : null, categoria_origem: (r.categoria_origem as string | null) ?? null,
    categoria_confianca: r.categoria_confianca == null ? null : Number(r.categoria_confianca),
    pagamento_id: r.pagamento_id ? String(r.pagamento_id) : null, conta_pagar_id: r.conta_pagar_id ? String(r.conta_pagar_id) : null,
    funcionario_pagamento_id: r.funcionario_pagamento_id ? String(r.funcionario_pagamento_id) : null,
    funcionario_vale_id: r.funcionario_vale_id ? String(r.funcionario_vale_id) : null,
    origem_lancamento: (r.origem_lancamento as string | null) ?? null,
    conciliacao_origem: (r.conciliacao_origem as string | null) ?? null,
  };
}

const vinculada = (l: Linha) => Boolean(l.pagamento_id || l.conta_pagar_id || l.funcionario_pagamento_id || l.funcionario_vale_id);
const ehLinhaCartao = (descricao: string) => { const d = normalizar(descricao); return PREFIXOS_CARTAO.some(p => d.startsWith(p)); };
const ehTransacaoStone = (descricao: string) => normalizar(descricao).startsWith(PREFIXO_PIX_STONE);

function paraResumo(l: Linha, categorias: Map<string, Categoria>): LancamentoResumo {
  return {
    id: l.id, conta_id: l.conta_id, data: l.data, descricao: l.descricao, contraparte: l.contraparte, documento: l.documento,
    valor: arred2(l.valor), tarifa: arred2(l.tarifa), categoria_id: l.categoria_id,
    categoria_nome: l.categoria_id ? categorias.get(l.categoria_id)?.nome ?? null : null,
  };
}

/** Metodo provavel pela descricao do banco. */
export function inferirMetodo(descricao: string): Metodo {
  const d = normalizar(descricao);
  if (/\bPIX\b/.test(d)) return 'pix';
  if (/BOLETO/.test(d)) return 'boleto';
  if (/\bTED\b|TRANSF|\bDOC\b/.test(d)) return 'transferencia';
  if (/\bDEB|CARTAO/.test(d)) return 'debito';
  return 'outro';
}

/** Categoria de receita coerente com o metodo do pagamento casado. */
export function categoriaVenda(metodo: string): string {
  if (metodo === 'debito' || metodo === 'credito') return 'Venda - Cartao (Stone)';
  if (metodo === 'boleto') return 'Venda - Boleto/Prazo';
  if (metodo === 'transferencia') return 'Venda - Dinheiro/Deposito';
  return 'Venda - PIX';
}

export function tokensDeNome(nome: string | null | undefined): string[] {
  return normalizar(nome).split(/[^A-Z0-9]+/).filter(t => t.length >= 5 && !TOKENS_GENERICOS.has(t));
}

/** Texto da linha (contraparte + descricao) contem algum token identificador do nome? */
function casaNome(linha: Linha, nome: string | null | undefined): string | null {
  const texto = `${normalizar(linha.contraparte)} ${normalizar(linha.descricao)}`;
  const token = tokensDeNome(nome).find(t => texto.includes(t));
  return token ? `nome "${token}"` : null;
}

// ------------------------------------------------------------
// Cartao: agregado por dia de liquidacao
// ------------------------------------------------------------

/**
 * Por dia D do periodo: o que a Stone depositou (linhas de cartao em D) x o
 * liquido estimado dos pagamentos debito/credito cuja data_liquidacao e D.
 * taxa_efetiva_pct = 1 - liquidado/bruto. Sem conta_id, soma todas as
 * contas adquirente.
 */
export async function cartaoAgregado(
  de: string,
  ate: string,
  opcoes: { conta_id?: string; taxas?: TaxaMaquininha[]; contas?: ContaFinanceira[]; linhas?: Linha[]; pagamentos?: PagamentoRow[] } = {},
): Promise<{ dias: CartaoAgregadoDia[]; taxa_efetiva_pct: number | null; liquidado: number; bruto_estimado: number; liquido_estimado: number }> {
  const contas = opcoes.contas ?? await carregarContasFinanceiras();
  const adquirentes = contas.filter(c => c.tipo === 'adquirente' && (!opcoes.conta_id || c.id === opcoes.conta_id)).map(c => c.id);
  const vazio = { dias: [], taxa_efetiva_pct: null, liquidado: 0, bruto_estimado: 0, liquido_estimado: 0 };
  if (adquirentes.length === 0) return vazio;

  const [linhas, pagamentos, taxas] = await Promise.all([
    opcoes.linhas
      ? Promise.resolve(opcoes.linhas)
      : lerTudo<Row>(() => supabaseAdmin
        .from('lancamentos_bancarios').select(SELECT_LINHA).in('conta_id', adquirentes)
        .gte('data', de).lte('data', ate).or(FILTRO_ORIGEM_EXTRATO)).then(rs => rs.map(paraLinha)),
    // D+1 e sabado contam: 5 dias antes cobre qualquer dias_liquidacao da tabela.
    opcoes.pagamentos ?? carregarPagamentos(limitesDiaUtc(somarDias(de, -5)).inicioUtc, limitesDiaUtc(ate).fimUtc),
    opcoes.taxas ?? carregarTaxas(),
  ]);

  const porDia = new Map<string, CartaoAgregadoDia>();
  const dia = (d: string) => {
    let x = porDia.get(d);
    if (!x) { x = { data: d, liquidado: 0, qtd_linhas: 0, bruto_estimado: 0, liquido_estimado: 0, qtd_pagamentos: 0, diferenca: 0, taxa_efetiva_pct: null }; porDia.set(d, x); }
    return x;
  };
  for (const l of linhas) {
    if (l.valor <= 0 || !ehLinhaCartao(l.descricao) || !adquirentes.includes(l.conta_id)) continue;
    const x = dia(l.data); x.liquidado += l.valor; x.qtd_linhas++;
  }
  for (const p of pagamentos) {
    if (p.metodo !== 'debito' && p.metodo !== 'credito') continue;
    const c = calcularCusto(p, taxas);
    if (c.data_liquidacao < de || c.data_liquidacao > ate) continue;
    const x = dia(c.data_liquidacao); x.bruto_estimado += p.valor; x.liquido_estimado += c.liquido_recebido; x.qtd_pagamentos++;
  }
  let liquidado = 0, bruto = 0, liquido = 0;
  const dias = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)).map(x => {
    liquidado += x.liquidado; bruto += x.bruto_estimado; liquido += x.liquido_estimado;
    return {
      ...x,
      liquidado: arred2(x.liquidado), bruto_estimado: arred2(x.bruto_estimado), liquido_estimado: arred2(x.liquido_estimado),
      diferenca: arred2(x.liquidado - x.liquido_estimado),
      taxa_efetiva_pct: x.bruto_estimado > 0 && x.liquidado > 0 ? arred2((1 - x.liquidado / x.bruto_estimado) * 100) : null,
    };
  });
  return {
    dias,
    taxa_efetiva_pct: bruto > 0 && liquidado > 0 ? arred2((1 - liquidado / bruto) * 100) : null,
    liquidado: arred2(liquidado), bruto_estimado: arred2(bruto), liquido_estimado: arred2(liquido),
  };
}

// ------------------------------------------------------------
// Candidatos
// ------------------------------------------------------------

interface ContaCand {
  id: string; descricao: string; valor: number; data: string; status: string; categoria_id: string | null; categoria_grupo: string | null;
  fornecedor_id: string | null; fornecedor_nome: string | null; conta_id: string | null;
}
interface FolhaCand { id: string; tipo: 'folha' | 'vale'; valor: number; data: string; nome: string; conta_id: string | null }

function candidatoPagamento(p: PagamentoRow, linha: Linha, confianca: Confianca, motivo: string): CandidatoConciliacao {
  const data = dataBRT(p.data_pagamento);
  return {
    tipo: 'pagamento', id: p.id, descricao: `${p.codigo ?? 'Pedido'} — ${p.cliente_nome}`, valor: arred2(p.valor), data,
    confianca, diferenca_valor: arred2(Math.abs(linha.valor) - Math.abs(p.valor)), diferenca_dias: diasEntre(data, linha.data), motivo,
  };
}

/**
 * Entradas de banco/PIX: pagamento com valor exato (+-0,01) e data +-1 dia.
 * Tambem a SOMA de um grupo_recebimento ou de pagamentos do mesmo cliente,
 * mesmo dia e metodo (um PIX pagando varios pedidos).
 */
function candidatosEntrada(linha: Linha, pagamentos: PagamentoRow[], metodos: Metodo[]): CandidatoConciliacao[] {
  const alvo = Math.abs(linha.valor);
  const janela = (p: PagamentoRow) => { const d = diasEntre(dataBRT(p.data_pagamento), linha.data); return d >= -1 && d <= 1; };
  const elegiveis = pagamentos.filter(p => p.valor > 0 && metodos.includes(p.metodo) && janela(p));
  const saida: CandidatoConciliacao[] = [];
  for (const p of elegiveis) {
    if (Math.abs(p.valor - alvo) <= CENTAVO) saida.push(candidatoPagamento(p, linha, 'alta', 'valor exato'));
  }
  // Grupos: por grupo_recebimento e por (cliente, dia, metodo), com >= 2 pagamentos.
  const grupos = new Map<string, PagamentoRow[]>();
  for (const p of elegiveis) {
    const chaves = [p.grupo_recebimento ? `g:${p.grupo_recebimento}` : null, p.cliente_id ? `c:${p.cliente_id}|${dataBRT(p.data_pagamento)}|${p.metodo}` : null];
    for (const k of chaves) { if (!k) continue; const g = grupos.get(k); if (g) g.push(p); else grupos.set(k, [p]); }
  }
  const vistos = new Set<string>();
  for (const [chave, ps] of grupos) {
    if (ps.length < 2) continue;
    const ids = ps.map(p => p.id).sort();
    const assinatura = ids.join(',');
    if (vistos.has(assinatura)) continue;
    vistos.add(assinatura);
    const soma = ps.reduce((a, p) => a + p.valor, 0);
    if (Math.abs(soma - alvo) > CENTAVO) continue;
    const data = dataBRT(ps[0].data_pagamento);
    saida.push({
      tipo: 'grupo', id: chave.startsWith('g:') ? chave.slice(2) : ids[0], ids,
      descricao: `${ps.length} pedidos — ${ps[0].cliente_nome}`, valor: arred2(soma), data, confianca: 'alta',
      diferenca_valor: arred2(alvo - soma), diferenca_dias: diasEntre(data, linha.data),
      motivo: chave.startsWith('g:') ? 'soma do recebimento agrupado' : 'soma dos pedidos do cliente no dia',
    });
  }
  saida.sort((a, b) => Math.abs(a.diferenca_dias) - Math.abs(b.diferenca_dias));
  // Um so candidato = alta; varios = sugestao (o humano escolhe).
  if (saida.length > 1) for (const c of saida) c.confianca = 'media';
  return saida;
}

/**
 * Saidas: conta a pagar so e ALTA com identidade do fornecedor (documento,
 * token do nome ou categoria por regra) E valor exato. Valor igual sem
 * identidade, ou identidade com juros/desconto (ate 5% ou R$ 20), e media.
 */
function candidatosConta(
  linha: Linha, contas: ContaCand[], docsFornecedor: Map<string, Set<string>>,
): CandidatoConciliacao[] {
  const alvo = Math.abs(linha.valor);
  const saida: CandidatoConciliacao[] = [];
  for (const c of contas) {
    const dif = alvo - c.valor;
    const exato = Math.abs(dif) <= CENTAVO;
    const tolerancia = Math.abs(dif) <= Math.max(20, c.valor * 0.05);
    if (!exato && !tolerancia) continue;
    let identidade: string | null = null;
    if (linha.documento && c.fornecedor_id && docsFornecedor.get(c.fornecedor_id)?.has(linha.documento)) identidade = 'documento do fornecedor';
    if (!identidade) identidade = casaNome(linha, c.fornecedor_nome);
    if (!identidade && c.categoria_id && linha.categoria_id === c.categoria_id && linha.categoria_origem === 'regra' && (linha.categoria_confianca ?? 0) >= 0.9) {
      identidade = 'categoria por regra';
    }
    if (!identidade && !exato) continue;
    const confianca: Confianca = identidade && exato ? 'alta' : 'media';
    saida.push({
      tipo: 'conta_pagar', id: c.id, descricao: c.fornecedor_nome ? `${c.descricao} — ${c.fornecedor_nome}` : c.descricao,
      valor: arred2(c.valor), data: c.data, confianca, diferenca_valor: arred2(dif), diferenca_dias: diasEntre(c.data, linha.data),
      motivo: [identidade ?? 'sem identidade do fornecedor', exato ? 'valor exato' : 'valor aproximado (juros/desconto)'].join(', '),
    });
  }
  return saida.sort((a, b) => Math.abs(a.diferenca_valor) - Math.abs(b.diferenca_valor) || Math.abs(a.diferenca_dias) - Math.abs(b.diferenca_dias));
}

/** Folha: valor exato e (nome do funcionario na linha OU unico candidato no dia). */
function candidatosFolha(linha: Linha, itens: FolhaCand[]): CandidatoConciliacao[] {
  const alvo = Math.abs(linha.valor);
  const exatos = itens.filter(f => Math.abs(f.valor - alvo) <= CENTAVO && Math.abs(diasEntre(f.data, linha.data)) <= 3);
  return exatos.map(f => {
    const nome = casaNome(linha, f.nome);
    const unico = exatos.length === 1;
    return {
      tipo: f.tipo, id: f.id, descricao: `${f.tipo === 'vale' ? 'Vale' : 'Salário'} — ${f.nome}`, valor: arred2(f.valor), data: f.data,
      confianca: (nome || unico ? 'alta' : 'media') as Confianca, diferenca_valor: arred2(alvo - f.valor), diferenca_dias: diasEntre(f.data, linha.data),
      motivo: nome ?? (unico ? 'valor exato, único candidato' : 'valor exato'),
    };
  });
}

// ------------------------------------------------------------
// Gravacao de um vinculo (automatico ou manual)
// ------------------------------------------------------------

interface Contexto {
  conta: ContaFinanceira;
  categorias: Categoria[];
  pagamentos: Map<string, PagamentoRow>;
  contas: Map<string, ContaCand>;
}

const SELECT_CONTA_CAND =
  'id, descricao, valor, valor_pago, vencimento, data_pagamento, status, categoria_id, fornecedor_id, conta_id, precisa_confirmacao, ' +
  'fornecedores ( nome ), categorias_financeiras ( grupo )';

function paraContaCand(r: Row): ContaCand {
  return {
    id: String(r.id), descricao: String(r.descricao ?? ''), valor: arred2(Number(r.valor_pago ?? r.valor) || 0),
    data: String(r.status === 'pago' && r.data_pagamento ? r.data_pagamento : r.vencimento), status: String(r.status),
    categoria_id: r.categoria_id ? String(r.categoria_id) : null, categoria_grupo: um<Row>(r.categorias_financeiras)?.grupo ?? null,
    fornecedor_id: r.fornecedor_id ? String(r.fornecedor_id) : null, fornecedor_nome: um<Row>(r.fornecedores)?.nome ?? null,
    conta_id: r.conta_id ? String(r.conta_id) : null,
  };
}

/**
 * Grava o par na linha: ponteiro + conciliado_em + categoria coerente
 * (revisado = true: sai da fila de revisao). Conta pendente e paga por
 * pagarConta, que faz o vinculo. Erros (23505 inclusive) sobem pro chamador.
 */
async function gravarVinculo(
  linha: Linha, cand: CandidatoConciliacao, origem: 'auto' | 'manual', usuarioId: string | null, ctx: Contexto,
): Promise<VinculoAplicado> {
  const base: Row = {
    conciliado_em: new Date().toISOString(), conciliacao_origem: origem, categoria_origem: 'regra', categoria_confianca: 1, revisado: true,
  };
  const catId = (nome: string) => categoriaPorNome(ctx.categorias, nome)?.id ?? null;
  let tipo: VinculoAplicado['tipo'] = cand.tipo === 'grupo' ? 'pagamento' : cand.tipo;
  let contaMarcadaPaga = false;

  if (cand.tipo === 'pagamento' || cand.tipo === 'grupo') {
    const ids = cand.tipo === 'grupo' ? (cand.ids ?? [cand.id]) : [cand.id];
    const p = ctx.pagamentos.get(ids[0]);
    if (!p) throw new ErroFinanceiro(404, 'Pagamento não encontrado.');
    if (p.valor < 0) tipo = 'estorno';
    const update: Row = { ...base, pagamento_id: p.id, orcamento_id: p.orcamento_id };
    const cat = catId(categoriaVenda(p.metodo));
    if (cat) update.categoria_id = cat;
    // PIX na maquininha: a tarifa da propria linha e a taxa efetiva real.
    if (ctx.conta.tipo === 'adquirente' && linha.valor > 0 && linha.tarifa > 0) {
      update.taxa_efetiva_pct = Math.round((linha.tarifa / linha.valor) * 100 * 1000) / 1000;
    }
    if (cand.tipo === 'grupo') {
      // A linha guarda UM pagamento_id; o grupo_recebimento liga os demais a ela.
      const grupo = p.grupo_recebimento ?? randomUUID();
      // Todo pagamento do grupo ganha o mesmo grupo_recebimento, inclusive quando
      // o primeiro ja tinha um: senao os outros ficam livres pra casar de novo.
      const semGrupo = ids.filter(i => ctx.pagamentos.get(i)?.grupo_recebimento !== grupo);
      if (semGrupo.length) {
        const { error } = await supabaseAdmin.from('pagamentos').update({ grupo_recebimento: grupo }).in('id', semGrupo);
        if (error) throw error;
      }
      update.observacoes = `Recebimento agrupado (${ids.length} pedidos) — grupo ${grupo}`;
    }
    const { error } = await supabaseAdmin.from('lancamentos_bancarios').update(update).eq('id', linha.id);
    if (error) throw error;
  } else if (cand.tipo === 'conta_pagar') {
    const c = ctx.contas.get(cand.id);
    if (!c) throw new ErroFinanceiro(404, 'Conta a pagar não encontrada.');
    if (c.status === 'pendente') {
      await pagarConta(c.id, {
        data_pagamento: linha.data, valor_pago: arred2(Math.abs(linha.valor)), metodo_pagamento: inferirMetodo(linha.descricao), conta_id: linha.conta_id,
      }, usuarioId, { lancamento_id: linha.id, conciliacao_origem: origem });
      contaMarcadaPaga = true;
    } else {
      const update: Row = { ...base, conta_pagar_id: c.id };
      if (c.categoria_id) update.categoria_id = c.categoria_id;
      const { error } = await supabaseAdmin.from('lancamentos_bancarios').update(update).eq('id', linha.id);
      if (error) throw error;
    }
  } else {
    const update: Row = { ...base, [cand.tipo === 'vale' ? 'funcionario_vale_id' : 'funcionario_pagamento_id']: cand.id };
    const cat = catId(CATEGORIA_FOLHA);
    if (cat) update.categoria_id = cat;
    const { error } = await supabaseAdmin.from('lancamentos_bancarios').update(update).eq('id', linha.id);
    if (error) throw error;
  }

  await registrarEvento({
    entidade: 'lancamento', entidade_id: linha.id, acao: 'vincular',
    depois: { tipo, id: cand.id, ids: cand.ids ?? null, origem, conta_marcada_paga: contaMarcadaPaga, motivo: cand.motivo },
    usuario_id: usuarioId,
  });
  return { lancamento_id: linha.id, tipo, id: cand.id, descricao: cand.descricao, valor: cand.valor, conta_marcada_paga: contaMarcadaPaga };
}

// ------------------------------------------------------------
// Conciliacao automatica
// ------------------------------------------------------------

export async function conciliar(op: { conta_id: string; de: string; ate: string; aplicar: boolean; usuarioId?: string | null }): Promise<ResultadoConciliacao> {
  const { de, ate } = op;
  if (!ehData(de) || !ehData(ate) || de > ate) throw new ErroFinanceiro(400, 'Período inválido (AAAA-MM-DD, início até fim).');
  const contas = await carregarContasFinanceiras();
  const conta = contas.find(c => c.id === op.conta_id);
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada.');
  const usuarioId = op.usuarioId ?? null;

  // Passo 0: tudo de uma vez, tudo com lerTudo (PostgREST corta em 1.000 sem avisar).
  const [categoriasLista, taxas, fornecedores, config, linhasRaw, vincPag, vincOutros, pagamentos, contasRaw, folhaRaw, valesRaw] = await Promise.all([
    carregarCategorias(),
    carregarTaxas(),
    carregarFornecedores(true),
    supabaseAdmin.from('configuracoes').select('valor').eq('chave', 'financeiro_cnpj_proprio').maybeSingle(),
    lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios').select(SELECT_LINHA)
      .eq('conta_id', conta.id).gte('data', de).lte('data', ate).or(FILTRO_ORIGEM_EXTRATO).order('data')),
    // Pagamentos ja casados em QUALQUER conta perto do periodo (o mesmo PIX nao casa duas vezes).
    lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios').select('pagamento_id')
      .not('pagamento_id', 'is', null).gte('data', somarDias(de, -15)).lte('data', somarDias(ate, 15))),
    // Contas e folha ja casadas: conjunto pequeno (uma linha por conta paga), le-se inteiro.
    lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios').select('conta_pagar_id, funcionario_pagamento_id, funcionario_vale_id')
      .or('conta_pagar_id.not.is.null,funcionario_pagamento_id.not.is.null,funcionario_vale_id.not.is.null')),
    carregarPagamentos(limitesDiaUtc(somarDias(de, -3)).inicioUtc, limitesDiaUtc(somarDias(ate, 3)).fimUtc),
    lerTudo<Row>(() => supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_CAND)
      .or(`and(status.eq.pendente,vencimento.gte.${somarDias(de, -10)},vencimento.lte.${somarDias(ate, 10)}),` +
          `and(status.eq.pago,data_pagamento.gte.${somarDias(de, -5)},data_pagamento.lte.${somarDias(ate, 5)})`)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos').select('id, valor_liquido, pago_em, conta_id, funcionarios ( nome )')
      .gte('pago_em', somarDias(de, -3)).lte('pago_em', somarDias(ate, 3))),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_vales').select('id, valor, data, conta_id, funcionarios ( nome )')
      .gte('data', somarDias(de, -3)).lte('data', somarDias(ate, 3))),
  ]);

  const categorias = new Map(categoriasLista.map(c => [c.id, c]));
  const cnpjProprio = String(config.data?.valor ?? '').replace(/\D/g, '') || null;
  const pagVinculados = new Set(vincPag.map(r => String(r.pagamento_id)));
  const contasVinc = new Set<string>(), folhaVinc = new Set<string>(), valesVinc = new Set<string>();
  for (const r of vincOutros) {
    if (r.conta_pagar_id) contasVinc.add(String(r.conta_pagar_id));
    if (r.funcionario_pagamento_id) folhaVinc.add(String(r.funcionario_pagamento_id));
    if (r.funcionario_vale_id) valesVinc.add(String(r.funcionario_vale_id));
  }
  // Pagamento de um grupo ja casado (a linha guarda so um id) tambem conta como casado.
  const gruposVinc = new Set(pagamentos.filter(p => pagVinculados.has(p.id) && p.grupo_recebimento).map(p => String(p.grupo_recebimento)));
  const pagamentosLivres = pagamentos.filter(p => !pagVinculados.has(p.id) && !(p.grupo_recebimento && gruposVinc.has(p.grupo_recebimento)));
  const linhas = linhasRaw.map(paraLinha);
  const docsFornecedor = new Map(fornecedores.map(f => [f.id, new Set(f.documentos.map(d => d.replace(/\D/g, '')))]));
  // A fatura do cartao (grupo transferencia) tambem e candidata: a linha do
  // banco que a pagou precisa casar com ela, senao vira despesa solta.
  const contasCand = contasRaw.map(paraContaCand).filter(c => !contasVinc.has(c.id));
  const folhaCand: FolhaCand[] = [
    ...folhaRaw.filter(r => !folhaVinc.has(String(r.id))).map(r => ({
      id: String(r.id), tipo: 'folha' as const, valor: arred2(Number(r.valor_liquido) || 0), data: String(r.pago_em),
      nome: String(um<Row>(r.funcionarios)?.nome ?? 'Funcionário'), conta_id: r.conta_id ? String(r.conta_id) : null,
    })),
    ...valesRaw.filter(r => !valesVinc.has(String(r.id))).map(r => ({
      id: String(r.id), tipo: 'vale' as const, valor: arred2(Number(r.valor) || 0), data: String(r.data),
      nome: String(um<Row>(r.funcionarios)?.nome ?? 'Funcionário'), conta_id: r.conta_id ? String(r.conta_id) : null,
    })),
  ];

  const totais: ResultadoConciliacao['totais'] = {
    linhas: linhas.length, ja_conciliadas: 0, transferencias_ignoradas: 0, conciliadas_agora: 0, sugestoes: 0, sem_par: 0, conflitos: 0, legado_ignorados: 0,
  };
  const sugestoes: SugestaoConciliacao[] = [];
  const semPar: ResultadoConciliacao['sem_par'] = { entradas: [], saidas: [] };
  const usados = { pag: new Set<string>(), conta: new Set<string>(), folha: new Set<string>() };
  const paresAlta: Array<{ linha: Linha; cand: CandidatoConciliacao }> = [];

  for (const l of linhas) {
    // Passo 1: fora da conciliacao.
    if (vinculada(l)) { totais.ja_conciliadas++; continue; }
    const cat = l.categoria_id ? categorias.get(l.categoria_id) : null;
    if (cat?.grupo === 'transferencia' || (cnpjProprio && l.documento === cnpjProprio) || normalizar(l.contraparte).includes(NOME_PROPRIO)) {
      totais.transferencias_ignoradas++;
      continue;
    }
    if (l.valor === 0) continue;
    if (l.valor > 0 && conta.tipo === 'adquirente' && ehLinhaCartao(l.descricao)) continue;   // cartao: agregado por dia

    let cands: CandidatoConciliacao[] = [];
    if (l.valor > 0) {
      // Passo 3: entradas.
      const metodos: Metodo[] = conta.tipo === 'adquirente'
        ? (ehTransacaoStone(l.descricao) ? ['pix'] : ['pix', 'transferencia'])
        : ['pix', 'transferencia', 'boleto'];
      cands = candidatosEntrada(l, pagamentosLivres.filter(p => !usados.pag.has(p.id)), metodos);
    } else {
      // Passo 2: estorno de venda (pagamento negativo de valor igual, +-3 dias).
      if (RE_ESTORNO.test(`${l.descricao} ${l.contraparte ?? ''}`)) {
        const alvo = Math.abs(l.valor);
        const negs = pagamentosLivres.filter(p => p.valor < 0 && !usados.pag.has(p.id)
          && Math.abs(Math.abs(p.valor) - alvo) <= CENTAVO && Math.abs(diasEntre(dataBRT(p.data_pagamento), l.data)) <= 3);
        cands = negs.map(p => candidatoPagamento(p, l, negs.length === 1 ? 'alta' : 'media', 'estorno de valor igual'));
      }
      // Passo 4: saidas.
      if (cands.length === 0) {
        cands = [
          ...candidatosConta(l, contasCand.filter(c => !usados.conta.has(c.id)), docsFornecedor),
          ...candidatosFolha(l, folhaCand.filter(f => !usados.folha.has(f.id))),
        ];
      }
    }

    const altas = cands.filter(c => c.confianca === 'alta');
    if (altas.length === 1) {
      const cand = altas[0];
      if (cand.tipo === 'pagamento') usados.pag.add(cand.id);
      else if (cand.tipo === 'grupo') for (const id of cand.ids ?? []) usados.pag.add(id);
      else if (cand.tipo === 'conta_pagar') usados.conta.add(cand.id);
      else usados.folha.add(cand.id);
      paresAlta.push({ linha: l, cand });
    } else if (cands.length > 0) {
      sugestoes.push({ lancamento: paraResumo(l, categorias), candidatos: cands.map(c => ({ ...c, confianca: 'media' as Confianca })) });
    } else {
      (l.valor > 0 ? semPar.entradas : semPar.saidas).push(paraResumo(l, categorias));
    }
  }

  // Passo 5: grava so o que e alta. Sem aplicar, devolve os pares como previa.
  const ctx: Contexto = { conta, categorias: categoriasLista, pagamentos: new Map(pagamentos.map(p => [p.id, p])), contas: new Map(contasCand.map(c => [c.id, c])) };
  const aplicados: VinculoAplicado[] = [];
  for (const { linha, cand } of paresAlta) {
    if (!op.aplicar) {
      const p = cand.tipo === 'pagamento' ? ctx.pagamentos.get(cand.id) : undefined;
      aplicados.push({
        lancamento_id: linha.id, tipo: cand.tipo === 'grupo' ? 'pagamento' : p && p.valor < 0 ? 'estorno' : cand.tipo,
        id: cand.id, descricao: cand.descricao, valor: cand.valor, conta_marcada_paga: false,
      });
      continue;
    }
    try {
      aplicados.push(await gravarVinculo(linha, cand, 'auto', usuarioId, ctx));
      totais.conciliadas_agora++;
    } catch (e) {
      totais.conflitos++;
      if (!ehConflitoUnico(e)) console.error('[financeiro/conciliacao] falha ao vincular', linha.id, e);
    }
  }

  // Cartao agregado por dia de liquidacao (so adquirente).
  const agregado = conta.tipo === 'adquirente'
    ? await cartaoAgregado(de, ate, { conta_id: conta.id, taxas, contas, linhas })
    : { dias: [] as CartaoAgregadoDia[], taxa_efetiva_pct: null as number | null };

  // Passo 6: o que o sistema tem e o banco (ainda) nao mostra.
  const metodosConta: Metodo[] = conta.tipo === 'adquirente' ? ['pix', 'debito', 'credito'] : ['pix', 'transferencia', 'boleto'];
  const diasComDeposito = new Set(agregado.dias.filter(d => d.liquidado > 0).map(d => d.data));
  const semBancoPag: ResultadoConciliacao['sistema_sem_banco']['pagamentos'] = [];
  for (const p of pagamentosLivres) {
    const data = dataBRT(p.data_pagamento);
    if (data < de || data > ate || usados.pag.has(p.id)) continue;
    if (p.origem === 'legado' || p.metodo === 'outro') { totais.legado_ignorados++; continue; }
    if (!metodosConta.includes(p.metodo)) continue;
    if (p.metodo === 'debito' || p.metodo === 'credito') {
      // Cartao nao casa por linha: so aponta quando o dia de liquidacao nao teve deposito nenhum.
      const liq = calcularCusto(p, taxas).data_liquidacao;
      if (liq > ate || diasComDeposito.has(liq)) continue;
    }
    semBancoPag.push({ id: p.id, data, valor: arred2(p.valor), metodo: p.metodo, parcelas: p.parcelas, codigo: p.codigo, cliente_nome: p.cliente_nome });
  }
  const contasPagasSemLinha = contasRaw.map(paraContaCand)
    .filter(c => c.status === 'pago' && c.conta_id === conta.id && c.data >= de && c.data <= ate && !contasVinc.has(c.id) && !usados.conta.has(c.id))
    .map(c => ({ id: c.id, data: c.data, valor: c.valor, descricao: c.descricao, fornecedor_nome: c.fornecedor_nome }));
  const folhaSemLinha = folhaCand
    .filter(f => f.conta_id === conta.id && f.data >= de && f.data <= ate && !usados.folha.has(f.id))
    .map(f => ({ id: f.id, tipo: f.tipo, data: f.data, valor: f.valor, nome: f.nome }));

  totais.sugestoes = sugestoes.length;
  totais.sem_par = semPar.entradas.length + semPar.saidas.length;
  return {
    conta_id: conta.id, conta_tipo: conta.tipo, de, ate,
    aplicados, sugestoes,
    cartao_agregado: agregado.dias, taxa_efetiva_periodo_pct: agregado.taxa_efetiva_pct,
    sem_par: semPar,
    sistema_sem_banco: { pagamentos: semBancoPag, contas_pagas: contasPagasSemLinha, folha: folhaSemLinha },
    totais,
  };
}

// ------------------------------------------------------------
// Vinculo manual / desvinculo
// ------------------------------------------------------------

async function lerLinha(id: string): Promise<Linha> {
  const { data, error } = await supabaseAdmin.from('lancamentos_bancarios').select(SELECT_LINHA).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErroFinanceiro(404, 'Lançamento não encontrado.');
  return paraLinha(data as Row);
}

/**
 * Vinculo escolhido na tela. Mesmas gravacoes do automatico, origem
 * 'manual'. Aprende: documento novo vai pro fornecedor e a categoria da
 * conta vira regra (aprenderComCorrecao).
 */
export async function vincular(v: VinculoManual, usuarioId: string | null): Promise<VinculoAplicado> {
  const alvos = [v.pagamento_id, v.conta_pagar_id, v.funcionario_pagamento_id, v.funcionario_vale_id].filter(Boolean);
  if (!v.lancamento_id || alvos.length !== 1) {
    throw new ErroFinanceiro(400, 'Informe a linha e exatamente um alvo (pagamento, conta a pagar, salário ou vale).');
  }
  const linha = await lerLinha(v.lancamento_id);
  if (vinculada(linha)) throw new ErroFinanceiro(409, 'Essa linha já está vinculada. Desvincule antes.');
  const [contas, categorias] = await Promise.all([carregarContasFinanceiras(), carregarCategorias()]);
  const conta = contas.find(c => c.id === linha.conta_id);
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira da linha não encontrada.');
  const ctx: Contexto = { conta, categorias, pagamentos: new Map(), contas: new Map() };

  let cand: CandidatoConciliacao;
  let contaCand: ContaCand | null = null;
  if (v.pagamento_id) {
    const { data } = await supabaseAdmin.from('pagamentos').select(SELECT_PAGAMENTO).eq('id', v.pagamento_id).maybeSingle();
    if (!data) throw new ErroFinanceiro(404, 'Pagamento não encontrado.');
    const p = paraPagamentoRow(data as Row, conta.tipo === 'adquirente');
    ctx.pagamentos.set(p.id, p);
    cand = candidatoPagamento(p, linha, 'alta', 'vínculo manual');
  } else if (v.conta_pagar_id) {
    const { data } = await supabaseAdmin.from('contas_pagar').select(SELECT_CONTA_CAND).eq('id', v.conta_pagar_id).maybeSingle();
    if (!data) throw new ErroFinanceiro(404, 'Conta a pagar não encontrada.');
    contaCand = paraContaCand(data as Row);
    if (contaCand.status === 'cancelado') throw new ErroFinanceiro(409, 'Conta cancelada não pode ser vinculada.');
    ctx.contas.set(contaCand.id, contaCand);
    cand = {
      tipo: 'conta_pagar', id: contaCand.id, descricao: contaCand.fornecedor_nome ? `${contaCand.descricao} — ${contaCand.fornecedor_nome}` : contaCand.descricao,
      valor: contaCand.valor, data: contaCand.data, confianca: 'alta', diferenca_valor: arred2(Math.abs(linha.valor) - contaCand.valor),
      diferenca_dias: diasEntre(contaCand.data, linha.data), motivo: 'vínculo manual',
    };
  } else {
    const ehVale = Boolean(v.funcionario_vale_id);
    const id = String(ehVale ? v.funcionario_vale_id : v.funcionario_pagamento_id);
    const { data } = ehVale
      ? await supabaseAdmin.from('funcionario_vales').select('id, valor, data, funcionarios ( nome )').eq('id', id).maybeSingle()
      : await supabaseAdmin.from('funcionario_pagamentos').select('id, valor_liquido, pago_em, funcionarios ( nome )').eq('id', id).maybeSingle();
    if (!data) throw new ErroFinanceiro(404, ehVale ? 'Vale não encontrado.' : 'Pagamento de funcionário não encontrado.');
    const r = data as Row;
    const nome = String(um<Row>(r.funcionarios)?.nome ?? 'Funcionário');
    const valor = arred2(Number(ehVale ? r.valor : r.valor_liquido) || 0);
    const dataF = String(ehVale ? r.data : r.pago_em);
    cand = {
      tipo: ehVale ? 'vale' : 'folha', id, descricao: `${ehVale ? 'Vale' : 'Salário'} — ${nome}`, valor, data: dataF, confianca: 'alta',
      diferenca_valor: arred2(Math.abs(linha.valor) - valor), diferenca_dias: diasEntre(dataF, linha.data), motivo: 'vínculo manual',
    };
  }

  let aplicado: VinculoAplicado;
  try {
    aplicado = await gravarVinculo(linha, cand, 'manual', usuarioId, ctx);
  } catch (e) {
    if (e instanceof ErroFinanceiro) throw e;
    if (ehConflitoUnico(e)) throw new ErroFinanceiro(409, 'Esse pagamento/conta já está vinculado a outra linha.');
    throw e;
  }

  // Aprendizado: so o vinculo manual ensina (o automatico ja partiu do que se sabia).
  if (contaCand) {
    try {
      if (linha.documento && contaCand.fornecedor_id) {
        const { data: f } = await supabaseAdmin.from('fornecedores').select('documentos').eq('id', contaCand.fornecedor_id).maybeSingle();
        const docs: string[] = Array.isArray(f?.documentos) ? f.documentos.map(String) : [];
        if (!docs.includes(linha.documento)) {
          await supabaseAdmin.from('fornecedores').update({ documentos: [...docs, linha.documento] }).eq('id', contaCand.fornecedor_id);
        }
      }
      if (contaCand.categoria_id) await aprenderComCorrecao({ documento: linha.documento, contraparte: linha.contraparte }, contaCand.categoria_id);
    } catch (e) {
      console.error('[financeiro/conciliacao] aprendizado falhou (segue sem ele):', e);
    }
  }
  return aplicado;
}

/**
 * Desfaz um vinculo. Linha criada pelo proprio pagamento (caixa, cartao,
 * folha, venda em dinheiro) nao se desvincula: ela E o pagamento — estorne
 * ou apague o pagamento. Conta paga pela conciliacao AUTOMATICA volta a
 * pendente junto (ninguem confirmou aquele pagamento).
 */
export async function desvincular(lancamento_id: string, usuarioId: string | null): Promise<void> {
  const linha = await lerLinha(lancamento_id);
  if (!vinculada(linha)) throw new ErroFinanceiro(409, 'Essa linha não está vinculada a nada.');
  if (['conta_pagar', 'folha', 'pagamento'].includes(linha.origem_lancamento ?? '')) {
    throw new ErroFinanceiro(409, 'Essa linha foi criada pelo próprio pagamento: estorne ou apague o pagamento em vez de desvincular.');
  }
  if (linha.conta_pagar_id) {
    const { data: c } = await supabaseAdmin.from('contas_pagar').select('status').eq('id', linha.conta_pagar_id).maybeSingle();
    if (c?.status === 'pago' && linha.conciliacao_origem === 'auto') {
      await estornarPagamento(linha.conta_pagar_id, 'Linha do extrato desvinculada', usuarioId);
    }
  }
  const { error } = await supabaseAdmin
    .from('lancamentos_bancarios')
    .update({
      pagamento_id: null, orcamento_id: null, conta_pagar_id: null, funcionario_pagamento_id: null, funcionario_vale_id: null,
      conciliado_em: null, conciliacao_origem: null, taxa_efetiva_pct: null,
    })
    .eq('id', lancamento_id);
  if (error) throw new Error(error.message);
  await registrarEvento({
    entidade: 'lancamento', entidade_id: lancamento_id, acao: 'desvincular',
    antes: { pagamento_id: linha.pagamento_id, conta_pagar_id: linha.conta_pagar_id, funcionario_pagamento_id: linha.funcionario_pagamento_id, funcionario_vale_id: linha.funcionario_vale_id, conciliacao_origem: linha.conciliacao_origem },
    usuario_id: usuarioId,
  });
}
