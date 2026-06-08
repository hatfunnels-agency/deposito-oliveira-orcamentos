// Helper de criacao de endereco de cliente. SERVER-ONLY.
//
// Centraliza a regra "primeiro endereco do cliente vira padrao
// automatico" e o disparo do geocode em background, evitando que
// callers (POST /api/clientes/[id]/enderecos e POST /api/orcamentos)
// dupliquem a logica ou caiam no bug de lambda-on-lambda quando um
// POST chama o outro via fetch interno (a Promise pendente do
// geocode fire-and-forget morre quando a lambda externa retorna —
// licao da Sessao 4 item 1, mesma raiz do GHL sync).

import { supabaseAdmin } from '@/lib/supabase';
import { geocodeEnderecoAsync } from '@/lib/geocode';

export const CAMPOS_ENDERECO = [
  'apelido', 'cep', 'rua', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'observacoes',
] as const;

export type CampoEndereco = (typeof CAMPOS_ENDERECO)[number];

export interface DadosEnderecoEntrada {
  apelido?: string | null;
  cep?: string | null;
  rua?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  observacoes?: string | null;
  is_padrao?: boolean;
}

export interface EnderecoCriado {
  id: string;
  cliente_id: string;
  apelido: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  is_padrao: boolean;
  lat: number | null;
  lng: number | null;
  geocoded_em: string | null;
  geocode_status: string | null;
  criado_em: string;
}

export type ResultadoCriacao =
  | { ok: true; endereco: EnderecoCriado }
  | { ok: false; reason: 'cliente_nao_encontrado' }
  | { ok: false; reason: 'insert_falhou'; erro: string };

// Cria um endereco para o cliente. Se for o primeiro endereco do
// cliente OU o caller pediu is_padrao=true, marca como padrao (e
// zera o padrao anterior, respeitando o unique index
// uk_enderecos_clientes_padrao). Dispara geocode em background sem
// bloquear o retorno.
export async function criarEnderecoCliente(
  cliente_id: string,
  dados: DadosEnderecoEntrada,
): Promise<ResultadoCriacao> {
  // Confirma que o cliente existe
  const { data: cliente, error: clienteErr } = await supabaseAdmin
    .from('clientes')
    .select('id')
    .eq('id', cliente_id)
    .single();
  if (clienteErr || !cliente) {
    return { ok: false, reason: 'cliente_nao_encontrado' };
  }

  // Primeiro endereco do cliente vira padrao automatico
  const { count } = await supabaseAdmin
    .from('enderecos_clientes')
    .select('*', { count: 'exact', head: true })
    .eq('cliente_id', cliente_id);
  const isPadrao = (count || 0) === 0 || dados.is_padrao === true;

  // Unique index uk_enderecos_clientes_padrao: zera o padrao anterior
  // antes de inserir o novo padrao.
  if (isPadrao) {
    await supabaseAdmin
      .from('enderecos_clientes')
      .update({ is_padrao: false })
      .eq('cliente_id', cliente_id)
      .eq('is_padrao', true);
  }

  const insert: Record<string, unknown> = { cliente_id, is_padrao: isPadrao };
  for (const campo of CAMPOS_ENDERECO) {
    const v = (dados as Record<string, unknown>)[campo];
    if (v !== undefined) insert[campo] = v;
  }

  const { data, error } = await supabaseAdmin
    .from('enderecos_clientes')
    .insert(insert)
    .select('*')
    .single();

  if (error || !data) {
    return { ok: false, reason: 'insert_falhou', erro: error?.message || 'erro desconhecido' };
  }

  // Geocoding em background — fire-and-forget. Tolerado aqui porque
  // este helper sempre roda em rotas terminais (POST orcamentos / POST
  // enderecos chamados direto da UI). Pra delegacoes lambda-on-lambda
  // futuras, considerar after() do Next 15.
  void geocodeEnderecoAsync(data.id as string);

  return { ok: true, endereco: data as EnderecoCriado };
}
