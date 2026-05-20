// Taxonomia fixa de tags de cliente.
// DEVE ser identica ao CHECK constraint chk_tag_valida da tabela cliente_tags.
// Se mudar aqui, atualizar o constraint no banco (e vice-versa).
export const TAGS_VALIDAS = [
  'pedreiro',
  'empreiteiro',
  'dono_obra',
  'revendedor',
  'obra_ativa',
  'vip',
  'em_negociacao',
  'inadimplente',
] as const;

export type TagValida = typeof TAGS_VALIDAS[number];

// Type guard: confirma que um valor desconhecido e uma tag valida.
export function isTagValida(tag: unknown): tag is TagValida {
  return typeof tag === 'string' && (TAGS_VALIDAS as readonly string[]).includes(tag);
}
