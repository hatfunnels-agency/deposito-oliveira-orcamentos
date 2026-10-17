-- Foto e medidas por produto.
--
-- Por que existe: a atendente precisa mandar a foto do produto no WhatsApp e
-- responder "qual a medida?". A foto fica num bucket PUBLICO (o link vai pro
-- cliente); as medidas sao texto livre ("9 x 19 x 19 cm", "barra de 12 m",
-- "3 m de comprimento") que o catalogo, o robo e o assistente tecnico usam.
-- Idempotente e so aditiva.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS foto_url text;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS medidas text;
COMMENT ON COLUMN produtos.medidas IS 'Medidas/tamanho do produto em texto livre, mostradas no catalogo e usadas pelo robo e pelo assistente.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('produtos-fotos', 'produtos-fotos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
