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
// O teto do servidor pode nao ser 1.000: o tamanho da primeira pagina vira o
// passo das seguintes, e para quando uma pagina vem incompleta.
export async function lerTudo<T = any>(
  montar: () => any,
  opcoes: { porPagina?: number; desempate?: string | null; paralelo?: number } = {},
): Promise<T[]> {
  const porPagina = opcoes.porPagina ?? 1000;
  // Paginar sem ordem estavel pula e repete linhas. 'id' desempata quando a
  // ordem da consulta (ex.: criado_em) tem valores iguais.
  const desempate = opcoes.desempate === undefined ? 'id' : opcoes.desempate;
  // Paginas pedidas ao mesmo tempo. Uma por vez, 10 mil itens viravam 11
  // idas ao banco em fila e o /api/produtos levava 10-15s (10/10).
  const paralelo = Math.max(1, opcoes.paralelo ?? 4);

  const pagina = async (de: number, ate: number): Promise<T[]> => {
    let q = montar();
    if (desempate) q = q.order(desempate, { ascending: true });
    const { data, error } = await q.range(de, ate);
    if (error) throw new Error(error.message);
    return (data || []) as T[];
  };

  // A primeira pagina mostra o teto real do servidor: se vier menor que o
  // pedido, as proximas andam nesse passo, pra nao pular linha.
  const primeira = await pagina(0, porPagina - 1);
  if (primeira.length === 0) return [];
  const passo = primeira.length;
  const tudo: T[] = [...primeira];
  for (let de = passo; ; ) {
    const lote = await Promise.all(
      Array.from({ length: paralelo }, (_, k) => pagina(de + k * passo, de + (k + 1) * passo - 1)),
    );
    let acabou = false;
    for (const linhas of lote) {
      tudo.push(...linhas);
      // Pagina incompleta = fim. As que vierem depois dela estao vazias.
      if (linhas.length < passo) { acabou = true; break; }
    }
    if (acabou) break;
    de += paralelo * passo;
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
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += tamanhoLote) lotes.push(ids.slice(i, i + tamanhoLote));
  // 4 lotes por vez, pelo mesmo motivo do lerTudo.
  const tudo: T[] = [];
  for (let i = 0; i < lotes.length; i += 4) {
    const res = await Promise.all(lotes.slice(i, i + 4).map(l => lerTudo<T>(() => montar(l))));
    for (const r of res) tudo.push(...r);
  }
  return tudo;
}
