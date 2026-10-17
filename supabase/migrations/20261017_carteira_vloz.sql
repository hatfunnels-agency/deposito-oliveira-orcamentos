-- ============================================================
-- Carteira Vloz (Votorantim): 15% de cada venda no cartao + cashback
-- 2026-10-17
--
-- Descoberto no arquivo "vendasvloz" de out/2026: a Stone divide cada venda
-- no cartao em 85% pra conta e 15% pra carteira Vloz, e o cashback da
-- Votoran (a taxa reembolsada) tambem cai la. Esse credito so compra
-- cimento da Votorantim. Sem uma conta propria, o Fechamento ve 15% da
-- receita no cartao "sumindo" e o cimento pago com Vloz nao aparece.
--
-- Nova conta tipo 'carteira' (saldo = soma dos lancamentos, como o caixa;
-- fora do "total disponivel"), layout 'vloz_csv' (o CSV de vendas da
-- Vloz, importado pela tela de Extratos como os outros).
-- ============================================================
ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_tipo_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check
  CHECK (tipo IN ('banco', 'adquirente', 'caixa', 'cartao_credito', 'carteira'));
ALTER TABLE contas_financeiras DROP CONSTRAINT IF EXISTS contas_financeiras_layout_check;
ALTER TABLE contas_financeiras ADD CONSTRAINT contas_financeiras_layout_check
  CHECK (layout IN ('itau_xlsx', 'stone_csv', 'generico', 'manual', 'ofx', 'vloz_csv'));

INSERT INTO contas_financeiras (nome, tipo, layout, instituicao, ordem)
SELECT 'Vloz (Votorantim)', 'carteira', 'vloz_csv', 'Credito pra comprar cimento Votorantim', 35
WHERE NOT EXISTS (SELECT 1 FROM contas_financeiras WHERE tipo = 'carteira');

-- Linhas que o parser da Vloz gera: "Vloz 15% — ..." e "Cashback Votoran — ...".
INSERT INTO regras_categorizacao (campo, padrao, categoria_id, prioridade, origem)
SELECT v.campo, v.padrao, c.id, v.prioridade, 'seed'
FROM (VALUES
  ('descricao', 'VLOZ 15%',          'Venda - Cartao (Stone)',                 5),
  ('descricao', 'CASHBACK VOTORAN',  'Reembolso de taxa de cartao (Votoran)',  5)
) AS v(campo, padrao, categoria_nome, prioridade)
JOIN categorias_financeiras c ON c.nome = v.categoria_nome
ON CONFLICT (campo, padrao) DO NOTHING;

-- Quanto de cada venda no cartao NAO cai na conta Stone (vai pra carteira).
-- A conciliacao do cartao compara a liquidacao da Stone so com os 85%.
INSERT INTO configuracoes (chave, valor) VALUES ('financeiro_split_carteira_pct', '15')
ON CONFLICT (chave) DO NOTHING;
