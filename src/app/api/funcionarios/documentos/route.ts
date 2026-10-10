import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { BUCKET_DOCUMENTOS, TIPOS_DOCUMENTO } from '@/lib/documentos-funcionario';

export const dynamic = 'force-dynamic';

/** GET /api/funcionarios/documentos?funcionario_id= */
export async function GET(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const fid = request.nextUrl.searchParams.get('funcionario_id');
    if (!fid) return NextResponse.json({ error: 'funcionario_id obrigatório' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('funcionario_documentos')
      .select('id, tipo, descricao, validade, nome_arquivo, mime, tamanho, criado_em')
      .eq('funcionario_id', fid)
      .order('tipo')
      .order('criado_em', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ documentos: data || [] });
  } catch (e) {
    console.error('Erro em GET /api/funcionarios/documentos:', e);
    return NextResponse.json({ error: 'Erro ao carregar documentos' }, { status: 500 });
  }
}

/**
 * POST /api/funcionarios/documentos — registra o arquivo ja enviado.
 * { funcionario_id, tipo, storage_path, nome_arquivo, mime?, tamanho?, validade?, descricao? }
 */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    if (!(body.tipo in TIPOS_DOCUMENTO)) return NextResponse.json({ error: 'Tipo de documento inválido.' }, { status: 400 });
    // O caminho vem do /upload e sempre comeca com o id do funcionario.
    if (!body.funcionario_id || typeof body.storage_path !== 'string' || !body.storage_path.startsWith(`${body.funcionario_id}/`)) {
      return NextResponse.json({ error: 'Arquivo inválido.' }, { status: 400 });
    }
    const validade = typeof body.validade === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.validade) ? body.validade : null;

    const { data, error } = await supabaseAdmin
      .from('funcionario_documentos')
      .insert({
        funcionario_id: body.funcionario_id,
        tipo: body.tipo,
        storage_path: body.storage_path,
        nome_arquivo: String(body.nome_arquivo || 'arquivo').slice(0, 200),
        mime: body.mime || null,
        tamanho: Number(body.tamanho) || null,
        validade,
        descricao: String(body.descricao ?? '').trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/documentos:', e);
    return NextResponse.json({ error: 'Erro ao salvar documento' }, { status: 500 });
  }
}

/** DELETE /api/funcionarios/documentos?id= — apaga o arquivo e o registro. */
export async function DELETE(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    const { data: doc } = await supabaseAdmin
      .from('funcionario_documentos').select('storage_path').eq('id', id).single();
    if (!doc) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });

    const { error: eS } = await supabaseAdmin.storage.from(BUCKET_DOCUMENTOS).remove([doc.storage_path]);
    if (eS) throw eS;
    const { error } = await supabaseAdmin.from('funcionario_documentos').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/funcionarios/documentos:', e);
    return NextResponse.json({ error: 'Erro ao apagar documento' }, { status: 500 });
  }
}
