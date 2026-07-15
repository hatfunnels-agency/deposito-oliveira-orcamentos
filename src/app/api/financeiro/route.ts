import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const CENTAVO = 0.01;

// Pedidos que ainda sao proposta (ou morreram) nao geram recebivel.
const NAO_VENDA = ['orcamento', 'cancelado'];

type Row = Record<string, any>;

function diasEntre(de: string, ate: Date): number {
  const d = new Date(de);
  return Math.floor((ate.getTime() - d.getTime()) / 86_400_000);
}

// GET /api/financeiro?dias=30
//
// Contas a receber = venda confirmada com saldo em aberto (total - valor_pago).
// Inadimplente = saldo em aberto com vencimento ja passado.
//
// "Entregue e nao pago" e reportado a parte porque e o alarme de verdade:
// a mercadoria ja saiu, o dinheiro nao entrou — independente de ter prazo.
export async function GET(request: NextRequest) {
  try {
    const dias = Number(request.nextUrl.searchParams.get('dias')) || 30;
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const hoje = new Date();
    const hojeStr = hoje.toISOString().slice(0, 10);

    const [{ data: abertos, error: errAbertos }, { data: recebidos, error: errRecebidos }] =
      await Promise.all([
        supabaseAdmin
          .from('orcamentos')
          .select(`
            id, codigo, total, valor_pago, status, status_pagamento,
            condicao_pagamento, vencimento, forma_pagamento,
            entregue_sem_pagamento,
            data_entrega, data_retirada, criado_em,
            clientes ( id, nome, telefone )
          `)
          .not('status', 'in', `(${NAO_VENDA.join(',')})`)
          // So quem tem saldo. status_pagamento e derivado pelo trigger
          // ('completo' = quitado), entao isso reduz a um conjunto pequeno —
          // e evita o corte implicito de 1000 linhas do PostgREST, que
          // descartava os pedidos em aberto mais recentes (bug: financeiro
          // zerava conforme a base crescia). A checagem de saldo em JS abaixo
          // continua como rede de seguranca.
          .neq('status_pagamento', 'completo')
          .order('criado_em', { ascending: true }),

        supabaseAdmin
          .from('pagamentos')
          .select('valor, metodo, origem, data_pagamento')
          .gte('data_pagamento', desde.toISOString()),
      ]);

    if (errAbertos) throw errAbertos;
    if (errRecebidos) throw errRecebidos;

    const emAberto = (abertos ?? [])
      .map((o: Row) => {
        const saldo = Number(o.total) - Number(o.valor_pago ?? 0);
        const referencia = o.vencimento || o.data_entrega || o.data_retirada || o.criado_em;
        return {
          id: o.id,
          codigo: o.codigo,
          cliente_id: o.clientes?.id ?? null,
          cliente_nome: o.clientes?.nome ?? 'Sem cliente',
          cliente_telefone: o.clientes?.telefone ?? null,
          total: Number(o.total),
          valor_pago: Number(o.valor_pago ?? 0),
          saldo,
          status: o.status,
          status_pagamento: o.status_pagamento,
          condicao_pagamento: o.condicao_pagamento,
          vencimento: o.vencimento,
          entregue_sem_pagamento: Boolean(o.entregue_sem_pagamento),
          entregue: o.status === 'completo',
          vencido: Boolean(o.vencimento) && o.vencimento < hojeStr,
          dias_em_aberto: referencia ? Math.max(0, diasEntre(referencia, hoje)) : 0,
        };
      })
      .filter((o) => o.saldo > CENTAVO)
      .sort((a, b) => b.dias_em_aberto - a.dias_em_aberto);

    const soma = (rows: { saldo: number }[]) => rows.reduce((s, r) => s + r.saldo, 0);

    const vencidos = emAberto.filter((o) => o.vencido);
    const aVencer = emAberto.filter((o) => o.vencimento && !o.vencido);
    const semPrazo = emAberto.filter((o) => !o.vencimento);
    const entregueNaoPago = emAberto.filter((o) => o.entregue);

    // Recebido no periodo, por metodo — vem de pagamentos, nao de status.
    const porMetodo: Record<string, number> = {};
    let recebidoPeriodo = 0;
    for (const p of (recebidos ?? []) as Row[]) {
      const v = Number(p.valor);
      recebidoPeriodo += v;
      porMetodo[p.metodo] = (porMetodo[p.metodo] ?? 0) + v;
    }

    // Lacuna herdada: marcados 'parcial' antes do controle existir, sem
    // registro de quanto entrou. Precisam de triagem manual.
    const triagemParcial = (abertos ?? [])
      .filter((o: Row) => o.status_pagamento === 'parcial' && Number(o.valor_pago ?? 0) === 0)
      .map((o: Row) => ({
        id: o.id,
        codigo: o.codigo,
        cliente_nome: o.clientes?.nome ?? 'Sem cliente',
        total: Number(o.total),
      }));

    return NextResponse.json({
      periodo_dias: dias,
      resumo: {
        recebido_periodo: recebidoPeriodo,
        recebido_por_metodo: porMetodo,
        total_a_receber: soma(emAberto),
        vencido: soma(vencidos),
        a_vencer: soma(aVencer),
        sem_prazo: soma(semPrazo),
        entregue_nao_pago: soma(entregueNaoPago),
        qtd_a_receber: emAberto.length,
        qtd_vencidos: vencidos.length,
        qtd_entregue_nao_pago: entregueNaoPago.length,
      },
      em_aberto: emAberto,
      triagem_parcial: triagemParcial,
    });
  } catch (error) {
    console.error('Erro no financeiro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
