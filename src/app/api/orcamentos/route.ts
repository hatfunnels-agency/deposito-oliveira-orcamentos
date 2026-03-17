import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, gerarCodigoOrcamento } from '@/lib/supabase';

// ============================================================
// Função para criar pedido no Bling (não-bloqueante)
// ============================================================
async function criarPedidoBling(orcamento: {
  codigo: string;
  cliente_nome: string;
  cliente_telefone?: string;
  tipo_entrega?: string;
  valor_frete?: number;
  data_entrega?: string;
  observacoes?: string;
  itens: Array<{
    produto_bling_id: number | null;
    produto_nome: string;
    quantidade: number;
    preco_unitario: number;
  }>;
}): Promise<number | null> {
  try {
    const itensComBlingId = orcamento.itens.filter(i => i.produto_bling_id);
    if (itensComBlingId.length === 0) {
      console.warn('Nenhum item com produto_bling_id para criar pedido Bling');
      return null;
    }
    const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SUPABASE_URL
        ? 'https://deposito-oliveira-orcamentos.vercel.app'
        : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/bling/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        cliente_nome: orcamento.cliente_nome,
        cliente_telefone: orcamento.cliente_telefone,
        itens: itensComBlingId.map(i => ({
          produto_bling_id: i.produto_bling_id,
          produto_nome: i.produto_nome,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
        })),
        observacoes: orcamento.observacoes,
        data_entrega: orcamento.data_entrega,
        codigo_orcamento: orcamento.codigo,
        valor_frete: orcamento.valor_frete,
        tipo_entrega: orcamento.tipo_entrega,
      }),
    });
    if (!res.ok) {
      console.error('Falha ao criar pedido Bling:', res.status);
      return null;
    }
    const data = await res.json();
    return data.bling_pedido_id || null;
  } catch (error) {
    console.error('Erro ao chamar API Bling pedido:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      cliente_nome, cliente_telefone, cliente_cep, cliente_endereco,
      cliente_numero, cliente_complemento, cliente_recebedor,
      tipo_entrega, valor_frete = 0, subtotal, total,
      observacoes, data_entrega, itens,
    } = body;

    if (!cliente_nome || !cliente_telefone || !subtotal || !itens || itens.length === 0) {
      return NextResponse.json(
        { error: 'Dados obrigatorios: nome, telefone, subtotal e itens' },
        { status: 400 }
      );
    }

    // Upsert cliente with new fields (Feature 8)
    const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
    const clienteData: Record<string, unknown> = {
      nome: cliente_nome,
      telefone: telefoneLimpo,
      cep: cliente_cep || null,
      endereco: cliente_endereco || null,
      atualizado_em: new Date().toISOString(),
    };
    if (cliente_numero !== undefined) clienteData.numero = cliente_numero;
    if (cliente_complemento !== undefined) clienteData.complemento = cliente_complemento;
    if (cliente_recebedor !== undefined) clienteData.recebedor = cliente_recebedor;

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from('clientes')
      .upsert(clienteData, { onConflict: 'telefone', ignoreDuplicates: false })
      .select('id')
      .single();

    if (clienteError) {
      console.error('Erro ao criar/atualizar cliente:', clienteError);
      return NextResponse.json({ error: 'Erro ao salvar cliente' }, { status: 500 });
    }

    // Gera codigo unico
    let codigo = gerarCodigoOrcamento();
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
    const insertData: Record<string, unknown> = {
      codigo,
      cliente_id: cliente.id,
      tipo_entrega,
      valor_frete,
      subtotal,
      total,
      status: 'orcamento',
      observacoes: observacoes || null,
      fonte: 'interface',
    };
    if (data_entrega) {
      insertData.data_entrega = data_entrega;
    }

    const { data: orcamento, error: orcError } = await supabaseAdmin
      .from('orcamentos')
      .insert(insertData)
      .select('id, codigo')
      .single();

    if (orcError) {
      console.error('Erro ao criar orcamento:', orcError);
      return NextResponse.json({ error: 'Erro ao salvar orcamento' }, { status: 500 });
    }

    // Cria itens
    const itensToInsert = itens.map((item: {
      produto_id?: string | number;
      produto_bling_id?: string | number;
      produto_nome: string;
      quantidade: number;
      unidade?: string;
      preco_unitario: number;
    }) => ({
      orcamento_id: orcamento.id,
      produto_id: item.produto_id ? Number(item.produto_id) : null,
      produto_bling_id: item.produto_bling_id ? Number(item.produto_bling_id) : null,
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
    }

    // Auto-criar pedido no Bling (não-bloqueante)
    let blingPedidoId: number | null = null;
    try {
      blingPedidoId = await criarPedidoBling({
        codigo: orcamento.codigo,
        cliente_nome,
        cliente_telefone: telefoneLimpo,
        tipo_entrega,
        valor_frete,
        data_entrega,
        observacoes,
        itens: itens.map((item: {
          produto_id?: string | number;
          produto_bling_id?: string | number;
          produto_nome: string;
          quantidade: number;
          preco_unitario: number;
        }) => ({
          produto_bling_id: item.produto_bling_id ? Number(item.produto_bling_id) : (item.produto_id ? Number(item.produto_id) : null),
          produto_nome: item.produto_nome,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
        })),
      });
      if (blingPedidoId) {
        await supabaseAdmin
          .from('orcamentos')
          .update({ bling_pedido_id: blingPedidoId })
          .eq('id', orcamento.id);
      }
    } catch (blingError) {
      console.error('Erro ao criar pedido Bling (não-bloqueante):', blingError);
    }

    return NextResponse.json({
      success: true,
      codigo: orcamento.codigo,
      id: orcamento.id,
      bling_pedido_id: blingPedidoId,
      mensagem: `Orcamento ${orcamento.codigo} salvo com sucesso${blingPedidoId ? ` | Pedido Bling #${blingPedidoId}` : ''}`,
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
        id, codigo, tipo_entrega, valor_frete, subtotal, total, status,
        observacoes, criado_em, data_entrega, bling_pedido_id,
        clientes ( id, nome, telefone, cidade, estado )
      `, { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + limite - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (busca) {
      const { data: matchingClients } = await supabaseAdmin
        .from('clientes')
        .select('id')
        .or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%`);
      const clientIds = (matchingClients || []).map((c: { id: string }) => c.id);
      if (clientIds.length > 0) {
        query = query.or(`codigo.ilike.%${busca}%,cliente_id.in.(${clientIds.join(',')})`);
      } else {
        query = query.or(`codigo.ilike.%${busca}%`);
      }
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
