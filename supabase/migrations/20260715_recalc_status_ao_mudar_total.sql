-- ============================================================
-- Recalcular status_pagamento quando o TOTAL do pedido muda
-- 2026-07-15
--
-- Lacuna: o trigger trg_pagamentos_recalc so dispara em mudanca de
-- pagamento. Se um pedido e quitado e DEPOIS ganha itens (total sobe), o
-- status_pagamento fica preso em 'completo' com valor_pago < total.
-- Efeito: some do financeiro (o filtro confia no status_pagamento), o
-- dashboard conta como pago, etc.
--
-- Correcao: trigger BEFORE UPDATE OF total que reavalia o status a partir
-- do valor_pago vs o novo total. Nao mexe em valor_pago (esse so muda por
-- pagamento). Nao conflita com o trigger de pagamentos, que atualiza
-- valor_pago/status mas nao o total.
-- ============================================================

create or replace function recalcular_status_por_total()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.total is distinct from old.total then
    new.status_pagamento := case
      when coalesce(new.valor_pago, 0) <= 0 then 'pendente'
      when coalesce(new.valor_pago, 0) >= new.total - 0.01 then 'completo'
      else 'parcial'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orcamentos_total_recalc on orcamentos;
create trigger trg_orcamentos_total_recalc
  before update of total on orcamentos
  for each row execute function recalcular_status_por_total();

-- Corrige as linhas ja defasadas (status 'completo' com saldo em aberto),
-- exceto canceladas (rotulo legado inofensivo, ver migration de pagamentos).
update orcamentos
   set status_pagamento = case
         when coalesce(valor_pago, 0) <= 0 then 'pendente'
         when coalesce(valor_pago, 0) >= total - 0.01 then 'completo'
         else 'parcial'
       end
 where status <> 'cancelado'
   and status_pagamento = 'completo'
   and coalesce(valor_pago, 0) < total - 0.01;
