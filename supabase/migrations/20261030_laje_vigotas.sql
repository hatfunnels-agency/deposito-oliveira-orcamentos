-- Pedido de laje "por vigotas" (29/10/2026): renomeia as vigotas e grava a
-- quantidade de lajotas por m² usada na referência (mesma conta da Laje Master:
-- 6 m² -> 69 lajotas). Só DML — rodado em produção pelo Claude Code.
update produtos set nome = 'Vigota Treliçada H8'  where nome = 'Mt. Linear Viga H8';
update produtos set nome = 'Vigota Treliçada H12' where nome = 'Mt. Linear Viga H12';
insert into laje_parametros (chave, valor, descricao)
values ('lajotas_por_m2', 11.5, 'Lajotas por m² de laje (referência da aba Por vigotas)')
on conflict (chave) do nothing;
