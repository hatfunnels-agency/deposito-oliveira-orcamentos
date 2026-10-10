import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { camposFuncionario } from '@/lib/folha';

export const dynamic = 'force-dynamic';

/** PATCH /api/funcionarios/[id] — edita (inclusive desligar: ativo=false + data_desligamento). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const { id } = await params;
    const campos = camposFuncionario(await request.json(), true);
    if (typeof campos === 'string') return NextResponse.json({ error: campos }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('funcionarios')
      .update(campos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro em PATCH /api/funcionarios/[id]:', e);
    return NextResponse.json({ error: 'Erro ao salvar funcionário' }, { status: 500 });
  }
}
