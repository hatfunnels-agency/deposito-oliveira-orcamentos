import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BUCKET = 'produtos-fotos';
const MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// POST /api/produtos/[id]/foto  (multipart: imagem) -> { foto_url }
// Sobe a foto no bucket publico e grava a URL no produto.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const form = await request.formData();
    const arquivo = form.get('imagem');
    if (!(arquivo instanceof File) || !arquivo.size) return NextResponse.json({ error: 'Envie a foto.' }, { status: 400 });
    const ext = MIMES[arquivo.type];
    if (!ext) return NextResponse.json({ error: 'Envie JPG, PNG ou WebP.' }, { status: 400 });
    if (arquivo.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Foto maior que 5 MB.' }, { status: 400 });
    const { data: prod } = await supabaseAdmin.from('produtos').select('id').eq('id', id).maybeSingle();
    if (!prod) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });

    const caminho = `${id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(caminho, buffer, { contentType: arquivo.type, upsert: true });
    if (upErr) { console.error('[produtos/foto] upload', upErr); return NextResponse.json({ error: 'Erro ao subir a foto' }, { status: 500 }); }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(caminho);
    const foto_url = pub.publicUrl;
    const { error } = await supabaseAdmin.from('produtos').update({ foto_url }).eq('id', id);
    if (error) return NextResponse.json({ error: 'Erro ao gravar a foto' }, { status: 500 });
    return NextResponse.json({ foto_url });
  } catch (e) {
    console.error('Erro POST /api/produtos/[id]/foto', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE /api/produtos/[id]/foto -> tira a foto do produto (o arquivo fica no bucket).
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from('produtos').update({ foto_url: null }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Erro ao remover' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
