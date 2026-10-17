import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/atendimento?pendentes=1 -> { vendas_ia, abertos, ultima_venda_em }
//   Contadores para o alerta (som + selo) no sistema e no kanban.
// GET /api/atendimento?caso=<id>   -> { caso } com dados da venda da IA
//   Usado por /?lancar=<id> para pre-preencher o orcamento.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  try {
    if (sp.get('pendentes')) {
      const [{ count: vendas }, { count: abertos }, { data: ult }] = await Promise.all([
        supabaseAdmin.from('atendimento_fila').select('id', { count: 'exact', head: true }).eq('status', 'aberto').eq('motivo', 'venda_fechada'),
        supabaseAdmin.from('atendimento_fila').select('id', { count: 'exact', head: true }).eq('status', 'aberto'),
        supabaseAdmin.from('atendimento_fila').select('criado_em').eq('status', 'aberto').eq('motivo', 'venda_fechada')
          .order('criado_em', { ascending: false }).limit(1),
      ]);
      return NextResponse.json({ vendas_ia: vendas ?? 0, abertos: abertos ?? 0, ultima_venda_em: ult?.[0]?.criado_em ?? null });
    }
    const casoId = sp.get('caso');
    if (casoId) {
      const { data, error } = await supabaseAdmin.from('atendimento_fila')
        .select('id, cliente_id, orcamento_id, telefone, motivo, resumo, status, criado_em, dados, lancado_orcamento_id, clientes ( nome, telefone )')
        .eq('id', casoId).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'Caso não encontrado' }, { status: 404 });
      return NextResponse.json({ caso: data });
    }
    return NextResponse.json({ error: 'Informe pendentes=1 ou caso=<id>' }, { status: 400 });
  } catch (e) {
    console.error('Erro GET /api/atendimento', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PATCH /api/atendimento { id, status?: 'resolvido' | 'aberto', orcamento_id? }
//   orcamento_id = pedido lancado a partir da venda da IA (resolve junto).
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { id?: string; status?: string; orcamento_id?: string } | null;
    if (!body?.id) return NextResponse.json({ error: 'Informe o id do caso' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (body.orcamento_id) {
      update.lancado_orcamento_id = body.orcamento_id;
      update.status = 'resolvido';
      update.resolvido_em = new Date().toISOString();
      update.resolvido_por = 'lancado no sistema';
    }
    if (body.status === 'resolvido') { update.status = 'resolvido'; update.resolvido_em = new Date().toISOString(); }
    if (body.status === 'aberto') { update.status = 'aberto'; update.resolvido_em = null; }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
    const { error } = await supabaseAdmin.from('atendimento_fila').update(update).eq('id', body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro PATCH /api/atendimento', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
