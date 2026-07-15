-- ============================================================
-- Campo estruturado: entrega concluida sem pagamento
-- 2026-07-15
--
-- Antes, "entregue sem pagamento" era gravado como texto na observacao
-- (hack). Agora e um campo proprio, pra dar pra filtrar e relatar:
-- distinguir "entregue e nao pago por decisao" de "esquecimento".
-- Rodar antes do deploy — o codigo ja seleciona estas colunas.
-- ============================================================

alter table orcamentos
  add column if not exists entregue_sem_pagamento    boolean not null default false,
  add column if not exists entregue_sem_pagamento_em timestamptz;

comment on column orcamentos.entregue_sem_pagamento is
  'TRUE quando a entrega foi concluida deliberadamente sem pagamento (botao "Entregar sem pagamento" na aba Entregas). Continua como a receber no financeiro; o flag registra que foi decisao, nao esquecimento.';
comment on column orcamentos.entregue_sem_pagamento_em is
  'Quando o pedido foi marcado como entregue sem pagamento.';
