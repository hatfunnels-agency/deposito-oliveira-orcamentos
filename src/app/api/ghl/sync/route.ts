import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || '';

// Status → Pipeline Stage mapping (fill IDs after creating pipeline in GHL)
const STATUS_TO_STAGE: Record<string, string> = {
  'orcamento': process.env.GHL_STAGE_ORCAMENTO || '',
  'pagamento_pendente': process.env.GHL_STAGE_PGTO_PENDENTE || '',
  'pagamento_ok': process.env.GHL_STAGE_PGTO_OK || '',
  'em_separacao': process.env.GHL_STAGE_SEPARACAO || '',
  'entrega_pendente': process.env.GHL_STAGE_ENTREGA_PENDENTE || '',
  'em_rota': process.env.GHL_STAGE_EM_ROTA || '',
  'completo': process.env.GHL_STAGE_COMPLETO || '',
  'ocorrencia': process.env.GHL_STAGE_OCORRENCIA || '',
  'cancelado': process.env.GHL_STAGE_CANCELADO || '',
};

// Status → Tags mapping
const STATUS_TO_TAG: Record<string, string> = {
  'orcamento': 'status:orcamento',
  'pagamento_pendente': 'status:pgto-pendente',
  'pagamento_ok': 'status:pgto-ok',
  'em_separacao': 'status:em-separacao',
  'entrega_pendente': 'status:entrega-pendente',
  'em_rota': 'status:em-rota',
  'completo': 'status:completo',
  'ocorrencia': 'status:ocorrencia',
  'cancelado': 'status:cancelado',
};

// Canal → Tag mapping
const CANAL_TO_TAG: Record<string, string> = {
  'Ponto (presencial)': 'canal:ponto',
  'WhatsApp orgânico': 'canal:whatsapp',
  'Google Ads': 'canal:google-ads',
  'Google Meu Negócio (GMN)': 'canal:gmn',
  'Prospecção (equipe)': 'canal:prospeccao',
  'Indicação': 'canal:indicacao',
  'Redes Sociais': 'canal:redes-sociais',
  'Retorno / Recompra': 'canal:retorno',
};

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+55' + digits;
  return '+55' + digits;
}

async function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function lookupContact(phone: string): Promise<string | null> {
  const formatted = formatPhone(phone);
  const headers = await ghlHeaders();
  const resp = await fetch(
    `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(formatted)}`,
    { headers, cache: 'no-store' }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const contacts = data.contacts || [];
  return contacts.length > 0 ? contacts[0].id : null;
}

async function createContact(orcamento: any, cliente: any): Promise<string | null> {
  const headers = await ghlHeaders();
  const tags = [];
  if (STATUS_TO_TAG[orcamento.status]) tags.push(STATUS_TO_TAG[orcamento.status]);
  if (orcamento.fonte && CANAL_TO_TAG[orcamento.fonte]) tags.push(CANAL_TO_TAG[orcamento.fonte]);

  const body = {
    locationId: GHL_LOCATION_ID,
    firstName: cliente.nome?.split(' ')[0] || cliente.nome || 'Cliente',
    lastName: cliente.nome?.split(' ').slice(1).join(' ') || '',
    phone: formatPhone(cliente.telefone || ''),
    address1: cliente.endereco || '',
    city: cliente.cidade || '',
    state: cliente.estado || '',
    postalCode: cliente.cep || '',
    tags,
    customFields: [
      { id: 'codigo_orcamento', value: orcamento.codigo || '' },
      { id: 'valor_orcamento', value: String(orcamento.total || 0) },
      { id: 'tipo_entrega', value: orcamento.tipo_entrega || '' },
      { id: 'endereco_entrega', value: `${cliente.endereco || ''}, ${cliente.numero || ''}`.trim() },
      { id: 'status_pedido', value: orcamento.status || '' },
      { id: 'canal_venda', value: orcamento.fonte || '' },
      { id: 'observacoes_pedido', value: orcamento.observacoes || '' },
    ].filter(f => f.value),
  };

  const resp = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.contact?.id || null;
}

async function updateContact(contactId: string, orcamento: any): Promise<void> {
  const headers = await ghlHeaders();
  const tags = [];
  // Remove old status tags, add new one
  if (STATUS_TO_TAG[orcamento.status]) tags.push(STATUS_TO_TAG[orcamento.status]);
  if (orcamento.fonte && CANAL_TO_TAG[orcamento.fonte]) tags.push(CANAL_TO_TAG[orcamento.fonte]);

  const body = {
    tags,
    customFields: [
      { id: 'status_pedido', value: orcamento.status || '' },
      { id: 'valor_orcamento', value: String(orcamento.total || 0) },
    ].filter(f => f.value),
  };

  await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

async function createOrUpdateOpportunity(contactId: string, orcamento: any): Promise<void> {
  const headers = await ghlHeaders();
  const stageId = STATUS_TO_STAGE[orcamento.status] || '';

  // Search for existing opportunity by contact
  const searchResp = await fetch(
    `${GHL_API_BASE}/opportunities/search?pipeline_id=${GHL_PIPELINE_ID}&location_id=${GHL_LOCATION_ID}&contact_id=${contactId}`,
    { headers, cache: 'no-store' }
  );

  let existingOppId: string | null = null;
  if (searchResp.ok) {
    const data = await searchResp.json();
    const opps = data.opportunities || [];
    // Find matching opportunity by orcamento code
    const match = opps.find((o: any) => o.name?.includes(orcamento.codigo));
    if (match) existingOppId = match.id;
  }

  if (existingOppId) {
    // Update existing opportunity
    await fetch(`${GHL_API_BASE}/opportunities/${existingOppId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        pipelineStageId: stageId,
        status: orcamento.status === 'completo' ? 'won' : orcamento.status === 'cancelado' ? 'lost' : 'open',
        monetaryValue: orcamento.total || 0,
      }),
      cache: 'no-store',
    });
  } else {
    // Create new opportunity
    await fetch(`${GHL_API_BASE}/opportunities/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: stageId,
        locationId: GHL_LOCATION_ID,
        contactId: contactId,
        name: orcamento.codigo || 'Orçamento',
        status: orcamento.status === 'completo' ? 'won' : orcamento.status === 'cancelado' ? 'lost' : 'open',
        monetaryValue: orcamento.total || 0,
      }),
      cache: 'no-store',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orcamento_id } = body;

    if (!orcamento_id) {
      return NextResponse.json({ error: 'orcamento_id required' }, { status: 400 });
    }

    if (!GHL_API_KEY || !GHL_LOCATION_ID) {
      console.log('[GHL Sync] API key or location ID not configured, skipping');
      return NextResponse.json({ skipped: true });
    }

    // Fetch orcamento + cliente from Supabase
    const { data: orcamento, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, status, tipo_entrega, total, fonte, observacoes,
        data_entrega, data_retirada,
        clientes (id, nome, telefone, cep, endereco, numero, cidade, estado)
      `)
      .eq('id', orcamento_id)
      .single();

    if (error || !orcamento) {
      console.log('[GHL Sync] Orçamento not found:', error);
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const cliente = (orcamento as any).clientes;
    if (!cliente?.telefone) {
      console.log('[GHL Sync] No phone number, skipping');
      return NextResponse.json({ skipped: true, reason: 'no phone' });
    }

    // Lookup or create contact
    let contactId = await lookupContact(cliente.telefone);

    if (contactId) {
      await updateContact(contactId, orcamento);
    } else {
      contactId = await createContact(orcamento, cliente);
    }

    if (!contactId) {
      console.log('[GHL Sync] Failed to get/create contact');
      return NextResponse.json({ skipped: true, reason: 'contact failed' });
    }

    // Create/update opportunity in pipeline (only if pipeline is configured)
    if (GHL_PIPELINE_ID) {
      await createOrUpdateOpportunity(contactId, orcamento);
    }

    console.log('[GHL Sync] Success - contact:', contactId);
    return NextResponse.json({ success: true, contactId });

  } catch (error) {
    // NON-BLOCKING - log but don't fail
    console.log('[GHL Sync] Error (non-blocking):', error);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
