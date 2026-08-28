import { NextResponse } from 'next/server';
import { gerarContextoCliente } from '@/lib/contexto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/ia/contexto
// A IA le a conversa de WhatsApp do cliente no GHL e grava um resumo curto
// (max 2 linhas) em clientes.notas_contexto — o campo que alimenta a
// personalizacao das automacoes. Nao envia mensagem nenhuma.
//
// Auth: header x-automacao-secret === AUTOMACAO_SECRET (mesmo padrao do
// /api/ia/mensagem).
//
// Body: { telefone: string } OU { cliente_id: string }
// Resposta: { ok, cliente_id, resumo } ou { ok: false, motivo }
export async function POST(request: Request) {
  try {
    const secret = process.env.AUTOMACAO_SECRET;
    if (secret) {
      const enviado = request.headers.get('x-automacao-secret');
      if (enviado !== secret) {
        return NextResponse.json({ error: 'nao autorizado' }, { status: 401 });
      }
    }

    const body = await request.json().catch(() => ({}));
    const clienteId = body?.cliente_id ? String(body.cliente_id) : undefined;
    const telefone = body?.telefone ? String(body.telefone) : undefined;

    if (!clienteId && !telefone) {
      return NextResponse.json({ error: 'informe cliente_id ou telefone' }, { status: 400 });
    }

    const res = await gerarContextoCliente({ clienteId, telefone });
    if (!res.ok) {
      return NextResponse.json({ ok: false, cliente_id: res.clienteId || null, motivo: res.motivo }, { status: 200 });
    }
    return NextResponse.json({ ok: true, cliente_id: res.clienteId, resumo: res.resumo });
  } catch (e) {
    console.error('[IA Contexto] erro:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
