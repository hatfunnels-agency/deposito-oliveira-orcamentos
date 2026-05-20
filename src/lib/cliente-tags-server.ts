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
