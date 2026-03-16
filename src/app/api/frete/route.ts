import { NextResponse } from 'next/server';

// Tabela de frete ficticia por faixa de distancia (km)
// Ajuste os valores conforme necessario
const TABELA_FRETE = [
  { distanciaMax: 10, preco: 50 },
  { distanciaMax: 20, preco: 80 },
  { distanciaMax: 30, preco: 120 },
  { distanciaMax: 50, preco: 160 },
  { distanciaMax: 75, preco: 220 },
  { distanciaMax: 100, preco: 300 },
  { distanciaMax: 150, preco: 420 },
  { distanciaMax: 200, preco: 550 },
];

const DEPOSITO_CEP = process.env.DEPOSITO_CEP || '01001000'; // CEP do deposito

interface ViaCEPResponse {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
  ibge?: string;
}

// Calcular distancia aproximada entre dois pontos via CEP usando IBGE
// Simplificado: usa diferenca de codigos IBGE como proxy de distancia
function calcularDistanciaAproximada(ibge1: string, ibge2: string): number {
  // Se mesma cidade, distancia minima
  if (ibge1 === ibge2) return 5;
  
  // Se mesmo estado (2 primeiros digitos do IBGE)
  if (ibge1.substring(0, 2) === ibge2.substring(0, 2)) {
    return 30 + Math.floor(Math.random() * 40);
  }
  
  // Estados diferentes
  return 100 + Math.floor(Math.random() * 100);
}

function calcularFrete(distanciaKm: number, pesoTotalKg: number): number {
  // Encontrar faixa de preco base
  const faixa = TABELA_FRETE.find(f => distanciaKm <= f.distanciaMax);
  const precoBase = faixa ? faixa.preco : 650;
  
  // Adicional por peso (R$ 0.50 por kg acima de 500kg)
  const adicionalPeso = pesoTotalKg > 500 ? (pesoTotalKg - 500) * 0.50 : 0;
  
  return precoBase + adicionalPeso;
}

export async function POST(request: Request) {
  try {
    const { cepDestino, pesoTotalKg = 100 } = await request.json();
    
    if (!cepDestino) {
      return NextResponse.json({ erro: 'CEP de destino nao informado' }, { status: 400 });
    }
    
    const cepLimpo = cepDestino.replace(/\D/g, '');
    
    if (cepLimpo.length !== 8) {
      return NextResponse.json({ erro: 'CEP invalido' }, { status: 400 });
    }
    
    // Buscar dados do CEP de destino
    const [resDestino, resDeposito] = await Promise.all([
      fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`),
      fetch(`https://viacep.com.br/ws/${DEPOSITO_CEP}/json/`)
    ]);
    
    const dadosDestino: ViaCEPResponse = await resDestino.json();
    const dadosDeposito: ViaCEPResponse = await resDeposito.json();
    
    if (dadosDestino.erro) {
      return NextResponse.json({ erro: 'CEP de destino nao encontrado' }, { status: 404 });
    }
    
    const ibgeDestino = dadosDestino.ibge || '0000000';
    const ibgeDeposito = dadosDeposito.ibge || '0000000';
    
    const distanciaKm = calcularDistanciaAproximada(ibgeDeposito, ibgeDestino);
    const valorFrete = calcularFrete(distanciaKm, pesoTotalKg);
    
    return NextResponse.json({
      cepDestino: dadosDestino.cep,
      endereco: {
        logradouro: dadosDestino.logradouro,
        bairro: dadosDestino.bairro,
        cidade: dadosDestino.localidade,
        estado: dadosDestino.uf,
      },
      distanciaAproximadaKm: distanciaKm,
      pesoTotalKg,
      valorFrete: Math.round(valorFrete * 100) / 100,
      observacao: 'Valor de frete estimado. Sujeito a confirmacao.'
    });
    
  } catch (error) {
    console.error('Erro ao calcular frete:', error);
    return NextResponse.json(
      { erro: 'Erro interno ao calcular frete' },
      { status: 500 }
    );
  }
}