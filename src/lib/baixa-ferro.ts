// Baixa de estoque de FERRO no PATCH /api/orcamentos/[id].
// SERVER-ONLY — nunca importar de componente 'use client'.
//
// Fluxo INDEPENDENTE do helper estoque-baixa.ts (que cobre os outros
// produtos). Por design, o spec do Batch C nao unifica os 2 fluxos:
// ferro tem regra propria (caminhos a+b abaixo) e idempotencia propria
// (via coluna orcamentos.ferro_baixado).
//
// Cobre 2 caminhos de decremento:
// (a) Item avulso (produto_id IS NULL — gerado pela CalculadoraFerro).
//     Le ferragem_consumo rows do item. Pra cada (tipo_ferro, metros),
//     decrementa metros do produto onde produtos.tipo_ferro = tipo_ferro.
// (b) Produto com produtos.baixa_estoque_em_produto_id setado (ex: "Barra
//     3/8 10mm" -> "Ferro 10mm" com fator 12). Decrementa
//     item.quantidade * baixa_estoque_fator do produto proxy.
//
// Reversao (cancelamento) recalcula do zero com a mesma logica e aplica
// como movimento positivo. NAO le movimentacoes_estoque — robusto contra
// log inconsistente. tipo='cancelamento' na movimentacao (consistencia
// com reverterBaixaItem do estoque-baixa.ts).
//
// IMPORTANTE: estoque pode ir NEGATIVO de proposito (sem Math.max(0,...).
// Decisao consciente — alerta visual da UI (Task C.4) usa
// estoque_atual - metros_reservados < 0 pra sinalizar estouro. Mascarar
// com zero esconderia o problema.
//
// Idempotencia: caller verifica orcamentos.ferro_baixado antes de chamar
// aplicar/reverter e seta a flag depois do sucesso. Helper nao toca
// nessa flag — fica explicito no PATCH.

import { supabaseAdmin } from '@/lib/supabase';

export interface ResultadoBaixaFerro {
  ok: boolean;
  produtos_afetados: number;
  erro?: string;
}

interface ItemDoOrcamento {
  id: string;
  produto_id: string | null;
  quantidade: number;
  produto_nome: string | null;
}

interface FerragemConsumoRow {
  orcamento_item_id: string;
  tipo_ferro: string;
  metros: number;
}

// Calcula os decrementos por produto_id de ferro (path a + path b).
// Retorna Map<produto_id, metros_totais>. Funcao pura — usada tanto pela
// aplicacao (decremento) quanto pela reversao (aplicado como incremento).
async function calcularDecrementosFerro(orcamento_id: string): Promise<Map<string, number>> {
  // 1) Itens do orcamento
  const { data: itensRaw } = await supabaseAdmin
    .from('orcamento_itens')
    .select('id, produto_id, quantidade, produto_nome')
    .eq('orcamento_id', orcamento_id);
  const itens = (itensRaw || []) as ItemDoOrcamento[];
  if (itens.length === 0) return new Map();

  // 2) ferragem_consumo de todos os itens (path a)
  const itemIds = itens.map(i => i.id);
  const { data: fcRaw } = await supabaseAdmin
    .from('ferragem_consumo')
    .select('orcamento_item_id, tipo_ferro, metros')
    .in('orcamento_item_id', itemIds);
  const ferragemRows = (fcRaw || []) as FerragemConsumoRow[];

  // 3) Produtos com tipo_ferro IS NOT NULL — map tipo_ferro -> produto_id
  const { data: prodFerroRaw } = await supabaseAdmin
    .from('produtos')
    .select('id, tipo_ferro')
    .not('tipo_ferro', 'is', null);
  const ferroMap = new Map<string, string>();
  for (const p of (prodFerroRaw || []) as Array<{ id: string; tipo_ferro: string }>) {
    if (p.tipo_ferro) ferroMap.set(p.tipo_ferro, p.id);
  }

  // 4) Produtos referenciados pelos itens (com baixa_estoque_em_produto_id)
  //    — map produto_id -> { proxyId, fator } (path b)
  const produtoIdsItens = Array.from(new Set(itens.map(i => i.produto_id).filter((x): x is string => !!x)));
  const proxyMap = new Map<string, { proxyId: string; fator: number }>();
  if (produtoIdsItens.length > 0) {
    const { data: prodItensRaw } = await supabaseAdmin
      .from('produtos')
      .select('id, baixa_estoque_em_produto_id, baixa_estoque_fator')
      .in('id', produtoIdsItens)
      .not('baixa_estoque_em_produto_id', 'is', null);
    for (const p of (prodItensRaw || []) as Array<{
      id: string;
      baixa_estoque_em_produto_id: string;
      baixa_estoque_fator: number | null;
    }>) {
      proxyMap.set(p.id, {
        proxyId: p.baixa_estoque_em_produto_id,
        fator: Number(p.baixa_estoque_fator) || 1,
      });
    }
  }

  // 5) Agrega decrementos
  const decrementos = new Map<string, number>();
  // Path a: ferragem_consumo dos itens avulsos (ou de qualquer item com fc).
  for (const f of ferragemRows) {
    const produtoFerroId = ferroMap.get(f.tipo_ferro);
    if (!produtoFerroId) continue;
    decrementos.set(
      produtoFerroId,
      (decrementos.get(produtoFerroId) || 0) + (Number(f.metros) || 0),
    );
  }
  // Path b: itens com produto_id apontando pra proxy.
  for (const item of itens) {
    if (!item.produto_id) continue;
    const proxy = proxyMap.get(item.produto_id);
    if (!proxy) continue;
    const qtd = (Number(item.quantidade) || 0) * proxy.fator;
    if (qtd === 0) continue;
    decrementos.set(
      proxy.proxyId,
      (decrementos.get(proxy.proxyId) || 0) + qtd,
    );
  }

  return decrementos;
}

// Aplica baixa: decrementa estoque_atual (permite negativo) + insere
// movimentacao tipo='saida'. Por produto, 1 SELECT + 1 UPDATE + 1 INSERT.
export async function aplicarBaixaFerro(orcamento_id: string): Promise<ResultadoBaixaFerro> {
  try {
    const decrementos = await calcularDecrementosFerro(orcamento_id);
    if (decrementos.size === 0) {
      return { ok: true, produtos_afetados: 0 };
    }

    let afetados = 0;
    for (const [produtoId, metros] of decrementos.entries()) {
      if (metros <= 0) continue;
      const { data: prod, error: selErr } = await supabaseAdmin
        .from('produtos')
        .select('id, nome, estoque_atual')
        .eq('id', produtoId)
        .single();
      if (selErr || !prod) {
        console.error('[baixa-ferro aplicar] produto nao encontrado', produtoId, selErr);
        continue;
      }
      const estoqueAnterior = Number(prod.estoque_atual) || 0;
      const estoqueNovo = estoqueAnterior - metros; // permite negativo

      const { error: updErr } = await supabaseAdmin
        .from('produtos')
        .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
        .eq('id', produtoId);
      if (updErr) {
        console.error('[baixa-ferro aplicar] update falhou', produtoId, updErr);
        continue;
      }

      const { error: movErr } = await supabaseAdmin.from('movimentacoes_estoque').insert({
        produto_id: produtoId,
        tipo: 'saida',
        quantidade: metros,
        estoque_anterior: estoqueAnterior,
        estoque_novo: estoqueNovo,
        referencia_tipo: 'orcamento',
        referencia_id: orcamento_id,
        observacoes: `Baixa ferro - ${prod.nome || ''}`,
      });
      if (movErr) {
        console.error('[baixa-ferro aplicar] insert movimentacao falhou (saldo ja atualizado)', movErr);
      }
      afetados++;
    }
    return { ok: true, produtos_afetados: afetados };
  } catch (e) {
    return { ok: false, produtos_afetados: 0, erro: (e as Error).message || 'excecao desconhecida' };
  }
}

// Reverte baixa: recalcula com a mesma logica e aplica como incremento.
// tipo='cancelamento' no log (consistencia com reverterBaixaItem).
export async function reverterBaixaFerro(orcamento_id: string): Promise<ResultadoBaixaFerro> {
  try {
    const decrementos = await calcularDecrementosFerro(orcamento_id);
    if (decrementos.size === 0) {
      return { ok: true, produtos_afetados: 0 };
    }

    let afetados = 0;
    for (const [produtoId, metros] of decrementos.entries()) {
      if (metros <= 0) continue;
      const { data: prod, error: selErr } = await supabaseAdmin
        .from('produtos')
        .select('id, nome, estoque_atual')
        .eq('id', produtoId)
        .single();
      if (selErr || !prod) {
        console.error('[baixa-ferro reverter] produto nao encontrado', produtoId, selErr);
        continue;
      }
      const estoqueAnterior = Number(prod.estoque_atual) || 0;
      const estoqueNovo = estoqueAnterior + metros; // soma (reverte decremento)

      const { error: updErr } = await supabaseAdmin
        .from('produtos')
        .update({ estoque_atual: estoqueNovo, atualizado_em: new Date().toISOString() })
        .eq('id', produtoId);
      if (updErr) {
        console.error('[baixa-ferro reverter] update falhou', produtoId, updErr);
        continue;
      }

      const { error: movErr } = await supabaseAdmin.from('movimentacoes_estoque').insert({
        produto_id: produtoId,
        tipo: 'cancelamento',
        quantidade: metros,
        estoque_anterior: estoqueAnterior,
        estoque_novo: estoqueNovo,
        referencia_tipo: 'orcamento',
        referencia_id: orcamento_id,
        observacoes: `Reversao ferro - ${prod.nome || ''}`,
      });
      if (movErr) {
        console.error('[baixa-ferro reverter] insert movimentacao falhou (saldo ja atualizado)', movErr);
      }
      afetados++;
    }
    return { ok: true, produtos_afetados: afetados };
  } catch (e) {
    return { ok: false, produtos_afetados: 0, erro: (e as Error).message || 'excecao desconhecida' };
  }
}
