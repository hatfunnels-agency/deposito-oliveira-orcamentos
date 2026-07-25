-- ============================================================
-- Tornar 'entrega_parcial' um status valido de orcamentos
-- 2026-07-25
--
-- Lacuna: o codigo (enum OrcamentoStatus, STATUS_LABELS, entrega parcial)
-- usa o status 'entrega_parcial', mas ele NUNCA foi adicionado ao CHECK
-- constraint orcamentos_status_check. Resultado: toda vez que uma entrega
-- parcial tentava gravar status='entrega_parcial', o Postgres rejeitava e
-- o endpoint (que nao conferia o erro) falhava em silencio — o pedido
-- ficava preso em 'entrega_pendente' e "entrega parcial" nunca colava.
--
-- Correcao: recria o constraint incluindo 'entrega_parcial'. So ADICIONA
-- um valor permitido, nao invalida nenhuma linha existente.
-- ============================================================

alter table orcamentos drop constraint if exists orcamentos_status_check;

alter table orcamentos add constraint orcamentos_status_check
  check (status in (
    'orcamento',
    'pagamento_pendente',
    'pagamento_ok',
    'separacao',
    'entrega_pendente',
    'entrega_parcial',
    'retirada_pendente',
    'em_rota',
    'completo',
    'ocorrencia',
    'cancelado'
  ));
