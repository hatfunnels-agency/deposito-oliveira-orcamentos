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
      body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
      cache: 'no-store',
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, motivo: `GHL ${resp.status}: ${txt.slice(0, 300)}` };
  }
  return { ok: true };
}
