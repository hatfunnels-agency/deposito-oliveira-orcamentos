// Assistente tecnico das atendentes. SERVER-ONLY.
//
// Responde duvidas do balcao: medidas e uso dos produtos, contas de obra
// (laje, telhas, ferragem, aterro) e como fazer no sistema. Fontes, nesta
// ordem: base_conhecimento (editada em Gestao), catalogo (nome, unidade,
// preco) e as regras fixas abaixo. Nao le pedidos nem clientes — e um
// consultor, nao um relatorio.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';

export interface MensagemAssistente { papel: 'usuario' | 'assistente'; texto: string }

const MODELO = 'claude-opus-5-5';
const MAX_TURNOS = 12;

const REGRAS = `
Voce e o assistente tecnico do Deposito Oliveira (materiais de construcao em
Carapicuiba/SP). Quem pergunta e a ATENDENTE da loja, no balcao ou no WhatsApp,
que precisa responder o cliente rapido. Responda em portugues do Brasil, curto
e direto, como quem explica para uma colega: primeiro a resposta, depois a
conta (quando houver) em 2-4 linhas, e o que ela pode falar para o cliente.

Regras:
- Use a BASE DE CONHECIMENTO e o CATALOGO antes de qualquer regra geral. Se a
  base trouxer a resposta, ela manda.
- Quantidades: mostre a conta (ex.: 40 m2 / 2,30 m2 = 17,4 -> 18 telhas) e
  arredonde para cima. Material a granel sai em multiplos de 0,5 m3.
- Precos: so os do CATALOGO. Nao invente preco, prazo, frete ou condicao.
  Desconto, frete fora de Carapicuiba e prazo de entrega sao decisao da loja:
  diga que ela confirma com o Roger/Mariana.
- Se a pergunta depende de algo que voce nao sabe (medida exata de um lote,
  espec da fabrica, estoque), diga o que falta e sugira confirmar com o
  fornecedor ou pela fabrica. Nunca chute medida de produto.
- Laje e ferragem: a especificacao final e da fabrica; sua conta e estimativa
  para orcar. Diga isso quando fizer a conta.
- Ferragem: o cliente costuma passar so o tamanho e esquecer o estribo (ou so
  o estribo). Sempre liste o que falta perguntar: secao, barras, metros e
  espacamento do estribo.
- Sistema: quando a duvida for "como faco X no sistema", de o caminho passo a
  passo (aba > botao). Nao invente botao que nao esteja na base.
- Nao fale de assuntos fora de material de construcao, obra e do sistema.
`.trim();

let cacheEstatico: { texto: string; quando: number } | null = null;
const TTL_MS = 5 * 60_000;

async function contextoEstatico(): Promise<string> {
  if (cacheEstatico && Date.now() - cacheEstatico.quando < TTL_MS) return cacheEstatico.texto;
  const [{ data: base }, { data: produtos }] = await Promise.all([
    supabaseAdmin.from('base_conhecimento').select('pergunta, resposta, tags').eq('ativo', true).order('criado_em'),
    supabaseAdmin.from('produtos').select('nome, categoria, unidade_venda, preco_venda, tipo_estoque, medidas')
      .eq('ativo', true).neq('vendavel', false).order('categoria').order('nome').limit(1000),
  ]);
  const blocoBase = (base ?? []).map(b => `P: ${b.pergunta}\nR: ${b.resposta}`).join('\n\n');
  const porCat = new Map<string, string[]>();
  for (const p of produtos ?? []) {
    const cat = (p.categoria as string) || 'Outros';
    const linha = `- ${p.nome}: R$ ${Number(p.preco_venda).toFixed(2).replace('.', ',')} / ${p.unidade_venda || 'un'}${p.medidas ? ` — medidas: ${p.medidas}` : ''}${p.tipo_estoque === 'sob_demanda' ? ' (sob demanda: vem do fornecedor quando vende)' : ''}`;
    porCat.set(cat, [...(porCat.get(cat) ?? []), linha]);
  }
  const blocoCatalogo = [...porCat.entries()].map(([c, l]) => `${c}:\n${l.join('\n')}`).join('\n\n');
  const texto = `${REGRAS}\n\n# BASE DE CONHECIMENTO (editada pela loja)\n${blocoBase || '(vazia)'}\n\n# CATALOGO (preco de venda)\n${blocoCatalogo}`;
  cacheEstatico = { texto, quando: Date.now() };
  return texto;
}

/** Limpa o cache quando a base e editada. */
export function invalidarContextoAssistente() { cacheEstatico = null; }

let cliente: Anthropic | null = null;

/**
 * Responde a ultima mensagem do historico. Erros viram Error com mensagem em
 * pt-BR, sem detalhe interno.
 */
export async function responderAssistente(mensagens: MensagemAssistente[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Assistente sem chave da IA configurada.');
  if (!cliente) cliente = new Anthropic({ maxRetries: 2 });
  const historico = mensagens.slice(-MAX_TURNOS).map(m => ({
    role: m.papel === 'usuario' ? ('user' as const) : ('assistant' as const),
    content: String(m.texto || '').slice(0, 4000),
  }));
  if (!historico.length || historico[historico.length - 1].role !== 'user') throw new Error('Mande uma pergunta.');
  const sistema = await contextoEstatico();
  const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());

  try {
    const resposta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 1500,
      // Recusa do classificador cai no modelo de reserva, sem quebrar o chat.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Hoje e ${hoje}.` },
      ],
      messages: historico,
    });
    if (resposta.stop_reason === 'refusal') return 'Não consigo responder essa pergunta. Tente perguntar de outro jeito ou confirme com o Roger.';
    const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return texto || 'Não achei uma resposta para isso. Confirme com o Roger.';
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.error('[assistente-tecnico]', status, e instanceof Error ? e.message : e);
    if (status === 429) throw new Error('O assistente está ocupado agora. Tente de novo em instantes.');
    throw new Error('Não consegui falar com a IA agora. Tente de novo.');
  }
}
