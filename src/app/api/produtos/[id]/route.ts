import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/produtos/[id] - Product details + last 20 movements
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: 'Produto nao encontrado' }, { status: 404 });
    }

    const { data: movimentacoes } = await supabaseAdmin
      .from('movimentacoes_estoque')
      .select('*')
      .eq('produto_id', params.id)
      .order('criado_em', { ascending: false })
      .limit(20);

    return NextResponse.json({
      ...produto,
      movimentacoes: movimentacoes || [],
    });
  } catch (e) {
    console.error('Erro em GET /api/produtos/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT /api/produtos/[id] - Edit product (partial update — campos
// `!== undefined` no body sao aplicados; outros nao sao tocados).
//
// Audit log: quando body.preco_custo muda o valor atual, insere uma
// linha em historico_custos com {custo_anterior, custo_novo, usuario_id}.
// usuario_id vem do body (pattern do codebase — frontend envia user.id).
// TODO: validar usuario_id via session server-side quando equipe crescer
// (hoje qualquer cliente pode forjar; risco baixo enquanto so admin/gerente
// acessam a aba Estoque e a equipe e pequena).
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const body = await request.json();

    const updateData: Record<string, unknown> = {
      atualizado_em: new Date().toISOString(),
    };

    // Only allow these fields to be updated (partial — undefined skipa)
    if (body.nome !== undefined) updateData.nome = body.nome;
    if (body.codigo !== undefined) updateData.codigo = body.codigo;
    if (body.categoria !== undefined) updateData.categoria = body.categoria;
    if (body.unidade_venda !== undefined) updateData.unidade_venda = body.unidade_venda;
    if (body.preco_venda !== undefined) updateData.preco_venda = body.preco_venda;
    if (body.preco_custo !== undefined) updateData.preco_custo = body.preco_custo;
    if (body.estoque_minimo !== undefined) updateData.estoque_minimo = body.estoque_minimo;
    if (body.fator_conversao !== undefined) updateData.fator_conversao = body.fator_conversao;
    if (body.ativo !== undefined) updateData.ativo = body.ativo;

    // Pre-fetch do preco_custo atual quando o caller pede pra mudar.
    // Pulamos a leitura quando body.preco_custo nao veio — economiza
    // 1 round-trip nos PUTs que so editam outros campos.
    let custoAnterior: number | null = null;
    if (body.preco_custo !== undefined) {
      const { data: atual } = await supabaseAdmin
        .from('produtos')
        .select('preco_custo')
        .eq('id', params.id)
        .single();
      custoAnterior = atual ? Number(atual.preco_custo) : null;
    }

    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar produto:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Audit log de preco_custo (Batch B Fase 3). So insere se houve
    // mudanca real (numero novo, diferente do anterior). Falha de
    // insert nao reverte o UPDATE — so loga (caller ja recebeu OK).
    if (body.preco_custo !== undefined) {
      const custoNovo = Number(body.preco_custo);
      if (
        Number.isFinite(custoNovo) &&
        custoAnterior !== null &&
        Number.isFinite(custoAnterior) &&
        custoNovo !== custoAnterior
      ) {
        const { error: histErr } = await supabaseAdmin
          .from('historico_custos')
          .insert({
            produto_id: params.id,
            usuario_id: body.usuario_id ?? null,
            custo_anterior: custoAnterior,
            custo_novo: custoNovo,
          });
        if (histErr) {
          console.error('[historico_custos] insert falhou (produto ja atualizado):', histErr);
        }
      }
    }

    return NextResponse.json(produto);
  } catch (e) {
    console.error('Erro em PUT /api/produtos/[id]:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
