-- ============================================================
-- Funcionarios, vales e pagamentos (folha simples)
-- 2026-10-10
--
-- O Roger paga parte da equipe por semana, parte por quinzena e parte
-- por mes, e da vales ao longo do periodo. Hoje isso vive de cabeca.
--
-- Desenho:
--   - O salario e sempre cadastrado POR MES. O valor de cada periodo e
--     derivado (src/lib/folha.ts):
--       semanal   = mensal x 12 / 52  (fecha exato com o mensal no ano;
--                                     mensal / 4 pagaria ~1 salario a mais)
--       quinzenal = mensal / 2
--       mensal    = mensal
--   - Vale e anotado na hora e fica "em aberto" (pagamento_id nulo) ate
--     o proximo pagamento, que desconta TODOS os vales em aberto ate a
--     data dele — inclusive vale pego depois do fim do periodo e antes
--     do dia de pagar, porque esse dinheiro ja saiu.
--   - Pagamento grava um retrato do calculo (bruto, vales, ajuste,
--     liquido). Mudar o salario depois nao reescreve o passado.
--
-- Salario e dado sensivel: as rotas /api/funcionarios exigem sessao de
-- admin (src/lib/auth-admin.ts). RLS ligado sem policy = anon nao le.
-- ============================================================

CREATE TABLE IF NOT EXISTS funcionarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL,
  funcao            text,
  telefone          text,
  data_admissao     date NOT NULL,
  data_desligamento date,
  ativo             boolean NOT NULL DEFAULT true,
  frequencia        text NOT NULL CHECK (frequencia IN ('semanal', 'quinzenal', 'mensal')),
  salario_mensal    numeric(12,2) NOT NULL CHECK (salario_mensal >= 0),
  registrado        boolean NOT NULL DEFAULT false,  -- carteira assinada (CLT)
  -- A partir de quando o sistema controla os pagamentos. Sem isso, quem
  -- entrou em 2020 apareceria com centenas de periodos "nao pagos".
  controle_desde    date NOT NULL DEFAULT CURRENT_DATE,
  observacoes       text,
  criado_em         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS funcionario_pagamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  periodo_inicio  date NOT NULL,
  periodo_fim     date NOT NULL,
  data_prevista   date NOT NULL,   -- sabado / dia 5 / dia 20
  pago_em         date NOT NULL,
  valor_bruto     numeric(12,2) NOT NULL,
  total_vales     numeric(12,2) NOT NULL DEFAULT 0,
  ajuste          numeric(12,2) NOT NULL DEFAULT 0,  -- + bonus/hora extra, - falta
  valor_liquido   numeric(12,2) NOT NULL,
  observacoes     text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcionario_id, periodo_fim)
);
ALTER TABLE funcionario_pagamentos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS funcionario_vales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  data            date NOT NULL DEFAULT CURRENT_DATE,
  valor           numeric(12,2) NOT NULL CHECK (valor > 0),
  descricao       text,
  -- Nulo = em aberto (sera descontado no proximo pagamento).
  pagamento_id    uuid REFERENCES funcionario_pagamentos(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE funcionario_vales ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vales_func_aberto
  ON funcionario_vales(funcionario_id) WHERE pagamento_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pag_func
  ON funcionario_pagamentos(funcionario_id, periodo_fim DESC);
