// Helpers do GoHighLevel (LeadConnector) compartilhados pelas automacoes de
// mensagem. SERVER-ONLY — usa GHL_API_KEY (service). Nunca importar de um
// componente 'use client'.
import { supabaseAdmin } from '@/lib/supabase';
import { filtrarTagsObraAtiva } from '@/lib/tags';
import { buscarUltimaCompra } from '@/lib/cliente-tags-server';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';

// Custom Field IDs (model contact) usados nas automacoes. Criados no GHL em
// 2026-07-13. Os demais campos ficam no route de sync de orcamento.
export const GHL_CF = {
  CONTEXTO_CLIENTE: '8sHYXNHFnp8Fzfwimwh7',
  DATA_FOLLOWUP: 'gHKA47UmWDRyI2wTRrep',
} as const;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Normaliza telefone BR para o formato E.164 que o GHL usa (+55...).
export function formatPhoneBR(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return '+' + d;
  if (d.length === 11 || d.length === 10) return '+55' + d;
  return '+55' + d;
}

// Busca o contactId no GHL pelo telefone. null se nao existir / sem credencial.
export async function buscarContatoId(phone: string): Promise<string | null> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID || !phone) return null;
  const formatted = formatPhoneBR(phone);
  const resp = await fetch(
    `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(formatted)}`,
    { headers: ghlHeaders(), cache: 'no-store' },
  );
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  const contatos = data?.contacts || [];
  return contatos.length > 0 ? contatos[0].id : null;
}

// ------------------------------------------------------------------- DND
// "Nao perturbe" marcado pela atendente no CRM. Ela abre o perfil do contato
// no GHL, marca, e o sistema inteiro cala: as tres reguas de saida param e o
// robo de resposta fica mudo.
//
// Aceita TRES formas de marcar, de proposito. Quem marca isso esta atendendo
// um cliente que pediu pra parar de receber mensagem; errar a grafia de uma
// tag nao pode ser o motivo do cliente continuar recebendo.
//   1. o toggle DND nativo do contato
//   2. DND por canal em dndSettings (WhatsApp/SMS)
//   3. uma tag escrita a mao — ver TAGS_DND

const TAGS_DND = new Set([
  'naoperturbe',
  'naopertube',      // erro de digitacao comum
  'dnd',
  'naomandarmensagem',
  'naoquerreceber',
  'descadastrar',
  'optout',
]);

// Tira acento, caixa e pontuacao. "Não Perturbe", "nao-perturbe",
// "NAO_PERTURBE" e "Nao perturbe" viram todos a mesma string.
function normalizarTag(t: string): string {
  return (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// So os canais de mensagem. DND de Email ou de Call nao deve calar o
// WhatsApp — sao pedidos diferentes.
const CANAIS_DND = ['whatsapp', 'sms'];

export async function contatoEmDnd(
  contactId: string,
): Promise<{ dnd: boolean; motivo?: string }> {
  if (!GHL_API_KEY || !contactId) return { dnd: false };
  try {
    const resp = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      headers: ghlHeaders(),
      cache: 'no-store',
    });
    // Nao deu pra checar: NAO inventa DND. Silenciar o cliente por causa de
    // uma falha de rede seria pior que a mensagem a mais — e o GHL ainda
    // aplica o DND dele no envio.
    if (!resp.ok) return { dnd: false };
    const c = (await resp.json())?.contact;
    if (!c) return { dnd: false };

    if (c.dnd === true) return { dnd: true, motivo: 'DND ligado no perfil do GHL' };

    // As chaves de dndSettings vem do GHL com caixa propria ("WhatsApp"),
    // entao compara normalizado em vez de confiar na grafia.
    for (const [canal, cfg] of Object.entries(c.dndSettings || {})) {
      if (!CANAIS_DND.includes(canal.toLowerCase())) continue;
      if ((cfg as { status?: string })?.status === 'active') {
        return { dnd: true, motivo: `DND de ${canal} ligado no GHL` };
      }
    }

    const marcada = (c.tags || [])
      .map((t: string) => normalizarTag(t))
      .find((t: string) => TAGS_DND.has(t));
    if (marcada) return { dnd: true, motivo: `tag "${marcada}" no contato do GHL` };

    return { dnd: false };
  } catch {
    return { dnd: false };
  }
}

// Caminho inverso: o cliente pediu pra parar direto no WhatsApp e o robo
// registrou. Sem escrever de volta no GHL, a Mariana abre o perfil, nao ve
// nada e continua mandando mensagem na mao — o pedido do cliente valeria so
// pra automacao. Por isso a tag vai pro CRM tambem.
export async function marcarDndNoGhl(contactId: string | null): Promise<void> {
  if (!GHL_API_KEY || !contactId) return;
  try {
    await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({ tags: ['nao_perturbe'] }),
      cache: 'no-store',
    });
  } catch {
    // o registro no Supabase ja cala o sistema; o CRM e o espelho
  }
}

// Atualiza custom fields do contato (PUT — merge, nao apaga os demais campos).
export async function atualizarCamposContato(
  contactId: string,
  customFields: Array<{ id: string; value: string }>,
): Promise<void> {
  if (!GHL_API_KEY || !contactId) return;
  await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: ghlHeaders(),
    body: JSON.stringify({ customFields }),
    cache: 'no-store',
  }).catch(e => console.log('[GHL] atualizarCamposContato falhou (nao bloqueante):', e));
}

export async function adicionarTagsContato(contactId: string, tags: string[]): Promise<void> {
  if (!GHL_API_KEY || !contactId || tags.length === 0) return;
  await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ tags }),
    cache: 'no-store',
  }).catch(e => console.log('[GHL] adicionarTagsContato falhou (nao bloqueante):', e));
}

export async function removerTagsContato(contactId: string, tags: string[]): Promise<void> {
  if (!GHL_API_KEY || !contactId || tags.length === 0) return;
  await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: 'DELETE',
    headers: ghlHeaders(),
    body: JSON.stringify({ tags }),
    cache: 'no-store',
  }).catch(e => console.log('[GHL] removerTagsContato falhou (nao bloqueante):', e));
}

// Sincroniza contexto, data de follow-up e tags do cliente pro contato GHL.
// Best-effort: se o contato ainda nao existe no GHL (cliente sem orcamento
// sincronizado), sai sem erro. NAO mexe em agregados (isso e do sync de
// orcamento). `opts.removerTags` remove tags especificas (ex: tag apagada no app).
export async function sincronizarClienteGHL(
  clienteId: string,
  opts?: { removerTags?: string[] },
): Promise<{ ok: boolean; reason?: string }> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) return { ok: false, reason: 'sem credenciais' };

  const { data: cliente, error } = await supabaseAdmin
    .from('clientes')
    .select('telefone, notas_contexto, data_followup')
    .eq('id', clienteId)
    .single();
  if (error || !cliente?.telefone) return { ok: false, reason: 'cliente sem telefone' };

  const contactId = await buscarContatoId(cliente.telefone as string);
  if (!contactId) return { ok: false, reason: 'contato inexistente no GHL' };

  await atualizarCamposContato(contactId, [
    { id: GHL_CF.CONTEXTO_CLIENTE, value: (cliente.notas_contexto as string | null) || '' },
    { id: GHL_CF.DATA_FOLLOWUP, value: (cliente.data_followup as string | null) || '' },
  ]);

  if (opts?.removerTags && opts.removerTags.length > 0) {
    await removerTagsContato(contactId, opts.removerTags);
  }

  // Tags efetivas (obra_ativa filtrada pela regra de 30 dias). Aplica as ativas
  // e remove a obra_ativa do GHL quando ela expira (esta no banco mas nao efetiva).
  const { data: tagsRaw } = await supabaseAdmin
    .from('cliente_tags')
    .select('tag')
    .eq('cliente_id', clienteId);
  const ultimaCompra = await buscarUltimaCompra(clienteId);
  const tagsBanco = (tagsRaw || []) as Array<{ tag: string }>;
  const tagsEfetivas = filtrarTagsObraAtiva(tagsBanco, ultimaCompra).map(t => t.tag);
  if (tagsEfetivas.length > 0) await adicionarTagsContato(contactId, tagsEfetivas);

  const obraNoBanco = tagsBanco.some(t => t.tag === 'obra_ativa');
  if (obraNoBanco && !tagsEfetivas.includes('obra_ativa')) {
    await removerTagsContato(contactId, ['obra_ativa']);
  }

  return { ok: true };
}

// Janela de 24h do WhatsApp: so esta aberta se o CLIENTE mandou mensagem nas
// ultimas 24h. Com ela aberta a IA escreve livre; fechada, so template
// aprovado pela Meta. Retorna false em qualquer duvida (fail-safe: prefere
// mandar template a arriscar uma mensagem bloqueada).
export async function janelaAbertaEm(contactId: string): Promise<boolean> {
  if (!GHL_API_KEY || !contactId) return false;
  try {
    const busca = await fetch(
      `${GHL_API_BASE}/conversations/search?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&limit=5`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!busca.ok) return false;
    const conversas = (await busca.json())?.conversations || [];
    if (conversas.length === 0) return false;

    const limite = Date.now() - 24 * 3600_000;

    for (const conv of conversas) {
      const msgs = await fetch(
        `${GHL_API_BASE}/conversations/${conv.id}/messages?type=TYPE_WHATSAPP&limit=20`,
        { headers: ghlHeaders(), cache: 'no-store' },
      );
      if (!msgs.ok) continue;
      const lista = (await msgs.json())?.messages?.messages || [];
      for (const m of lista) {
        if (m?.direction !== 'inbound') continue;
        const quando = new Date(m?.dateAdded || m?.dateUpdated || 0).getTime();
        if (quando >= limite) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- workflows
// Por que workflow e nao template direto: a API do GHL NAO expoe endpoint de
// template de WhatsApp (so a interface, em Settings > WhatsApp > Templates),
// entao nao existe id de template pra passar em /conversations/messages.
// O caminho suportado e adicionar o contato a um workflow que tem a acao
// "enviar template X". Workflow, esse sim, tem id acessivel por API.

type Workflow = { id: string; name: string };
let cacheWorkflows: { em: number; lista: Workflow[] } | null = null;
const TTL_WORKFLOWS = 10 * 60 * 1000;

export async function listarWorkflows(forcar = false): Promise<Workflow[]> {
  if (!forcar && cacheWorkflows && Date.now() - cacheWorkflows.em < TTL_WORKFLOWS) {
    return cacheWorkflows.lista;
  }
  if (!GHL_API_KEY || !GHL_LOCATION_ID) return [];
  try {
    const resp = await fetch(
      `${GHL_API_BASE}/workflows/?locationId=${GHL_LOCATION_ID}`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!resp.ok) return cacheWorkflows?.lista || [];
    const lista = ((await resp.json())?.workflows || []).map((w: any) => ({
      id: String(w.id), name: String(w.name || ''),
    }));
    cacheWorkflows = { em: Date.now(), lista };
    return lista;
  } catch {
    return cacheWorkflows?.lista || [];
  }
}

// ISO 8601 com offset NUMERICO (-03:00). O GHL recusa com 422 o formato
// com 'Z' que o toISOString() devolve: "The event start time must be a date
// and time with timezone offset". Brasilia e UTC-3 fixo desde 2019.
function isoComOffsetBrasilia(d = new Date()): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return local.toISOString().replace(/\.\d{3}Z$/, '') + '-03:00';
}

// Coloca o contato no workflow — o workflow e quem dispara o template.
// Atencao: este endpoint exige Version: v3, diferente do resto da API (2021-07-28).
export async function adicionarAoWorkflow(
  contactId: string,
  workflowId: string,
): Promise<{ ok: boolean; motivo?: string }> {
  if (!GHL_API_KEY) return { ok: false, motivo: 'GHL_API_KEY ausente' };
  const resp = await fetch(
    `${GHL_API_BASE}/contacts/${contactId}/workflow/${workflowId}`,
    {
      method: 'POST',
      headers: { ...ghlHeaders(), Version: 'v3' },
      body: JSON.stringify({ eventStartTime: isoComOffsetBrasilia() }),
      cache: 'no-store',
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, motivo: `GHL ${resp.status}: ${txt.slice(0, 300)}` };
  }
  return { ok: true };
}

// Ultimas mensagens da conversa de WhatsApp, da mais antiga pra mais nova.
// E o que dá memoria ao robo: sem isso ele repete pergunta ja respondida.
// Mensagem que SAIU pelo nosso robo carrega meta.marketplace.appId (e o id do
// nosso app no GHL). A que a Mariana manda do painel nao tem esse campo. E a
// unica forma confiavel de saber quem esta falando — ambas vem com
// source: "app" e userId vazio, entao esses dois nao servem.
function ehMensagemDeHumano(m: any): boolean {
  if (m?.direction !== 'outbound') return false;
  return !m?.meta?.marketplace?.appId;
}

export type HistoricoConversa = {
  mensagens: Array<{ de: 'cliente' | 'nos'; texto: string; quando: string }>;
  // Quando um humano do deposito falou por ultimo. null = so o robo falou.
  humanoFalouEm: string | null;
};

export async function historicoConversa(
  contactId: string,
  limite = 20,
): Promise<HistoricoConversa> {
  const vazio: HistoricoConversa = { mensagens: [], humanoFalouEm: null };
  if (!GHL_API_KEY || !contactId) return vazio;
  try {
    const busca = await fetch(
      `${GHL_API_BASE}/conversations/search?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&limit=1`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!busca.ok) return vazio;
    const conv = ((await busca.json())?.conversations || [])[0];
    if (!conv?.id) return vazio;

    const resp = await fetch(
      `${GHL_API_BASE}/conversations/${conv.id}/messages?type=TYPE_WHATSAPP&limit=${limite}`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!resp.ok) return vazio;
    const msgs = (await resp.json())?.messages?.messages || [];

    let humanoFalouEm: string | null = null;
    for (const m of msgs) {
      if (!ehMensagemDeHumano(m)) continue;
      const q = String(m?.dateAdded || '');
      if (q && (!humanoFalouEm || q > humanoFalouEm)) humanoFalouEm = q;
    }

    const mensagens = msgs
      .filter((m: any) => (m?.body || '').trim())
      .map((m: any) => ({
        de: m.direction === 'inbound' ? ('cliente' as const) : ('nos' as const),
        texto: String(m.body).slice(0, 500),
        quando: String(m.dateAdded || ''),
      }))
      .reverse();

    return { mensagens, humanoFalouEm };
  } catch {
    return vazio;
  }
}
