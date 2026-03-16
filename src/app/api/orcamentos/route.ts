import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, gerarCodigoOrcamento } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      cliente_nome,
      cliente_telefone,
      cliente_cep,
      cliente_endereco,
      tipo_entrega,
      valor_frete = 0,
      subtotal,
      total,
      observacoes,
      itens,
    } = body;

    if (!cliente_nome || !cliente_telefone || !subtotal || !itens || itens.length === 0) {
      return NextResponse.json(
        { error: 'Dados obrigatorios: nome, telefone, subtotal e itens' },
        { status: 400 }
      );
    }

    // Upsert cliente (identificado pelo telefone)
    const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
    
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from('clientes')
      .upsert(
        {
          nome: cliente_nome,
          telefone: telefoneLimpo,
          cep: cliente_cep || null,
          endereco: cliente_endereco || null,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'telefone', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (clienteError) {
      console.error('Erro ao criar/atualizar cliente:', clienteError);
      return NextResponse.json({ error: 'Erro ao salvar cliente' }, { status: 500 });
    }

    // Gera codigo unico
    let codigo = gerarCodigoOrcamento();
    
    // Garante unicidade (tenta 3x)
    for (let i = 0; i < 3; i++) {
      const { data: existing } = await supabaseAdmin
        .from('orcamentos')
        .select('id')
        .eq('codigo', codigo)
        .single();
      if (!existing) break;
      codigo = gerarCodigoOrcamento();
    }

    // Cria orcamento
    const { data: orcamento, error: orcError } = await supabaseAdmin
      .from('orcamentos')
      .insert({
        codigo,
        cliente_id: cliente.id,
        tipo_entrega,
        valor_frete,
        subtotal,
        total,
        status: 'orcamento',
        observacoes: observacoes || null,
        fonte: 'interface',
      })
      .select('id, codigo')
      .single();

    if (orcError) {
      console.error('Erro ao criar orcamento:', orcError);
      return NextResponse.json({ error: 'Erro ao salvar orcamento' }, { status: 500 });
    }

    // Cria itens
    const itensToInsert = itens.map((item: {
      produto_id?: string | number;
      produto_nome: string;
      quantidade: number;
      unidade?: string;
      preco_unitario: number;
    }) => ({
      orcamento_id: orcamento.id,
      produto_id: item.produto_id ? Number(item.produto_id) : null,
      produto_nome: item.produto_nome,
      quantidade: item.quantidade,
      unidade: item.unidade || 'unidade',
      preco_unitario: item.preco_unitario,
      subtotal: item.quantidade * item.preco_unitario,
    }));

    const { error: itensError } = await supabaseAdmin
      .from('orcamento_itens')
      .insert(itensToInsert);

    if (itensError) {
      console.error('Erro ao criar itens:', itensError);
      // Nao falha completamente - o orcamento foi criado
    }

    return NextResponse.json({
      success: true,
      codigo: orcamento.codigo,
      id: orcamento.id,
      mensagem: `Orcamento ${orcamento.codigo} salvo com sucesso`,
    });

  } catch (error) {
    console.error('Erro ao salvar orcamento:', error);
    return NextResponse.json({ error: 'Erro interno ao salvar orcamento' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const busca = searchParams.get('busca');
    const pagina = parseInt(searchParams.get('pagina') || '1');
    const limite = parseInt(searchParams.get('limite') || '20');
    const offset = (pagina - 1) * limite;

    let query = supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, tipo_entrega, valor_frete, subtotal, total,
        status, observacoes, criado_em,
        clientes ( id, nome, telefone, cidade, estado )
      `, { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + limite - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (busca) {
      // Busca por codigo ou por nome/telefone do cliente
      query = query.or(`codigo.ilike.%${busca}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Erro ao buscar orcamentos:', error);
      return NextResponse.json({ error: 'Erro ao buscar orcamentos' }, { status: 500 });
    }

    return NextResponse.json({
      orcamentos: data || [],
      total: count || 0,
      pagina,
      limite,
    });

  } catch (error) {
    console.error('Erro ao listar orcamentos:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}