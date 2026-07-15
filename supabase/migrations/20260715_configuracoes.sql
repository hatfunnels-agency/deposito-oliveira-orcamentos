-- ============================================================
-- Tabela de configuracoes (chave/valor) + capacidade de amarracao
-- 2026-07-15
--
-- Config editavel sem deploy. Primeira chave: quantos metros de ferragem
-- o patio amarra por dia (hoje 70). A previsao de "fica pronto em" divide
-- os metros da fila por esse numero.
-- ============================================================

create table if not exists configuracoes (
  chave         text primary key,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

comment on table configuracoes is 'Config chave/valor editavel pela app (ex: capacidade de amarracao de ferragem).';

insert into configuracoes (chave, valor) values ('ferragem_capacidade_m_dia', '70')
  on conflict (chave) do nothing;

alter table configuracoes enable row level security;
