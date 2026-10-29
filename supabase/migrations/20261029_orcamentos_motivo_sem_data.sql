-- Por que a entrega confirmada esta sem data (29/10/2026).
--
-- Pedido fechado sem data virava "fantasma": conta no faturamento e ninguem
-- sabe se o cliente vai procurar pedreiro, se a obra nao comecou ou se so
-- fecha depois de pagar. Agora a atendente escreve o motivo ao salvar/
-- confirmar sem data; ele aparece no quadro "entregas sem data" da aba
-- Entregas. Quando o pedido ganha data, a API zera o motivo. Idempotente.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS motivo_sem_data text;
COMMENT ON COLUMN orcamentos.motivo_sem_data IS
  'Motivo informado pela atendente quando a venda foi confirmada sem data de entrega. NULL quando tem data.';
