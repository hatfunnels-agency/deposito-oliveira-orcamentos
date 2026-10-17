-- Produto so de estoque (nao vendavel) + estribo pronto baixando do ferro.
--
-- Por que existe: o ferro e controlado em METROS (Ferro 10mm, Ferro 4,2mm
-- estribo), mas vendido em barra de 12 m, em estribo pronto ou pela
-- calculadora de ferragem. O produto em metro precisa continuar ativo (a baixa
-- e o painel de estoque dependem dele), so que fora do catalogo, da venda
-- rapida e da lista de precos do robo. `vendavel = false` faz isso.
--
-- O estribo pronto (vendido por unidade) passa a baixar do Ferro 4,2mm com
-- uma media de 0,70 m por estribo: 2 x (lado + lado) + 10 cm de dobra, nas
-- medidas mais pedidas (9x15 0,58; 9x20 0,68; 15x15 0,70; 9x26 0,80).
-- Idempotente.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vendavel boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN produtos.vendavel IS
  'false = so estoque: fica fora do catalogo, da venda rapida e do robo (ex.: ferro em metro, vendido como barra/estribo/calculadora).';

UPDATE produtos SET vendavel = false WHERE tipo_ferro IS NOT NULL AND vendavel;

-- Estribo pronto -> Ferro 4,2mm (estribo), 0,70 m cada. O minimo proprio
-- deixa de valer: o controle e no ferro em metro.
UPDATE produtos e
SET baixa_estoque_em_produto_id = f.id, baixa_estoque_fator = 0.70, estoque_minimo = 0
FROM produtos f
WHERE f.tipo_ferro = 'ferro_4_2mm_estribo'
  AND e.codigo = 'ESTRIBO-42MM'
  AND e.baixa_estoque_em_produto_id IS NULL;
