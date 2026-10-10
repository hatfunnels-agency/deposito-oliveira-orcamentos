// Tipos de documento do funcionario. Mesma lista do CHECK em
// supabase/migrations/20261010_funcionario_documentos.sql.

export const BUCKET_DOCUMENTOS = 'funcionarios-documentos';

export const TIPOS_DOCUMENTO = {
  rg: 'RG',
  cpf: 'CPF',
  cnh: 'CNH',
  ctps: 'Carteira de trabalho',
  comprovante_residencia: 'Comprovante de residência',
  contrato: 'Contrato',
  aso: 'Exame (ASO)',
  certidao: 'Certidão',
  outro: 'Outro',
} as const;

export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;

export const MIMES_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
export const TAMANHO_MAXIMO = 15 * 1024 * 1024;

/** Documento com validade vencida ou vencendo nos proximos `dias`. */
export const DIAS_AVISO_VALIDADE = 30;
