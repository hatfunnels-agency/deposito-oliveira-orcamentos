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

// Periodos de entrega (08/11/2026). A entrega e agendada em manha ou tarde;
// o teto por periodo fica em configuracoes.entregas_capacidade_periodo.
export type PeriodoEntrega = 'manha' | 'tarde';
export const PERIODO_LABEL: Record<PeriodoEntrega, string> = { manha: 'Manhã (8h–12h)', tarde: 'Tarde (13h–17h)' };
const PERIODO_FAIXA: Record<PeriodoEntrega, string> = { manha: 'entre 8h e 12h', tarde: 'entre 13h e 17h' };

export interface DadosPedidoConfirmacao {
  codigo: string;
  cliente_nome: string;
  data_entrega: string | null;
  periodo_entrega?: string | null;
  hoje?: string;
}

// Pedido de confirmacao mandado no inicio do dia. Sem confirmacao o pedido
// nao carrega — a mensagem diz isso de forma educada.
export function montarPedidoConfirmacao(e: DadosPedidoConfirmacao): string {
  const primeiroNome = (e.cliente_nome || '').trim().split(/\s+/)[0] || '';
  const quando = e.data_entrega && e.hoje && e.data_entrega === e.hoje
    ? 'para *hoje*'
    : e.data_entrega ? `para *${e.data_entrega.split('-').reverse().join('/')}*` : '';
  const periodo = e.periodo_entrega === 'manha' || e.periodo_entrega === 'tarde'
    ? `, no período da *${e.periodo_entrega === 'manha' ? 'manhã' : 'tarde'}* (${PERIODO_FAIXA[e.periodo_entrega]})`
    : '';
  return [
    primeiroNome ? `Olá, ${primeiroNome}! 👷` : 'Olá! 👷',
    '',
    `Aqui é do *Depósito Oliveira*. A entrega do seu pedido *${e.codigo}* está agendada ${quando}${periodo}.`,
    '',
    'Pode *confirmar* que vai ter alguém no local para receber? É só responder *SIM*.',
    'Se precisar mudar o dia, responda aqui que a gente reagenda.',
    '',
    'Importante: só enviamos o caminhão depois da sua confirmação.',
  ].join('\n');
}
