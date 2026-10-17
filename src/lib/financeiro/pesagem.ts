// Ticket de pesagem (pedra e areia): peso da carga -> m3 -> valor.
//
// O fornecedor manda a foto do ticket da balanca. O estoque e o custo do
// agregado sao em m3, entao:
//   m3    = peso liquido (t) / densidade (t/m3)
//   valor = m3 x custo por m3 do produto (preco_custo)
// Peso liquido: o do ticket; se so tiver bruto e tara, bruto - tara; se so
// tiver um peso, usa ele e marca para conferencia.
//
// Funcoes puras: rodam no servidor (leitura) e no navegador (o usuario
// edita densidade e preco e o total recalcula na hora).

import type { CalculoPesagem, ItemDocumentoLido } from './tipos';
import { arred2 } from './datas';

export const DENSIDADE_AREIA_FINA = 1.5;
export const DENSIDADE_AGREGADO_PADRAO = 1.4;

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/**
 * Densidade pelo nome, para quando o produto ainda nao tem densidade_t_m3
 * (migration nao aplicada, ou produto novo). Areia fina 1,5; areia media e
 * grossa, pedra/brita, pedrisco e po de pedra 1,4. Outro material: null.
 */
export function densidadePorNome(nome: string | null | undefined): number | null {
  const n = semAcento(nome ?? '');
  if (!n) return null;
  if (/AREIA\s+FINA/.test(n)) return DENSIDADE_AREIA_FINA;
  if (/AREIA|BRITA|PEDRISCO|PO\s+DE\s+PEDRA|PEDRA/.test(n)) return DENSIDADE_AGREGADO_PADRAO;
  return null;
}

const positivo = (n: number | null | undefined): number | null =>
  n !== null && n !== undefined && Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;

export function pesoLiquido(item: Pick<ItemDocumentoLido, 'peso_bruto_kg' | 'tara_kg' | 'peso_liquido_kg'>): {
  kg: number | null; origem: CalculoPesagem['origem_peso']; conferir: boolean;
} {
  const bruto = positivo(item.peso_bruto_kg);
  const tara = positivo(item.tara_kg);
  const liquido = positivo(item.peso_liquido_kg);
  if (liquido !== null) {
    // Liquido impresso que nao bate com bruto - tara (> 1%) pede conferencia.
    const conferir = bruto !== null && tara !== null && Math.abs((bruto - tara) - liquido) > Math.max(1, liquido * 0.01);
    return { kg: liquido, origem: 'liquido', conferir };
  }
  if (bruto !== null && tara !== null && bruto > tara) return { kg: bruto - tara, origem: 'bruto_menos_tara', conferir: false };
  const unico = bruto ?? tara;
  if (unico !== null) return { kg: unico, origem: 'peso_unico', conferir: true };
  return { kg: null, origem: 'sem_peso', conferir: true };
}

/** m3 com 3 casas (o estoque e numeric(…,3)). */
export function arred3(n: number): number {
  const r = Math.round((Number(n) || 0) * 1000) / 1000;
  return r === 0 ? 0 : r;
}

export function calcularPesagem(
  pesoKg: number | null,
  densidade: number | null,
  custoM3: number | null,
  base: Pick<CalculoPesagem, 'origem_peso' | 'conferir'> = { origem_peso: 'liquido', conferir: false },
): CalculoPesagem {
  const kg = positivo(pesoKg);
  const d = positivo(densidade);
  const custo = custoM3 !== null && custoM3 !== undefined && Number.isFinite(Number(custoM3)) && Number(custoM3) >= 0 ? Number(custoM3) : null;
  const m3 = kg !== null && d !== null ? arred3(kg / 1000 / d) : null;
  const valor = m3 !== null && custo !== null ? arred2(m3 * custo) : null;
  return {
    peso_liquido_kg: kg,
    origem_peso: kg === null ? 'sem_peso' : base.origem_peso,
    conferir: kg === null ? true : base.conferir,
    densidade_t_m3: d,
    m3,
    custo_m3: custo,
    valor,
  };
}
