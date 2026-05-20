// Helpers de tags de cliente que dependem do Supabase (service role).
// SERVER-ONLY — nunca importar de um componente 'use client'.
import { supabaseAdmin } from '@/lib/supabase';

// Status de orcamento que indicam venda real (orcamento confirmado).
const STATUS_VENDA = [
  'entrega_pendente', 'retirada_pendente', 'em_rota', 'entrega_parcial', 'completo',
];

// Aplica (upsert) a tag obra_ativa ao cliente quando o orcamento vira venda
// real. Idempotente: se a tag ja existe, apenas atualiza data_aplicacao.
// NAO bloqueia o request principal — qualquer falha e apenas logada.
export async function aplicarTagObraAtiva(
  clienteId: string | null | undefined,
  status: string | null | undefined,
): Promise<void> {
  if (!clienteId || !status || !STATUS_VENDA.includes(status)) return;
  try {
    const { error } = await supabaseAdmin
      .from('cliente_tags')
      .upsert(
        {
          cliente_id: clienteId,
          tag: 'obra_ativa',
          origem: 'auto',
          data_aplicacao: new Date().toISOString(),
        },
        { onConflict: 'cliente_id,tag', ignoreDuplicates: false },
      );
    if (error) {
      console.error('[auto-tag obra_ativa] upsert falhou (nao bloqueante):', error);
    }
  } catch (e) {
    console.error('[auto-tag obra_ativa] excecao (nao bloqueante):', e);
  }
}

// Retorna a data da ultima compra do cliente (data_entrega quando existir,
// senao criado_em do orcamento de venda mais recente) ou null se nao houver.
// Mesma definicao de "venda" usada pelo GET /api/clientes/[id]: status fora
// de 'orcamento' e 'cancelado'.
export async function buscarUltimaCompra(clienteId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select('criado_em, data_entrega')
    .eq('cliente_id', clienteId)
    .not('status', 'in', '(orcamento,cancelado)');

  if (error || !data || data.length === 0) return null;

  let ultima: string | null = null;
  for (const o of data) {
    const d = (o.data_entrega as string | null) || (o.criado_em as string);
    if (d && (ultima === null || new Date(d).getTime() > new Date(ultima).getTime())) {
      ultima = d;
    }
  }
  return ultima;
}
