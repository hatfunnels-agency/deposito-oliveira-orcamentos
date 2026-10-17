// Saldo de cada conta e os carregadores de contas_financeiras que o resto
// da lib compartilha.
//
// Banco e adquirente nao tem conector: o saldo e o ultimo informado
// (extrato ou digitado) mais uma ESTIMATIVA do que mexeu depois — linhas
// de extrato posteriores, contas pagas pela conta ainda sem linha e folha
// paga pela conta ainda sem linha. Caixa e cartao sao Σ dos lancamentos.

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import type { ContaFinanceira, LayoutConta, SaldoConta, TipoConta } from './tipos';
import { arred2, diasEntre, ehData, hojeSP } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';

type Row = Record<string, any>;

/**
 * Filtro `.or(...)` que pega linha vinda de arquivo/conector. Linhas
 * importadas antes da coluna existir ficaram com NULL, e NULL nao casa
 * com `in (...)` — por isso o `is.null` junto.
 */
export const FILTRO_ORIGEM_EXTRATO = 'origem_lancamento.in.(extrato,conector),origem_lancamento.is.null';

export async function carregarContasFinanceiras(): Promise<ContaFinanceira[]> {
  const { data, error } = await supabaseAdmin
    .from('contas_financeiras')
    .select('id, nome, tipo, layout, instituicao, dia_fechamento, dia_vencimento, ativo, ordem')
    .order('ordem')
    .order('nome');
  if (error) throw new Error(error.message);
  return ((data || []) as Row[]).map(c => ({
    id: String(c.id),
    nome: String(c.nome),
    tipo: c.tipo as TipoConta,
    layout: c.layout as LayoutConta,
    instituicao: (c.instituicao as string | null) ?? null,
    dia_fechamento: c.dia_fechamento == null ? null : Number(c.dia_fechamento),
    dia_vencimento: c.dia_vencimento == null ? null : Number(c.dia_vencimento),
    ativo: c.ativo !== false,
    ordem: Number(c.ordem) || 100,
  }));
}

/** Primeira conta ativa do tipo (ex.: o caixa em especie). */
export async function contaPorTipo(tipo: TipoConta, contas?: ContaFinanceira[]): Promise<ContaFinanceira | null> {
  const lista = contas ?? await carregarContasFinanceiras();
  return lista.find(c => c.tipo === tipo && c.ativo) ?? lista.find(c => c.tipo === tipo) ?? null;
}

interface SaldoBase { conta_id: string; data: string; saldo: number; origem: 'extrato' | 'manual' | 'conector'; criado_em: string }
// Mesma data: o digitado ganha. O extrato exportado no meio do dia traz um
// saldo parcial (o do Itau de 16/10 saiu as 14h43), e quem digita sabe o
// saldo daquele momento.
const PRIORIDADE_ORIGEM: Record<string, number> = { manual: 3, conector: 2, extrato: 1 };

/** Saldo informado mais recente por conta (maior data; empate: manual > conector > extrato). */
export async function saldosBasePorConta(ateData?: string): Promise<Map<string, SaldoBase>> {
  const rows = await lerTudo<Row>(() => {
    let q = supabaseAdmin.from('saldos_conta').select('conta_id, data, saldo, origem, criado_em');
    if (ateData) q = q.lte('data', ateData);
    return q;
  });
  const mapa = new Map<string, SaldoBase>();
  for (const r of rows) {
    const s: SaldoBase = {
      conta_id: String(r.conta_id), data: String(r.data), saldo: Number(r.saldo) || 0,
      origem: r.origem, criado_em: String(r.criado_em ?? ''),
    };
    const atual = mapa.get(s.conta_id);
    if (!atual
      || s.data > atual.data
      || (s.data === atual.data && (PRIORIDADE_ORIGEM[s.origem] ?? 0) > (PRIORIDADE_ORIGEM[atual.origem] ?? 0))
      || (s.data === atual.data && s.origem === atual.origem && s.criado_em > atual.criado_em)) {
      mapa.set(s.conta_id, s);
    }
  }
  return mapa;
}

async function idsVinculados(): Promise<{ contas: Set<string>; folha: Set<string>; vales: Set<string> }> {
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('lancamentos_bancarios')
    .select('conta_pagar_id, funcionario_pagamento_id, funcionario_vale_id')
    .or('conta_pagar_id.not.is.null,funcionario_pagamento_id.not.is.null,funcionario_vale_id.not.is.null'));
  const contas = new Set<string>(), folha = new Set<string>(), vales = new Set<string>();
  for (const r of rows) {
    if (r.conta_pagar_id) contas.add(String(r.conta_pagar_id));
    if (r.funcionario_pagamento_id) folha.add(String(r.funcionario_pagamento_id));
    if (r.funcionario_vale_id) vales.add(String(r.funcionario_vale_id));
  }
  return { contas, folha, vales };
}

export async function saldosAtuais(contasCache?: ContaFinanceira[]): Promise<SaldoConta[]> {
  const hoje = hojeSP();
  const contas = (contasCache ?? await carregarContasFinanceiras()).filter(c => c.ativo);
  const [bases, vinculados, fechamento] = await Promise.all([
    saldosBasePorConta(),
    idsVinculados(),
    supabaseAdmin.from('fechamentos_caixa').select('data, saldo_contado, criado_em').order('data', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const ultimoFechamento = fechamento.data
    ? { data: String(fechamento.data.data), saldo: Number(fechamento.data.saldo_contado) || 0, criado_em: String(fechamento.data.criado_em ?? '') }
    : null;

  const saida: SaldoConta[] = [];
  for (const c of contas) {
    const vazio: SaldoConta = {
      conta_id: c.id, nome: c.nome, tipo: c.tipo, saldo_base: null, data_base: null, origem: null,
      defasagem_dias: null, movimentos_apos_base: 0, pagos_apos_base: 0, folha_apos_base: 0,
      saldo_estimado: null, fatura_aberta: 0,
    };

    if (c.tipo === 'caixa') {
      // Base = ultima contagem fisica; depois dela, so o que foi lancado —
      // inclusive no MESMO dia, se lancado apos a contagem (venda as 18h30 com
      // caixa fechado as 18h). O ajuste de diferenca daquele dia ja esta no contado.
      const hashAjuste = ultimoFechamento
        ? createHash('sha256').update(`${c.id}|caixa|ajuste:${ultimoFechamento.data}`).digest('hex').slice(0, 32)
        : null;
      const linhas = await lerTudo<Row>(() => {
        let q = supabaseAdmin.from('lancamentos_bancarios').select('valor, data, criado_em, hash_linha').eq('conta_id', c.id);
        if (ultimoFechamento) q = q.gte('data', ultimoFechamento.data);
        return q;
      });
      const mov = linhas
        .filter(l => !ultimoFechamento
          || String(l.data) > ultimoFechamento.data
          || (String(l.criado_em ?? '') > ultimoFechamento.criado_em && l.hash_linha !== hashAjuste))
        .reduce((a, l) => a + (Number(l.valor) || 0), 0);
      saida.push({
        ...vazio,
        saldo_base: ultimoFechamento ? arred2(ultimoFechamento.saldo) : null,
        data_base: ultimoFechamento?.data ?? null,
        origem: 'calculado',
        defasagem_dias: ultimoFechamento ? diasEntre(ultimoFechamento.data, hoje) : null,
        movimentos_apos_base: arred2(mov),
        saldo_estimado: arred2((ultimoFechamento?.saldo ?? 0) + mov),
      });
      continue;
    }

    if (c.tipo === 'cartao_credito') {
      // Negativo = devedor. Fatura aberta = compras ainda sem fatura gerada.
      const linhas = await lerTudo<Row>(() => supabaseAdmin
        .from('lancamentos_bancarios').select('valor, fatura_id').eq('conta_id', c.id));
      const saldo = linhas.reduce((a, l) => a + (Number(l.valor) || 0), 0);
      const aberta = linhas
        .filter(l => !l.fatura_id && Number(l.valor) < 0)
        .reduce((a, l) => a + Math.abs(Number(l.valor) || 0), 0);
      saida.push({ ...vazio, origem: 'calculado', movimentos_apos_base: arred2(saldo), saldo_estimado: arred2(saldo), fatura_aberta: arred2(aberta) });
      continue;
    }

    const base = bases.get(c.id);
    if (!base) { saida.push(vazio); continue; }

    const [linhas, contasPagas, folha, vales] = await Promise.all([
      lerTudo<Row>(() => supabaseAdmin
        .from('lancamentos_bancarios')
        .select('valor, tarifa, data, criado_em')
        .eq('conta_id', c.id)
        .or(FILTRO_ORIGEM_EXTRATO)
        .gte('data', base.data)),
      lerTudo<Row>(() => supabaseAdmin
        .from('contas_pagar')
        .select('id, valor_pago')
        .eq('conta_id', c.id)
        .eq('status', 'pago')
        .gt('data_pagamento', base.data)),
      lerTudo<Row>(() => supabaseAdmin
        .from('funcionario_pagamentos')
        .select('id, valor_liquido')
        .eq('conta_id', c.id)
        .gt('pago_em', base.data)),
      lerTudo<Row>(() => supabaseAdmin
        .from('funcionario_vales')
        .select('id, valor')
        .eq('conta_id', c.id)
        .gt('data', base.data)),
    ]);

    // Linha do mesmo dia do saldo so conta se foi importada DEPOIS dele
    // (o saldo do extrato ja a inclui quando veio no mesmo arquivo).
    const mov = linhas
      .filter(l => String(l.data) > base.data || (String(l.data) === base.data && String(l.criado_em ?? '') > base.criado_em))
      .reduce((a, l) => a + (Number(l.valor) || 0) - (Number(l.tarifa) || 0), 0);
    const pagos = contasPagas
      .filter(x => !vinculados.contas.has(String(x.id)))
      .reduce((a, x) => a + (Number(x.valor_pago) || 0), 0);
    const folhaSemLinha = folha
      .filter(x => !vinculados.folha.has(String(x.id)))
      .reduce((a, x) => a + (Number(x.valor_liquido) || 0), 0)
      + vales
        .filter(x => !vinculados.vales.has(String(x.id)))
        .reduce((a, x) => a + (Number(x.valor) || 0), 0);

    saida.push({
      ...vazio,
      saldo_base: arred2(base.saldo),
      data_base: base.data,
      origem: base.origem,
      defasagem_dias: Math.max(0, diasEntre(base.data, hoje)),
      movimentos_apos_base: arred2(mov),
      pagos_apos_base: arred2(pagos),
      folha_apos_base: arred2(folhaSemLinha),
      saldo_estimado: arred2(base.saldo + mov - pagos - folhaSemLinha),
    });
  }
  return saida;
}

/**
 * Dinheiro disponivel = banco + adquirente + caixa. Null enquanto alguma
 * conta de banco/adquirente ativa nao tiver saldo informado (somar so uma
 * parte enganaria mais do que ajudaria).
 */
export function totalDisponivel(saldos: SaldoConta[]): number | null {
  let total = 0;
  for (const s of saldos) {
    if (s.tipo === 'cartao_credito') continue;
    if (s.saldo_estimado === null) {
      if (s.tipo === 'caixa') continue;
      return null;
    }
    total += s.saldo_estimado;
  }
  return arred2(total);
}

export async function informarSaldo(conta_id: string, data: string, saldo: number, usuarioId: string | null): Promise<void> {
  if (!conta_id) throw new ErroFinanceiro(400, 'Escolha a conta.');
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida.');
  const valor = Number(saldo);
  if (!Number.isFinite(valor)) throw new ErroFinanceiro(400, 'Informe o saldo.');
  const { error } = await supabaseAdmin
    .from('saldos_conta')
    .upsert({ conta_id, data, saldo: arred2(valor), origem: 'manual' }, { onConflict: 'conta_id,data,origem' });
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'saldo', entidade_id: conta_id, acao: 'informar', depois: { data, saldo: arred2(valor), origem: 'manual' }, usuario_id: usuarioId });
}

export async function registrarSaldoExtrato(conta_id: string, data: string, saldo: number, importacao_id: string | null): Promise<void> {
  if (!ehData(data) || !Number.isFinite(Number(saldo))) return;
  const { error } = await supabaseAdmin
    .from('saldos_conta')
    .upsert({ conta_id, data, saldo: arred2(Number(saldo)), origem: 'extrato', importacao_id }, { onConflict: 'conta_id,data,origem' });
  if (error) throw new Error(error.message);
  await registrarEvento({ entidade: 'saldo', entidade_id: conta_id, acao: 'extrato', depois: { data, saldo: arred2(Number(saldo)), importacao_id } });
}
