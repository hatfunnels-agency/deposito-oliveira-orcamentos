import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// DELETE /api/entregas-parciais/[id]
// Cancela uma entrega parcial: devolve as quantidades ao pool de pendentes
// (decrementa quantidade_entregue dos itens) e reajusta o status do orcamento.
// Nao mexe em estoque: a baixa ja foi feita quando o pedido virou pendente,
// e o item continua reservado para entrega — so volta a ficar "a entregar".
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1) Carrega a entrega parcial + seus itens
    const { data: entrega, error: entregaErr } = await supabaseAdmin
      .from('entregas_parciais')
      .select('id, orcamento_id, entregas_parciais_itens ( id, orcamento_item_id, quantidade )')
      .eq('id', params.id)
      .single();

    if (entregaErr || !entrega) {
      return NextResponse.json({ error: 'Entrega parcial nao encontrada' }, { status: 404 });
    }

    const orcamentoId = (entrega as { orcamento_id: string }).orcamento_id;
    const itensEntrega = ((entrega as {
      entregas_parciais_itens?: Array<{ id: string; orcamento_item_id: string; quantidade: number }>;
    }).entregas_parciais_itens) || [];

    // 2) Devolve as quantidades: decrementa quantidade_entregue de cada orcamento_item
    if (itensEntrega.length > 0) {
      const orcItemIds = itensEntrega.map(i => i.orcamento_item_id);
      const { data: orcItens } = await supabaseAdmin
        .from('orcamento_itens')
        .select('id, quantidade_entregue')
        .in('id', orcItemIds);
      const entregueMap = new Map<string, number>();
      for (const oi of orcItens || []) {
        entregueMap.set(oi.id, Number(oi.quantidade_entregue) || 0);
      }
      for (const it of itensEntrega) {
        const atual = entregueMap.get(it.orcamento_item_id) || 0;
        const nova = Math.max(0, atual - (Number(it.quantidade) || 0));
        await supabaseAdmin
          .from('orcamento_itens')
          .update({ quantidade_entregue: nova })
          .eq('id', it.orcamento_item_id);
      }
    }

    // 3) Remove os itens da entrega e a propria entrega
    await supabaseAdmin.from('entregas_parciais_itens').delete().eq('entrega_parcial_id', params.id);
    const { error: delErr } = await supabaseAdmin
      .from('entregas_parciais')
      .delete()
      .eq('id', params.id);
    if (delErr) {
      return NextResponse.json({ error: 'Erro ao cancelar entrega parcial' }, { status: 500 });
    }

    // 4) Recalcula o status do orcamento com base no que sobrou entregue
    const { data: todosItens } = await supabaseAdmin
      .from('orcamento_itens')
      .select('quantidade, quantidade_entregue')
      .eq('orcamento_id', orcamentoId);

    let tudoEntregue = (todosItens?.length || 0) > 0;
    let algumEntregue = false;
    for (const it of todosItens || []) {
      const q = Number(it.quantidade) || 0;
      const e = Number(it.quantidade_entregue) || 0;
      if (e + 1e-9 < q) tudoEntregue = false;
      if (e > 1e-9) algumEntregue = true;
    }
    const novoStatus = tudoEntregue ? 'completo' : algumEntregue ? 'entrega_parcial' : 'entrega_pendente';
    await supabaseAdmin
      .from('orcamentos')
      .update({ status: novoStatus, atualizado_em: new Date().toISOString() })
      .eq('id', orcamentoId);

    return NextResponse.json({ success: true, novo_status: novoStatus });
  } catch (e) {
    console.error('Erro DELETE /api/entregas-parciais/[id]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
