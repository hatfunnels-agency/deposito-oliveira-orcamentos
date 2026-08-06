import { supabaseAdmin } from '@/lib/supabase';

/**
 * Recalcula e persiste `levas_entrega.volume_total` a partir dos itens dos
 * pedidos vinculados a leva.
 *
 * Nao use embed `produto:produto_id ( volume_unitario )` aqui:
 * `orcamento_itens.produto_id` nao tem FK pra `produtos`, entao o PostgREST
 * responde PGRST200 / HTTP 400. Antes o erro era ignorado e o volume ficava
 * sempre zerado sem ninguem perceber. Por isso o volume vem de duas consultas.
 */
export const recalcularVolumeLeva = async (levaId: string): Promise<number> => {
  const { data: orcamentos } = await supabaseAdmin
    .from('orcamentos')
    .select('orcamento_itens ( quantidade, produto_id )')
    .eq('leva_id', levaId);

  const itens = (orcamentos || []).flatMap(
    o => ((o as Record<string, unknown>).orcamento_itens as Array<{ quantidade: number; produto_id: string | null }>) || []
  );
  const produtoIds = Array.from(
    new Set(itens.map(i => String(i.produto_id || '')).filter(Boolean))
  );

  const volumePorProduto = new Map<string, number>();
  if (produtoIds.length > 0) {
    const { data: produtos } = await supabaseAdmin
      .from('produtos')
      .select('id, volume_unitario')
      .in('id', produtoIds);
    for (const p of (produtos || [])) {
      volumePorProduto.set(String(p.id), Number(p.volume_unitario) || 0);
    }
  }

  const volumeTotal = itens.reduce(
    (acc, i) => acc + (volumePorProduto.get(String(i.produto_id || '')) || 0) * (Number(i.quantidade) || 0),
    0
  );
  const arredondado = Math.round(volumeTotal * 100) / 100;

  await supabaseAdmin
    .from('levas_entrega')
    .update({ volume_total: arredondado })
    .eq('id', levaId);

  return arredondado;
};

/**
 * O motorista mora na leva, mas o relatorio operacional le
 * `orcamentos.motorista_id`. Toda mudanca de composicao ou de motorista da
 * leva replica pros pedidos dela — sem isso a analise por motorista fica vazia
 * mesmo com a leva montada.
 */
export const propagarMotoristaLeva = async (levaId: string): Promise<void> => {
  const { data: leva } = await supabaseAdmin
    .from('levas_entrega')
    .select('motorista_id')
    .eq('id', levaId)
    .single();

  await supabaseAdmin
    .from('orcamentos')
    .update({ motorista_id: leva?.motorista_id ?? null })
    .eq('leva_id', levaId);
};
