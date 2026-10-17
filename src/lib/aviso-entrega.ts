// Texto do aviso "seu pedido saiu para entrega". PURO: usado pela tela
// (fallback wa.me) e pelo servidor (/api/entregas/avisar, que manda pelo
// GHL sem abrir o WhatsApp no celular).

export interface DadosAvisoEntrega {
  codigo: string;
  cliente_nome: string;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  a_cobrar?: number | null;
  forma_pagamento?: string | null;
  recebedor?: string | null;
}

const FORMA: Record<string, string> = {
  pix: 'Pix', dinheiro: 'dinheiro', debito: 'cartão de débito', credito: 'cartão de crédito', cartao: 'cartão', boleto: 'boleto',
};

export function montarAvisoEntrega(e: DadosAvisoEntrega): string {
  const primeiroNome = (e.cliente_nome || '').trim().split(/\s+/)[0] || '';
  const endereco = [[e.endereco, e.numero].filter(Boolean).join(', '), e.bairro].filter(Boolean).join(' - ');
  const aCobrar = Number(e.a_cobrar) || 0;
  const forma = e.forma_pagamento && e.forma_pagamento !== 'pagamento_na_entrega' ? (FORMA[e.forma_pagamento] || e.forma_pagamento) : '';
  return [
    primeiroNome ? `Olá, ${primeiroNome}! 🚚` : 'Olá! 🚚',
    '',
    `Aqui é do *Depósito Oliveira*. Seu pedido *${e.codigo}* já saiu para entrega e o caminhão está a caminho.`,
    endereco ? `📍 ${endereco}` : null,
    aCobrar > 0.01
      ? `💰 Valor a pagar na entrega: *${aCobrar.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*${forma ? ` (${forma})` : ''}`
      : null,
    '',
    `Por favor, deixe alguém no local para receber${e.recebedor ? ` (${e.recebedor})` : ''}.`,
  ].filter(l => l !== null).join('\n');
}
