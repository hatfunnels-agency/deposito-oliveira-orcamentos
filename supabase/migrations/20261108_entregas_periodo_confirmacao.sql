-- Periodo de entrega e confirmacao do cliente (08/11/2026).
--
-- Periodo: a entrega passa a ser agendada em manha (8h-12h) ou tarde
-- (13h-17h), com teto de entregas por periodo em configuracoes
-- (entregas_capacidade_periodo, comeca em 8). Assim a atendente ve quantas
-- vagas ainda tem antes de prometer o dia.
--
-- Confirmacao: no inicio do dia a atendente pede confirmacao a todos os
-- clientes com entrega no dia. Sem confirmacao (e sem atender a ligacao) o
-- pedido nao carrega. 'enviada' = mensagem mandada; 'confirmado' /
-- 'sem_resposta' = marcado pela atendente. Mudou a data, a API zera.
-- Idempotente.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS periodo_entrega text;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS confirmacao_status text;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS confirmacao_enviada_em timestamptz;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS confirmacao_em timestamptz;

DO $$ BEGIN
  ALTER TABLE orcamentos ADD CONSTRAINT orcamentos_periodo_entrega_check
    CHECK (periodo_entrega IN ('manha', 'tarde'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orcamentos ADD CONSTRAINT orcamentos_confirmacao_status_check
    CHECK (confirmacao_status IN ('enviada', 'confirmado', 'sem_resposta'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN orcamentos.periodo_entrega IS 'manha (8h-12h) ou tarde (13h-17h). NULL = sem periodo (pedidos antigos).';
COMMENT ON COLUMN orcamentos.confirmacao_status IS 'Confirmacao do cliente para a entrega do dia: enviada, confirmado, sem_resposta. Zera quando a data muda.';

INSERT INTO configuracoes (chave, valor, atualizado_em)
VALUES ('entregas_capacidade_periodo', '8', now())
ON CONFLICT (chave) DO NOTHING;
