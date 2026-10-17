-- Historico de contatos com o cliente: quando foi o ultimo contato e do que
-- se falou NAQUELA conversa. A notas_contexto e o resumo geral (quem e o
-- cliente, que obra tem); aqui fica cada conversa com data, para a IA e a
-- atendente mandarem mensagem que continua o assunto.
--
-- Origens:
--   conversa  - a IA le a conversa de WhatsApp no GHL (job diario do contexto)
--               e grava 1 linha por dia com mensagem
--   robo      - envio automatico da regua (follow-up, reativacao, retorno...)
--   atendente - clique na tarefa do dia ou registro manual no perfil
-- `chave` deduplica o automatico (conversa:AAAA-MM-DD, envio:<chave_dedup>,
-- tarefa:<id>). Idempotente e so aditiva.

CREATE TABLE IF NOT EXISTS cliente_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  data timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL CHECK (origem IN ('conversa', 'robo', 'atendente')),
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'ligacao', 'loja', 'visita', 'outro')),
  resumo text NOT NULL,
  chave text,
  usuario_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cliente_contatos_cliente_data ON cliente_contatos (cliente_id, data DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_contatos_chave ON cliente_contatos (cliente_id, chave) WHERE chave IS NOT NULL;

ALTER TABLE cliente_contatos ENABLE ROW LEVEL SECURITY;
