-- Venda fechada pela IA no WhatsApp -> caso no kanban do atendimento para a
-- atendente lancar no sistema.
--
-- Por que existe: a IA nao cria pedido (regra do robo). Quando o cliente
-- fecha na conversa, ninguem era avisado: a venda so existia no GHL. Agora o
-- robo devolve a acao `venda_fechada` com os itens, e o webhook abre um caso
-- com motivo 'venda_fechada' e os itens ja casados com o catalogo em `dados`.
-- O sistema abre o orcamento pre-preenchido por /?lancar=<caso> e, ao salvar,
-- grava `lancado_orcamento_id` e resolve o caso. Idempotente e so aditiva.

ALTER TABLE atendimento_fila ADD COLUMN IF NOT EXISTS dados jsonb;
ALTER TABLE atendimento_fila ADD COLUMN IF NOT EXISTS lancado_orcamento_id uuid REFERENCES orcamentos(id) ON DELETE SET NULL;
COMMENT ON COLUMN atendimento_fila.dados IS
  'Venda fechada pela IA: { itens: [{descricao, quantidade, unidade, produto_id, produto_nome, preco}], total_estimado, entrega, endereco, pagamento, observacao }.';

CREATE INDEX IF NOT EXISTS idx_atendimento_fila_motivo_aberto ON atendimento_fila (motivo, criado_em DESC) WHERE status = 'aberto';
