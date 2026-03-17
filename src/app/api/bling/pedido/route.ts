import { NextResponse } from 'next/server';
import { blingFetch } from '@/lib/bling-auth';

interface PedidoItem {
  produto_bling_id: number;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
}

interface CriarPedidoRequest {
  cliente_nome: string;
  cliente_telefone?: string;
  itens: PedidoItem[];
  observacoes?: string;
  data_entrega?: string;
  codigo_orcamento?: string;
  valor_frete?: number;
  tipo_entrega?: string;
}

export async function POST(request: Request) {
  try {
    const body: CriarPedidoRequest = await request.json();
    const {
      cliente_nome,
      cliente_telefone,
      itens,
      observacoes,
      data_entrega,
      codigo_orcamento,
      valor_frete,
      tipo_entrega,
    } = body;

    if (!cliente_nome || !itens || itens.length === 0) {
      return NextResponse.json(
        { error: 'Nome do cliente e itens são obrigatórios' },
        { status: 400 }
      );
    }

    // Montar data atual no formato YYYY-MM-DD
    const hoje = new Date().toISOString().split('T')[0];

    // Montar observações internas
    const obsInternas = [
      codigo_orcamento ? `Orçamento: ${codigo_orcamento}` : '',
      tipo_entrega ? `Tipo: ${tipo_entrega}` : '',
      valor_frete ? `Frete: R$ ${valor_frete.toFixed(2)}` : '',
    ].filter(Boolean).join(' | ');

    // Montar body do pedido para a API do Bling
    const pedidoBling = {
      numero: 0, // Bling gera automaticamente
      data: hoje,
      dataPrevista: data_entrega || hoje,
      contato: {
        nome: cliente_nome,
        tipoPessoa: 'F',
        telefone: cliente_telefone || '',
      },
      itens: itens.map((item) => ({
        produto: {
          id: item.produto_bling_id,
        },
        quantidade: item.quantidade,
        valor: item.preco_unitario,
        descricao: item.produto_nome,
      })),
      observacoes: observacoes || '',
      observacoesInternas: obsInternas,
    };

    // Chamar API do Bling para criar pedido de venda
    const response = await blingFetch('/pedidos/vendas', {
      method: 'POST',
      body: JSON.stringify(pedidoBling),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('Erro Bling ao criar pedido:', response.status, errorData);
      return NextResponse.json(
        {
          error: 'Erro ao criar pedido no Bling',
          status_bling: response.status,
          details: errorData,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    const pedidoId = data?.data?.id;

    return NextResponse.json({
      success: true,
      bling_pedido_id: pedidoId,
      message: `Pedido criado no Bling com sucesso${pedidoId ? ` (ID: ${pedidoId})` : ''}`,
    });
  } catch (error) {
    console.error('Erro ao criar pedido no Bling:', error);
    return NextResponse.json(
      { error: 'Erro interno ao criar pedido no Bling' },
      { status: 500 }
    );
  }
}
