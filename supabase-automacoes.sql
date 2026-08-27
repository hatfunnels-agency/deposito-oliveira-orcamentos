-- Automacoes de WhatsApp — tabela de log.
-- Rodar uma vez no SQL Editor do Supabase (o MCP e read-only).
--
-- chave_dedup e o que garante que a mesma regua nunca dispara duas vezes
-- para o mesmo orcamento/cliente. E UNIQUE de proposito: o insert falha
-- (e e ignorado) se ja existir.

create table if not exists automacao_envios (
  id              uuid primary key default gen_random_uuid(),
  chave_dedup     text not null unique,
  tipo            text not null,          -- followup | posvenda | reativacao | contexto
  momento         text not null,          -- dia1 | dia4 | dia7 | check | geral | resumo
  cliente_id      uuid references clientes(id) on delete cascade,
  orcamento_id    uuid references orcamentos(id) on delete set null,
  telefone        text,
  ghl_contact_id  text,
  template_nome   text,
  mensagem        text,
  status          text not null default 'simulado',  -- simulado | enviado | erro | pulado | concluido (tipo=contexto)
  motivo          text,
  criado_em       timestamptz not null default now()
);

create index if not exists idx_automacao_cliente
  on automacao_envios (cliente_id, tipo, criado_em desc);
create index if not exists idx_automacao_data
  on automacao_envios (criado_em desc);
create index if not exists idx_automacao_status
  on automacao_envios (status, criado_em desc);

comment on table automacao_envios is
  'Log das automacoes de WhatsApp. status=simulado quando AUTOMACOES_DRY_RUN esta ligado (padrao).';
