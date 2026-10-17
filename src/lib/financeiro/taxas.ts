// Taxas da maquininha (Stone): tabela versionada por vigencia, custo
// estimado por pagamento, resumo por faixa e leitura dos pagamentos do
// periodo com o custo ja calculado.
//
// A taxa que vale e a VIGENTE NA DATA DO PAGAMENTO: mudar a tabela hoje
// nao reescreve o custo de uma venda de marco. Por isso salvarTaxas
// versiona (fecha a vigencia antiga, abre a nova) em vez de editar.

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import type {
  CustoPagamento, FaixaMaquininha, FonteCusto, Metodo, PagamentoBase, ResumoMaquininha,
  TaxaMaquininha, TaxaMaquininhaEntrada,
} from './tipos';
import { arred2, dataBRT, ehData, proximoDiaLiquidacao, somarDias } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';

const SEM_FIM = '9999-12-31';
const arred3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Pagamento como a lib o le do banco (com o join de pedido/cliente resolvido). */
export interface PagamentoRow extends PagamentoBase {
  id: string;
  orcamento_id: string;
  metodo: Metodo;
  parcelas: number;
  parcelas_informadas: boolean;
  data_pagamento: string;
  origem: string;
  grupo_recebimento: string | null;
  observacoes: string | null;
  codigo: string | null;
  cliente_id: string | null;
  cliente_nome: string;
  cliente_telefone: string | null;
  via_stone: boolean;
}

export const SELECT_PAGAMENTO =
  'id, orcamento_id, valor, metodo, parcelas, parcelas_informadas, data_pagamento, origem, grupo_recebimento, observacoes, ' +
  'orcamentos:orcamento_id ( codigo, cliente_id, clientes ( nome, telefone ) )';

type Row = Record<string, any>;
const um = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

export function paraPagamentoRow(r: Row, viaStone = false): PagamentoRow {
  const orc = um<Row>(r.orcamentos);
  const cli = um<Row>(orc?.clientes);
  return {
    id: String(r.id),
    orcamento_id: String(r.orcamento_id),
    valor: Number(r.valor) || 0,
    metodo: String(r.metodo || 'outro') as Metodo,
    parcelas: Math.max(1, Number(r.parcelas) || 1),
    parcelas_informadas: r.parcelas_informadas === true,
    data_pagamento: String(r.data_pagamento),
    origem: String(r.origem || 'manual'),
    grupo_recebimento: r.grupo_recebimento ? String(r.grupo_recebimento) : null,
    observacoes: (r.observacoes as string | null) ?? null,
    codigo: orc?.codigo ? String(orc.codigo) : null,
    cliente_id: orc?.cliente_id ? String(orc.cliente_id) : null,
    cliente_nome: cli?.nome ? String(cli.nome) : 'Sem cliente',
    cliente_telefone: cli?.telefone ? String(cli.telefone) : null,
    via_stone: viaStone,
  };
}

function modalidadeDe(p: PagamentoBase): 'debito' | 'credito' | 'pix' | null {
  if (p.metodo === 'debito' || p.metodo === 'credito') return p.metodo;
  // PIX so custa quando entrou pela maquininha (linha 'Transacao' da Stone).
  if (p.metodo === 'pix' && p.via_stone === true) return 'pix';
  return null;
}

const parcelasDe = (p: PagamentoBase, modalidade: string) =>
  modalidade === 'credito' ? Math.max(1, Math.trunc(Number(p.parcelas)) || 1) : 1;

/**
 * Linha da tabela que vale pro pagamento: modalidade, faixa de parcelas e
 * vigencia na data (BRT) do pagamento. Varias vigentes -> a mais recente.
 */
export function escolherTaxa(p: PagamentoBase, tabela: TaxaMaquininha[]): TaxaMaquininha | null {
  const modalidade = modalidadeDe(p);
  if (!modalidade) return null;
  const n = parcelasDe(p, modalidade);
  const data = dataBRT(p.data_pagamento);
  const aplicaveis = tabela.filter(t =>
    t.modalidade === modalidade &&
    n >= t.parcelas_de && n <= t.parcelas_ate &&
    t.vigencia_inicio <= data && data <= (t.vigencia_fim ?? SEM_FIM));
  if (aplicaveis.length === 0) return null;
  aplicaveis.sort((a, b) =>
    b.vigencia_inicio.localeCompare(a.vigencia_inicio) ||
    (a.parcelas_ate - a.parcelas_de) - (b.parcelas_ate - b.parcelas_de));
  return aplicaveis[0];
}

function custoZero(fonte: FonteCusto, valor: number, dataLiquidacao: string): CustoPagamento {
  return {
    fonte,
    taxa_pct: 0,
    antecipacao_pct: 0,
    taxa_valor: 0,
    antecipacao_valor: 0,
    custo_bruto: 0,
    reembolso_pct: 0,
    reembolso_previsto: 0,
    reembolso_base_pendente: false,
    custo_liquido_previsto: 0,
    liquido_recebido: arred2(valor),
    data_liquidacao: dataLiquidacao,
    taxa_id: null,
  };
}

/**
 * Custo estimado de um pagamento pela tabela.
 *   taxa        = valor x taxa%
 *   antecipacao = flat: valor x pct ; por_mes: soma, parcela a parcela, de
 *                 (valor/n) x pct x dias antecipados/30, onde a parcela k
 *                 seria paga em 30k dias e a Stone paga em dias_liquidacao
 *   reembolso   = (taxa + antecipacao) x reembolso% (acordo Votoran; base
 *                 'itens_votoran' ainda nao calculada -> 0 e flag pendente)
 * Estorno (valor < 0): custo 0, salvo devolve_taxa_no_estorno.
 */
export function calcularCusto(p: PagamentoBase, tabela: TaxaMaquininha[]): CustoPagamento {
  const valor = Number(p.valor) || 0;
  const dataPag = dataBRT(p.data_pagamento);
  const modalidade = modalidadeDe(p);
  if (!modalidade) return custoZero('nao_se_aplica', valor, dataPag);
  const taxa = escolherTaxa(p, tabela);
  if (!taxa) return custoZero('sem_tabela', valor, dataPag);

  const dataLiq = proximoDiaLiquidacao(dataPag, taxa.dias_liquidacao);
  if (valor < 0 && !taxa.devolve_taxa_no_estorno) {
    return { ...custoZero('tabela', valor, dataLiq), taxa_pct: taxa.taxa_percentual, reembolso_pct: taxa.reembolso_percentual, taxa_id: taxa.id };
  }

  const n = parcelasDe(p, modalidade);
  const taxaValor = valor * taxa.taxa_percentual / 100;
  let antecipacao = 0;
  if (taxa.antecipacao_percentual > 0) {
    if (taxa.antecipacao_modo === 'flat') {
      antecipacao = valor * taxa.antecipacao_percentual / 100;
    } else {
      for (let k = 1; k <= n; k++) {
        antecipacao += (valor / n) * (taxa.antecipacao_percentual / 100) * Math.max(0, 30 * k - taxa.dias_liquidacao) / 30;
      }
    }
  }
  const custoBruto = taxaValor + antecipacao;
  const pendente = taxa.base_reembolso === 'itens_votoran' && taxa.reembolso_percentual > 0;
  const reembolso = pendente ? 0 : custoBruto * taxa.reembolso_percentual / 100;

  return {
    fonte: 'tabela',
    taxa_pct: taxa.taxa_percentual,
    antecipacao_pct: valor !== 0 ? arred3((antecipacao / valor) * 100) : 0,
    taxa_valor: arred2(taxaValor),
    antecipacao_valor: arred2(antecipacao),
    custo_bruto: arred2(custoBruto),
    reembolso_pct: taxa.reembolso_percentual,
    reembolso_previsto: arred2(reembolso),
    reembolso_base_pendente: pendente,
    custo_liquido_previsto: arred2(custoBruto - reembolso),
    liquido_recebido: arred2(valor - custoBruto),
    data_liquidacao: dataLiq,
    taxa_id: taxa.id,
  };
}

/**
 * Custo REAL vindo da API de Conciliacao da Stone (fase 2). O reembolso
 * continua vindo da tabela (e acordo com a Votoran, a Stone nao sabe dele).
 */
export function custoReal(
  p: PagamentoBase,
  venda: { valor_liquido: number; taxa_mdr: number; taxa_antecipacao: number; previsao_pagamento: string | null },
  tabela: TaxaMaquininha[] = [],
): CustoPagamento {
  const valor = Number(p.valor) || 0;
  const taxa = escolherTaxa(p, tabela);
  const taxaValor = Number(venda.taxa_mdr) || 0;
  const antecipacao = Number(venda.taxa_antecipacao) || 0;
  const custoBruto = taxaValor + antecipacao;
  const reembolsoPct = taxa?.reembolso_percentual ?? 0;
  const pendente = taxa?.base_reembolso === 'itens_votoran' && reembolsoPct > 0;
  const reembolso = pendente ? 0 : custoBruto * reembolsoPct / 100;
  return {
    fonte: 'stone',
    taxa_pct: valor !== 0 ? arred3((taxaValor / valor) * 100) : 0,
    antecipacao_pct: valor !== 0 ? arred3((antecipacao / valor) * 100) : 0,
    taxa_valor: arred2(taxaValor),
    antecipacao_valor: arred2(antecipacao),
    custo_bruto: arred2(custoBruto),
    reembolso_pct: reembolsoPct,
    reembolso_previsto: arred2(reembolso),
    reembolso_base_pendente: pendente,
    custo_liquido_previsto: arred2(custoBruto - reembolso),
    liquido_recebido: arred2(Number(venda.valor_liquido) || 0),
    data_liquidacao: venda.previsao_pagamento ?? dataBRT(p.data_pagamento),
    taxa_id: taxa?.id ?? null,
  };
}

const ORDEM_MODALIDADE: Record<string, number> = { debito: 0, credito: 1, pix: 2 };

/**
 * Agrega custos. So entram pagamentos de maquininha (debito, credito e PIX
 * via Stone). `tabela` e opcional: com ela a faixa vem da linha da tabela
 * (ex.: credito 2-3); sem ela cada numero de parcelas vira uma faixa.
 */
export function resumirCustos(
  itens: Array<{ pagamento: PagamentoBase; custo: CustoPagamento }>,
  tabela: TaxaMaquininha[] = [],
): ResumoMaquininha {
  const porId = new Map(tabela.map(t => [t.id, t]));
  type Faixa = FaixaMaquininha & { volume_real: number; custo_real: number };
  const faixas = new Map<string, Faixa>();
  const r = {
    volume_bruto: 0, volume_debito: 0, volume_credito: 0, volume_pix_stone: 0, qtd: 0,
    taxas: 0, antecipacao: 0, custo_bruto: 0, reembolso_previsto: 0, custo_liquido_previsto: 0,
    liquido_recebido: 0, volume_real: 0, volume_credito_sem_parcelas: 0, sem_tabela: false,
  };

  for (const { pagamento: p, custo: c } of itens) {
    const modalidade = modalidadeDe(p);
    if (!modalidade) continue;
    const valor = Number(p.valor) || 0;
    r.qtd++;
    r.volume_bruto += valor;
    if (modalidade === 'debito') r.volume_debito += valor;
    else if (modalidade === 'credito') {
      r.volume_credito += valor;
      if (p.parcelas_informadas !== true) r.volume_credito_sem_parcelas += valor;
    } else r.volume_pix_stone += valor;
    r.taxas += c.taxa_valor;
    r.antecipacao += c.antecipacao_valor;
    r.custo_bruto += c.custo_bruto;
    r.reembolso_previsto += c.reembolso_previsto;
    r.custo_liquido_previsto += c.custo_liquido_previsto;
    r.liquido_recebido += c.liquido_recebido;
    if (c.fonte === 'sem_tabela') r.sem_tabela = true;
    if (c.fonte === 'stone') r.volume_real += valor;

    const t = c.taxa_id ? porId.get(c.taxa_id) : undefined;
    const n = parcelasDe(p, modalidade);
    const de = t?.parcelas_de ?? n;
    const ate = t?.parcelas_ate ?? n;
    const chave = `${modalidade}|${de}|${ate}`;
    let f = faixas.get(chave);
    if (!f) {
      f = {
        modalidade, parcelas_de: de, parcelas_ate: ate, volume: 0, qtd: 0, custo_bruto: 0,
        reembolso_previsto: 0, custo_liquido_previsto: 0,
        taxa_tabela_pct: t ? t.taxa_percentual : null, taxa_efetiva_pct: null, volume_real: 0, custo_real: 0,
      };
      faixas.set(chave, f);
    }
    f.volume += valor;
    f.qtd++;
    f.custo_bruto += c.custo_bruto;
    f.reembolso_previsto += c.reembolso_previsto;
    f.custo_liquido_previsto += c.custo_liquido_previsto;
    if (c.fonte === 'stone') { f.volume_real += valor; f.custo_real += c.custo_bruto; }
  }

  const por_faixa: FaixaMaquininha[] = [...faixas.values()]
    .sort((a, b) => (ORDEM_MODALIDADE[a.modalidade] ?? 9) - (ORDEM_MODALIDADE[b.modalidade] ?? 9) || a.parcelas_de - b.parcelas_de)
    .map(f => ({
      modalidade: f.modalidade,
      parcelas_de: f.parcelas_de,
      parcelas_ate: f.parcelas_ate,
      volume: arred2(f.volume),
      qtd: f.qtd,
      custo_bruto: arred2(f.custo_bruto),
      reembolso_previsto: arred2(f.reembolso_previsto),
      custo_liquido_previsto: arred2(f.custo_liquido_previsto),
      taxa_tabela_pct: f.taxa_tabela_pct,
      taxa_efetiva_pct: f.volume_real > 0 ? arred3((f.custo_real / f.volume_real) * 100) : null,
    }));

  return {
    volume_bruto: arred2(r.volume_bruto),
    volume_debito: arred2(r.volume_debito),
    volume_credito: arred2(r.volume_credito),
    volume_pix_stone: arred2(r.volume_pix_stone),
    qtd: r.qtd,
    taxas: arred2(r.taxas),
    antecipacao: arred2(r.antecipacao),
    custo_bruto: arred2(r.custo_bruto),
    reembolso_previsto: arred2(r.reembolso_previsto),
    custo_liquido_previsto: arred2(r.custo_liquido_previsto),
    liquido_recebido: arred2(r.liquido_recebido),
    cobertura_real_pct: r.volume_bruto > 0 ? arred2((r.volume_real / r.volume_bruto) * 100) : 0,
    volume_credito_sem_parcelas: arred2(r.volume_credito_sem_parcelas),
    sem_tabela: r.sem_tabela,
    por_faixa,
  };
}

// ------------------------------------------------------------
// Banco
// ------------------------------------------------------------

function mapearTaxa(r: Row): TaxaMaquininha {
  return {
    id: String(r.id),
    adquirente: String(r.adquirente || 'stone'),
    modalidade: r.modalidade,
    parcelas_de: Number(r.parcelas_de) || 1,
    parcelas_ate: Number(r.parcelas_ate) || 1,
    taxa_percentual: Number(r.taxa_percentual) || 0,
    antecipacao_modo: r.antecipacao_modo === 'flat' ? 'flat' : 'por_mes',
    antecipacao_percentual: Number(r.antecipacao_percentual) || 0,
    dias_liquidacao: Number(r.dias_liquidacao) || 0,
    reembolso_percentual: Number(r.reembolso_percentual) || 0,
    base_reembolso: r.base_reembolso === 'itens_votoran' ? 'itens_votoran' : 'todas_vendas',
    teto_reembolso_mensal: r.teto_reembolso_mensal == null ? null : Number(r.teto_reembolso_mensal),
    devolve_taxa_no_estorno: r.devolve_taxa_no_estorno === true,
    vigencia_inicio: String(r.vigencia_inicio),
    vigencia_fim: r.vigencia_fim ? String(r.vigencia_fim) : null,
    observacoes: (r.observacoes as string | null) ?? null,
    criado_em: String(r.criado_em ?? ''),
  };
}

/** Todas as linhas (vigentes e passadas), em ordem de modalidade/faixa/vigencia. */
export async function carregarTaxas(): Promise<TaxaMaquininha[]> {
  const { data, error } = await supabaseAdmin
    .from('taxas_maquininha')
    .select('*')
    .order('modalidade')
    .order('parcelas_de')
    .order('vigencia_inicio');
  if (error) throw new Error(error.message);
  return ((data || []) as Row[]).map(mapearTaxa);
}

export function taxasVigentes(tabela: TaxaMaquininha[], data: string = SEM_FIM): TaxaMaquininha[] {
  const ref = data === SEM_FIM ? SEM_FIM : data;
  return tabela.filter(t => t.vigencia_fim === null || t.vigencia_fim >= ref);
}

const MODALIDADES = ['debito', 'credito', 'pix'];
const chaveFaixa = (t: { adquirente?: string; modalidade: string; parcelas_de: number; parcelas_ate: number }) =>
  `${t.adquirente || 'stone'}|${t.modalidade}|${t.parcelas_de}|${t.parcelas_ate}`;

function mesmaTaxa(a: TaxaMaquininha, b: TaxaMaquininhaEntrada): boolean {
  return a.taxa_percentual === Number(b.taxa_percentual)
    && a.antecipacao_modo === b.antecipacao_modo
    && a.antecipacao_percentual === Number(b.antecipacao_percentual)
    && a.dias_liquidacao === Number(b.dias_liquidacao)
    && a.reembolso_percentual === Number(b.reembolso_percentual)
    && a.base_reembolso === b.base_reembolso
    && (a.teto_reembolso_mensal ?? null) === (b.teto_reembolso_mensal == null ? null : Number(b.teto_reembolso_mensal))
    && a.devolve_taxa_no_estorno === Boolean(b.devolve_taxa_no_estorno);
}

function validarEntrada(novas: TaxaMaquininhaEntrada[]): void {
  const pct = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  for (const n of novas) {
    if (!MODALIDADES.includes(n.modalidade)) throw new ErroFinanceiro(400, `Modalidade inválida: ${n.modalidade}`);
    const de = Number(n.parcelas_de), ate = Number(n.parcelas_ate);
    if (!Number.isInteger(de) || de < 1 || !Number.isInteger(ate) || ate < de) {
      throw new ErroFinanceiro(400, `Faixa de parcelas inválida em ${n.modalidade} (${n.parcelas_de}–${n.parcelas_ate}).`);
    }
    if (!pct(n.taxa_percentual) || !pct(n.antecipacao_percentual) || !pct(n.reembolso_percentual)) {
      throw new ErroFinanceiro(400, `Percentual inválido em ${n.modalidade} ${de}–${ate}x.`);
    }
    if (!['flat', 'por_mes'].includes(n.antecipacao_modo)) throw new ErroFinanceiro(400, 'Modo de antecipação inválido.');
    if (!['todas_vendas', 'itens_votoran'].includes(n.base_reembolso)) throw new ErroFinanceiro(400, 'Base de reembolso inválida.');
    if (!Number.isInteger(Number(n.dias_liquidacao)) || Number(n.dias_liquidacao) < 0) throw new ErroFinanceiro(400, 'Dias de liquidação inválidos.');
  }
  // Duas faixas da mesma modalidade nao podem cobrir o mesmo numero de parcelas.
  const porMod = new Map<string, TaxaMaquininhaEntrada[]>();
  for (const n of novas) {
    const k = `${n.adquirente || 'stone'}|${n.modalidade}`;
    const lista = porMod.get(k);
    if (lista) lista.push(n); else porMod.set(k, [n]);
  }
  for (const [k, lista] of porMod) {
    lista.sort((a, b) => a.parcelas_de - b.parcelas_de);
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].parcelas_de <= lista[i - 1].parcelas_ate) {
        throw new ErroFinanceiro(400, `Faixas de parcelas sobrepostas em ${k.split('|')[1]}.`);
      }
    }
  }
}

/**
 * Salva a tabela que passa a valer em `vigenciaInicio`.
 *
 * Versiona: linha vigente que mudou ou saiu ganha vigencia_fim = vespera;
 * linha nova ou alterada entra com vigencia_inicio = vigenciaInicio; linha
 * identica fica como esta (so observacoes pode mudar no lugar). Nunca
 * reescreve numero de uma linha que ja valeu antes da data informada —
 * uma linha vigente que comece depois de vigenciaInicio e "fechada" com fim
 * < inicio e simplesmente deixa de casar (fica so como historico).
 */
export async function salvarTaxas(
  novas: TaxaMaquininhaEntrada[],
  vigenciaInicio: string,
  usuarioId: string | null = null,
): Promise<TaxaMaquininha[]> {
  if (!ehData(vigenciaInicio)) throw new ErroFinanceiro(400, 'Informe a data de início da vigência (AAAA-MM-DD).');
  validarEntrada(novas);

  const atuais = await carregarTaxas();
  const vigentes = atuais.filter(t => t.vigencia_fim === null);
  const novasPorChave = new Map(novas.map(n => [chaveFaixa(n), n]));

  const fechar: string[] = [];
  const soObservacao: Array<{ id: string; observacoes: string | null }> = [];
  for (const v of vigentes) {
    const n = novasPorChave.get(chaveFaixa(v));
    if (!n || !mesmaTaxa(v, n)) fechar.push(v.id);
    else if ((n.observacoes ?? null) !== (v.observacoes ?? null)) soObservacao.push({ id: v.id, observacoes: n.observacoes ?? null });
  }
  const inserir = novas
    .filter(n => {
      const v = vigentes.find(x => chaveFaixa(x) === chaveFaixa(n));
      return !v || !mesmaTaxa(v, n);
    })
    .map(n => ({
      adquirente: n.adquirente || 'stone',
      modalidade: n.modalidade,
      parcelas_de: Number(n.parcelas_de),
      parcelas_ate: Number(n.parcelas_ate),
      taxa_percentual: Number(n.taxa_percentual),
      antecipacao_modo: n.antecipacao_modo,
      antecipacao_percentual: Number(n.antecipacao_percentual),
      dias_liquidacao: Number(n.dias_liquidacao),
      reembolso_percentual: Number(n.reembolso_percentual),
      base_reembolso: n.base_reembolso,
      teto_reembolso_mensal: n.teto_reembolso_mensal == null ? null : Number(n.teto_reembolso_mensal),
      devolve_taxa_no_estorno: Boolean(n.devolve_taxa_no_estorno),
      vigencia_inicio: vigenciaInicio,
      vigencia_fim: null,
      observacoes: n.observacoes ?? null,
    }));

  if (fechar.length > 0) {
    const { error } = await supabaseAdmin
      .from('taxas_maquininha')
      .update({ vigencia_fim: somarDias(vigenciaInicio, -1) })
      .in('id', fechar);
    if (error) throw new Error(error.message);
  }
  if (inserir.length > 0) {
    const { error } = await supabaseAdmin.from('taxas_maquininha').insert(inserir);
    if (error) throw new Error(error.message);
  }
  for (const o of soObservacao) {
    await supabaseAdmin.from('taxas_maquininha').update({ observacoes: o.observacoes }).eq('id', o.id);
  }

  await registrarEvento({
    entidade: 'taxa',
    acao: 'editar',
    antes: vigentes,
    depois: { vigencia_inicio: vigenciaInicio, fechadas: fechar.length, inseridas: inserir.length, taxas: novas },
    usuario_id: usuarioId,
  });
  return carregarTaxas();
}

/**
 * Pagamentos do intervalo [deUtc, ateUtc) com `via_stone` resolvido: PIX
 * cuja linha 'Transacao' da Stone ja foi conciliada (pagamento_id).
 */
export async function carregarPagamentos(deUtc: string, ateUtc: string): Promise<PagamentoRow[]> {
  const rows = await lerTudo<Row>(() => supabaseAdmin
    .from('pagamentos')
    .select(SELECT_PAGAMENTO)
    .gte('data_pagamento', deUtc)
    .lt('data_pagamento', ateUtc)
    .order('data_pagamento', { ascending: true }));
  if (rows.length === 0) return [];

  const viaStone = new Set<string>();
  try {
    const linhas = await lerTudo<Row>(() => supabaseAdmin
      .from('lancamentos_bancarios')
      .select('pagamento_id, contas_financeiras!inner ( tipo )')
      .eq('contas_financeiras.tipo', 'adquirente')
      .not('pagamento_id', 'is', null)
      .gte('data', somarDias(dataBRT(deUtc), -3))
      .lte('data', somarDias(dataBRT(ateUtc), 3)));
    for (const l of linhas) if (l.pagamento_id) viaStone.add(String(l.pagamento_id));
  } catch (e) {
    console.error('[financeiro/taxas] nao consegui resolver PIX via Stone:', e);
  }
  return rows.map(r => paraPagamentoRow(r, viaStone.has(String(r.id))));
}

type VendaStoneCusto = { valor_liquido: number; taxa_mdr: number; taxa_antecipacao: number; previsao_pagamento: string | null };

/**
 * stone_vendas casadas com esses pagamentos (fase 2), por pagamento_id.
 * Falha de leitura so loga: o custo cai pra estimativa da tabela.
 */
async function vendasStonePorPagamento(ids: string[]): Promise<Map<string, VendaStoneCusto>> {
  const mapa = new Map<string, VendaStoneCusto>();
  if (ids.length === 0) return mapa;
  try {
    const rows = await lerTudoEmLotes<Row>(ids, lote => supabaseAdmin
      .from('stone_vendas')
      .select('pagamento_id, valor_liquido, taxa_mdr, taxa_antecipacao, previsao_pagamento')
      .in('pagamento_id', lote));
    for (const r of rows) {
      if (!r.pagamento_id) continue;
      mapa.set(String(r.pagamento_id), {
        valor_liquido: Number(r.valor_liquido) || 0,
        taxa_mdr: Number(r.taxa_mdr) || 0,
        taxa_antecipacao: Number(r.taxa_antecipacao) || 0,
        previsao_pagamento: r.previsao_pagamento ? String(r.previsao_pagamento) : null,
      });
    }
  } catch (e) {
    console.error('[financeiro/taxas] nao consegui ler stone_vendas:', e);
  }
  return mapa;
}

/**
 * Pagamentos do periodo com o custo calculado: real (custoReal, fonte
 * 'stone') quando a venda da API da Stone ja esta casada com o pagamento;
 * senao estimado pela tabela vigente na data (calcularCusto).
 */
export async function custosDoPeriodo(
  deUtc: string,
  ateUtc: string,
  tabela?: TaxaMaquininha[],
): Promise<Array<{ pagamento: PagamentoRow; custo: CustoPagamento }>> {
  const [pagamentos, taxas] = await Promise.all([carregarPagamentos(deUtc, ateUtc), tabela ? Promise.resolve(tabela) : carregarTaxas()]);
  const idsCartao = pagamentos.filter(p => p.metodo === 'debito' || p.metodo === 'credito').map(p => p.id);
  const vendas = await vendasStonePorPagamento(idsCartao);
  return pagamentos.map(p => {
    const venda = vendas.get(p.id);
    return { pagamento: p, custo: venda ? custoReal(p, venda, taxas) : calcularCusto(p, taxas) };
  });
}
