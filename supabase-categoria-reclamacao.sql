-- Categoria do problema na fila de atendimento.
--
-- O `motivo` que ja existe diz POR QUE escalou (reclamacao, cliente_irritado,
-- nao_sabe_responder). Nao diz SOBRE O QUE. Sem o tema nao da pra responder
-- "qual reclamacao e a mais frequente", que e o ponto do acompanhamento.
--
-- Rodar uma vez no SQL Editor do Supabase (o MCP e read-only).

alter table atendimento_fila
  add column if not exists categoria text;

alter table atendimento_fila
  drop constraint if exists chk_categoria_valida;

alter table atendimento_fila
  add constraint chk_categoria_valida check (
    categoria is null or categoria = any (array[
      'entrega',       -- atraso, nao chegou, cade o caminhao
      'material',      -- errado, faltando, quebrado
      'atendimento',   -- demora, prometeram retorno e nao voltaram
      'outro'          -- o que nao couber acima (cobranca, duvida, etc)
    ])
  );

create index if not exists idx_fila_categoria
  on atendimento_fila (categoria, criado_em desc);

comment on column atendimento_fila.categoria is
  'Tema da reclamacao, classificado pelo robo. NULL nos casos anteriores a 02/10/2026.';
