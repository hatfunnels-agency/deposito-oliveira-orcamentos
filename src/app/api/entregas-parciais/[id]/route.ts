import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sincronizarPedidoEntregas } from '@/lib/entregas-programadas';

export const dynamic = 'force-dynamic';

// DELETE /api/entregas-parciais/[id]
// Cancela uma entrega parcial: devolve as quantidades ao pool de pendentes
// (decrementa quantidade_entregue dos itens) e reajusta o status do orcamento.
// Nao mexe em estoque: a baixa ja foi feita quando o pedido virou pendente,
// e o item continua reservado para entrega — so volta a ficar "a entregar".
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    // 1) Carrega a entrega parcial + seus itens
    const { data: entrega, error: entregaErr } = await supabaseAdmin
      .from('entregas_parciais')
      .select('id, orcamento_id, status, entregas_parciais_itens ( id, orcamento_item_id, quantidade )')
      .eq('id', params.id)
      .single();

    if (entregaErr || !entrega) {
      return NextResponse.json({ error: 'Entrega parcial nao encontrada' }, { status: 404 });
    }

    // Viagem so programada: nada foi somado como entregue — so apaga e
    // reacerta a data do pedido.
    if ((entrega as { status?: string }).status === 'programada') {
      await supabaseAdmin.from('entregas_parciais_itens').delete().eq('entrega_parcial_id', params.id);
      const { error: delProgErr } = await supabaseAdmin.from('entregas_parciais').delete().eq('id', params.id);
      if (delProgErr) return NextResponse.json({ error: 'Erro ao cancelar entrega programada' }, { status: 500 });
      const sinc = await sincronizarPedidoEntregas((entrega as { orcamento_id: string }).orcamento_id);
      return NextResponse.json({ success: true, novo_status: sinc.status });
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

    // 4) Status e data pelo que sobrou entregue — mesma regra das entregas
    //    programadas, que so mexe em pedido de entrega (antes recalculava sem
    //    olhar o status atual e podia "descancelar" um pedido).
    const sinc = await sincronizarPedidoEntregas(orcamentoId);
    const novoStatus = sinc.status;

    return NextResponse.json({ success: true, novo_status: novoStatus });
  } catch (e) {
    console.error('Erro DELETE /api/entregas-parciais/[id]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PATCH /api/entregas-parciais/[id]
//   { acao: 'entregar' }       -> a viagem programada saiu e foi entregue:
//                                 soma as quantidades e acerta status/data.
//   { data_entrega: 'AAAA-MM-DD' } -> muda o dia de uma viagem programada.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const { data: entrega } = await supabaseAdmin
      .from('entregas_parciais')
      .select('id, orcamento_id, status, entregas_parciais_itens ( orcamento_item_id, quantidade )')
      .eq('id', params.id)
      .single();
    if (!entrega) return NextResponse.json({ error: 'Entrega nao encontrada' }, { status: 404 });
    const ent = entrega as { id: string; orcamento_id: string; status: string; entregas_parciais_itens: Array<{ orcamento_item_id: string; quantidade: number }> };
    if (ent.status !== 'programada') {
      return NextResponse.json({ error: 'Esta entrega ja foi registrada como feita' }, { status: 400 });
    }

    if (body?.acao === 'entregar') {
      const ids = (ent.entregas_parciais_itens || []).map(i => i.orcamento_item_id);
      const { data: orcItens } = await supabaseAdmin
        .from('orcamento_itens').select('id, quantidade, quantidade_entregue, produto_nome').in('id', ids);
      const mapa = new Map((orcItens || []).map(o => [o.id, o]));
      // Nao deixa passar do total (alguem pode ter registrado entrega por fora).
      for (const i of ent.entregas_parciais_itens || []) {
        const o = mapa.get(i.orcamento_item_id);
        if (!o) continue;
        const restante = (Number(o.quantidade) || 0) - (Number(o.quantidade_entregue) || 0);
        if ((Number(i.quantidade) || 0) > restante + 1e-9) {
          return NextResponse.json({ error: `${o.produto_nome}: so faltam ${Math.max(0, restante)} — ajuste a entrega` }, { status: 400 });
        }
      }
      const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const { error: upErr } = await supabaseAdmin.from('entregas_parciais')
        .update({ status: 'entregue', entregue_em: new Date().toISOString(), data_entrega: hoje })
        .eq('id', ent.id).eq('status', 'programada');
      if (upErr) return NextResponse.json({ error: 'Erro ao registrar a entrega' }, { status: 500 });
      for (const i of ent.entregas_parciais_itens || []) {
        const o = mapa.get(i.orcamento_item_id);
        if (!o) continue;
        await supabaseAdmin.from('orcamento_itens')
          .update({ quantidade_entregue: (Number(o.quantidade_entregue) || 0) + (Number(i.quantidade) || 0) })
          .eq('id', o.id);
      }
      // Sem outra viagem programada, o restante fica sem data (quadro "sem
      // data" da aba Entregas) ate a atendente combinar.
      const sinc = await sincronizarPedidoEntregas(ent.orcamento_id, { dataProxima: null });
      return NextResponse.json({ success: true, novo_status: sinc.status, tudo_entregue: sinc.status === 'completo' });
    }

    if (typeof body?.data_entrega === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data_entrega)) {
      const { error } = await supabaseAdmin.from('entregas_parciais')
        .update({ data_entrega: body.data_entrega }).eq('id', ent.id);
      if (error) return NextResponse.json({ error: 'Erro ao mudar a data' }, { status: 500 });
      const sinc = await sincronizarPedidoEntregas(ent.orcamento_id);
      return NextResponse.json({ success: true, novo_status: sinc.status });
    }

    return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
  } catch (e) {
    console.error('Erro PATCH /api/entregas-parciais/[id]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
