# Automações de WhatsApp

Como funciona a régua de mensagens automáticas, como conferir a simulação e como ligar o envio de verdade.

## O que existe

São 4 automações, todas rodando dentro do próprio app (o GHL é só o canal de envio — a API dele não permite criar workflow, e o gatilho de verdade está no Supabase):

1. **Follow-up de orçamento** — orçamento emitido e sem resposta recebe mensagem em 4 momentos: `quente` (3–8h, só se o cliente falou com a gente nas últimas 24h), `dia1`, `dia4` e `dia7`. Sai da régua sozinho quando o status do orçamento muda. Se o campo *Data Follow-up* do cliente estiver preenchido, a régua respeita essa data.
2. **Pós-venda** — 1 dia depois da entrega, pergunta se deu tudo certo. Uma vez por cliente, para sempre.
3. **Reativação** — cliente sem comprar há um tempo recebe um toque: obra ativa a cada 7 dias (`reativacao_semanal`), 31–60 dias sem comprar a cada 15 (`reativacao_geral`), mais que isso a cada 30 (`reativacao_retorno`). Cada cadência tem template próprio para o texto não repetir; se o id do template novo ainda não estiver configurado, sai o `reativacao_geral` no lugar. Não dispara para quem tem orçamento aberto.
4. **Contexto (IA)** — a IA lê a conversa do cliente no WhatsApp (via GHL) e escreve um resumo de 2 linhas em *notas de contexto* do cliente. **Não envia nada** — esse resumo é o que deixa as outras três automações personalizadas.

**A regra que manda em tudo:** a janela de 24h do WhatsApp abre quando **o cliente** manda mensagem. Com a janela aberta, a IA escreve uma mensagem personalizada. Fechada, só sai template aprovado pela Meta. Quem decide é o sistema, sozinho, a cada envio.

**Quando roda:** a régua de mensagens roda **de hora em hora** (é o que faz o momento `quente` chegar ainda quente), mas **só envia entre 8h e 18h de Brasília, segunda a sábado — domingo não sai nada**. Fora desse horário o tick conta o que está pendente e espera o próximo horário útil. O follow-up roda toda hora; reativação e pós-venda rodam uma vez por dia, no tick das 9h (não precisam de mais). O resumo de contexto roda às 8h. Cada mensagem tem uma trava no banco (`chave_dedup`) que garante que ela nunca sai duas vezes.

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
| `GHL_TEMPLATE_IDS` | JSON com o id de cada template aprovado na Meta, ex.: `{"followup_dia1":"...","posvenda_check":"..."}`. Sem o id, o envio por template daquele momento falha. **Duas regras automáticas:** (1) se existir a chave com sufixo `_util` (ex.: `followup_dia1_util`, a versão Utility do template, que entrega melhor que Marketing), ela é usada no lugar da versão normal — basta adicionar o id, sem mexer em código; (2) se `reativacao_semanal` ou `reativacao_retorno` ainda não tiverem id, a reativação cai para o `reativacao_geral` em vez de falhar. |
| `CRON_SECRET` | Senha que a Vercel usa para chamar os ticks. Já usada pelos outros crons. |
| `ADMIN_API_KEY` | Chave para disparar os ticks manualmente e para a página `/automacoes` ler o log. |
| `AUTOMACAO_SECRET` | Protege os endpoints de IA (`/api/ia/mensagem` e `/api/ia/contexto`). |
| `GHL_API_KEY` / `GHL_LOCATION_ID` | Acesso ao GHL (buscar contato, ler conversa, enviar). |
| `ANTHROPIC_API_KEY` | A IA que escreve as mensagens e os resumos. |
| `NEXT_PUBLIC_APP_URL` | Endereço do app (os ticks usam para chamar as próprias rotas). |

## Como rodar em simulação

É o estado de fábrica: com `AUTOMACOES_DRY_RUN=true` (ou sem a variável), o cron de hora em hora já calcula tudo e grava no log com status `simulado` (dentro do horário comercial — fora dele nem o log é gravado). Deixe alguns dias rodando e confira em `/automacoes` se as decisões fazem sentido — quem receberia, quando, por IA ou template.

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

## Prévia da copy da IA

Antes de ligar o envio, dá para ler o que a IA escreveria para um cliente de verdade: na página **`/automacoes`**, preencha o telefone no cartão *Prévia da copy da IA*, escolha a automação/momento e clique em *Gerar prévia*. O texto aparece na tela e **nada é enviado** — a prévia é só leitura, mesmo com o envio real ligado.

Por curl, se preferir:

```
curl -H "x-admin-key: SUA_ADMIN_API_KEY" \
  "https://SEU-DOMINIO/api/automacoes/preview?telefone=11999999999&tipo=followup&momento=quente"
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
5. Ficou bom? `AUTOMACOES_DRY_RUN=false` na Vercel, redeploy, e a régua passa a enviar sozinha — de hora em hora, só em horário comercial.

Para desligar tudo a qualquer momento: volte `AUTOMACOES_DRY_RUN` para `true` (ou remova os crons do `vercel.json`).
