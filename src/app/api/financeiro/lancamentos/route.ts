import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  aprenderComCorrecao,
  carregarContexto,
  classificarPorRegras,
  type LancamentoParaCategorizar,
} from '@/lib/categorizacao';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/financeiro/lancamentos  { acao: 'recategorizar', mes?: '2026-07' }
 *
 * Reaplica as regras no que ja foi importado. Necessario porque regra nova
 * nasce depois: uma correcao vira regra, e todos os lancamentos parecidos
 * do historico deveriam se beneficiar dela sem reimportar arquivo.
 *
 * NUNCA mexe em lancamento revisado a mao — a decisao do humano ganha da
 * regra, sempre.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.acao !== 'recategorizar') {
      return NextResponse.json({ error: 'Acao desconhecida' }, { status: 400 });
    }

    // `neq('categoria_origem','manual')` sozinho EXCLUI as linhas com NULL —
    // em SQL, NULL <> 'manual' e NULL, nao verdadeiro. Justamente os
    // lancamentos sem categoria (os que mais precisam de recategorizacao)
    // ficariam de fora.
    let q = supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id, descricao, contraparte, documento, valor, categoria_id, categoria_origem')
      .or('categoria_origem.is.null,categoria_origem.neq.manual')
      .limit(5000);

    if (/^\d{4}-\d{2}$/.test(body.mes || '')) {
      const [ano, m] = String(body.mes).split('-').map(Number);
      q = q.gte('data', `${body.mes}-01`).lte('data', new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10));
    }

    const { data: alvos, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { categoriasPorId, regras } = await carregarContexto();
    let alterados = 0;

    for (const l of (alvos || [])) {
      const alvo: LancamentoParaCategorizar = {
        descricao: String(l.descricao || ''),
        contraparte: (l.contraparte as string | null) ?? null,
        documento: (l.documento as string | null) ?? null,
        valor: Number(l.valor) || 0,
      };
      const c = classificarPorRegras(alvo, regras, categoriasPorId);
      if (!c.categoria_id || c.categoria_id === l.categoria_id) continue;

      const { error: errUp } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .update({
          categoria_id: c.categoria_id,
          categoria_origem: c.origem,
          categoria_confianca: c.confianca,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', l.id);
      if (!errUp) alterados++;
    }

    return NextResponse.json({ avaliados: (alvos || []).length, alterados });
  } catch (e) {
    console.error('Erro em POST /api/financeiro/lancamentos:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * GET /api/financeiro/lancamentos
 *   ?mes=2026-07        periodo (default: mes corrente)
 *   &filtro=revisar     revisar | todos | sem_categoria
 *   &conta_id=uuid
 *
 * "revisar" e a fila de trabalho: o que a IA chutou ou o que ninguem
 * classificou. O que veio de regra com confianca alta nao gasta a atencao
 * do Roger.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const mes = /^\d{4}-\d{2}$/.test(sp.get('mes') || '') ? sp.get('mes')! : new Date().toISOString().slice(0, 7);
    const filtro = sp.get('filtro') || 'revisar';
    const contaId = sp.get('conta_id');

    const inicio = `${mes}-01`;
    const [ano, m] = mes.split('-').map(Number);
    const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);

    let q = supabaseAdmin
      .from('lancamentos_bancarios')
      .select(`
        id, data, descricao, contraparte, documento, valor, tarifa,
        categoria_id, categoria_origem, categoria_confianca, revisado, observacoes,
        conta_id,
        categorias_financeiras ( id, nome, grupo, entra_no_dre ),
        contas_financeiras ( nome )
      `)
      .gte('data', inicio)
      .lte('data', fim)
      .order('data', { ascending: false })
      .limit(1500);

    if (contaId) q = q.eq('conta_id', contaId);
    if (filtro === 'revisar') q = q.eq('revisado', false).or('categoria_id.is.null,categoria_origem.eq.ia');
    else if (filtro === 'sem_categoria') q = q.is('categoria_id', null);

    const { data, error } = await q;
    if (error) {
      console.error('Erro ao buscar lancamentos:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: categorias } = await supabaseAdmin
      .from('categorias_financeiras')
      .select('id, nome, grupo, entra_no_dre')
      .order('ordem');

    // Contadores do mes inteiro, independentes do filtro da tela.
    const { count: totalMes } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id', { count: 'exact', head: true })
      .gte('data', inicio).lte('data', fim);
    const { count: aRevisar } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id', { count: 'exact', head: true })
      .gte('data', inicio).lte('data', fim)
      .eq('revisado', false)
      .or('categoria_id.is.null,categoria_origem.eq.ia');

    return NextResponse.json({
      lancamentos: data || [],
      categorias: categorias || [],
      mes,
      total_mes: totalMes ?? 0,
      a_revisar: aRevisar ?? 0,
    });
  } catch (e) {
    console.error('Erro em GET /api/financeiro/lancamentos:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * PATCH /api/financeiro/lancamentos
 *   { id | ids[], categoria_id?, revisado?, observacoes?, aprender? }
 *
 * Com aprender=true (default numa correcao de categoria), a correcao vira
 * regra: o mesmo fornecedor nunca mais precisa ser classificado a mao.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Informe id ou ids' }, { status: 400 });
    }

    const update: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (body.categoria_id !== undefined) {
      update.categoria_id = body.categoria_id || null;
      update.categoria_origem = 'manual';
      update.categoria_confianca = 1;
      update.revisado = true;
    }
    if (body.revisado !== undefined) update.revisado = !!body.revisado;
    if (body.observacoes !== undefined) update.observacoes = body.observacoes || null;

    // Aprender antes de gravar: precisa da contraparte/documento atual.
    let regrasCriadas = 0;
    if (body.categoria_id && body.aprender !== false) {
      const { data: alvos } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .select('documento, contraparte')
        .in('id', ids);
      const vistos = new Set<string>();
      for (const l of (alvos || [])) {
        const chave = `${l.documento || ''}|${l.contraparte || ''}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        try {
          await aprenderComCorrecao(
            { documento: l.documento as string | null, contraparte: l.contraparte as string | null },
            body.categoria_id
          );
          regrasCriadas++;
        } catch (e) {
          // Regra e otimizacao, nao requisito. Nao derruba a correcao.
          console.error('[lancamentos] falha ao aprender regra:', e);
        }
      }
    }

    const { error, count } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .update(update, { count: 'exact' })
      .in('id', ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ atualizados: count ?? ids.length, regras_criadas: regrasCriadas });
  } catch (e) {
    console.error('Erro em PATCH /api/financeiro/lancamentos:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
