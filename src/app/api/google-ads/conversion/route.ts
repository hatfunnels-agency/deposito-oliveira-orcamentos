import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { uploadConversaoOffline, googleAdsConfigurado } from '@/lib/google-ads';
import { buscarGclidPorTelefone } from '@/lib/ghl-gclid';

export const dynamic = 'force-dynamic';

// Status que contam como VENDA CONFIRMADA (conversao no Google Ads).
// = COMMITTED_STATUSES (src/lib/estoque-baixa.ts) MENOS 'ocorrencia'
// (e 'cancelado', que ja nao e committed). Decisao do negocio: qualquer
// pedido em Entrega Pendente ou adiante conta; ocorrencia/cancelado nao.
const STATUS_CONVERSAO = new Set([
  'entrega_pendente',
  'retirada_pendente',
  'entrega_parcial',
  'em_rota',
  'completo',
]);

export async function POST(request: NextRequest) {
  try {
    const { orcamento_id } = await request.json();
    if (!orcamento_id) {
      return NextResponse.json({ error: 'orcamento_id required' }, { status: 400 });
    }

    if (!googleAdsConfigurado()) {
      console.log('[GAds Conv] Google Ads nao configurado, skipping');
      return NextResponse.json({ skipped: true, reason: 'not configured' });
    }

    const { data: orc, error } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, status, total, clientes (telefone)')
      .eq('id', orcamento_id)
      .single();

    if (error || !orc) {
      console.log('[GAds Conv] Orcamento nao encontrado:', error);
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Cast pra any seguindo a convencao do ghl/sync (relacao clientes vem
    // como objeto/array dependendo do tipo gerado; acesso direto evita
    // ruido de tipos no build estrito).
    const o = orc as any;

    const status: string | undefined = o.status;
    if (!status || !STATUS_CONVERSAO.has(status)) {
      return NextResponse.json({ skipped: true, reason: `status '${status}' nao e conversao` });
    }

    // clientes pode vir como objeto (1:1) ou array, conforme o join.
    const clienteRel = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;
    const telefone: string | undefined = clienteRel?.telefone;
    if (!telefone) {
      return NextResponse.json({ skipped: true, reason: 'sem telefone' });
    }

    const valor = Number(o.total) || 0;
    if (valor <= 0) {
      return NextResponse.json({ skipped: true, reason: 'valor zero' });
    }

    // gclid vive no GHL (capturado na landing). Sem gclid => cliente nao veio
    // de anuncio Google; nada a enviar.
    const gclid = await buscarGclidPorTelefone(telefone);
    if (!gclid) {
      console.log('[GAds Conv] Sem gclid pro cliente, skip (origem nao-Google)');
      return NextResponse.json({ skipped: true, reason: 'sem gclid' });
    }

    const codigo: string | undefined = o.codigo;
    const r = await uploadConversaoOffline({
      gclid,
      value: valor,
      orderId: codigo || String(orcamento_id), // dedupe por pedido no Google
    });

    if (!r.ok) {
      console.log('[GAds Conv] Upload falhou (nao bloqueante):', r.detail);
      return NextResponse.json({ skipped: true, reason: r.detail });
    }

    console.log('[GAds Conv] Conversao enviada:', { pedido: codigo, valor });
    return NextResponse.json({ success: true, valor });
  } catch (e) {
    console.log('[GAds Conv] Erro (nao bloqueante):', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
