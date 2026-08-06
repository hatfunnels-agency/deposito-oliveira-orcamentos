-- ============================================================
-- Conciliacao bancaria: importar extrato, categorizar, gerar DRE
-- 2026-08-06
--
-- Contexto: o sistema conhece a receita (tabela pagamentos) e NADA da
-- despesa. Sem o extrato nao existe CMV real, custo fixo, imposto pago
-- nem taxa de cartao — ou seja, nao existe DRE.
--
-- Duas armadilhas que o modelo trata explicitamente, porque erram o
-- resultado em ordem de grandeza:
--
-- 1. TRANSFERENCIA ENTRE CONTAS PROPRIAS. Em julho/2026, R$112.036 das
--    "entradas" do Itau eram PIX vindo da propria conta Stone. Somar a
--    coluna de entradas como faturamento inflaria a receita em 165%.
--    Categoria com grupo='transferencia' nunca entra no DRE.
--
-- 2. SERVICO DE DIVIDA NAO E DESPESA. As 3 parcelas (2 emprestimos +
--    antigo dono, R$23.700/mes) sao saida de caixa, mas ficam ABAIXO do
--    lucro operacional. Misturar com custo fixo subestima o resultado
--    operacional em R$23,7k/mes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Contas (banco e adquirente)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contas_financeiras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  -- 'banco'      = conta corrente (Itau)
  -- 'adquirente' = conta de pagamento (Stone)
  tipo         text NOT NULL DEFAULT 'banco' CHECK (tipo IN ('banco', 'adquirente')),
  -- Formato do arquivo que essa conta exporta. Define qual parser roda.
  layout       text NOT NULL DEFAULT 'generico' CHECK (layout IN ('itau_xlsx', 'stone_csv', 'generico')),
  instituicao  text,
  agencia      text,
  conta        text,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE contas_financeiras IS
  'Contas de onde vem extrato. layout define o parser (itau_xlsx, stone_csv, generico).';

-- ------------------------------------------------------------
-- 2. Categorias, com o grupo que define o lugar no DRE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias_financeiras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL UNIQUE,
  grupo         text NOT NULL CHECK (grupo IN (
                  'receita',          -- venda que entrou
                  'cmv',              -- compra de mercadoria
                  'custo_variavel',   -- diesel, manutencao
                  'custo_fixo',       -- folha, aluguel, contabilidade
                  'imposto',          -- DAS, FGTS, INSS
                  'taxa_financeira',  -- taxa de cartao, tarifa, juros
                  'servico_divida',   -- parcela de emprestimo/aquisicao (NAO e despesa)
                  'socio',            -- retirada / pessoal
                  'transferencia',    -- entre contas proprias (NEUTRO)
                  'nao_operacional'   -- rendimento de aplicacao, estorno
                )),
  -- Falso para transferencia e servico de divida: saem do DRE, ficam so
  -- no fluxo de caixa.
  entra_no_dre  boolean NOT NULL DEFAULT true,
  ordem         integer NOT NULL DEFAULT 100,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 3. Importacoes (uma por arquivo; hash evita reimportar igual)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS extratos_importacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id           uuid NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
  arquivo_nome       text NOT NULL,
  arquivo_hash       text NOT NULL,
  periodo_inicio     date,
  periodo_fim        date,
  linhas_total       integer NOT NULL DEFAULT 0,
  linhas_novas       integer NOT NULL DEFAULT 0,
  linhas_duplicadas  integer NOT NULL DEFAULT 0,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_importacoes_conta ON extratos_importacoes(conta_id, criado_em DESC);

-- ------------------------------------------------------------
-- 4. Lancamentos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lancamentos_bancarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id            uuid NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
  importacao_id       uuid REFERENCES extratos_importacoes(id) ON DELETE SET NULL,

  data                date NOT NULL,
  descricao           text NOT NULL DEFAULT '',
  -- Itau traz Razao Social e CPF/CNPJ em coluna propria. Casar por
  -- documento e exato; casar por texto de descricao e chute.
  contraparte         text,
  documento           text,
  valor               numeric(14,2) NOT NULL,   -- + entrada, - saida
  saldo               numeric(14,2),
  tarifa              numeric(14,2) NOT NULL DEFAULT 0,

  -- Impressao digital da linha. Reimportar o mesmo periodo nao duplica.
  hash_linha          text NOT NULL UNIQUE,

  categoria_id        uuid REFERENCES categorias_financeiras(id) ON DELETE SET NULL,
  -- Como a categoria foi definida: regra | ia | manual | null (sem categoria)
  categoria_origem    text CHECK (categoria_origem IN ('regra', 'ia', 'manual')),
  categoria_confianca numeric(3,2),
  -- Revisado = humano confirmou. So o nao-revisado com baixa confianca
  -- precisa da atencao do Roger.
  revisado            boolean NOT NULL DEFAULT false,

  -- Conciliacao do lado da receita: qual pagamento do sistema esse
  -- credito corresponde.
  pagamento_id        uuid REFERENCES pagamentos(id) ON DELETE SET NULL,
  orcamento_id        uuid REFERENCES orcamentos(id) ON DELETE SET NULL,

  observacoes         text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lanc_data       ON lancamentos_bancarios(data DESC);
CREATE INDEX IF NOT EXISTS idx_lanc_conta_data ON lancamentos_bancarios(conta_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_lanc_categoria  ON lancamentos_bancarios(categoria_id);
CREATE INDEX IF NOT EXISTS idx_lanc_revisao    ON lancamentos_bancarios(revisado, categoria_confianca)
  WHERE revisado = false;
CREATE INDEX IF NOT EXISTS idx_lanc_documento  ON lancamentos_bancarios(documento)
  WHERE documento IS NOT NULL;

-- ------------------------------------------------------------
-- 5. Regras de categorizacao (o sistema aprende com a correcao)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regras_categorizacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Em qual campo procurar o padrao.
  campo         text NOT NULL DEFAULT 'contraparte'
                CHECK (campo IN ('documento', 'contraparte', 'descricao')),
  padrao        text NOT NULL,           -- comparado em UPPER/sem acento, por substring
  categoria_id  uuid NOT NULL REFERENCES categorias_financeiras(id) ON DELETE CASCADE,
  -- Menor roda primeiro. Documento (exato) deve vencer texto (aproximado).
  prioridade    integer NOT NULL DEFAULT 100,
  -- 'seed'        = veio nesta migration
  -- 'manual'      = Roger criou
  -- 'aprendizado' = gerada quando ele corrigiu uma categoria
  origem        text NOT NULL DEFAULT 'manual' CHECK (origem IN ('seed', 'manual', 'aprendizado')),
  aplicacoes    integer NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campo, padrao)
);

CREATE INDEX IF NOT EXISTS idx_regras_ativas ON regras_categorizacao(ativo, prioridade);

-- ------------------------------------------------------------
-- 6. Seed de categorias
-- ------------------------------------------------------------
INSERT INTO categorias_financeiras (nome, grupo, entra_no_dre, ordem) VALUES
  ('Venda - PIX',                 'receita',         true,   10),
  ('Venda - Cartao (Stone)',      'receita',         true,   11),
  ('Venda - Dinheiro/Deposito',   'receita',         true,   12),
  ('Venda - Boleto/Prazo',        'receita',         true,   13),

  ('CMV - Cimento',               'cmv',             true,   20),
  ('CMV - Areia e agregados',     'cmv',             true,   21),
  ('CMV - Tijolo e bloco',        'cmv',             true,   22),
  ('CMV - Ferro',                 'cmv',             true,   23),
  ('CMV - Madeira',               'cmv',             true,   24),
  ('CMV - Telha e cobertura',     'cmv',             true,   25),
  ('CMV - Laje',                  'cmv',             true,   26),
  ('CMV - Outros materiais',      'cmv',             true,   27),
  ('CMV - Frete de compra',       'cmv',             true,   28),

  ('Diesel',                      'custo_variavel',  true,   30),
  ('Manutencao de frota',         'custo_variavel',  true,   31),
  ('Embalagem',                   'custo_variavel',  true,   32),

  ('Folha - Salario',             'custo_fixo',      true,   40),
  ('Folha - Encargos e FGTS',     'custo_fixo',      true,   41),
  ('Aluguel',                     'custo_fixo',      true,   42),
  ('Contabilidade',               'custo_fixo',      true,   43),
  ('Agua, luz e internet',        'custo_fixo',      true,   44),
  ('Software e ferramentas',      'custo_fixo',      true,   45),
  ('Midia e marketing',           'custo_fixo',      true,   46),
  ('Outras despesas fixas',       'custo_fixo',      true,   47),

  ('Imposto - DAS/Simples',       'imposto',         true,   50),
  ('Imposto - Outros',            'imposto',         true,   51),

  ('Taxa de cartao',              'taxa_financeira', true,   60),
  ('Tarifa bancaria',             'taxa_financeira', true,   61),
  ('Juros e IOF',                 'taxa_financeira', true,   62),

  ('Emprestimo - parcela',        'servico_divida',  false,  70),
  ('Aquisicao - parcela',         'servico_divida',  false,  71),

  ('Retirada de socio',           'socio',           false,  80),
  ('Despesa pessoal',             'socio',           false,  81),

  ('Transferencia entre contas',  'transferencia',   false,  90),

  ('Rendimento de aplicacao',     'nao_operacional', true,  100),
  ('Estorno / devolucao',         'nao_operacional', true,  101)
ON CONFLICT (nome) DO NOTHING;

-- ------------------------------------------------------------
-- 7. Seed de regras
--
-- So padroes genericos e os que aparecem no proprio extrato do deposito.
-- Sem CPF/CNPJ aqui de proposito: o repositorio e publico. O casamento
-- por documento acontece em runtime, a partir do que for importado, e as
-- regras por documento nascem quando o Roger corrige uma categoria.
-- ------------------------------------------------------------
INSERT INTO regras_categorizacao (campo, padrao, categoria_id, prioridade, origem)
SELECT v.campo, v.padrao, c.id, v.prioridade, 'seed'
FROM (VALUES
  -- Transferencia propria. Prioridade 1: tem que vencer tudo, senao o
  -- dinheiro que so mudou de conta vira faturamento.
  ('contraparte', 'L & J DEPOSITO OLIVEIRA', 'Transferencia entre contas',  1),

  -- "Stone Principal" e a conta de liquidacao da adquirente. Credito vindo
  -- dela e a VENDA NO CARTAO caindo, nao transferencia entre contas
  -- proprias. Trata-la como transferencia sumia com R$150k/mes de receita.
  -- A transferencia de verdade e Stone -> Itau, pega pela regra acima.
  ('contraparte', 'STONE PRINCIPAL',         'Venda - Cartao (Stone)',      5),
  -- Na Stone, Tipo='Transacao' em credito e cliente pagando (origem e
  -- pessoa fisica). A guarda de sinal impede isso de pegar saida.
  ('descricao',   'TRANSACAO',               'Venda - PIX',                60),

  -- Receita
  ('descricao',   'PIX RECEBIDO',            'Venda - PIX',                 50),
  ('descricao',   'RECEBIVEL DE CARTAO',     'Venda - Cartao (Stone)',      50),
  ('descricao',   'DEPOSITO DINHEIRO',       'Venda - Dinheiro/Deposito',   50),

  -- Fornecedores vistos no extrato de julho/2026
  ('contraparte', 'CERAMICA GRANDE SOL',     'CMV - Tijolo e bloco',        10),
  ('contraparte', 'BLOCOS TRES IRMAOS',      'CMV - Tijolo e bloco',        10),
  ('contraparte', 'FIC OSASCO',              'CMV - Cimento',               10),
  ('contraparte', 'VOTORAN',                 'CMV - Cimento',               10),
  ('contraparte', 'SARP EXTRACAO DE AREIA',  'CMV - Areia e agregados',     10),
  ('contraparte', 'MADEIREIRA BRANDAO',      'CMV - Madeira',               10),
  ('contraparte', 'MADELUMA',                'CMV - Madeira',               10),
  ('contraparte', 'TRANS TRES PODERES',      'CMV - Frete de compra',       10),
  ('contraparte', 'SUPER MIX MATERIAL',      'CMV - Outros materiais',      10),

  -- Estrutura
  ('contraparte', 'NOVA CASA ASSESSORIA',    'Aluguel',                     10),

  -- Imposto e tarifa
  ('descricao',   'DAS SIMPLES',             'Imposto - DAS/Simples',       20),
  ('descricao',   'SIMPLES NACIONAL',        'Imposto - DAS/Simples',       20),
  ('descricao',   'DARF',                    'Imposto - Outros',            20),
  ('descricao',   'FGTS',                    'Folha - Encargos e FGTS',     20),
  ('descricao',   'TARIFA',                  'Tarifa bancaria',             30),
  ('descricao',   'IOF',                     'Juros e IOF',                 30),
  ('descricao',   'RENDIMENTO',              'Rendimento de aplicacao',     30),
  ('descricao',   'REND PAGO APLIC',         'Rendimento de aplicacao',     30)
) AS v(campo, padrao, categoria_nome, prioridade)
JOIN categorias_financeiras c ON c.nome = v.categoria_nome
ON CONFLICT (campo, padrao) DO NOTHING;

-- ------------------------------------------------------------
-- 8. Contas do deposito
-- ------------------------------------------------------------
INSERT INTO contas_financeiras (nome, tipo, layout, instituicao, agencia, conta)
SELECT 'Itau PJ', 'banco', 'itau_xlsx', 'Itau Unibanco', '3130', '0097165-2'
WHERE NOT EXISTS (SELECT 1 FROM contas_financeiras WHERE nome = 'Itau PJ');

INSERT INTO contas_financeiras (nome, tipo, layout, instituicao)
SELECT 'Stone', 'adquirente', 'stone_csv', 'Stone Instituicao de Pagamento'
WHERE NOT EXISTS (SELECT 1 FROM contas_financeiras WHERE nome = 'Stone');

-- ------------------------------------------------------------
-- 9. RLS: mesmo padrao das demais tabelas (acesso via service role).
-- ------------------------------------------------------------
ALTER TABLE contas_financeiras     ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE extratos_importacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos_bancarios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE regras_categorizacao   ENABLE ROW LEVEL SECURITY;
