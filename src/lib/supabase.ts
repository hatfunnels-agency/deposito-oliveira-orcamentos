import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client server-side com service role key (bypassa RLS)
// Usar APENAS em API routes, nunca no cliente
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export type OrcamentoStatus =
  | 'orcamento'
  | 'pagamento_pendente'
  | 'pagamento_ok'
  | 'separacao'
  | 'entrega_pendente'
  | 'em_rota'
  | 'completo'
  | 'ocorrencia'
  | 'cancelado';

export const STATUS_LABELS: Record<OrcamentoStatus, string> = {
  orcamento: 'Orcamento',
  pagamento_pendente: 'Pgto. Pendente',
  pagamento_ok: 'Pgto. OK',
  separacao: 'Em Separacao',
  entrega_pendente: 'Entrega Pendente',
  em_rota: 'Em Rota',
  completo: 'Completo',
  ocorrencia: 'Ocorrencia',
  cancelado: 'Cancelado',
};

export const STATUS_COLORS: Record<OrcamentoStatus, string> = {
  orcamento: 'bg-gray-100 text-gray-700',
  pagamento_pendente: 'bg-yellow-100 text-yellow-800',
  pagamento_ok: 'bg-green-100 text-green-800',
  separacao: 'bg-blue-100 text-blue-800',
  entrega_pendente: 'bg-orange-100 text-orange-800',
  em_rota: 'bg-purple-100 text-purple-800',
  completo: 'bg-green-200 text-green-900',
  ocorrencia: 'bg-red-100 text-red-800',
  cancelado: 'bg-gray-200 text-gray-600',
};

// Gera codigo unico do orcamento formato ORD-XXXXXXX
export function gerarCodigoOrcamento(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'ORD-';
  for (let i = 0; i < 7; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}