import { NextRequest, NextResponse } from 'next/server';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/relatorios/metros-ferro?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&status=...
//
// Agregado de metros de ferro consumidos no periodo, agrupado por
// tipo_ferro. Pra cada tipo retorna metros_total, pedidos_count e
// valor_total_itens_ferragem (subtotal dos itens de orcamento que
// geraram o consumo).
//
// status default: != 'cancelado'. Se informado, filtra exatamente
// (status=completo, etc.).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const inicio = searchParams.get('inicio');
    const fim = searchParams.get('fim');
    const statusFiltro = searchParams.get('status');

    if (!inicio || !fim) {
      return NextResponse.json(
        { error: 'Parametros inicio e fim sao obrigatorios (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    // 1) Orcamentos no periodo (criado_em entre inicio e fim) com filtro
    //    de status. Pega so id pra usar como join key.
    // lerTudo / lerTudoEmLotes: o Supabase corta em 1.000 linhas sem avisar,
    // e um .in() com centenas de ids estoura a URL. O relatorio de periodos
    // longos saia com metros a menos.
    const montarOrc = () => {
      let q = supabaseAdmin
        .from('orcamentos')
        .select('id')
        .gte('criado_em', inicio + 'T00:00:00')
        .lte('criado_em', fim + 'T23:59:59.999');
      return statusFiltro ? q.eq('status', statusFiltro) : q.neq('status', 'cancelado');
    };
    let orcRows: Array<{ id: string }> = [];
    let orcErr: unknown = null;
    try { orcRows = await lerTudo(montarOrc); } catch (e) { orcErr = e; }
    if (orcErr) {
      console.error('[metros-ferro] erro orcamentos:', orcErr);
      return NextResponse.json({ error: 'Erro ao buscar orcamentos' }, { status: 500 });
    }
    const orcIds = (orcRows || []).map(o => o.id as string);
    if (orcIds.length === 0) {
      return NextResponse.json({ inicio, fim, total_pedidos: 0, agregados: [] });
    }

    // 2) orcamento_itens vinculados a esses orcamentos. Pega id + subtotal.
    let itensRows: Array<Record<string, unknown>> = [];
    let itensErr: unknown = null;
    try {
      itensRows = await lerTudoEmLotes(orcIds, lote => supabaseAdmin
        .from('orcamento_itens')
        .select('id, orcamento_id, subtotal')
        .in('orcamento_id', lote));
    } catch (e) { itensErr = e; }
    if (itensErr) {
      console.error('[metros-ferro] erro orcamento_itens:', itensErr);
      return NextResponse.json({ error: 'Erro ao buscar itens' }, { status: 500 });
    }
    const itemIds = (itensRows || []).map(i => i.id as string);
    const itemMeta = new Map<string, { orcamento_id: string; subtotal: number }>();
    for (const i of itensRows || []) {
      itemMeta.set(i.id as string, {
        orcamento_id: i.orcamento_id as string,
        subtotal: Number(i.subtotal) || 0,
      });
    }
    if (itemIds.length === 0) {
      return NextResponse.json({ inicio, fim, total_pedidos: orcIds.length, agregados: [] });
    }

    // 3) ferragem_consumo dos itens.
    let fcRows: Array<Record<string, unknown>> = [];
    let fcErr: unknown = null;
    try {
      fcRows = await lerTudoEmLotes(itemIds, lote => supabaseAdmin
        .from('ferragem_consumo')
        .select('orcamento_item_id, tipo_ferro, metros')
        .in('orcamento_item_id', lote));
    } catch (e) { fcErr = e; }
    if (fcErr) {
      console.error('[metros-ferro] erro ferragem_consumo:', fcErr);
      return NextResponse.json({ error: 'Erro ao buscar consumo de ferragem' }, { status: 500 });
    }

    // 4) Agrega em memoria por tipo_ferro.
    interface Acumulador {
      metros: number;
      pedidos: Set<string>;
      itens: Set<string>;
      valor: number;
    }
    const agg = new Map<string, Acumulador>();
    for (const r of fcRows || []) {
      const tipo = String(r.tipo_ferro);
      const itemId = String(r.orcamento_item_id);
      const meta = itemMeta.get(itemId);
      if (!meta) continue;
      const cur = agg.get(tipo) || { metros: 0, pedidos: new Set<string>(), itens: new Set<string>(), valor: 0 };
      cur.metros += Number(r.metros) || 0;
      cur.pedidos.add(meta.orcamento_id);
      // Soma o subtotal do item apenas uma vez por item (evita double-count
      // se houver multiplas linhas de ferragem_consumo pro mesmo item).
      if (!cur.itens.has(itemId)) {
        cur.itens.add(itemId);
        cur.valor += meta.subtotal;
      }
      agg.set(tipo, cur);
    }

    const agregados = Array.from(agg.entries())
      .map(([tipo_ferro, v]) => ({
        tipo_ferro,
        metros_total: Math.round(v.metros * 100) / 100,
        pedidos_count: v.pedidos.size,
        valor_total_itens_ferragem: Math.round(v.valor * 100) / 100,
      }))
      .sort((a, b) => b.metros_total - a.metros_total);

    return NextResponse.json({
      inicio,
      fim,
      total_pedidos: orcIds.length,
      agregados,
    });
  } catch (e) {
    console.error('[metros-ferro] erro interno', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
