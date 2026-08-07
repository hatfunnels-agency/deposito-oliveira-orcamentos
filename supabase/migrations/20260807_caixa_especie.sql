-- ============================================================
-- Caixa em especie: o lado da operacao que o extrato nunca ve
-- 2026-08-07
--
-- Medido em julho/2026: R$32.777 entraram em dinheiro (84 pagamentos,
-- 8,7% da receita) e a fatia so cresce — 5,1% em maio, 7,9% em junho,
-- 8,7% em julho, 11,3% em agosto. Esse dinheiro nunca toca o banco, e e
-- dele que sai a maior parte da folha e varias compras.
--
-- Sem registrar isso, o DRE:
--   - subestima a receita (falta a venda em especie)
--   - SUPERESTIMA o lucro (falta a despesa paga em dinheiro)
-- Os dois erros nao se cancelam: o segundo costuma ser maior.
--
-- Desenho: o caixa vira uma CONTA como as outras, entao categorizacao,
-- revisao e DRE funcionam sem codigo novo. A diferenca e a origem:
--   entrada -> automatica, derivada de pagamentos.metodo='dinheiro'
--   saida   -> lancada a mao pelo Roger
-- ============================================================

-- 1. 'caixa' passa a ser um tipo de conta valido.
ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_tipo_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check
  CHECK (tipo IN ('banco', 'adquirente', 'caixa'));

ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_layout_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_layout_check
  CHECK (layout IN ('itau_xlsx', 'stone_csv', 'generico', 'manual'));

INSERT INTO contas_financeiras (nome, tipo, layout, instituicao)
SELECT 'Caixa (especie)', 'caixa', 'manual', 'Dinheiro no deposito'
WHERE NOT EXISTS (SELECT 1 FROM contas_financeiras WHERE tipo = 'caixa');

-- 2. Rastro da origem do lancamento de caixa.
--    'pagamento' = gerado a partir de uma venda em dinheiro (nao editar a mao)
--    'manual'    = o Roger lancou
ALTER TABLE lancamentos_bancarios ADD COLUMN IF NOT EXISTS origem_lancamento text
  CHECK (origem_lancamento IN ('extrato', 'pagamento', 'manual'));
UPDATE lancamentos_bancarios SET origem_lancamento = 'extrato' WHERE origem_lancamento IS NULL;

-- Liga o lancamento de caixa a venda que o gerou, pra nao duplicar na
-- sincronizacao e pra dar rastreabilidade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_pagamento_unico
  ON lancamentos_bancarios(pagamento_id)
  WHERE pagamento_id IS NOT NULL;

-- 3. Fechamento de caixa: o Roger conta o dinheiro e registra.
--    A diferenca entre o contado e o esperado e informacao, nao erro a
--    esconder — sobra e falta recorrentes dizem coisas diferentes.
CREATE TABLE IF NOT EXISTS fechamentos_caixa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data           date NOT NULL UNIQUE,
  saldo_esperado numeric(14,2) NOT NULL,
  saldo_contado  numeric(14,2) NOT NULL,
  diferenca      numeric(14,2) GENERATED ALWAYS AS (saldo_contado - saldo_esperado) STORED,
  observacoes    text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fechamentos_caixa ENABLE ROW LEVEL SECURITY;

-- 4. Deposito de dinheiro no banco NAO e receita: e o caixa indo pro
--    banco. Com o caixa existindo, manter como receita contaria a MESMA
--    venda duas vezes (uma na entrada do caixa, outra no deposito).
UPDATE regras_categorizacao
SET categoria_id = (SELECT id FROM categorias_financeiras WHERE nome = 'Transferencia entre contas'),
    prioridade = 5
WHERE campo = 'descricao' AND padrao = 'DEPOSITO DINHEIRO';

INSERT INTO regras_categorizacao (campo, padrao, categoria_id, prioridade, origem)
SELECT v.campo, v.padrao, c.id, v.prioridade, 'seed'
FROM (VALUES
  ('descricao', 'DEP DINHEIRO',        'Transferencia entre contas', 5),
  ('descricao', 'DEPOSITO EM DINHEIRO','Transferencia entre contas', 5),
  ('descricao', 'SANGRIA',             'Transferencia entre contas', 5)
) AS v(campo, padrao, categoria_nome, prioridade)
JOIN categorias_financeiras c ON c.nome = v.categoria_nome
ON CONFLICT (campo, padrao) DO NOTHING;

-- 5. Categorias que so fazem sentido com caixa.
INSERT INTO categorias_financeiras (nome, grupo, entra_no_dre, ordem) VALUES
  ('Venda - Dinheiro (caixa)',   'receita',        true,  14),
  ('Alimentacao da equipe',      'custo_fixo',     true,  48),
  ('Caixa - diferenca de conta', 'nao_operacional', true, 102)
ON CONFLICT (nome) DO NOTHING;
