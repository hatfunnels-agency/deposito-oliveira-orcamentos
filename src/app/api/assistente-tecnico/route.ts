import { NextRequest, NextResponse } from 'next/server';
import { responderAssistente, type MensagemAssistente } from '@/lib/assistente-tecnico';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/assistente-tecnico { mensagens: [{ papel: 'usuario'|'assistente', texto }] } -> { resposta }
// Duvidas de produto, obra e sistema para a atendente. Historico curto, so texto.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { mensagens?: MensagemAssistente[] } | null;
    const mensagens = Array.isArray(body?.mensagens) ? body!.mensagens : [];
    const validas = mensagens
      .filter(m => m && (m.papel === 'usuario' || m.papel === 'assistente') && typeof m.texto === 'string' && m.texto.trim())
      .slice(-20);
    if (!validas.length) return NextResponse.json({ error: 'Mande uma pergunta.' }, { status: 400 });
    const resposta = await responderAssistente(validas);
    return NextResponse.json({ resposta });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
