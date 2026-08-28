import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { candidatosTelefone, gerarContextoCliente } from '@/lib/contexto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/automacoes/tick-contexto
// Cron da Vercel (schedule em vercel.json). Auth: Bearer CRON_SECRET, ou
// x-admin-key pra disparo manual — igual ao /api/automacoes/tick.
//
// Processa os clientes com conversa nova no GHL desde a ultima execucao e
// atualiza o resumo de contexto de cada um (clientes.notas_contexto) via
// /lib/contexto. NAO envia mensagem nenhuma — so le a conversa e grava o
// resumo — por isso roda igual com AUTOMACOES_DRY_RUN ligado ou desligado.
//
// Cada cliente processado vira uma linha em automacao_envios com
// tipo='contexto' (status: concluido | pulado | erro). A chave de dedup
// inclui o dia da ultima mensagem da conversa: o mesmo cliente so e
// reprocessado quando a conversa tem coisa nova.
//
// ?lote=20 controla o tamanho do lote (padrao 20, max 50).

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const LOTE_PADRAO = 20;
const LOTE_MAX = 50;
const FALLBACK_DIAS = 7;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// lastMessageDate do GHL pode vir como epoch (ms) ou ISO.
function paraData(v: unknown): Date | null {
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string' && v) {
    const n = Number(v);
    return new Date(Number.isFinite(n) && v.length > 8 && !v.includes('-') ? n : v);
  }
  return null;
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

  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    return NextResponse.json({ error: 'GHL_API_KEY/GHL_LOCATION_ID ausentes' }, { status: 500 });
  }

  const url = new URL(request.url);
  const lote = Math.min(LOTE_MAX, Math.max(1, Number(url.searchParams.get('lote') || LOTE_PADRAO) || LOTE_PADRAO));

  try {
    // ---- desde quando: ultima execucao deste tick (fallback: 7 dias) ----
    const { data: ultima } = await supabaseAdmin
      .from('automacao_envios')
      .select('criado_em')
      .eq('tipo', 'contexto')
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    const desde = ultima?.criado_em
      ? new Date(ultima.criado_em)
      : new Date(Date.now() - FALLBACK_DIAS * 86_400_000);

    // ---- conversas com mensagem nova desde entao ----
    const busca = await fetch(
      `${GHL_API_BASE}/conversations/search?locationId=${process.env.GHL_LOCATION_ID}&limit=100&sortBy=last_message_date&sort=desc`,
      { headers: ghlHeaders(), cache: 'no-store' },
    );
    if (!busca.ok) {
      const txt = await busca.text().catch(() => '');
      return NextResponse.json(
        { error: `GHL conversations/search ${busca.status}: ${txt.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const conversas = ((await busca.json())?.conversations || []) as any[];

    const resultados: Array<{
      cliente: string;
      telefone: string;
      status: 'concluido' | 'pulado' | 'erro';
      motivo?: string;
    }> = [];
    let processados = 0;
    const clientesVistos = new Set<string>();

    for (const conv of conversas) {
      if (processados >= lote) break;

      const ultimaMsg = paraData(conv?.lastMessageDate);
      if (!ultimaMsg || Number.isNaN(ultimaMsg.getTime())) continue;
      if (ultimaMsg < desde) break; // lista vem ordenada da mais recente pra tras

      // telefone: vem na propria conversa; se faltar, busca o contato.
      let telefone: string = conv?.phone || '';
      if (!telefone && conv?.contactId) {
        const c = await fetch(`${GHL_API_BASE}/contacts/${conv.contactId}`, {
          headers: ghlHeaders(),
          cache: 'no-store',
        });
        if (c.ok) telefone = ((await c.json())?.contact?.phone as string) || '';
      }
      if (!telefone) continue;

      // casa com o cliente do sistema
      const { data: cliente } = await supabaseAdmin
        .from('clientes')
        .select('id, nome')
        .in('telefone', candidatosTelefone(telefone))
        .limit(1)
        .maybeSingle();
      if (!cliente?.id || clientesVistos.has(cliente.id)) continue;
      clientesVistos.add(cliente.id);

      // dedup: so reprocessa quando a conversa tem dia novo de mensagem
      const chave = `contexto:${cliente.id}:${ultimaMsg.toISOString().slice(0, 10)}`;
      const { data: jaFeito } = await supabaseAdmin
        .from('automacao_envios')
        .select('id')
        .eq('chave_dedup', chave)
        .limit(1)
        .maybeSingle();
      if (jaFeito) continue;

      processados++;
      let status: 'concluido' | 'pulado' | 'erro' = 'concluido';
      let motivo: string | undefined;
      let resumo: string | undefined;

      try {
        const res = await gerarContextoCliente({ clienteId: cliente.id });
        resumo = res.resumo;
        if (!res.ok) {
          status = res.motivo?.startsWith('erro') ? 'erro' : 'pulado';
          motivo = res.motivo;
        }
      } catch (e: any) {
        status = 'erro';
        motivo = e?.message || 'falha inesperada';
      }

      await supabaseAdmin.from('automacao_envios').upsert(
        {
          chave_dedup: chave,
          tipo: 'contexto',
          momento: 'resumo',
          cliente_id: cliente.id,
          telefone,
          ghl_contact_id: conv?.contactId || null,
          template_nome: null,
          mensagem: resumo || null,
          status,
          motivo: motivo || null,
        },
        { onConflict: 'chave_dedup', ignoreDuplicates: true },
      );

      resultados.push({ cliente: cliente.nome || '', telefone, status, motivo });
    }

    const porStatus = resultados.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      desde: desde.toISOString(),
      conversasOlhadas: conversas.length,
      processados,
      porStatus,
      resultados,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'falha no tick de contexto' }, { status: 500 });
  }
}
