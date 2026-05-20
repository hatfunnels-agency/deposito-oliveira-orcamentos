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
