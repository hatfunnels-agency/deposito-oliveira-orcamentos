import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const CHAVE_CAPACIDADE = 'ferragem_capacidade_m_dia';
const CAPACIDADE_PADRAO = 70;
// Pedidos "vivos" cuja ferragem ainda ocupa o patio.
// entrega_parcial incluido: material entregue com ferragem ainda pendente
// deve permanecer na fila de amarracao ate a ferragem ser produzida/entregue.
const STATUS_PIPELINE = ['entrega_pendente', 'entrega_parcial', 'retirada_pendente'];
const UNIDADES_METRO = ['m', 'metro', 'metros'];

// Madeira nunca conta como ferragem, mesmo com "viga"/"coluna" no nome
// (ex: "Viga Cambará"). Mesma lista/heuristica da aba Ferragens.
const FERRAGEM_EXCLUSOES = ['cambara', 'cambará', 'pinus', 'madeira', 'caibro', 'prancha', 'ripao', 'ripão', 'tabua', 'tábua', 'sarrafo', 'pontalete', 'madeirit'];
function ehPecaFerragem(nome: string): boolean {
  const n = (nome || '').toLowerCase();
  if (!n) return false;
  if (FERRAGEM_EXCLUSOES.some(e => n.includes(e))) return false;
  return n.includes('viga') || n.includes('coluna') || n.includes('ferro') || n.includes('estribo');
}

type Row = Record<string, any>;

async function lerCapacidade(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('configuracoes')
    .select('valor')
    .eq('chave', CHAVE_CAPACIDADE)
    .maybeSingle();
  const n = Number(data?.valor);
  return Number.isFinite(n) && n > 0 ? n : CAPACIDADE_PADRAO;
}

// Data do N-esimo dia util a partir de hoje (dia 1 = proximo dia util >= hoje).
// Pula domingo. Amarracao acontece de seg a sab.
function nthDiaUtil(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  let contados = 0;
  // Avanca ate ter contado n dias uteis, comecando por hoje.
  // Se hoje for domingo, o primeiro dia util e amanha (segunda).
  while (true) {
    if (d.getDay() !== 0) {
      contados++;
      if (contados >= n) break;
    }
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// GET /api/ferragem/fila[?novo_metros=120]
//
// Fila de amarracao ordenada (em producao primeiro, depois FIFO) com a data
// estimada de conclusao de cada pedido, dado quantos metros/dia o patio
// amarra. Com novo_metros, projeta quando um pedido novo desse tamanho
// ficaria pronto se entrasse agora no fim da fila.
export async function GET(request: NextRequest) {
  try {
    const capacidade = await lerCapacidade();
    const novoMetros = Number(request.nextUrl.searchParams.get('novo_metros')) || 0;

    // 1) Pedidos na fila: ferragem ainda nao pronta, pedido ainda pendente.
    const { data: pedidos, error } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, ferragem_status, data_entrega, data_retirada, criado_em, clientes ( nome )')
      .in('status', STATUS_PIPELINE)
      .or('ferragem_status.is.null,ferragem_status.eq.em_producao')
      .order('criado_em', { ascending: true })
      .limit(1000);
    if (error) throw error;

    const pedidoIds = (pedidos ?? []).map((p: Row) => p.id);
    if (pedidoIds.length === 0) {
      return NextResponse.json({
        capacidade_m_dia: capacidade,
        fila: [],
        resumo: { metros_total: 0, pedidos: 0, dias_uteis: 0, zera_em: null },
        projecao_novo_pedido: novoMetros > 0
          ? { metros: novoMetros, dias_uteis: Math.ceil(novoMetros / capacidade), data_pronta: nthDiaUtil(Math.max(1, Math.ceil(novoMetros / capacidade))).toISOString().slice(0, 10) }
          : null,
      });
    }

    // 2) Metros de ferragem por pedido = soma da quantidade das PECAS
    //    montadas (viga/coluna), que sao itens avulsos (produto_id null) em
    //    metros. E o metro linear da peca — o mesmo "70 m/dia" que o patio
    //    amarra. NAO usar ferragem_consumo: ela soma todo o ferro (barras x
    //    qtd + estribos) e so existe numa fracao dos pedidos.
    const { data: itens } = await supabaseAdmin
      .from('orcamento_itens')
      .select('orcamento_id, produto_nome, quantidade, unidade, produto_id')
      .in('orcamento_id', pedidoIds)
      .is('produto_id', null)
      .limit(100000);
    const metrosPorPedido = new Map<string, number>();
    for (const it of itens ?? []) {
      const uni = String(it.unidade ?? '').trim().toLowerCase();
      if (!UNIDADES_METRO.includes(uni)) continue;
      if (!ehPecaFerragem(String(it.produto_nome ?? ''))) continue; // exclui madeira
      const ped = it.orcamento_id as string;
      metrosPorPedido.set(ped, (metrosPorPedido.get(ped) ?? 0) + (Number(it.quantidade) || 0));
    }

    // 3) So entram na fila de amarracao os pedidos com metros medidos.
    //    Ordena: em producao primeiro, depois FIFO (criado_em ja veio asc).
    const fila = (pedidos ?? [])
      .map((p: Row) => ({
        id: p.id,
        codigo: p.codigo,
        cliente_nome: p.clientes?.nome ?? 'Sem cliente',
        ferragem_status: p.ferragem_status ?? 'pendente',
        data_entrega: p.data_entrega ?? p.data_retirada ?? null,
        metros: Math.round((metrosPorPedido.get(p.id) ?? 0) * 100) / 100,
      }))
      .filter((p) => p.metros > 0)
      .sort((a, b) => {
        const av = a.ferragem_status === 'em_producao' ? 0 : 1;
        const bv = b.ferragem_status === 'em_producao' ? 0 : 1;
        return av - bv; // estavel: mantem FIFO dentro de cada grupo
      });

    // 4) Data estimada de cada pedido pelo acumulado de metros / capacidade.
    let acumulado = 0;
    const filaComData = fila.map((p) => {
      acumulado += p.metros;
      const diasUteis = Math.max(1, Math.ceil(acumulado / capacidade));
      return {
        ...p,
        metros_acumulados: Math.round(acumulado * 100) / 100,
        dias_uteis: diasUteis,
        data_pronta: nthDiaUtil(diasUteis).toISOString().slice(0, 10),
      };
    });

    const metrosTotal = Math.round(acumulado * 100) / 100;
    const diasFila = Math.max(0, Math.ceil(metrosTotal / capacidade));

    return NextResponse.json({
      capacidade_m_dia: capacidade,
      fila: filaComData,
      resumo: {
        metros_total: metrosTotal,
        pedidos: filaComData.length,
        dias_uteis: diasFila,
        zera_em: diasFila > 0 ? nthDiaUtil(diasFila).toISOString().slice(0, 10) : null,
      },
      // Um pedido novo entraria no fim da fila: acumulado + novoMetros.
      projecao_novo_pedido: novoMetros > 0
        ? (() => {
            const dias = Math.max(1, Math.ceil((metrosTotal + novoMetros) / capacidade));
            return { metros: novoMetros, dias_uteis: dias, data_pronta: nthDiaUtil(dias).toISOString().slice(0, 10) };
          })()
        : null,
    });
  } catch (e) {
    console.error('[ferragem/fila] erro', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PATCH /api/ferragem/fila  { capacidade_m_dia: number }
// Ajusta a capacidade de amarracao (metros/dia). Admin muda quando aumentar
// a equipe/ritmo — sem deploy.
export async function PATCH(request: NextRequest) {
  try {
    const { capacidade_m_dia } = await request.json();
    const n = Number(capacidade_m_dia);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'capacidade_m_dia deve ser um numero positivo' }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from('configuracoes')
      .upsert({ chave: CHAVE_CAPACIDADE, valor: String(n), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) throw error;
    return NextResponse.json({ capacidade_m_dia: n });
  } catch (e) {
    console.error('[ferragem/fila PATCH] erro', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
