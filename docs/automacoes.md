# Automações de WhatsApp

Como funciona a régua de mensagens automáticas, como conferir a simulação e como ligar o envio de verdade.

## O que existe

São 4 automações, todas rodando dentro do próprio app (o GHL é só o canal de envio — a API dele não permite criar workflow, e o gatilho de verdade está no Supabase):

1. **Follow-up de orçamento** — orçamento emitido e sem resposta recebe mensagem em 4 momentos: `quente` (3–24h, só se o cliente falou com a gente nas últimas 24h), `dia1`, `dia4` e `dia7`. Sai da régua sozinho quando o status do orçamento muda. Se o campo *Data Follow-up* do cliente estiver preenchido, a régua respeita essa data.
2. **Pós-venda** — 1 dia depois da entrega, pergunta se deu tudo certo. Uma vez por cliente, para sempre.
3. **Reativação** — cliente sem comprar há um tempo recebe um toque: obra ativa a cada 7 dias, 31–60 dias sem comprar a cada 15, mais que isso a cada 30. Não dispara para quem tem orçamento aberto.
4. **Contexto (IA)** — a IA lê a conversa do cliente no WhatsApp (via GHL) e escreve um resumo de 2 linhas em *notas de contexto* do cliente. **Não envia nada** — esse resumo é o que deixa as outras três automações personalizadas.

**A regra que manda em tudo:** a janela de 24h do WhatsApp abre quando **o cliente** manda mensagem. Com a janela aberta, a IA escreve uma mensagem personalizada. Fechada, só sai template aprovado pela Meta. Quem decide é o sistema, sozinho, a cada envio.

Tudo roda uma vez por dia pelo cron da Vercel: contexto às 8h e a régua de mensagens às 9h (horário de Brasília). Cada mensagem tem uma trava no banco (`chave_dedup`) que garante que ela nunca sai duas vezes.

## Onde conferir

Página **`/automacoes`** no próprio sistema (faça login normal). Mostra os totais por status e por tipo, com filtros por período. Cada linha diz: quem ia receber, por qual via (IA ou template) e por quê — sem precisar abrir o Supabase.

- `simulado` = o sistema calculou e registrou, mas **não enviou** (modo simulação)
- `enviado` = mensagem realmente enviada (só com o modo real ligado)
- `pulado` = não fazia sentido enviar (ex.: contato não existe no GHL, janela fechada sem template)
- `erro` = tentou e falhou — o motivo aparece na última coluna
- `concluido` = resumo de contexto gerado (a 4ª automação, que não envia mensagem)

## Variáveis de ambiente (Vercel)

| Variável | O que faz |
|---|---|
| `AUTOMACOES_DRY_RUN` | **A chave geral.** `true` (ou ausente) = simulação, nada é enviado. `false` = envio real. |
| `GHL_TEMPLATE_IDS` | JSON com o id de cada template aprovado na Meta, ex.: `{"followup_dia1":"...","posvenda_check":"..."}`. Sem o id, o envio por template daquele momento falha. |
| `CRON_SECRET` | Senha que a Vercel usa para chamar os ticks. Já usada pelos outros crons. |
| `ADMIN_API_KEY` | Chave para disparar os ticks manualmente e para a página `/automacoes` ler o log. |
| `AUTOMACAO_SECRET` | Protege os endpoints de IA (`/api/ia/mensagem` e `/api/ia/contexto`). |
| `GHL_API_KEY` / `GHL_LOCATION_ID` | Acesso ao GHL (buscar contato, ler conversa, enviar). |
| `ANTHROPIC_API_KEY` | A IA que escreve as mensagens e os resumos. |
| `NEXT_PUBLIC_APP_URL` | Endereço do app (os ticks usam para chamar as próprias rotas). |

## Como rodar em simulação

É o estado de fábrica: com `AUTOMACOES_DRY_RUN=true` (ou sem a variável), o cron diário já calcula tudo e grava no log com status `simulado`. Deixe alguns dias rodando e confira em `/automacoes` se as decisões fazem sentido — quem receberia, quando, por IA ou template.

Para não esperar o cron, dispare na mão (troque a chave e o domínio):

```
curl -H "x-admin-key: SUA_ADMIN_API_KEY" \
  "https://SEU-DOMINIO/api/automacoes/tick?tipos=followup,posvenda,reativacao"
```

O resumo de contexto (que não envia nada e por isso roda de verdade mesmo em simulação):

```
curl -H "x-admin-key: SUA_ADMIN_API_KEY" \
  "https://SEU-DOMINIO/api/automacoes/tick-contexto"
```

## Teste com um número só

Antes de ligar para todo mundo, teste com o seu próprio número: `?telefone=` restringe o tick àquele número, e o resto do mundo fica de fora.

```
curl -H "x-admin-key: SUA_ADMIN_API_KEY" \
  "https://SEU-DOMINIO/api/automacoes/tick?tipos=followup&telefone=11999999999"
```

Em simulação, isso só gera a linha no log. Com o envio real ligado, a mensagem chega de verdade **só nesse número**.

## Como ligar de verdade

1. Rode o `supabase-automacoes.sql` no SQL Editor do Supabase (uma vez só).
2. Confira os templates aprovados na Meta e preencha `GHL_TEMPLATE_IDS` na Vercel com os ids do GHL.
3. Deixe alguns dias em simulação e revise o log em `/automacoes`.
4. Faça o teste de um número só (acima) com `AUTOMACOES_DRY_RUN=false` **e** `?telefone=seu número`.
5. Ficou bom? `AUTOMACOES_DRY_RUN=false` na Vercel, redeploy, e a régua passa a enviar no cron diário.

Para desligar tudo a qualquer momento: volte `AUTOMACOES_DRY_RUN` para `true` (ou remova os crons do `vercel.json`).
