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

        // Tarefa 5: mapa de produtos para resolver estoque compartilhado
        const produtoMap = new Map<string, Record<string, unknown>>();
        for (const p of (produtos || [])) {
                produtoMap.set(p.id as string, p as Record<string, unknown>);
        }

    
    const produtosFormatados = (produtos || []).map((p: Record<string, unknown>) => {
      const fatorConversao = Number(p.fator_conversao) || 1;
      let   estoqueAtual = Number(p.estoque_atual) || 0;
      let   estoqueMinimo = Number(p.estoque_minimo) || 0;

            // Tarefa 5: se produto secundario, usar estoque do principal
            if (p.estoque_compartilhado_com) {
                      const principal = produtoMap.get(p.estoque_compartilhado_com as string);
                      if (principal) {
                                  estoqueAtual = Number(principal.estoque_atual) || 0;
                                  estoqueMinimo = Number(principal.estoque_minimo) || 0;
                      }
            }

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
        estoque_compartilhado_com: p.estoque_compartilhado_com || null,
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


// TEMP SEED - DELETE AFTER USE
export async function PUT() {
  try {
    const madeira = [
      { nome: 'Viga Cambará 5x11', codigo: 'MAD-VIGA-5X11', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 28.00, preco_custo: 18.20, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Viga Cambará 5x15', codigo: 'MAD-VIGA-5X15', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 40.00, preco_custo: 27.00, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Caibro Cambará 5x5', codigo: 'MAD-CAIBRO', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 14.00, preco_custo: 9.10, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Caibrão Cambará 5x7', codigo: 'MAD-CAIBRAO', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 21.00, preco_custo: 13.50, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Prancha Cambará 5x20', codigo: 'MAD-PRANCHA-20', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 58.00, preco_custo: 38.60, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Prancha Cambará 5x25', codigo: 'MAD-PRANCHA-25', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 72.00, preco_custo: 48.20, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Prancha Cambará 5x30', codigo: 'MAD-PRANCHA-30', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 87.00, preco_custo: 57.87, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Ripão Cambará 2,3x5', codigo: 'MAD-RIPAO', categoria: 'Madeira Cambará', unidade: 'metro', unidade_venda: 'metro', preco_venda: 7.50, preco_custo: 4.50, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.005, ativo: true },
      { nome: 'Tábua Pinus 30cm', codigo: 'MAD-TABUA-30', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 45.00, preco_custo: 28.90, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Tábua Pinus 25cm', codigo: 'MAD-TABUA-25', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 34.00, preco_custo: 22.00, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Tábua Pinus 20cm', codigo: 'MAD-TABUA-20', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 24.00, preco_custo: 15.00, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Sarrafo Pinus 15cm', codigo: 'MAD-SARRAFO-15', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 18.00, preco_custo: 11.30, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Sarrafo Pinus 10cm', codigo: 'MAD-SARRAFO-10', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 12.00, preco_custo: 7.50, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Sarrafo Pinus 5cm', codigo: 'MAD-SARRAFO-05', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 6.50, preco_custo: 3.80, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Pontalete Pinus 5x5', codigo: 'MAD-PONTALETE-5', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 16.00, preco_custo: 10.40, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Pontalete Pinus 6x6', codigo: 'MAD-PONTALETE-6', categoria: 'Madeira Pinus', unidade: 'peça', unidade_venda: 'peça', preco_venda: 24.00, preco_custo: 15.00, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.01, ativo: true },
      { nome: 'Madeirit Pinus 10mm', codigo: 'MAD-MADEIRIT', categoria: 'Madeira Pinus', unidade: 'unidade', unidade_venda: 'unidade', preco_venda: 78.00, preco_custo: 51.70, estoque_atual: 999, estoque_minimo: 0, fator_conversao: 1.0, volume_unitario: 0.02, ativo: true },
    ];
    const { data, error } = await supabaseAdmin.from('produtos').insert(madeira).select('id, nome');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ inserted: data?.length, nomes: data?.map((p: Record<string,unknown>) => p.nome) });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
