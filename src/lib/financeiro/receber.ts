// A receber: pedidos com saldo em aberto, agrupados por cliente, e a baixa
// "Receber do cliente" (um valor distribuido pelos pedidos mais antigos).
//
// calcularReceber e a logica de GET /api/financeiro — mesma resposta — com
// uma correcao consciente: o "hoje" que decide o que esta vencido e o dia
// comercial de Sao Paulo (hojeSP), nao o dia UTC do servidor.

import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import type { ClienteAReceber, ContaAberta, FinanceiroReceber, Metodo, PagamentoCriado, Papel, ReceberDoCliente, ReceberPorCliente } from './tipos';
import { arred2, dataBRT, diasEntre, hojeSP } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';
import { METODOS, carregarCategorias, categoriaPorNome, hashInterno } from './contas-pagar';
import { contaPorTipo } from './saldos';

type Row = Record<string, any>;
const CENTAVO = 0.01;
const NAO_VENDA = ['orcamento', 'cancelado'];
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

// Mesmo calculo da rota: dias corridos entre a referencia e agora.
function diasAte(de: string, ate: Date): number {
  return Math.floor((ate.getTime() - new Date(de).getTime()) / 86_400_000);
}

const SELECT_ABERTO = `
  id, codigo, total, valor_pago, status, status_pagamento,
  condicao_pagamento, vencimento, forma_pagamento,
  entregue_sem_pagamento,
  data_entrega, data_retirada, criado_em,
  clientes ( id, nome, telefone )
`;

function paraContaAberta(o: Row, hojeStr: string, agora: Date): ContaAberta {
  const cli = um<Row>(o.clientes);
  const saldo = Number(o.total) - Number(o.valor_pago ?? 0);
  const referencia = o.vencimento || o.data_entrega || o.data_retirada || o.criado_em;
  return {
    id: String(o.id),
    codigo: o.codigo ?? null,
    cliente_id: cli?.id ? String(cli.id) : null,
    cliente_nome: cli?.nome ?? 'Sem cliente',
    cliente_telefone: cli?.telefone ?? null,
    total: Number(o.total),
    valor_pago: Number(o.valor_pago ?? 0),
    saldo,
    status: o.status,
    status_pagamento: o.status_pagamento ?? null,
    condicao_pagamento: o.condicao_pagamento ?? null,
    vencimento: o.vencimento ?? null,
    entregue_sem_pagamento: Boolean(o.entregue_sem_pagamento),
    entregue: o.status === 'completo',
    vencido: Boolean(o.vencimento) && o.vencimento < hojeStr,
    dias_em_aberto: referencia ? Math.max(0, diasAte(referencia, agora)) : 0,
    criado_em: o.criado_em ?? null,
  };
}

/** Pedidos que sao venda e ainda nao estao quitados (status_pagamento <> completo). */
async function lerAbertos(): Promise<Row[]> {
  // status_pagamento e derivado pelo trigger: 'completo' = quitado. O filtro
  // reduz a um conjunto pequeno; a checagem de saldo em JS continua como rede.
  return lerTudo<Row>(() => supabaseAdmin
    .from('orcamentos')
    .select(SELECT_ABERTO)
    .not('status', 'in', `(${NAO_VENDA.join(',')})`)
    .neq('status_pagamento', 'completo')
    .order('criado_em', { ascending: true }));
}

export async function calcularReceber(dias = 30): Promise<FinanceiroReceber> {
  const periodo = Number(dias) || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - periodo);
  const agora = new Date();
  const hojeStr = hojeSP();

  const [abertos, recebidos] = await Promise.all([
    lerAbertos(),
    lerTudo<Row>(() => supabaseAdmin
      .from('pagamentos')
      .select('valor, metodo, origem, data_pagamento')
      .gte('data_pagamento', desde.toISOString())),
  ]);

  const emAberto = abertos
    .map(o => paraContaAberta(o, hojeStr, agora))
    .filter(o => o.saldo > CENTAVO)
    .sort((a, b) => b.dias_em_aberto - a.dias_em_aberto);

  const soma = (rows: { saldo: number }[]) => rows.reduce((s, r) => s + r.saldo, 0);
  const vencidos = emAberto.filter(o => o.vencido);
  const aVencer = emAberto.filter(o => o.vencimento && !o.vencido);
  const semPrazo = emAberto.filter(o => !o.vencimento);
  const entregueNaoPago = emAberto.filter(o => o.entregue);

  const porMetodo: Record<string, number> = {};
  let recebidoPeriodo = 0;
  for (const p of recebidos) {
    const v = Number(p.valor);
    recebidoPeriodo += v;
    porMetodo[p.metodo] = (porMetodo[p.metodo] ?? 0) + v;
  }

  // Lacuna herdada: marcados 'parcial' antes do controle existir, sem registro
  // de quanto entrou. Precisam de triagem manual.
  const triagemParcial = abertos
    .filter(o => o.status_pagamento === 'parcial' && Number(o.valor_pago ?? 0) === 0)
    .map(o => ({
      id: String(o.id),
      codigo: o.codigo ?? null,
      cliente_nome: um<Row>(o.clientes)?.nome ?? 'Sem cliente',
      total: Number(o.total),
    }));

  return {
    periodo_dias: periodo,
    resumo: {
      recebido_periodo: recebidoPeriodo,
      recebido_por_metodo: porMetodo,
      total_a_receber: soma(emAberto),
      vencido: soma(vencidos),
      a_vencer: soma(aVencer),
      sem_prazo: soma(semPrazo),
      entregue_nao_pago: soma(entregueNaoPago),
      qtd_a_receber: emAberto.length,
      qtd_vencidos: vencidos.length,
      qtd_entregue_nao_pago: entregueNaoPago.length,
    },
    em_aberto: emAberto,
    triagem_parcial: triagemParcial,
  };
}

export function chaveCliente(o: { cliente_id: string | null; cliente_telefone: string | null }): string {
  if (o.cliente_id) return o.cliente_id;
  if (o.cliente_telefone) return `tel:${o.cliente_telefone}`;
  return 'sem_cliente';
}

/** Agrupa os pedidos em aberto por cliente; quem esta mais atrasado (e deve mais) vem primeiro. */
export function agruparPorCliente(emAberto: ContaAberta[], hoje: string = hojeSP()): ClienteAReceber[] {
  const mapa = new Map<string, ClienteAReceber>();
  for (const o of emAberto) {
    const chave = chaveCliente(o);
    let c = mapa.get(chave);
    if (!c) {
      c = {
        chave, cliente_id: o.cliente_id, nome: o.cliente_nome, telefone: o.cliente_telefone,
        saldo_total: 0, qtd_pedidos: 0, maior_atraso_dias: 0, tem_vencido: false, tem_entregue_nao_pago: false, pedidos: [],
      };
      mapa.set(chave, c);
    }
    c.saldo_total = arred2(c.saldo_total + o.saldo);
    c.qtd_pedidos++;
    c.pedidos.push(o);
    if (o.vencido && o.vencimento) {
      c.tem_vencido = true;
      c.maior_atraso_dias = Math.max(c.maior_atraso_dias, diasEntre(o.vencimento, hoje));
    }
    if (o.entregue) c.tem_entregue_nao_pago = true;
  }
  return [...mapa.values()].sort((a, b) =>
    Number(b.tem_vencido) - Number(a.tem_vencido) || b.maior_atraso_dias - a.maior_atraso_dias || b.saldo_total - a.saldo_total);
}

/** Resposta de GET /api/financeiro/receber. */
export async function receberPorCliente(dias = 30): Promise<ReceberPorCliente> {
  const base = await calcularReceber(dias);
  const clientes = agruparPorCliente(base.em_aberto);
  return { periodo_dias: base.periodo_dias, resumo: { ...base.resumo, qtd_clientes: clientes.length }, clientes };
}

/**
 * Venda em dinheiro vira linha de caixa (hash 'pag:<id>', upsert: sincronizar
 * de novo nao duplica). Mesmo formato do 'sincronizar' de /api/financeiro/caixa.
 * Sem conta de caixa cadastrada, nao faz nada. Devolve quantas linhas gravou.
 */
export async function registrarVendasDinheiroNoCaixa(
  pags: Array<{ id: string; valor: number; data: string; orcamento_id: string; codigo?: string | null; cliente_nome?: string | null }>,
): Promise<number> {
  if (pags.length === 0) return 0;
  const caixa = await contaPorTipo('caixa');
  if (!caixa) return 0;
  const categorias = await carregarCategorias();
  const cat = categoriaPorNome(categorias, 'Venda - Dinheiro (caixa)');
  const linhas = pags.map(p => ({
    conta_id: caixa.id,
    data: p.data,
    descricao: `Venda em dinheiro${p.codigo ? ` — ${p.codigo}` : ''}`,
    contraparte: p.cliente_nome ?? null,
    valor: arred2(p.valor),
    hash_linha: hashInterno(caixa.id, 'caixa', `pag:${p.id}`),
    categoria_id: cat?.id ?? null,
    categoria_origem: 'regra',
    categoria_confianca: 1,
    revisado: true,
    pagamento_id: p.id,
    orcamento_id: p.orcamento_id,
    origem_lancamento: 'pagamento',
  }));
  const { data, error } = await supabaseAdmin
    .from('lancamentos_bancarios')
    .upsert(linhas, { onConflict: 'hash_linha', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);
  return (data || []).length;
}

export type EntradaReceberDoCliente = ReceberDoCliente & { usuarioId: string | null; papel?: Papel };

/**
 * Da baixa num valor recebido do cliente, distribuindo pelos pedidos em
 * aberto do mais antigo pro mais novo (vencimento, depois criacao). Cria N
 * pagamentos com o mesmo grupo_recebimento (a conciliacao casa pela soma);
 * o trigger do banco recalcula valor_pago/status_pagamento de cada pedido.
 * Valor acima do saldo total -> 409. data_pagamento so vale pra admin.
 */
export async function receberDoCliente(e: EntradaReceberDoCliente): Promise<{ pagamentos: PagamentoCriado[]; grupo_recebimento: string }> {
  const valor = arred2(Number(e.valor));
  if (!Number.isFinite(valor) || valor <= 0) throw new ErroFinanceiro(400, 'Informe o valor recebido.');
  if (!METODOS.includes(e.metodo as Metodo)) throw new ErroFinanceiro(400, 'Método de pagamento inválido.');
  const parcelas = Math.trunc(Number(e.parcelas) || 0);
  if (e.metodo === 'credito' && parcelas < 1) throw new ErroFinanceiro(400, 'Informe o número de parcelas do crédito.');
  if (parcelas > 12) throw new ErroFinanceiro(400, 'Máximo de 12 parcelas.');
  if (!e.cliente_id && !e.telefone && !e.orcamento_id) throw new ErroFinanceiro(400, 'Informe o cliente.');

  let dataPagamento = new Date().toISOString();
  if (e.data_pagamento && e.papel === 'admin') {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(e.data_pagamento) ? `${e.data_pagamento}T15:00:00.000Z` : e.data_pagamento);
    if (Number.isNaN(d.getTime())) throw new ErroFinanceiro(400, 'Data de pagamento inválida.');
    dataPagamento = d.toISOString();
  }

  // Pedidos do cliente com saldo, do mais antigo pro mais novo.
  let abertos = await lerAbertos();
  if (e.orcamento_id) {
    abertos = abertos.filter(o => String(o.id) === e.orcamento_id);
  } else if (e.cliente_id) {
    abertos = abertos.filter(o => String(um<Row>(o.clientes)?.id ?? '') === e.cliente_id);
  } else if (e.telefone) {
    const tel = e.telefone.replace(/\D/g, '');
    abertos = abertos.filter(o => String(um<Row>(o.clientes)?.telefone ?? '').replace(/\D/g, '') === tel);
  }
  const pedidos = abertos
    .map(o => ({ o, saldo: arred2(Number(o.total) - Number(o.valor_pago ?? 0)) }))
    .filter(x => x.saldo > CENTAVO)
    .sort((a, b) =>
      String(a.o.vencimento ?? '9999').localeCompare(String(b.o.vencimento ?? '9999'))
      || String(a.o.criado_em ?? '').localeCompare(String(b.o.criado_em ?? '')));
  const saldoTotal = arred2(pedidos.reduce((a, x) => a + x.saldo, 0));
  if (pedidos.length === 0) throw new ErroFinanceiro(409, 'Esse cliente não tem pedido em aberto.');
  if (valor > saldoTotal + CENTAVO) {
    throw new ErroFinanceiro(409, `Valor maior que o saldo em aberto do cliente (R$ ${saldoTotal.toFixed(2).replace('.', ',')}).`);
  }

  const grupo = randomUUID();
  const linhas: Row[] = [];
  let restante = valor;
  for (const { o, saldo } of pedidos) {
    if (restante <= CENTAVO) break;
    const aplicar = arred2(Math.min(saldo, restante));
    restante = arred2(restante - aplicar);
    linhas.push({
      orcamento_id: o.id,
      valor: aplicar,
      metodo: e.metodo,
      parcelas: Math.max(1, parcelas),
      parcelas_informadas: true,
      data_pagamento: dataPagamento,
      origem: 'manual',
      observacoes: e.observacoes?.trim() || null,
      grupo_recebimento: grupo,
    });
  }

  const { data: criados, error } = await supabaseAdmin
    .from('pagamentos')
    .insert(linhas)
    .select('id, orcamento_id, valor, metodo, parcelas, data_pagamento');
  if (error) throw new Error(error.message);
  const ids = ((criados || []) as Row[]).map(p => String(p.orcamento_id));

  // Releitura pos-trigger: valor_pago ja recalculado. Pedido quitado que
  // fora entregue sem pagamento perde o flag (mesma regra do POST /api/pagamentos).
  const { data: atualizados } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, valor_pago, entregue_sem_pagamento')
    .in('id', ids);
  const porId = new Map(((atualizados || []) as Row[]).map(o => [String(o.id), o]));
  for (const o of porId.values()) {
    if (o.entregue_sem_pagamento && Number(o.valor_pago) >= Number(o.total) - CENTAVO) {
      await supabaseAdmin.from('orcamentos').update({ entregue_sem_pagamento: false, entregue_sem_pagamento_em: null }).eq('id', o.id);
    }
  }

  const pagamentos: PagamentoCriado[] = ((criados || []) as Row[]).map(p => {
    const o = porId.get(String(p.orcamento_id));
    return {
      id: String(p.id),
      orcamento_id: String(p.orcamento_id),
      codigo: o?.codigo ?? null,
      valor: arred2(Number(p.valor)),
      metodo: p.metodo as Metodo,
      parcelas: Number(p.parcelas) || 1,
      saldo_restante: arred2(Number(o?.total ?? 0) - Number(o?.valor_pago ?? 0)),
    };
  });

  if (e.metodo === 'dinheiro') {
    try {
      await registrarVendasDinheiroNoCaixa(pagamentos.map(p => ({
        // Dia comercial (BRT), nao o dia UTC: venda as 21h30 e de hoje, nao de amanha.
        id: p.id, valor: p.valor, data: dataBRT(dataPagamento), orcamento_id: p.orcamento_id, codigo: p.codigo,
        cliente_nome: um<Row>(pedidos[0]?.o.clientes)?.nome ?? null,
      })));
    } catch (err) {
      console.error('[financeiro/receber] falha ao lancar dinheiro no caixa:', err);
    }
  }

  await registrarEvento({
    entidade: 'pagamento', acao: 'receber_cliente',
    depois: { grupo_recebimento: grupo, cliente_id: e.cliente_id ?? null, telefone: e.telefone ?? null, valor, metodo: e.metodo, parcelas, pagamentos: pagamentos.map(p => p.id) },
    usuario_id: e.usuarioId,
  });
  return { pagamentos, grupo_recebimento: grupo };
}
