-- Inicio do periodo aquisitivo de ferias/13o, separado da admissao.
--
-- Por que existe: quando o Roger comprou o deposito (01/04/2026) ele acertou
-- os direitos do ano de alguns funcionarios. A admissao real continua sendo a
-- data de entrada (ela define desde quando o salario conta), mas o proximo
-- vencimento de ferias passa a contar de `direitos_desde`. NULL = conta da
-- admissao. Idempotente e so aditiva.

ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS direitos_desde date;
COMMENT ON COLUMN funcionarios.direitos_desde IS
  'Inicio do periodo aquisitivo atual (ferias/13o) quando os direitos ja foram acertados apos a admissao. NULL = conta da data_admissao.';
