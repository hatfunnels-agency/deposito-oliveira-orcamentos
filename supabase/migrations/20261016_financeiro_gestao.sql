-- ============================================================
-- Gestao financeira: fornecedores, despesas fixas, contas a pagar,
-- taxas da maquininha, saldos, conciliacao e trilha de eventos
-- 2026-10-16
--
-- Ate aqui o financeiro sabia o que ENTROU (pagamentos) e so descobria o
-- que SAIU lendo o extrato, depois do fato. Faltava o lado planejado: a
-- quem devemos, quando vence, quanto a maquininha come de cada venda e
-- quanto sobra no fim do dia. Este arquivo cria essa camada.
--
-- Desenho (uma linha por tabela nova):
--   fornecedores           quem recebe; CPF/CNPJ so digitos, varias filiais
--   despesas_fixas         a planilha de custos fixos dentro do banco; todo
--                          mes vira contas_pagar (gera_conta) ou so entra no
--                          orcado (provisao: diesel, manutencao, marketing)
--   contas_pagar           cada boleto/parcela/fatura: pendente -> pago;
--                          estorno volta pra pendente; pago nao se apaga
--   taxas_maquininha       tabela versionada por vigencia; o custo de cada
--                          venda e calculado na LEITURA, nunca gravado
--   reembolsos_fornecedor  taxa de cartao devolvida pelo fornecedor
--                          (previsto x recebido)
--   saldos_conta           saldo informado a mao ou lido do extrato, por data
--   cenarios_financeiros   simulador de 12 meses (parametros em jsonb)
--   financeiro_eventos     trilha append-only: pagar, estornar, vincular...
--   stone_*                fase 2: API de Conciliacao Stone, venda a venda
--
-- A regra que amarra tudo: lancamentos_bancarios.conta_pagar_id e a UNICA
-- fonte da verdade do par conta a pagar <-> linha (extrato, caixa ou
-- cartao). Uma conta casa com uma linha, um pagamento com uma linha, um
-- pagamento de funcionario com uma linha — indices unicos parciais abaixo.
-- Quem precisa do caminho inverso (ContaPagar.lancamento_id) faz join
-- reverso; nao existe coluna espelho pra desalinhar.
--
-- Repositorio publico: aqui so estrutura e nomes genericos. Valores, dias
-- de vencimento, prazos de divida, credores, taxas negociadas e CNPJs
-- ficam em Financeiro/seed-financeiro-privado.sql (pasta no .gitignore),
-- rodado direto no banco depois desta migration.
--
-- Idempotente: pode rodar de novo sem estragar (IF NOT EXISTS, ON CONFLICT
-- DO NOTHING, DROP CONSTRAINT IF EXISTS antes de recriar cada CHECK).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Contas: cartao de credito da empresa, layout OFX, ciclo da fatura
-- ------------------------------------------------------------
ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_tipo_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check
  CHECK (tipo IN ('banco', 'adquirente', 'caixa', 'cartao_credito'));

ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_layout_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_layout_check
  CHECK (layout IN ('itau_xlsx', 'stone_csv', 'generico', 'manual', 'ofx'));

-- dia_fechamento/dia_vencimento: so o cartao usa (ciclo da fatura).
-- ordem: posicao na tela.
ALTER TABLE contas_financeiras
  ADD COLUMN IF NOT EXISTS dia_fechamento integer CHECK (dia_fechamento BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS dia_vencimento integer CHECK (dia_vencimento BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS ordem          integer NOT NULL DEFAULT 100;

-- Compra no cartao da empresa e despesa no dia da compra, mas o dinheiro
-- so sai quando a fatura e paga. Sem uma conta propria pro cartao, a
-- despesa apareceria duas vezes (compra e fatura) ou nenhuma.
INSERT INTO contas_financeiras (nome, tipo, layout, instituicao, ordem)
SELECT 'Cartão de crédito (empresa)', 'cartao_credito', 'manual', 'Informar banco emissor', 40
WHERE NOT EXISTS (SELECT 1 FROM contas_financeiras WHERE tipo = 'cartao_credito');

-- Ordem de exibicao das contas que ja existiam (so quem esta no default).
UPDATE contas_financeiras SET ordem = 10 WHERE tipo = 'banco'      AND ordem = 100;
UPDATE contas_financeiras SET ordem = 20 WHERE tipo = 'adquirente' AND ordem = 100;
UPDATE contas_financeiras SET ordem = 30 WHERE tipo = 'caixa'      AND ordem = 100;

-- ------------------------------------------------------------
-- 2. Fornecedores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fornecedores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                text NOT NULL,
  -- CPF/CNPJ so digitos, como o extrato traz. Array porque o mesmo
  -- fornecedor cobra por varias filiais. Casar por documento e exato;
  -- por nome e aproximado.
  documentos          text[] NOT NULL DEFAULT '{}',
  tipo                text NOT NULL DEFAULT 'fornecedor'
                      CHECK (tipo IN ('fornecedor', 'servico', 'imposto', 'divida', 'socio', 'outro')),
  categoria_padrao_id uuid REFERENCES categorias_financeiras(id) ON DELETE SET NULL,
  -- Ultima conta/metodo usados pra pagar: o modal "Paguei" abre preenchido.
  conta_padrao_id     uuid REFERENCES contas_financeiras(id) ON DELETE SET NULL,
  metodo_padrao       text CHECK (metodo_padrao IN ('pix', 'dinheiro', 'credito', 'debito', 'boleto', 'transferencia', 'outro')),
  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fornecedores_nome_unico ON fornecedores (lower(nome));
ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3. Despesas fixas (a planilha de custos fixos, dentro do banco)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS despesas_fixas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  -- Linha do Fechamento onde cai. 'divida' fica ABAIXO do resultado da
  -- operacao; 'folha' e calculada de funcionarios, nao digitada aqui.
  grupo           text NOT NULL CHECK (grupo IN ('folha', 'estrutura', 'operacao', 'comercial', 'imposto_socios', 'divida', 'outro')),
  categoria_id    uuid REFERENCES categorias_financeiras(id) ON DELETE SET NULL,
  fornecedor_id   uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  tipo_valor      text NOT NULL DEFAULT 'fixo' CHECK (tipo_valor IN ('fixo', 'pct_faturamento')),
  valor           numeric(14,2) NOT NULL DEFAULT 0,  -- tipo 'fixo'
  percentual      numeric(6,3),                      -- tipo 'pct_faturamento': % do faturamento do mes anterior
  valor_juros     numeric(14,2) NOT NULL DEFAULT 0,  -- divida: parte da parcela que e juros (0 = nao informado)
  dia_vencimento  integer NOT NULL DEFAULT 5 CHECK (dia_vencimento BETWEEN 1 AND 31),
  inicio          date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  fim             date,                              -- 1o dia do ULTIMO mes (inclusive); null = sem fim
  parcelas_total  integer,
  fonte           text NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual', 'planilha', 'funcionarios')),
  -- false = provisao: entra no orcado do mes, mas nao vira boleto. O gasto
  -- real aparece pelo extrato/caixa, categorizado.
  gera_conta      boolean NOT NULL DEFAULT true,
  ativo           boolean NOT NULL DEFAULT true,
  observacoes     text,
  ordem           integer NOT NULL DEFAULT 100,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS despesas_fixas_nome_unico ON despesas_fixas (lower(nome));
ALTER TABLE despesas_fixas ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. Contas a pagar
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contas_pagar (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao            text NOT NULL,
  fornecedor_id        uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  categoria_id         uuid REFERENCES categorias_financeiras(id) ON DELETE SET NULL,
  valor                numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento           date NOT NULL,
  competencia          date NOT NULL,                   -- 1o dia do mes a que se refere
  status               text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  data_pagamento       date,
  valor_pago           numeric(14,2),
  ajuste               numeric(14,2) NOT NULL DEFAULT 0, -- valor_pago - valor: juros/multa > 0, desconto < 0
  metodo_pagamento     text CHECK (metodo_pagamento IN ('pix', 'dinheiro', 'credito', 'debito', 'boleto', 'transferencia', 'outro')),
  conta_id             uuid REFERENCES contas_financeiras(id) ON DELETE SET NULL,
  despesa_fixa_id      uuid REFERENCES despesas_fixas(id) ON DELETE SET NULL,
  -- Idempotencia da geracao automatica (upsert ignoreDuplicates):
  --   'despesa_fixa:<id>:<YYYY-MM>' | 'fatura:<conta_id>:<YYYY-MM>' | 'parcelado:<grupo>:<n>'
  chave_recorrencia    text UNIQUE,
  grupo_parcelas_id    uuid,
  parcela_num          integer,
  parcelas_total       integer,
  -- Mexeu em valor/vencimento a mao: a despesa fixa nao sobrescreve mais.
  editada_manualmente  boolean NOT NULL DEFAULT false,
  -- Gerada com vencimento no passado (primeira geracao daquela despesa):
  -- a tela pergunta "ja pagou?" antes de contar como atrasada.
  precisa_confirmacao  boolean NOT NULL DEFAULT false,
  documento            text,
  observacoes          text,
  estornado_em         timestamptz,
  estorno_motivo       text,
  criado_por           uuid,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cp_status_venc ON contas_pagar (status, vencimento);
CREATE INDEX IF NOT EXISTS idx_cp_pagamento   ON contas_pagar (data_pagamento) WHERE data_pagamento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_competencia ON contas_pagar (competencia);
CREATE INDEX IF NOT EXISTS idx_cp_fornecedor  ON contas_pagar (fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_cp_despesa     ON contas_pagar (despesa_fixa_id);
CREATE INDEX IF NOT EXISTS idx_cp_grupo_parc  ON contas_pagar (grupo_parcelas_id) WHERE grupo_parcelas_id IS NOT NULL;
ALTER TABLE contas_pagar ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE contas_pagar IS
  'Uma linha por boleto/parcela/fatura. Pago nao se apaga: estorno volta pra pendente e deixa estornado_em/estorno_motivo.';

-- ------------------------------------------------------------
-- 5. Lancamentos: vinculos (fonte unica da verdade) e novas origens
-- ------------------------------------------------------------
-- Origens novas: 'conta_pagar' (criado ao pagar uma conta em dinheiro ou
-- cartao), 'folha' (salario/vale pago em dinheiro ou cartao), 'conector'
-- (fase 2: linha vinda de API, nao de arquivo).
ALTER TABLE lancamentos_bancarios DROP CONSTRAINT IF EXISTS lancamentos_bancarios_origem_lancamento_check;
ALTER TABLE lancamentos_bancarios ADD CONSTRAINT lancamentos_bancarios_origem_lancamento_check
  CHECK (origem_lancamento IN ('extrato', 'pagamento', 'manual', 'conector', 'conta_pagar', 'folha'));

-- A rota de extratos de hoje nao preenche origem_lancamento, e linha com
-- NULL sumiria da conciliacao (que filtra 'extrato'/'conector'). O default
-- fecha essa porta pra qualquer caminho de insercao.
ALTER TABLE lancamentos_bancarios ALTER COLUMN origem_lancamento SET DEFAULT 'extrato';
UPDATE lancamentos_bancarios SET origem_lancamento = 'extrato' WHERE origem_lancamento IS NULL;

ALTER TABLE lancamentos_bancarios
  ADD COLUMN IF NOT EXISTS conta_pagar_id           uuid REFERENCES contas_pagar(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funcionario_pagamento_id uuid REFERENCES funcionario_pagamentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funcionario_vale_id      uuid REFERENCES funcionario_vales(id) ON DELETE SET NULL,
  -- Compra no cartao: qual fatura (conta_pagar) a absorveu. Varias linhas
  -- apontam pra mesma fatura, por isso indice comum, nao unico.
  ADD COLUMN IF NOT EXISTS fatura_id                uuid REFERENCES contas_pagar(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conciliado_em            timestamptz,
  ADD COLUMN IF NOT EXISTS conciliacao_origem       text CHECK (conciliacao_origem IN ('auto', 'manual')),
  -- PIX recebido na Stone: tarifa / valor x 100, medido na propria linha.
  ADD COLUMN IF NOT EXISTS taxa_efetiva_pct         numeric(6,3);

-- Um par por lado: uma conta a pagar, um pagamento de funcionario e um
-- vale so podem estar ligados a UMA linha. (pagamento_id ja tem o mesmo
-- indice desde 20260807_caixa_especie.sql.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_conta_pagar_unico ON lancamentos_bancarios (conta_pagar_id)           WHERE conta_pagar_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_func_pag_unico    ON lancamentos_bancarios (funcionario_pagamento_id) WHERE funcionario_pagamento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_func_vale_unico   ON lancamentos_bancarios (funcionario_vale_id)      WHERE funcionario_vale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lanc_fatura ON lancamentos_bancarios (fatura_id) WHERE fatura_id IS NOT NULL;

COMMENT ON COLUMN lancamentos_bancarios.conta_pagar_id IS
  'Unica fonte da verdade do par conta a pagar <-> linha. ContaPagar.lancamento_id e join reverso daqui; nao existe coluna espelho.';

-- ------------------------------------------------------------
-- 6. Categorias: grupo de gestao (linhas do Fechamento) + 4 novas
-- ------------------------------------------------------------
-- `grupo` diz onde a categoria cai no DRE pelo extrato. `grupo_gestao` e a
-- taxonomia do Fechamento mensal (orcado x realizado): a mesma das
-- despesas fixas, mais dois grupos que so existem no realizado,
-- 'cmv_compras' (compras pagas, informativo) e 'taxas'. NULL = fica fora
-- (receita, transferencia, nao operacional).
ALTER TABLE categorias_financeiras ADD COLUMN IF NOT EXISTS grupo_gestao text
  CHECK (grupo_gestao IN ('folha', 'estrutura', 'operacao', 'comercial', 'imposto_socios', 'divida', 'cmv_compras', 'taxas', 'outro'));

INSERT INTO categorias_financeiras (nome, grupo, entra_no_dre, ordem) VALUES
  -- Pagar a fatura e so mover dinheiro do banco pro cartao: a despesa ja
  -- entrou na compra, no dia da compra. Transferencia, fora do DRE.
  ('Pagamento de fatura de cartao',         'transferencia',   false, 91),
  -- Entrada do fornecedor devolvendo taxa de cartao: abate o custo
  -- financeiro, nao e receita de venda.
  ('Reembolso de taxa de cartao (Votoran)', 'taxa_financeira', true,  63),
  -- Pro-labore e salario do socio (custo). Retirada de socio e
  -- distribuicao de lucro (abaixo do resultado). Nao misturar.
  ('Pro-labore',                            'custo_fixo',      true,  49),
  ('Seguro e IPVA da frota',                'custo_fixo',      true,  50)
ON CONFLICT (nome) DO NOTHING;

-- Depois do insert, pra alcancar as novas. So preenche quem ainda nao tem
-- grupo: um ajuste feito a mao no banco sobrevive a reexecucao.
UPDATE categorias_financeiras SET grupo_gestao = CASE
    WHEN nome LIKE 'Folha - %'                                           THEN 'folha'
    WHEN nome IN ('Aluguel', 'Contabilidade', 'Agua, luz e internet',
                  'Software e ferramentas', 'Outras despesas fixas',
                  'Alimentacao da equipe', 'Seguro e IPVA da frota')     THEN 'estrutura'
    WHEN nome IN ('Diesel', 'Manutencao de frota', 'Embalagem')          THEN 'operacao'
    WHEN nome = 'Midia e marketing'                                      THEN 'comercial'
    WHEN nome LIKE 'Imposto - %'
      OR nome IN ('Pro-labore', 'Retirada de socio', 'Despesa pessoal')  THEN 'imposto_socios'
    WHEN grupo = 'servico_divida'                                        THEN 'divida'
    WHEN grupo = 'cmv'                                                   THEN 'cmv_compras'
    WHEN grupo = 'taxa_financeira'                                       THEN 'taxas'
    -- Categoria criada depois, sem regra por nome: cai pelo grupo do DRE.
    WHEN grupo = 'custo_fixo'                                            THEN 'estrutura'
    WHEN grupo = 'custo_variavel'                                        THEN 'operacao'
    WHEN grupo IN ('imposto', 'socio')                                   THEN 'imposto_socios'
    ELSE NULL
  END
WHERE grupo_gestao IS NULL;

-- ------------------------------------------------------------
-- 7. Pagamentos (venda): parcelas de verdade + recebimento agrupado
-- ------------------------------------------------------------
-- Todas as vendas ate hoje tem parcelas = 1 porque a tela nunca perguntou.
-- Sem saber se o "1" foi informado ou herdado, a antecipacao do credito
-- sai subestimada. Daqui em diante a UI exige parcelas no credito e marca
-- parcelas_informadas = true; o historico fica false, e a Maquininha
-- mostra quanto do volume de credito esta nessa situacao.
ALTER TABLE pagamentos
  ADD COLUMN IF NOT EXISTS parcelas_informadas boolean NOT NULL DEFAULT false,
  -- "Receber do cliente" distribui um valor por varios pedidos: N pagamentos
  -- com o mesmo grupo, que a conciliacao casa pela soma.
  ADD COLUMN IF NOT EXISTS grupo_recebimento uuid;
CREATE INDEX IF NOT EXISTS idx_pagamentos_grupo ON pagamentos (grupo_recebimento) WHERE grupo_recebimento IS NOT NULL;

-- ------------------------------------------------------------
-- 8. Folha: por onde o dinheiro saiu
-- ------------------------------------------------------------
-- Folha realizada vem SO de funcionario_pagamentos/funcionario_vales. Pra
-- aparecer no Dia e no Fechamento uma unica vez, cada pagamento diz a
-- conta e o metodo: dinheiro/cartao gera lancamento vinculado; banco e
-- casado pelo extrato.
ALTER TABLE funcionario_pagamentos
  ADD COLUMN IF NOT EXISTS conta_id uuid REFERENCES contas_financeiras(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metodo   text CHECK (metodo IN ('pix', 'dinheiro', 'credito', 'debito', 'boleto', 'transferencia', 'outro'));
ALTER TABLE funcionario_vales
  ADD COLUMN IF NOT EXISTS conta_id uuid REFERENCES contas_financeiras(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metodo   text CHECK (metodo IN ('pix', 'dinheiro', 'credito', 'debito', 'boleto', 'transferencia', 'outro'));

-- ------------------------------------------------------------
-- 9. Taxas da maquininha (versionadas por vigencia)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxas_maquininha (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adquirente              text NOT NULL DEFAULT 'stone',
  modalidade              text NOT NULL CHECK (modalidade IN ('debito', 'credito', 'pix')),
  parcelas_de             integer NOT NULL DEFAULT 1 CHECK (parcelas_de >= 1),
  parcelas_ate            integer NOT NULL DEFAULT 1 CHECK (parcelas_ate >= parcelas_de),
  taxa_percentual         numeric(6,3) NOT NULL DEFAULT 0,       -- MDR sobre o bruto
  -- flat: % do bruto, uma vez. por_mes: % ao mes sobre cada parcela, pelo
  -- tempo que ela demoraria pra cair sem antecipacao.
  antecipacao_modo        text NOT NULL DEFAULT 'por_mes' CHECK (antecipacao_modo IN ('flat', 'por_mes')),
  antecipacao_percentual  numeric(6,3) NOT NULL DEFAULT 0,
  dias_liquidacao         integer NOT NULL DEFAULT 1,
  -- % do custo (taxa + antecipacao) que o fornecedor devolve. Acordo
  -- comercial, nao da Stone; valores so no seed privado.
  reembolso_percentual    numeric(5,2) NOT NULL DEFAULT 0,
  base_reembolso          text NOT NULL DEFAULT 'todas_vendas' CHECK (base_reembolso IN ('todas_vendas', 'itens_votoran')),
  teto_reembolso_mensal   numeric(14,2),
  devolve_taxa_no_estorno boolean NOT NULL DEFAULT false,
  vigencia_inicio         date NOT NULL DEFAULT '2026-01-01',
  vigencia_fim            date,                                  -- null = vigente
  observacoes             text,
  criado_em               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_taxas_vigencia ON taxas_maquininha (modalidade, vigencia_inicio);
ALTER TABLE taxas_maquininha ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE taxas_maquininha IS
  'Versionada por vigencia. Mudou a taxa: fecha vigencia_fim da linha atual e insere outra. Nunca UPDATE in place: o custo de cada venda e recalculado na leitura pela tabela vigente na data dela.';

-- ------------------------------------------------------------
-- 10. Reembolso de taxa recebido do fornecedor
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reembolsos_fornecedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id    uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  referencia       date NOT NULL,                  -- 1o dia do mes a que o reembolso se refere
  valor            numeric(14,2) NOT NULL CHECK (valor > 0),
  data_recebimento date NOT NULL,
  -- Pode vir como credito na proxima compra, nao so como dinheiro.
  forma            text NOT NULL DEFAULT 'credito_compra' CHECK (forma IN ('credito_compra', 'pix', 'transferencia', 'desconto_boleto', 'outro')),
  observacoes      text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reembolsos_referencia ON reembolsos_fornecedor (referencia);
ALTER TABLE reembolsos_fornecedor ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 11. Saldos por conta e data
-- ------------------------------------------------------------
-- Sem conector bancario, o saldo do banco e informado uma vez por dia ou
-- lido do fim do extrato. O "saldo de agora" e estimado em cima dele.
CREATE TABLE IF NOT EXISTS saldos_conta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      uuid NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
  data          date NOT NULL,
  saldo         numeric(14,2) NOT NULL,
  -- 'extrato' = saldo final do arquivo importado; 'manual' = digitado;
  -- 'conector' = fase 2. Empate na mesma data: conector > extrato > manual.
  origem        text NOT NULL CHECK (origem IN ('extrato', 'manual', 'conector')),
  importacao_id uuid REFERENCES extratos_importacoes(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, data, origem)
);
ALTER TABLE saldos_conta ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 12. Cenarios do simulador
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cenarios_financeiros (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  parametros    jsonb NOT NULL,                     -- ParametrosCenario (src/lib/financeiro/tipos.ts)
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cenarios_financeiros ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 13. Trilha de eventos (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financeiro_eventos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'conta_pagar' | 'lancamento' | 'despesa_fixa' | 'pagamento' | 'taxa' |
  -- 'reembolso' | 'saldo' | 'fornecedor' | 'cenario'
  entidade    text NOT NULL,
  entidade_id uuid,
  -- 'pagar' | 'estornar' | 'cancelar' | 'excluir' | 'vincular' | 'desvincular' |
  -- 'gerar_mes' | 'gerar_fatura' | 'criar' | 'editar' | 'receber_cliente' ...
  acao        text NOT NULL,
  antes       jsonb,
  depois      jsonb,
  usuario_id  uuid,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_eventos_entidade ON financeiro_eventos (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_fin_eventos_data     ON financeiro_eventos (criado_em DESC);
ALTER TABLE financeiro_eventos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE financeiro_eventos IS
  'Trilha append-only: so INSERT. Falha ao gravar evento so loga, nunca derruba a operacao.';

-- ------------------------------------------------------------
-- 14. Fase 2 — API de Conciliacao Stone (criadas ja, usadas depois)
-- ------------------------------------------------------------
-- O extrato Stone traz a venda no cartao ja LIQUIDA e agregada por dia de
-- liquidacao; a API de conciliacao traz cada transacao com bruto, liquido,
-- MDR e antecipacao. E dela que sai a taxa efetiva real por venda.
CREATE TABLE IF NOT EXISTS stone_vendas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stone_code         text NOT NULL,
  nsu                text NOT NULL,                  -- AcquirerTransactionKey
  autorizado_em      timestamptz NOT NULL,
  capturado_em       timestamptz,
  modalidade         text NOT NULL CHECK (modalidade IN ('credito', 'debito')),
  tipo_parcelamento  text,
  parcelas           integer NOT NULL DEFAULT 1,
  bandeira           text,
  cartao_final       text,
  valor_bruto        numeric(14,2) NOT NULL,
  valor_cancelado    numeric(14,2) NOT NULL DEFAULT 0,
  valor_liquido      numeric(14,2) NOT NULL,
  taxa_mdr           numeric(14,2) NOT NULL DEFAULT 0,
  taxa_antecipacao   numeric(14,2) NOT NULL DEFAULT 0,
  previsao_pagamento date,
  pagamento_id       uuid REFERENCES pagamentos(id) ON DELETE SET NULL,   -- venda casada com o pagamento do sistema
  arquivo_data       date NOT NULL,
  bruto              jsonb,                           -- a transacao como veio, pra auditoria
  importado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stone_code, nsu)
);
CREATE INDEX IF NOT EXISTS idx_stone_vendas_data ON stone_vendas (autorizado_em);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stone_vendas_pag_unico ON stone_vendas (pagamento_id) WHERE pagamento_id IS NOT NULL;
ALTER TABLE stone_vendas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS stone_liquidacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stone_code     text NOT NULL,
  payment_id     text NOT NULL,
  data_pagamento date NOT NULL,
  valor_total    numeric(14,2) NOT NULL,
  banco          text,
  conta          text,
  lancamento_id  uuid REFERENCES lancamentos_bancarios(id) ON DELETE SET NULL,  -- linha do extrato Stone que e esta liquidacao
  arquivo_data   date NOT NULL,
  importado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stone_code, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_stone_liq_data ON stone_liquidacoes (data_pagamento);
ALTER TABLE stone_liquidacoes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS stone_importacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stone_code   text NOT NULL,
  arquivo_data date NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'vazio', 'erro')),
  transacoes   integer NOT NULL DEFAULT 0,
  novas        integer NOT NULL DEFAULT 0,
  liquidacoes  integer NOT NULL DEFAULT 0,
  casadas      integer NOT NULL DEFAULT 0,
  erro         text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  -- A API limita as chamadas por StoneCode+data: 'ok' nao se reimporta sem forcar.
  UNIQUE (stone_code, arquivo_data)
);
ALTER TABLE stone_importacoes ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 15. atualizado_em sem depender da app lembrar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION financeiro_marcar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
-- search_path fixo pelo mesmo motivo de recalcular_pagamento_orcamento.
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fornecedores_atualizado_em ON fornecedores;
CREATE TRIGGER trg_fornecedores_atualizado_em
  BEFORE UPDATE ON fornecedores
  FOR EACH ROW EXECUTE FUNCTION financeiro_marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_despesas_fixas_atualizado_em ON despesas_fixas;
CREATE TRIGGER trg_despesas_fixas_atualizado_em
  BEFORE UPDATE ON despesas_fixas
  FOR EACH ROW EXECUTE FUNCTION financeiro_marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_contas_pagar_atualizado_em ON contas_pagar;
CREATE TRIGGER trg_contas_pagar_atualizado_em
  BEFORE UPDATE ON contas_pagar
  FOR EACH ROW EXECUTE FUNCTION financeiro_marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_cenarios_atualizado_em ON cenarios_financeiros;
CREATE TRIGGER trg_cenarios_atualizado_em
  BEFORE UPDATE ON cenarios_financeiros
  FOR EACH ROW EXECUTE FUNCTION financeiro_marcar_atualizado_em();

-- ------------------------------------------------------------
-- 16. Regra: entrada da Votoran = reembolso de taxa
-- ------------------------------------------------------------
-- Ja existe ('contraparte','VOTORAN') -> 'CMV - Cimento' (prioridade 10), e
-- (campo, padrao) e UNIQUE — nao da pra repetir o par. Por isso a regra do
-- reembolso usa OUTRO campo (descricao) e, por garantia, o nome completo
-- na contraparte (um PIX traz a razao social inteira).
--
-- Prioridade 11, depois da regra de compra, de proposito: a guarda de
-- sinal de classificarPorRegras (src/lib/categorizacao.ts) pula regra de
-- despesa em ENTRADA e segue procurando, mas nao protege 'taxa_financeira'
-- em SAIDA. No Itau, "BOLETO PAGO VOTORAN" (saida) tem o nome na
-- descricao: com prioridade menor que 10, o boleto do cimento viraria
-- "reembolso". Com 11, saida casa primeiro com CMV; entrada pula CMV pela
-- guarda e cai aqui.
INSERT INTO regras_categorizacao (campo, padrao, categoria_id, prioridade, origem)
SELECT v.campo, v.padrao, c.id, v.prioridade, 'seed'
FROM (VALUES
  ('descricao',   'VOTORAN',    11),
  ('contraparte', 'VOTORANTIM', 11)
) AS v(campo, padrao, prioridade)
JOIN categorias_financeiras c ON c.nome = 'Reembolso de taxa de cartao (Votoran)'
ON CONFLICT (campo, padrao) DO NOTHING;

-- ------------------------------------------------------------
-- 17. Seed publico: fornecedores (sem documento, sem credor de divida)
-- ------------------------------------------------------------
-- Nomes que ja aparecem nas regras de categorizacao (20260806) ou sao
-- genericos. CPF/CNPJ entram pelo seed privado, lidos do proprio extrato.
-- Credor de divida e socio do pro-labore ficam fora: privado.
INSERT INTO fornecedores (nome, tipo, categoria_padrao_id)
SELECT v.nome, v.tipo, c.id
FROM (VALUES
  ('Votorantim Cimentos (Votoran)',       'fornecedor', 'CMV - Cimento'),
  ('FIC Osasco',                          'fornecedor', 'CMV - Cimento'),
  ('Cerâmica Grande Sol',                 'fornecedor', 'CMV - Tijolo e bloco'),
  ('Blocos Três Irmãos',                  'fornecedor', 'CMV - Tijolo e bloco'),
  ('SARP Extração de Areia',              'fornecedor', 'CMV - Areia e agregados'),
  ('Madeireira Brandão',                  'fornecedor', 'CMV - Madeira'),
  ('Madeluma',                            'fornecedor', 'CMV - Madeira'),
  ('Trans Três Poderes',                  'fornecedor', 'CMV - Frete de compra'),
  ('Super Mix Material de Construção',    'fornecedor', 'CMV - Outros materiais'),
  ('Imobiliária (aluguel)',               'servico',    'Aluguel'),
  ('Contabilidade',                       'servico',    'Contabilidade'),
  ('Receita Federal (DAS)',               'imposto',    'Imposto - DAS/Simples'),
  ('Stone',                               'servico',    'Taxa de cartao'),
  ('Google Ads',                          'servico',    'Midia e marketing'),
  ('Concessionária (água/luz/internet)',  'servico',    'Agua, luz e internet')
) AS v(nome, tipo, categoria_nome)
LEFT JOIN categorias_financeiras c ON c.nome = v.categoria_nome
ON CONFLICT ((lower(nome))) DO NOTHING;

-- ------------------------------------------------------------
-- 18. Seed publico: despesas fixas (estrutura; valor 0, dia 5)
-- ------------------------------------------------------------
-- Valor e dia de verdade vem do seed privado. Enquanto nao vierem, o
-- Panorama alerta "despesa fixa com valor 0" e a tela mostra o selo
-- "Confirmar" (observacoes contem 'Confirmar').
--   gera_conta true  -> vira conta a pagar todo mes
--   gera_conta false -> provisao: so orcado (diesel, manutencao, seguro,
--                       marketing pago no cartao) e a folha, que e paga
--                       em Funcionarios
INSERT INTO despesas_fixas (nome, grupo, categoria_id, fornecedor_id, fonte, gera_conta, dia_vencimento, ordem, observacoes)
SELECT v.nome, v.grupo, c.id, f.id, v.fonte, v.gera_conta, 5, v.ordem,
       CASE WHEN v.gera_conta THEN 'Confirmar valor e dia de vencimento' END
FROM (VALUES
  ('Folha de pagamento',              'folha',          'Folha - Salario',        NULL,                                 'funcionarios', false, 10),
  ('Aluguel',                         'estrutura',      'Aluguel',                'Imobiliária (aluguel)',              'planilha',     true,  20),
  ('Contabilidade',                   'estrutura',      'Contabilidade',          'Contabilidade',                      'planilha',     true,  21),
  ('Água, luz e internet',            'estrutura',      'Agua, luz e internet',   'Concessionária (água/luz/internet)', 'planilha',     true,  22),
  ('Diesel',                          'operacao',       'Diesel',                 NULL,                                 'planilha',     false, 30),
  ('Reserva de manutenção da frota',  'operacao',       'Manutencao de frota',    NULL,                                 'planilha',     false, 31),
  ('Seguro e IPVA da frota',          'operacao',       'Seguro e IPVA da frota', NULL,                                 'planilha',     false, 32),
  ('Marketing (Google Ads)',          'comercial',      'Midia e marketing',      'Google Ads',                         'planilha',     false, 40),
  ('DAS',                             'imposto_socios', 'Imposto - DAS/Simples',  'Receita Federal (DAS)',              'planilha',     true,  50),
  ('Pró-labore',                      'imposto_socios', 'Pro-labore',             NULL,                                 'planilha',     true,  51)
) AS v(nome, grupo, categoria_nome, fornecedor_nome, fonte, gera_conta, ordem)
LEFT JOIN categorias_financeiras c ON c.nome = v.categoria_nome
LEFT JOIN fornecedores f ON lower(f.nome) = lower(v.fornecedor_nome)
ON CONFLICT ((lower(nome))) DO NOTHING;

-- ============================================================
-- Verificacao (rodar depois)
-- ============================================================
-- Esperado na primeira execucao: fornecedores 15, despesas_fixas 10,
-- contas_financeiras 4 (banco, adquirente, caixa, cartao_credito),
-- categorias +4 (43 no total), regras +2, demais tabelas novas vazias.
--
-- select 'fornecedores' as tabela, count(*) from fornecedores
-- union all select 'despesas_fixas',        count(*) from despesas_fixas
-- union all select 'contas_pagar',          count(*) from contas_pagar
-- union all select 'taxas_maquininha',      count(*) from taxas_maquininha
-- union all select 'reembolsos_fornecedor', count(*) from reembolsos_fornecedor
-- union all select 'saldos_conta',          count(*) from saldos_conta
-- union all select 'cenarios_financeiros',  count(*) from cenarios_financeiros
-- union all select 'financeiro_eventos',    count(*) from financeiro_eventos
-- union all select 'stone_vendas',          count(*) from stone_vendas
-- union all select 'stone_liquidacoes',     count(*) from stone_liquidacoes
-- union all select 'stone_importacoes',     count(*) from stone_importacoes
-- union all select 'contas_financeiras',    count(*) from contas_financeiras
-- union all select 'categorias_financeiras',count(*) from categorias_financeiras
-- union all select 'regras_categorizacao',  count(*) from regras_categorizacao;
--
-- -- grupo de gestao de cada categoria (NULL so em receita/transferencia/nao operacional):
-- select nome, grupo, grupo_gestao from categorias_financeiras order by ordem;
--
-- -- as duas regras do reembolso devem vir com prioridade 11, abaixo da de compra (10):
-- select campo, padrao, prioridade from regras_categorizacao where upper(padrao) like '%VOTORAN%' order by prioridade;
--
-- -- CHECKs recriados:
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid in ('contas_financeiras'::regclass, 'lancamentos_bancarios'::regclass) and contype = 'c' order by 1;
--
-- -- RLS ligado em toda tabela nova:
-- select relname, relrowsecurity from pg_class
--  where relname in ('fornecedores','despesas_fixas','contas_pagar','taxas_maquininha','reembolsos_fornecedor',
--                    'saldos_conta','cenarios_financeiros','financeiro_eventos','stone_vendas','stone_liquidacoes','stone_importacoes');
