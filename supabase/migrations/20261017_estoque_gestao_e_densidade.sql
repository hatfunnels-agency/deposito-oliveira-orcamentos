-- Estoque na gestao financeira + lancar por foto.
--
-- Por que existe:
-- 1. O estoque nunca foi contado: estoque_atual esta quase todo em zero e a
--    venda so da baixa. A aba Estoque do /financeiro passa a registrar
--    perda e contagem fisica, que nao cabiam nos tipos antigos de
--    movimentacoes_estoque (entrada, saida, ajuste, cancelamento).
--    'contagem' DEFINE o saldo contado e guarda a diferenca; 'perda' e
--    quebra/avaria/furto com motivo.
-- 2. Pedra e areia chegam com ticket de pesagem (peso da carga, em kg) e o
--    estoque e o custo sao em m3. m3 = toneladas / densidade aparente do
--    material. A densidade fica no produto para o usuario poder corrigir
--    sem deploy; a tela de leitura usa o valor cadastrado e, se vazio, cai
--    numa regra pelo nome.
-- 3. A foto do comprovante/ticket fica guardada num bucket PRIVADO para
--    conferencia (so a service role le e grava).
--
-- Idempotente: pode rodar de novo sem estragar nada. Nao traz numero do
-- negocio (a densidade e propriedade fisica do material, nao preco).

-- ------------------------------------------------------------ 1. tipos
ALTER TABLE movimentacoes_estoque DROP CONSTRAINT IF EXISTS movimentacoes_estoque_tipo_check;
ALTER TABLE movimentacoes_estoque ADD CONSTRAINT movimentacoes_estoque_tipo_check
  CHECK (tipo = ANY (ARRAY['entrada', 'saida', 'ajuste', 'cancelamento', 'perda', 'contagem']));

-- Painel le a ultima entrada/contagem por produto e o historico do produto.
CREATE INDEX IF NOT EXISTS idx_mov_estoque_produto_criado
  ON movimentacoes_estoque (produto_id, criado_em DESC);

-- ------------------------------------------------------------ 2. densidade
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS densidade_t_m3 numeric;
COMMENT ON COLUMN produtos.densidade_t_m3 IS
  'Densidade aparente (t/m3) do agregado a granel. Converte o peso do ticket de pesagem em m3: m3 = peso liquido (t) / densidade. NULL = nao se aplica.';

-- Agregados vendidos por m3 (nao os sacos de 20 kg, que tem unidade saco).
-- So preenche o que esta vazio: correcao feita a mao sobrevive a reexecucao.
UPDATE produtos SET densidade_t_m3 = 1.5
WHERE densidade_t_m3 IS NULL
  AND unidade IN ('m³', 'm3', 'M³', 'M3')
  AND nome ILIKE 'areia fina%';

UPDATE produtos SET densidade_t_m3 = 1.4
WHERE densidade_t_m3 IS NULL
  AND unidade IN ('m³', 'm3', 'M³', 'M3')
  AND (
       nome ILIKE 'areia m_dia%'      -- media / média
    OR nome ILIKE 'areia grossa%'
    OR nome ILIKE 'pedra brita%'
    OR nome ILIKE 'pedrisco%'
    OR nome ILIKE 'p_ de pedra%'      -- po / pó
  );

-- ------------------------------------------------------------ 3. bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'financeiro-comprovantes',
  'financeiro-comprovantes',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ verificacao
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'movimentacoes_estoque_tipo_check';
-- SELECT nome, unidade, densidade_t_m3 FROM produtos WHERE densidade_t_m3 IS NOT NULL ORDER BY nome;
-- SELECT id, public FROM storage.buckets WHERE id = 'financeiro-comprovantes';
