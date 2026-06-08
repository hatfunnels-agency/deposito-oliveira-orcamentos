# TODO / Tech Debt

## Endereço de entrega: migrar para `endereco_id` FK em `orcamentos`

**Contexto.** O Mapa de Entregas (Sessão 3, Fase 2) usa, como fonte de
lat/lng de cada entrega, o endereço **padrão** do cliente
(`enderecos_clientes` com `is_padrao = true`).

**Limitação aceita.** Um orçamento não aponta para um endereço
específico — `orcamentos` só tem `cliente_id`. Logo, se o cliente tem
vários endereços (ex.: várias obras), a entrega aparece no mapa sempre
no endereço **padrão**, mesmo que a entrega real seja em outro endereço.
Isso é paridade com o sistema atual (que também usa o endereço único
legado de `clientes`), então não é regressão — mas é impreciso.

**Correção proper (sessão futura).**
- Adicionar coluna `endereco_id uuid` em `orcamentos`, FK →
  `enderecos_clientes(id)`.
- Backfill: para os orçamentos existentes, apontar para o endereço
  padrão do cliente.
- Fluxo de criação/edição de orçamento: passar a escolher qual endereço
  de entrega usar.
- `/api/entregas/mapa` e `/api/entregas/rota`: usar `orcamentos.endereco_id`
  em vez do endereço padrão do cliente.

## Tech debt (Sessão 4)

- Endpoint `/api/entregas/mapa` virou dead code após Tarefa 2 — o mapa
  agora consome do parent (que carrega via `/api/entregas/rota`). Remover
  quando confirmar zero callers em produção (Vercel logs).
- Função `getLevaColor` deletada — `leva_id` em `orcamentos` continua no
  schema mas é morto há 30+ dias (0 registros nos últimos 30 dias).
  Considerar `DROP COLUMN orcamentos.leva_id` e drop da tabela
  `levas_entrega` no futuro.
- `PATCH /api/entregas/rota` (mudança de status pra `em_rota`) **não**
  dispara movimentação de estoque que o `PATCH /api/orcamentos/[id]`
  dispararia. Investigar se essa side-effect deveria rodar em mudanças
  via `/api/entregas/rota` (e idem para a transição de volta em caso de
  cancelamento).
- Vercel cron pra rodar geocode loop semanalmente (substituir backfill
  manual de `enderecos_clientes.lat/lng`).
