// Catalogo de produtos formatado pro prompt do robo. SERVER-ONLY.
//
// Sem isto o robo nao sabe o que vendemos nem por quanto. Ele entao responde
// pelo historico da conversa — e historico envelhece: em 26/09 areia fina saiu
// a R$ 200 e a media a R$ 210; hoje a tabela diz R$ 220 nas duas. Ele repetiria
// o preco velho e o cliente cobraria o valor que leu.
//
// E tambem o que permite dizer "isso a gente nao trabalha". Em 29/09 um cliente
// mandou uma lista e o robo "confirmou os itens que consegui confirmar" sem ter
// como confirmar nada.
//
// NAO inclui estoque de proposito: `estoque_atual` esta zerado na maior parte
// do catalogo, e um robo lendo zero recusaria venda de coisa que tem no patio.
import { supabaseAdmin } from '@/lib/supabase';

let cache: { texto: string; quando: number } | null = null;
const TTL_MS = 10 * 60_000;

export async function catalogoParaPrompt(): Promise<string> {
  if (cache && Date.now() - cache.quando < TTL_MS) return cache.texto;

  const { data } = await supabaseAdmin
    .from('produtos')
    .select('nome, preco_venda, unidade_venda, categoria')
    .eq('ativo', true)
    .order('categoria', { ascending: true })
    .order('nome', { ascending: true });

  if (!data?.length) return '';

  const porCategoria = new Map<string, string[]>();
  for (const p of data as Array<{
    nome: string; preco_venda: number; unidade_venda: string; categoria: string | null;
  }>) {
    const cat = p.categoria || 'Outros';
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat)!.push(
      `- ${p.nome}: R$ ${Number(p.preco_venda).toFixed(2)} / ${p.unidade_venda || 'un'}`,
    );
  }

  const blocos = Array.from(porCategoria.entries())
    .map(([cat, linhas]) => `${cat}:\n${linhas.join('\n')}`)
    .join('\n\n');

  const texto = `## CATALOGO — tudo o que vendemos, com o preco de hoje

${blocos}

REGRAS DO CATALOGO, sem excecao:
- Preco e ESTE. Nao use preco que voce viu no historico da conversa: preco
  muda, e o historico envelhece. Se o cliente citar um valor antigo, diga o
  valor de hoje.
- O que NAO esta nesta lista a gente NAO vende. Diga isso com todas as
  letras em vez de "vou confirmar" — o cliente perde menos tempo.
- Numa lista com varios itens, separe o que temos do que nao temos e seja
  explicito sobre cada um.
- Voce NAO tem posicao de estoque. Nunca diga que tem ou que acabou.`;

  cache = { texto, quando: Date.now() };
  return texto;
}
