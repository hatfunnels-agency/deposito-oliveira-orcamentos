import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/entregas/sem-data
// Entregas confirmadas com material que ainda nao tem dia pra sair:
//   - pedido sem data e sem nenhuma entrega programada; ou
//   - pedido com entregas programadas, mas com itens que nao entraram em
//     nenhuma delas (o "restante" que ninguem marcou o dia).
// A aba Entregas lista por dia, entao estas sumiam dela — em 10/10 havia 8.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, valor_pago, motivo_sem_data, criado_em, clientes ( nome, telefone ), endereco_completo:enderecos_clientes ( bairro, cidade ), orcamento_itens ( id, quantidade, quantidade_entregue )')
    .eq('tipo_entrega', 'entrega')
    .is('data_entrega', null)
    .in('status', ['entrega_pendente', 'entrega_parcial', 'em_rota'])
    .order('criado_em', { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: 'Erro ao buscar entregas sem data', entregas: [] }, { status: 500 });

  const ids = (data || []).map(o => o.id as string);
  const programado = new Map<string, number>(); // orcamento_item_id -> qtd em entregas programadas
  const comViagem = new Set<string>();
  if (ids.length) {
    const { data: viagens } = await supabaseAdmin
      .from('entregas_parciais')
      .select('orcamento_id, entregas_parciais_itens ( orcamento_item_id, quantidade )')
      .eq('status', 'programada').in('orcamento_id', ids);
    for (const v of (viagens || []) as Array<{ orcamento_id: string; entregas_parciais_itens: Array<{ orcamento_item_id: string; quantidade: number }> }>) {
      comViagem.add(String(v.orcamento_id));
      for (const i of v.entregas_parciais_itens || []) {
        programado.set(i.orcamento_item_id, (programado.get(i.orcamento_item_id) || 0) + (Number(i.quantidade) || 0));
      }
    }
  }

  const entregas = (data || [])
    .map(o => {
      const itens = (o.orcamento_itens || []) as Array<{ id: string; quantidade: number; quantidade_entregue: number }>;
      const faltaProgramar = itens.some(i =>
        (Number(i.quantidade) || 0) - (Number(i.quantidade_entregue) || 0) - (programado.get(i.id) || 0) > 1e-9);
      const { orcamento_itens: _itens, ...resto } = o as Record<string, unknown>;
      return { ...resto, parcialmente_programada: comViagem.has(o.id as string), faltaProgramar };
    })
    .filter(o => o.faltaProgramar)
    .map(({ faltaProgramar: _f, ...o }) => o);
  return NextResponse.json({ entregas });
}
