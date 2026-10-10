import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { BUCKET_DOCUMENTOS } from '@/lib/documentos-funcionario';

export const dynamic = 'force-dynamic';

/**
 * GET /api/funcionarios/documentos/[id] — link temporario (5 min) pra ver
 * ou baixar o arquivo. O bucket e privado: nao existe URL fixa.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const { id } = await params;
    const { data: doc } = await supabaseAdmin
      .from('funcionario_documentos').select('storage_path').eq('id', id).single();
    if (!doc) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_DOCUMENTOS)
      .createSignedUrl(doc.storage_path, 300);
    if (error) throw error;
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error('Erro em GET /api/funcionarios/documentos/[id]:', e);
    return NextResponse.json({ error: 'Erro ao abrir documento' }, { status: 500 });
  }
}
