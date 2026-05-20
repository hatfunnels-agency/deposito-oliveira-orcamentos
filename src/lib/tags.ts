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

// Regra de "obra ativa": a tag obra_ativa so vale enquanto a ultima compra
// do cliente foi ha ate 30 dias. Compute-on-read — nao mexe no banco.
export function isObraAtivaActive(ultimaCompra: string | Date | null): boolean {
  if (!ultimaCompra) return false;
  const dataUltima = new Date(ultimaCompra);
  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
  return dataUltima >= trintaDiasAtras;
}

// Filtro de leitura: remove obra_ativa do array de tags quando a obra nao
// esta mais ativa (ultima compra ha mais de 30 dias). As demais tags passam
// inalteradas. NAO altera o banco — so a resposta da API.
export function filtrarTagsObraAtiva<T extends { tag: string }>(
  tags: T[],
  ultimaCompra: string | Date | null,
): T[] {
  if (isObraAtivaActive(ultimaCompra)) return tags;
  return tags.filter(t => t.tag !== 'obra_ativa');
}
