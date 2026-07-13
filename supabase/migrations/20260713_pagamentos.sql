-- ============================================================
-- Modelo de pagamentos e inadimplencia
-- 2026-07-13
--
-- Antes: status_pagamento era texto livre misturando tres conceitos
--   (condicao "na_entrega", estado "parcial", meio "pagamento_na_entrega"
--   vazado em forma_pagamento). Nao existia valor pago, data nem vencimento,
--   entao "parcial" era um rotulo sem numero e inadimplencia era incalculavel.
--
-- Depois:
--   pagamentos              -> uma linha por dinheiro que entra (ou estorno, se negativo)
--   orcamentos.valor_pago   -> soma dos pagamentos, mantida por trigger
--   orcamentos.condicao_pagamento -> combinado comercial (a_vista/na_entrega/prazo)
--   orcamentos.vencimento   -> saldo > 0 depois desta data = inadimplente
--   orcamentos.status_pagamento -> derivado (pendente/parcial/completo), nao mais digitado
--
-- Rodar de uma vez. Idempotente o suficiente pra reexecutar sem estragar.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Backup (convencao do repo: orcamentos_backup_pre_*)
-- ------------------------------------------------------------
create table if not exists orcamentos_backup_pre_pagamentos as
  select * from orcamentos;

-- ------------------------------------------------------------
-- 1. Normaliza drift historico de forma_pagamento
-- ------------------------------------------------------------
update orcamentos set forma_pagamento = 'debito'  where forma_pagamento = 'cartao_debito';
update orcamentos set forma_pagamento = 'credito' where forma_pagamento = 'cartao_credito';

-- ------------------------------------------------------------
-- 2. Novos campos em orcamentos
-- ------------------------------------------------------------
alter table orcamentos
  add column if not exists valor_pago         numeric not null default 0,
  add column if not exists condicao_pagamento text    not null default 'a_vista',
  add column if not exists vencimento         date;

alter table orcamentos drop constraint if exists orcamentos_condicao_pagamento_check;
alter table orcamentos add  constraint orcamentos_condicao_pagamento_check
  check (condicao_pagamento in ('a_vista', 'na_entrega', 'prazo'));

comment on column orcamentos.valor_pago is
  'Soma de pagamentos.valor. Mantido por trigger — nunca escrever direto.';
comment on column orcamentos.condicao_pagamento is
  'Combinado comercial. Nao confundir com status_pagamento (estado) nem forma_pagamento (meio).';
comment on column orcamentos.vencimento is
  'Data limite de pagamento. Saldo > 0 depois desta data = inadimplente.';

-- ------------------------------------------------------------
-- 3. Tabela de pagamentos
-- ------------------------------------------------------------
create table if not exists pagamentos (
  id             uuid primary key default gen_random_uuid(),
  orcamento_id   uuid not null references orcamentos(id) on delete cascade,
  valor          numeric not null check (valor <> 0),
  metodo         text not null check (metodo in
                   ('pix', 'debito', 'credito', 'dinheiro', 'boleto', 'transferencia', 'outro')),
  parcelas       integer not null default 1 check (parcelas >= 1),
  data_pagamento timestamptz not null default now(),
  origem         text not null default 'manual' check (origem in
                   ('manual', 'stone', 'pagarme', 'legado')),
  gateway_id     text unique,
  observacoes    text,
  criado_em      timestamptz not null default now()
);

comment on table pagamentos is
  'Uma linha por dinheiro recebido. Valor negativo = estorno.';
comment on column pagamentos.gateway_id is
  'ID da transacao no gateway (Stone/Pagar.me). UNIQUE: webhook reenviado nao duplica pagamento.';

create index if not exists pagamentos_orcamento_id_idx on pagamentos (orcamento_id);
create index if not exists pagamentos_data_idx         on pagamentos (data_pagamento);

-- Service role (usado pelas API routes) ignora RLS; sem policy, mais ninguem le.
alter table pagamentos enable row level security;

-- ------------------------------------------------------------
-- 4. Trigger: valor_pago e status_pagamento derivam de pagamentos
--    Fica no banco (nao na app) pra valer tambem pro webhook da Stone
--    e pra qualquer INSERT manual.
-- ------------------------------------------------------------
create or replace function recalcular_pagamento_orcamento()
returns trigger
language plpgsql
as $$
declare
  v_orcamento_id uuid;
  v_total        numeric;
  v_pago         numeric;
begin
  v_orcamento_id := coalesce(new.orcamento_id, old.orcamento_id);

  select coalesce(sum(valor), 0) into v_pago
    from pagamentos where orcamento_id = v_orcamento_id;

  select total into v_total
    from orcamentos where id = v_orcamento_id;

  update orcamentos
     set valor_pago = v_pago,
         status_pagamento = case
           when v_pago <= 0 then 'pendente'
           -- tolerancia de 1 centavo: numeric de parcela raramente fecha exato
           when v_pago >= coalesce(v_total, 0) - 0.01 then 'completo'
           else 'parcial'
         end,
         atualizado_em = now()
   where id = v_orcamento_id;

  return null;
end;
$$;

drop trigger if exists trg_pagamentos_recalc on pagamentos;
create trigger trg_pagamentos_recalc
  after insert or update or delete on pagamentos
  for each row execute function recalcular_pagamento_orcamento();

-- ------------------------------------------------------------
-- 5. Backfill da condicao comercial
-- ------------------------------------------------------------
update orcamentos
   set condicao_pagamento = 'na_entrega'
 where status_pagamento = 'pagamento_na_entrega'
    or forma_pagamento  = 'pagamento_na_entrega';

-- "pagamento_na_entrega" nunca foi um meio de pagamento — sai de forma_pagamento
update orcamentos
   set forma_pagamento = null
 where forma_pagamento = 'pagamento_na_entrega';

-- ------------------------------------------------------------
-- 6. Backfill do historico de pagamentos
--
--    Entram como pagos: status_pagamento 'completo', 'pago' e
--    'pagamento_na_entrega' (decisao do Roger: os 180 entregues foram
--    quitados no ato; ver backup se precisar reverter).
--
--    NAO entram:
--      - cancelados (nao inventar receita em pedido cancelado)
--      - 'parcial' (8 pedidos): ninguem registrou QUANTO entrou.
--        Ficam com valor_pago = 0 e status 'parcial' pra triagem manual
--        na aba Financeiro. Chutar aqui seria pior que admitir a lacuna.
-- ------------------------------------------------------------
insert into pagamentos (orcamento_id, valor, metodo, data_pagamento, origem, observacoes)
select o.id,
       o.total,
       case o.forma_pagamento
         when 'pix'      then 'pix'
         when 'debito'   then 'debito'
         when 'credito'  then 'credito'
         when 'dinheiro' then 'dinheiro'
         when 'boleto'   then 'boleto'
         else 'outro'
       end,
       coalesce(o.data_entrega, o.data_retirada)::timestamptz,
       'legado',
       'Backfill 2026-07-13 — pagamento anterior ao controle de recebiveis'
  from orcamentos o
 where o.status_pagamento in ('completo', 'pago', 'pagamento_na_entrega')
   and o.status <> 'cancelado'
   and o.total > 0
   and not exists (select 1 from pagamentos p where p.orcamento_id = o.id);

commit;

-- ============================================================
-- Verificacao (rodar depois do commit)
-- ============================================================
-- select status_pagamento, count(*), sum(total) as faturado, sum(valor_pago) as recebido
--   from orcamentos where status <> 'cancelado' group by 1 order by 2 desc;
--
-- -- os 8 'parcial' que precisam de triagem manual:
-- select codigo, total, valor_pago from orcamentos
--  where status_pagamento = 'parcial' order by total desc;
