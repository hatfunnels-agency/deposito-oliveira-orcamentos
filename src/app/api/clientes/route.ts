import { NextRequest, NextResponse } from 'next/server';
import { lerTudo } from '@/lib/ler-tudo';
import { supabaseAdmin } from '@/lib/supabase';
import { isObraAtivaActive } from '@/lib/tags';
import { buscaTelefoneExtras } from '@/lib/telefones';

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
        const dTel = telefone.replace(/\D/g, '');
        const extras = buscaTelefoneExtras(dTel);
        query = extras
          ? query.or(`telefone.ilike.%${dTel}%,${extras}`)
          : query.ilike('telefone', `%${dTel}%`);
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
    // Feature 2: filtros opcionais. tags = CSV (modo OR — cliente match
    // se tem qualquer uma das tags ativas). minValor/maxValor em reais.
    const tagsFiltro = (searchParams.get('tags') || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const minValorRaw = searchParams.get('minValor');
    const maxValorRaw = searchParams.get('maxValor');
    const minValor = minValorRaw !== null && minValorRaw !== '' ? Number(minValorRaw) : null;
    const maxValor = maxValorRaw !== null && maxValorRaw !== '' ? Number(maxValorRaw) : null;

    // 1) Clientes que batem com a busca (linhas completas). lerTudo: com
    //    .limit(100000) o Supabase devolvia so 1.000 dos 1.155+ clientes — o
    //    resto sumia da lista e da busca sem erro nenhum.
    const montarClientes = () => {
      let q = supabaseAdmin.from('clientes').select('*');
      if (search) {
        const digits = search.replace(/\D/g, '');
        const ors = [`nome.ilike.%${search}%`];
        if (digits) ors.push(`telefone.ilike.%${digits}%`);
        const extras = buscaTelefoneExtras(digits);
        if (extras) ors.push(extras);
        q = q.or(ors.join(','));
      }
      return q;
    };
    let clientes: any[];
    try {
      clientes = await lerTudo(montarClientes);
    } catch {
      return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
    }

    // 2) Agregados de compras (qtd, ultima e total gasto) + tags em duas
    //    queries paralelas. qtd_compras e total_gasto contam a MESMA coisa:
    //    toda venda (tudo exceto orcamento/cancelado). Antes o total so
    //    somava 'completo' — a Tay aparecia com R$ 99.890 em vez de R$ 106
    //    mil (entregas pendentes fora) e o ticket medio saia torto.
    // lerTudo nas duas: 2.791 vendas e ~900 tags no banco em 06/10 — com o
    // corte de 1.000, total gasto, qtd de compras e ultima compra saiam errados.
    const [comprasData, tagsData] = await Promise.all([
      lerTudo(() => supabaseAdmin
        .from('orcamentos')
        .select('cliente_id, criado_em, data_entrega, status, total')
        .not('status', 'in', '(orcamento,cancelado)')),
      lerTudo(() => supabaseAdmin
        .from('cliente_tags')
        .select('cliente_id, tag, data_aplicacao')
        .order('data_aplicacao', { ascending: false })),
    ]);
    const comprasRes = { data: comprasData };
    const tagsRes = { data: tagsData };

    const compraStats = new Map<string, { qtd: number; ultima: string | null; totalGasto: number }>();
    for (const o of comprasRes.data || []) {
      const cid = o.cliente_id as string | null;
      if (!cid) continue;
      const data = (o.data_entrega as string | null) || (o.criado_em as string);
      const cur = compraStats.get(cid) || { qtd: 0, ultima: null, totalGasto: 0 };
      cur.qtd += 1;
      if (data && (!cur.ultima || new Date(data).getTime() > new Date(cur.ultima).getTime())) {
        cur.ultima = data;
      }
      cur.totalGasto += Number(o.total) || 0;
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
      const stats = compraStats.get(c.id as string) || { qtd: 0, ultima: null, totalGasto: 0 };
      let tags = tagsPorCliente.get(c.id as string) || [];
      if (!isObraAtivaActive(stats.ultima)) {
        tags = tags.filter(t => t !== 'obra_ativa');
      }
      return {
        ...c,
        qtd_compras: stats.qtd,
        ultima_compra: stats.ultima,
        total_gasto: Math.round(stats.totalGasto * 100) / 100,
        tags,
      };
    });

    // 4) Filtros (depois do enrich pra ter tags resolvidas + total_gasto)
    const filtrados = enriquecidos.filter(c => {
      if (tagsFiltro.length > 0) {
        const matchTag = (c.tags as string[]).some((t: string) => tagsFiltro.includes(t));
        if (!matchTag) return false;
      }
      if (minValor !== null && !Number.isNaN(minValor) && c.total_gasto < minValor) return false;
      if (maxValor !== null && !Number.isNaN(maxValor) && c.total_gasto > maxValor) return false;
      return true;
    });

    // 5) Ordena. Padrao: ultima_compra DESC, NULLS LAST.
    const ordem = searchParams.get('ordem') || 'ultima_compra';
    const porUltima = (a: any, b: any) => {
      if (!a.ultima_compra && !b.ultima_compra) return 0;
      if (!a.ultima_compra) return 1;
      if (!b.ultima_compra) return -1;
      return new Date(b.ultima_compra).getTime() - new Date(a.ultima_compra).getTime();
    };
    filtrados.sort((a, b) => {
      if (ordem === 'nome') return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      if (ordem === 'total') return b.total_gasto - a.total_gasto || porUltima(a, b);
      if (ordem === 'pedidos') return b.qtd_compras - a.qtd_compras || porUltima(a, b);
      if (ordem === 'ticket') {
        const ta = a.qtd_compras ? a.total_gasto / a.qtd_compras : 0;
        const tb = b.qtd_compras ? b.total_gasto / b.qtd_compras : 0;
        return tb - ta || porUltima(a, b);
      }
      return porUltima(a, b);
    });

    // 6) Pagina em memória
    const total = filtrados.length;
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const inicio = (page - 1) * limit;

    // Bairro/cidade da tabela: o endereco mora em enderecos_clientes (os
    // campos clientes.bairro/cidade sao legado e quase sempre vazios). So
    // pros clientes da pagina.
    const pagina = filtrados.slice(inicio, inicio + limit);
    const idsPagina = pagina.map(c => c.id as string);
    const locais = new Map<string, { bairro: string | null; cidade: string | null; padrao: boolean }>();
    if (idsPagina.length) {
      const { data: ends } = await supabaseAdmin
        .from('enderecos_clientes')
        .select('cliente_id, bairro, cidade, is_padrao, criado_em')
        .in('cliente_id', idsPagina)
        .order('criado_em', { ascending: false });
      for (const e of ends || []) {
        const atual = locais.get(e.cliente_id);
        if (!atual || (e.is_padrao && !atual.padrao)) {
          locais.set(e.cliente_id, { bairro: e.bairro, cidade: e.cidade, padrao: !!e.is_padrao });
        }
      }
    }
    const comLocal = pagina.map(c => {
      const l = locais.get(c.id as string);
      return {
        ...c,
        bairro_exibicao: l?.bairro || (c.bairro as string | null) || null,
        cidade_exibicao: l?.cidade || (c.cidade as string | null) || null,
      };
    });

    return NextResponse.json({
      clientes: comLocal,
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
