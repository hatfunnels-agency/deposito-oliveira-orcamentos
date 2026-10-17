// Base real do simulador (lado servidor). simulador.ts e puro e roda no
// navegador; aqui so se monta o BaseSimulador a partir do banco: ultimos 6
// meses fechados de venda, mix e custo do cartao nos ultimos 90 dias,
// imposto como % do faturamento, custos fixos e dividas do mes corrente e o
// dinheiro disponivel hoje.

import type { BaseSimulador, DespesaFixa } from './tipos';
import { arred2, hojeSP, limitesPeriodoUtc, mesSP, somarDias, somarMeses } from './datas';
import { vendasPorMes } from './cmv';
import { calcularCusto, carregarPagamentos, carregarTaxas, resumirCustos } from './taxas';
import { listarDespesasFixas } from './despesas-fixas';
import { saldosAtuais, totalDisponivel } from './saldos';

// DAS/Simples e % do faturamento, nao custo fixo: no simulador vira aliquota.
const ehImposto = (d: DespesaFixa) => d.grupo === 'imposto_socios' && /IMPOSTO|\bDAS\b|SIMPLES/i.test(`${d.nome} ${d.categoria_nome ?? ''}`);

export async function baseSimulador(): Promise<BaseSimulador> {
  const mes = mesSP();
  const hoje = hojeSP();
  const { inicioUtc, fimUtc } = limitesPeriodoUtc(somarDias(hoje, -90), somarDias(hoje, -1));
  const [vendas, pagamentos, taxas, despesas, saldos] = await Promise.all([
    vendasPorMes(somarMeses(mes, -6), somarMeses(mes, -1)),   // 6 meses fechados; o corrente esta pela metade
    carregarPagamentos(inicioUtc, fimUtc),
    carregarTaxas(),
    listarDespesasFixas(false, mes),
    saldosAtuais(),
  ]);

  const faturamentos = [...vendas.values()].map(v => ({ mes: v.mes, faturamento: v.faturamento, margem_pct: v.margem_bruta_pct }));
  const comVenda = [...vendas.values()].filter(v => v.faturamento > 0);
  const fatTotal = comVenda.reduce((a, v) => a + v.faturamento, 0);
  const lucroTotal = comVenda.reduce((a, v) => a + v.lucro_bruto, 0);
  const ultimo = faturamentos[faturamentos.length - 1]?.faturamento ?? 0;
  const medio = comVenda.length ? fatTotal / comVenda.length : 0;
  const melhor = comVenda.reduce((m, v) => Math.max(m, v.faturamento), 0);

  // Mesma base nos dois lados: so cartao, so valores positivos (estorno fora),
  // sem o custo do Pix via Stone misturado no custo do cartao.
  const cartaoPos = pagamentos.filter(p => p.valor > 0 && (p.metodo === 'debito' || p.metodo === 'credito'));
  const resumo = resumirCustos(cartaoPos.map(p => ({ pagamento: p, custo: calcularCusto(p, taxas) })), taxas);
  const volumeTotal = pagamentos.filter(p => p.valor > 0).reduce((a, p) => a + p.valor, 0);
  const volumeCartao = resumo.volume_bruto;

  const das = despesas.filter(ehImposto).reduce((a, d) => a + d.valor_no_mes, 0);
  const folha = despesas.filter(d => d.grupo === 'folha').reduce((a, d) => a + d.valor_no_mes, 0);

  return {
    mes_inicio: mes,
    faturamentos,
    faturamento_ultimo_mes: arred2(ultimo),
    faturamento_medio_6m: arred2(medio),
    faturamento_melhor_mes: arred2(melhor),
    margem_media_pct: fatTotal > 0 ? arred2((lucroTotal / fatTotal) * 100) : 0,
    mix_cartao_pct: volumeTotal > 0 ? arred2((volumeCartao / volumeTotal) * 100) : 0,
    custo_cartao_liquido_pct: volumeCartao > 0 ? arred2((resumo.custo_liquido_previsto / volumeCartao) * 100) : 0,
    imposto_pct_atual: medio > 0 ? arred2((das / medio) * 100) : 0,
    custos_fixos: despesas
      .filter(d => d.grupo !== 'divida' && d.grupo !== 'folha' && !ehImposto(d) && d.valor_no_mes > 0)
      .map(d => ({ nome: d.nome, valor: d.valor_no_mes })),
    folha: arred2(folha),
    dividas: despesas
      .filter(d => d.grupo === 'divida' && d.valor_no_mes > 0)
      .map(d => ({ nome: d.nome, valor: d.valor_no_mes, parcelas_restantes: d.parcelas_restantes ?? d.parcelas_total ?? 12 })),
    caixa_inicial: totalDisponivel(saldos) ?? 0,
  };
}
