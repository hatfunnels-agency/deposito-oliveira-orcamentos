import { NextResponse } from 'next/server';
import { blingFetch, isBlingConfigured } from '@/lib/bling-auth';

// Produtos reais do Deposito Oliveira - usados quando Bling nao esta conectado
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

interface BlingProduto {
  id: number;
  nome: string;
  preco?: number;
  unidade?: string;
  estoque?: { saldoVirtualTotal?: number };
  categoria?: { descricao?: string };
}

async function fetchProdutosBling(): Promise<typeof PRODUTOS_DEMO> {
  const allProdutos: typeof PRODUTOS_DEMO = [];
  let pagina = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await blingFetch(
      `/produtos?limite=100&criterio=5&tipo=P&pagina=${pagina}`
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Bling API erro ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const items: BlingProduto[] = data.data || [];

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    const mapped = items.map((p) => ({
      id: String(p.id),
      nome: p.nome,
      preco: p.preco || 0,
      estoque: p.estoque?.saldoVirtualTotal ?? 99, // fallback 99 se sem estoque
      unidade: p.unidade || 'unidade',
      categoria: p.categoria?.descricao || 'Geral',
    }));

    allProdutos.push(...mapped);
    
    // Se retornou menos de 100, nao tem mais paginas
    if (items.length < 100) {
      hasMore = false;
    } else {
      pagina++;
    }
  }

  return allProdutos;
}

export async function GET() {
  // Se Bling nao esta configurado, retorna demo
  if (!isBlingConfigured()) {
    return NextResponse.json({
      produtos: PRODUTOS_DEMO,
      fonte: 'demo',
      mensagem: 'Usando produtos de demonstracao. Acesse /api/bling/auth para conectar o Bling.',
    });
  }

  try {
    const produtos = await fetchProdutosBling();

    return NextResponse.json({
      produtos: produtos.length > 0 ? produtos : PRODUTOS_DEMO,
      fonte: produtos.length > 0 ? 'bling' : 'demo',
      mensagem: produtos.length > 0
        ? `${produtos.length} produtos carregados do Bling`
        : 'Nenhum produto ativo encontrado no Bling. Usando demonstracao.',
    });

  } catch (error) {
    console.error('Erro ao buscar produtos do Bling:', error);
    return NextResponse.json({
      produtos: PRODUTOS_DEMO,
      fonte: 'demo',
      mensagem: 'Erro ao conectar com Bling. Usando dados de demonstracao.',
    });
  }
}