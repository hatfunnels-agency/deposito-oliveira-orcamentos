-- ============================================================
-- Documentos dos funcionarios (RG, CNH, carteira de trabalho...)
-- 2026-10-10
--
-- Arquivo vai pro Supabase Storage num bucket PRIVADO; aqui fica so o
-- cadastro (tipo, validade, caminho). Ninguem acessa o arquivo por URL
-- fixa: a API (so admin) gera um link assinado que expira em minutos.
--
-- Upload: a API devolve um token de upload assinado e o browser manda o
-- arquivo direto pro Storage. Passar pela funcao da Vercel limitaria a
-- 4,5 MB, e foto de celular passa disso facil.
-- ============================================================

CREATE TABLE IF NOT EXISTS funcionario_documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN (
                    'rg', 'cpf', 'cnh', 'ctps', 'comprovante_residencia',
                    'contrato', 'aso', 'certidao', 'outro')),
  descricao       text,
  validade        date,           -- CNH, ASO: avisa antes de vencer
  storage_path    text NOT NULL UNIQUE,
  nome_arquivo    text NOT NULL,
  mime            text,
  tamanho         integer,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE funcionario_documentos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_docs_func ON funcionario_documentos(funcionario_id);

-- Bucket privado (public = false). Sem policies em storage.objects:
-- so a service role (API) le e grava.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'funcionarios-documentos',
  'funcionarios-documentos',
  false,
  15728640,  -- 15 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;
