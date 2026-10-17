# Gestão financeira (`/financeiro`)

Como o módulo funciona, para quem for mantê-lo: o que entrega, modelo de dados, regras de negócio, rotina, automação, configuração e como aplicar o banco.

**Sem números do negócio.** Valores de despesa, dias de vencimento, prazos e credores de dívida, taxas negociadas e CNPJs vivem só no banco e no seed privado (`Financeiro/seed-financeiro-privado.sql`, pasta fora do git). Esta doc e a migration pública descrevem a estrutura, não os números.

Contratos entre API, lib e UI: `src/lib/financeiro/tipos.ts` (fonte da verdade; a doc não repete os tipos). Lib: `src/lib/financeiro/*.ts`. Rotas: `src/app/api/financeiro/*`. Tela: `src/app/financeiro/page.tsx` + `src/components/financeiro/*`.

## 1. O que o módulo entrega e onde cada pedido vive

| Pedido | Seção da tela | Lib | API |
|---|---|---|---|
| 1. Conciliação bancária diária | Conciliação (e Extratos) | `conciliacao.ts`, `importar-lancamentos.ts` | `/api/financeiro/conciliar`, `/api/financeiro/extratos` |
| 2. Contas a pagar | A pagar | `contas-pagar.ts`, `despesas-fixas.ts` | `/api/financeiro/contas-pagar` e `/contas-pagar/acoes` |
| 3. Lançar o que foi pago no dia (dinheiro, PIX, cartão) | Dia, formulário "Lançar pagamento" | `dia.ts`, `contas-pagar.ts` | `/api/financeiro/dia-gestao`, `/api/financeiro/caixa` |
| 4. Clientes com valor pendente, baixa pela atendente | Clientes a receber (única seção da atendente) | `receber.ts` | `/api/financeiro/receber` |
| 5. Desconto da maquininha | Maquininha | `taxas.ts` | `/api/financeiro/taxas`, `/maquininha`, `/reembolsos` |
| 6. Tabela de despesas fixas | Despesas fixas | `despesas-fixas.ts` | `/api/financeiro/despesas-fixas` |
| 7. Líquido final do dia | Dia e Panorama | `dia.ts` | `/api/financeiro/dia-gestao` |
| Panorama | Panorama | `panorama.ts`, `saldos.ts` | `/api/financeiro/panorama`, `/saldos` |
| Fechamento mensal | Fechamento | `fechamento.ts`, `cmv.ts` | `/api/financeiro/fechamento` |
| Simulador de cenários | Simulador | `simulador.ts` | `/api/financeiro/simulador` |
| Fase 2: API de Conciliação Stone | Maquininha (bloco Stone) | `stone-conciliacao.ts`, `xml-min.ts` | `/api/financeiro/stone` |

Princípio: o que o sistema já sabe é derivado (vendas, pagamentos, folha, extrato). O que não existe em lugar nenhum — saldo do banco sem conector, saída avulsa em dinheiro, valor da fatura do cartão — é digitado **uma vez** e vira dado como qualquer outro.

## 2. Rotina humana (o que cabe no celular)

- **Diário, dono (~2 min):** no Panorama, o cartão **Hoje** diz o que falta: tocar "Paguei" nas contas de hoje; informar o saldo do banco (um número) se não importou extrato. Compras no cartão e saídas em dinheiro entram pelo "Lançar pagamento" do Dia.
- **Diário, atendente:** receber e cobrar clientes em "Clientes a receber" (no app principal e em `/financeiro`). É tudo que ela vê.
- **Semanal (segunda):** subir o extrato do banco (OFX ou xlsx) e da Stone (OFX ou csv) em Extratos. A conciliação roda sozinha; só as **Sugestões** pedem um toque.
- **Mensal (dia 2):** abrir o Fechamento. No dia 1 o cron já gerou as contas do mês.

Pagamento de funcionário **não** se lança aqui: é feito em Funcionários e aparece no financeiro sozinho (seção 4.3).

## 3. Modelo de dados

Migration pública: `supabase/migrations/20261016_financeiro_gestao.sql` (idempotente). Tudo em cima do que já existia para extratos (`contas_financeiras`, `categorias_financeiras`, `lancamentos_bancarios`, `regras_categorizacao`, `extratos_importacoes`), vendas (`pagamentos`) e folha (`funcionarios`, `funcionario_pagamentos`, `funcionario_vales`).

### 3.1 Tabelas novas

| Tabela | O que guarda | Chaves de idempotência |
|---|---|---|
| `fornecedores` | Quem recebe. `documentos text[]` (CPF/CNPJ só dígitos, várias filiais), `tipo` (fornecedor, servico, imposto, divida, socio, outro), categoria/conta/método padrão (o modal "Paguei" abre preenchido com o último usado) | `lower(nome)` único |
| `despesas_fixas` | A planilha de custos fixos. `grupo` (linha do Fechamento), `tipo_valor` fixo ou % do faturamento do mês anterior, `dia_vencimento`, `inicio`/`fim` (1º dia do último mês, inclusive), `parcelas_total`, `fonte` (manual, planilha, funcionarios), `gera_conta` | `lower(nome)` único |
| `contas_pagar` | Cada boleto, parcela ou fatura. `status` pendente/pago/cancelado, `competencia` (1º dia do mês a que se refere), `valor_pago` e `ajuste` (juros > 0, desconto < 0), `editada_manualmente`, `precisa_confirmacao`, `estornado_em`/`estorno_motivo` | `chave_recorrencia` único: `despesa_fixa:<id>:<YYYY-MM>`, `fatura:<conta_id>:<YYYY-MM>`, `parcelado:<grupo>:<n>` |
| `taxas_maquininha` | Tabela de taxas por modalidade e faixa de parcelas, **versionada por vigência** (`vigencia_inicio`/`vigencia_fim`); MDR, antecipação (flat ou por mês), dias de liquidação, % de reembolso do fornecedor, base e teto do reembolso | nunca UPDATE em linha vigente: fecha `vigencia_fim` e insere outra |
| `reembolsos_fornecedor` | Reembolso de taxa efetivamente recebido, por mês de referência e forma (crédito em compra, PIX, desconto em boleto...) | — |
| `saldos_conta` | Saldo de uma conta numa data, com origem `extrato`, `manual` ou `conector` | `(conta_id, data, origem)` único |
| `cenarios_financeiros` | Cenários salvos do simulador (`parametros jsonb` = `ParametrosCenario`) | — |
| `financeiro_eventos` | Trilha **append-only**: entidade, ação (pagar, estornar, cancelar, excluir, vincular, desvincular, gerar_mes, gerar_fatura, criar, editar, receber_cliente...), `antes`/`depois` em jsonb, usuário | só INSERT; falha ao gravar só loga |
| `stone_vendas`, `stone_liquidacoes`, `stone_importacoes` | Fase 2: cada transação da API de Conciliação Stone (bruto, líquido, MDR, antecipação, previsão de pagamento), cada liquidação e o log de cada arquivo-dia | `(stone_code, nsu)`, `(stone_code, payment_id)`, `(stone_code, arquivo_data)` |

Toda tabela nova tem RLS ligado sem policy: só o service role (API routes) lê e escreve.

### 3.2 Alterações em tabelas existentes

- `contas_financeiras`: tipo `cartao_credito` e layout `ofx`; `dia_fechamento`/`dia_vencimento` (ciclo da fatura); `ordem`. Conta nova "Cartão de crédito (empresa)".
- `lancamentos_bancarios`: ponteiros `conta_pagar_id`, `funcionario_pagamento_id`, `funcionario_vale_id` (cada um com índice **único parcial**: uma linha por par), `fatura_id` (várias compras apontam para a mesma fatura), `conciliado_em`, `conciliacao_origem` (auto/manual), `taxa_efetiva_pct`. `origem_lancamento` ganha `conector`, `conta_pagar`, `folha` e passa a ter default `extrato`.
- `categorias_financeiras`: `grupo_gestao` (taxonomia do Fechamento: folha, estrutura, operacao, comercial, imposto_socios, divida, cmv_compras, taxas, outro; NULL fica fora) e 4 categorias novas: "Pagamento de fatura de cartao" (transferência), "Reembolso de taxa de cartao (Votoran)" (taxa financeira), "Pro-labore" e "Seguro e IPVA da frota" (custo fixo).
- `pagamentos`: `parcelas_informadas` (o histórico inteiro tem `parcelas = 1` porque a tela nunca perguntou; só o que a UI nova grava vale como informado) e `grupo_recebimento` (um recebimento distribuído em vários pedidos).
- `funcionario_pagamentos` e `funcionario_vales`: `conta_id` e `metodo` (por onde o dinheiro saiu).

### 3.3 A regra do par: `lancamentos_bancarios.conta_pagar_id` é a única verdade

O vínculo entre uma conta a pagar e a linha do extrato/caixa/cartão que a pagou mora **só** em `lancamentos_bancarios.conta_pagar_id`. `ContaPagar.lancamento_id` que a API devolve é um join reverso (`lancamentos_bancarios!conta_pagar_id`), nunca uma coluna espelho — duas colunas apontando uma para a outra desalinham. O mesmo vale para `pagamento_id` (venda) e `funcionario_pagamento_id`/`funcionario_vale_id` (folha). Os índices únicos parciais garantem: uma conta casa com uma linha, um pagamento com uma linha, um pagamento de funcionário com uma linha.

Consequências práticas:
- Desvincular é limpar o ponteiro na linha (e `conciliado_em`). Se a conta foi paga pela conciliação automática, o desvínculo também estorna o pagamento.
- Estornar uma conta apaga os lançamentos que ela criou (origem `conta_pagar`) e só **desvincula** a linha de extrato, que continua existindo porque o dinheiro saiu de verdade.
- Excluir só é permitido sem efeito contábil: conta pendente/cancelada sem linha vinculada; pagamento de venda sem linha de extrato vinculada (com linha, a resposta é 409: registre um estorno).

### 3.4 Estados de uma conta a pagar

`status` é pendente → pago (→ pendente de novo por estorno) ou pendente → cancelado. `situacao` é derivada na leitura, com o dia comercial de São Paulo: atrasada, hoje, a_vencer, paga, cancelada, confirmar. `precisa_confirmacao` marca conta gerada com vencimento já passado (primeira geração daquela despesa): a tela pergunta "já pagou?" antes de contar atraso. `editada_manualmente` protege valor/vencimento alterados à mão contra a próxima sincronização da despesa fixa.

## 4. Regras de negócio

### 4.1 Nada conta duas vezes
- **Folha** realizada vem exclusivamente de `funcionario_pagamentos` (por `periodo_fim` no Fechamento, por `pago_em` no Dia) e `funcionario_vales`. Linhas de extrato categorizadas como "Folha - %" sem vínculo são **excluídas** do realizado e contadas em `qualidade.folha_ja_contada`. Nunca há despesa fixa de folha gerando conta a pagar: a despesa "Folha de pagamento" tem `fonte = funcionarios`, `gera_conta = false`, e seu valor é a soma dos salários ativos.
- **Fatura de cartão** não é despesa. A compra no cartão entra como despesa no dia da compra (lançamento negativo na conta `cartao_credito`); pagar a fatura é transferência banco → cartão (categoria "Pagamento de fatura de cartao", grupo `transferencia`). A fatura existe como conta a pagar (sai caixa, vence) mas fica fora de `pago_no_mes`, do `pago.total` do Dia e do realizado do Fechamento.
- **Transferências próprias** (Stone → Itaú, depósito de dinheiro do caixa no banco) não entram em receita, despesa nem conciliação. Categoria de grupo `transferencia`, documento igual ao CNPJ próprio (`configuracoes.financeiro_cnpj_proprio`) ou contraparte com o nome da empresa são ignoradas e contadas em `transferencias_ignoradas`.
- **Despesa paga por conta a pagar** e a **linha de extrato** correspondente são a mesma coisa: no Fechamento, linhas de saída sem vínculo que coincidem (±0,01, ±3 dias) com uma conta paga ou um pagamento de folha não somam; viram `qualidade.possiveis_duplicidades`.
- **Venda em dinheiro** gera um lançamento no caixa com hash próprio (`pag:<id>`), via upsert: sincronizar de novo não duplica.

### 4.2 Conciliação
- Roda por conta e período, sozinha depois de cada importação e sob demanda. Lê tudo com `lerTudo` (PostgREST corta em 1.000 linhas sem erro) e filtra em memória com `Set` — nunca `.not('id','in', listaGrande)`.
- **Entradas** (banco): pagamento do sistema com valor exato (±0,01) e data a ±1 dia. Candidato único → confiança **alta** (grava); vários → **média** (vira sugestão). Soma de um `grupo_recebimento` ou de pagamentos do mesmo cliente no mesmo dia também é candidato.
- **Stone, PIX na maquininha** ("Transação"): mesma regra; ao vincular grava `taxa_efetiva_pct = tarifa / valor`.
- **Stone, cartão** ("Transferência entre contas Stone", "Recebível de Cartão"): **não casa por linha**. A venda cai líquida da taxa, em D+1, agregada por dia de liquidação. O sistema compara, por dia, o liquidado no extrato com o líquido estimado dos pagamentos de débito/crédito com `data_liquidacao` naquele dia e tira a **taxa efetiva real** (`1 − liquidado / bruto`). Na fase 2, cada liquidação da API Stone casa com a linha do extrato.
- **Saídas**: candidatos são contas pendentes (vencimento ±10 dias) ou pagas sem linha (data ±5 dias). **Alta exige identidade e valor**: documento da linha ∈ `fornecedor.documentos`, **ou** contraparte normalizada contendo um token ≥ 5 letras do nome do fornecedor, **ou** categoria da linha vinda de regra com confiança ≥ 0,9 igual à da conta; **e** valor ±0,01; **e** candidato único. Valor igual sem identidade, ou identidade com diferença até 5% / R$ 20 (juros ou desconto), é **média** — sugestão, nunca gravação automática.
- **Folha**: `funcionario_pagamentos` (valor líquido, `pago_em` ±3 dias) e vales sem linha. Alta se valor ±0,01 e (contraparte contém o nome **ou** é o único candidato do dia).
- Uma conta/folha casa com uma linha (guloso: menor diferença de valor, depois de data). Cada gravação em `try/catch`: violação de índice único (23505) conta em `conflitos` e não aborta.
- Ao aplicar um par alta ou um vínculo manual, a linha ganha categoria coerente (categoria da conta; "Venda - PIX"/"Venda - Cartao (Stone)"; "Folha - Salario"), `categoria_origem = regra`, confiança 1, `revisado = true` — e sai da fila de revisão. Vínculo manual também **aprende**: documento novo vai para `fornecedor.documentos` e a categoria vira regra (`aprenderComCorrecao`).
- Normalização de texto (`normalizar` em `src/lib/categorizacao.ts`): sem acento, maiúsculas, `&` → `E`, espaços colapsados. Banco e adquirente escrevem a mesma razão social de formas diferentes; sem isso a transferência própria escapava da regra.

### 4.3 Dinheiro, cartão e banco
- Pagar conta em **dinheiro** (ou pela conta de tipo caixa) cria o lançamento negativo no caixa, já vinculado (`origem_lancamento = conta_pagar`). Pagar no **cartão da empresa** cria o lançamento negativo na conta do cartão; a fatura do mês é gerada sob demanda somando os lançamentos sem `fatura_id` no ciclo (fechamento → fechamento). Pagar por **banco** não cria linha: o extrato chega depois e a conciliação liga.
- **Folha** paga em Funcionários segue a mesma regra: dinheiro/cartão → lançamento vinculado (`origem_lancamento = folha`); banco → o extrato concilia.
- Saldo "de agora" de banco/adquirente = último saldo em `saldos_conta` + movimentos do extrato depois dele − contas pagas pela conta sem linha − folha paga pela conta sem linha. Caixa e cartão = soma dos próprios lançamentos.

### 4.4 Maquininha
- O custo de cada venda **não é gravado**: é calculado na leitura pela tabela **vigente na data do pagamento** (`escolherTaxa`/`calcularCusto` em `taxas.ts`). Mudar a tabela não reescreve o passado, porque a linha antiga continua existindo com `vigencia_fim`.
- Antecipação `por_mes`: para cada parcela k de n, `(valor/n) × pct × max(0, 30k − dias_liquidacao) / 30`. Débito em D+1 dá ≈ 0.
- Reembolso previsto = custo bruto × `reembolso_percentual` da faixa (base `todas_vendas`; `itens_votoran` ainda não implementada: trata como 0 e marca `reembolso_base_pendente`). Reembolso **recebido** vem de `reembolsos_fornecedor`. O Fechamento mostra taxas líquidas previstas × realizadas.
- Sem tabela cadastrada, `calcularCusto` devolve custo 0 com `fonte = sem_tabela` e a tela pede o cadastro — melhor zero declarado do que um número inventado.
- Pagamentos de crédito com `parcelas_informadas = false` são mostrados como "% do volume de crédito sem parcelas" — a antecipação deles está subestimada. Na fase 2, a venda casada com a API Stone copia as parcelas reais para o pagamento.

### 4.5 Competência × caixa, e o dia comercial
- O **Fechamento** tem dois blocos: Resultado por competência (vendas por `criado_em`, contas por `competencia`, folha por `periodo_fim`) e Caixa do mês (tudo por data de pagamento). Eles não batem por definição; a tela explica por quê.
- CMV = Σ quantidade × `preco_custo` do snapshot em `orcamento_itens` (se 0, custo atual do produto), por unidade de venda, **sem** `fator_conversao` — igual ao dashboard.
- Dia comercial é **America/Sao_Paulo**; o servidor roda em UTC. Datas de negócio passam por `hojeSP()`/`dataBRT()` (`datas.ts`); `data_pagamento` é timestamptz, `lancamentos_bancarios.data` é date.
- Dinheiro vem do Supabase como string (`numeric`): `Number(...)` ao ler, `arred2` ao devolver.

## 5. Automação

| Evento | O que acontece sozinho |
|---|---|
| Cron diário (`/api/cron/financeiro`, agendado em `vercel.json` para 09:00 UTC = 06:00 BRT, autenticado por `CRON_SECRET`) | Gera as contas do mês atual e do seguinte a partir das despesas fixas ativas com valor (`gerarContasDoMes`: chave `despesa_fixa:<id>:<YYYY-MM>`, upsert com `ignoreDuplicates`; sincroniza valor/vencimento das pendentes não editadas; marca retroativas com `precisa_confirmacao`). Fase 2: importa as vendas Stone de D−1 e casa com os pagamentos. |
| Importar extrato (`/api/financeiro/extratos`) | Parse (xlsx/csv/OFX) → dedupe por hash e **por conteúdo** (data, valor) para o período do arquivo (protege xlsx → OFX do mesmo mês) → categorização por regra, depois IA → saldo final do arquivo em `saldos_conta` (origem `extrato`) → `conciliar({ aplicar: true })`. Linhas conciliadas saem da fila de revisão. |
| Venda paga em dinheiro (`POST /api/pagamentos`) | Lançamento no caixa (hash `pag:<id>`, idempotente). |
| Pagar conta em dinheiro ou cartão | Lançamento criado e vinculado (seção 4.3). |
| Folha paga em Funcionários (dinheiro ou cartão) | Lançamento criado e vinculado; aparece no Dia e no Fechamento uma vez. |
| Qualquer pagamento registrado | Taxa, antecipação, reembolso previsto, líquido e data de liquidação calculados na leitura pela tabela vigente. |
| Pagar, estornar, cancelar, excluir, vincular, desvincular, gerar mês/fatura, salvar taxa, informar saldo | Linha em `financeiro_eventos`. |

## 6. Configurar taxas e o reembolso do fornecedor

1. **Maquininha › editor de taxas.** Informe a data a partir da qual a nova tabela vale e as linhas (modalidade, faixa de parcelas, MDR, modo e % de antecipação, dias de liquidação, % de reembolso, base). `PUT /api/financeiro/taxas` versiona: linha vigente que mudou ou saiu ganha `vigencia_fim = véspera`; as novas nascem com `vigencia_inicio` informada; linhas idênticas ficam. Nada é alterado in place.
2. Linhas com observação "Valor padrão" geram alerta baixo no Panorama até alguém confirmar no contrato. O seed privado entrega a tabela inicial com esse rótulo.
3. **Reembolso do fornecedor de cimento (Votoran).** O acordo informado é parametrizado por faixa de parcelas na própria tabela (`reembolso_percentual`, `base_reembolso`, `teto_reembolso_mensal`) e rotulado "a confirmar" enquanto escopo, teto e forma não forem confirmados. O que foi efetivamente recebido entra em Maquininha › Reembolsos (ou `POST /api/financeiro/reembolsos`), com mês de referência e forma — inclusive crédito em compra, que não passa pelo banco.
4. **Categorização automática da entrada.** A regra `('contraparte', 'VOTORAN')` → "CMV - Cimento" já existe e o par (campo, padrão) é único; por isso o reembolso é reconhecido por **outro campo**: `('descricao', 'VOTORAN')` e `('contraparte', 'VOTORANTIM')`, ambas com prioridade **11**, abaixo da regra de compra (10). A ordem importa: a guarda de sinal de `classificarPorRegras` pula regra de despesa em entrada e segue procurando, mas não protege `taxa_financeira` em saída — e no Itaú a descrição do boleto traz o nome do beneficiário. Com 11, saída casa com CMV e entrada cai no reembolso. Limite conhecido: um PIX recebido cuja descrição seja só "PIX RECEBIDO" e cuja contraparte seja o nome curto não casa por regra; cai na IA ou na revisão manual.

## 7. OFX: como exportar

O importador aceita `.xlsx`/`.csv` (layouts atuais) e `.ofx` (detectado pelo conteúdo, `OFXHEADER` ou `<OFX>`, com prioridade sobre o layout da conta). OFX traz `FITID` (identificador único por transação), o que torna a reimportação exata, e `LEDGERBAL` (saldo final), que alimenta `saldos_conta` sozinho.

**Itaú Empresas (internet banking PJ):** Conta corrente › Extrato › escolha o período (o banco limita a janela; para períodos maiores, exporte em partes) › **Salvar em outros formatos › OFX**. Suba o arquivo em `/financeiro` › Extratos escolhendo a conta do banco.

**Conta Stone (portal ou app):** Extrato › escolha o período › **Baixar › OFX** (o csv continua aceito). Suba escolhendo a conta Stone.

Depois da importação a resposta diz quantas linhas eram novas, quantas já existiam (por hash e por conteúdo), quantas foram categorizadas por regra e por IA, quantas foram conciliadas e quantas sugestões sobraram, e qual saldo foi registrado. Importar o mesmo período duas vezes, em formatos diferentes, não duplica.

## 8. Fase 2: API de Conciliação Stone

A API (gratuita) devolve, por StoneCode e por dia, um arquivo com cada transação de cartão — bruto, líquido, MDR, antecipação, parcelas, previsão de pagamento — e cada liquidação. É o que permite custo **real** por venda, parcelas reais e o casamento linha a linha do extrato Stone.

**Criar a chave:** Portal Stone › Perfil › **Chaves de Autenticação** › Criar Chave › escolher **"API de Conciliação Stone"**. Guarde a chave: ela só aparece uma vez.

**Variáveis de ambiente (Vercel):**

| Variável | O que faz |
|---|---|
| `STONE_CONCILIACAO_CHAVE` | A chave criada acima. Vai no header `Authorization: Basic base64("chave:")`. Sem ela o bloco Stone da Maquininha mostra "não configurado" e o cron pula a etapa. |
| `STONE_CODES` | StoneCodes das maquininhas, separados por vírgula. Um arquivo por código por dia. |
| `CRON_SECRET` | Já existe; autentica `/api/cron/financeiro`. |

**Como roda:** o arquivo de um dia só fica pronto depois das 05:00 BRT do dia seguinte, por isso o cron importa D−1. A API limita chamadas por StoneCode e data; `stone_importacoes` guarda o status de cada dia e o sistema não reimporta um dia `ok` sem `forcar`. Depois de importar, `casarVendasComPagamentos` liga cada venda ao pagamento do sistema (valor bruto ±0,01, até 36 h de distância, parcelas iguais quando informadas) e copia as parcelas reais para pagamentos que não as tinham. `custosDoPeriodo` passa a usar `custoReal` (fonte `stone`) para as vendas casadas; `cobertura_real_pct` mostra quanto do volume já tem custo real.

Documentação de referência (ler antes de mexer no parser): conciliacao.stone.com.br/reference — overview da API cliente, layout 2.4 do arquivo completo, Transaction, Installments, Payment, FeeType e rate limit.

## 9. Segurança

- `/api/*` não passa pelo proxy de sessão (`src/proxy.ts`). Por isso toda rota gerencial nova exige `Authorization: Bearer <access_token da sessão>` e confere o papel em `usuarios` via `exigirPapel(request, papeis)` (`src/lib/auth-admin.ts`): **admin** para tudo; **admin ou atendente** só em `/api/financeiro/receber`; `CRON_SECRET` em `/api/cron/financeiro`. Motorista é redirecionado para fora de `/financeiro`.
- Nenhuma rota sem autenticação devolve nome de funcionário, valor de folha ou lista de contas a pagar. As rotas antigas (`/api/financeiro`, `/dia`, `/dre`, `/lancamentos`, `/caixa`) mantêm a resposta de antes; `/api/financeiro/extratos` passou a exigir Bearer admin.
- RLS ligado em toda tabela, sem policy: só o service role acessa, e ele só existe no servidor (`src/lib/supabase.ts`). Nunca importar `supabaseAdmin` em componente cliente.
- Deletes só sem efeito contábil; o resto se desfaz por estorno, e `financeiro_eventos` registra quem fez o quê.
- **O que nunca vai no repositório** (ele é público): CPF/CNPJ (de fornecedor, funcionário ou da empresa), salários, valores de despesa, dias de vencimento, prazos e credores de dívida, taxas negociadas, extratos (`*.ofx`, `/extratos/`, `/Financeiro/` estão no `.gitignore`), chaves e tokens. Comentários em migration também contam: explique o porquê sem o número.

## 10. Como aplicar a migration e o seed privado

1. **Migration pública** — `supabase/migrations/20261016_financeiro_gestao.sql`. Rode inteira no SQL Editor do projeto Supabase (ou pelo conector claude.ai Supabase, que escreve como `postgres`). É idempotente: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP CONSTRAINT IF EXISTS` antes de recriar cada CHECK. Rodar de novo não estraga nada, inclusive depois do seed privado (os seeds públicos usam `DO NOTHING` e os UPDATEs de `grupo_gestao` só preenchem o que está nulo).
2. **Seed privado** — `Financeiro/seed-financeiro-privado.sql`, só na máquina do dono (a pasta não está no git). Rode depois da migration (ele checa e aborta se as tabelas não existirem). Preenche valores e dias das despesas fixas, cadastra as dívidas e seus credores, a tabela inicial de taxas rotulada "Valor padrão", os documentos dos fornecedores lidos do extrato já importado e `configuracoes.financeiro_cnpj_proprio`, também lido do extrato. Idempotente.
3. **Verificação** — as queries comentadas no fim de cada arquivo: contagem por tabela, `grupo_gestao` de cada categoria, as duas regras do reembolso com prioridade 11, CHECKs recriados e RLS ligado.
4. **Na tela** — Despesas fixas sem selo "Confirmar valor" (só "Confirmar dia"), Maquininha com as taxas e o alerta de valor padrão, Panorama sem alerta de "despesa fixa com valor 0". Depois, `Gerar contas do mês` em A pagar ou esperar o cron das 06:00.
5. **Variáveis** — `CRON_SECRET` já existe. `STONE_CONCILIACAO_CHAVE` e `STONE_CODES` só na fase 2.

Para adicionar uma despesa fixa ou um fornecedor depois, use a tela (ou `POST /api/financeiro/despesas-fixas` / `/fornecedores`): não precisa de migration. Mudanças de estrutura entram como nova migration em `supabase/migrations/`, no mesmo padrão: cabeçalho com o porquê, idempotente, RLS em tabela nova, sem número do negócio.

## 11. Armadilhas para quem mantém

- **PostgREST corta em 1.000 linhas sem erro.** Toda leitura que pode passar disso usa `lerTudo`/`lerTudoEmLotes` (`src/lib/ler-tudo.ts`).
- **supabase-js não tem `ON CONFLICT DO NOTHING`**: use `.upsert(linhas, { onConflict: 'coluna', ignoreDuplicates: true })` (chaves: `chave_recorrencia`, `hash_linha`, `conta_id,data,origem`).
- **Não crie coluna espelho de vínculo** em `contas_pagar`; o par vive em `lancamentos_bancarios` (seção 3.3).
- **Não grave custo de taxa em `pagamentos`**; ele é derivado da tabela vigente na data.
- **Taxas**: nunca UPDATE in place de linha vigente; versione.
- **`grupo_gestao`**: a migration só preenche categorias com valor nulo. Reclassificar uma categoria é um UPDATE explícito, que sobrevive à reexecução.
- `atualizado_em` de `fornecedores`, `despesas_fixas`, `contas_pagar` e `cenarios_financeiros` é mantido por trigger (`financeiro_marcar_atualizado_em`); não precisa setar na app.
- **Projeto no Next 16**: `params` de rota dinâmica é `Promise` (`await params`); o "middleware" é `src/proxy.ts`.
- Decisões ainda abertas no negócio, todas rotuladas na tela: dias de vencimento das despesas, condição do financiamento do caminhão, escopo/teto/forma do reembolso do fornecedor de cimento, banco emissor e ciclo do cartão da empresa.
