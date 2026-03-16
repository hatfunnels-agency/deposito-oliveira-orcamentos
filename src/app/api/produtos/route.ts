import { NextResponse } from 'next/server';

const PRODUTOS_DEMO = [
  { id: '1', nome: 'Cimento CP-II 50kg', preco: 32.90, estoque: 500, unidade: 'saco', categoria: 'Cimento' },
  { id: '2', nome: 'Areia Media (saco 20kg)', preco: 12.50, estoque: 300, unidade: 'saco', categoria: 'Areias' },
  { id: '3', nome: 'Brita 1 (saco 20kg)', preco: 14.00, estoque: 200, unidade: 'saco', categoria: 'Britas' },
  { id: '4', nome: 'Tijolo Ceramico 6 furos', preco: 0.89, estoque: 50000, unidade: 'unidade', categoria: 'Tijolos' },
  { id: '5', nome: 'Vergalhao CA-50 10mm 12m', preco: 89.90, estoque: 150, unidade: 'barra', categoria: 'Ferragens' },
  { id: '6', nome: 'Telha Ceramica Capa-Canal', preco: 2.50, estoque: 10000, unidade: 'unidade', categoria: 'Telhas' },
  { id: '7', nome: 'Cal Hidratada 20kg', preco: 18.90, estoque: 200, unidade: 'saco', categoria: 'Cal' },
  { id: '8', nome: 'Lajota Ceramica 20x20', preco: 3.20, estoque: 5000, unidade: 'unidade', categoria: 'Pisos' },
  { id: '9', nome: 'Cimento CP-V ARI 50kg', preco: 38.50, estoque: 200, unidade: 'saco', categoria: 'Cimento' },
  { id: '10', nome: 'Areia Grossa (saco 20kg)', preco: 11.00, estoque: 250, unidade: 'saco', categoria: 'Areias' },
  { id: '11', nome: 'Vergalhao CA-50 8mm 12m', preco: 62.90, estoque: 120, unidade: 'barra', categoria: 'Ferragens' },
  { id: '12', nome: 'Bloco de Concreto 14x19x39', preco: 4.50, estoque: 8000, unidade: 'unidade', categoria: 'Tijolos' },
];

export async function GET() {
  const accessToken = process.env.BLING_ACCESS_TOKEN;

  if (!accessToken || accessToken === 'seu_token_aqui') {
    return NextResponse.json({
      produtos: PRODUTOS_DEMO,
      fonte: 'demo',
      mensagem: 'Usando produtos de demonstracao. Configure BLING_ACCESS_TOKEN para dados reais.'
    });
  }

  try {
    // Bling API v3 - buscar produtos
    const blingRes = await fetch('https://www.bling.com.br/Api/v3/produtos?limite=100&situacao=A&tipo=P', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!blingRes.ok) {
      const errText = await blingRes.text();
      console.error('Bling API error:', blingRes.status, errText);
      return NextResponse.json({
        produtos: PRODUTOS_DEMO,
        fonte: 'demo',
        mensagem: `Erro ao conectar com Bling (${blingRes.status}). Usando dados de demonstracao.`
      });
    }

    const blingData = await blingRes.json();
    
    // Mapear produtos do Bling para formato da aplicacao
    const produtos = (blingData.data || []).map((p: {
      id: number;
      nome: string;
      preco?: number;
      unidade?: string;
      estoque?: { saldoVirtualTotal?: number };
      categoria?: { descricao?: string };
    }) => ({
      id: String(p.id),
      nome: p.nome,
      preco: p.preco || 0,
      estoque: p.estoque?.saldoVirtualTotal || 99, // Fallback para estoque ficticio
      unidade: p.unidade || 'unidade',
      categoria: p.categoria?.descricao || 'Geral',
    }));

    return NextResponse.json({
      produtos: produtos.length > 0 ? produtos : PRODUTOS_DEMO,
      fonte: produtos.length > 0 ? 'bling' : 'demo',
      mensagem: produtos.length > 0 
        ? `${produtos.length} produtos carregados do Bling` 
        : 'Nenhum produto ativo encontrado no Bling. Usando demonstracao.'
    });

  } catch (error) {
    console.error('Erro ao buscar produtos do Bling:', error);
    return NextResponse.json({
      produtos: PRODUTOS_DEMO,
      fonte: 'demo',
      mensagem: 'Erro de conexao com Bling. Usando dados de demonstracao.'
    });
  }
}