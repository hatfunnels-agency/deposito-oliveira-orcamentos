// Despesas fixas: a planilha de custos fixos dentro do banco.
//
// Todo mes as despesas com gera_conta viram contas a pagar (gerarContasDoMes,
// idempotente pela chave 'despesa_fixa:<id>:<mes>'). Provisao (gera_conta
// false: diesel, manutencao, marketing) so entra no orcado — o gasto real
// aparece pelo extrato/caixa categorizado. A folha nunca gera conta: vem de
// funcionarios (fonte 'funcionarios') e e paga em Funcionarios.

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import { brutoDoPeriodo, encargosMensais, proximoPeriodo, type Frequencia } from '@/lib/folha';
import type { ContaPagar, DespesaFixa, GeracaoMes, GrupoDespesaFixa, ItemFolhaPrevisto, TotaisDespesasFixas } from './tipos';
import { arred2, clampDiaDoMes, hojeSP, mesAnterior, mesDe, mesSP, mesesEntre, rotuloMes } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';
import { vendasDoMes } from './cmv';
import { SELECT_CONTA_PAGAR, mapearContaPagar } from './contas-pagar';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

export const GRUPOS_DESPESA: GrupoDespesaFixa[] = ['folha', 'estrutura', 'operacao', 'comercial', 'imposto_socios', 'divida', 'outro'];

interface FuncionarioRow {
  id: string; nome: string; frequencia: Frequencia; salario_mensal: number; data_admissao: string;
  data_desligamento: string | null; controle_desde: string; ativo: boolean; registrado: boolean;
}

async function carregarFuncionarios(): Promise<FuncionarioRow[]> {
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('funcionarios')
    .select('id, nome, frequencia, salario_mensal, data_admissao, data_desligamento, controle_desde, ativo, registrado')
    .order('nome'));
  return rows.map(f => ({
    id: String(f.id), nome: String(f.nome), frequencia: f.frequencia as Frequencia,
    salario_mensal: Number(f.salario_mensal) || 0, data_admissao: String(f.data_admissao),
    data_desligamento: f.data_desligamento ? String(f.data_desligamento) : null,
    controle_desde: String(f.controle_desde ?? f.data_admissao), ativo: f.ativo !== false, registrado: f.registrado === true,
  }));
}

/** Folha mensal estimada: salarios dos ativos + encargos (so dos registrados, CLT). */
function resumoFolha(funcs: FuncionarioRow[]): { funcionarios: number; salarios: number; encargos_estimados: number } {
  const ativos = funcs.filter(f => f.ativo);
  return {
    funcionarios: ativos.length,
    salarios: arred2(ativos.reduce((a, f) => a + f.salario_mensal, 0)),
    encargos_estimados: arred2(ativos.filter(f => f.registrado)
      .reduce((a, f) => a + (encargosMensais(f.salario_mensal).custo_total - f.salario_mensal), 0)),
  };
}

function mapear(r: Row, hoje: string): DespesaFixa {
  const cat = um<Row>(r.categorias_financeiras);
  const forn = um<Row>(r.fornecedores);
  const fim = r.fim ? String(r.fim) : null;
  return {
    id: String(r.id),
    nome: String(r.nome),
    grupo: r.grupo as GrupoDespesaFixa,
    categoria_id: r.categoria_id ? String(r.categoria_id) : null,
    categoria_nome: cat?.nome ? String(cat.nome) : null,
    fornecedor_id: r.fornecedor_id ? String(r.fornecedor_id) : null,
    fornecedor_nome: forn?.nome ? String(forn.nome) : null,
    tipo_valor: r.tipo_valor === 'pct_faturamento' ? 'pct_faturamento' : 'fixo',
    valor: arred2(Number(r.valor) || 0),
    percentual: r.percentual == null ? null : Number(r.percentual),
    valor_juros: arred2(Number(r.valor_juros) || 0),
    dia_vencimento: Number(r.dia_vencimento) || 5,
    inicio: String(r.inicio),
    fim,
    parcelas_total: r.parcelas_total == null ? null : Number(r.parcelas_total),
    // Meses de hoje ate o fim, inclusive (0 se ja acabou).
    parcelas_restantes: fim ? Math.max(0, mesesEntre(mesDe(hoje), mesDe(fim)) + 1) : null,
    fonte: (r.fonte as DespesaFixa['fonte']) || 'manual',
    gera_conta: r.gera_conta !== false,
    ativo: r.ativo !== false,
    observacoes: (r.observacoes as string | null) ?? null,
    ordem: Number(r.ordem) || 100,
    valor_no_mes: 0,
  };
}

const SELECT_DESPESA = '*, categorias_financeiras ( nome ), fornecedores ( nome )';

/** Valor da despesa num mes: 0 fora de [inicio, fim] ou inativa; % do faturamento do mes anterior quando for o caso. */
export function valorNoMes(d: DespesaFixa, mes: string, faturamentoMesAnterior: number): number {
  if (!d.ativo) return 0;
  if (mes < mesDe(d.inicio)) return 0;
  if (d.fim && mes > mesDe(d.fim)) return 0;
  if (d.tipo_valor === 'pct_faturamento') return arred2((Number(faturamentoMesAnterior) || 0) * (Number(d.percentual) || 0) / 100);
  return arred2(d.valor);
}

async function faturamentoAnterior(despesas: DespesaFixa[], mes: string): Promise<number> {
  if (!despesas.some(d => d.tipo_valor === 'pct_faturamento' && d.ativo)) return 0;
  return (await vendasDoMes(mesAnterior(mes))).faturamento;
}

/**
 * Lista com `valor_no_mes` ja calculado pro mes pedido. A despesa de fonte
 * 'funcionarios' nao tem valor proprio: vale a soma dos salarios ativos.
 */
export async function listarDespesasFixas(incluirInativas = false, mes: string = mesSP()): Promise<DespesaFixa[]> {
  const hoje = hojeSP();
  const [rows, funcs] = await Promise.all([
    lerTudo<Row>(() => {
      let q = supabaseAdmin.from('despesas_fixas').select(SELECT_DESPESA).order('ordem').order('nome');
      if (!incluirInativas) q = q.eq('ativo', true);
      return q;
    }),
    carregarFuncionarios(),
  ]);
  const folha = resumoFolha(funcs);
  const despesas = rows.map(r => {
    const d = mapear(r, hoje);
    if (d.fonte === 'funcionarios') {
      d.valor = folha.salarios;
      d.detalhe_folha = folha;
    }
    return d;
  });
  const fat = await faturamentoAnterior(despesas, mes);
  for (const d of despesas) d.valor_no_mes = valorNoMes(d, mes, fat);
  return despesas;
}

export function totalMensal(despesas: DespesaFixa[], mes: string, faturamentoMesAnterior: number): TotaisDespesasFixas {
  const por_grupo = Object.fromEntries(GRUPOS_DESPESA.map(g => [g, 0])) as Record<GrupoDespesaFixa, number>;
  let encargos = 0;
  for (const d of despesas) {
    const v = valorNoMes(d, mes, faturamentoMesAnterior);
    por_grupo[d.grupo] = arred2((por_grupo[d.grupo] ?? 0) + v);
    if (d.fonte === 'funcionarios' && v > 0) encargos += d.detalhe_folha?.encargos_estimados ?? 0;
  }
  const total = arred2(Object.values(por_grupo).reduce((a, v) => a + v, 0));
  return {
    mes,
    por_grupo,
    total,
    total_sem_divida: arred2(total - por_grupo.divida),
    divida: por_grupo.divida,
    folha: por_grupo.folha,
    encargos_estimados: arred2(encargos),
  };
}

/**
 * Gera as contas do mes a partir das despesas ativas com gera_conta.
 *   - chave 'despesa_fixa:<id>:<mes>' + upsert ignoreDuplicates: rodar de
 *     novo (cron diario) nao duplica;
 *   - pendente nao editada a mao acompanha valor/dia da despesa;
 *   - vencimento ja passado na PRIMEIRA geracao daquela despesa nasce com
 *     precisa_confirmacao ("ja pagou?") em vez de aparecer como atrasada.
 */
export async function gerarContasDoMes(mes: string, usuarioId: string | null): Promise<GeracaoMes> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroFinanceiro(400, 'Mês inválido (AAAA-MM).');
  const hoje = hojeSP();
  const despesas = (await listarDespesasFixas(false, mes)).filter(d => d.gera_conta && d.fonte !== 'funcionarios');
  const ignoradas_sem_valor: string[] = [];
  const candidatas = despesas.filter(d => {
    const dentro = mes >= mesDe(d.inicio) && (!d.fim || mes <= mesDe(d.fim));
    if (!dentro) return false;
    if (d.valor_no_mes <= 0) { ignoradas_sem_valor.push(d.nome); return false; }
    return true;
  });

  const existentes = await lerTudoEmLotes<Row>(candidatas.map(d => d.id), lote => supabaseAdmin
    .from('contas_pagar')
    .select('id, despesa_fixa_id, chave_recorrencia, status, valor, vencimento, editada_manualmente, competencia')
    .in('despesa_fixa_id', lote));
  const porChave = new Map(existentes.map(e => [String(e.chave_recorrencia), e]));
  const temHistorico = new Set(existentes.map(e => String(e.despesa_fixa_id)));

  const novas: Row[] = [];
  let ja_existiam = 0, atualizadas = 0, retroativas = 0;
  for (const d of candidatas) {
    const chave = `despesa_fixa:${d.id}:${mes}`;
    const vencimento = clampDiaDoMes(mes, d.dia_vencimento);
    const existente = porChave.get(chave);
    if (existente) {
      if (existente.status === 'cancelado') {
        // A chave e unica e a cancelada ocupa a vaga: despesa reativada reabre a conta.
        const { error } = await supabaseAdmin.from('contas_pagar')
          .update({ status: 'pendente', valor: d.valor_no_mes, vencimento, precisa_confirmacao: vencimento < hoje, editada_manualmente: false })
          .eq('id', existente.id);
        if (!error) atualizadas++;
        continue;
      }
      ja_existiam++;
      if (existente.status === 'pendente' && existente.editada_manualmente !== true
        && (arred2(Number(existente.valor)) !== d.valor_no_mes || String(existente.vencimento) !== vencimento)) {
        const { error } = await supabaseAdmin.from('contas_pagar').update({ valor: d.valor_no_mes, vencimento }).eq('id', existente.id);
        if (!error) atualizadas++;
      }
      continue;
    }
    const retroativa = vencimento < hoje && !temHistorico.has(d.id);
    if (retroativa) retroativas++;
    novas.push({
      descricao: `${d.nome} — ${rotuloMes(mes)}`,
      fornecedor_id: d.fornecedor_id,
      categoria_id: d.categoria_id,
      valor: d.valor_no_mes,
      vencimento,
      competencia: `${mes}-01`,
      status: 'pendente',
      despesa_fixa_id: d.id,
      chave_recorrencia: chave,
      parcela_num: d.parcelas_total ? mesesEntre(mesDe(d.inicio), mes) + 1 : null,
      parcelas_total: d.parcelas_total,
      precisa_confirmacao: retroativa,
      criado_por: usuarioId,
    });
  }

  let geradas = 0;
  if (novas.length) {
    const { data, error } = await supabaseAdmin
      .from('contas_pagar')
      .upsert(novas, { onConflict: 'chave_recorrencia', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(error.message);
    geradas = (data || []).length;
  }

  const ids = new Set(candidatas.map(d => d.id));
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('contas_pagar')
    .select(SELECT_CONTA_PAGAR)
    .gte('competencia', `${mes}-01`)
    .lte('competencia', clampDiaDoMes(mes, 31))
    .not('despesa_fixa_id', 'is', null)
    .order('vencimento'));
  const itens: ContaPagar[] = rows.filter(r => ids.has(String(r.despesa_fixa_id))).map(r => mapearContaPagar(r, hoje));

  await registrarEvento({
    entidade: 'conta_pagar', acao: 'gerar_mes',
    depois: { mes, geradas, ja_existiam, atualizadas, retroativas, ignoradas_sem_valor },
    usuario_id: usuarioId,
  });
  return { mes, geradas, ja_existiam, atualizadas, ignoradas_sem_valor, retroativas, itens };
}

/**
 * Depois de editar a despesa: as contas pendentes nao editadas a mao ganham
 * o novo valor/dia; mes fora de [inicio, fim], despesa inativada ou que
 * deixou de gerar conta -> cancela. Devolve quantas contas mudaram.
 */
export async function propagarDespesaFixa(id: string): Promise<number> {
  const todas = await listarDespesasFixas(true);
  const d = todas.find(x => x.id === id);
  if (!d) throw new ErroFinanceiro(404, 'Despesa fixa não encontrada.');
  const pendentes = await lerTudo<Row>(() => supabaseAdmin
    .from('contas_pagar')
    .select('id, valor, vencimento, competencia, editada_manualmente, chave_recorrencia')
    .eq('despesa_fixa_id', id)
    .eq('status', 'pendente'));

  const faturamentos = new Map<string, number>();
  const fatDoMes = async (mes: string) => {
    if (d.tipo_valor !== 'pct_faturamento') return 0;
    if (!faturamentos.has(mes)) faturamentos.set(mes, (await vendasDoMes(mesAnterior(mes))).faturamento);
    return faturamentos.get(mes) ?? 0;
  };

  let alteradas = 0;
  for (const c of pendentes) {
    // O mes que a despesa gerou esta na chave ('despesa_fixa:<id>:<AAAA-MM>'),
    // nao na competencia: se alguem mudou a competencia na mao, a conta
    // continua sendo daquele mes (mudar o inicio para novembro tem que
    // cancelar a de outubro, nao move-la para novembro e duplicar).
    const mesChave = /:(\d{4}-\d{2})$/.exec(String(c.chave_recorrencia ?? ''))?.[1];
    const mes = mesChave ?? mesDe(String(c.competencia));
    const fora = !d.ativo || !d.gera_conta || mes < mesDe(d.inicio) || (d.fim !== null && mes > mesDe(d.fim));
    if (fora) {
      const { error } = await supabaseAdmin.from('contas_pagar').update({ status: 'cancelado' }).eq('id', c.id);
      if (!error) alteradas++;
      continue;
    }
    if (c.editada_manualmente === true) continue;
    const valor = valorNoMes(d, mes, await fatDoMes(mes));
    const vencimento = clampDiaDoMes(mes, d.dia_vencimento);
    if (valor > 0 && (arred2(Number(c.valor)) !== valor || String(c.vencimento) !== vencimento)) {
      const { error } = await supabaseAdmin.from('contas_pagar').update({ valor, vencimento }).eq('id', c.id);
      if (!error) alteradas++;
    }
  }
  if (alteradas) await registrarEvento({ entidade: 'despesa_fixa', entidade_id: id, acao: 'propagar', depois: { alteradas } });
  return alteradas;
}

/**
 * Proximo pagamento de cada funcionario (mesmo calculo de GET /api/funcionarios):
 * bruto do proximo periodo - vales em aberto. Desligado continua ate o acerto final.
 */
export async function folhaPrevista(): Promise<{ salarios: number; encargos_estimados: number; funcionarios: number; proximos: ItemFolhaPrevisto[] }> {
  const [funcs, pags, vales] = await Promise.all([
    carregarFuncionarios(),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos').select('funcionario_id, periodo_fim').order('periodo_fim', { ascending: false })),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_vales').select('funcionario_id, valor').is('pagamento_id', null)),
  ]);
  const ultimoFim = new Map<string, string>();
  for (const p of pags) {
    const k = String(p.funcionario_id);
    if (!ultimoFim.has(k)) ultimoFim.set(k, String(p.periodo_fim));
  }
  const valesPor = new Map<string, number>();
  for (const v of vales) {
    const k = String(v.funcionario_id);
    valesPor.set(k, (valesPor.get(k) ?? 0) + (Number(v.valor) || 0));
  }

  const proximos: ItemFolhaPrevisto[] = [];
  for (const f of funcs) {
    const periodo = proximoPeriodo(f, ultimoFim.get(f.id) ?? null);
    if (!f.ativo && !(f.data_desligamento && periodo.inicio <= f.data_desligamento)) continue;
    const bruto = brutoDoPeriodo(f, periodo).valor;
    const v = arred2(valesPor.get(f.id) ?? 0);
    proximos.push({
      funcionario_id: f.id, nome: f.nome, frequencia: f.frequencia,
      periodo_inicio: periodo.inicio, periodo_fim: periodo.fim, data_pagamento: periodo.pagamento,
      bruto: arred2(bruto), vales: v, liquido: arred2(bruto - v),
    });
  }
  proximos.sort((a, b) => a.data_pagamento.localeCompare(b.data_pagamento) || a.nome.localeCompare(b.nome));
  const folha = resumoFolha(funcs);
  return { salarios: folha.salarios, encargos_estimados: folha.encargos_estimados, funcionarios: folha.funcionarios, proximos };
}
