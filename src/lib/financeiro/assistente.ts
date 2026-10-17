// Assistente da gestao (/financeiro): o Roger pergunta em portugues ("quanto
// vendi ontem?", "quem me deve?") e o Claude responde consultando ferramentas
// fechadas sobre as libs do modulo. Nada de SQL livre: cada ferramenta e uma
// leitura conhecida, com schema estrito, que devolve JSON compacto.
//
// Substitui a aba "IA" antiga (/api/ai/chat), que despejava um bloco de
// contexto no prompt e nao tinha como responder pergunta fora dele.
//
// So leitura: nenhuma ferramenta grava no banco.

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import { normalizar } from '@/lib/categorizacao';
import {
  arred2, dataBRT, diaSemana, ehData, ehMes, hojeSP, inicioFimMes, limitesPeriodoUtc, mesAnterior, mesSP, somarDias,
} from './datas';
import { STATUS_NAO_VENDA } from './cmv';
import { panorama } from './panorama';
import { fechamentoMensal, resumoMaquininhaMes } from './fechamento';
import { receberPorCliente, calcularReceber, agruparPorCliente } from './receber';
import { contasPagasNoPeriodo, listarContasPagar, resumoContasPagar } from './contas-pagar';
import { folhaPrevista, listarDespesasFixas } from './despesas-fixas';
import { carregarContasFinanceiras, saldosAtuais, totalDisponivel } from './saldos';
import type { ContaPagar } from './tipos';

type Row = Record<string, any>;

// ------------------------------------------------------------
// Configuracao do modelo
// ------------------------------------------------------------

export const MODELO_ASSISTENTE = 'claude-opus-5-5';
// medium e o default do Opus 5.5; explicito pra nao mudar sozinho. Perguntas
// do dia a dia sao consultas + conta, nao raciocinio longo.
const ESFORCO = 'medium' as const;
const MAX_TOKENS = 64000;
export const MAX_ITERACOES = 12;
// Fallback de recusa do lado do servidor: o modelo escolhido pela Anthropic
// por categoria de recusa. Precisa do beta abaixo (forma 'default').
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

const MAX_LINHAS = 200;

// ------------------------------------------------------------
// Utilitarios de saida
// ------------------------------------------------------------

class ErroFerramenta extends Error {}

/** JSON compacto: numeros com no maximo 2 casas, sem null/undefined. */
function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? arred2(x) : null;
    if (x === null || x === undefined) return undefined;
    return x;
  });
}

function limitar<T>(lista: T[], n: number): { itens: T[]; truncado?: string } {
  if (lista.length <= n) return { itens: lista };
  return { itens: lista.slice(0, n), truncado: `mostrando ${n} de ${lista.length}` };
}

function limiteDe(v: unknown, padrao: number): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(n, MAX_LINHAS);
}

function exigirData(v: unknown, campo: string): string {
  if (!ehData(v)) throw new ErroFerramenta(`${campo} inválido: use AAAA-MM-DD.`);
  return v;
}

function exigirPeriodo(de: unknown, ate: unknown): { de: string; ate: string } {
  const d = exigirData(de, 'de');
  const a = exigirData(ate, 'ate');
  if (d > a) throw new ErroFerramenta('"de" é depois de "ate".');
  return { de: d, ate: a };
}

function exigirMes(v: unknown): string {
  if (!ehMes(v)) throw new ErroFerramenta('mes inválido: use AAAA-MM.');
  return v;
}

const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;
const pct = (parte: number, todo: number): number | null => (todo > 0 ? arred2((parte / todo) * 100) : null);
const contem = (texto: string | null | undefined, alvo: string) => normalizar(texto).includes(alvo);
const tokensBusca = (s: string) => normalizar(s).split(' ').filter(Boolean);
const casaTodos = (texto: string | null | undefined, tokens: string[]) => {
  const t = normalizar(texto);
  return tokens.every(k => t.includes(k));
};

// ------------------------------------------------------------
// Vendas: leitura base (mesma regra do Fechamento / cmv.ts)
// ------------------------------------------------------------

interface PedidoVenda {
  id: string; codigo: string | null; total: number; forma_pagamento: string | null; criado_em: string; dia: string;
  cliente_id: string | null; cliente_nome: string; cliente_telefone: string | null; valor_pago: number; status: string;
}
interface ItemVenda {
  orcamento_id: string; produto_id: string | null; produto_nome: string; unidade: string; quantidade: number;
  subtotal: number; custo: number; sem_custo: boolean;
}
interface ProdutoBase { id: string; nome: string; categoria: string | null; preco_custo: number }

async function carregarProdutosBase(): Promise<{ porId: Map<string, ProdutoBase>; porNome: Map<string, ProdutoBase> }> {
  const rows = await lerTudo<Row>(() => supabaseAdmin.from('produtos').select('id, nome, categoria, preco_custo'));
  const porId = new Map<string, ProdutoBase>();
  const porNome = new Map<string, ProdutoBase>();
  for (const r of rows) {
    const p = { id: String(r.id), nome: String(r.nome ?? ''), categoria: r.categoria ?? null, preco_custo: Number(r.preco_custo) || 0 };
    porId.set(p.id, p);
    if (p.nome) porNome.set(p.nome, p);
  }
  return { porId, porNome };
}

/**
 * Pedidos que sao venda (status fora de orcamento/cancelado) com criado_em no
 * periodo em dia comercial de SP, e seus itens com custo: snapshot do item; se
 * 0, custo atual do produto (por id, depois por nome). Sem fator_conversao.
 */
async function carregarVendas(de: string, ate: string) {
  const { inicioUtc, fimUtc } = limitesPeriodoUtc(de, ate);
  const [rows, produtos] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, valor_pago, forma_pagamento, criado_em, status, cliente_id, clientes ( nome, telefone )')
      .not('status', 'in', `(${STATUS_NAO_VENDA.join(',')})`)
      .gte('criado_em', inicioUtc)
      .lt('criado_em', fimUtc)),
    carregarProdutosBase(),
  ]);
  const pedidos: PedidoVenda[] = rows.map(r => {
    const cli = um<Row>(r.clientes);
    return {
      id: String(r.id), codigo: r.codigo ?? null, total: Number(r.total) || 0, forma_pagamento: r.forma_pagamento ?? null,
      criado_em: String(r.criado_em), dia: dataBRT(String(r.criado_em)), cliente_id: r.cliente_id ? String(r.cliente_id) : null,
      cliente_nome: cli?.nome ?? 'Sem cliente', cliente_telefone: cli?.telefone ?? null, valor_pago: Number(r.valor_pago) || 0,
      status: String(r.status),
    };
  });
  const itensRaw = await lerTudoEmLotes<Row>(pedidos.map(p => p.id), lote => supabaseAdmin
    .from('orcamento_itens')
    .select('id, orcamento_id, produto_id, produto_nome, quantidade, unidade, preco_unitario, subtotal, preco_custo')
    .in('orcamento_id', lote));
  const itens: ItemVenda[] = itensRaw.map(it => {
    const qtd = Number(it.quantidade) || 0;
    const subtotal = it.subtotal != null ? Number(it.subtotal) || 0 : (Number(it.preco_unitario) || 0) * qtd;
    const snapshot = Number(it.preco_custo) || 0;
    const prod = (it.produto_id ? produtos.porId.get(String(it.produto_id)) : undefined)
      ?? (it.produto_nome ? produtos.porNome.get(String(it.produto_nome)) : undefined);
    const unit = snapshot > 0 ? snapshot : (prod?.preco_custo ?? 0);
    return {
      orcamento_id: String(it.orcamento_id), produto_id: it.produto_id ? String(it.produto_id) : (prod?.id ?? null),
      produto_nome: String(it.produto_nome ?? 'Sem nome'), unidade: String(it.unidade ?? '').trim() || 'un',
      quantidade: qtd, subtotal, custo: unit * qtd, sem_custo: unit <= 0,
    };
  });
  return { pedidos, itens, produtos };
}

interface Acumulado { receita: number; custo: number; receita_sem_custo: number; pedidos: Set<string>; quantidade: number }
const novoAcumulado = (): Acumulado => ({ receita: 0, custo: 0, receita_sem_custo: 0, pedidos: new Set(), quantidade: 0 });

function fecharAcumulado(a: Acumulado) {
  const lucro = a.receita - a.custo;
  return {
    receita: a.receita, custo: a.custo, lucro_bruto: lucro,
    margem_pct: pct(lucro, a.receita),
    ...(a.receita_sem_custo > 0.01 ? { receita_sem_custo: a.receita_sem_custo } : {}),
    pedidos: a.pedidos.size,
  };
}

// ------------------------------------------------------------
// Executores
// ------------------------------------------------------------

async function ferramentaPanorama() {
  const p = await panorama();
  const fluxo = p.fluxo_30d;
  const ate7 = fluxo.slice(0, 7);
  const menor = fluxo.reduce<typeof fluxo[number] | null>((m, d) => (!m || d.saldo_so_contratado < m.saldo_so_contratado ? d : m), null);
  return {
    hoje: p.hoje,
    dia_hoje: p.dia,
    mes: p.mes,
    saldos: {
      total_disponivel: p.total_disponivel,
      contas: p.contas.map(c => ({ nome: c.nome, tipo: c.tipo, saldo_estimado: c.saldo_estimado, data_base: c.data_base, defasagem_dias: c.defasagem_dias })),
      fatura_cartao_aberta: p.fatura_cartao_aberta,
    },
    a_receber: p.a_receber,
    a_pagar: p.a_pagar,
    maquininha_mes: p.maquininha_mes,
    fluxo: {
      saidas_proximos_7d: ate7.reduce((a, d) => a + d.saidas, 0),
      entradas_contratadas_proximos_7d: ate7.reduce((a, d) => a + d.entradas_contratadas, 0),
      menor_saldo_so_contratado_30d: menor ? { data: menor.data, saldo: menor.saldo_so_contratado } : null,
      sem_saldo_base: fluxo.some(d => d.sem_saldo_base),
    },
    checklist: p.checklist,
    alertas: p.alertas.map(a => `${a.nivel}: ${a.texto}`),
  };
}

async function ferramentaFechamento(e: Row) {
  const mes = exigirMes(e.mes);
  const f = await fechamentoMensal(mes, { comparativo: true });
  const m = f.recebimentos.maquininha;
  return {
    mes: f.mes,
    mes_em_andamento: mes === mesSP(),
    vendas: f.vendas,
    recebimentos: {
      por_metodo: f.recebimentos.por_metodo,
      total: f.recebimentos.total,
      maquininha: {
        volume_bruto: m.volume_bruto, custo_bruto: m.custo_bruto, reembolso_previsto: m.reembolso_previsto,
        custo_liquido_previsto: m.custo_liquido_previsto, sem_tabela: m.sem_tabela,
      },
      tarifa_pix_stone: f.recebimentos.tarifa_pix_stone,
      reembolso_recebido: f.recebimentos.reembolso_recebido,
      taxas_liquidas_previstas: f.recebimentos.taxas_liquidas_previstas,
      taxas_liquidas_realizadas: f.recebimentos.taxas_liquidas_realizadas,
    },
    despesas: {
      total_orcado: f.despesas.total_orcado,
      total_realizado: f.despesas.total_realizado,
      folha_realizada: f.despesas.folha_realizada,
      compras_pagas_informativo: f.despesas.compras_pagas,
      juros_divida: f.despesas.juros_divida,
      grupos: f.despesas.grupos.map(g => ({
        grupo: g.rotulo, orcado: g.orcado, realizado: g.realizado, ...(g.provisao ? { provisao: true } : {}),
        maiores_itens: [...g.itens].sort((a, b) => b.valor - a.valor).slice(0, 8)
          .map(i => ({ descricao: i.descricao, valor: i.valor, data: i.data, origem: i.origem })),
      })),
    },
    resultado: f.resultado,
    caixa: f.caixa,
    comparativo_mes_anterior: f.comparativo,
    qualidade_dos_dados: f.qualidade,
  };
}

type Agrupamento = 'nenhum' | 'dia' | 'produto' | 'cliente' | 'categoria' | 'forma_pagamento';

async function ferramentaVendas(e: Row) {
  const { de, ate } = exigirPeriodo(e.de, e.ate);
  const agrupar: Agrupamento = (['nenhum', 'dia', 'produto', 'cliente', 'categoria', 'forma_pagamento'] as const)
    .includes(e.agrupar_por) ? e.agrupar_por : 'nenhum';
  const limite = limiteDe(e.limite, 30);
  const filtro = typeof e.filtro_produto === 'string' && e.filtro_produto.trim() ? tokensBusca(e.filtro_produto) : null;

  const { pedidos, itens: todosItens, produtos } = await carregarVendas(de, ate);
  const itens = filtro ? todosItens.filter(it => casaTodos(it.produto_nome, filtro)) : todosItens;
  const pedidoPorId = new Map(pedidos.map(p => [p.id, p]));
  const itensPorPedido = new Map<string, ItemVenda[]>();
  for (const it of itens) {
    const l = itensPorPedido.get(it.orcamento_id);
    if (l) l.push(it); else itensPorPedido.set(it.orcamento_id, [it]);
  }
  // Com filtro de produto so contam os pedidos que tem o produto, e a receita
  // e a dos itens (sem frete). Sem filtro, faturamento = total dos pedidos.
  const pedidosConsiderados = filtro ? pedidos.filter(p => itensPorPedido.has(p.id)) : pedidos;

  const custoDoPedido = (id: string) => (itensPorPedido.get(id) ?? []).reduce((a, it) => a + it.custo, 0);
  const semCustoDoPedido = (id: string) => (itensPorPedido.get(id) ?? []).filter(i => i.sem_custo).reduce((a, it) => a + it.subtotal, 0);
  const receitaDoPedido = (p: PedidoVenda) => (filtro ? (itensPorPedido.get(p.id) ?? []).reduce((a, it) => a + it.subtotal, 0) : p.total);

  const total = novoAcumulado();
  for (const p of pedidosConsiderados) {
    total.receita += receitaDoPedido(p);
    total.custo += custoDoPedido(p.id);
    total.receita_sem_custo += semCustoDoPedido(p.id);
    total.pedidos.add(p.id);
  }
  const diasComVenda = new Set(pedidosConsiderados.map(p => p.dia)).size;
  const resumo = {
    periodo: { de, ate },
    ...(filtro ? { filtro_produto: e.filtro_produto, obs: 'receita = soma dos itens que casam com o filtro (sem frete)' } : {}),
    faturamento: total.receita,
    cmv: total.custo,
    lucro_bruto: total.receita - total.custo,
    margem_bruta_pct: pct(total.receita - total.custo, total.receita),
    pedidos: total.pedidos.size,
    ticket_medio: total.pedidos.size ? total.receita / total.pedidos.size : 0,
    dias_com_venda: diasComVenda,
    ...(total.receita_sem_custo > 0.01 ? { receita_sem_custo_cadastrado: total.receita_sem_custo } : {}),
    ...(filtro ? {} : { a_receber_destes_pedidos: pedidos.reduce((a, p) => a + Math.max(0, p.total - p.valor_pago), 0) }),
  };

  if (agrupar === 'nenhum') return { resumo };

  const grupos = new Map<string, Acumulado & { extra: Row }>();
  const acc = (chave: string, extra: Row) => {
    let g = grupos.get(chave);
    if (!g) { g = { ...novoAcumulado(), extra }; grupos.set(chave, g); }
    return g;
  };

  if (agrupar === 'dia' || agrupar === 'cliente' || agrupar === 'forma_pagamento') {
    let metodosPorPedido = new Map<string, Set<string>>();
    if (agrupar === 'forma_pagamento') {
      const pags = await lerTudoEmLotes<Row>(pedidosConsiderados.map(p => p.id), lote => supabaseAdmin
        .from('pagamentos').select('id, orcamento_id, metodo, valor').in('orcamento_id', lote));
      metodosPorPedido = new Map();
      for (const pg of pags) {
        if ((Number(pg.valor) || 0) <= 0) continue;
        const k = String(pg.orcamento_id);
        const s = metodosPorPedido.get(k) ?? new Set<string>();
        s.add(String(pg.metodo));
        metodosPorPedido.set(k, s);
      }
    }
    for (const p of pedidosConsiderados) {
      let chave: string;
      let extra: Row = {};
      if (agrupar === 'dia') {
        chave = p.dia;
        extra = { dia_semana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][diaSemana(p.dia)] };
      } else if (agrupar === 'cliente') {
        chave = p.cliente_id ?? (p.cliente_telefone ? `tel:${p.cliente_telefone}` : 'sem_cliente');
        extra = { cliente: p.cliente_nome, telefone: p.cliente_telefone };
      } else {
        const ms = metodosPorPedido.get(p.id);
        chave = p.forma_pagamento
          ?? (ms && ms.size === 1 ? [...ms][0] : ms && ms.size > 1 ? 'misto' : 'nao_informado');
      }
      const g = acc(chave, extra);
      g.receita += receitaDoPedido(p);
      g.custo += custoDoPedido(p.id);
      g.receita_sem_custo += semCustoDoPedido(p.id);
      g.pedidos.add(p.id);
      if (agrupar === 'cliente') {
        const ultima = g.extra.ultima_compra as string | undefined;
        if (!ultima || p.dia > ultima) g.extra.ultima_compra = p.dia;
      }
    }
  } else {
    for (const it of itens) {
      if (!pedidoPorId.has(it.orcamento_id)) continue;
      let chave: string;
      let extra: Row;
      if (agrupar === 'produto') {
        // Mesmo nome com unidades diferentes (ex.: areia em m³ e em saco) nao se soma.
        chave = `${it.produto_nome}||${it.unidade}`;
        extra = { produto: it.produto_nome, unidade: it.unidade };
      } else {
        const prod = it.produto_id ? produtos.porId.get(it.produto_id) : produtos.porNome.get(it.produto_nome);
        chave = prod?.categoria || 'Sem categoria';
        extra = { categoria: chave };
      }
      const g = acc(chave, extra);
      g.receita += it.subtotal;
      g.custo += it.custo;
      if (it.sem_custo) g.receita_sem_custo += it.subtotal;
      g.pedidos.add(it.orcamento_id);
      g.quantidade += it.quantidade;
    }
  }

  let linhas: Row[] = [...grupos.entries()].map(([chave, g]): Row => {
    const base = fecharAcumulado(g);
    if (agrupar === 'dia') return { dia: chave, ...g.extra, ...base };
    if (agrupar === 'produto') {
      return { ...g.extra, quantidade: g.quantidade, preco_medio: g.quantidade ? g.receita / g.quantidade : 0, ...base };
    }
    if (agrupar === 'forma_pagamento') return { forma_pagamento: chave, ...base };
    if (agrupar === 'cliente') return { ...g.extra, ...base, ticket_medio: g.pedidos.size ? g.receita / g.pedidos.size : 0 };
    return { ...g.extra, ...base };
  });
  if (agrupar === 'dia') linhas = linhas.sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  else linhas = linhas.sort((a, b) => b.receita - a.receita);

  const { itens: mostradas, truncado } = limitar(linhas, limite);
  return {
    resumo,
    agrupado_por: agrupar,
    ...(agrupar === 'produto' || agrupar === 'categoria'
      ? { obs: 'receita por item (subtotal dos itens, sem frete); a soma pode diferir do faturamento dos pedidos' } : {}),
    ...(agrupar === 'forma_pagamento'
      ? { obs: 'forma declarada no pedido; sem ela, o método dos pagamentos registrados (misto = mais de um)' } : {}),
    linhas: mostradas,
    ...(truncado ? { truncado } : {}),
  };
}

async function ferramentaProduto(e: Row) {
  const busca = String(e.busca ?? '').trim();
  if (!busca) throw new ErroFerramenta('Informe o nome (ou parte) do produto.');
  const tokens = tokensBusca(busca);
  const todos = await lerTudo<Row>(() => supabaseAdmin.from('produtos')
    .select('id, nome, codigo, categoria, unidade, unidade_venda, preco_venda, preco_custo, estoque_atual, estoque_minimo, fator_conversao, ativo, estoque_compartilhado_com'));
  const porId = new Map(todos.map(p => [String(p.id), p]));
  const achados = todos
    .filter(p => casaTodos(p.nome, tokens) || normalizar(p.codigo) === normalizar(busca))
    .sort((a, b) => Number(b.ativo !== false) - Number(a.ativo !== false) || String(a.nome).length - String(b.nome).length);
  if (achados.length === 0) return { busca, encontrados: 0, obs: 'Nenhum produto com esse nome. Tente uma parte do nome (ex.: "areia", "cimento").' };
  const { itens: lista, truncado } = limitar(achados, 10);

  // Vendido nos ultimos 90 dias (e 30), por produto e unidade.
  const hoje = hojeSP();
  const d90 = somarDias(hoje, -89);
  const d30 = somarDias(hoje, -29);
  const { inicioUtc } = limitesPeriodoUtc(d90, hoje);
  const ids = lista.map(p => String(p.id));
  const nomes = lista.map(p => String(p.nome));
  const [porProdutoId, porNome] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin.from('orcamento_itens')
      .select('id, produto_id, produto_nome, quantidade, unidade, subtotal, preco_custo, orcamentos!inner ( criado_em, status )')
      .in('produto_id', ids)
      .gte('orcamentos.criado_em', inicioUtc)),
    lerTudo<Row>(() => supabaseAdmin.from('orcamento_itens')
      .select('id, produto_id, produto_nome, quantidade, unidade, subtotal, preco_custo, orcamentos!inner ( criado_em, status )')
      .is('produto_id', null)
      .in('produto_nome', nomes)
      .gte('orcamentos.criado_em', inicioUtc)),
  ]);
  const idPorNome = new Map(lista.map(p => [String(p.nome), String(p.id)]));

  type Janela = { quantidade: number; receita: number; custo: number; pedidos: number };
  const vendas = new Map<string, Map<string, { d30: Janela; d90: Janela }>>();
  for (const it of [...porProdutoId, ...porNome]) {
    const o = um<Row>(it.orcamentos);
    if (!o || STATUS_NAO_VENDA.includes(String(o.status))) continue;
    const pid = it.produto_id ? String(it.produto_id) : idPorNome.get(String(it.produto_nome));
    if (!pid) continue;
    const prod = porId.get(pid);
    const unidade = String(it.unidade ?? '').trim() || 'un';
    const porUn = vendas.get(pid) ?? new Map();
    vendas.set(pid, porUn);
    const j = porUn.get(unidade) ?? { d30: { quantidade: 0, receita: 0, custo: 0, pedidos: 0 }, d90: { quantidade: 0, receita: 0, custo: 0, pedidos: 0 } };
    porUn.set(unidade, j);
    const qtd = Number(it.quantidade) || 0;
    const sub = Number(it.subtotal) || 0;
    const snap = Number(it.preco_custo) || 0;
    const custo = (snap > 0 ? snap : Number(prod?.preco_custo) || 0) * qtd;
    const dia = dataBRT(String(o.criado_em));
    const somar = (x: Janela) => { x.quantidade += qtd; x.receita += sub; x.custo += custo; x.pedidos += 1; };
    somar(j.d90);
    if (dia >= d30) somar(j.d30);
  }
  const fechar = (x: Janela) => ({ ...x, margem_pct: pct(x.receita - x.custo, x.receita) });

  return {
    busca,
    encontrados: achados.length,
    ...(truncado ? { truncado } : {}),
    produtos: lista.map(p => {
      const pv = Number(p.preco_venda) || 0;
      const pc = Number(p.preco_custo) || 0;
      const principal = p.estoque_compartilhado_com ? porId.get(String(p.estoque_compartilhado_com)) : null;
      const estoque = Number((principal ?? p).estoque_atual) || 0;
      const fator = Number(p.fator_conversao) || 1;
      const porUn = vendas.get(String(p.id));
      return {
        nome: p.nome, codigo: p.codigo, categoria: p.categoria, ativo: p.ativo !== false,
        unidade_venda: p.unidade_venda || p.unidade, preco_venda: pv, preco_custo: pc,
        margem_cadastro_pct: pv > 0 && pc > 0 ? pct(pv - pc, pv) : null,
        ...(pc <= 0 ? { obs_custo: 'sem custo cadastrado' } : {}),
        estoque: {
          atual: estoque, unidade_estoque: (principal ?? p).unidade,
          ...(fator !== 1 ? { em_unidade_de_venda: estoque / fator, fator_conversao: fator } : {}),
          minimo: Number(p.estoque_minimo) || 0,
          ...(principal ? { compartilhado_com: principal.nome } : {}),
        },
        vendido: porUn
          ? [...porUn.entries()].map(([unidade, j]) => ({ unidade, ultimos_30_dias: fechar(j.d30), ultimos_90_dias: fechar(j.d90) }))
          : 'sem vendas nos últimos 90 dias',
      };
    }),
  };
}

async function ferramentaClientes(e: Row) {
  const busca = typeof e.busca === 'string' ? e.busca.trim() : '';
  const limite = limiteDe(e.limite, 20);
  const hoje = hojeSP();

  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    const tokens = tokensBusca(busca);
    const todos = await lerTudo<Row>(() => supabaseAdmin.from('clientes').select('id, nome, telefone, bairro, cidade, criado_em'));
    const achados = todos.filter(c =>
      (digitos.length >= 6 && String(c.telefone ?? '').replace(/\D/g, '').includes(digitos)) || (tokens.length > 0 && casaTodos(c.nome, tokens)));
    if (achados.length === 0) return { busca, encontrados: 0, obs: 'Nenhum cliente com esse nome/telefone.' };
    const { itens: lista, truncado } = limitar(achados, 10);
    const ids = lista.map(c => String(c.id));
    const pedidos = await lerTudoEmLotes<Row>(ids, lote => supabaseAdmin.from('orcamentos')
      .select('id, codigo, cliente_id, total, valor_pago, status, status_pagamento, criado_em, vencimento')
      .in('cliente_id', lote));
    const vendasIds = pedidos.filter(p => !STATUS_NAO_VENDA.includes(String(p.status))).map(p => String(p.id));
    const itens = await lerTudoEmLotes<Row>(vendasIds, lote => supabaseAdmin.from('orcamento_itens')
      .select('id, orcamento_id, produto_nome, quantidade, unidade, subtotal').in('orcamento_id', lote));
    const clienteDoPedido = new Map(pedidos.map(p => [String(p.id), String(p.cliente_id)]));
    const periodo = ehData(e.de) && ehData(e.ate) ? { de: e.de as string, ate: e.ate as string } : null;

    return {
      busca, encontrados: achados.length, ...(truncado ? { truncado } : {}),
      clientes: lista.map(c => {
        const id = String(c.id);
        const ps = pedidos.filter(p => String(p.cliente_id) === id);
        const vendas = ps.filter(p => !STATUS_NAO_VENDA.includes(String(p.status)));
        const dias = vendas.map(p => dataBRT(String(p.criado_em))).sort();
        const abertos = vendas.filter(p => p.status_pagamento !== 'completo' && (Number(p.total) - (Number(p.valor_pago) || 0)) > 0.01);
        const prods = new Map<string, { produto: string; unidade: string; quantidade: number; receita: number }>();
        for (const it of itens) {
          if (clienteDoPedido.get(String(it.orcamento_id)) !== id) continue;
          const un = String(it.unidade ?? '').trim() || 'un';
          const k = `${it.produto_nome}||${un}`;
          const x = prods.get(k) ?? { produto: String(it.produto_nome), unidade: un, quantidade: 0, receita: 0 };
          x.quantidade += Number(it.quantidade) || 0;
          x.receita += Number(it.subtotal) || 0;
          prods.set(k, x);
        }
        const noPeriodo = periodo ? vendas.filter(p => { const d = dataBRT(String(p.criado_em)); return d >= periodo.de && d <= periodo.ate; }) : null;
        return {
          nome: c.nome, telefone: c.telefone, bairro: c.bairro, cidade: c.cidade, cliente_desde: dataBRT(String(c.criado_em)),
          total_comprado: vendas.reduce((a, p) => a + (Number(p.total) || 0), 0),
          pedidos: vendas.length,
          primeira_compra: dias[0], ultima_compra: dias[dias.length - 1],
          ...(dias.length ? { dias_desde_ultima_compra: Math.round((Date.parse(hoje) - Date.parse(dias[dias.length - 1])) / 86_400_000) } : {}),
          ...(noPeriodo ? { no_periodo: { ...periodo, total: noPeriodo.reduce((a, p) => a + (Number(p.total) || 0), 0), pedidos: noPeriodo.length } } : {}),
          saldo_em_aberto: abertos.reduce((a, p) => a + Number(p.total) - (Number(p.valor_pago) || 0), 0),
          pedidos_em_aberto: abertos.slice(0, 10).map(p => ({
            codigo: p.codigo, data: dataBRT(String(p.criado_em)), total: Number(p.total), saldo: Number(p.total) - (Number(p.valor_pago) || 0),
            vencimento: p.vencimento, vencido: Boolean(p.vencimento && p.vencimento < hoje),
          })),
          orcamentos_nao_fechados: ps.filter(p => p.status === 'orcamento').length,
          produtos_mais_comprados: [...prods.values()].sort((a, b) => b.receita - a.receita).slice(0, 8),
        };
      }),
    };
  }

  // Ranking no periodo (padrao: mes atual ate hoje).
  const de = ehData(e.de) ? e.de as string : `${mesSP()}-01`;
  const ate = ehData(e.ate) ? e.ate as string : hoje;
  if (de > ate) throw new ErroFerramenta('"de" é depois de "ate".');
  const [{ pedidos }, receber] = await Promise.all([carregarVendas(de, ate), calcularReceber(30)]);
  const devendo = new Map<string, number>();
  for (const c of agruparPorCliente(receber.em_aberto, hoje)) devendo.set(c.chave, c.saldo_total);
  const mapa = new Map<string, { cliente: string; telefone: string | null; total: number; pedidos: number; ultima_compra: string }>();
  for (const p of pedidos) {
    const k = p.cliente_id ?? (p.cliente_telefone ? `tel:${p.cliente_telefone}` : 'sem_cliente');
    const x = mapa.get(k) ?? { cliente: p.cliente_nome, telefone: p.cliente_telefone, total: 0, pedidos: 0, ultima_compra: p.dia };
    x.total += p.total;
    x.pedidos += 1;
    if (p.dia > x.ultima_compra) x.ultima_compra = p.dia;
    mapa.set(k, x);
  }
  const faturamento = pedidos.reduce((a, p) => a + p.total, 0);
  const ranking = [...mapa.entries()]
    .map(([k, x]) => ({ ...x, ticket_medio: x.total / x.pedidos, participacao_pct: pct(x.total, faturamento), saldo_em_aberto_hoje: devendo.get(k) ?? 0 }))
    .sort((a, b) => b.total - a.total);
  const { itens, truncado } = limitar(ranking, limite);
  return {
    periodo: { de, ate }, faturamento_total: faturamento, clientes_distintos: ranking.length,
    ranking: itens, ...(truncado ? { truncado } : {}),
  };
}

async function ferramentaAReceber() {
  const r = await receberPorCliente(30);
  const { itens, truncado } = limitar(r.clientes, 100);
  return {
    resumo: {
      total_a_receber: r.resumo.total_a_receber, vencido: r.resumo.vencido, a_vencer: r.resumo.a_vencer, sem_prazo: r.resumo.sem_prazo,
      entregue_nao_pago: r.resumo.entregue_nao_pago, pedidos: r.resumo.qtd_a_receber, pedidos_vencidos: r.resumo.qtd_vencidos,
      clientes: r.resumo.qtd_clientes,
      recebido_ultimos_30_dias: r.resumo.recebido_periodo, recebido_30d_por_metodo: r.resumo.recebido_por_metodo,
    },
    obs: 'ordem: quem tem vencido e mais atraso primeiro; "sem prazo" = pedido sem vencimento combinado',
    clientes: itens.map(c => ({
      nome: c.nome, telefone: c.telefone, saldo: c.saldo_total, pedidos: c.qtd_pedidos,
      ...(c.tem_vencido ? { maior_atraso_dias: c.maior_atraso_dias } : {}),
      ...(c.tem_entregue_nao_pago ? { tem_entregue_nao_pago: true } : {}),
      detalhe: c.pedidos.slice(0, 5).map(p => ({
        codigo: p.codigo, saldo: p.saldo, vencimento: p.vencimento, dias_em_aberto: p.dias_em_aberto, entregue: p.entregue,
      })),
    })),
    ...(truncado ? { truncado } : {}),
  };
}

function resumoConta(c: ContaPagar) {
  return {
    descricao: c.descricao, fornecedor: c.fornecedor_nome, categoria: c.categoria_nome, valor: c.valor,
    vencimento: c.vencimento, situacao: c.situacao, ...(c.dias_atraso > 0 ? { dias_atraso: c.dias_atraso } : {}),
    ...(c.status === 'pago' ? { data_pagamento: c.data_pagamento, valor_pago: c.valor_pago, metodo: c.metodo_pagamento, conta: c.conta_nome } : {}),
    ...(c.categoria_grupo === 'transferencia' ? { fatura_cartao: true } : {}),
    ...(c.parcela_num && c.parcelas_total ? { parcela: `${c.parcela_num}/${c.parcelas_total}` } : {}),
  };
}

async function ferramentaContasPagar(e: Row) {
  const hoje = hojeSP();
  const status = (['pendente', 'pago', 'todas', 'atrasadas'] as const).includes(e.status) ? e.status as string : 'pendente';
  const de = ehData(e.de) ? e.de as string : undefined;
  const ate = ehData(e.ate) ? e.ate as string : undefined;
  if (de && ate && de > ate) throw new ErroFerramenta('"de" é depois de "ate".');
  const busca = typeof e.busca === 'string' && e.busca.trim() ? e.busca.trim() : undefined;

  let contas: ContaPagar[];
  if (status === 'pago' && (de || ate)) {
    // Pagas: o periodo e pela data do pagamento.
    contas = await contasPagasNoPeriodo(de ?? '2000-01-01', ate ?? hoje);
    if (busca) { const alvo = normalizar(busca); contas = contas.filter(c => contem(c.descricao, alvo) || contem(c.fornecedor_nome, alvo) || contem(c.categoria_nome, alvo)); }
  } else if (status === 'atrasadas') {
    contas = (await listarContasPagar({ status: 'pendente', ate: somarDias(hoje, -1), busca })).filter(c => !c.precisa_confirmacao);
  } else {
    contas = await listarContasPagar({ status: status as 'pendente' | 'pago' | 'todas', de, ate, busca });
  }
  const [resumo, folha] = await Promise.all([
    resumoContasPagar(hoje),
    status === 'pendente' || status === 'todas' ? folhaPrevista() : Promise.resolve(null),
  ]);
  const aConfirmar = contas.filter(c => c.precisa_confirmacao);
  const consideradas = contas.filter(c => !c.precisa_confirmacao);
  const folhaNoPeriodo = folha
    ? folha.proximos.filter(f => (!de || f.data_pagamento >= de) && (!ate || f.data_pagamento <= ate))
    : [];
  const { itens, truncado } = limitar(consideradas, MAX_LINHAS);
  return {
    filtro: { status, de, ate, busca, ...(status === 'pago' ? { obs: 'período pela data do pagamento' } : { obs: 'período pelo vencimento' }) },
    total: consideradas.reduce((a, c) => a + (c.status === 'pago' ? (c.valor_pago ?? c.valor) : c.valor), 0),
    quantidade: consideradas.length,
    ...(aConfirmar.length ? { retroativas_a_confirmar: { quantidade: aConfirmar.length, valor: aConfirmar.reduce((a, c) => a + c.valor, 0), obs: 'geradas com vencimento passado; provavelmente já pagas, fora do total' } } : {}),
    ...(folha ? {
      folha_prevista_no_periodo: {
        total_liquido: folhaNoPeriodo.reduce((a, f) => a + f.liquido, 0),
        pagamentos: folhaNoPeriodo.map(f => ({ funcionario: f.nome, data: f.data_pagamento, liquido: f.liquido })),
        obs: 'folha não é conta a pagar; vem de Funcionários e está fora do total acima',
      },
    } : {}),
    resumo_geral_hoje: resumo,
    contas: itens.map(resumoConta),
    ...(truncado ? { truncado } : {}),
  };
}

async function ferramentaDespesasFixas(e: Row) {
  const mes = ehMes(e.mes) ? e.mes as string : mesSP();
  const lista = await listarDespesasFixas(false, mes);
  const porGrupo: Record<string, number> = {};
  for (const d of lista) porGrupo[d.grupo] = (porGrupo[d.grupo] ?? 0) + d.valor_no_mes;
  const total = Object.values(porGrupo).reduce((a, v) => a + v, 0);
  const folha = lista.find(d => d.fonte === 'funcionarios');
  return {
    mes,
    total_no_mes: total,
    total_sem_divida: total - (porGrupo.divida ?? 0),
    por_grupo: porGrupo,
    ...(folha?.detalhe_folha ? { encargos_folha_estimados: folha.detalhe_folha.encargos_estimados } : {}),
    obs: 'valores combinados (orçado), não o que foi pago; o pago está em contas_a_pagar e fechamento_mes',
    despesas: lista.filter(d => d.valor_no_mes > 0 || d.tipo_valor === 'pct_faturamento').map(d => ({
      nome: d.nome, grupo: d.grupo, valor_no_mes: d.valor_no_mes,
      ...(d.tipo_valor === 'pct_faturamento' ? { percentual_do_faturamento_mes_anterior: d.percentual } : {}),
      dia_vencimento: d.dia_vencimento, fornecedor: d.fornecedor_nome,
      ...(d.parcelas_restantes != null ? { parcelas_restantes: d.parcelas_restantes } : {}),
      ...(d.fim ? { termina_em: d.fim.slice(0, 7) } : {}),
      ...(d.valor_juros > 0 ? { juros_mensal: d.valor_juros } : {}),
      ...(d.observacoes ? { observacoes: d.observacoes } : {}),
    })),
  };
}

async function ferramentaSaldos() {
  const saldos = await saldosAtuais();
  return {
    total_disponivel: totalDisponivel(saldos),
    obs: 'total disponível = banco + adquirente + caixa; Vloz (carteira da Votorantim, só compra cimento) e cartão ficam fora',
    contas: saldos.map(s => ({
      nome: s.nome, tipo: s.tipo, saldo_estimado: s.saldo_estimado,
      base: s.saldo_base !== null ? { saldo: s.saldo_base, data: s.data_base, origem: s.origem, dias_atras: s.defasagem_dias } : 'sem saldo informado',
      ...(s.movimentos_apos_base ? { movimentos_apos_base: s.movimentos_apos_base } : {}),
      ...(s.pagos_apos_base ? { contas_pagas_apos_base: s.pagos_apos_base } : {}),
      ...(s.folha_apos_base ? { folha_apos_base: s.folha_apos_base } : {}),
      ...(s.tipo === 'cartao_credito' ? { fatura_aberta: s.fatura_aberta } : {}),
    })),
  };
}

async function ferramentaMaquininha(e: Row) {
  const mes = exigirMes(e.mes);
  const m = await resumoMaquininhaMes(mes);
  return {
    mes,
    volume: { total: m.volume_bruto, debito: m.volume_debito, credito: m.volume_credito, pix_stone: m.volume_pix_stone, transacoes: m.qtd },
    custo_pela_tabela: { mdr: m.taxas, antecipacao: m.antecipacao, total: m.custo_bruto, taxa_media_pct: pct(m.custo_bruto, m.volume_bruto) },
    ...(m.taxas_reais && m.taxas_reais > 0 ? { taxas_reais_arquivo_vloz: m.taxas_reais, taxa_real_pct: pct(m.taxas_reais, m.volume_debito + m.volume_credito) } : {}),
    taxa_efetiva_extrato_stone_pct: m.taxa_efetiva_extrato_pct,
    liquidado_no_extrato_stone: m.liquidado_extrato,
    tarifas_pix_stone: m.tarifas_pix_stone,
    cashback_votoran: { previsto: m.reembolso_previsto, recebido: m.reembolso_recebido },
    custo_liquido: { previsto: m.custo_liquido_previsto, realizado: m.custo_liquido_realizado },
    regras: 'a Stone manda 15% de cada venda no cartão para a carteira Vloz (Votorantim); o extrato Stone só mostra 85%. Cashback Votoran também cai na Vloz. Custo realizado usa a taxa real do arquivo Vloz quando houver.',
    por_faixa: m.por_faixa.filter(f => f.volume > 0).map(f => ({
      modalidade: f.modalidade, parcelas: f.parcelas_de === f.parcelas_ate ? `${f.parcelas_de}x` : `${f.parcelas_de}-${f.parcelas_ate}x`,
      volume: f.volume, qtd: f.qtd, custo: f.custo_bruto, taxa_tabela_pct: f.taxa_tabela_pct,
    })),
    reembolsos_registrados: m.reembolsos.map(r => ({ data: r.data_recebimento, valor: r.valor, forma: r.forma, fornecedor: r.fornecedor_nome })),
    alertas: [
      ...(m.sem_tabela ? ['sem tabela de taxas cadastrada: custo pela tabela sai zerado'] : []),
      ...(m.taxas_padrao_nao_conferidas ? ['tabela de taxas com valor padrão, não conferida no contrato'] : []),
      ...(m.volume_credito_sem_parcelas > 0 ? [`crédito sem parcelas informadas: ${arred2(m.volume_credito_sem_parcelas)} (antecipação subestimada)`] : []),
    ],
  };
}

async function ferramentaExtrato(e: Row) {
  const { de, ate } = exigirPeriodo(e.de, e.ate);
  const limite = limiteDe(e.limite, 50);
  const tipo = e.tipo === 'entradas' || e.tipo === 'saidas' ? e.tipo as string : 'todas';
  const contas = await carregarContasFinanceiras();
  let contaIds: string[] | null = null;
  if (typeof e.conta === 'string' && e.conta.trim()) {
    const alvo = normalizar(e.conta);
    const casam = contas.filter(c => contem(c.nome, alvo) || normalizar(c.tipo).includes(alvo) || contem(c.instituicao, alvo));
    if (!casam.length) throw new ErroFerramenta(`Conta "${e.conta}" não encontrada. Contas: ${contas.map(c => c.nome).join(', ')}.`);
    contaIds = casam.map(c => c.id);
  }
  const nomeConta = new Map(contas.map(c => [c.id, c.nome]));
  const rows = await lerTudo<Row>(() => {
    let q = supabaseAdmin.from('lancamentos_bancarios')
      .select('id, conta_id, data, descricao, contraparte, valor, tarifa, origem_lancamento, revisado, categorias_financeiras ( nome, grupo )')
      .gte('data', de).lte('data', ate);
    if (contaIds) q = q.in('conta_id', contaIds);
    if (tipo === 'entradas') q = q.gt('valor', 0);
    if (tipo === 'saidas') q = q.lt('valor', 0);
    return q;
  });
  const alvoCat = typeof e.categoria === 'string' && e.categoria.trim() ? normalizar(e.categoria) : null;
  const alvoBusca = typeof e.busca === 'string' && e.busca.trim() ? normalizar(e.busca) : null;
  const linhas = rows.map(r => {
    const cat = um<Row>(r.categorias_financeiras);
    return {
      data: String(r.data), conta: nomeConta.get(String(r.conta_id)) ?? '?', descricao: String(r.descricao ?? ''),
      contraparte: r.contraparte ?? null, valor: Number(r.valor) || 0, tarifa: Number(r.tarifa) || 0,
      categoria: cat?.nome ?? 'Sem categoria', grupo: cat?.grupo ?? null, origem: r.origem_lancamento ?? 'extrato',
    };
  }).filter(l =>
    (!alvoCat || contem(l.categoria, alvoCat) || contem(l.grupo, alvoCat))
    && (!alvoBusca || contem(l.descricao, alvoBusca) || contem(l.contraparte, alvoBusca)));

  const porCategoria = new Map<string, { categoria: string; grupo: string | null; entradas: number; saidas: number; linhas: number }>();
  for (const l of linhas) {
    const x = porCategoria.get(l.categoria) ?? { categoria: l.categoria, grupo: l.grupo, entradas: 0, saidas: 0, linhas: 0 };
    if (l.valor > 0) x.entradas += l.valor; else x.saidas += -l.valor;
    x.linhas++;
    porCategoria.set(l.categoria, x);
  }
  const entradas = linhas.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0);
  const saidas = linhas.filter(l => l.valor < 0).reduce((a, l) => a - l.valor, 0);
  const ordenadas = [...linhas].sort((a, b) => b.data.localeCompare(a.data) || Math.abs(b.valor) - Math.abs(a.valor));
  const { itens, truncado } = limitar(ordenadas, limite);
  return {
    filtro: { de, ate, conta: e.conta, categoria: e.categoria, busca: e.busca, tipo },
    contas_disponiveis: contas.map(c => c.nome),
    totais: { entradas, saidas, liquido: entradas - saidas, linhas: linhas.length },
    obs: 'grupo transferencia = movimento entre contas próprias ou pagamento de fatura (não é receita nem despesa); grupo socio = retirada, fora do resultado',
    por_categoria: [...porCategoria.values()].sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas)).slice(0, 40),
    lancamentos: itens.map(l => ({
      data: l.data, conta: l.conta, valor: l.valor, descricao: l.descricao.slice(0, 80),
      ...(l.contraparte ? { contraparte: String(l.contraparte).slice(0, 60) } : {}), categoria: l.categoria,
      ...(l.tarifa ? { tarifa: l.tarifa } : {}),
    })),
    ...(truncado ? { truncado: `${truncado} lançamentos (mais recentes primeiro); os totais consideram todos` } : {}),
  };
}

async function ferramentaFolha() {
  const hoje = hojeSP();
  const desde = somarDias(hoje, -60);
  const [funcs, prevista, pags, vales] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin.from('funcionarios')
      .select('id, nome, funcao, frequencia, salario_mensal, data_admissao, data_desligamento, ativo, registrado')),
    folhaPrevista(),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos')
      .select('id, funcionario_id, periodo_inicio, periodo_fim, pago_em, valor_bruto, total_vales, ajuste, valor_liquido')
      .gte('pago_em', desde)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_vales').select('id, funcionario_id, data, valor, descricao').is('pagamento_id', null)),
  ]);
  const nome = new Map(funcs.map(f => [String(f.id), String(f.nome)]));
  const ativos = funcs.filter(f => f.ativo !== false);
  return {
    resumo: {
      funcionarios_ativos: ativos.length, salarios_mensais: prevista.salarios, encargos_estimados: prevista.encargos_estimados,
      vales_em_aberto: vales.reduce((a, v) => a + (Number(v.valor) || 0), 0),
      pago_ultimos_60_dias: pags.reduce((a, p) => a + (Number(p.valor_liquido) || 0), 0),
    },
    funcionarios: funcs.sort((a, b) => Number(b.ativo !== false) - Number(a.ativo !== false) || String(a.nome).localeCompare(String(b.nome))).map(f => ({
      nome: f.nome, funcao: f.funcao, frequencia: f.frequencia, salario_mensal: Number(f.salario_mensal) || 0,
      registrado: Boolean(f.registrado), admissao: f.data_admissao, ...(f.ativo === false ? { desligado_em: f.data_desligamento ?? 'inativo' } : {}),
    })),
    proximos_pagamentos: prevista.proximos.map(p => ({
      funcionario: p.nome, data: p.data_pagamento, periodo: `${p.periodo_inicio} a ${p.periodo_fim}`, bruto: p.bruto, vales: p.vales, liquido: p.liquido,
    })),
    pagamentos_ultimos_60_dias: pags.sort((a, b) => String(b.pago_em).localeCompare(String(a.pago_em))).slice(0, 100).map(p => ({
      funcionario: nome.get(String(p.funcionario_id)) ?? '?', pago_em: p.pago_em, periodo: `${p.periodo_inicio} a ${p.periodo_fim}`,
      bruto: Number(p.valor_bruto), vales: Number(p.total_vales), ajuste: Number(p.ajuste), liquido: Number(p.valor_liquido),
    })),
    vales_em_aberto: vales.map(v => ({ funcionario: nome.get(String(v.funcionario_id)) ?? '?', data: v.data, valor: Number(v.valor), descricao: v.descricao })),
  };
}

// ------------------------------------------------------------
// Definicao das ferramentas
// ------------------------------------------------------------

const DATA = (descricao: string) => ({ type: 'string', format: 'date', description: descricao });
const vazio = { type: 'object' as const, properties: {}, required: [] as string[], additionalProperties: false };

const DEFINICOES: Array<{ ferramenta: Anthropic.Beta.BetaTool; executar: (e: Row) => Promise<unknown> }> = [
  {
    ferramenta: {
      name: 'panorama_hoje',
      description: 'Resumo da gestão agora: vendas e recebimentos de hoje, mês até hoje (faturamento, margem, despesas, resultado parcial, projeção), saldos das contas, a receber, a pagar (atrasado, hoje, 7 e 30 dias, folha mais próxima), maquininha do mês, fluxo dos próximos dias e alertas. Use para "como estou hoje?", "como está o mês?" e visão geral. É a consulta mais lenta: não use quando outra ferramenta responde direto.',
      input_schema: vazio,
    },
    executar: () => ferramentaPanorama(),
  },
  {
    ferramenta: {
      name: 'fechamento_mes',
      description: 'Fechamento de um mês: vendas (faturamento, CMV, lucro bruto, margem, ticket), recebimentos por método, taxas da maquininha e cashback, despesas por grupo (orçado x realizado, maiores itens), resultado da operação e caixa livre, caixa do mês (entradas e saídas do extrato), comparativo com o mês anterior e qualidade dos dados. Use para "como fechou outubro?", "qual foi o lucro do mês?", "quanto gastei com diesel em setembro?".',
      input_schema: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mês no formato AAAA-MM.' } },
        required: ['mes'],
        additionalProperties: false,
      },
    },
    executar: ferramentaFechamento,
  },
  {
    ferramenta: {
      name: 'vendas',
      description: 'Vendas confirmadas num período (data do pedido, dia comercial de São Paulo; orçamento e cancelado não contam). Sempre traz o resumo (faturamento, CMV, lucro bruto, margem, pedidos, ticket médio). agrupar_por: "dia", "produto" (por nome + unidade: quantidade, receita, custo, margem), "cliente", "categoria" (de produto), "forma_pagamento" ou "nenhum". filtro_produto restringe aos itens cujo nome contém o texto (ex.: "cimento"). Use para "quanto vendi ontem?", "quanto de cimento vendi nos últimos 30 dias?", "qual produto mais vendeu na semana?".',
      input_schema: {
        type: 'object',
        properties: {
          de: DATA('Primeiro dia, AAAA-MM-DD.'),
          ate: DATA('Último dia (inclusive), AAAA-MM-DD.'),
          agrupar_por: { type: 'string', enum: ['nenhum', 'dia', 'produto', 'cliente', 'categoria', 'forma_pagamento'] },
          limite: { type: 'integer', description: 'Máximo de linhas agrupadas (padrão 30, máximo 200).' },
          filtro_produto: { type: 'string', description: 'Parte do nome do produto, sem acento importa (ex.: "areia", "cimento cp2").' },
        },
        required: ['de', 'ate', 'agrupar_por'],
        additionalProperties: false,
      },
    },
    executar: ferramentaVendas,
  },
  {
    ferramenta: {
      name: 'produto',
      description: 'Ficha de produtos pelo nome (ou código): preço de venda, custo cadastrado, margem do cadastro, estoque atual (já resolvendo estoque compartilhado) e quanto vendeu nos últimos 30 e 90 dias por unidade, com receita, custo e margem real. Use para "qual a margem da areia?", "quanto tenho de cimento?", "quanto custa o bloco 14?".',
      input_schema: {
        type: 'object',
        properties: { busca: { type: 'string', description: 'Nome ou parte do nome do produto (ex.: "areia media", "cimento").' } },
        required: ['busca'],
        additionalProperties: false,
      },
    },
    executar: ferramentaProduto,
  },
  {
    ferramenta: {
      name: 'clientes',
      description: 'Clientes. Com busca (nome ou telefone): ficha de cada cliente encontrado com total comprado, pedidos, primeira e última compra, saldo em aberto, orçamentos não fechados e produtos mais comprados (de/ate opcionais somam o período). Sem busca: ranking dos clientes que mais compraram entre de e ate (padrão: mês atual até hoje), com participação e saldo em aberto. Use para "qual cliente mais comprou este mês?", "quanto o João já comprou?".',
      input_schema: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Nome ou telefone do cliente. Omita para o ranking.' },
          de: DATA('Início do período, AAAA-MM-DD.'),
          ate: DATA('Fim do período (inclusive), AAAA-MM-DD.'),
          limite: { type: 'integer', description: 'Tamanho do ranking (padrão 20, máximo 200).' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    executar: ferramentaClientes,
  },
  {
    ferramenta: {
      name: 'a_receber',
      description: 'Quem deve para o depósito agora: total a receber, vencido, a vencer, sem prazo, entregue e não pago, e a lista de clientes com saldo, atraso e pedidos em aberto (até 100 clientes). Também traz o recebido nos últimos 30 dias por método. Use para "quem me deve?", "quanto tenho a receber?".',
      input_schema: vazio,
    },
    executar: () => ferramentaAReceber(),
  },
  {
    ferramenta: {
      name: 'contas_a_pagar',
      description: 'Contas a pagar (boletos, parcelas, faturas). status: "pendente" (padrão; período pelo vencimento), "atrasadas", "pago" (período pela data do pagamento) ou "todas". Traz total, lista, retroativas a confirmar, a folha prevista no período (separada) e o resumo geral (atrasado, hoje, 7 e 30 dias, pago no mês). Use para "quanto tenho a pagar esta semana?", "o que está atrasado?", "quanto paguei de aluguel?".',
      input_schema: {
        type: 'object',
        properties: {
          de: DATA('Início, AAAA-MM-DD. Omita para não limitar.'),
          ate: DATA('Fim (inclusive), AAAA-MM-DD. Omita para não limitar.'),
          status: { type: 'string', enum: ['pendente', 'atrasadas', 'pago', 'todas'] },
          busca: { type: 'string', description: 'Texto na descrição, fornecedor ou categoria (ex.: "aluguel", "Votoran").' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    executar: ferramentaContasPagar,
  },
  {
    ferramenta: {
      name: 'despesas_fixas',
      description: 'Tabela de custos fixos combinados (orçado) de um mês: valor de cada despesa, grupo (folha, estrutura, operação, comercial, imposto e sócios, dívida), dia de vencimento, parcelas restantes de dívidas e o total por grupo. Use para "quanto é meu custo fixo?", "quanto falta do financiamento?".',
      input_schema: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mês AAAA-MM (padrão: mês atual).' } },
        required: [],
        additionalProperties: false,
      },
    },
    executar: ferramentaDespesasFixas,
  },
  {
    ferramenta: {
      name: 'saldos',
      description: 'Saldo estimado de cada conta agora (banco Itaú, Stone, caixa em espécie, carteira Vloz, cartão da empresa) e o total disponível, com a data do último saldo informado e o que foi somado depois. Use para "quanto tenho em caixa?", "qual o saldo do banco?".',
      input_schema: vazio,
    },
    executar: () => ferramentaSaldos(),
  },
  {
    ferramenta: {
      name: 'maquininha',
      description: 'Maquininha Stone num mês: volume por débito, crédito e Pix, custo de taxas pela tabela, taxa real (arquivo Vloz e extrato Stone), tarifas Pix, cashback Votoran previsto e recebido, custo líquido e custo por faixa de parcelas. Use para "quanto paguei de taxa na maquininha?", "quanto veio de cashback?".',
      input_schema: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mês no formato AAAA-MM.' } },
        required: ['mes'],
        additionalProperties: false,
      },
    },
    executar: ferramentaMaquininha,
  },
  {
    ferramenta: {
      name: 'extrato',
      description: 'Lançamentos categorizados das contas (extrato do banco e da Stone, caixa, cartão da empresa, Vloz) num período: totais de entradas e saídas, soma por categoria e as linhas (mais recentes primeiro). Filtros opcionais: conta (parte do nome: "itau", "stone", "caixa", "vloz", "cartao"), categoria (parte do nome ou grupo: "diesel", "cmv", "socio"), busca (descrição ou contraparte) e tipo (entradas/saidas). Use para "quanto gastei de diesel este mês?", "quanto paguei para a Votoran?", "quanto retirei?".',
      input_schema: {
        type: 'object',
        properties: {
          de: DATA('Primeiro dia, AAAA-MM-DD.'),
          ate: DATA('Último dia (inclusive), AAAA-MM-DD.'),
          conta: { type: 'string', description: 'Parte do nome da conta.' },
          categoria: { type: 'string', description: 'Parte do nome da categoria ou do grupo.' },
          busca: { type: 'string', description: 'Texto na descrição ou contraparte.' },
          tipo: { type: 'string', enum: ['todas', 'entradas', 'saidas'] },
          limite: { type: 'integer', description: 'Máximo de linhas (padrão 50, máximo 200). Os totais consideram todas.' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
    executar: ferramentaExtrato,
  },
  {
    ferramenta: {
      name: 'folha',
      description: 'Funcionários e folha: salário de cada um, frequência de pagamento, próximos pagamentos previstos (bruto, vales, líquido), pagamentos feitos nos últimos 60 dias e vales em aberto. Use para "quanto vou pagar de folha no sábado?", "quanto ganha o fulano?".',
      input_schema: vazio,
    },
    executar: () => ferramentaFolha(),
  },
];

export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = DEFINICOES.map(d => ({ ...d.ferramenta, strict: true }));
const EXECUTORES = new Map(DEFINICOES.map(d => [d.ferramenta.name, d.executar]));
export const NOMES_FERRAMENTAS = DEFINICOES.map(d => d.ferramenta.name);

/** Roda uma ferramenta e devolve o texto do tool_result. Erro vira `is_error` (nunca derruba o loop). */
export async function executarFerramenta(nome: string, entrada: unknown): Promise<{ conteudo: string; erro: boolean }> {
  const executar = EXECUTORES.get(nome);
  if (!executar) return { conteudo: `Ferramenta desconhecida: ${nome}.`, erro: true };
  const e = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada as Row : {};
  try {
    return { conteudo: json(await executar(e)), erro: false };
  } catch (err) {
    if (err instanceof ErroFerramenta) return { conteudo: err.message, erro: true };
    console.error(`[assistente] ferramenta ${nome} falhou:`, err);
    return { conteudo: 'A consulta falhou no servidor. Diga ao usuário que não foi possível obter esse dado agora.', erro: true };
  }
}

// ------------------------------------------------------------
// Prompt
// ------------------------------------------------------------

// Fixo (vai em cache junto com as ferramentas). Nada que mude por dia aqui.
const SISTEMA_FIXO = `Você é o assistente de gestão do Depósito Oliveira, loja de materiais de construção em Carapicuíba/SP (areia, pedra, cimento, blocos, ferro, madeira, telhas, laje; entrega com caminhões próprios e retirada no balcão). Quem pergunta é o Roger, dono e administrador: pode ver tudo, inclusive salários.

Você responde perguntas do dia a dia sobre vendas, clientes, produtos, contas, caixa e resultado, sempre consultando as ferramentas. Não invente número: se a ferramenta não trouxe o dado, diga que não tem e, se fizer sentido, onde ele aparece no sistema.

Como ler os dados:
- Venda é pedido confirmado. Status "orcamento" (proposta) e "cancelado" não são venda. Faturamento conta pela data em que o pedido foi criado, no dia comercial de São Paulo.
- CMV usa o custo gravado no item na hora da venda; se não houver, o custo atual do produto. Item sem custo cadastrado infla a margem: avise quando a ferramenta mostrar receita sem custo relevante.
- Mesmo produto vendido em unidades diferentes (ex.: m³ e saco) não se soma em quantidade; fale de cada unidade.
- Maquininha Stone: 15% de cada venda no cartão vai para a carteira Vloz da Votorantim (só serve para comprar cimento Votoran); o extrato da Stone mostra só 85%. O cashback da Votoran (reembolso de taxa) também cai na Vloz. Pix não tem divisão.
- Retirada de sócio e despesa pessoal ficam fora do resultado da operação (aparecem só no caixa). Pagamento de fatura do cartão e transferência entre contas próprias não são despesa.
- Folha vem do cadastro de funcionários, não das contas a pagar.
- Resultado por competência (fechamento) e caixa do mês não batem por definição; diga qual dos dois está usando.

Como responder:
- Português do Brasil, direto, curto. Comece pelo número que responde a pergunta.
- Valores em reais no formato brasileiro: R$ 1.234,56. Percentuais com vírgula: 23,4%. Datas como 16/10 ou 16/10/2026.
- Diga o período e de onde veio o número (ex.: "vendas confirmadas de 01/10 a 16/10").
- Interprete datas relativas pelo calendário informado abaixo. "Semana" é de segunda até hoje, salvo pedido diferente. O depósito abre de segunda a sábado; domingo normalmente não tem venda.
- Para comparar períodos, consulte os dois.
- Listas e tabelas curtas em markdown simples (negrito, listas, tabela com |). Nada de títulos grandes.
- Se a pergunta for ambígua, responda a interpretação mais provável e diga qual usou.
- Você só lê dados; não consegue lançar, pagar ou alterar nada. Se pedirem, diga em qual tela do sistema fazer.`;

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Calendario do dia (muda todo dia: fica depois do ponto de cache). */
export function calendarioHoje(hoje: string = hojeSP()): string {
  const dow = diaSemana(hoje);
  const ontem = somarDias(hoje, -1);
  const segunda = somarDias(hoje, -((dow + 6) % 7));
  const mes = hoje.slice(0, 7);
  const ant = mesAnterior(mes);
  const { inicio: iniAnt, fim: fimAnt } = inicioFimMes(ant);
  return `Calendário (fuso America/Sao_Paulo; use datas AAAA-MM-DD nas ferramentas):
- Hoje: ${DIAS[dow]}, ${hoje}.
- Ontem: ${DIAS[diaSemana(ontem)]}, ${ontem}.${dow === 1 ? ` Último dia aberto antes de hoje: sábado, ${somarDias(hoje, -2)}.` : ''}
- Esta semana: ${segunda} a ${hoje}. Semana passada: ${somarDias(segunda, -7)} a ${somarDias(segunda, -1)}.
- Este mês: ${mes} (${mes}-01 a ${hoje}). Mês passado: ${ant} (${iniAnt} a ${fimAnt}).
- Últimos 30 dias: ${somarDias(hoje, -29)} a ${hoje}.`;
}

export function sistema(hoje: string = hojeSP()): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: 'text', text: SISTEMA_FIXO, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: calendarioHoje(hoje) },
  ];
}

// ------------------------------------------------------------
// Loop
// ------------------------------------------------------------

export interface MensagemChat { papel: 'usuario' | 'assistente'; texto: string }

export type EventoAssistente =
  | { tipo: 'ferramentas'; nomes: string[] }
  | { tipo: 'texto'; delta: string }
  | { tipo: 'reiniciar' }     // texto mostrado ate aqui era preambulo de uma chamada de ferramenta
  | { tipo: 'fim'; ferramentas_usadas: string[]; aviso?: string };

export class ErroAssistente extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

/** Historico de texto da UI -> mensagens da API (primeira e ultima do usuario). */
export function montarMensagens(historico: MensagemChat[]): Anthropic.Beta.BetaMessageParam[] {
  const msgs: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of historico) {
    const texto = String(m.texto ?? '').trim();
    if (!texto) continue;
    const role = m.papel === 'assistente' ? 'assistant' : 'user';
    if (msgs.length === 0 && role === 'assistant') continue;
    const ultima = msgs[msgs.length - 1];
    if (ultima && ultima.role === role && typeof ultima.content === 'string') ultima.content = `${ultima.content}\n\n${texto}`;
    else msgs.push({ role, content: texto });
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new ErroAssistente(400, 'Mande uma pergunta.');
  return msgs;
}

/**
 * Depois de um fallback no meio da resposta, os blocos de pensamento e de
 * ferramenta ANTES do ultimo bloco 'fallback' nao podem voltar para a API
 * (o modelo que recusou nao vai rodar aquelas ferramentas).
 */
function conteudoParaEco(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  let ultimo = -1;
  content.forEach((b, i) => { if (b.type === 'fallback') ultimo = i; });
  if (ultimo < 0) return content;
  const descartar = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
  return content.filter((b, i) => i > ultimo || !descartar.has(b.type));
}

let cliente: Anthropic | null = null;
function clienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErroAssistente(503, 'Assistente sem chave da IA configurada.');
  if (!cliente) cliente = new Anthropic({ maxRetries: 2 });
  return cliente;
}

/**
 * Responde a ultima pergunta do historico. Emite eventos enquanto roda (texto
 * em streaming, nomes das ferramentas consultadas) e termina com 'fim'.
 */
export async function responder(
  historico: MensagemChat[],
  aoEvento: (e: EventoAssistente) => void,
  sinal?: AbortSignal,
  opcoes: { client?: Anthropic } = {},   // client injetavel so para teste
): Promise<void> {
  const client = opcoes.client ?? clienteAnthropic();
  const messages = montarMensagens(historico);
  const system = sistema();
  const usadas: string[] = [];

  for (let iteracao = 0; iteracao < MAX_ITERACOES; iteracao++) {
    const stream = client.beta.messages.stream({
      model: MODELO_ASSISTENTE,
      max_tokens: MAX_TOKENS,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: ESFORCO },
      // Cache automatico no ultimo bloco (historico que cresce no loop); o
      // system fixo tem o seu proprio ponto, que cobre tambem as ferramentas.
      cache_control: { type: 'ephemeral' },
      system,
      tools: FERRAMENTAS,
      tool_choice: { type: 'auto' },
      messages,
    }, { signal: sinal });
    stream.on('text', delta => aoEvento({ tipo: 'texto', delta }));
    const resposta = await stream.finalMessage();

    switch (resposta.stop_reason) {
      case 'end_turn':
      case 'stop_sequence':
        aoEvento({ tipo: 'fim', ferramentas_usadas: usadas });
        return;
      case 'refusal':
        aoEvento({ tipo: 'reiniciar' });
        aoEvento({ tipo: 'texto', delta: 'Não consegui responder essa pergunta. Tente reformular.' });
        aoEvento({ tipo: 'fim', ferramentas_usadas: usadas, aviso: 'recusa' });
        return;
      case 'max_tokens':
        aoEvento({ tipo: 'fim', ferramentas_usadas: usadas, aviso: 'A resposta ficou longa demais e foi cortada.' });
        return;
      case 'pause_turn':
        messages.push({ role: 'assistant', content: conteudoParaEco(resposta.content) });
        continue;
      case 'tool_use': {
        const eco = conteudoParaEco(resposta.content);
        const chamadas = eco.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (!chamadas.length) {
          aoEvento({ tipo: 'fim', ferramentas_usadas: usadas });
          return;
        }
        aoEvento({ tipo: 'reiniciar' });
        aoEvento({ tipo: 'ferramentas', nomes: chamadas.map(c => c.name) });
        for (const c of chamadas) if (!usadas.includes(c.name)) usadas.push(c.name);
        messages.push({ role: 'assistant', content: eco });
        // Chamadas em paralelo; todos os resultados numa unica mensagem.
        const resultados = await Promise.all(chamadas.map(async c => {
          const r = await executarFerramenta(c.name, c.input);
          const bloco: Anthropic.Beta.BetaToolResultBlockParam = {
            type: 'tool_result', tool_use_id: c.id, content: r.conteudo, ...(r.erro ? { is_error: true } : {}),
          };
          return bloco;
        }));
        messages.push({ role: 'user', content: resultados });
        continue;
      }
      default:
        aoEvento({ tipo: 'fim', ferramentas_usadas: usadas, aviso: 'A resposta terminou antes do esperado.' });
        return;
    }
  }
  aoEvento({ tipo: 'fim', ferramentas_usadas: usadas, aviso: 'A pergunta exigiu consultas demais; tente algo mais específico.' });
}
