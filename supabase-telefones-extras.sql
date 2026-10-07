-- Outros telefones do cliente (numero antigo, do marido, do escritorio...).
-- `telefone` continua sendo o principal: e pra ele que as mensagens saem.
-- Os extras so servem pra RECONHECER o cliente — busca, IA, reguas, tarefas.
-- Digitos apenas, mesmo formato de clientes.telefone.
alter table clientes
  add column if not exists telefones_extras text[] not null default '{}';

create index if not exists clientes_telefones_extras_idx
  on clientes using gin (telefones_extras);

-- Juntar dois cadastros da mesma pessoa (ex.: trocou de numero e virou um
-- cliente novo). Tudo do `origem` passa pro `destino`, o telefone do origem
-- vira "outro telefone" do destino, e o origem e apagado. Numa transacao so:
-- ou junta tudo, ou nada.
create or replace function juntar_clientes(origem uuid, destino uuid)
returns void
language plpgsql
as $$
declare
  o clientes%rowtype;
  d clientes%rowtype;
begin
  if origem = destino then raise exception 'origem e destino sao o mesmo cliente'; end if;
  select * into o from clientes where id = origem for update;
  select * into d from clientes where id = destino for update;
  if o.id is null or d.id is null then raise exception 'cliente nao encontrado'; end if;

  -- tags: a mesma tag nos dois fica so a do destino (cliente_id+tag e unico)
  delete from cliente_tags t where t.cliente_id = origem
    and exists (select 1 from cliente_tags x where x.cliente_id = destino and x.tag = t.tag);
  update cliente_tags set cliente_id = destino where cliente_id = origem;

  -- enderecos: so pode haver um padrao por cliente — fica o do destino
  if exists (select 1 from enderecos_clientes where cliente_id = destino and is_padrao) then
    update enderecos_clientes set is_padrao = false where cliente_id = origem and is_padrao;
  end if;
  update enderecos_clientes set cliente_id = destino where cliente_id = origem;

  update orcamentos         set cliente_id = destino where cliente_id = origem;
  update automacao_envios   set cliente_id = destino where cliente_id = origem;
  update atendimento_fila   set cliente_id = destino where cliente_id = origem;
  update tarefas_atendente  set cliente_id = destino where cliente_id = origem;

  -- o apagar vem antes de gravar o telefone do origem no destino
  delete from clientes where id = origem;

  update clientes set
    telefones_extras = array(
      select distinct t from unnest(d.telefones_extras || o.telefone || o.telefones_extras) t
      where t is not null and t <> d.telefone and t !~ '^pdv-'
    ),
    email          = coalesce(d.email, o.email),
    recebedor      = coalesce(d.recebedor, o.recebedor),
    data_followup  = coalesce(d.data_followup, o.data_followup),
    notas_contexto = nullif(concat_ws(E'\n\n', d.notas_contexto, o.notas_contexto), ''),
    atualizado_em  = now()
  where id = destino;
end;
$$;
