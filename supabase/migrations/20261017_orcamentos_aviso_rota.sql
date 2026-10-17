-- Quando o cliente foi avisado que o pedido saiu para entrega (pelo sistema,
-- via GHL). Evita avisar duas vezes e mostra "avisado" no cartao. Idempotente.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS aviso_rota_em timestamptz;
