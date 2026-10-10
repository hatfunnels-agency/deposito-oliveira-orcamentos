-- Entregas programadas: a entrega parcial deixa de ser so "o que ja foi" e
-- passa a poder ser PLANEJADA antes (cliente quer parte hoje, parte sabado).
--   programada -> viagem combinada, com data e itens; nao conta como entregue
--   entregue   -> viagem feita; soma em orcamento_itens.quantidade_entregue
-- As que ja existem sao todas viagens feitas.
alter table entregas_parciais
  add column if not exists status text not null default 'entregue';

alter table entregas_parciais drop constraint if exists chk_entregas_parciais_status;
alter table entregas_parciais add constraint chk_entregas_parciais_status
  check (status in ('programada', 'entregue'));

alter table entregas_parciais
  add column if not exists entregue_em timestamptz;
update entregas_parciais set entregue_em = criado_em
  where status = 'entregue' and entregue_em is null;

create index if not exists entregas_parciais_programadas_idx
  on entregas_parciais (data_entrega) where status = 'programada';
