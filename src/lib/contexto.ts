// Resumo de contexto do cliente — a "quarta automacao". SERVER-ONLY.
//
// A IA le a conversa de WhatsApp do cliente no GHL e escreve um resumo de no
// maximo 2 linhas em clientes.notas_contexto (o que o cliente faz, que obra
// tem, preferencias, o que ja reclamou). E esse campo que alimenta a
// personalizacao das outras tres automacoes (via /api/ia/mensagem) e que o
// sync-cliente espelha pro custom field do GHL.
//
// NAO envia mensagem nenhuma: so le a conversa e grava no banco.
import { supabaseAdmin } from '@/lib/supabase';
import { buscarContatoId } from '@/lib/ghl';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const MAX_MENSAGENS = 30;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Candidatos de telefone (com/sem DDI 55) pra casar com clientes.telefone
// (digitos) — mesmo criterio do /api/ia/mensagem.
export function candidatosTelefone(raw: string): string[] {
  const d = (raw || '').replace(/\D/g, '');
  const set = new Set<string>();
  if (d) set.add(d);
  if (d.startsWith('55') && d.length >= 12) set.add(d.slice(2));
  if (d.length <= 11 && d) set.add('55' + d);
  return Array.from(set);
}

export type MensagemConversa = { direcao: 'cliente' | 'loja'; texto: string; quando: string };

// Ultimas mensagens de WhatsApp do contato no GHL, da mais antiga pra mais
// recente. Vazio se nao houver conversa ou credencial.
export async function buscarConversaWhatsApp(
  contactId: string,
  limite = MAX_MENSAGENS,
): Promise<MensagemConversa[]> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID || !contactId) return [];
  try {
    const busca = await fetch(
      `${GHL_API_BASE}/conversations/search?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&limit=3`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!busca.ok) return [];
    const conversas = (await busca.json())?.conversations || [];

    const saida: MensagemConversa[] = [];
    for (const conv of conversas) {
      const resp = await fetch(
        `${GHL_API_BASE}/conversations/${conv.id}/messages?type=TYPE_WHATSAPP&limit=${limite}`,
        { headers: ghlHeaders(), cache: 'no-store' },
      );
      if (!resp.ok) continue;
      const lista = (await resp.json())?.messages?.messages || [];
      for (const m of lista) {
        const texto = (m?.body || '').trim();
        if (!texto) continue;
        saida.push({
          direcao: m?.direction === 'inbound' ? 'cliente' : 'loja',
          texto: texto.slice(0, 500),
          quando: m?.dateAdded || m?.dateUpdated || '',
        });
      }
    }
    // Mais antiga primeiro, cortando no limite pelas mais recentes.
    saida.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
    return saida.slice(-limite);
  } catch {
    return [];
  }
}

export type ResultadoContexto = {
  ok: boolean;
  clienteId?: string;
  clienteNome?: string;
  telefone?: string;
  contactId?: string | null;
  resumo?: string;
  motivo?: string;
};

// Gera o resumo da conversa e grava em clientes.notas_contexto.
// Aceita cliente_id OU telefone. Dispara o sync-cliente (GHL) non-blocking.
export async function gerarContextoCliente(entrada: {
  clienteId?: string;
  telefone?: string;
}): Promise<ResultadoContexto> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, motivo: 'ANTHROPIC_API_KEY ausente' };

  // ---- resolve o cliente ----
  let query = supabaseAdmin.from('clientes').select('id, nome, telefone, notas_contexto');
  if (entrada.clienteId) {
    query = query.eq('id', entrada.clienteId);
  } else if (entrada.telefone) {
    query = query.in('telefone', candidatosTelefone(entrada.telefone));
  } else {
    return { ok: false, motivo: 'informe cliente_id ou telefone' };
  }
  const { data: cliente, error } = await query.limit(1).maybeSingle();
  if (error) return { ok: false, motivo: `erro ao buscar cliente: ${error.message}` };
  if (!cliente?.telefone) return { ok: false, motivo: 'cliente nao encontrado ou sem telefone' };

  const base: ResultadoContexto = {
    ok: false,
    clienteId: cliente.id,
    clienteNome: cliente.nome || '',
    telefone: cliente.telefone,
  };

  // ---- conversa no GHL ----
  const contactId = await buscarContatoId(cliente.telefone);
  if (!contactId) return { ...base, motivo: 'contato nao encontrado no GHL' };

  const conversa = await buscarConversaWhatsApp(contactId);
  if (conversa.length === 0) return { ...base, contactId, motivo: 'sem mensagens de WhatsApp na conversa' };

  // ---- resumo pela IA ----
  const transcricao = conversa
    .map(m => `${m.direcao === 'cliente' ? 'CLIENTE' : 'LOJA'}: ${m.texto}`)
    .join('\n');

  const system = [
    'Voce resume conversas de WhatsApp entre o Deposito Oliveira (deposito de',
    'material de construcao em Carapicuiba/SP) e um cliente. Escreva um resumo',
    'de NO MAXIMO 2 linhas, em portugues do Brasil, focado no que ajuda a',
    'personalizar as proximas mensagens: o que o cliente faz (pedreiro,',
    'construtor, reforma propria...), que obra tem em andamento, preferencias',
    '(entrega, pagamento, produtos), e o que ja reclamou. So use o que esta na',
    'conversa — nao invente nada. Responda SO com o resumo, sem prefixo.',
  ].join('\n');

  const userPrompt = [
    `Cliente: ${cliente.nome || 'sem nome'}`,
    cliente.notas_contexto ? `Resumo atual (atualize, preservando o que ainda vale): ${cliente.notas_contexto}` : '',
    '',
    'CONVERSA (mais antiga primeiro):',
    transcricao,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    console.error('[IA Contexto] Anthropic error:', err.slice(0, 300));
    return { ...base, contactId, motivo: 'erro na chamada da Anthropic' };
  }

  const resumo = ((await response.json())?.content?.[0]?.text || '').trim();
  if (!resumo) return { ...base, contactId, motivo: 'IA nao retornou resumo' };

  // ---- grava no cliente ----
  const { error: upErr } = await supabaseAdmin
    .from('clientes')
    .update({ notas_contexto: resumo })
    .eq('id', cliente.id);
  if (upErr) return { ...base, contactId, resumo, motivo: `erro ao gravar: ${upErr.message}` };

  // ---- espelha pro GHL (non-blocking, como o resto do app) ----
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
    fetch(`${appUrl}/api/ghl/sync-cliente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: cliente.id }),
      cache: 'no-store',
    }).catch(e => console.log('[GHL Sync Cliente] falha (nao bloqueante):', e));
  } catch (e) {
    console.log('[GHL Sync Cliente] falha (nao bloqueante):', e);
  }

  return { ...base, ok: true, contactId, resumo };
}
