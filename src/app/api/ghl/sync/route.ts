import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || '';

// Custom Field IDs (real IDs from GHL - created 2026-03-20)
const CF = {
  CODIGO_ORCAMENTO: 'nmwA8OTohHFwYNwsvv0N',
  VALOR_ORCAMENTO: 'o2Eu29NLcAp6UFxO1jxO',
  TIPO_ENTREGA: 'BrzQYmdJtVEZSD3TdHmr',
  ENDERECO_ENTREGA: 'g5ZuQJ4wBls18wgyLMAC',
  DATA_ENTREGA: 'Ht6hgx1EKBftCh3Li4Ez',
  PRODUTOS_COMPRADOS: 'Igz2ZiooEMTyJxreII3j',
  CANAL_VENDA: 'zfpoING1i7mMHFpDOrfE',
  STATUS_PEDIDO: 'ZxczwCP5n1hdUUBs66ae',
  TOTAL_COMPRAS: 's2Pk4mKg28zZLXQlFJBt',
  QTD_COMPRAS: 'NVL8eskm7MDel5Bta1w6',
  ULTIMA_COMPRA: 'hpRbFo0KKdTH0aS6ylH5',
  MOTORISTA: 'mCkC4H8dZEnrPizlbqt3',
  OBSERVACOES_PEDIDO: 'HuMvrs5SIlk0aEvLQ5NO',
  DATA_RETIRADA: '1XH7O5PYyAEn41FnIrOT',
};

// Status to Pipeline Stage mapping (env vars set in Vercel)
// orcamento -> Stage "Or\u00e7amento Enviado"
// entrega_pendente -> Stage "Entrega Pendente"
// em_rota -> Stage "Em Rota"
// completo -> Stage "Completo"
// ocorrencia + cancelado: treated via tags only (no stage)
const STATUS_TO_STAGE: Record<string, string> = {
  'orcamento': process.env.GHL_STAGE_ORCAMENTO || '',
  'entrega_pendente': process.env.GHL_STAGE_ENTREGA || '',
  'em_rota': process.env.GHL_STAGE_EM_ROTA || '',
  'completo': process.env.GHL_STAGE_COMPLETO || '',
};

// Status to Tag mapping
const STATUS_TO_TAG: Record<string, string> = {
  'orcamento': 'status:orcamento',
  'entrega_pendente': 'status:entrega-pendente',
  'em_rota': 'status:em-rota',
  'completo': 'status:completo',
  'ocorrencia': 'status:ocorrencia',
  'cancelado': 'status:cancelado',
};

// Canal to Tag mapping
const CANAL_TO_TAG: Record<string, string> = {
  'Ponto (presencial)': 'canal:ponto',
  'WhatsApp organico': 'canal:whatsapp',
  'Google Ads': 'canal:google-ads',
  'Google Meu Negocio (GMN)': 'canal:gmn',
  'Prospeccao (equipe)': 'canal:prospeccao',
  'Indicacao': 'canal:indicacao',
  'Redes Sociais': 'canal:redes-sociais',
  'Retorno / Recompra': 'canal:retorno',
};

function gerarTagsProduto(itens: any[]): string[] {
  const tags = new Set<string>();
  itens.forEach(item => {
    const nome = (item.produto_nome || item.produto?.nome || item.descricao || '').toLowerCase();
    if (nome.includes('areia')) tags.add('produto:areia');
    if (nome.includes('cimento')) tags.add('produto:cimento');
    if (nome.includes('pedra') || nome.includes('pedrisco') || nome.includes('p\u00f3')) tags.add('produto:pedra');
    if (nome.includes('ferro') || nome.includes('barra') || nome.includes('viga')) tags.add('produto:ferro');
    if (nome.includes('tijolo')) tags.add('produto:tijolo');
    if (nome.includes('telha')) tags.add('produto:telha');
    if (nome.includes('prego') || nome.includes('parafuso') || nome.includes('arame')) tags.add('produto:fixacao');
    if (
      nome.includes('madeira') || nome.includes('cambar') || nome.includes('pinus') ||
      nome.includes('t\u00e1bua') || nome.includes('tabua') || nome.includes('sarrafo') ||
      nome.includes('pontalete') || nome.includes('madeirit') || nome.includes('rip\u00e3o') ||
      nome.includes('ripao') || nome.includes('prancha') || nome.includes('caibr')
    ) tags.add('produto:madeira');
  });
  return Array.from(tags);
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+55' + digits;
  return '+55' + digits;
}

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function lookupContact(phone: string): Promise<string | null> {
  const formatted = formatPhone(phone);
  const headers = ghlHeaders();
  const resp = await fetch(
    `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(formatted)}`,
    { headers, cache: 'no-store' }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const contacts = data.contacts || [];
  return contacts.length > 0 ? contacts[0].id : null;
}

async function createContact(orcamento: any, cliente: any, itens: any[]): Promise<string | null> {
  const headers = ghlHeaders();
  const statusTag = STATUS_TO_TAG[orcamento.status];
  const canalTag = orcamento.fonte ? CANAL_TO_TAG[orcamento.fonte] : null;
  const produtoTags = gerarTagsProduto(itens);
  const tags = [statusTag, canalTag, ...produtoTags].filter(Boolean) as string[];

  const produtosList = itens.map((it: any) =>
    it.produto_nome + (it.quantidade ? ' x' + it.quantidade : '')
  ).filter(Boolean).join(', ');

  const enderecoEntrega = cliente.endereco
    ? `${cliente.endereco}${cliente.numero ? ', ' + cliente.numero : ''}${cliente.bairro ? ' - ' + cliente.bairro : ''}`
    : '';

  const body = {
    locationId: GHL_LOCATION_ID,
    firstName: cliente.nome?.split(' ')[0] || 'Cliente',
    lastName: cliente.nome?.split(' ').slice(1).join(' ') || '',
    phone: formatPhone(cliente.telefone || ''),
    address1: cliente.endereco || '',
    city: cliente.cidade || '',
    state: cliente.estado || '',
    postalCode: cliente.cep || '',
    source: 'Dep\u00f3sito Oliveira',
    tags,
    customFields: [
      { id: CF.CODIGO_ORCAMENTO, value: orcamento.codigo || '' },
      { id: CF.VALOR_ORCAMENTO, value: String(orcamento.total || 0) },
      { id: CF.TIPO_ENTREGA, value: orcamento.tipo_entrega || '' },
      { id: CF.ENDERECO_ENTREGA, value: enderecoEntrega },
      { id: CF.STATUS_PEDIDO, value: orcamento.status || '' },
      { id: CF.CANAL_VENDA, value: orcamento.fonte || '' },
      { id: CF.OBSERVACOES_PEDIDO, value: orcamento.observacoes || '' },
      { id: CF.DATA_ENTREGA, value: orcamento.data_entrega || '' },
      { id: CF.DATA_RETIRADA, value: orcamento.data_retirada || '' },
      { id: CF.PRODUTOS_COMPRADOS, value: produtosList },
    ].filter(f => f.value),
  };

  const resp = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const createData = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (createData?.meta?.contactId) {
      console.log('[GHL] Contact already exists:', createData.meta.contactId);
      return createData.meta.contactId;
    }
    console.log('[GHL] Create contact error:', JSON.stringify(createData));
    return null;
  }
  return createData?.contact?.id || null;
}

async function updateContact(contactId: string, orcamento: any, cliente: any, itens: any[]): Promise<void> {
  const headers = ghlHeaders();
  const statusTag = STATUS_TO_TAG[orcamento.status];
  const canalTag = orcamento.fonte ? CANAL_TO_TAG[orcamento.fonte] : null;
  const produtoTags = gerarTagsProduto(itens);
  const tags = [statusTag, canalTag, ...produtoTags].filter(Boolean) as string[];

  const produtosList = itens.map((it: any) =>
    it.produto_nome + (it.quantidade ? ' x' + it.quantidade : '')
  ).filter(Boolean).join(', ');

  const enderecoEntrega = cliente?.endereco
    ? `${cliente.endereco}${cliente.numero ? ', ' + cliente.numero : ''}${cliente.bairro ? ' - ' + cliente.bairro : ''}`
    : '';

  const body = {
    tags,
    customFields: [
      { id: CF.STATUS_PEDIDO, value: orcamento.status || '' },
      { id: CF.VALOR_ORCAMENTO, value: String(orcamento.total || 0) },
      { id: CF.TIPO_ENTREGA, value: orcamento.tipo_entrega || '' },
      { id: CF.DATA_ENTREGA, value: orcamento.data_entrega || '' },
      { id: CF.DATA_RETIRADA, value: orcamento.data_retirada || '' },
      { id: CF.OBSERVACOES_PEDIDO, value: orcamento.observacoes || '' },
      { id: CF.CODIGO_ORCAMENTO, value: orcamento.codigo || '' },
      { id: CF.PRODUTOS_COMPRADOS, value: produtosList },
      { id: CF.ENDERECO_ENTREGA, value: enderecoEntrega },
    ].filter(f => f.value),
  };

  await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

async function createOrUpdateOpportunity(contactId: string, orcamento: any, clienteNome: string): Promise<void> {
  const headers = ghlHeaders();
  const stageId = STATUS_TO_STAGE[orcamento.status] || STATUS_TO_STAGE['orcamento'] || '';

  // Search for existing opportunity by contact
  const searchResp = await fetch(
    `${GHL_API_BASE}/opportunities/search?pipeline_id=${GHL_PIPELINE_ID}&location_id=${GHL_LOCATION_ID}&contact_id=${contactId}`,
    { headers, cache: 'no-store' }
  );

  let existingOppId: string | null = null;
  if (searchResp.ok) {
    const data = await searchResp.json();
    const opps = data.opportunities || [];
    const match = opps.find((o: any) => o.name?.includes(orcamento.codigo));
    if (match) existingOppId = match.id;
  }

  const oppStatus = orcamento.status === 'completo' ? 'won'
    : orcamento.status === 'cancelado' ? 'lost'
    : 'open';

  const oppName = `${orcamento.codigo || 'ORD'} \u2014 ${clienteNome} \u2014 R$ ${(orcamento.total || 0).toLocaleString('pt-BR')}`;

  if (existingOppId) {
    await fetch(`${GHL_API_BASE}/opportunities/${existingOppId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        pipelineStageId: stageId,
        status: oppStatus,
        monetaryValue: orcamento.total || 0,
        name: oppName,
      }),
      cache: 'no-store',
    });
  } else {
    await fetch(`${GHL_API_BASE}/opportunities/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: stageId,
        locationId: GHL_LOCATION_ID,
        contactId,
        name: oppName,
        status: oppStatus,
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
      console.log('[GHL Sync] Missing credentials, skipping');
      return NextResponse.json({ skipped: true });
    }

    const { data: orcamento, error } = await supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, status, tipo_entrega, total, fonte, observacoes,
        data_entrega, data_retirada,
        clientes (id, nome, telefone, cep, endereco, numero, bairro, cidade, estado),
        orcamento_itens (id, quantidade, produto_nome)
      `)
      .eq('id', orcamento_id)
      .single();

    if (error || !orcamento) {
      console.log('[GHL Sync] Orcamento not found:', error);
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const cliente = (orcamento as any).clientes;
    const itens = (orcamento as any).orcamento_itens || [];

    if (!cliente?.telefone) {
      console.log('[GHL Sync] No phone, skipping');
      return NextResponse.json({ skipped: true, reason: 'no phone' });
    }

    let contactId = await lookupContact(cliente.telefone);
    if (contactId) {
      await updateContact(contactId, orcamento, cliente, itens);
    } else {
      contactId = await createContact(orcamento, cliente, itens);
    }

    if (!contactId) {
      console.log('[GHL Sync] Failed to get/create contact');
      return NextResponse.json({ skipped: true, reason: 'contact failed' });
    }

    if (GHL_PIPELINE_ID) {
      await createOrUpdateOpportunity(contactId, orcamento, cliente.nome || 'Cliente');
    }

    console.log('[GHL Sync] Success - contact:', contactId);
    return NextResponse.json({ success: true, contactId });

  } catch (error) {
    console.log('[GHL Sync] Error (non-blocking):', error);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
