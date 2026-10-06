-- Resultado das tarefas da atendente (pagina /tarefas).
--
-- As tarefas em si NAO ficam no banco: sao calculadas na hora (retornos,
-- orcamentos grandes em aberto, reativacao). O que fica aqui e o que a
-- atendente FEZ com cada uma — e e isso que:
--   - tira a tarefa da lista (por um tempo que depende do resultado);
--   - cala o robo e as reguas com quem ela acabou de falar;
--   - alimenta o placar do dia.
--
-- `chave` identifica a tarefa: 'retorno:<cliente>:<data>', 'orcamento:<id>',
-- 'reativacao:<cliente>'. Nao e unica de proposito: a mesma tarefa pode ter
-- "sem resposta" hoje e "feito" depois; vale sempre o resultado mais recente.
--
-- Rodar uma vez no SQL Editor do Supabase (o MCP e read-only).

create table if not exists tarefas_atendente (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null,
  tipo          text not null check (tipo in ('retorno', 'orcamento', 'reativacao')),
  cliente_id    uuid references clientes(id) on delete cascade,
  orcamento_id  uuid references orcamentos(id) on delete set null,
  resultado     text not null check (resultado in ('feito', 'sem_resposta', 'perdido')),
  observacao    text,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_tarefas_chave on tarefas_atendente (chave, criado_em desc);
create index if not exists idx_tarefas_cliente on tarefas_atendente (cliente_id, criado_em desc);
create index if not exists idx_tarefas_data on tarefas_atendente (criado_em desc);

alter table tarefas_atendente enable row level security;
