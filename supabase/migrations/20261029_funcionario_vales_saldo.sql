-- Saldo a favor do funcionario (29/10/2026).
--
-- O pagamento ganhou o campo "valor pago". Pagou a mais que o liquido, a
-- diferenca vira um vale (adiantamento) e abate da proxima quinzena. Pagou
-- a menos, a diferenca vira um vale NEGATIVO: saldo a receber, que soma na
-- proxima. Por isso o CHECK deixa de exigir valor > 0. Idempotente.
ALTER TABLE funcionario_vales DROP CONSTRAINT IF EXISTS funcionario_vales_valor_check;
ALTER TABLE funcionario_vales ADD CONSTRAINT funcionario_vales_valor_check CHECK (valor <> 0);
COMMENT ON COLUMN funcionario_vales.valor IS
  'Positivo = vale/adiantamento (desconta do proximo pagamento). Negativo = saldo a receber (soma no proximo pagamento).';
