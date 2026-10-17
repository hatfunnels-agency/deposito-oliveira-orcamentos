-- ============================================================
-- Categorias que faltaram ao classificar outubro/2026
-- 2026-10-17
--
-- 1. Obra da loja: pagamento ao empreiteiro que esta construindo a loja.
--    E investimento, nao custo da operacao: fica fora do resultado do
--    Fechamento (grupo_gestao NULL) e do DRE, mas a saida aparece no caixa.
-- 2. Fatura do cartao sem detalhe das compras: enquanto as compras do cartao
--    nao forem lancadas uma a uma (ou importadas da fatura), o pagamento da
--    fatura entra inteiro como despesa diversa. Quando houver o detalhe, a
--    fatura passa a 'Pagamento de fatura de cartao' (transferencia).
-- 3. Cartao da empresa: Itau Empresas, fecha dia 1, vence dia 10.
-- ============================================================
INSERT INTO categorias_financeiras (nome, grupo, entra_no_dre, ordem, grupo_gestao) VALUES
  ('Obra da loja (investimento)',            'nao_operacional', false, 103, NULL),
  ('Cartao de credito - despesas diversas',  'custo_fixo',      true,   47, 'outro')
ON CONFLICT (nome) DO NOTHING;

UPDATE contas_financeiras
   SET instituicao = 'Itau Empresas', dia_fechamento = 1, dia_vencimento = 10
 WHERE tipo = 'cartao_credito';
