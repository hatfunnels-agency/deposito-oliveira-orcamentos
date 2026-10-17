// O dia financeiro.
//
// diaBase e o calculo de GET /api/financeiro/dia, movido pra ca sem mudar
// um centavo da resposta (a rota antiga passa a chama-lo). diaGestao estende
// com o que a tela nova precisa: recebido liquido (bruto - taxas - tarifa
// Pix da Stone), tudo que foi pago no dia (uma vez so) e o liquido do dia.
//
// Nada entra duas vezes: conta paga em dinheiro/cartao ja tem linha vinculada
// (fica so como conta), folha paga so vem de funcionario_pagamentos/vales, e
// linha de extrato categorizada como folha ou transferencia nao e despesa.

import { ehPixMaquininha, pctPixTabela, tarifaPixDaLinha } from './stone-extrato';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { normalizar } from '@/lib/categorizacao';
import type { ContaFinanceira, DiaBase, DiaFinanceiro, GrupoGestao, ItemPagoDia, Metodo } from './tipos';
import { arred2, ehData, hojeSP, limitesDiaUtc } from './datas';
import { ErroFinanceiro } from './eventos';
import { FILTRO_ORIGEM_EXTRATO, carregarContasFinanceiras } from './saldos';
import { carregarTaxas, custosDoPeriodo, resumirCustos } from './taxas';
import { CATEGORIA_FOLHA, contasPagasNoPeriodo, listarContasPagar } from './contas-pagar';
import { folhaPrevista } from './despesas-fixas';
import { inferirMetodo } from './conciliacao';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;
// A rota antiga arredonda com toFixed(2); mantido pra resposta identica.
const fix2 = (n: number) => Number(n.toFixed(2));

interface LinhaDia {
  id: string; conta_id: string; valor: number; tarifa: number; origem_lancamento: string | null; descricao: string; contraparte: string | null;
  categoria_nome: string | null; categoria_grupo: string | null; grupo_gestao: GrupoGestao | null;
  vinculo: 'conta_pagar' | 'folha' | 'vale' | 'pagamento' | null;
}

interface Calculo {
  base: DiaBase;
  linhas: LinhaDia[];
  contas: ContaFinanceira[];
  idCaixa: string | null;
  recebidoPorMetodo: Record<string, number>;
  saidasCaixa: Array<{ id: string; origem: string | null; vinculo: LinhaDia['vinculo'] }>;
}

async function calcular(data: string): Promise<Calculo> {
  const { inicioUtc, fimUtc } = limitesDiaUtc(data);
  const [pagamentos, lancs, vendas, fechRes, contas] = await Promise.all([
    lerTudo<Row>(() => supabaseAdmin.from('pagamentos').select('valor, metodo').gte('data_pagamento', inicioUtc).lt('data_pagamento', fimUtc)),
    lerTudo<Row>(() => supabaseAdmin
      .from('lancamentos_bancarios')
      .select('id, valor, tarifa, conta_id, origem_lancamento, descricao, contraparte, pagamento_id, conta_pagar_id, funcionario_pagamento_id, funcionario_vale_id, categorias_financeiras ( nome, grupo, grupo_gestao )')
      .eq('data', data)),
    lerTudo<Row>(() => supabaseAdmin
      .from('orcamentos')
      .select('total, status_pagamento')
      .not('status', 'in', '("orcamento","cancelado")')
      .gte('criado_em', inicioUtc)
      .lt('criado_em', fimUtc)),
    supabaseAdmin.from('fechamentos_caixa').select('*').eq('data', data).maybeSingle(),
    carregarContasFinanceiras(),
  ]);
  const porId = new Map(contas.map(c => [c.id, c]));
  const idCaixa = contas.find(c => c.tipo === 'caixa')?.id ?? null;

  // ----- recebido no sistema, por metodo -----
  const recebido: Record<string, number> = {};
  for (const p of pagamentos) {
    const m = String(p.metodo || 'outro');
    recebido[m] = (recebido[m] || 0) + Number(p.valor);
  }
  const totalRecebido = Object.values(recebido).reduce((a, v) => a + v, 0);

  // ----- movimento das contas -----
  const linhas: LinhaDia[] = lancs.filter(l => porId.has(String(l.conta_id))).map(l => {
    const cat = um<Row>(l.categorias_financeiras);
    return {
      id: String(l.id), conta_id: String(l.conta_id), valor: Number(l.valor), tarifa: Number(l.tarifa) || 0,
      origem_lancamento: (l.origem_lancamento as string | null) ?? null, descricao: String(l.descricao || ''),
      contraparte: (l.contraparte as string | null) ?? null,
      categoria_nome: cat?.nome ?? null, categoria_grupo: cat?.grupo ?? null, grupo_gestao: (cat?.grupo_gestao as GrupoGestao | null) ?? null,
      vinculo: l.conta_pagar_id ? 'conta_pagar' : l.funcionario_pagamento_id ? 'folha' : l.funcionario_vale_id ? 'vale' : l.pagamento_id ? 'pagamento' : null,
    };
  });
  const movimentoConta: Record<string, { nome: string; tipo: string; entrou: number; saiu: number }> = {};
  const saidasCaixa: DiaBase['caixa']['saidas'] = [];
  const saidasDetalhe: Calculo['saidasCaixa'] = [];
  for (const l of linhas) {
    const c = porId.get(l.conta_id)!;
    movimentoConta[l.conta_id] = movimentoConta[l.conta_id] || { nome: c.nome, tipo: c.tipo, entrou: 0, saiu: 0 };
    if (l.valor >= 0) movimentoConta[l.conta_id].entrou += l.valor; else movimentoConta[l.conta_id].saiu += l.valor;
    if (idCaixa && l.conta_id === idCaixa && l.valor < 0) {
      saidasCaixa.push({ descricao: l.descricao, contraparte: l.contraparte, valor: l.valor, categoria: l.categoria_nome });
      saidasDetalhe.push({ id: l.id, origem: l.origem_lancamento, vinculo: l.vinculo });
    }
  }

  // ----- saldo de caixa acumulado ate o dia -----
  let saldoCaixa = 0;
  if (idCaixa) {
    const ate = await lerTudo<Row>(() => supabaseAdmin.from('lancamentos_bancarios').select('valor').eq('conta_id', idCaixa).lte('data', data));
    saldoCaixa = ate.reduce((a, l) => a + Number(l.valor), 0);
  }

  const vendaTotal = vendas.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const dinheiroSistema = recebido['dinheiro'] || 0;
  const dinheiroNoCaixa = idCaixa ? (movimentoConta[idCaixa]?.entrou ?? 0) : 0;
  const entrouEmBanco = Object.entries(movimentoConta).filter(([, m]) => m.tipo !== 'caixa').reduce((a, [, m]) => a + m.entrou, 0);

  const base: DiaBase = {
    data,
    sistema: {
      vendas_do_dia: fix2(vendaTotal),
      qtd_pedidos: vendas.length,
      recebido_total: fix2(totalRecebido),
      recebido_por_metodo: Object.fromEntries(Object.entries(recebido).map(([k, v]) => [k, fix2(v)])),
    },
    contas: Object.values(movimentoConta).map(m => ({ ...m, entrou: fix2(m.entrou), saiu: fix2(m.saiu) })),
    caixa: {
      entrou_no_dia: fix2(dinheiroNoCaixa),
      saidas: saidasCaixa,
      total_saidas: fix2(saidasCaixa.reduce((a, s) => a + s.valor, 0)),
      saldo_esperado: fix2(saldoCaixa),
      fechamento: (fechRes.data as DiaBase['caixa']['fechamento']) || null,
      falta_sincronizar: fix2(dinheiroSistema - dinheiroNoCaixa),
    },
    conferencia: {
      entrou_em_banco: fix2(entrouEmBanco),
      recebido_no_sistema: fix2(totalRecebido),
      nota: 'Banco e sistema divergem por natureza: dinheiro fica no caixa, cartao liquida depois e venda a prazo nem entra hoje.',
    },
  };
  return { base, linhas, contas, idCaixa, recebidoPorMetodo: recebido, saidasCaixa: saidasDetalhe };
}

/** Exatamente a resposta de GET /api/financeiro/dia (a rota chama isto). */
export async function diaBase(data: string = hojeSP()): Promise<DiaBase> {
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');
  return (await calcular(data)).base;
}

/** Ultima data com linha de extrato/conector por conta (nome -> data). */
export async function extratoAtePorConta(contas?: ContaFinanceira[]): Promise<Record<string, string | null>> {
  const lista = (contas ?? await carregarContasFinanceiras()).filter(c => c.ativo && (c.tipo === 'banco' || c.tipo === 'adquirente'));
  const pares = await Promise.all(lista.map(async c => {
    const { data } = await supabaseAdmin
      .from('lancamentos_bancarios').select('data').eq('conta_id', c.id).or(FILTRO_ORIGEM_EXTRATO)
      .order('data', { ascending: false }).limit(1).maybeSingle();
    return [c.nome, data?.data ? String(data.data) : null] as const;
  }));
  return Object.fromEntries(pares);
}


export async function diaGestao(data: string = hojeSP()): Promise<DiaFinanceiro> {
  if (!ehData(data)) throw new ErroFinanceiro(400, 'Data inválida (AAAA-MM-DD).');
  const calc = await calcular(data);
  const { inicioUtc, fimUtc } = limitesDiaUtc(data);
  const taxas = await carregarTaxas();
  const [custos, contasPagas, folhaRows, valesRows, pendentes, folha, extratoAte] = await Promise.all([
    custosDoPeriodo(inicioUtc, fimUtc, taxas),
    contasPagasNoPeriodo(data, data),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_pagamentos')
      .select('id, valor_liquido, metodo, conta_id, funcionarios ( nome ), contas_financeiras ( nome )').eq('pago_em', data)),
    lerTudo<Row>(() => supabaseAdmin.from('funcionario_vales')
      .select('id, valor, descricao, metodo, conta_id, funcionarios ( nome ), contas_financeiras ( nome )').eq('data', data)),
    listarContasPagar({ status: 'pendente', ate: data }),
    folhaPrevista(),
    extratoAtePorConta(calc.contas),
  ]);
  const tipoConta = (contaId: string) => calc.contas.find(c => c.id === contaId)?.tipo ?? null;
  const nomeConta = (contaId: string) => calc.contas.find(c => c.id === contaId)?.nome ?? null;

  // ----- recebido liquido -----
  const resumo = resumirCustos(custos, taxas);
  const linhasTransacao = calc.linhas.filter(l => tipoConta(l.conta_id) === 'adquirente' && l.valor > 0 && ehPixMaquininha(l.descricao));
  const bruto = Object.values(calc.recebidoPorMetodo).reduce((a, v) => a + v, 0);
  let taxasCartao = 0, antecipacao = 0, pixEstimado = 0;
  const porMetodo: Record<string, { bruto: number; liquido: number; qtd: number }> = {};
  for (const { pagamento: p, custo: c } of custos) {
    const cartao = p.metodo === 'debito' || p.metodo === 'credito';
    if (cartao) { taxasCartao += c.taxa_valor; antecipacao += c.antecipacao_valor; }
    else if (p.metodo === 'pix' && p.via_stone) pixEstimado += c.custo_bruto;
    const m = porMetodo[p.metodo] ?? { bruto: 0, liquido: 0, qtd: 0 };
    m.bruto += p.valor;
    // Pix: a tarifa da Stone e medida no extrato (abaixo), nao por pagamento.
    m.liquido += cartao ? p.valor - c.custo_bruto : p.valor;
    m.qtd++;
    porMetodo[p.metodo] = m;
  }
  // Com extrato Stone do dia, a tarifa Pix e a real; sem ele, a estimativa da tabela.
  const temExtratoStone = linhasTransacao.length > 0;
  const pctPix = pctPixTabela(taxas);
  const tarifaPix = temExtratoStone ? linhasTransacao.reduce((a, l) => a + tarifaPixDaLinha(l, pctPix), 0) : pixEstimado;
  if (porMetodo.pix) porMetodo.pix.liquido -= tarifaPix;
  const liquido = bruto - taxasCartao - antecipacao - tarifaPix;

  // ----- pago no dia (cada coisa uma vez) -----
  const itens: ItemPagoDia[] = [];
  const noCartao: ItemPagoDia[] = [];
  for (const c of contasPagas) {
    if (c.categoria_grupo === 'transferencia') continue;   // fatura: ja contou na compra
    const item: ItemPagoDia = {
      tipo: c.conta_tipo === 'cartao_credito' ? 'cartao' : 'conta_pagar', id: c.id, descricao: c.descricao, fornecedor: c.fornecedor_nome,
      categoria: c.categoria_nome, grupo_gestao: c.grupo_gestao, valor: arred2(c.valor_pago ?? c.valor), metodo: c.metodo_pagamento, conta_nome: c.conta_nome,
    };
    (item.tipo === 'cartao' ? noCartao : itens).push(item);
  }
  for (const f of folhaRows) {
    const nome = String(um<Row>(f.funcionarios)?.nome ?? 'Funcionário');
    itens.push({
      tipo: 'folha', id: String(f.id), descricao: `Salário — ${nome}`, fornecedor: nome, categoria: CATEGORIA_FOLHA, grupo_gestao: 'folha',
      valor: arred2(Number(f.valor_liquido) || 0), metodo: (f.metodo as Metodo | null) ?? null, conta_nome: um<Row>(f.contas_financeiras)?.nome ?? null,
    });
  }
  for (const v of valesRows) {
    const nome = String(um<Row>(v.funcionarios)?.nome ?? 'Funcionário');
    itens.push({
      tipo: 'vale', id: String(v.id), descricao: `Vale — ${nome}${v.descricao ? ` (${v.descricao})` : ''}`, fornecedor: nome, categoria: CATEGORIA_FOLHA,
      grupo_gestao: 'folha', valor: arred2(Number(v.valor) || 0), metodo: (v.metodo as Metodo | null) ?? null, conta_nome: um<Row>(v.contas_financeiras)?.nome ?? null,
    });
  }
  // Conta/folha paga por banco nao cria linha; a linha do extrato que chegou
  // sem vinculo (sugestao media, por exemplo) e a MESMA saida — guarda como no
  // Fechamento (coincide por valor), cada referencia consumida uma vez.
  const refsBanco: number[] = [
    ...contasPagas.filter(c => c.conta_tipo !== 'caixa' && c.conta_tipo !== 'cartao_credito').map(c => arred2(c.valor_pago ?? c.valor)),
    ...folhaRows.filter(f => f.metodo !== 'dinheiro' && tipoConta(String(f.conta_id)) !== 'caixa').map(f => arred2(Number(f.valor_liquido) || 0)),
    ...valesRows.filter(v => v.metodo !== 'dinheiro' && tipoConta(String(v.conta_id)) !== 'caixa').map(v => arred2(Number(v.valor) || 0)),
  ];
  const coincideBanco = (valor: number) => {
    const i = refsBanco.findIndex(r => Math.abs(r - valor) <= 0.01);
    if (i < 0) return false;
    refsBanco.splice(i, 1);
    return true;
  };
  for (const l of calc.linhas) {
    if (l.valor >= 0 || l.vinculo || l.categoria_grupo === 'transferencia') continue;
    const tipo = tipoConta(l.conta_id);
    if (tipo === 'caixa' && l.origem_lancamento === 'manual') {
      itens.push({
        tipo: 'caixa', id: l.id, descricao: l.descricao, fornecedor: l.contraparte, categoria: l.categoria_nome, grupo_gestao: l.grupo_gestao,
        valor: arred2(-l.valor), metodo: 'dinheiro', conta_nome: nomeConta(l.conta_id),
      });
    } else if ((tipo === 'banco' || tipo === 'adquirente') && (!l.origem_lancamento || ['extrato', 'conector'].includes(l.origem_lancamento))) {
      // Folha registrada em Funcionarios ja esta em refsBanco: coincideBanco
      // descarta a linha. Salario so pago por PIX (sem registro) fica.
      if (coincideBanco(arred2(-l.valor))) continue;
      itens.push({
        tipo: 'extrato', id: l.id, descricao: l.descricao, fornecedor: l.contraparte, categoria: l.categoria_nome, grupo_gestao: l.grupo_gestao,
        valor: arred2(-l.valor), metodo: inferirMetodo(l.descricao), conta_nome: nomeConta(l.conta_id),
      });
    }
  }
  const pagoPorMetodo: Record<string, number> = {};
  for (const i of itens) pagoPorMetodo[i.metodo ?? 'outro'] = arred2((pagoPorMetodo[i.metodo ?? 'outro'] ?? 0) + i.valor);
  const pagoTotal = arred2(itens.reduce((a, i) => a + i.valor, 0));

  // ----- status: parcial enquanto alguma conta de banco nao tem extrato cobrindo o dia -----
  const parcial = Object.values(extratoAte).some(d => !d || d < data);

  // Na visao de gestao, transferencia entre contas proprias nao e entrada.
  const ehEntradaReal = (l: LinhaDia) => l.valor > 0 && l.categoria_grupo !== 'transferencia';
  const contas = calc.base.contas.map(m => {
    const id = calc.contas.find(c => c.nome === m.nome)?.id;
    const entrou = calc.linhas.filter(l => l.conta_id === id && ehEntradaReal(l)).reduce((a, l) => a + l.valor, 0);
    return { ...m, entrou: fix2(entrou) };
  });
  const entrouEmBanco = calc.linhas.filter(l => tipoConta(l.conta_id) !== 'caixa' && ehEntradaReal(l)).reduce((a, l) => a + l.valor, 0);

  return {
    ...calc.base,
    contas,
    caixa: {
      ...calc.base.caixa,
      saidas: calc.base.caixa.saidas.map((s, i) => ({ ...s, id: calc.saidasCaixa[i]?.id, origem: calc.saidasCaixa[i]?.origem ?? null, vinculo: calc.saidasCaixa[i]?.vinculo === 'pagamento' ? null : (calc.saidasCaixa[i]?.vinculo ?? null) })),
    },
    conferencia: { ...calc.base.conferencia, entrou_em_banco: fix2(entrouEmBanco) },
    recebido_liquido: {
      bruto: arred2(bruto),
      taxas: arred2(taxasCartao),
      antecipacao: arred2(antecipacao),
      tarifa_pix_stone: arred2(tarifaPix),
      tarifa_pix_estimada: !temExtratoStone,
      reembolso_previsto: resumo.reembolso_previsto,
      liquido: arred2(liquido),
      por_metodo: Object.fromEntries(Object.entries(porMetodo).map(([k, v]) => [k, { bruto: arred2(v.bruto), liquido: arred2(v.liquido), qtd: v.qtd }])),
      sem_tabela: resumo.sem_tabela,
    },
    pago: { total: pagoTotal, por_metodo: pagoPorMetodo, itens },
    pago_no_cartao: { total: arred2(noCartao.reduce((a, i) => a + i.valor, 0)), itens: noCartao },
    liquido_dia: arred2(liquido - pagoTotal),
    liquido_dia_status: parcial ? 'parcial' : 'completo',
    extrato_ate: extratoAte,
    a_pagar_hoje: pendentes.filter(c => !c.precisa_confirmacao),
    // Inclui atrasados: salario que venceu e nao foi pago ainda e "pra hoje".
    folha_hoje: folha.proximos.filter(p => p.data_pagamento <= data),
  };
}
