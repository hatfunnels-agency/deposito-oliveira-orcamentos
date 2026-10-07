// Leitura completa de uma consulta do Supabase, pagina por pagina.
//
// O Supabase (PostgREST) devolve no MAXIMO 1.000 linhas por consulta e corta
// o resto SEM ERRO. `.limit(20000)` nao muda isso — continua vindo 1.000.
// Em 06/10 o banco tinha 2.791 vendas: a lista de tarefas mostrava a Tay com
// 9 pedidos e R$ 34 mil (eram 24 e R$ 106 mil, com compra no proprio dia), e
// o faturamento do dashboard "travava em 300 e poucos mil" acima de 4 meses —
// e o valor de ~1.000 vendas.
//
// Use em toda consulta que possa passar de 1.000 linhas. `montar` devolve a
// consulta SEM .range/.limit; ela e reconstruida a cada pagina.
//
// Para so quando uma pagina vem vazia — nao quando vem "menor que 1.000" —
// porque o teto do servidor pode ser outro numero e isso pararia cedo demais.
// O custo e uma consulta vazia a mais no fim.
export async function lerTudo<T = any>(
  montar: () => any,
  opcoes: { porPagina?: number; desempate?: string | null } = {},
): Promise<T[]> {
  const porPagina = opcoes.porPagina ?? 1000;
  // Paginar sem ordem estavel pula e repete linhas. 'id' desempata quando a
  // ordem da consulta (ex.: criado_em) tem valores iguais.
  const desempate = opcoes.desempate === undefined ? 'id' : opcoes.desempate;
  const tudo: T[] = [];
  for (let de = 0; ; ) {
    let q = montar();
    if (desempate) q = q.order(desempate, { ascending: true });
    const { data, error } = await q.range(de, de + porPagina - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    tudo.push(...data);
    de += data.length;
  }
  return tudo;
}

// Mesma coisa para filtros `.in(coluna, lista)` com lista grande: centenas de
// ids numa URL estouram o tamanho maximo da requisicao, e o erro costuma ser
// engolido em silencio. Consulta em lotes de 200 ids, cada lote paginado.
export async function lerTudoEmLotes<T = any>(
  ids: string[],
  montar: (lote: string[]) => any,
  tamanhoLote = 200,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let i = 0; i < ids.length; i += tamanhoLote) {
    const lote = ids.slice(i, i + tamanhoLote);
    tudo.push(...(await lerTudo<T>(() => montar(lote))));
  }
  return tudo;
}
