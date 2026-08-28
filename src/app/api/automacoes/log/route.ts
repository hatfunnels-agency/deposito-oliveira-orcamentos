import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/automacoes/log
// Lista automacao_envios pra conferencia (modo simulacao e depois envio real).
// Auth: header x-admin-key === ADMIN_API_KEY (mesmo padrao das rotas de admin).
//
// Filtros (query string, todos opcionais):
//   ?tipo=followup|posvenda|reativacao|contexto
//   ?status=simulado|enviado|erro|pulado|concluido
//   ?de=2026-08-01   ?ate=2026-08-27   (periodo sobre criado_em, inclusivo)
//   ?pagina=1        ?porPagina=50     (max 200)
//
// Resposta: { total, pagina, porPagina, totais: { porStatus, porTipo }, envios }
// Os totais respeitam os filtros de periodo/tipo/status, ignorando a paginacao.

const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAX = 200;

export async function GET(request: NextRequest) {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return NextResponse.json(
        { error: 'ADMIN_API_KEY nao configurada no servidor' },
        { status: 500 },
      );
    }
    if (request.headers.get('x-admin-key') !== adminKey) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    const url = new URL(request.url);
    const tipo = url.searchParams.get('tipo') || '';
    const status = url.searchParams.get('status') || '';
    const de = url.searchParams.get('de') || '';
    const ate = url.searchParams.get('ate') || '';
    const pagina = Math.max(1, Number(url.searchParams.get('pagina') || 1) || 1);
    const porPagina = Math.min(
      POR_PAGINA_MAX,
      Math.max(1, Number(url.searchParams.get('porPagina') || POR_PAGINA_PADRAO) || POR_PAGINA_PADRAO),
    );

    // Data solta (YYYY-MM-DD) vira inicio/fim do dia pra ficar inclusiva.
    const deIso = de ? (de.length === 10 ? `${de}T00:00:00` : de) : '';
    const ateIso = ate ? (ate.length === 10 ? `${ate}T23:59:59.999` : ate) : '';

    const aplicarFiltros = <T,>(q: T): T => {
      let query: any = q;
      if (tipo) query = query.eq('tipo', tipo);
      if (status) query = query.eq('status', status);
      if (deIso) query = query.gte('criado_em', deIso);
      if (ateIso) query = query.lte('criado_em', ateIso);
      return query;
    };

    // Pagina de resultados + contagem exata com os mesmos filtros.
    const offset = (pagina - 1) * porPagina;
    const { data, count, error } = await aplicarFiltros(
      supabaseAdmin
        .from('automacao_envios')
        .select('id, criado_em, tipo, momento, cliente_id, telefone, ghl_contact_id, template_nome, mensagem, status, motivo, clientes (nome)', { count: 'exact' }),
    )
      .order('criado_em', { ascending: false })
      .range(offset, offset + porPagina - 1);

    if (error) {
      // Tabela ainda nao criada e o caso mais comum (o SQL roda manualmente).
      return NextResponse.json(
        { error: `Erro ao ler automacao_envios: ${error.message}` },
        { status: 500 },
      );
    }

    // Totais por status e por tipo dentro do mesmo filtro (sem paginacao).
    // Busca so as duas colunas, com teto alto o bastante pro volume atual.
    const { data: linhas } = await aplicarFiltros(
      supabaseAdmin.from('automacao_envios').select('status, tipo'),
    ).limit(10000);

    const porStatus: Record<string, number> = {};
    const porTipo: Record<string, number> = {};
    for (const l of (linhas || []) as Array<{ status: string; tipo: string }>) {
      porStatus[l.status] = (porStatus[l.status] || 0) + 1;
      porTipo[l.tipo] = (porTipo[l.tipo] || 0) + 1;
    }

    const envios = (data || []).map((r: any) => ({
      id: r.id,
      criado_em: r.criado_em,
      tipo: r.tipo,
      momento: r.momento,
      cliente_id: r.cliente_id,
      cliente_nome: r.clientes?.nome || null,
      telefone: r.telefone,
      // 'via' e derivada: template_nome preenchido = template aprovado da Meta;
      // vazio com envio/simulacao = copy escrita pela IA (janela de 24h aberta).
      via: r.template_nome ? 'template' : ['simulado', 'enviado'].includes(r.status) ? 'ia' : '—',
      template_nome: r.template_nome,
      mensagem: r.mensagem,
      status: r.status,
      motivo: r.motivo,
    }));

    return NextResponse.json({
      total: count ?? envios.length,
      pagina,
      porPagina,
      totais: { porStatus, porTipo },
      envios,
    });
  } catch (e: any) {
    console.error('[Automacoes Log] erro:', e);
    return NextResponse.json({ error: e?.message || 'Erro interno' }, { status: 500 });
  }
}
