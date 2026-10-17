-- Prazo de entrega do fornecedor por produto (dias corridos).
--
-- Por que existe: a previsao de compra do Estoque pede quando o saldo
-- chega ao ponto de pedido. Produto que demora a chegar precisa ser pedido
-- antes: com prazo P, pede-se quando o saldo cobre 2 x P no ritmo atual
-- (ferro leva 1 semana -> pedir com 2 semanas de estoque). NULL = entrega
-- rapida (pedir com 3 dias de venda). Idempotente e so aditiva.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prazo_entrega_dias integer;
COMMENT ON COLUMN produtos.prazo_entrega_dias IS
  'Dias corridos do pedido ate a mercadoria chegar. A previsao de compra pede com 2x esse prazo de estoque. NULL = entrega rapida.';

-- Ferro (barra/metro) leva 1 semana. So preenche o que esta vazio.
UPDATE produtos SET prazo_entrega_dias = 7
WHERE prazo_entrega_dias IS NULL
  AND tipo_estoque = 'estocavel'
  AND (tipo_ferro IS NOT NULL OR categoria = 'Ferro' OR nome ILIKE 'estribo ferro%');
