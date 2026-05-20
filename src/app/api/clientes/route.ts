import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isObraAtivaActive } from '@/lib/tags';

// GET /api/clientes
// Dois modos:
//  - Legado (params busca/telefone/pagina/limite): retorna linhas de cliente
//    cruas, paginadas no banco. Mantido para os callers existentes.
//  - Lista (params search/page/limit): retorna clientes enriquecidos com
//    qtd_compras, ultima_compra e tags, ordenados por ultima_compra DESC
//    (NULLS LAST). Usado pela aba Clientes.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modoLista =
      searchParams.has('search') || searchParams.has('page') || searchParams.has('limit');

    // ---- Modo legado ----
    if (!modoLista) {
      const busca = searchParams.get('busca');
      const telefone = searchParams.get('telefone');
      const pagina = parseInt(searchParams.get('pagina') || '1');
      const limite = parseInt(searchParams.get('limite') || '20');
      const offset = (pagina - 1) * limite;

      let query = supabaseAdmin
        .from('clientes')
        .select('*', { count: 'exact' })
        .order('atualizado_em', { ascending: false })
        .range(offset, offset + limite - 1);

      if (telefone) {
        query = query.ilike('telefone', `%${telefone.replace(/\D/g, '')}%`);
      } else if (busca) {
        query = query.or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%`);
      }

      const { data, error, count } = await query;
      if (error) {
        return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
      }
      return NextResponse.json({ clientes: data || [], total: count || 0, pagina, limite });
    }

    // ---- Modo lista (aba Clientes) ----
    const search = (searchParams.get('search') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '50'));

    // 1) Clientes que batem com a busca (linhas completas)
    let q = supabaseAdmin.from('clientes').select('*').limit(100000);
    if (search) {
      const digits = search.replace(/\D/g, '');
      const ors = [`nome.ilike.%${search}%`];
      if (digits) ors.push(`telefone.ilike.%${digits}%`);
      q = q.or(ors.join(','));
    }
    const { data: clientesRaw, error: clientesErr } = await q;
    if (clientesErr) {
      return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
    }
    const clientes = clientesRaw || [];

    // 2) Agregados de compras e tags em duas queries paralelas
    const [comprasRes, tagsRes] = await Promise.all([
      supabaseAdmin
        .from('orcamentos')
        .select('cliente_id, criado_em, data_entrega')
        .not('status', 'in', '(orcamento,cancelado)')
        .limit(100000),
      supabaseAdmin
        .from('cliente_tags')
        .select('cliente_id, tag, data_aplicacao')
        .order('data_aplicacao', { ascending: false })
        .limit(100000),
    ]);

    const compraStats = new Map<string, { qtd: number; ultima: string | null }>();
    for (const o of comprasRes.data || []) {
      const cid = o.cliente_id as string | null;
      if (!cid) continue;
      const data = (o.data_entrega as string | null) || (o.criado_em as string);
      const cur = compraStats.get(cid) || { qtd: 0, ultima: null };
      cur.qtd += 1;
      if (data && (!cur.ultima || new Date(data).getTime() > new Date(cur.ultima).getTime())) {
        cur.ultima = data;
      }
      compraStats.set(cid, cur);
    }

    const tagsPorCliente = new Map<string, string[]>();
    for (const t of tagsRes.data || []) {
      const cid = t.cliente_id as string | null;
      if (!cid) continue;
      const arr = tagsPorCliente.get(cid) || [];
      arr.push(t.tag as string);
      tagsPorCliente.set(cid, arr);
    }

    // 3) Enriquece cada cliente (obra_ativa some se a ultima compra > 30 dias)
    const enriquecidos = clientes.map(c => {
      const stats = compraStats.get(c.id as string) || { qtd: 0, ultima: null };
      let tags = tagsPorCliente.get(c.id as string) || [];
      if (!isObraAtivaActive(stats.ultima)) {
        tags = tags.filter(t => t !== 'obra_ativa');
      }
      return { ...c, qtd_compras: stats.qtd, ultima_compra: stats.ultima, tags };
    });

    // 4) Ordena por ultima_compra DESC, NULLS LAST
    enriquecidos.sort((a, b) => {
      if (!a.ultima_compra && !b.ultima_compra) return 0;
      if (!a.ultima_compra) return 1;
      if (!b.ultima_compra) return -1;
      return new Date(b.ultima_compra).getTime() - new Date(a.ultima_compra).getTime();
    });

    // 5) Pagina em memória
    const total = enriquecidos.length;
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const inicio = (page - 1) * limit;

    return NextResponse.json({
      clientes: enriquecidos.slice(inicio, inicio + limit),
      total,
      page,
      total_pages,
      pagina: page,
      limite: limit,
    });
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nome, telefone, cep, endereco, bairro, cidade, estado } = body;

    if (!nome || !telefone) {
      return NextResponse.json(
        { error: 'Nome e telefone sao obrigatorios' },
        { status: 400 }
      );
    }

    const telefoneLimpo = telefone.replace(/\D/g, '');

    const { data, error } = await supabaseAdmin
      .from('clientes')
      .upsert(
        {
          nome,
          telefone: telefoneLimpo,
          cep,
          endereco,
          bairro,
          cidade,
          estado,
          atualizado_em: new Date().toISOString()
        },
        { onConflict: 'telefone' }
      )
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Erro ao salvar cliente' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
