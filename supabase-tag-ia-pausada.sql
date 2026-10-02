-- Tag 'ia_pausada': tira SO o robo de uma conversa. As reguas (follow-up,
-- pos-venda, reativacao) continuam disparando normalmente — diferente de
-- 'nao_perturbe', que cala tudo.
--
-- Serve pra quando a equipe quer tocar o cliente na mao sem o robo entrando
-- por cima. Nao expira: some quando tirarem a tag no perfil do cliente.
--
-- Rodar uma vez no SQL Editor do Supabase (o MCP e read-only).
-- Sem isto, adicionar a tag pelo app devolve erro 400 na constraint.

alter table cliente_tags drop constraint if exists chk_tag_valida;

alter table cliente_tags add constraint chk_tag_valida check (
  tag = any (array[
    'pedreiro',
    'empreiteiro',
    'dono_obra',
    'revendedor',
    'obra_ativa',
    'vip',
    'em_negociacao',
    'inadimplente',
    'nao_perturbe',
    'ia_pausada'
  ])
);
