// Contratos do modulo financeiro (API <-> UI <-> lib).
//
// Este arquivo e a fonte da verdade dos formatos trocados entre as rotas
// /api/financeiro/* e a tela /financeiro. So tipos puros: nada de runtime.
// Quem precisa de calculo importa daqui; daqui nao se importa nada do resto.

import type { LancamentoBruto, ResultadoParse } from '@/lib/extrato-parser';

// ------------------------------------------------------------
// Basicos
// ------------------------------------------------------------
export type Metodo = 'pix' | 'dinheiro' | 'credito' | 'debito' | 'boleto' | 'transferencia' | 'outro';
export type Papel = 'admin' | 'atendente' | 'motorista';
export type TipoConta = 'banco' | 'adquirente' | 'caixa' | 'cartao_credito';
export type LayoutConta = 'itau_xlsx' | 'stone_csv' | 'generico' | 'manual' | 'ofx';
export type GrupoCategoria =
  | 'receita' | 'cmv' | 'custo_variavel' | 'custo_fixo' | 'imposto'
  | 'taxa_financeira' | 'servico_divida' | 'socio' | 'transferencia' | 'nao_operacional';
export type GrupoDespesaFixa = 'folha' | 'estrutura' | 'operacao' | 'comercial' | 'imposto_socios' | 'divida' | 'outro';
// Taxonomia do Fechamento: GrupoDespesaFixa + grupos so de realizado.
export type GrupoGestao = GrupoDespesaFixa | 'cmv_compras' | 'taxas';
export type TipoFornecedor = 'fornecedor' | 'servico' | 'imposto' | 'divida' | 'socio' | 'outro';
export type StatusContaPagar = 'pendente' | 'pago' | 'cancelado';
export type SituacaoConta = 'atrasada' | 'hoje' | 'a_vencer' | 'paga' | 'cancelada' | 'confirmar';
export type OrigemContaPagar = 'fixa' | 'manual' | 'fatura';
export type Confianca = 'alta' | 'media';
export type FonteCusto = 'tabela' | 'stone' | 'sem_tabela' | 'nao_se_aplica';

export interface Categoria {
  id: string;
  nome: string;
  grupo: GrupoCategoria;
  grupo_gestao: GrupoGestao | null;
  entra_no_dre: boolean;
}

export interface ContaFinanceira {
  id: string;
  nome: string;
  tipo: TipoConta;
  layout: LayoutConta;
  instituicao: string | null;
  dia_fechamento: number | null;
  dia_vencimento: number | null;
  ativo: boolean;
  ordem: number;
}

export interface Fornecedor {
  id: string;
  nome: string;
  documentos: string[];
  tipo: TipoFornecedor;
  categoria_padrao_id: string | null;
  categoria_padrao_nome: string | null;
  conta_padrao_id: string | null;
  metodo_padrao: Metodo | null;
  observacoes: string | null;
  ativo: boolean;
}

export interface NovoFornecedor {
  nome: string;
  documentos?: string[];
  tipo?: TipoFornecedor;
  categoria_padrao_id?: string | null;
  conta_padrao_id?: string | null;
  metodo_padrao?: Metodo | null;
  observacoes?: string | null;
  ativo?: boolean;
}

// Carregado uma vez pela tela; alimenta selects e regras de exibicao.
export interface ContextoFinanceiro {
  hoje: string;
  papel: Papel;
  categorias: Categoria[];
  contas: ContaFinanceira[];
  fornecedores: Fornecedor[];
  taxas_vigentes: TaxaMaquininha[];
  tem_taxas: boolean;
  tem_cnpj_proprio: boolean;
  conta_caixa_id: string | null;
  conta_cartao_id: string | null;
}

// ------------------------------------------------------------
// Despesas fixas
// ------------------------------------------------------------
export interface DespesaFixa {
  id: string;
  nome: string;
  grupo: GrupoDespesaFixa;
  categoria_id: string | null;
  categoria_nome: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  tipo_valor: 'fixo' | 'pct_faturamento';
  valor: number;                 // tipo fixo (fonte 'funcionarios': soma dos salarios ativos)
  percentual: number | null;     // tipo pct_faturamento
  valor_juros: number;
  dia_vencimento: number;
  inicio: string;
  fim: string | null;
  parcelas_total: number | null;
  parcelas_restantes: number | null;
  fonte: 'manual' | 'planilha' | 'funcionarios';
  gera_conta: boolean;
  ativo: boolean;
  observacoes: string | null;
  ordem: number;
  valor_no_mes: number;          // valor efetivo no mes consultado (0 fora de inicio/fim)
  detalhe_folha?: { funcionarios: number; salarios: number; encargos_estimados: number };
}

export interface NovaDespesaFixa {
  nome: string;
  grupo: GrupoDespesaFixa;
  categoria_id?: string | null;
  fornecedor_id?: string | null;
  tipo_valor?: 'fixo' | 'pct_faturamento';
  valor?: number;
  percentual?: number | null;
  valor_juros?: number;
  dia_vencimento?: number;
  inicio?: string;
  fim?: string | null;
  parcelas_total?: number | null;
  gera_conta?: boolean;
  ativo?: boolean;
  observacoes?: string | null;
  ordem?: number;
}

export interface TotaisDespesasFixas {
  mes: string;
  por_grupo: Record<GrupoDespesaFixa, number>;
  total: number;
  total_sem_divida: number;
  divida: number;
  folha: number;
  encargos_estimados: number;
}

export interface GeracaoMes {
  mes: string;
  geradas: number;
  ja_existiam: number;
  atualizadas: number;
  ignoradas_sem_valor: string[];   // nomes das despesas sem valor
  retroativas: number;             // nasceram com precisa_confirmacao
  itens: ContaPagar[];
}

// ------------------------------------------------------------
// Contas a pagar
// ------------------------------------------------------------
export interface ContaPagar {
  id: string;
  descricao: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  categoria_grupo: GrupoCategoria | null;
  grupo_gestao: GrupoGestao | null;
  valor: number;
  vencimento: string;
  competencia: string;
  status: StatusContaPagar;
  situacao: SituacaoConta;
  dias_atraso: number;
  data_pagamento: string | null;
  valor_pago: number | null;
  ajuste: number;
  metodo_pagamento: Metodo | null;
  conta_id: string | null;
  conta_nome: string | null;
  conta_tipo: TipoConta | null;
  lancamento_id: string | null;     // linha de extrato/caixa/cartao vinculada (join reverso)
  despesa_fixa_id: string | null;
  origem: OrigemContaPagar;
  chave_recorrencia: string | null;
  grupo_parcelas_id: string | null;
  parcela_num: number | null;
  parcelas_total: number | null;
  editada_manualmente: boolean;
  precisa_confirmacao: boolean;
  documento: string | null;
  observacoes: string | null;
  estornado_em: string | null;
  estorno_motivo: string | null;
  criado_em: string;
}

export interface PagamentoConta {
  data_pagamento?: string;        // default hoje (BRT)
  valor_pago?: number;            // default valor
  metodo_pagamento: Metodo;
  conta_id: string | null;
  observacoes?: string | null;
}

export interface NovaContaPagar {
  descricao: string;
  fornecedor_id?: string | null;
  fornecedor_nome?: string;       // cria o fornecedor se nao existir
  categoria_id?: string | null;
  valor: number;
  vencimento: string;
  competencia?: string;           // 'YYYY-MM' ou 'YYYY-MM-DD'; default = mes do vencimento
  documento?: string | null;
  observacoes?: string | null;
  parcelas?: number;              // > 1 cria N contas mensais
  grupo_parcelas_id?: string;     // idempotencia do parcelado (gerado no front)
  pagamento?: PagamentoConta;     // "ja esta paga"
}

export interface FiltroContasPagar {
  status?: StatusContaPagar | 'todas';
  de?: string;
  ate?: string;
  competencia?: string;           // 'YYYY-MM'
  fornecedor_id?: string;
  categoria_id?: string;
  busca?: string;
  confirmar?: boolean;            // so as que precisam de confirmacao
}

export interface ResumoContasPagar {
  atrasado: number;
  qtd_atrasadas: number;
  hoje: number;
  qtd_hoje: number;
  proximos_7d: number;
  proximos_30d: number;
  pendente_total: number;
  pago_no_mes: number;            // exclui faturas (grupo transferencia)
  a_confirmar: number;            // retroativas aguardando "ja pagou?"
}

export interface ItemFolhaPrevisto {
  funcionario_id: string;
  nome: string;
  frequencia: string;
  periodo_inicio: string;
  periodo_fim: string;
  data_pagamento: string;
  bruto: number;
  vales: number;
  liquido: number;
}

// ------------------------------------------------------------
// Maquininha e taxas
// ------------------------------------------------------------
export interface TaxaMaquininha {
  id: string;
  adquirente: string;
  modalidade: 'debito' | 'credito' | 'pix';
  parcelas_de: number;
  parcelas_ate: number;
  taxa_percentual: number;
  antecipacao_modo: 'flat' | 'por_mes';
  antecipacao_percentual: number;
  dias_liquidacao: number;
  reembolso_percentual: number;
  base_reembolso: 'todas_vendas' | 'itens_votoran';
  teto_reembolso_mensal: number | null;
  devolve_taxa_no_estorno: boolean;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  observacoes: string | null;
  criado_em: string;
}
export type TaxaMaquininhaEntrada = Omit<TaxaMaquininha, 'id' | 'criado_em' | 'vigencia_inicio' | 'vigencia_fim'> & {
  id?: string;
  vigencia_inicio?: string;
  vigencia_fim?: string | null;
};

export interface PagamentoBase {
  id?: string;
  valor: number;
  metodo: string;
  parcelas: number;
  parcelas_informadas?: boolean;
  data_pagamento: string;         // ISO timestamptz
  via_stone?: boolean;            // PIX conciliado com linha 'Transacao' da Stone
}

export interface CustoPagamento {
  fonte: FonteCusto;
  taxa_pct: number;
  antecipacao_pct: number;
  taxa_valor: number;
  antecipacao_valor: number;
  custo_bruto: number;
  reembolso_pct: number;
  reembolso_previsto: number;
  reembolso_base_pendente: boolean;   // base 'itens_votoran' ainda nao implementada
  custo_liquido_previsto: number;
  liquido_recebido: number;
  data_liquidacao: string;
  taxa_id: string | null;
}

export interface FaixaMaquininha {
  modalidade: string;
  parcelas_de: number;
  parcelas_ate: number;
  volume: number;
  qtd: number;
  custo_bruto: number;
  reembolso_previsto: number;
  custo_liquido_previsto: number;
  taxa_tabela_pct: number | null;
  taxa_efetiva_pct: number | null;    // custo_bruto / volume dos pagamentos com fonte real
}

export interface ResumoMaquininha {
  volume_bruto: number;
  volume_debito: number;
  volume_credito: number;
  volume_pix_stone: number;
  qtd: number;
  taxas: number;
  antecipacao: number;
  custo_bruto: number;
  reembolso_previsto: number;
  custo_liquido_previsto: number;
  liquido_recebido: number;
  cobertura_real_pct: number;         // % do volume com custo real (stone)
  volume_credito_sem_parcelas: number;
  sem_tabela: boolean;
  por_faixa: FaixaMaquininha[];
}

export interface ResumoMaquininhaMes extends ResumoMaquininha {
  mes: string;
  tarifas_pix_stone: number;          // soma de lancamentos.tarifa da conta adquirente no mes
  taxa_efetiva_extrato_pct: number | null;   // 1 - liquidado/bruto no agregado do extrato Stone
  liquidado_extrato: number;
  reembolso_recebido: number;
  custo_liquido_realizado: number;    // custo_bruto - reembolso_recebido
  reembolsos: Reembolso[];
  por_dia: Array<{ data: string; volume: number; custo_bruto: number; custo_liquido_previsto: number }>;
  taxas_padrao_nao_conferidas: boolean;
}

export interface Reembolso {
  id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  referencia: string;
  valor: number;
  data_recebimento: string;
  forma: 'credito_compra' | 'pix' | 'transferencia' | 'desconto_boleto' | 'outro';
  observacoes: string | null;
}
export interface NovoReembolso {
  fornecedor_id?: string | null;
  referencia: string;             // 'YYYY-MM' ou 'YYYY-MM-DD'
  valor: number;
  data_recebimento: string;
  forma?: Reembolso['forma'];
  observacoes?: string | null;
}

// ------------------------------------------------------------
// Saldos
// ------------------------------------------------------------
export interface SaldoConta {
  conta_id: string;
  nome: string;
  tipo: TipoConta;
  saldo_base: number | null;
  data_base: string | null;
  origem: 'extrato' | 'manual' | 'conector' | 'calculado' | null;
  defasagem_dias: number | null;
  movimentos_apos_base: number;
  pagos_apos_base: number;
  folha_apos_base: number;
  saldo_estimado: number | null;
  fatura_aberta: number;          // so cartao_credito
}

// ------------------------------------------------------------
// Conciliacao
// ------------------------------------------------------------
export interface LancamentoResumo {
  id: string;
  conta_id: string;
  data: string;
  descricao: string;
  contraparte: string | null;
  documento: string | null;
  valor: number;
  tarifa: number;
  categoria_id: string | null;
  categoria_nome: string | null;
}

export interface CandidatoConciliacao {
  tipo: 'pagamento' | 'grupo' | 'conta_pagar' | 'folha' | 'vale';
  id: string;                     // pagamento_id | grupo_recebimento | conta_pagar_id | funcionario_pagamento_id | funcionario_vale_id
  ids?: string[];                 // tipo 'grupo': pagamentos do grupo
  descricao: string;
  valor: number;
  data: string;
  confianca: Confianca;
  diferenca_valor: number;
  diferenca_dias: number;
  motivo: string;                 // por que casou (documento, nome, categoria, valor exato...)
}

export interface SugestaoConciliacao {
  lancamento: LancamentoResumo;
  candidatos: CandidatoConciliacao[];
}

export interface CartaoAgregadoDia {
  data: string;
  liquidado: number;
  qtd_linhas: number;
  bruto_estimado: number;
  liquido_estimado: number;
  qtd_pagamentos: number;
  diferenca: number;
  taxa_efetiva_pct: number | null;
}

export interface VinculoAplicado {
  lancamento_id: string;
  tipo: 'pagamento' | 'conta_pagar' | 'folha' | 'vale' | 'estorno';
  id: string;
  descricao: string;
  valor: number;
  conta_marcada_paga: boolean;
}

export interface ResultadoConciliacao {
  conta_id: string;
  conta_tipo: TipoConta;
  de: string;
  ate: string;
  aplicados: VinculoAplicado[];
  sugestoes: SugestaoConciliacao[];
  cartao_agregado: CartaoAgregadoDia[];
  taxa_efetiva_periodo_pct: number | null;
  sem_par: { entradas: LancamentoResumo[]; saidas: LancamentoResumo[] };
  sistema_sem_banco: {
    pagamentos: Array<{ id: string; data: string; valor: number; metodo: Metodo; parcelas: number; codigo: string | null; cliente_nome: string }>;
    contas_pagas: Array<{ id: string; data: string; valor: number; descricao: string; fornecedor_nome: string | null }>;
    folha: Array<{ id: string; tipo: 'folha' | 'vale'; data: string; valor: number; nome: string }>;
  };
  totais: {
    linhas: number;
    ja_conciliadas: number;
    transferencias_ignoradas: number;
    conciliadas_agora: number;
    sugestoes: number;
    sem_par: number;
    conflitos: number;
    legado_ignorados: number;
  };
}

export interface VinculoManual {
  lancamento_id: string;
  pagamento_id?: string;
  conta_pagar_id?: string;
  funcionario_pagamento_id?: string;
  funcionario_vale_id?: string;
}

// ------------------------------------------------------------
// Importacao de extrato
// ------------------------------------------------------------
export interface EntradaImportacao {
  conta: { id: string; nome: string; layout: string };
  lancamentos: LancamentoBruto[];
  origem: 'extrato' | 'conector';
  arquivo: { nome: string; hash: string };
  saldo_final?: { data: string; saldo: number } | null;
  ignoradas?: ResultadoParse['ignoradas'];
}

export interface ResultadoImportacao {
  importacao_id: string | null;
  conta: string;
  periodo: [string | null, string | null];
  total: number;
  novos: number;
  duplicados: number;
  duplicados_por_conteudo: number;
  classificados_por_regra: number;
  classificados_por_ia: number;
  sem_categoria: number;
  a_revisar: number;
  ignoradas: Array<{ linha: number; motivo: string; conteudo: string }>;
  conciliacao: { conciliados: number; sugestoes: number; cartao_agregado_dias: number } | null;
  saldo_registrado: { data: string; saldo: number } | null;
  mensagem?: string;
}

// ------------------------------------------------------------
// Dia
// ------------------------------------------------------------
export interface DiaBase {
  data: string;
  sistema: {
    vendas_do_dia: number;
    qtd_pedidos: number;
    recebido_total: number;
    recebido_por_metodo: Record<string, number>;
  };
  contas: Array<{ nome: string; tipo: string; entrou: number; saiu: number }>;
  caixa: {
    entrou_no_dia: number;
    saidas: Array<{ id?: string; descricao: string; contraparte: string | null; valor: number; categoria: string | null; origem?: string | null; vinculo?: 'conta_pagar' | 'folha' | 'vale' | null }>;
    total_saidas: number;
    saldo_esperado: number;
    falta_sincronizar: number;
    fechamento: { saldo_esperado: number; saldo_contado: number; diferenca: number } | null;
  };
  conferencia: { entrou_em_banco: number; recebido_no_sistema: number; nota: string };
}

export interface ItemPagoDia {
  tipo: 'conta_pagar' | 'folha' | 'vale' | 'caixa' | 'extrato' | 'cartao';
  id: string;
  descricao: string;
  fornecedor: string | null;
  categoria: string | null;
  grupo_gestao: GrupoGestao | null;
  valor: number;                  // positivo
  metodo: Metodo | null;
  conta_nome: string | null;
}

export interface DiaFinanceiro extends DiaBase {
  recebido_liquido: {
    bruto: number;
    taxas: number;
    antecipacao: number;
    tarifa_pix_stone: number;
    tarifa_pix_estimada: boolean;
    reembolso_previsto: number;
    liquido: number;
    por_metodo: Record<string, { bruto: number; liquido: number; qtd: number }>;
    sem_tabela: boolean;
  };
  pago: {
    total: number;
    por_metodo: Record<string, number>;
    itens: ItemPagoDia[];
  };
  pago_no_cartao: { total: number; itens: ItemPagoDia[] };
  liquido_dia: number;
  liquido_dia_status: 'completo' | 'parcial';
  extrato_ate: Record<string, string | null>;    // nome da conta -> ultima data com lancamento
  a_pagar_hoje: ContaPagar[];
  folha_hoje: ItemFolhaPrevisto[];
}

// ------------------------------------------------------------
// Fechamento mensal
// ------------------------------------------------------------
export interface GrupoFechamento {
  grupo: GrupoGestao;
  rotulo: string;
  orcado: number;
  realizado: number;
  provisao: boolean;
  itens: Array<{ descricao: string; valor: number; data: string | null; origem: 'conta_pagar' | 'folha' | 'vale' | 'extrato' | 'caixa' | 'orcado'; fornecedor: string | null }>;
}

export interface FechamentoMensal {
  mes: string;
  vendas: {
    faturamento: number;
    qtd_pedidos: number;
    cmv: number;
    lucro_bruto: number;
    margem_bruta_pct: number | null;
    receita_sem_custo: number;
    ticket_medio: number;
  };
  recebimentos: {
    por_metodo: Record<string, number>;
    total: number;
    maquininha: ResumoMaquininha;
    tarifa_pix_stone: number;
    reembolso_recebido: number;
    taxas_liquidas_previstas: number;
    taxas_liquidas_realizadas: number;
  };
  despesas: {
    grupos: GrupoFechamento[];
    total_orcado: number;
    total_realizado: number;
    folha_realizada: number;
    compras_pagas: number;        // cmv_compras, informativo
    juros_divida: number;
  };
  resultado: {
    orcado: { lucro_operacao: number; divida: number; caixa_livre: number };
    realizado: { lucro_operacao: number; divida: number; caixa_livre: number };
  };
  caixa: {
    saldo_inicial: number | null;
    entradas: number;
    saidas: number;
    saldo_final_calculado: number | null;
    saldo_final_informado: number | null;
    diferenca: number | null;
    saidas_por_tipo: Record<string, number>;
  };
  comparativo: { mes: string; faturamento: number; lucro_bruto: number; despesas_realizadas: number; caixa_livre_realizado: number } | null;
  qualidade: {
    contas_vencidas_pendentes: number;
    lancamentos_a_revisar: number;
    extrato_ate: Record<string, string | null>;
    possiveis_duplicidades: number;
    folha_ja_contada: number;
    receita_sem_custo_pct: number;
    taxas_sem_tabela: boolean;
    reembolso_pendente: number;
    pedidos_sem_pagamento: number;
  };
}

// ------------------------------------------------------------
// Panorama
// ------------------------------------------------------------
export interface Alerta {
  nivel: 'alto' | 'medio' | 'baixo';
  texto: string;
  secao: string;                  // chave da secao em /financeiro?secao=
}

export interface FluxoDia {
  data: string;
  entradas_contratadas: number;
  entradas_projetadas: number;
  saidas: number;
  saldo_projetado: number;        // com projetadas
  saldo_so_contratado: number;    // sem projetadas
  sem_saldo_base?: boolean;       // true: nenhum saldo informado, saldo_* e so variacao a partir de 0
}

export interface Panorama {
  hoje: string;
  checklist: {
    saldo_informado_hoje: boolean;
    contas_hoje: { pagas: number; total: number };
    extrato_ate: Array<{ conta: string; data: string | null; dias: number | null }>;
    sugestoes_pendentes: number;
    a_confirmar: number;
  };
  contas: SaldoConta[];
  total_disponivel: number | null;
  fatura_cartao_aberta: number;
  a_receber: { total: number; vencido: number; entregue_nao_pago: number; qtd: number; qtd_clientes: number };
  a_pagar: ResumoContasPagar & { folha_proxima: { valor: number; data: string } | null };
  dia: { recebido_bruto: number; taxas: number; recebido_liquido: number; pago: number; liquido_dia: number; status: 'completo' | 'parcial' };
  mes: {
    mes: string;
    faturamento: number;
    lucro_bruto: number;
    margem_pct: number | null;
    despesas_realizadas: number;
    resultado_parcial: number;
    projecao_faturamento: number;
    dias_uteis_passados: number;
    dias_uteis_total: number;
  };
  maquininha_mes: {
    volume: number;
    custo_estimado: number;
    taxa_efetiva_extrato_pct: number | null;
    reembolso_previsto: number;
    reembolso_recebido: number;
    custo_liquido_previsto: number;
  };
  fluxo_30d: FluxoDia[];
  entradas_atrasadas: number;
  alertas: Alerta[];
}

// ------------------------------------------------------------
// A receber (clientes)
// ------------------------------------------------------------
export interface ContaAberta {
  id: string;
  codigo: string | null;
  cliente_id: string | null;
  cliente_nome: string;
  cliente_telefone: string | null;
  total: number;
  valor_pago: number;
  saldo: number;
  status: string;
  status_pagamento: string | null;
  condicao_pagamento: string | null;
  vencimento: string | null;
  entregue_sem_pagamento: boolean;
  entregue: boolean;
  vencido: boolean;
  dias_em_aberto: number;
  criado_em: string | null;
}

export interface ResumoReceber {
  recebido_periodo: number;
  recebido_por_metodo: Record<string, number>;
  total_a_receber: number;
  vencido: number;
  a_vencer: number;
  sem_prazo: number;
  entregue_nao_pago: number;
  qtd_a_receber: number;
  qtd_vencidos: number;
  qtd_entregue_nao_pago: number;
}

// Mesmo formato do GET /api/financeiro atual.
export interface FinanceiroReceber {
  periodo_dias: number;
  resumo: ResumoReceber;
  em_aberto: ContaAberta[];
  triagem_parcial: Array<{ id: string; codigo: string | null; cliente_nome: string; total: number }>;
}

export interface ClienteAReceber {
  chave: string;                  // cliente_id | 'tel:<telefone>' | 'sem_cliente'
  cliente_id: string | null;
  nome: string;
  telefone: string | null;
  saldo_total: number;
  qtd_pedidos: number;
  maior_atraso_dias: number;
  tem_vencido: boolean;
  tem_entregue_nao_pago: boolean;
  pedidos: ContaAberta[];
}

export interface ReceberPorCliente {
  periodo_dias: number;
  resumo: ResumoReceber & { qtd_clientes: number };
  clientes: ClienteAReceber[];
}

export interface ReceberDoCliente {
  cliente_id?: string | null;
  telefone?: string | null;
  orcamento_id?: string | null;   // receber um pedido especifico
  valor: number;
  metodo: Metodo;
  parcelas?: number;
  data_pagamento?: string;        // so admin
  observacoes?: string | null;
}

export interface PagamentoCriado {
  id: string;
  orcamento_id: string;
  codigo: string | null;
  valor: number;
  metodo: Metodo;
  parcelas: number;
  saldo_restante: number;
}

// ------------------------------------------------------------
// Simulador
// ------------------------------------------------------------
export interface CustoFixoSimulado {
  nome: string;
  valor: number;
  mes_inicio?: number;            // 1-based, relativo ao cenario
  mes_fim?: number;
}

export interface DividaSimulada {
  nome: string;
  valor: number;
  parcelas_restantes: number;
}

export interface ParametrosCenario {
  nome: string;
  mes_inicio: string;             // 'YYYY-MM'
  meses: number;
  faturamento_mensal: number;
  margem_bruta_pct: number;       // 0-100
  crescimento_mensal_pct: number; // 0-100
  sazonalidade: { meses: number[]; fator: number };   // meses do calendario (1-12)
  custos_fixos: CustoFixoSimulado[];
  imposto_pct_faturamento: number;      // 0-100
  imposto_pct_apos_teto: number | null; // aliquota apos sair do Simples (null = ignorar teto)
  teto_anual: number;                   // default 4_800_000
  cartao: { participacao_pct: number; custo_liquido_pct: number };
  dividas: DividaSimulada[];
  caixa_inicial: number;
}

export interface LinhaSimulada {
  mes: string;
  indice: number;
  faturamento: number;
  lucro_bruto: number;
  custo_fixo: number;
  imposto: number;
  taxas: number;
  lucro_operacao: number;
  divida: number;
  caixa_livre: number;
  caixa_acumulado: number;
  acima_do_teto: boolean;
}

export interface ResultadoSimulacao {
  linhas: LinhaSimulada[];
  resumo: {
    caixa_no_periodo: number;
    pior_momento: number;
    pior_mes: string;
    media_mes: number;
    meses_no_vermelho: number;
    break_even_faturamento: number | null;
    break_even_por_dia_util: number | null;
  };
  alertas: string[];
}

export interface BaseSimulador {
  mes_inicio: string;
  faturamentos: Array<{ mes: string; faturamento: number; margem_pct: number | null }>;
  faturamento_ultimo_mes: number;
  faturamento_medio_6m: number;
  faturamento_melhor_mes: number;
  margem_media_pct: number;
  mix_cartao_pct: number;
  custo_cartao_liquido_pct: number;
  imposto_pct_atual: number;
  custos_fixos: CustoFixoSimulado[];
  folha: number;
  dividas: DividaSimulada[];
  caixa_inicial: number;
}

export interface CenarioSalvo {
  id: string;
  nome: string;
  parametros: ParametrosCenario;
  atualizado_em: string;
}

// ------------------------------------------------------------
// Fase 2 — API de Conciliacao Stone
// ------------------------------------------------------------
export interface StoneImportacao {
  stone_code: string;
  arquivo_data: string;
  status: 'ok' | 'vazio' | 'erro';
  transacoes: number;
  novas: number;
  liquidacoes: number;
  casadas: number;
  erro: string | null;
  criado_em: string;
}

export interface StatusStone {
  configurado: boolean;
  stone_codes: string[];
  ultimas_importacoes: StoneImportacao[];
  vendas_mes: { mes: string; qtd: number; bruto: number; liquido: number; taxas: number; casadas: number; sem_par: number };
}

// ------------------------------------------------------------
// Trilha
// ------------------------------------------------------------
export interface EventoFinanceiro {
  entidade: 'conta_pagar' | 'lancamento' | 'despesa_fixa' | 'pagamento' | 'taxa' | 'reembolso' | 'saldo' | 'fornecedor' | 'cenario';
  entidade_id?: string | null;
  acao: string;
  antes?: unknown;
  depois?: unknown;
  usuario_id?: string | null;
}
