import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data: produtos, error } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('ativo', true)
      .order('categoria')
      .order('nome');

    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar produtos', produtos: [], source: 'error' },
        { status: 500 }
      );
    }

    const produtosFormatados = (produtos || []).map((p: Record<string, unknown>) => {
      const fatorConversao = Number(p.fator_conversao) || 1;
      const estoqueAtual = Number(p.estoque_atual) || 0;
      const estoqueMinimo = Number(p.estoque_minimo) || 0;

      const estoqueVenda = fatorConversao !== 1.0
        ? estoqueAtual / fatorConversao
        : estoqueAtual;
      const estoqueMinVenda = fatorConversao !== 1.0
        ? estoqueMinimo / fatorConversao
        : estoqueMinimo;

      return {
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        categoria: p.categoria,
        preco: Number(p.preco_venda),
        preco_custo: Number(p.preco_custo),
        estoque: Math.round(estoqueVenda * 100) / 100,
        unidade: p.unidade_venda,
        estoque_minimo: Math.round(estoqueMinVenda * 100) / 100,
        abaixo_minimo: estoqueVenda <= estoqueMinVenda,
        fator_conversao: fatorConversao,
        unidade_armazenamento: p.unidade,
        estoque_armazenamento: estoqueAtual,
      };
    });

    return NextResponse.json({
      source: 'SUPABASE',
      produtos: produtosFormatados,
      mensagem: `${produtosFormatados.length} produtos carregados`,
    });
  } catch (e) {
    console.error('Erro geral em /api/produtos:', e);
    return NextResponse.json(
      { error: 'Erro interno', produtos: [], source: 'error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { data: produto, error } = await supabaseAdmin
      .from('produtos')
      .insert({
        nome: body.nome,
        codigo: body.codigo || null,
        categoria: body.categoria || 'Geral',
        unidade: body.unidade || 'unidade',
        unidade_venda: body.unidade_venda || body.unidade || 'unidade',
        preco_venda: body.preco_venda,
        preco_custo: body.preco_custo || 0,
        estoque_atual: body.estoque_inicial || 0,
        estoque_minimo: body.estoque_minimo || 0,
        fator_conversao: body.fator_conversao || 1.0,
        ativo: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar produto:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // If there's initial stock, create an entry movement
    if (body.estoque_inicial && body.estoque_inicial > 0) {
      await supabaseAdmin.from('movimentacoes_estoque').insert({
        produto_id: produto.id,
        tipo: 'entrada',
        quantidade: body.estoque_inicial,
        estoque_anterior: 0,
        estoque_novo: body.estoque_inicial,
        observacoes: 'Estoque inicial ao cadastrar produto',
      });
    }

    return NextResponse.json(produto, { status: 201 });
  } catch (e) {
    console.error('Erro ao criar produto:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

