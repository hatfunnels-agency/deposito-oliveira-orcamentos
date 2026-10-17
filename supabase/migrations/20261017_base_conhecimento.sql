-- Base de conhecimento do assistente tecnico das atendentes.
--
-- Por que existe: as duvidas do balcao ("quantas latas tem um metro?",
-- "medida do tijolo baianao", "quantas telhas pra X m2", "como marcar entrega
-- parcial") se repetem. O assistente (/api/assistente-tecnico) responde com o
-- catalogo, as regras das calculadoras (laje, ferro) e esta tabela, que o
-- Roger edita em Gestao > Base de conhecimento. Idempotente.

CREATE TABLE IF NOT EXISTS base_conhecimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta text NOT NULL,
  resposta text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('sistema', 'manual')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE base_conhecimento ENABLE ROW LEVEL SECURITY;

-- Semente: so o que vem do proprio sistema (calculadoras, regras do robo) e
-- de medidas padrao de mercado (marcadas para conferir). Nao reinsere o que
-- ja existe (pela pergunta).
INSERT INTO base_conhecimento (pergunta, resposta, tags, origem)
SELECT * FROM (VALUES
  ('Quantas latas tem em um metro de areia, pedra ou pedrisco?',
   'Um metro cúbico (1 m³) de areia, pedra, pedrisco ou pó de pedra tem 48 latas de 20 kg. Meio metro = 24 latas. Se faltaram 3 a 5 latas na entrega, a diferença vai no próximo pedido.',
   ARRAY['agregados','medidas'], 'sistema'),
  ('Vendemos meio metro de areia ou pedra?',
   'Sim. Areia, pedra brita, pedrisco e pó de pedra podem ser vendidos em meio metro (0,5 m³), com preço fixo configurado no sistema (no orçamento, o botão de meio metro aparece nesses produtos). Acima disso, em múltiplos de 0,5 m³.',
   ARRAY['agregados','venda'], 'sistema'),
  ('Qual a diferença entre canaleta e tijolo (ou bloco)?',
   'A canaleta é um bloco em formato de U, sem a parede de cima: serve para passar a ferragem e ser concretada (cinta de amarração, verga e contraverga em cima de portas e janelas). O tijolo/bloco é fechado e serve para levantar a parede. Temos canaleta cerâmica 11,5x24x14 e canaleta de cimento 14x19x39.',
   ARRAY['alvenaria'], 'sistema'),
  ('Quais as medidas do tijolo baianão?',
   'Tijolo baianão (8 furos) padrão de mercado: 9 x 19 x 19 cm. Rende cerca de 25 tijolos por m² de parede assentado com junta de 1 cm. Vendemos por unidade ou por milheiro. ⚠️ Medida padrão de mercado: confirme com o fornecedor se o cliente precisar da medida exata do lote.',
   ARRAY['alvenaria','medidas'], 'sistema'),
  ('Quantos blocos ou tijolos por m² de parede?',
   'Regra prática com junta de 1 cm: tijolo baianão 9x19x19 ≈ 25 por m²; bloco 14x19x39 ou 19x19x39 ≈ 12,5 por m²; bloco 09x19x37 ≈ 13 por m². Acrescente 5 a 10% de quebra.',
   ARRAY['alvenaria','calculo'], 'sistema'),
  ('Quanto de areia (ou terra) para encher um terreno ou fazer um aterro?',
   'Volume = comprimento × largura × altura do aterro (tudo em metros) = m³. Acrescente cerca de 20% para a compactação. Exemplo: 10 m × 8 m com 0,30 m de altura = 24 m³; com compactação ≈ 29 m³. Vendemos em múltiplos de 0,5 m³.',
   ARRAY['agregados','calculo'], 'sistema'),
  ('Laje: qual kit usar (H8, H12, H16)?',
   'Regra da calculadora de laje: as vigotas correm no sentido do lado MENOR do ambiente, então o vão livre é o lado menor (ou o maior trecho, se houver viga no meio). Vão até 4 m: H8 (Lajota para forro; Lajota Piso para piso). Até 5 m: H12 (Isopor para forro; Lajota para piso). Acima de 5 m: H16 Isopor. A especificação final (tipo e armadura) é confirmada pela fábrica.',
   ARRAY['laje','calculo'], 'sistema'),
  ('Laje: quanto de concreto, cimento, areia, pedra e tela?',
   'Concreto (m³) = área da laje (m²) × consumo do kit: H08 Isopor 0,070 · H08 Lajota 0,075 · H08 Lajota Piso 0,080 · H12 Isopor 0,080 · H12 Lajota 0,085 · H16 Isopor 0,095 m³ por m². Traço: 7 sacos de cimento por m³ de concreto, 0,55 m³ de areia e 0,55 m³ de pedra por m³ (areia e pedra arredondam para múltiplos de 0,5 m³). Tela: 1 painel (2x3) a cada 5,1 m² de laje. Exemplo: laje 3x4 = 12 m² com H08 Lajota: 0,9 m³ de concreto → 7 sacos de cimento, 0,5 m³ de areia, 0,5 m³ de pedra e 3 painéis de tela. A calculadora de laje no orçamento faz essa conta.',
   ARRAY['laje','calculo'], 'sistema'),
  ('Quantas vigotas (vigas) vão numa laje de 3x4 m?',
   'As vigotas correm no lado menor (3 m) e são espaçadas pelo intereixo da lajota, em geral 38 a 42 cm (use 0,40 m como referência). Quantidade ≈ lado maior ÷ intereixo + 1 = 4 ÷ 0,40 + 1 ≈ 11 vigotas. Comprimento de cada = lado menor + apoio de ~10 cm em cada lado = 3,20 m, ou seja, ≈ 35 m lineares de viga H8. ⚠️ Confirme com a fábrica, que define a armadura e o intereixo do kit.',
   ARRAY['laje','calculo'], 'sistema'),
  ('Quantas telhas para cobrir uma área?',
   'Use a área útil da telha (descontando a sobreposição de ~14 cm no comprimento e uma onda ~10 cm na largura): fibrocimento 2,44x1,10 ≈ 2,30 m² útil · 1,83x1,10 ≈ 1,69 m² · 2,44x0,92 ≈ 1,89 m² · 2,13x0,92 ≈ 1,63 m² · 1,83x0,92 ≈ 1,39 m² · 2,44x0,50 ≈ 0,92 m². Quantidade = área do telhado ÷ área útil, arredondando para cima, mais 5 a 10% de folga. Exemplo: telhado de 40 m² com telha 2,44x1,10 → 40 ÷ 2,30 = 17,4 → 18 telhas (+10% = 20).',
   ARRAY['telhado','calculo'], 'sistema'),
  ('Quantos parafusos por telha?',
   'Telha de fibrocimento: 4 a 6 parafusos por telha, fixados na crista da onda, sobre as terças (3 por terça em telhas largas). Para 20 telhas, conte 100 a 120 parafusos. Vendemos o Parafuso para Telha por unidade.',
   ARRAY['telhado','calculo'], 'sistema'),
  ('Ferragem (coluna/viga): o que perguntar ao cliente?',
   'Para orçar coluna ou viga precisa de 4 coisas: 1) seção (9x15, 9x20 ou especial), 2) número de barras (4, 6 ou 8), 3) comprimento total em metros (quantas peças × tamanho de cada), 4) espaçamento do estribo (padrão 25 cm; 20, 15 e 10 cm custam mais). Erro comum: o cliente passa só o tamanho e esquece o estribo, ou passa só o estribo — sempre confirme os 4 pontos. Use a Calculadora de Ferro no orçamento: ela monta o item com o preço por metro.',
   ARRAY['ferragem','orcamento'], 'sistema'),
  ('Preço da ferragem montada (coluna/viga) por metro',
   'Tabela da calculadora (estribo a cada 25 cm): 4 barras 9x15 ou 9x20 = R$ 23/m · 4 barras medida especial = R$ 28/m · 6 barras = R$ 38/m · 8 barras = R$ 45/m. Estribo mais fechado soma por metro: 20 cm +R$ 1 · 15 cm +R$ 2 · 10 cm +R$ 4. Barras de ferro 10 mm; estribo de ferro 4,2 mm (comprimento do estribo: 9x15 = 0,58 m; 9x20 = 0,68 m).',
   ARRAY['ferragem','preco'], 'sistema'),
  ('Barra de ferro: qual o tamanho?',
   'As barras têm 12 m: vergalhão 3/8 (10 mm) e barra de 4,2 mm (estribo). Vendemos a barra inteira; o estribo pronto também é vendido por unidade. Ferro cortado/montado sai pela calculadora de ferro.',
   ARRAY['ferragem','medidas'], 'sistema'),
  ('Como tirar um pedido no sistema?',
   'Aba Orçamento: 1) digite o telefone do cliente (ou cadastre), 2) adicione os produtos (busca por nome ou pelo Catálogo), 3) escolha Retirar na loja ou Entrega no endereço (e a data), 4) pagamento. Se o cliente ainda vai decidir: "Salvar orçamento". Se fechou: "Confirmar venda" (vai para Entrega/Retirada Pendente e baixa o estoque). Depois envie no WhatsApp ou imprima.',
   ARRAY['sistema'], 'sistema'),
  ('Como marcar uma entrega parcial?',
   'Abra o pedido (Entrega Pendente) → "Programar entrega parcial" → escolha o dia e o que vai nessa viagem. Para o caminhão, imprima pela "Folha do caminhão" (só os itens da viagem). Quando entregar, marque "Entregue" na viagem; o restante continua pendente. "Marcar tudo entregue" só quando acabar.',
   ARRAY['sistema','entrega'], 'sistema'),
  ('Como marcar que a entrega saiu e foi entregue?',
   'Aba Entregas → Pendentes: selecione as entregas do dia e "Enviar para Rota" (escolhendo o motorista). Depois, em Em Rota, "Entregue". Se tiver saldo a receber, o sistema pergunta como foi pago. Entrega feita fora do roteiro: abra o pedido e use "Marcar tudo entregue".',
   ARRAY['sistema','entrega'], 'sistema'),
  ('A IA fechou uma venda no WhatsApp. O que eu faço?',
   'Em Atendimento, coluna "Vendas da IA · lançar": toque em "Lançar no sistema". O orçamento abre preenchido (cliente, itens, entrega). Confira e use "Confirmar venda". O caso some do quadro sozinho. Chega um aviso sonoro quando entra venda nova.',
   ARRAY['sistema','ia'], 'sistema'),
  ('Como marcar que o cliente é pedreiro ou empreiteiro?',
   'Ao lado do nome do cliente (no orçamento, no pedido ou no perfil) toque em "+ Pedreiro / Empreiteiro". Pedreiro e empreiteiro recebem o desconto profissional automaticamente no orçamento e entram na lista de Clientes › Pedreiros e empreiteiros.',
   ARRAY['sistema','clientes'], 'sistema')
) AS v(pergunta, resposta, tags, origem)
WHERE NOT EXISTS (SELECT 1 FROM base_conhecimento b WHERE b.pergunta = v.pergunta);
