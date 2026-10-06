-- Orcamento perdido (cliente comprou em outro lugar, achou caro, desistiu).
--
-- NAO e um status novo, de proposito. Um status "perdido" exigiria mexer em
-- 17 filtros espalhados em 9 arquivos — todo lugar que trata "nao e
-- orcamento nem cancelado" como VENDA, financeiro incluido. Esquecer um faria
-- orcamento perdido virar receita.
--
-- Entao perdido = status 'cancelado' + estas duas colunas. Cancelado o
-- sistema inteiro ja trata como "nao e venda", e a regua de follow-up ja so
-- olha status 'orcamento' — sai da sequencia sozinho. As colunas so dizem
-- que o cancelamento foi uma PERDA, e por que, pra dar pra contar depois.
--
-- Rodar uma vez no SQL Editor do Supabase (o MCP e read-only). RODAR ANTES do
-- deploy: as telas passam a pedir estas colunas.

alter table orcamentos add column if not exists perdido_em timestamptz;
alter table orcamentos add column if not exists motivo_perda text;

alter table orcamentos drop constraint if exists chk_motivo_perda;
alter table orcamentos add constraint chk_motivo_perda check (
  motivo_perda is null or motivo_perda = any (array[
    'concorrente',   -- comprou em outro deposito
    'preco',         -- achou caro
    'desistiu',      -- desistiu ou adiou a obra
    'outro'
  ])
);

create index if not exists idx_orcamentos_perdido on orcamentos (perdido_em desc)
  where perdido_em is not null;
