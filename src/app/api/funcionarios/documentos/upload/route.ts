import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { BUCKET_DOCUMENTOS, MIMES_ACEITOS, TAMANHO_MAXIMO } from '@/lib/documentos-funcionario';

export const dynamic = 'force-dynamic';

/**
 * POST /api/funcionarios/documentos/upload — { funcionario_id, nome_arquivo, mime, tamanho }
 * Devolve { path, token } pro browser subir o arquivo direto no Storage
 * (uploadToSignedUrl). O arquivo nao passa pela Vercel (limite de 4,5 MB).
 */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    if (!body.funcionario_id) return NextResponse.json({ error: 'Funcionário obrigatório.' }, { status: 400 });
    if (!MIMES_ACEITOS.includes(body.mime)) {
      return NextResponse.json({ error: 'Envie foto (JPG, PNG, HEIC) ou PDF.' }, { status: 400 });
    }
    if (Number(body.tamanho) > TAMANHO_MAXIMO) {
      return NextResponse.json({ error: 'Arquivo maior que 15 MB.' }, { status: 400 });
    }
    const { data: f } = await supabaseAdmin
      .from('funcionarios').select('id').eq('id', body.funcionario_id).single();
    if (!f) return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 });

    const ext = (String(body.nome_arquivo || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'bin').toLowerCase();
    const path = `${f.id}/${randomUUID()}.${ext}`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_DOCUMENTOS).createSignedUploadUrl(path);
    if (error) throw error;
    return NextResponse.json({ path: data.path, token: data.token });
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/documentos/upload:', e);
    return NextResponse.json({ error: 'Erro ao preparar envio. A migration de documentos foi aplicada?' }, { status: 500 });
  }
}
