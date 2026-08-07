import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// O dia comercial e America/Sao_Paulo (UTC-3). data_pagamento e timestamptz.
const OFFSET_BRT = 3;

/**
 * GET /api/financeiro/dia?data=2026-07-15
 *
 * O fechamento do dia em uma tela: o que o SISTEMA diz que vendeu, o que
 * o BANCO diz que entrou, e o que sobrou no CAIXA.
 *
 * As tres fontes nunca batem exatamente, e tudo bem — o util e ver a
 * diferenca e saber de onde ela vem:
 *   - dinheiro nao passa em banco (fica no caixa)
 *   - cartao liquida com atraso (venda hoje, banco depois)
 *   - venda a prazo nem entra
 * A tela mostra as tres colunas em vez de forcar um numero unico.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const hojeBrt = new Date(Date.now() - OFFSET_BRT * 3600 * 1000).toISOString().slice(0, 10);
    const data = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('data') || '') ? sp.get('data')! : hojeBrt;

    const inicioUtc = `${data}T0${OFFSET_BRT}:00:00.000Z`;
    const fimUtc = new Date(new Date(inicioUtc).getTime() + 24 * 3600 * 1000).toISOString();

    const [pagRes, lancRes, vendaRes, fechRes] = await Promise.all([
      // 1. O que o sistema recebeu no dia, por metodo.
      supabaseAdmin
        .from('pagamentos')
        .select('valor, metodo')
        .gte('data_pagamento', inicioUtc)
        .lt('data_pagamento', fimUtc),
      // 2. O que se moveu nas contas no dia.
      supabaseAdmin
        .from('lancamentos_bancarios')
        .select('valor, conta_id, origem_lancamento, descricao, contraparte, categorias_financeiras ( nome, grupo )')
        .eq('data', data),
      // 3. Pedidos criados no dia (venda, mesmo sem dinheiro ainda).
      supabaseAdmin
        .from('orcamentos')
        .select('total, status_pagamento')
        .not('status', 'in', '("orcamento","cancelado")')
        .gte('criado_em', inicioUtc)
        .lt('criado_em', fimUtc),
      supabaseAdmin.from('fechamentos_caixa').select('*').eq('data', data).maybeSingle(),
    ]);

    const { data: contas } = await supabaseAdmin
      .from('contas_financeiras')
      .select('id, nome, tipo');
    const porId = new Map((contas || []).map(c => [String(c.id), c]));
    const idCaixa = (contas || []).find(c => c.tipo === 'caixa')?.id;

    // ----- recebido no sistema, por metodo -----
    const recebido: Record<string, number> = {};
    for (const p of (pagRes.data || [])) {
      const m = String(p.metodo || 'outro');
      recebido[m] = (recebido[m] || 0) + Number(p.valor);
    }
    const totalRecebido = Object.values(recebido).reduce((a, v) => a + v, 0);

    // ----- movimento das contas -----
    const movimentoConta: Record<string, { nome: string; tipo: string; entrou: number; saiu: number }> = {};
    const saidasCaixa: Array<{ descricao: string; contraparte: string | null; valor: number; categoria: string | null }> = [];
    for (const l of (lancRes.data || [])) {
      const c = porId.get(String(l.conta_id));
      if (!c) continue;
      const k = String(l.conta_id);
      movimentoConta[k] = movimentoConta[k] || { nome: String(c.nome), tipo: String(c.tipo), entrou: 0, saiu: 0 };
      const v = Number(l.valor);
      if (v >= 0) movimentoConta[k].entrou += v; else movimentoConta[k].saiu += v;

      if (idCaixa && String(l.conta_id) === String(idCaixa) && v < 0) {
        const raw = (l as Record<string, unknown>).categorias_financeiras;
        const cat = (Array.isArray(raw) ? raw[0] : raw) as { nome?: string } | null;
        saidasCaixa.push({
          descricao: String(l.descricao || ''),
          contraparte: (l.contraparte as string | null) ?? null,
          valor: v,
          categoria: cat?.nome ?? null,
        });
      }
    }

    // ----- saldo de caixa acumulado ate o dia -----
    let saldoCaixa = 0;
    if (idCaixa) {
      const { data: ate } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .select('valor')
        .eq('conta_id', idCaixa)
        .lte('data', data);
      saldoCaixa = (ate || []).reduce((a, l) => a + Number(l.valor), 0);
    }

    // ----- vendas do dia -----
    const vendas = vendaRes.data || [];
    const vendaTotal = vendas.reduce((a, o) => a + (Number(o.total) || 0), 0);

    // Dinheiro que o sistema registrou mas ainda nao virou lancamento de
    // caixa: sinal de que falta sincronizar.
    const dinheiroSistema = recebido['dinheiro'] || 0;
    const dinheiroNoCaixa = idCaixa ? (movimentoConta[String(idCaixa)]?.entrou ?? 0) : 0;

    const entrouEmBanco = Object.entries(movimentoConta)
      .filter(([, m]) => m.tipo !== 'caixa')
      .reduce((a, [, m]) => a + m.entrou, 0);

    return NextResponse.json({
      data,
      sistema: {
        vendas_do_dia: Number(vendaTotal.toFixed(2)),
        qtd_pedidos: vendas.length,
        recebido_total: Number(totalRecebido.toFixed(2)),
        recebido_por_metodo: Object.fromEntries(
          Object.entries(recebido).map(([k, v]) => [k, Number(v.toFixed(2))])
        ),
      },
      contas: Object.values(movimentoConta).map(m => ({
        ...m,
        entrou: Number(m.entrou.toFixed(2)),
        saiu: Number(m.saiu.toFixed(2)),
      })),
      caixa: {
        entrou_no_dia: Number(dinheiroNoCaixa.toFixed(2)),
        saidas: saidasCaixa,
        total_saidas: Number(saidasCaixa.reduce((a, s) => a + s.valor, 0).toFixed(2)),
        saldo_esperado: Number(saldoCaixa.toFixed(2)),
        fechamento: fechRes.data || null,
        // Se o sistema registrou venda em dinheiro que ainda nao virou
        // lancamento de caixa, o saldo esperado esta subestimado.
        falta_sincronizar: Number((dinheiroSistema - dinheiroNoCaixa).toFixed(2)),
      },
      conferencia: {
        entrou_em_banco: Number(entrouEmBanco.toFixed(2)),
        recebido_no_sistema: Number(totalRecebido.toFixed(2)),
        nota: 'Banco e sistema divergem por natureza: dinheiro fica no caixa, cartao liquida depois e venda a prazo nem entra hoje.',
      },
    });
  } catch (e) {
    console.error('Erro em GET /api/financeiro/dia:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
