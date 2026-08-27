import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buscarContatoId, formatPhoneBR, janelaAbertaEm } from '@/lib/ghl';
import {
  candidatosFollowup,
  candidatosPosvenda,
  candidatosReativacao,
  type Candidato,
} from '@/lib/automacoes';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/automacoes/tick
// Cron da Vercel (schedule em vercel.json). Auth: Bearer CRON_SECRET.
//
// SEGURANCA: sai em MODO SIMULACAO por padrao. So envia de verdade quando
// AUTOMACOES_DRY_RUN === 'false' no env. Em simulacao ele calcula tudo,
// grava em automacao_envios com status='simulado' e nao chama o WhatsApp.
//
// Escopo: ?tipos=followup,posvenda,reativacao (padrao: so followup).
// Teste:  ?telefone=11999999999 restringe o envio a um numero so.

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const LIMITE_PADRAO = 60;

type Resultado = {
  chave: string;
  tipo: string;
  momento: string;
  cliente: string;
  telefone: string;
  template: string;
  status: 'simulado' | 'enviado' | 'erro' | 'pulado';
  via: 'ia' | 'template' | '—';
  motivo?: string;
};

// Mapa nome-do-template -> id do template no GHL. Vem do env como JSON:
//   GHL_TEMPLATE_IDS={"followup_dia1":"...","followup_dia4":"..."}
function templateIds(): Record<string, string> {
  try {
    return JSON.parse(process.env.GHL_TEMPLATE_IDS || '{}');
  } catch {
    return {};
  }
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Le o contato completo pra checar DND antes de mandar qualquer coisa.
async function contatoPodeReceber(contactId: string): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const resp = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      headers: ghlHeaders(),
      cache: 'no-store',
    });
    if (!resp.ok) return { ok: true }; // nao da pra checar: segue, o GHL barra depois
    const c = (await resp.json())?.contact;
    if (c?.dnd === true) return { ok: false, motivo: 'contato em DND' };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// Copy escrita pela IA — so vale com a janela de 24h aberta.
async function copyDaIa(
  telefone: string,
  tipo: string,
  momento: string,
): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/api/ia/mensagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-automacao-secret': process.env.AUTOMACAO_SECRET || '',
      },
      body: JSON.stringify({ tipo, momento, telefone }),
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    return (await resp.json())?.mensagem || null;
  } catch {
    return null;
  }
}

// Mensagem livre (dentro da janela). Nao usa template.
async function enviarTexto(
  contactId: string,
  telefone: string,
  mensagem: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const resp = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      type: 'WhatsApp',
      contactId,
      toNumber: formatPhoneBR(telefone),
      message: mensagem,
    }),
    cache: 'no-store',
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, motivo: `GHL ${resp.status}: ${txt.slice(0, 300)}` };
  }
  return { ok: true };
}

async function enviarTemplate(
  contactId: string,
  telefone: string,
  templateNome: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const id = templateIds()[templateNome];
  if (!id) return { ok: false, motivo: `sem id configurado pro template ${templateNome}` };

  const resp = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      type: 'WhatsApp',
      contactId,
      toNumber: formatPhoneBR(telefone),
      templateId: id,
    }),
    cache: 'no-store',
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, motivo: `GHL ${resp.status}: ${txt.slice(0, 300)}` };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET nao configurada' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  const manual = request.headers.get('x-admin-key');
  const autorizado =
    auth === `Bearer ${cronSecret}` ||
    (!!process.env.ADMIN_API_KEY && manual === process.env.ADMIN_API_KEY);
  if (!autorizado) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const dryRun = process.env.AUTOMACOES_DRY_RUN !== 'false';
  const limite = Number(url.searchParams.get('limite') || LIMITE_PADRAO);
  const soTelefone = url.searchParams.get('telefone');
  const tipos = (url.searchParams.get('tipos') || 'followup')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  try {
    let candidatos: Candidato[] = [];
    if (tipos.includes('followup')) candidatos.push(...(await candidatosFollowup()));
    if (tipos.includes('posvenda')) candidatos.push(...(await candidatosPosvenda()));
    if (tipos.includes('reativacao')) candidatos.push(...(await candidatosReativacao()));

    if (soTelefone) {
      const alvo = soTelefone.replace(/\D/g, '');
      candidatos = candidatos.filter(c => c.telefone.replace(/\D/g, '').endsWith(alvo.slice(-8)));
    }

    // Tira o que ja foi processado antes (a chave e UNIQUE no banco, mas
    // filtrar aqui evita chamada desnecessaria ao GHL).
    const chaves = candidatos.map(c => c.chaveDedup);
    const jaEnviados = new Set<string>();
    for (let i = 0; i < chaves.length; i += 200) {
      const { data } = await supabaseAdmin
        .from('automacao_envios')
        .select('chave_dedup')
        .in('chave_dedup', chaves.slice(i, i + 200));
      for (const r of data || []) jaEnviados.add((r as any).chave_dedup);
    }
    candidatos = candidatos.filter(c => !jaEnviados.has(c.chaveDedup)).slice(0, limite);

    const resultados: Resultado[] = [];

    for (const c of candidatos) {
      let status: Resultado['status'] = dryRun ? 'simulado' : 'enviado';
      let via: Resultado['via'] = '—';
      let motivo: string | undefined;
      let contactId: string | null = null;
      let texto: string | null = null;

      // A busca do contato e a checagem da janela rodam tambem em simulacao —
      // e o que permite conferir a decisao (IA x template) antes de ligar.
      contactId = await buscarContatoId(c.telefone);
      if (!contactId) {
        status = 'pulado';
        motivo = 'contato nao encontrado no GHL';
      } else {
        const janelaAberta = await janelaAbertaEm(contactId);

        if (c.exigeJanelaAberta && !janelaAberta) {
          status = 'pulado';
          motivo = 'janela de 24h fechada e este momento nao tem template';
        } else if (janelaAberta) {
          via = 'ia';
          texto = await copyDaIa(c.telefone, c.iaTipo, c.iaMomento);
          if (!texto) {
            // IA indisponivel: cai pro template, se existir.
            via = c.template ? 'template' : '—';
            if (!c.template) {
              status = 'pulado';
              motivo = 'IA indisponivel e sem template de fallback';
            }
          }
        } else {
          via = 'template';
        }

        if (!dryRun && status !== 'pulado') {
          const permitido = await contatoPodeReceber(contactId);
          if (!permitido.ok) {
            status = 'pulado';
            motivo = permitido.motivo;
          } else {
            const envio =
              via === 'ia' && texto
                ? await enviarTexto(contactId, c.telefone, texto)
                : await enviarTemplate(contactId, c.telefone, c.template);
            if (!envio.ok) {
              status = 'erro';
              motivo = envio.motivo;
            }
          }
        }
      }

      // onConflict na chave: se duas execucoes correrem juntas, a segunda
      // simplesmente nao insere — nao manda duas vezes.
      await supabaseAdmin.from('automacao_envios').upsert(
        {
          chave_dedup: c.chaveDedup,
          tipo: c.tipo,
          momento: c.momento,
          cliente_id: c.clienteId,
          orcamento_id: c.orcamentoId,
          telefone: c.telefone,
          ghl_contact_id: contactId,
          template_nome: via === 'ia' ? null : c.template || null,
          mensagem: texto || c.contexto,
          status,
          motivo: motivo || null,
        },
        { onConflict: 'chave_dedup', ignoreDuplicates: true },
      );

      resultados.push({
        chave: c.chaveDedup,
        tipo: c.tipo,
        momento: c.momento,
        cliente: c.clienteNome,
        telefone: c.telefone,
        template: via === 'ia' ? '(IA — janela aberta)' : c.template,
        status,
        via,
        motivo,
      });
    }

    const porStatus = resultados.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      modo: dryRun ? 'SIMULACAO — nada foi enviado' : 'ENVIO REAL',
      tipos,
      total: resultados.length,
      porStatus,
      resultados,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'falha no tick' }, { status: 500 });
  }
}
