import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buscarContatoId,
  formatPhoneBR,
  janelaAbertaEm,
  adicionarAoWorkflow,
} from '@/lib/ghl';
import { resolverWorkflow } from '@/lib/automacoes';

export const dynamic = 'force-dynamic';

// POST /api/automacoes/teste-envio
// Envia UMA mensagem real para UM numero informado. Existe pra provar o
// caminho de envio antes de ligar o envio geral.
//
// Deliberadamente NAO olha AUTOMACOES_DRY_RUN: a ideia e justamente testar
// de verdade enquanto o resto do sistema segue em simulacao. Por isso as
// travas abaixo sao rigidas.
//
// Travas: exige ADMIN_API_KEY, exige telefone explicito, e nunca percorre
// base — manda pra um destinatario so, o que veio no corpo.
//
// Body: { telefone, modo: 'ia' | 'workflow', template? }
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

export async function POST(request: NextRequest) {
  const chave = process.env.ADMIN_API_KEY;
  if (!chave || request.headers.get('x-admin-key') !== chave) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const telefone = String(body?.telefone || '').replace(/\D/g, '');
  const modo = body?.modo === 'workflow' ? 'workflow' : 'ia';
  const template = String(body?.template || 'followup_dia1');

  if (telefone.length < 10) {
    return NextResponse.json({ ok: false, detalhe: 'Informe um telefone valido com DDD.' }, { status: 400 });
  }

  const contactId = await buscarContatoId(telefone);
  if (!contactId) {
    return NextResponse.json({
      ok: false,
      detalhe: `Nenhum contato com o telefone ${formatPhoneBR(telefone)} no GHL. Crie o contato antes de testar.`,
    });
  }

  let detalhe = '';
  let ok = false;
  let usado = '';

  if (modo === 'ia') {
    const aberta = await janelaAbertaEm(contactId);
    if (!aberta) {
      return NextResponse.json({
        ok: false,
        detalhe:
          'A janela de 24h esta fechada para esse contato: mensagem livre seria recusada pelo WhatsApp. ' +
          'Mande uma mensagem do seu celular para o numero do deposito e tente de novo, ou teste no modo workflow.',
      });
    }
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
    const r = await fetch(`${base}/api/ia/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-automacao-secret': process.env.AUTOMACAO_SECRET || '' },
      body: JSON.stringify({ tipo: 'followup', momento: 'quente', telefone }),
      cache: 'no-store',
    });
    const texto = r.ok ? (await r.json())?.mensagem : null;
    if (!texto) {
      return NextResponse.json({ ok: false, detalhe: `A IA nao devolveu texto (HTTP ${r.status}).` });
    }
    usado = texto;
    const envio = await fetch(`${GHL_API_BASE}/conversations/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'WhatsApp', contactId, toNumber: formatPhoneBR(telefone), message: texto,
      }),
      cache: 'no-store',
    });
    ok = envio.ok;
    detalhe = ok
      ? `Mensagem livre enviada. Texto: "${texto}"`
      : `GHL recusou (${envio.status}): ${(await envio.text().catch(() => '')).slice(0, 200)}`;
  } else {
    const wf = await resolverWorkflow(template);
    if (!wf) {
      return NextResponse.json({ ok: false, detalhe: `Sem workflow no GHL para o template ${template}.` });
    }
    usado = `${template} -> workflow "${wf.nome}"`;
    const r = await adicionarAoWorkflow(contactId, wf.id);
    ok = r.ok;
    detalhe = ok
      ? `Contato adicionado ao workflow "${wf.nome}". O template deve chegar em alguns segundos.`
      : `Falhou ao adicionar no workflow: ${r.motivo}`;
  }

  await supabaseAdmin.from('automacao_envios').insert({
    chave_dedup: `teste:${telefone}:${Date.now()}`,
    tipo: 'followup',
    momento: 'teste',
    telefone,
    ghl_contact_id: contactId,
    template_nome: modo === 'workflow' ? template : null,
    mensagem: usado,
    status: ok ? 'enviado' : 'erro',
    motivo: ok ? null : detalhe.slice(0, 300),
  });

  return NextResponse.json({ ok, modo, detalhe });
}
