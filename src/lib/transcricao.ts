// Transcricao de audio do WhatsApp (nota de voz) via Vercel AI Gateway.
// SERVER-ONLY.
//
// A API do Claude nao aceita audio — so texto, imagem e documento. Entao o
// audio vira texto aqui, antes de chegar no robo.
//
// Autenticacao sem chave nova: no deploy da Vercel o projeto recebe um token
// OIDC, que o AI Gateway aceita. AI_GATEWAY_API_KEY, se existir, tem
// precedencia (e o que funciona fora da Vercel).
//
// Em execucao o token NAO vem em process.env.VERCEL_OIDC_TOKEN — so no build
// e no `vercel env pull`. Na funcao ele chega no header da requisicao, e quem
// le e o getVercelOidcToken(). Ler so o env deixou toda transcricao falhando
// com "sem AI_GATEWAY_API_KEY nem VERCEL_OIDC_TOKEN" (06/10).
//
// O arquivo vem do GHL num link publico (static-assets...usercontent.site),
// testado em 28/09 — baixa direto, sem credencial.

import { getVercelOidcToken } from '@vercel/oidc';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v4/ai/transcription-model';

// whisper-1 aceita ogg/opus (formato da nota de voz do WhatsApp) e recebe um
// "prompt" com vocabulario — e o que segura jargao de obra que a transcricao
// costuma estragar ("po de pedra" virando "pode pedra", "CP2" virando "cepe
// dois"). Troque por env sem mexer no codigo.
const MODELO = process.env.TRANSCRICAO_MODELO || 'openai/whisper-1';

const VOCABULARIO =
  'Deposito Oliveira, cimento CP2, Votoran, Caue, areia fina, areia media, areia grossa, ' +
  'pedra brita, pedrisco, po de pedra, metro cubico, saco, tijolo baianao, bloco estrutural, ' +
  'canaleta, vergalhao, ferro 3/8, estribo, sapata, coluna, viga, laje, trelica, lajota, isopor, ' +
  'madeirite, pontalete, sarrafo, caibro, cambara, pinus, arame, prego, telha.';

// Nota de voz tem dezenas de KB. Isto so evita mandar um video de 50 MB.
const TAMANHO_MAXIMO = 15 * 1024 * 1024;

const TIPO_POR_EXTENSAO: Record<string, string> = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  wav: 'audio/wav',
};

export function mediaTypeDoAudio(url: string): string | null {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  return TIPO_POR_EXTENSAO[ext] || null;
}

export type Transcricao = { ok: true; texto: string } | { ok: false; motivo: string };

export async function transcreverAudio(url: string): Promise<Transcricao> {
  const mediaType = mediaTypeDoAudio(url);
  if (!mediaType) return { ok: false, motivo: 'extensao de audio desconhecida' };

  const credencial = process.env.AI_GATEWAY_API_KEY
    || await getVercelOidcToken().catch(() => '')
    || process.env.VERCEL_OIDC_TOKEN;
  if (!credencial) return { ok: false, motivo: 'sem AI_GATEWAY_API_KEY nem token OIDC da Vercel' };

  try {
    const arquivo = await fetch(url, { cache: 'no-store' });
    if (!arquivo.ok) return { ok: false, motivo: `download do audio falhou (${arquivo.status})` };
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    if (bytes.length > TAMANHO_MAXIMO) return { ok: false, motivo: 'audio grande demais' };

    const chamar = (comOpcoes: boolean) =>
      fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credencial}`,
          'ai-gateway-protocol-version': '0.0.1',
          'ai-transcription-model-specification-version': '4',
          'ai-model-id': MODELO,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: bytes.toString('base64'),
          mediaType,
          ...(comOpcoes
            ? { providerOptions: { openai: { language: 'pt', prompt: VOCABULARIO } } }
            : {}),
        }),
        cache: 'no-store',
      });

    let resp = await chamar(true);
    // As opcoes de idioma/vocabulario sao do OpenAI. Se o modelo configurado
    // for outro e recusar, tenta de novo sem elas em vez de perder o audio.
    if (resp.status === 400) resp = await chamar(false);
    if (!resp.ok) {
      const detalhe = (await resp.text().catch(() => '')).slice(0, 120);
      return { ok: false, motivo: `gateway ${resp.status} ${detalhe}`.trim() };
    }

    const texto = String((await resp.json())?.text || '').trim();
    return texto ? { ok: true, texto } : { ok: false, motivo: 'transcricao vazia' };
  } catch (e) {
    return { ok: false, motivo: `falha na transcricao: ${(e as Error).message}`.slice(0, 160) };
  }
}
