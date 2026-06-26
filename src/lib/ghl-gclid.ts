// Busca o gclid (Google Click ID) de um cliente no GHL pelo telefone.
// O gclid e capturado na landing (deposito-site) e gravado no contato GHL —
// num custom field (GHL_GCLID_FIELD_ID) e/ou na atribuicao nativa do GHL.
// Server-only. Retorna null quando o cliente nao veio de um anuncio Google
// (walk-in, organico, indicacao), caso em que nao ha conversao a enviar.

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
// Custom field "GCLID Site" (key contact.gclid_site), criado no GHL em 2026-06-16.
// Hardcoded como default seguindo o padrao do ghl/sync (todos os CF ids fixos);
// env so pra override se o campo mudar.
const GHL_GCLID_FIELD_ID = process.env.GHL_GCLID_FIELD_ID || 'iR4ASvdC2yDBSxH5ls6O';

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+55' + digits;
  return '+55' + digits;
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export async function buscarGclidPorTelefone(phone: string): Promise<string | null> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) return null;

  // 1) Acha o contato pelo telefone (mesmo lookup do ghl/sync).
  const formatted = formatPhone(phone);
  const searchResp = await fetch(
    `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(formatted)}`,
    { headers: ghlHeaders(), cache: 'no-store' },
  );
  if (!searchResp.ok) return null;
  const searchData = await searchResp.json().catch(() => null);
  const contactId = searchData?.contacts?.[0]?.id as string | undefined;
  if (!contactId) return null;

  // 2) Busca o detalhe do contato (a busca nao traz custom fields/atribuicao).
  const detResp = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(),
    cache: 'no-store',
  });
  if (!detResp.ok) return null;
  const det = await detResp.json().catch(() => null);
  const contact = det?.contact ?? det;
  if (!contact) return null;

  // 2a) Custom field dedicado ao gclid (fonte primaria, escrita pela landing).
  if (GHL_GCLID_FIELD_ID && Array.isArray(contact.customFields)) {
    const cf = contact.customFields.find(
      (f: { id?: string; value?: unknown; field_value?: unknown }) => f.id === GHL_GCLID_FIELD_ID,
    );
    const v = cf?.value ?? cf?.field_value;
    if (v && String(v).trim()) return String(v).trim();
  }

  // 2b) Fallback: atribuicao nativa do GHL (primeira ou ultima).
  const attrs = [contact.attributionSource, contact.lastAttributionSource].filter(Boolean);
  for (const a of attrs) {
    if (a?.gclid && String(a.gclid).trim()) return String(a.gclid).trim();
  }

  return null;
}
