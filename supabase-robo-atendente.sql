-- Robô atendente — estruturas novas. Rodar no SQL Editor do Supabase.

-- 1) Tag "nao_perturbe": o cliente pediu para não receber mais mensagem.
--    A lista de tags tem restricao fixa no banco; precisa recriar incluindo
--    a nova. Manter identica a TAGS_VALIDAS em src/lib/tags.ts.
ALTER TABLE cliente_tags DROP CONSTRAINT IF EXISTS chk_tag_valida;
ALTER TABLE cliente_tags ADD CONSTRAINT chk_tag_valida CHECK (
  tag = ANY (ARRAY[
    'pedreiro','empreiteiro','dono_obra','revendedor',
    'obra_ativa','vip','em_negociacao','inadimplente',
    'nao_perturbe'
  ])
);

-- 2) Fila de atendimento: os casos que o robô passou para o humano.
--    E a "aba de contatos que precisam de atencao".
CREATE TABLE IF NOT EXISTS atendimento_fila (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid REFERENCES clientes(id) ON DELETE CASCADE,
  orcamento_id  uuid REFERENCES orcamentos(id) ON DELETE SET NULL,
  telefone      text,
  motivo        text NOT NULL,   -- desconto_acima_regra | reclamacao | juridico
                                 -- | cliente_irritado | nao_sabe_responder | outro
  resumo        text,            -- o que o robo entendeu do caso
  ultima_msg    text,            -- a mensagem do cliente que disparou o repasse
  origem        text,            -- followup | posvenda | reativacao
  status        text NOT NULL DEFAULT 'aberto',  -- aberto | resolvido
  resolvido_em  timestamptz,
  resolvido_por text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fila_abertos
  ON atendimento_fila (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_fila_cliente
  ON atendimento_fila (cliente_id, criado_em DESC);

COMMENT ON TABLE atendimento_fila IS
  'Casos que o robo repassou para atendimento humano. Alimenta a tela de fila.';
