// Tabela de preco da ferragem montada (calculadora de ferro) + degrau por
// volume. Fica fora do modal porque o OrcamentoApp precisa reprecificar as
// linhas ja adicionadas quando o total de metros do pedido cruza um degrau.
//
// Decisao de 20/10/2026 (Roger): pedidos grandes de ferragem fechavam mal
// (acima de 40m, metade ficava parada em orcamento; acima de 100m, 4 em 5).
// Em vez de baixar a tabela, desconto por metro quando o PEDIDO inteiro
// passa do degrau. Vale pra todas as medidas/barras, somado por cima.

export type Medida = '9x15' | '9x20' | 'especial';
export type Barras = 4 | 6 | 8;
export type Espacamento = '10' | '15' | '20' | '25';

export const ESPACAMENTO_M: Record<Espacamento, number> = {
  '10': 0.10, '15': 0.15, '20': 0.20, '25': 0.25,
};
// Acrescimo no preco/metro (R$) por estribo mais fechado que o padrao de 25cm.
export const ESPACAMENTO_ACRESCIMO: Record<Espacamento, number> = {
  '25': 0, '20': 1, '15': 2, '10': 4,
};

// Degraus por metragem total de ferragem no pedido (desconto em R$/m).
// Ordem crescente; vale o maior degrau atingido.
export const DEGRAUS_VOLUME: Array<{ minMetros: number; descontoPorMetro: number }> = [
  { minMetros: 40, descontoPorMetro: 2 },
  { minMetros: 100, descontoPorMetro: 3 },
];

export function descontoVolume(metrosNoPedido: number): number {
  let d = 0;
  for (const deg of DEGRAUS_VOLUME) if (metrosNoPedido >= deg.minMetros) d = deg.descontoPorMetro;
  return d;
}

// Proximo degrau ainda nao atingido (pra atendente saber quanto falta).
export function proximoDegrau(metrosNoPedido: number): { minMetros: number; descontoPorMetro: number } | null {
  for (const deg of DEGRAUS_VOLUME) if (metrosNoPedido < deg.minMetros) return deg;
  return null;
}

// Tabela base (espacamento 25cm). Nao acumulativo entre medida/barras:
// 4 barras: 9x15=R$23/m | 9x20=R$23/m | especial=R$28/m
// 6 barras: R$38/m | 8 barras: R$45/m (independente de medida)
export function precoBaseTier(medida: Medida, barras: Barras): number {
  if (barras === 6) return 38;
  if (barras === 8) return 45;
  return medida === 'especial' ? 28 : 23;
}

export function precoFerragemPorMetro(medida: Medida, barras: Barras, espacamento: Espacamento, metrosNoPedido: number): number {
  return precoBaseTier(medida, barras) + ESPACAMENTO_ACRESCIMO[espacamento] - descontoVolume(metrosNoPedido);
}

// Le medida/barras/espacamento de volta do nome gerado pela calculadora
// ("8 Colunas 3m 9×15 4 barras • Estribo 25cm | 24m"). O nome e a unica
// persistencia desses dados (orcamento_itens nao tem colunas proprias).
export function parseNomeFerragem(nome: string): { medida: Medida; barras: Barras; espacamento: Espacamento } | null {
  const mBarras = nome.match(/(\d) barras( \(especial\))?/);
  const mEsp = nome.match(/Estribo (10|15|20|25)cm/);
  if (!mBarras || !mEsp) return null;
  const barras = Number(mBarras[1]);
  if (barras !== 4 && barras !== 6 && barras !== 8) return null;
  const especial = Boolean(mBarras[2]);
  const medida: Medida = especial ? 'especial' : (nome.includes('9×20') || nome.includes('9x20') ? '9x20' : '9x15');
  return { medida, barras: barras as Barras, espacamento: mEsp[1] as Espacamento };
}
