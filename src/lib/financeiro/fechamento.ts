// Fechamento mensal em dois blocos que NAO batem por definicao:
//   Resultado (competencia): vendas por criado_em, contas por competencia,
//     folha por periodo_fim, orcado (despesas fixas) x realizado.
//   Caixa do mes (banco + adquirente): tudo por data de pagamento; saldo
//     informado no inicio e no fim pra conferir o calculado.
//
// Nada entra duas vezes no realizado: folha so de funcionario_pagamentos;
// linha de extrato categorizada 'Folha - %' e descartada (folha_ja_contada);
// linha de extrato que coincide com conta paga ou salario (+-0,01, +-3d) e
// descartada (possiveis_duplicidades); fatura de cartao (transferencia) fica
// fora; juros da divida vao pra 'taxas' e a parcela liquida pra 'divida'.

import { ehPixMaquininha, pctPixTabela, tarifaPixDaLinha } from './stone-extrato';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { normalizar } from '@/lib/categorizacao';
import type { ContaPagar, FechamentoMensal, GrupoFechamento, GrupoGestao, Reembolso, ResumoMaquininhaMes } from './tipos';
import { arred2, dataBRT, diasEntre, ehMes, hojeSP, inicioFimMes, limitesMesUtc, mesAnterior, somarDias } from './datas';
import { ErroFinanceiro } from './eventos';
import { carregarContasFinanceiras, saldosBasePorConta } from './saldos';
import { vendasDoMes } from './cmv';
import { carregarTaxas, custosDoPeriodo, resumirCustos, taxasVigentes } from './taxas';
import { contasPagasNoPeriodo, contasPagasPorCompetencia, listarContasPagar } from './contas-pagar';
import { listarDespesasFixas } from './despesas-fixas';
import { extratoAtePorConta } from './dia';
import { cartaoAgregado } from './conciliacao';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

export const ROTULOS_GRUPO: Record<GrupoGestao, string> = {
  folha: 'Folha', estrutura: 'Estrutura', operacao: 'Operação', comercial: 'Comercial', imposto_socios: 'Imposto e sócios',
  outro: 'Outros', taxas: 'Taxas e juros', divida: 'Dívida', cmv_compras: 'Compras pagas (CMV)',
};
const ORDEM: GrupoGestao[] = ['folha', 'estrutura', 'operacao', 'comercial', 'imposto_socios', 'outro', 'taxas', 'divida', 'cmv_compras'];
// Grupos que entram no lucro da operacao; divida fica abaixo, cmv_compras e so informativo.
const OPERACIONAIS: GrupoGestao[] = ['folha', 'estrutura', 'operacao', 'comercial', 'imposto_socios', 'outro', 'taxas'];
const ehFolha = (categoriaNome: string | null | undefined) => /^FOLHA - /.test(normalizar(categoriaNome));
const ehExtrato = (origem: string | null) => !origem || origem === 'extrato' || origem === 'conector';

interface Ref { data: string; valor: number }
const coincide = (refs: Ref[], data: string, valor: number) =>
  refs.some(r => Math.abs(r.valor - valor) <= 0.01 && Math.abs(diasEntre(r.data, data)) <= 3);

async function calcular(mes: string, comComparativo: boolean): Promise<FechamentoMensal> {
  const hoje = hojeSP();
  const { inicio, fim } = inicioFimMes(mes);
  const { inicioUtc, fimUtc } = limitesMesUtc(mes);
  const taxas = await carregarTaxas();
  const [vendas, custos, contas, despesas, contasComp, contasPagasMes, contasPagasRef, pendentes, linhas, folhaComp, folhaPaga, vales, reembolsos, saldosIni, saldosFim, extratoAte] = await Promise.all([
    vendasDoMes(mes),
    custosDoPeriodo(inicioUtc, fimUtc, taxas),
    carregarContasFinanceiras(),
    listarDespesasFixas(true, mes),
    contasPagasPorCompetencia(mes),
    contasPagasNoPeriodo(inicio, fim),
    // Referencia pra duplicidade com o extrato: por DATA de pagamento (que e o
    // que o extrato espelha), com folga de 3 dias nas bordas do mes.
    contasPagasNoPeriodo(somarDias(inicio, -3), somarDias(fim, 3)),
    listarContasPagar({ status: 'pendente' }),
    lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios')
      .select('id, conta_id, data, descricao, contraparte, valor, tarifa, origem_lancamento, revisado, categoria_origem, categoria_id, pagamento_id, conta_pagar_id, funcionario_pagamento_id, funcionario_vale_id, categorias_financeiras ( nome, grupo, grupo_gestao )')
      .gte('data', inicio).lte('data', fim)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos')
      .select('id, valor_liquido, total_vales, pago_em, periodo_fim, metodo, conta_id, funcionarios ( nome )').gte('periodo_fim', inicio).lte('periodo_fim', fim)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos')
      .select('id, valor_liquido, pago_em, metodo, conta_id').gte('pago_em', inicio).lte('pago_em', fim)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_vales')
      .select('id, valor, data, pagamento_id, metodo, conta_id, funcionarios ( nome )').gte('data', inicio).lte('data', fim)),
    lerTudo<Row>(() => supabaseAdmin.from('reembolsos_fornecedor').select('valor').gte('referencia', inicio).lte('referencia', fim)),
    // O saldo informado e o do FIM do dia: o inicial do mes e o da vespera.
    saldosBasePorConta(somarDias(inicio, -1)),
    saldosBasePorConta(fim),
    extratoAtePorConta(),
  ]);
  const tipoConta = new Map(contas.map(c => [c.id, c.tipo]));
  const despesaPorId = new Map(despesas.map(d => [d.id, d]));

  // ----- recebimentos e taxas -----
  const resumo = resumirCustos(custos, taxas);
  const porMetodo: Record<string, number> = {};
  let totalRecebido = 0;
  for (const { pagamento: p } of custos) {
    porMetodo[p.metodo] = arred2((porMetodo[p.metodo] ?? 0) + p.valor);
    totalRecebido += p.valor;
  }
  const linhasTransacao = linhas
    .filter(l => tipoConta.get(String(l.conta_id)) === 'adquirente' && Number(l.valor) > 0 && ehExtrato(l.origem_lancamento) && ehPixMaquininha(l.descricao));
  // custo_bruto da tabela ja traz o Pix via Stone ESTIMADO; com extrato da
  // Stone no mes a tarifa real substitui a estimativa (nunca as duas).
  const pixEstimado = custos.filter(x => x.pagamento.metodo === 'pix' && x.pagamento.via_stone).reduce((a, x) => a + x.custo.custo_bruto, 0);
  const custoCartao = resumo.custo_bruto - pixEstimado;
  const tarifaPix = linhasTransacao.length
    ? arred2(linhasTransacao.reduce((a, l) => a + tarifaPixDaLinha(l, pctPixTabela(taxas)), 0))
    : arred2(pixEstimado);
  const reembolsoRecebido = arred2(reembolsos.reduce((a, r) => a + (Number(r.valor) || 0), 0));
  // A tarifa Pix da Stone e custo de receber tanto quanto a taxa do cartao.
  const taxasPrevistas = arred2(custoCartao - resumo.reembolso_previsto + tarifaPix);
  const taxasRealizadas = arred2(custoCartao - reembolsoRecebido + tarifaPix);

  // ----- despesas: orcado x realizado por grupo -----
  const grupos = new Map<GrupoGestao, GrupoFechamento & { _provisoes: number; _boletos: number }>();
  for (const g of ORDEM) grupos.set(g, { grupo: g, rotulo: ROTULOS_GRUPO[g], orcado: 0, realizado: 0, provisao: false, itens: [], _provisoes: 0, _boletos: 0 });
  const grupo = (g: GrupoGestao) => grupos.get(g)!;
  let jurosDivida = 0;

  for (const d of despesas) {
    const v = d.valor_no_mes;
    if (!d.ativo || v <= 0) continue;
    if (d.grupo === 'divida') {
      const juros = Math.min(d.valor_juros, v);
      jurosDivida += juros;
      grupo('divida').orcado += v - juros;
      grupo('divida').itens.push({ descricao: d.nome, valor: arred2(v - juros), data: null, origem: 'orcado', fornecedor: d.fornecedor_nome });
      if (juros > 0) grupo('taxas').itens.push({ descricao: `Juros — ${d.nome}`, valor: arred2(juros), data: null, origem: 'orcado', fornecedor: d.fornecedor_nome });
      continue;
    }
    const g = grupo(d.grupo);
    g.orcado += v;
    g.itens.push({ descricao: d.nome, valor: v, data: null, origem: 'orcado', fornecedor: d.fornecedor_nome });
    if (d.gera_conta || d.fonte === 'funcionarios') g._boletos++; else g._provisoes++;
  }
  grupo('taxas').orcado += jurosDivida + taxasPrevistas;
  grupo('taxas').itens.push({ descricao: 'Taxas da maquininha e tarifa Pix (previsto)', valor: taxasPrevistas, data: null, origem: 'orcado', fornecedor: 'Stone' });

  // Conta paga por banco nao tem linha propria: a do extrato, se nao casou, e a
  // mesma saida. Conta paga no caixa/cartao ja tem linha vinculada (fica fora).
  const refsContas: Ref[] = contasPagasRef
    .filter(c => c.data_pagamento && c.conta_tipo !== 'caixa' && c.conta_tipo !== 'cartao_credito')
    .map(c => ({ data: c.data_pagamento!, valor: arred2(c.valor_pago ?? c.valor) }));

  // (a) contas pagas por competencia (fatura fica fora: a despesa entrou na compra).
  let comprasPagas = 0;
  for (const c of contasComp) {
    if (c.categoria_grupo === 'transferencia') continue;
    const valor = arred2(c.valor_pago ?? c.valor);
    const d = c.despesa_fixa_id ? despesaPorId.get(c.despesa_fixa_id) : undefined;
    const g: GrupoGestao = d ? (d.grupo as GrupoGestao) : (c.grupo_gestao ?? 'outro');
    const item = { descricao: c.descricao, valor, data: c.data_pagamento, origem: 'conta_pagar' as const, fornecedor: c.fornecedor_nome };
    if (g === 'divida') {
      const juros = Math.min(d?.valor_juros ?? 0, valor);
      grupo('divida').realizado += valor - juros;
      grupo('divida').itens.push({ ...item, valor: arred2(valor - juros) });
      if (juros > 0) { grupo('taxas').realizado += juros; grupo('taxas').itens.push({ ...item, descricao: `Juros — ${c.descricao}`, valor: arred2(juros) }); }
      continue;
    }
    if (g === 'cmv_compras') comprasPagas += valor;
    grupo(g).realizado += valor;
    grupo(g).itens.push(item);
  }

  // (b) folha: so de funcionario_pagamentos (bruto = liquido + vales descontados), por periodo_fim.
  const refsFolha: Ref[] = folhaPaga.map(f => ({ data: String(f.pago_em), valor: arred2(Number(f.valor_liquido) || 0) }));
  let folhaRealizada = 0;
  for (const f of folhaComp) {
    const valor = arred2((Number(f.valor_liquido) || 0) + (Number(f.total_vales) || 0));
    folhaRealizada += valor;
    grupo('folha').realizado += valor;
    grupo('folha').itens.push({ descricao: `Salário — ${um<Row>(f.funcionarios)?.nome ?? 'Funcionário'} (até ${String(f.periodo_fim)})`, valor, data: String(f.pago_em), origem: 'folha', fornecedor: null });
  }
  for (const v of vales) {
    if (v.pagamento_id) continue;   // ja esta dentro do bruto do salario que o descontou
    grupo('folha').itens.push({ descricao: `Vale em aberto (não somado) — ${um<Row>(v.funcionarios)?.nome ?? 'Funcionário'}`, valor: arred2(Number(v.valor) || 0), data: String(v.data), origem: 'vale', fornecedor: null });
  }

  // (c) extrato e (d) caixa: saidas sem vinculo, fora transferencia e folha.
  let folhaJaContada = 0, duplicidades = 0, aRevisar = 0;
  const saidasExtrato: Array<{ valor: number; conta_id: string }> = [];
  const saidasCaixa: number[] = [];
  for (const l of linhas) {
    const valor = Number(l.valor) || 0;
    const vinculada = Boolean(l.pagamento_id || l.conta_pagar_id || l.funcionario_pagamento_id || l.funcionario_vale_id);
    if (!l.revisado && !vinculada && (!l.categoria_id || l.categoria_origem === 'ia')) aRevisar++;
    if (valor >= 0 || vinculada) continue;
    const cat = um<Row>(l.categorias_financeiras);
    if (cat?.grupo === 'transferencia') continue;
    const tipo = tipoConta.get(String(l.conta_id));
    const doExtrato = (tipo === 'banco' || tipo === 'adquirente') && ehExtrato(l.origem_lancamento);
    const doCaixa = tipo === 'caixa' && l.origem_lancamento === 'manual';
    if (!doExtrato && !doCaixa) continue;
    const abs = arred2(-valor);
    // Salario pago por PIX so e descartado quando o mesmo pagamento esta
    // registrado em Funcionarios (ai ele ja entrou pela folha). Sem registro,
    // a linha do extrato E a folha realizada.
    if (ehFolha(cat?.nome) && doExtrato && coincide(refsFolha, String(l.data), abs)) { folhaJaContada++; continue; }
    if (doExtrato && (coincide(refsContas, String(l.data), abs) || coincide(refsFolha, String(l.data), abs))) { duplicidades++; continue; }
    if (doExtrato) saidasExtrato.push({ valor: abs, conta_id: String(l.conta_id) }); else saidasCaixa.push(abs);
    // Categoria com grupo_gestao NULL (nao operacional) fica fora; sem categoria cai em 'outro'.
    const g: GrupoGestao | null = cat ? ((cat.grupo_gestao as GrupoGestao | null) ?? null) : 'outro';
    if (!g) continue;
    if (g === 'cmv_compras') comprasPagas += abs;
    grupo(g).realizado += abs;
    grupo(g).itens.push({ descricao: String(l.descricao || ''), valor: abs, data: String(l.data), origem: doExtrato ? 'extrato' : 'caixa', fornecedor: (l.contraparte as string | null) ?? null });
  }
  grupo('taxas').realizado += taxasRealizadas;
  grupo('taxas').itens.push({ descricao: 'Taxas da maquininha e tarifa Pix (realizado)', valor: taxasRealizadas, data: null, origem: 'extrato', fornecedor: 'Stone' });

  const lista: GrupoFechamento[] = ORDEM.map(g => {
    const x = grupo(g);
    return { grupo: g, rotulo: x.rotulo, orcado: arred2(x.orcado), realizado: arred2(x.realizado), provisao: x._provisoes > 0 && x._boletos === 0, itens: x.itens };
  });
  const soma = (campo: 'orcado' | 'realizado', gs: GrupoGestao[]) => arred2(lista.filter(x => gs.includes(x.grupo)).reduce((a, x) => a + x[campo], 0));
  const totalOrcado = soma('orcado', OPERACIONAIS);
  const totalRealizado = soma('realizado', OPERACIONAIS);
  const dividaOrcada = soma('orcado', ['divida']);
  const dividaRealizada = soma('realizado', ['divida']);
  const lucroOpOrcado = arred2(vendas.lucro_bruto - totalOrcado);
  const lucroOpRealizado = arred2(vendas.lucro_bruto - totalRealizado);

  // ----- caixa do mes: so banco + adquirente (dinheiro vive no caixa fisico) -----
  const bancos = contas.filter(c => c.ativo && (c.tipo === 'banco' || c.tipo === 'adquirente'));
  const somaSaldos = (m: Map<string, { saldo: number }>) => bancos.every(c => m.has(c.id)) ? arred2(bancos.reduce((a, c) => a + (m.get(c.id)?.saldo ?? 0), 0)) : null;
  const saldoInicial = bancos.length ? somaSaldos(saldosIni) : null;
  const saldoFinalInformado = bancos.length ? somaSaldos(saldosFim) : null;
  // Sem metodo nem conta (historico antigo) nao da pra saber: fica fora do banco.
  const semDinheiro = (metodo: string | null, contaId: string | null) => metodo
    ? metodo !== 'dinheiro' && tipoConta.get(String(contaId)) !== 'caixa'
    : contaId ? tipoConta.get(String(contaId)) !== 'caixa' : false;
  const entradas = arred2(totalRecebido - (porMetodo.dinheiro ?? 0) - custoCartao - tarifaPix);
  const saidasPorTipo: Record<string, number> = { contas: 0, faturas: 0, folha: 0, vales: 0, extrato: 0 };
  for (const c of contasPagasMes) {
    if (c.conta_tipo === 'cartao_credito' || c.metodo_pagamento === 'dinheiro' || c.conta_tipo === 'caixa') continue;   // sai na fatura / no caixa fisico
    saidasPorTipo[c.categoria_grupo === 'transferencia' ? 'faturas' : 'contas'] += c.valor_pago ?? c.valor;
  }
  for (const f of folhaPaga) if (semDinheiro(f.metodo, f.conta_id)) saidasPorTipo.folha += Number(f.valor_liquido) || 0;
  for (const v of vales) if (semDinheiro(v.metodo, v.conta_id)) saidasPorTipo.vales += Number(v.valor) || 0;
  saidasPorTipo.extrato = saidasExtrato.reduce((a, s) => a + s.valor, 0);
  for (const k of Object.keys(saidasPorTipo)) saidasPorTipo[k] = arred2(saidasPorTipo[k]);
  const saidas = arred2(Object.values(saidasPorTipo).reduce((a, v) => a + v, 0));
  const saldoFinalCalculado = saldoInicial === null ? null : arred2(saldoInicial + entradas - saidas);

  const comparativo = comComparativo ? await calcular(mesAnterior(mes), false) : null;

  return {
    mes,
    vendas: {
      faturamento: vendas.faturamento, qtd_pedidos: vendas.qtd_pedidos, cmv: vendas.cmv, lucro_bruto: vendas.lucro_bruto,
      margem_bruta_pct: vendas.margem_bruta_pct, receita_sem_custo: vendas.receita_sem_custo, ticket_medio: vendas.ticket_medio,
    },
    recebimentos: {
      por_metodo: porMetodo, total: arred2(totalRecebido), maquininha: resumo, tarifa_pix_stone: tarifaPix, reembolso_recebido: reembolsoRecebido,
      taxas_liquidas_previstas: taxasPrevistas, taxas_liquidas_realizadas: taxasRealizadas,
    },
    despesas: {
      grupos: lista, total_orcado: totalOrcado, total_realizado: totalRealizado, folha_realizada: arred2(folhaRealizada),
      compras_pagas: arred2(comprasPagas), juros_divida: arred2(jurosDivida),
    },
    resultado: {
      orcado: { lucro_operacao: lucroOpOrcado, divida: dividaOrcada, caixa_livre: arred2(lucroOpOrcado - dividaOrcada) },
      realizado: { lucro_operacao: lucroOpRealizado, divida: dividaRealizada, caixa_livre: arred2(lucroOpRealizado - dividaRealizada) },
    },
    caixa: {
      saldo_inicial: saldoInicial, entradas, saidas, saldo_final_calculado: saldoFinalCalculado, saldo_final_informado: saldoFinalInformado,
      diferenca: saldoFinalCalculado !== null && saldoFinalInformado !== null ? arred2(saldoFinalInformado - saldoFinalCalculado) : null,
      saidas_por_tipo: saidasPorTipo,
    },
    comparativo: comparativo ? {
      mes: comparativo.mes, faturamento: comparativo.vendas.faturamento, lucro_bruto: comparativo.vendas.lucro_bruto,
      despesas_realizadas: comparativo.despesas.total_realizado, caixa_livre_realizado: comparativo.resultado.realizado.caixa_livre,
    } : null,
    qualidade: {
      contas_vencidas_pendentes: pendentes.filter((c: ContaPagar) => c.vencimento < hoje && !c.precisa_confirmacao).length,
      lancamentos_a_revisar: aRevisar,
      extrato_ate: extratoAte,
      possiveis_duplicidades: duplicidades,
      folha_ja_contada: folhaJaContada,
      receita_sem_custo_pct: vendas.faturamento > 0 ? arred2((vendas.receita_sem_custo / vendas.faturamento) * 100) : 0,
      taxas_sem_tabela: resumo.sem_tabela,
      reembolso_pendente: arred2(resumo.reembolso_previsto - reembolsoRecebido),
      pedidos_sem_pagamento: vendas.pedidos_sem_pagamento,
    },
  };
}

export async function fechamentoMensal(mes: string, opcoes: { comparativo?: boolean } = {}): Promise<FechamentoMensal> {
  if (!ehMes(mes)) throw new ErroFinanceiro(400, 'Mês inválido (AAAA-MM).');
  // O Panorama nao mostra o mes anterior: pular o comparativo corta metade das leituras.
  return calcular(mes, opcoes.comparativo !== false);
}

// ------------------------------------------------------------
// Maquininha no mes (GET /api/financeiro/maquininha)
// ------------------------------------------------------------

export function mapearReembolso(r: Row): Reembolso {
  return {
    id: String(r.id),
    fornecedor_id: r.fornecedor_id ? String(r.fornecedor_id) : null,
    fornecedor_nome: um<Row>(r.fornecedores)?.nome ?? null,
    referencia: String(r.referencia),
    valor: arred2(Number(r.valor) || 0),
    data_recebimento: String(r.data_recebimento),
    forma: (r.forma as Reembolso['forma']) || 'credito_compra',
    observacoes: (r.observacoes as string | null) ?? null,
  };
}

/**
 * Custo da maquininha no mes: estimado pela tabela (por pagamento e por
 * faixa), taxa efetiva REAL medida no extrato Stone (agregado por dia de
 * liquidacao), tarifas Pix e reembolso previsto x recebido.
 */
export async function resumoMaquininhaMes(mes: string): Promise<ResumoMaquininhaMes> {
  if (!ehMes(mes)) throw new ErroFinanceiro(400, 'Mês inválido (AAAA-MM).');
  const { inicio, fim } = inicioFimMes(mes);
  const { inicioUtc, fimUtc } = limitesMesUtc(mes);
  const [taxas, contas] = await Promise.all([carregarTaxas(), carregarContasFinanceiras()]);
  const adquirentes = contas.filter(c => c.tipo === 'adquirente').map(c => c.id);
  const [custos, agregado, reembolsosRaw, linhasPix] = await Promise.all([
    custosDoPeriodo(inicioUtc, fimUtc, taxas),
    cartaoAgregado(inicio, fim, { taxas, contas }),
    lerTudo<Row>(() => supabaseAdmin.from('reembolsos_fornecedor').select('*, fornecedores ( nome )')
      .gte('referencia', inicio).lte('referencia', fim).order('data_recebimento')),
    adquirentes.length
      ? lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios').select('descricao, valor, tarifa, origem_lancamento')
        .in('conta_id', adquirentes).gte('data', inicio).lte('data', fim).gt('tarifa', 0))
      : Promise.resolve([] as Row[]),
  ]);
  const resumo = resumirCustos(custos, taxas);
  const reembolsos = reembolsosRaw.map(mapearReembolso);
  const reembolsoRecebido = arred2(reembolsos.reduce((a, r) => a + r.valor, 0));
  const transacoesPix = linhasPix.filter(l => Number(l.valor) > 0 && ehExtrato(l.origem_lancamento) && ehPixMaquininha(l.descricao));
  const tarifasPix = arred2(transacoesPix.reduce((a, l) => a + (Number(l.tarifa) || 0), 0));
  // Mesma regra do fechamento: Pix via Stone ou pela tabela ou pelo extrato, nunca os dois.
  const pixEstimado = custos.filter(x => x.pagamento.metodo === 'pix' && x.pagamento.via_stone).reduce((a, x) => a + x.custo.custo_bruto, 0);
  const tarifaPixEfetiva = transacoesPix.length ? tarifasPix : pixEstimado;

  const porDia = new Map<string, { data: string; volume: number; custo_bruto: number; custo_liquido_previsto: number }>();
  for (const { pagamento: p, custo: c } of custos) {
    if (c.fonte === 'nao_se_aplica') continue;   // dinheiro, boleto, Pix fora da maquininha
    const d = dataBRT(p.data_pagamento);
    const x = porDia.get(d) ?? { data: d, volume: 0, custo_bruto: 0, custo_liquido_previsto: 0 };
    x.volume += p.valor; x.custo_bruto += c.custo_bruto; x.custo_liquido_previsto += c.custo_liquido_previsto;
    porDia.set(d, x);
  }

  return {
    ...resumo,
    mes,
    tarifas_pix_stone: tarifasPix,
    taxa_efetiva_extrato_pct: agregado.taxa_efetiva_pct,
    liquidado_extrato: agregado.liquidado,
    reembolso_recebido: reembolsoRecebido,
    custo_liquido_realizado: arred2(resumo.custo_bruto - pixEstimado + tarifaPixEfetiva - reembolsoRecebido),
    reembolsos,
    por_dia: [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data))
      .map(x => ({ data: x.data, volume: arred2(x.volume), custo_bruto: arred2(x.custo_bruto), custo_liquido_previsto: arred2(x.custo_liquido_previsto) })),
    taxas_padrao_nao_conferidas: taxasVigentes(taxas).some(t => /valor padr/i.test(t.observacoes ?? '')),
  };
}
