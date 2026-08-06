import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recalcularVolumeLeva, propagarMotoristaLeva } from '@/lib/levas';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const body = await request.json();
    const { action, orcamento_ids, orcamento_id, status, motorista_id, data } = body;

    if (action === 'add_entregas' && orcamento_ids?.length > 0) {
      const { error } = await supabaseAdmin
        .from('orcamentos')
        .update({ leva_id: params.id })
        .in('id', orcamento_ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recalcularVolumeLeva(params.id);
      await propagarMotoristaLeva(params.id);
    } else if (action === 'remove_entrega' && orcamento_id) {
      const { error } = await supabaseAdmin
        .from('orcamentos')
        .update({ leva_id: null, motorista_id: null })
        .eq('id', orcamento_id)
        .eq('leva_id', params.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recalcularVolumeLeva(params.id);
    } else if (action === 'marcar_em_rota') {
      await supabaseAdmin.from('orcamentos').update({ status: 'em_rota' }).eq('leva_id', params.id).in('status', ['entrega_pendente', 'entrega_parcial', 'separacao', 'pagamento_ok']);
      await supabaseAdmin.from('levas_entrega').update({ status: 'em_rota' }).eq('id', params.id);
    } else {
      // Legacy: { orcamento_id, acao: 'adicionar'/'remover' }
      const orcIdLegacy = body.orcamento_id;
      const acaoLegacy = body.acao;
      if (orcIdLegacy && acaoLegacy) {
        if (acaoLegacy === 'adicionar') {
          await supabaseAdmin.from('orcamentos').update({ leva_id: params.id }).eq('id', orcIdLegacy);
        } else if (acaoLegacy === 'remover') {
          await supabaseAdmin.from('orcamentos').update({ leva_id: null, motorista_id: null }).eq('id', orcIdLegacy).eq('leva_id', params.id);
        }
        await recalcularVolumeLeva(params.id);
      }
      // Legacy status update
      const updateData: Record<string, unknown> = {};
      if (status) updateData.status = status;
      if (motorista_id !== undefined) updateData.motorista_id = motorista_id;
      if (data) updateData.data = data;
      if (Object.keys(updateData).length > 0) {
        const { error } = await supabaseAdmin.from('levas_entrega').update(updateData).eq('id', params.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (motorista_id !== undefined) {
        await propagarMotoristaLeva(params.id);
      }
      if (status === 'em_rota') {
        await supabaseAdmin.from('orcamentos').update({ status: 'em_rota' }).eq('leva_id', params.id).in('status', ['entrega_pendente', 'entrega_parcial', 'separacao', 'pagamento_ok']);
      }
    }

    const { data: leva, error } = await supabaseAdmin
      .from('levas_entrega')
      .select(`id, data, numero_leva, volume_total, status, criado_em, motorista_id,
        motoristas ( id, nome, veiculo )`)
      .eq('id', params.id)
      .single();

    if (error) return NextResponse.json({ error: 'Leva nao encontrada' }, { status: 404 });

    const { data: orcamentos } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, status, data_entrega, motorista_id, clientes ( nome, endereco, numero, bairro, cidade )')
      .eq('leva_id', params.id);

    return NextResponse.json({ ...leva, orcamentos: orcamentos || [] });
  } catch (e) {
    console.error('Erro em PATCH /api/levas/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    await supabaseAdmin.from('orcamentos').update({ leva_id: null, motorista_id: null }).eq('leva_id', params.id);
    const { error } = await supabaseAdmin.from('levas_entrega').delete().eq('id', params.id);
    if (error) return NextResponse.json({ error: 'Erro ao excluir leva' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro em DELETE /api/levas/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
