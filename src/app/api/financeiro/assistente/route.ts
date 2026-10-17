import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { exigirPapel } from '@/lib/auth-admin';
import { ErroAssistente, montarMensagens, responder, type EventoAssistente, type MensagemChat } from '@/lib/financeiro/assistente';

export const dynamic = 'force-dynamic';
// Varias idas ao modelo + consultas pesadas (fechamento, panorama).
export const maxDuration = 300;

const MAX_MENSAGENS = 40;
const MAX_CARACTERES = 8000;

// POST /api/financeiro/assistente
//   { mensagens: [{ papel: 'usuario' | 'assistente', texto }] }
// Resposta: text/event-stream, uma linha `data: <json>` por EventoAssistente
// (ferramentas | texto | reiniciar | fim) ou { tipo: 'erro', mensagem }.
export async function POST(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'o assistente');
  if (negado) return negado;

  const corpo = await request.json().catch(() => null) as { mensagens?: unknown } | null;
  const lista = Array.isArray(corpo?.mensagens) ? corpo!.mensagens as unknown[] : null;
  if (!lista || !lista.length) return NextResponse.json({ error: 'Mande uma pergunta.' }, { status: 400 });
  const historico: MensagemChat[] = lista.slice(-MAX_MENSAGENS).map(m => {
    const x = (m ?? {}) as { papel?: unknown; texto?: unknown };
    return { papel: x.papel === 'assistente' ? 'assistente' : 'usuario', texto: String(x.texto ?? '').slice(0, MAX_CARACTERES) };
  });
  try {
    montarMensagens(historico);
  } catch (e) {
    const status = e instanceof ErroAssistente ? e.status : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pergunta inválida.' }, { status });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Assistente sem chave da IA configurada.' }, { status: 503 });
  }

  const codificador = new TextEncoder();
  const corpoStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (e: EventoAssistente | { tipo: 'erro'; mensagem: string }) => {
        try { controller.enqueue(codificador.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* cliente saiu */ }
      };
      try {
        await responder(historico, enviar, request.signal);
      } catch (e) {
        if (!request.signal.aborted) {
          console.error('[financeiro/assistente] erro:', e);
          enviar({ tipo: 'erro', mensagem: mensagemDeErro(e) });
        }
      } finally {
        try { controller.close(); } catch { /* ja fechado */ }
      }
    },
  });

  return new Response(corpoStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroAssistente) return e.message;
  if (e instanceof Anthropic.RateLimitError) return 'Muitas perguntas seguidas. Espere um minuto e tente de novo.';
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'A chave da IA não foi aceita. Avise o suporte.';
  if (e instanceof Anthropic.BadRequestError) return 'A pergunta não pôde ser processada. Tente reformular ou limpe a conversa.';
  if (e instanceof Anthropic.InternalServerError) return 'O serviço de IA está instável agora. Tente de novo em instantes.';
  if (e instanceof Anthropic.APIConnectionError) return 'Sem conexão com o serviço de IA. Tente de novo.';
  if (e instanceof Anthropic.APIError) return 'O serviço de IA não respondeu. Tente de novo.';
  return 'Erro ao responder. Tente de novo.';
}
