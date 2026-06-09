import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/produtos/[id]/historico-custos
// Ultimas 20 mudancas de preco_custo do produto, ordenadas por
// criado_em DESC. usuario_nome via LEFT JOIN com usuarios (pode ser
// null quando o caller nao mandou usuario_id no PUT, ou quando o
// usuario foi removido).
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const { data, error } = await supabaseAdmin
      .from('historico_custos')
      .select(`
        id, custo_anterior, custo_novo, criado_em,
        usuarios:usuario_id ( nome )
      `)
      .eq('produto_id', params.id)
      .order('criado_em', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[historico-custos] erro:', error);
      return NextResponse.json({ error: 'Erro ao buscar historico' }, { status: 500 });
    }

    // Achata o JOIN — PostgREST retorna `usuarios` como objeto (to-one).
    const itens = (data || []).map(r => {
      const u = r.usuarios as { nome?: string | null } | Array<{ nome?: string | null }> | null;
      const usuarioObj = Array.isArray(u) ? u[0] : u;
      return {
        id: r.id,
        custo_anterior: Number(r.custo_anterior) || 0,
        custo_novo: Number(r.custo_novo) || 0,
        criado_em: r.criado_em,
        usuario_nome: usuarioObj?.nome ?? null,
      };
    });

    return NextResponse.json({ historico: itens });
  } catch (e) {
    console.error('[historico-custos] erro interno:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
