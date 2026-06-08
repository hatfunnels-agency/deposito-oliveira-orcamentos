// Helper de baixa de estoque a partir de um item de orcamento.
// SERVER-ONLY — nunca importar de componente 'use client'.
//
// Comportamento por tipo_estoque do produto:
// - estocavel: decrementa produtos.estoque_atual (em unidades de
//   armazenamento, multiplicando por fator_conversao) e registra em
//   movimentacoes_estoque (tipo='saida'). Comportamento que ja existia
//   inline no PATCH /api/orcamentos/[id].
// - sob_demanda: incrementa produtos.total_vendido (em unidades de
//   venda, sem multiplicar por fator) e NAO toca em estoque_atual nem
//   em movimentacoes_estoque (produtos comprados sob pedido nao tem
//   saldo fisico pra controlar — interessa so o agregado de vendas).
// - produto_id null: skip silencioso (~19% dos itens; vendas avulsas
//   digitadas na hora sem cadastro — irrecuperaveis).
//
// IMPORTANTE: callers devem `await` esta funcao. Fire-and-forget
// quebra em delegacao entre lambdas (Vercel mata Promise pendente
// quando a lambda externa retorna — ja vimos isso com o GHL sync).

import { supabaseAdmin } from '@/lib/supabase';

export interface ItemBaixa {
  produto_id: string | null | undefined;
  produto_nome?: string | null;
  quantidade: number;
}

export type ResultadoBaixa =
  | { ok: true; tipo: 'estocavel' | 'sob_demanda' }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; erro: string };

// Resolve estoque_compartilhado_com pra sempre operar no produto
// PRINCIPAL. Espelha resolverIdPrincipal do PATCH /api/orcamentos/[id].
async function resolverIdPrincipal(produto_id: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('produtos')
    .select('estoque_compartilhado_com')
    .eq('id', produto_id)
    .single();
  return (data?.estoque_compartilhado_com as string | null) || produto_id;
}

export async function aplicarBaixaItem(
  item: ItemBaixa,
  referencia_id: string,
): Promise<ResultadoBaixa> {
  if (!item.produto_id) {
    return { ok: false, skipped: true, reason: 'sem_produto_id' };
  }

  const qtd = Number(item.quantidade) || 0;
  if (qtd <= 0) {
    return { ok: false, skipped: true, reason: 'quantidade_zero' };
  }

  try {
    const idPrincipal = await resolverIdPrincipal(item.produto_id);

    const { data: produto, error: prodErr } = await supabaseAdmin
      .from('produtos')
      .select('id, nome, tipo_estoque, estoque_atual, total_vendido, fator_conversao')
      .eq('id', idPrincipal)
      .single();

    if (prodErr || !produto) {
      return { ok: false, skipped: true, reason: 'produto_nao_encontrado' };
    }

    if (produto.tipo_estoque === 'sob_demanda') {
      const novoTotal = Number(produto.total_vendido || 0) + qtd;
      const { error: updErr } = await supabaseAdmin
        .from('produtos')
        .update({
          total_vendido: novoTotal,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', produto.id);
      if (updErr) {
        return { ok: false, erro: 'update_total_vendido_falhou: ' + updErr.message };
      }
      return { ok: true, tipo: 'sob_demanda' };
    }

    // Estocavel — mesmo calculo que estava inline em /api/orcamentos/[id].
    const fator = Number(produto.fator_conversao) || 1;
    const qtdEstoque = qtd * fator;
    const estoqueAnterior = Number(produto.estoque_atual) || 0;
    const estoqueNovo = Math.max(0, estoqueAnterior - qtdEstoque);

    const { error: updErr } = await supabaseAdmin
      .from('produtos')
      .update({
        estoque_atual: estoqueNovo,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', produto.id);
    if (updErr) {
      return { ok: false, erro: 'update_estoque_falhou: ' + updErr.message };
    }

    // Audit log. Se falhar, o saldo ja foi atualizado — loga mas nao
    // propaga (nao adianta tentar rollback aqui sem transacao).
    const { error: movErr } = await supabaseAdmin
      .from('movimentacoes_estoque')
      .insert({
        produto_id: produto.id,
        tipo: 'saida',
        quantidade: qtdEstoque,
        estoque_anterior: estoqueAnterior,
        estoque_novo: estoqueNovo,
        referencia_tipo: 'orcamento',
        referencia_id,
        observacoes: `Venda - ${produto.nome || item.produto_nome || ''} x${qtd}`,
      });
    if (movErr) {
      console.error('[aplicarBaixaItem] insert movimentacao falhou (saldo ja atualizado):', movErr);
    }

    return { ok: true, tipo: 'estocavel' };
  } catch (e) {
    return { ok: false, erro: (e as Error).message || 'excecao desconhecida' };
  }
}
