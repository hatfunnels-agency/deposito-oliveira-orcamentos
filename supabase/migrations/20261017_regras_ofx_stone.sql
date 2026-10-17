-- ============================================================
-- Regras de categorizacao para o extrato OFX da Stone
-- 2026-10-17
--
-- O OFX da conta Stone descreve as linhas com textos diferentes do CSV:
--   "Recebimento vendas - Antecipação"            venda no cartao, ja liquida
--   "Recebimento de vendas - Valor referente ..." venda no cartao, ja liquida
--   "FULANO - Pix | Maquininha"                   Pix na maquininha, ja liquido
--   "Mensalidade - Mensalidade | Cobrança"        mensalidade da maquininha
-- A transferencia Stone -> Itau ("L & J DEPOSITO OLIVEIRA LTDA - Transferência | Pix")
-- ja cai na regra de contraparte 'L & J DEPOSITO OLIVEIRA' (prioridade 1).
-- A guarda de sinal impede regra de receita de pegar saida.
-- ============================================================
INSERT INTO regras_categorizacao (campo, padrao, categoria_id, prioridade, origem)
SELECT v.campo, v.padrao, c.id, v.prioridade, 'seed'
FROM (VALUES
  ('descricao', 'RECEBIMENTO VENDAS',    'Venda - Cartao (Stone)', 40),
  ('descricao', 'RECEBIMENTO DE VENDAS', 'Venda - Cartao (Stone)', 40),
  ('descricao', 'PIX | MAQUININHA',      'Venda - PIX',            45),
  ('descricao', 'MENSALIDADE',           'Taxa de cartao',         40)
) AS v(campo, padrao, categoria_nome, prioridade)
JOIN categorias_financeiras c ON c.nome = v.categoria_nome
ON CONFLICT (campo, padrao) DO NOTHING;
