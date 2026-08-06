import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recalcularVolumeLeva } from '@/lib/levas';

export const dynamic = 'force-dynamic';

// orcamento_itens.produto_id NAO tem FK pra produtos, entao o PostgREST
// recusa embed do tipo `produto:produto_id ( volume_unitario )` com PGRST200.
// Era esse embed que derrubava o GET /api/levas e deixava a tela de levas
// sem dados. Aqui o volume e resolvido com uma segunda consulta e um Map.
const montarMapaVolume = async (produtoIds: string[]) => {
  const ids = Array.from(new Set(produtoIds.filter(Boolean)));
  const mapa = new Map<string, number>();
  if (ids.length === 0) return mapa;
  const { data } = await supabaseAdmin
    .from('produtos')
    .select('id, volume_unitario')
    .in('id', ids);
  for (const p of (data || [])) {
    mapa.set(String(p.id), Number(p.volume_unitario) || 0);
  }
  return mapa;
};

// GET /api/levas?data=2026-03-24 - listar levas por data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const data = searchParams.get('data');

    let query = supabaseAdmin
      .from('levas_entrega')
      .select(`
        id, data, numero_leva, volume_total, status, criado_em,
        motorista_id,
        motoristas ( id, nome, veiculo )
      `)
      .order('data', { ascending: false })
      .order('numero_leva', { ascending: true });

    if (data) {
      query = query.eq('data', data);
    }

    const { data: levas, error } = await query;

    if (error) {
      console.error('Erro ao buscar levas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!levas || levas.length === 0) {
      return NextResponse.json({ levas: [] });
    }

    // Uma consulta so pra todos os orcamentos de todas as levas da pagina.
    const levaIds = levas.map(l => String(l.id));
    const { data: orcamentos, error: errOrc } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, total, status, data_entrega, leva_id, motorista_id,
        clientes ( nome, endereco, numero, bairro, cidade ),
        orcamento_itens ( quantidade, unidade, produto_id, produto_nome )
      `)
      .in('leva_id', levaIds);

    if (errOrc) {
      console.error('Erro ao buscar orcamentos das levas:', errOrc);
      return NextResponse.json({ error: errOrc.message }, { status: 500 });
    }

    const todosProdutoIds = (orcamentos || []).flatMap(o =>
      ((o.orcamento_itens as Array<{ produto_id: string | null }> | null) || [])
        .map(i => String(i.produto_id || ''))
    );
    const mapaVolume = await montarMapaVolume(todosProdutoIds);

    const calcVolume = (o: Record<string, unknown>) => {
      const itens = (o.orcamento_itens as Array<{ quantidade: number; produto_id: string | null }> | null) || [];
      return itens.reduce(
        (acc, i) => acc + (mapaVolume.get(String(i.produto_id || '')) || 0) * (Number(i.quantidade) || 0),
        0
      );
    };

    const levasComEntregas = levas.map(leva => {
      const doLeva = (orcamentos || []).filter(o => String(o.leva_id) === String(leva.id));
      const volume = doLeva.reduce((acc, o) => acc + calcVolume(o as Record<string, unknown>), 0);
      return {
        ...leva,
        orcamentos: doLeva.map(o => ({ ...o, volume_m3: Math.round(calcVolume(o as Record<string, unknown>) * 100) / 100 })),
        volume_calculado: Math.round(volume * 100) / 100,
      };
    });

    return NextResponse.json({ levas: levasComEntregas });
  } catch (e) {
    console.error('Erro em GET /api/levas:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST /api/levas - criar nova leva
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data, motorista_id, numero_leva, orcamento_ids } = body;

    if (!data) {
      return NextResponse.json({ error: 'data e obrigatoria' }, { status: 400 });
    }

    // Determinar numero da leva automaticamente se nao fornecido
    let levaNumero = numero_leva;
    if (!levaNumero) {
      const { data: existentes } = await supabaseAdmin
        .from('levas_entrega')
        .select('numero_leva')
        .eq('data', data)
        .order('numero_leva', { ascending: false })
        .limit(1);

      levaNumero = existentes && existentes.length > 0
        ? (existentes[0].numero_leva + 1)
        : 1;
    }

    const { data: leva, error } = await supabaseAdmin
      .from('levas_entrega')
      .insert({
        data,
        motorista_id: motorista_id || null,
        numero_leva: levaNumero,
        volume_total: 0,
        status: 'pendente',
      })
      .select(`
        id, data, numero_leva, volume_total, status, criado_em,
        motorista_id,
        motoristas ( id, nome, veiculo )
      `)
      .single();

    if (error) {
      console.error('Erro ao criar leva:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Criar a leva ja com as entregas selecionadas evita o segundo round-trip
    // da UI e garante que motorista_id caia no orcamento junto — sem isso o
    // relatorio por motorista continua vazio mesmo com a leva montada.
    if (Array.isArray(orcamento_ids) && orcamento_ids.length > 0) {
      const { error: errVinculo } = await supabaseAdmin
        .from('orcamentos')
        .update({ leva_id: leva.id, motorista_id: motorista_id || null })
        .in('id', orcamento_ids);
      if (errVinculo) {
        console.error('Erro ao vincular entregas na criacao da leva:', errVinculo);
        return NextResponse.json({ error: errVinculo.message }, { status: 400 });
      }
      // Sem isto a coluna volume_total fica em 0 mesmo com a leva cheia, e
      // qualquer relatorio que leia a coluna (em vez do calculo em memoria
      // do GET) enxerga zero.
      const volume = await recalcularVolumeLeva(String(leva.id));
      return NextResponse.json({ ...leva, volume_total: volume }, { status: 201 });
    }

    return NextResponse.json(leva, { status: 201 });
  } catch (e) {
    console.error('Erro em POST /api/levas:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
