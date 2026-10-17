// CMV e vendas por mes — a mesma regra do dashboard.
//
// preco_custo (produtos e snapshot em orcamento_itens) e por UNIDADE DE
// VENDA; fator_conversao so converte estoque. Entao CMV = quantidade x
// preco_custo, sem fator. O snapshot do item vale; se for 0/null usa o
// custo atual do produto ("Opcao B", igual ao /api/dashboard).

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import { arred2, dataBRT, limitesMesUtc, limitesPeriodoUtc, mesSeguinte } from './datas';

// Pedidos que ainda sao proposta (ou morreram) nao sao venda.
export const STATUS_NAO_VENDA = ['orcamento', 'cancelado'];

export interface ItemCmv {
  quantidade: number;
  preco_custo: number | null;
  produto_id: string | null;
  produto_nome?: string | null;
  subtotal?: number | null;
  preco_unitario?: number | null;
}

export interface VendasMes {
  mes: string;
  faturamento: number;
  qtd_pedidos: number;
  cmv: number;
  lucro_bruto: number;
  margem_bruta_pct: number | null;
  receita_sem_custo: number;      // receita de itens sem custo conhecido (margem inflada)
  ticket_medio: number;
  pedidos_sem_pagamento: number;  // vendas do mes com valor_pago ~ 0
}

/**
 * CMV de um pedido. `custoAtual` e indexado por produto_id; aceita tambem a
 * chave 'nome:<produto_nome>' pra item sem produto_id (digitado a mao).
 */
export function cmvDoPedido(
  itens: ItemCmv[],
  custoAtual: Map<string, number>,
): { cmv: number; receita_sem_custo_itens: number } {
  let cmv = 0;
  let semCusto = 0;
  for (const it of itens) {
    const qtd = Number(it.quantidade) || 0;
    const snapshot = Number(it.preco_custo) || 0;
    const atual = (it.produto_id ? custoAtual.get(it.produto_id) : undefined)
      ?? (it.produto_nome ? custoAtual.get(`nome:${it.produto_nome}`) : undefined)
      ?? 0;
    const unit = snapshot > 0 ? snapshot : atual;
    if (unit > 0) {
      cmv += unit * qtd;
    } else {
      const receita = it.subtotal != null ? Number(it.subtotal) : (Number(it.preco_unitario) || 0) * qtd;
      semCusto += receita || 0;
    }
  }
  return { cmv: arred2(cmv), receita_sem_custo_itens: arred2(semCusto) };
}

async function custoAtualDosProdutos(): Promise<Map<string, number>> {
  const produtos = await lerTudo<{ id: string; nome: string; preco_custo: number | string | null }>(() =>
    supabaseAdmin.from('produtos').select('id, nome, preco_custo'));
  const mapa = new Map<string, number>();
  for (const p of produtos) {
    const c = Number(p.preco_custo) || 0;
    mapa.set(String(p.id), c);
    if (p.nome) mapa.set(`nome:${p.nome}`, c);
  }
  return mapa;
}

interface OrcamentoRow { id: string; total: number | string; valor_pago: number | string | null; criado_em: string }
interface ItemRow extends ItemCmv { orcamento_id: string }

async function carregarVendas(inicioUtc: string, fimUtc: string) {
  const pedidos = await lerTudo<OrcamentoRow>(() => supabaseAdmin
    .from('orcamentos')
    .select('id, total, valor_pago, criado_em')
    .not('status', 'in', `(${STATUS_NAO_VENDA.join(',')})`)
    .gte('criado_em', inicioUtc)
    .lt('criado_em', fimUtc));
  const itens = await lerTudoEmLotes<ItemRow>(pedidos.map(p => String(p.id)), lote => supabaseAdmin
    .from('orcamento_itens')
    .select('orcamento_id, produto_id, produto_nome, quantidade, preco_custo, subtotal, preco_unitario')
    .in('orcamento_id', lote));
  return { pedidos, itens };
}

function resumir(mes: string, pedidos: OrcamentoRow[], itens: ItemRow[], custoAtual: Map<string, number>): VendasMes {
  const porPedido = new Map<string, ItemRow[]>();
  for (const it of itens) {
    const k = String(it.orcamento_id);
    const lista = porPedido.get(k);
    if (lista) lista.push(it); else porPedido.set(k, [it]);
  }
  let faturamento = 0;
  let cmv = 0;
  let semCusto = 0;
  let semPagamento = 0;
  for (const p of pedidos) {
    faturamento += Number(p.total) || 0;
    if ((Number(p.valor_pago) || 0) <= 0.01) semPagamento++;
    const r = cmvDoPedido(porPedido.get(String(p.id)) ?? [], custoAtual);
    cmv += r.cmv;
    semCusto += r.receita_sem_custo_itens;
  }
  const lucro = faturamento - cmv;
  return {
    mes,
    faturamento: arred2(faturamento),
    qtd_pedidos: pedidos.length,
    cmv: arred2(cmv),
    lucro_bruto: arred2(lucro),
    margem_bruta_pct: faturamento > 0 ? arred2((lucro / faturamento) * 100) : null,
    receita_sem_custo: arred2(semCusto),
    ticket_medio: pedidos.length > 0 ? arred2(faturamento / pedidos.length) : 0,
    pedidos_sem_pagamento: semPagamento,
  };
}

/** Vendas do mes (criado_em no mes, em BRT; status fora de orcamento/cancelado). */
export async function vendasDoMes(mes: string): Promise<VendasMes> {
  const { inicioUtc, fimUtc } = limitesMesUtc(mes);
  const [{ pedidos, itens }, custoAtual] = await Promise.all([carregarVendas(inicioUtc, fimUtc), custoAtualDosProdutos()]);
  return resumir(mes, pedidos, itens, custoAtual);
}

/**
 * Vendas de varios meses de uma vez (uma leitura de pedidos, itens e
 * produtos). Devolve um item por mes do intervalo, mesmo sem venda.
 */
export async function vendasPorMes(mesInicio: string, mesFim: string): Promise<Map<string, VendasMes>> {
  const meses: string[] = [];
  for (let m = mesInicio; m <= mesFim; m = mesSeguinte(m)) meses.push(m);
  const { inicioUtc } = limitesMesUtc(mesInicio);
  const { fimUtc } = limitesMesUtc(mesFim);
  const [{ pedidos, itens }, custoAtual] = await Promise.all([carregarVendas(inicioUtc, fimUtc), custoAtualDosProdutos()]);

  const pedidosPorMes = new Map<string, OrcamentoRow[]>();
  for (const p of pedidos) {
    const m = dataBRT(p.criado_em).slice(0, 7);
    const lista = pedidosPorMes.get(m);
    if (lista) lista.push(p); else pedidosPorMes.set(m, [p]);
  }
  const itensPorPedido = new Map<string, ItemRow[]>();
  for (const it of itens) {
    const lista = itensPorPedido.get(String(it.orcamento_id));
    if (lista) lista.push(it); else itensPorPedido.set(String(it.orcamento_id), [it]);
  }

  const saida = new Map<string, VendasMes>();
  for (const m of meses) {
    const ps = pedidosPorMes.get(m) ?? [];
    const its = ps.flatMap(p => itensPorPedido.get(String(p.id)) ?? []);
    saida.set(m, resumir(m, ps, its, custoAtual));
  }
  return saida;
}

/** Vendas de um intervalo de dias (BRT), inclusive. */
export async function vendasDoPeriodo(de: string, ate: string): Promise<VendasMes> {
  const { inicioUtc, fimUtc } = limitesPeriodoUtc(de, ate);
  const [{ pedidos, itens }, custoAtual] = await Promise.all([carregarVendas(inicioUtc, fimUtc), custoAtualDosProdutos()]);
  return resumir(de.slice(0, 7), pedidos, itens, custoAtual);
}
