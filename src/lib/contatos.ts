// Historico de contatos com o cliente (tabela cliente_contatos). SERVER-ONLY.
//
// Responde "quando foi o ultimo contato e do que se falou nele". A
// clientes.notas_contexto continua sendo o resumo geral do cliente; aqui fica
// cada conversa com data. Ver a migration 20261017_cliente_contatos.sql.
import { supabaseAdmin } from '@/lib/supabase';
import type { MensagemConversa } from './contexto';

export type OrigemContato = 'conversa' | 'robo' | 'atendente';
export type CanalContato = 'whatsapp' | 'ligacao' | 'loja' | 'visita' | 'outro';

export interface ContatoCliente {
  id: string;
  data: string;
  origem: OrigemContato;
  canal: CanalContato;
  resumo: string;
}

/**
 * Grava um contato. `chave` deduplica o automatico: a mesma chave para o
 * mesmo cliente nao entra duas vezes (unique parcial). Nunca lanca: contato
 * e registro de apoio, nao pode derrubar envio, tarefa ou job.
 */
export async function registrarContato(c: {
  clienteId: string; origem: OrigemContato; resumo: string;
  canal?: CanalContato; data?: string; chave?: string | null; usuarioId?: string | null;
}): Promise<void> {
  const resumo = c.resumo.trim().slice(0, 500);
  if (!c.clienteId || !resumo) return;
  try {
    const { error } = await supabaseAdmin.from('cliente_contatos').insert({
      cliente_id: c.clienteId, origem: c.origem, canal: c.canal ?? 'whatsapp', resumo,
      data: c.data ?? new Date().toISOString(), chave: c.chave ?? null, usuario_id: c.usuarioId ?? null,
    });
    if (error && error.code !== '23505') console.error('[contatos] falha ao registrar:', error.message);
  } catch (e) {
    console.error('[contatos] falha ao registrar:', e);
  }
}

export async function listarContatos(clienteId: string, limite = 20): Promise<ContatoCliente[]> {
  const { data, error } = await supabaseAdmin.from('cliente_contatos')
    .select('id, data, origem, canal, resumo')
    .eq('cliente_id', clienteId)
    .order('data', { ascending: false })
    .limit(Math.min(100, Math.max(1, limite)));
  if (error) throw new Error(error.message);
  return (data ?? []) as ContatoCliente[];
}

/** Ultimo contato de varios clientes de uma vez (tarefas, listas). */
export async function ultimosContatos(clienteIds: string[]): Promise<Map<string, ContatoCliente>> {
  const mapa = new Map<string, ContatoCliente>();
  const ids = [...new Set(clienteIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin.from('cliente_contatos')
      .select('id, cliente_id, data, origem, canal, resumo')
      .in('cliente_id', ids.slice(i, i + 200))
      .gte('data', new Date(Date.now() - 365 * 86_400_000).toISOString())
      .order('data', { ascending: false });
    for (const r of data ?? []) {
      const k = String(r.cliente_id);
      if (!mapa.has(k)) mapa.set(k, { id: r.id, data: r.data, origem: r.origem, canal: r.canal, resumo: r.resumo });
    }
  }
  return mapa;
}

// Rotulo curto do envio da regua, para o historico.
export function resumoEnvioRobo(tipo: string, momento: string | null | undefined, via: string): string {
  if (momento === 'resposta') return 'IA respondeu o cliente no WhatsApp';
  const nomes: Record<string, string> = {
    followup: 'Follow-up do orçamento', posvenda: 'Pós-venda (deu tudo certo?)', reativacao: 'Reativação',
    retorno: 'Retorno combinado', contexto: 'Resumo de contexto',
  };
  const m = momento ? ` (${momento.replace(/_/g, ' ')})` : '';
  return `${nomes[tipo] ?? tipo}${m} — mensagem automática${via === 'ia' ? ' escrita pela IA' : ''} enviada`;
}

const diaSP = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Resumo de UMA linha da conversa do dia mais recente (job diario do
 * contexto). Grava como origem 'conversa', chave conversa:AAAA-MM-DD, entao
 * rodar de novo no mesmo dia nao duplica e so chama a IA quando ha dia novo.
 */
export async function registrarUltimaConversa(clienteId: string, conversa: MensagemConversa[]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !clienteId || conversa.length === 0) return;
  try {
    const comData = conversa.filter(m => m.quando && !Number.isNaN(Date.parse(m.quando)));
    if (!comData.length) return;
    const ultimoDia = comData.map(m => diaSP(m.quando)).sort().pop()!;
    const chave = `conversa:${ultimoDia}`;
    const { data: ja } = await supabaseAdmin.from('cliente_contatos').select('id')
      .eq('cliente_id', clienteId).eq('chave', chave).limit(1);
    if (ja && ja.length) return;

    const doDia = comData.filter(m => diaSP(m.quando) === ultimoDia);
    const ultima = doDia.map(m => m.quando).sort().pop()!;
    const transcricao = doDia.map(m => `${m.direcao === 'cliente' ? 'CLIENTE' : 'LOJA'}: ${m.texto}`).join('\n').slice(0, 6000);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 120,
        system: [
          'Resuma em UMA frase curta (ate 20 palavras), em portugues do Brasil, do que se',
          'falou nesta conversa de WhatsApp entre o Deposito Oliveira e o cliente: o pedido,',
          'a duvida, o combinado ou a pendencia. So o que esta na conversa. Sem prefixo.',
        ].join(' '),
        messages: [{ role: 'user', content: transcricao }],
      }),
      cache: 'no-store',
    });
    if (!resp.ok) return;
    const resumo = ((await resp.json())?.content?.[0]?.text || '').trim();
    if (!resumo) return;
    await registrarContato({ clienteId, origem: 'conversa', canal: 'whatsapp', resumo, data: ultima, chave });
  } catch (e) {
    console.error('[contatos] resumo da conversa falhou:', e);
  }
}
