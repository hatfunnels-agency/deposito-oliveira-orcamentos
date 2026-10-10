import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { brutoDoPeriodo, hojeSP, proximoPeriodo } from '@/lib/folha';

export const dynamic = 'force-dynamic';

/**
 * GET /api/funcionarios/pagamentos?funcionario_id=&de=&ate=
 * Historico de pagamentos com os vales que cada um descontou.
 */
export async function GET(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    let q = supabaseAdmin
      .from('funcionario_pagamentos')
      .select('*, funcionarios ( nome, frequencia ), funcionario_vales ( id, data, valor, descricao )')
      .order('pago_em', { ascending: false })
      .order('criado_em', { ascending: false })
      .limit(200);
    const fid = sp.get('funcionario_id');
    if (fid) q = q.eq('funcionario_id', fid);
    if (sp.get('de')) q = q.gte('pago_em', sp.get('de')!);
    if (sp.get('ate')) q = q.lte('pago_em', sp.get('ate')!);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ pagamentos: data || [] });
  } catch (e) {
    console.error('Erro em GET /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao carregar pagamentos' }, { status: 500 });
  }
}

/**
 * POST /api/funcionarios/pagamentos — { funcionario_id, pago_em?, ajuste?, observacoes? }
 *
 * Paga o PROXIMO periodo em aberto. O calculo e refeito aqui (nao confia
 * no numero da tela) e desconta todos os vales em aberto ate pago_em.
 */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    const pagoEm = typeof body.pago_em === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.pago_em) ? body.pago_em : hojeSP();
    const ajuste = Math.round((Number(body.ajuste) || 0) * 100) / 100;

    const { data: f, error: eF } = await supabaseAdmin
      .from('funcionarios').select('*').eq('id', body.funcionario_id).single();
    if (eF || !f) return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 });

    const { data: ult } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .select('periodo_fim')
      .eq('funcionario_id', f.id)
      .order('periodo_fim', { ascending: false })
      .limit(1)
      .maybeSingle();

    const base = { ...f, salario_mensal: Number(f.salario_mensal) };
    const periodo = proximoPeriodo(base, ult?.periodo_fim ?? null);
    const bruto = brutoDoPeriodo(base, periodo);

    const { data: vales } = await supabaseAdmin
      .from('funcionario_vales')
      .select('id, valor')
      .eq('funcionario_id', f.id)
      .is('pagamento_id', null)
      .lte('data', pagoEm);
    const totalVales = Math.round((vales || []).reduce((a, v) => a + Number(v.valor), 0) * 100) / 100;

    const { data: pag, error: eP } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .insert({
        funcionario_id: f.id,
        periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim,
        data_prevista: periodo.pagamento,
        pago_em: pagoEm,
        valor_bruto: bruto.valor,
        total_vales: totalVales,
        ajuste,
        valor_liquido: Math.round((bruto.valor - totalVales + ajuste) * 100) / 100,
        observacoes: String(body.observacoes ?? '').trim() || null,
      })
      .select()
      .single();
    if (eP) {
      // 23505 = unique (funcionario_id, periodo_fim): clique duplo.
      if (eP.code === '23505') return NextResponse.json({ error: 'Esse período já foi pago.' }, { status: 409 });
      throw eP;
    }

    if (vales?.length) {
      const { error: eV } = await supabaseAdmin
        .from('funcionario_vales')
        .update({ pagamento_id: pag.id })
        .in('id', vales.map(v => v.id));
      if (eV) {
        // Sem os vales marcados o pagamento ficaria errado: desfaz.
        await supabaseAdmin.from('funcionario_pagamentos').delete().eq('id', pag.id);
        throw eV;
      }
    }
    return NextResponse.json(pag);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao registrar pagamento' }, { status: 500 });
  }
}

/**
 * DELETE /api/funcionarios/pagamentos?id= — desfaz um pagamento lancado
 * por engano. Os vales voltam a ficar em aberto (FK ON DELETE SET NULL).
 * So o ultimo de cada funcionario, senao a sequencia de periodos quebra.
 */
export async function DELETE(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    const { data: pag } = await supabaseAdmin
      .from('funcionario_pagamentos').select('id, funcionario_id').eq('id', id).single();
    if (!pag) return NextResponse.json({ error: 'Pagamento não encontrado.' }, { status: 404 });
    const { data: ult } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .select('id')
      .eq('funcionario_id', pag.funcionario_id)
      .order('periodo_fim', { ascending: false })
      .limit(1)
      .single();
    if (ult?.id !== id) {
      return NextResponse.json({ error: 'Só dá para desfazer o último pagamento deste funcionário.' }, { status: 409 });
    }
    const { error } = await supabaseAdmin.from('funcionario_pagamentos').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao desfazer pagamento' }, { status: 500 });
  }
}
