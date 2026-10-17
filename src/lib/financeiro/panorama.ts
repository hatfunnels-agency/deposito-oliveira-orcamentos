// Panorama: a primeira tela do /financeiro, montada em cima das outras
// funcoes da lib. Nenhum numero nasce aqui — so composicao, fluxo de 30
// dias e alertas.

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import type { Alerta, FluxoDia, Panorama } from './tipos';
import {
  arred2, dataBRT, diaSemana, diasEntre, diasNoIntervalo, diasUteisNoMes, diasUteisPassados, hojeSP, limitesPeriodoUtc, mesSP, somarDias,
} from './datas';
import { carregarContasFinanceiras, saldosAtuais, totalDisponivel } from './saldos';
import { calcularReceber, agruparPorCliente } from './receber';
import { listarContasPagar, resumoContasPagar } from './contas-pagar';
import { folhaPrevista, listarDespesasFixas } from './despesas-fixas';
import { diaGestao } from './dia';
import { fechamentoMensal } from './fechamento';
import { cartaoAgregado, conciliar } from './conciliacao';
import { calcularCusto, carregarPagamentos, carregarTaxas, taxasVigentes } from './taxas';

type Row = Record<string, any>;
const brl = (n: number) => `R$ ${arred2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const DIAS_FLUXO = 30;
const SEMANAS_PROJECAO = 4;

export async function panorama(): Promise<Panorama> {
  const hoje = hojeSP();
  const mes = mesSP();
  const [contas, taxas] = await Promise.all([carregarContasFinanceiras(), carregarTaxas()]);
  const janela28 = limitesPeriodoUtc(somarDias(hoje, -SEMANAS_PROJECAO * 7), somarDias(hoje, -1));
  const janelaCartao = limitesPeriodoUtc(somarDias(hoje, -5), hoje);

  // Previa da conciliacao (ultimos 7 dias, sem gravar) em paralelo com o resto:
  // em sequencia, ela sozinha levava o Panorama ao limite de tempo da Vercel.
  // Falha aqui nao derruba o Panorama.
  const previas = Promise.all(contas.filter(c => c.ativo && (c.tipo === 'banco' || c.tipo === 'adquirente')).map(c =>
    conciliar({ conta_id: c.id, de: somarDias(hoje, -7), ate: hoje, aplicar: false })
      .then(r => r.totais.sugestoes)
      .catch(e => { console.error('[financeiro/panorama] conciliacao (previa) falhou:', c.nome, e); return 0; })));

  const [saldos, receber, resumoCP, folha, dia, fech, pendentes, despesas, pagRecentes, pagCartao, contasHoje, agregadoMes] = await Promise.all([
    saldosAtuais(contas),
    calcularReceber(90),
    resumoContasPagar(hoje),
    folhaPrevista(),
    diaGestao(hoje),
    fechamentoMensal(mes, { comparativo: false }),
    listarContasPagar({ status: 'pendente' }),
    listarDespesasFixas(false, mes),
    carregarPagamentos(janela28.inicioUtc, janela28.fimUtc),
    carregarPagamentos(janelaCartao.inicioUtc, janelaCartao.fimUtc),
    lerTudo<Row>(() => supabaseAdmin.from('contas_pagar').select('id, status').eq('vencimento', hoje).neq('status', 'cancelado')),
    cartaoAgregado(`${mes}-01`, hoje, { taxas, contas }),
  ]);

  const sugestoesPendentes = (await previas).reduce((a, n) => a + n, 0);

  const totalDisp = totalDisponivel(saldos);
  const clientes = agruparPorCliente(receber.em_aberto, hoje);
  const extratoAte = Object.entries(dia.extrato_ate).map(([conta, data]) => ({ conta, data, dias: data ? diasEntre(data, hoje) : null }));

  // ----- folha mais proxima -----
  const proximaData = folha.proximos.map(p => p.data_pagamento).sort()[0] ?? null;
  const folhaProxima = proximaData
    ? { data: proximaData, valor: arred2(folha.proximos.filter(p => p.data_pagamento === proximaData).reduce((a, p) => a + p.liquido, 0)) }
    : null;

  // ----- fluxo 30 dias -----
  const dias = diasNoIntervalo(hoje, somarDias(hoje, DIAS_FLUXO - 1));
  const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const contratadas = new Map<string, number>();
  for (const o of receber.em_aberto) if (o.vencimento && o.vencimento >= hoje) somar(contratadas, o.vencimento, o.saldo);
  for (const p of pagCartao) {
    if (p.metodo !== 'debito' && p.metodo !== 'credito') continue;
    const c = calcularCusto(p, taxas);
    if (c.data_liquidacao >= hoje) somar(contratadas, c.data_liquidacao, c.liquido_recebido);
  }
  // Media de recebimento por dia da semana nas ultimas 4 semanas (domingo nao vende).
  const porDiaSemana = [0, 0, 0, 0, 0, 0, 0];
  for (const p of pagRecentes) if (p.valor > 0) porDiaSemana[diaSemana(dataBRT(p.data_pagamento))] += p.valor;
  const saidas = new Map<string, number>();
  // Retroativa em "ja pagou?" quase sempre ja foi paga: nao e saida futura.
  for (const c of pendentes) if (!c.precisa_confirmacao) somar(saidas, c.vencimento < hoje ? hoje : c.vencimento, c.valor);
  for (const f of folha.proximos) somar(saidas, f.data_pagamento < hoje ? hoje : f.data_pagamento, f.liquido);
  // Sem saldo informado o fluxo parte de 0 e vira so variacao acumulada; a
  // flag avisa a tela pra nao desenhar como se fosse saldo.
  const semBase = totalDisp === null;
  let saldo = totalDisp ?? 0;
  let saldoSo = totalDisp ?? 0;
  const fluxo: FluxoDia[] = dias.map(d => {
    const ec = contratadas.get(d) ?? 0;
    const dow = diaSemana(d);
    const ep = dow === 0 ? 0 : porDiaSemana[dow] / SEMANAS_PROJECAO;
    const s = saidas.get(d) ?? 0;
    saldo += ec + ep - s;
    saldoSo += ec - s;
    return {
      data: d, entradas_contratadas: arred2(ec), entradas_projetadas: arred2(ep), saidas: arred2(s),
      saldo_projetado: arred2(saldo), saldo_so_contratado: arred2(saldoSo), ...(semBase ? { sem_saldo_base: true } : {}),
    };
  });

  // ----- mes -----
  const passados = diasUteisPassados(mes, hoje);
  const totalUteis = diasUteisNoMes(mes);

  // ----- alertas -----
  const alertas: Alerta[] = [];
  const alerta = (nivel: Alerta['nivel'], texto: string, secao: string) => alertas.push({ nivel, texto, secao });
  if (resumoCP.qtd_atrasadas > 0) alerta('alto', `${resumoCP.qtd_atrasadas} conta(s) atrasada(s): ${brl(resumoCP.atrasado)}.`, 'pagar');
  for (const d of despesas) {
    if (d.gera_conta && d.fonte !== 'funcionarios' && d.tipo_valor === 'fixo' && d.valor <= 0) alerta('alto', `Despesa fixa sem valor: ${d.nome}.`, 'despesas');
  }
  if (fech.qualidade.taxas_sem_tabela || taxasVigentes(taxas).length === 0) alerta('alto', 'Cadastre as taxas da Stone: o custo da maquininha está saindo zerado.', 'maquininha');
  if (resumoCP.qtd_hoje > 0) alerta('medio', `${resumoCP.qtd_hoje} conta(s) vencendo hoje: ${brl(resumoCP.hoje)}.`, 'pagar');
  for (const s of saldos) {
    if (s.tipo !== 'banco' && s.tipo !== 'adquirente') continue;
    if (s.saldo_base === null) alerta('medio', `Informe o saldo de ${s.nome}: sem ele o disponível não fecha.`, 'panorama');
    else if ((s.defasagem_dias ?? 0) > 2 || (s.pagos_apos_base > 0 && (s.defasagem_dias ?? 0) > 0)) {
      alerta('medio', `Saldo de ${s.nome} informado há ${s.defasagem_dias} dia(s); o valor de hoje é estimado.`, 'panorama');
    }
  }
  for (const e of extratoAte) {
    if (e.dias === null) alerta('medio', `Nenhum extrato importado de ${e.conta}.`, 'extratos');
    else if (e.dias > 7) alerta('medio', `Extrato de ${e.conta} parado há ${e.dias} dias.`, 'extratos');
  }
  if (resumoCP.a_confirmar > 0) alerta('medio', `${resumoCP.a_confirmar} conta(s) retroativa(s) aguardando "já pagou?".`, 'pagar');
  if (sugestoesPendentes > 0) alerta('medio', `${sugestoesPendentes} sugestão(ões) de conciliação para confirmar.`, 'conciliacao');
  if (taxasVigentes(taxas).some(t => /valor padr/i.test(t.observacoes ?? ''))) alerta('baixo', 'Taxas da Stone com valor padrão: confira no contrato.', 'maquininha');
  if (dia.caixa.falta_sincronizar > 0.01) alerta('baixo', `Venda em dinheiro ainda não sincronizada com o caixa: ${brl(dia.caixa.falta_sincronizar)}.`, 'dia');
  if (fech.qualidade.receita_sem_custo_pct > 2) alerta('baixo', `${fech.qualidade.receita_sem_custo_pct.toFixed(1)}% da receita do mês é de itens sem custo cadastrado (margem inflada).`, 'fechamento');
  for (const c of contas) {
    if (c.ativo && c.tipo === 'cartao_credito' && (!c.dia_fechamento || !c.dia_vencimento)) alerta('baixo', `Informe fechamento e vencimento do ${c.nome} para gerar a fatura.`, 'pagar');
  }

  return {
    hoje,
    checklist: {
      saldo_informado_hoje: saldos.some(s => s.tipo === 'banco' && s.data_base === hoje),
      contas_hoje: { pagas: contasHoje.filter(c => c.status === 'pago').length, total: contasHoje.length },
      extrato_ate: extratoAte,
      sugestoes_pendentes: sugestoesPendentes,
      a_confirmar: resumoCP.a_confirmar,
    },
    contas: saldos,
    total_disponivel: totalDisp,
    fatura_cartao_aberta: arred2(saldos.reduce((a, s) => a + s.fatura_aberta, 0)),
    a_receber: {
      total: arred2(receber.resumo.total_a_receber), vencido: arred2(receber.resumo.vencido), entregue_nao_pago: arred2(receber.resumo.entregue_nao_pago),
      qtd: receber.resumo.qtd_a_receber, qtd_clientes: clientes.length,
    },
    a_pagar: { ...resumoCP, folha_proxima: folhaProxima },
    dia: {
      recebido_bruto: dia.recebido_liquido.bruto,
      taxas: arred2(dia.recebido_liquido.taxas + dia.recebido_liquido.antecipacao + dia.recebido_liquido.tarifa_pix_stone),
      recebido_liquido: dia.recebido_liquido.liquido, pago: dia.pago.total, liquido_dia: dia.liquido_dia, status: dia.liquido_dia_status,
    },
    mes: {
      mes, faturamento: fech.vendas.faturamento, lucro_bruto: fech.vendas.lucro_bruto, margem_pct: fech.vendas.margem_bruta_pct,
      despesas_realizadas: fech.despesas.total_realizado, resultado_parcial: fech.resultado.realizado.lucro_operacao,
      projecao_faturamento: passados > 0 ? arred2((fech.vendas.faturamento / passados) * totalUteis) : 0,
      dias_uteis_passados: passados, dias_uteis_total: totalUteis,
    },
    maquininha_mes: {
      volume: fech.recebimentos.maquininha.volume_bruto, custo_estimado: fech.recebimentos.maquininha.custo_bruto,
      taxa_efetiva_extrato_pct: agregadoMes.taxa_efetiva_pct, reembolso_previsto: fech.recebimentos.maquininha.reembolso_previsto,
      reembolso_recebido: fech.recebimentos.reembolso_recebido, custo_liquido_previsto: fech.recebimentos.maquininha.custo_liquido_previsto,
    },
    fluxo_30d: fluxo,
    entradas_atrasadas: arred2(receber.resumo.vencido),
    alertas,
  };
}
