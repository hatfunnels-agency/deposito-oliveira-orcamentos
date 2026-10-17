// Lista do dia para conciliacao manual: os pedidos fechados no dia e os
// pagamentos registrados no dia (que podem ser de pedidos antigos), cada
// pagamento com a linha de extrato a que esta vinculado, se houver.
// SERVER-ONLY.

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import type { VendasDoDia } from './tipos';
import { arred2, ehData, limitesDiaUtc } from './datas';
import { ErroFinanceiro } from './eventos';

type Row = Record<string, any>;
const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const NAO_VENDA = '("orcamento","cancelado")';

export async function vendasDoDia(data: string): Promise<VendasDoDia> {
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');
  const { inicioUtc, fimUtc } = limitesDiaUtc(data);

  const [pedidos, pagamentos] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, valor_pago, status, status_pagamento, forma_pagamento, condicao_pagamento, tipo_entrega, criado_em, clientes ( nome, telefone )')
      .not('status', 'in', NAO_VENDA)
      .gte('criado_em', inicioUtc).lt('criado_em', fimUtc)
      .order('criado_em')),
    lerTudo<Row>(() => supabaseAdmin
      .from('pagamentos')
      .select('id, orcamento_id, valor, metodo, parcelas, data_pagamento, origem, observacoes, orcamentos ( codigo, criado_em, clientes ( nome ) )')
      .gte('data_pagamento', inicioUtc).lt('data_pagamento', fimUtc)
      .order('data_pagamento')),
  ]);

  // Pagamentos dos pedidos de hoje (mesmo os que cairam em outro dia) e as
  // linhas de extrato vinculadas aos pagamentos de hoje.
  const idsPedidos = pedidos.map(p => String(p.id));
  const idsPag = pagamentos.map(p => String(p.id));
  const [pagsDosPedidos, linhas] = await Promise.all([
    lerTudoEmLotes<Row>(idsPedidos, lote => supabaseAdmin.from('pagamentos').select('id, orcamento_id, valor, metodo').in('orcamento_id', lote)),
    lerTudoEmLotes<Row>(idsPag, lote => supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id, pagamento_id, data, valor, tarifa, descricao, contas_financeiras ( nome )')
      .in('pagamento_id', lote)),
  ]);
  const metodosPorPedido = new Map<string, Set<string>>();
  for (const p of pagsDosPedidos) {
    const s = metodosPorPedido.get(String(p.orcamento_id)) ?? new Set<string>();
    s.add(String(p.metodo || 'outro'));
    metodosPorPedido.set(String(p.orcamento_id), s);
  }
  const linhaPorPag = new Map(linhas.map(l => [String(l.pagamento_id), l]));

  const vendas = pedidos.map(p => {
    const cli = um<Row>(p.clientes);
    const total = Number(p.total) || 0;
    const pago = Number(p.valor_pago) || 0;
    const metodos = [...(metodosPorPedido.get(String(p.id)) ?? [])];
    return {
      id: String(p.id),
      codigo: (p.codigo as string | null) ?? null,
      hora: String(p.criado_em),
      cliente: cli?.nome ?? 'Sem cliente',
      telefone: cli?.telefone ?? null,
      total: arred2(total),
      pago: arred2(pago),
      saldo: arred2(Math.max(0, total - pago)),
      status: String(p.status),
      status_pagamento: (p.status_pagamento as string | null) ?? null,
      forma_pagamento: (p.forma_pagamento as string | null) ?? (metodos.length === 1 ? metodos[0] : metodos.length > 1 ? 'misto' : null),
      metodos_pagos: metodos,
      condicao_pagamento: (p.condicao_pagamento as string | null) ?? null,
      tipo_entrega: (p.tipo_entrega as string | null) ?? null,
    };
  });

  const recebimentos = pagamentos.map(p => {
    const ped = um<Row>(p.orcamentos);
    const l = linhaPorPag.get(String(p.id));
    const criadoPedido = ped?.criado_em ? String(ped.criado_em) : null;
    return {
      id: String(p.id),
      orcamento_id: (p.orcamento_id as string | null) ?? null,
      codigo: (ped?.codigo as string | null) ?? null,
      cliente: um<Row>(ped?.clientes)?.nome ?? '—',
      hora: String(p.data_pagamento),
      valor: arred2(Number(p.valor) || 0),
      metodo: String(p.metodo || 'outro'),
      parcelas: p.parcelas == null ? null : Number(p.parcelas),
      origem: (p.origem as string | null) ?? null,
      observacoes: (p.observacoes as string | null) ?? null,
      pedido_de_outro_dia: !!criadoPedido && (criadoPedido < inicioUtc || criadoPedido >= fimUtc),
      extrato: l ? {
        id: String(l.id), data: String(l.data), valor: arred2(Number(l.valor) || 0), tarifa: arred2(Number(l.tarifa) || 0),
        descricao: String(l.descricao || ''), conta: um<Row>(l.contas_financeiras)?.nome ?? null,
      } : null,
    };
  });

  const porMetodo: Record<string, { valor: number; qtd: number; conciliado: number }> = {};
  for (const r of recebimentos) {
    const m = porMetodo[r.metodo] ?? { valor: 0, qtd: 0, conciliado: 0 };
    m.valor = arred2(m.valor + r.valor);
    m.qtd++;
    if (r.extrato) m.conciliado = arred2(m.conciliado + r.valor);
    porMetodo[r.metodo] = m;
  }

  return {
    data,
    vendas,
    recebimentos,
    totais: {
      pedidos: vendas.length,
      faturamento: arred2(vendas.reduce((a, v) => a + v.total, 0)),
      pago_nos_pedidos: arred2(vendas.reduce((a, v) => a + v.pago, 0)),
      em_aberto: arred2(vendas.reduce((a, v) => a + v.saldo, 0)),
      recebido: arred2(recebimentos.reduce((a, r) => a + r.valor, 0)),
      recebido_conciliado: arred2(recebimentos.filter(r => r.extrato).reduce((a, r) => a + r.valor, 0)),
      por_metodo: porMetodo,
    },
  };
}
