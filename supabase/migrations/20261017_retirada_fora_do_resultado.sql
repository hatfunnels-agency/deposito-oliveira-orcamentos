-- ============================================================
-- Retirada de socio fora do resultado da operacao
-- 2026-10-17
--
-- 20261016 colocou 'Retirada de socio' e 'Despesa pessoal' no grupo de
-- gestao 'imposto_socios', o que as fazia baixar o "Lucro da operacao" do
-- Fechamento como se fossem custo. Retirada e distribuicao do que sobrou,
-- nao despesa (pro-labore, sim, e custo e continua em imposto_socios).
-- grupo_gestao NULL = fica fora do resultado; a saida continua no bloco
-- "Caixa do mes", que conta todo dinheiro que saiu.
-- ============================================================
UPDATE categorias_financeiras
   SET grupo_gestao = NULL
 WHERE nome IN ('Retirada de socio', 'Despesa pessoal');
