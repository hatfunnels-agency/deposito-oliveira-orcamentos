import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/entregas/sem-data
// Entregas confirmadas sem data definida (cliente ainda vai combinar o dia
// com o pedreiro). A aba Entregas lista por dia, entao estas sumiam dela —
// em 10/10 havia 8 assim, invisiveis pra quem monta a rota.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, criado_em, clientes ( nome, telefone ), endereco_completo:enderecos_clientes ( bairro, cidade )')
    .eq('tipo_entrega', 'entrega')
    .is('data_entrega', null)
    .in('status', ['entrega_pendente', 'entrega_parcial', 'em_rota'])
    .order('criado_em', { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: 'Erro ao buscar entregas sem data', entregas: [] }, { status: 500 });
  return NextResponse.json({ entregas: data || [] });
}
