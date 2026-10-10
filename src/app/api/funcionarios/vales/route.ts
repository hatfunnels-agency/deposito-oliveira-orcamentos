import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { hojeSP } from '@/lib/folha';

export const dynamic = 'force-dynamic';

/** POST /api/funcionarios/vales — { funcionario_id, valor, data?, descricao? } */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    const valor = Number(body.valor);
    if (!body.funcionario_id) return NextResponse.json({ error: 'Escolha o funcionário.' }, { status: 400 });
    if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'Valor do vale inválido.' }, { status: 400 });
    const data = typeof body.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : hojeSP();

    const { data: vale, error } = await supabaseAdmin
      .from('funcionario_vales')
      .insert({
        funcionario_id: body.funcionario_id,
        valor: Math.round(valor * 100) / 100,
        data,
        descricao: String(body.descricao ?? '').trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(vale);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/vales:', e);
    return NextResponse.json({ error: 'Erro ao lançar vale' }, { status: 500 });
  }
}

/** DELETE /api/funcionarios/vales?id= — so vale em aberto (ja descontado nao se apaga). */
export async function DELETE(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('funcionario_vales')
      .delete()
      .eq('id', id)
      .is('pagamento_id', null)
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: 'Vale já descontado num pagamento. Desfaça o pagamento antes.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/funcionarios/vales:', e);
    return NextResponse.json({ error: 'Erro ao apagar vale' }, { status: 500 });
  }
}
