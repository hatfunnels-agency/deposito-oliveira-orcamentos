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

  // Carrega enderecos existentes do cliente — usado tanto pro dedup
  // (evita cadastrar o MESMO endereco a cada compra) quanto pra regra
  // do primeiro endereco virar padrao.
  const { data: existentes } = await supabaseAdmin
    .from('enderecos_clientes')
    .select('*')
    .eq('cliente_id', cliente_id);
  const lista = existentes || [];

  // Dedup: se ja existe um endereco igual (mesma rua/numero/complemento/
  // bairro/cidade/estado/cep, normalizados), reusa em vez de duplicar.
  // Corrige o bug de cada compra recadastrar o mesmo endereco.
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normCep = (v: unknown) => String(v ?? '').replace(/\D/g, '');
  const chave = (e: Record<string, unknown>) =>
    [norm(e.rua), norm(e.numero), norm(e.complemento), norm(e.bairro), norm(e.cidade), norm(e.estado), normCep(e.cep)].join('|');
  const alvo = chave(dados as unknown as Record<string, unknown>);
  const existente = lista.find((e) => chave(e as Record<string, unknown>) === alvo);
  if (existente) {
    // Se o caller pediu este endereco como padrao e ele ainda nao e,
    // promove o existente (respeitando o unique index de 1 padrao/cliente).
    if (dados.is_padrao === true && !existente.is_padrao) {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({ is_padrao: false })
        .eq('cliente_id', cliente_id)
        .eq('is_padrao', true);
      const { data: promovido } = await supabaseAdmin
        .from('enderecos_clientes')
        .update({ is_padrao: true })
        .eq('id', existente.id)
        .select('*')
        .single();
      if (promovido) return { ok: true, endereco: promovido as EnderecoCriado };
    }
    return { ok: true, endereco: existente as EnderecoCriado };
  }

  // Primeiro endereco do cliente vira padrao automatico
  const isPadrao = lista.length === 0 || dados.is_padrao === true;

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
