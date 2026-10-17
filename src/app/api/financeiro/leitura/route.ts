import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import type { RespostaLeitura } from '@/lib/financeiro/tipos';
import { lerComSugestoes, MIMES_IMAGEM } from '@/lib/financeiro/leitura-foto';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';
import { mesSP } from '@/lib/financeiro/datas';

export const dynamic = 'force-dynamic';
// A leitura da imagem leva de alguns segundos a ~1 min.
export const maxDuration = 120;

const BUCKET_COMPROVANTES = 'financeiro-comprovantes';
// A Vercel corta o corpo em 4,5 MB: a tela reduz a foto (JPEG ~1600px)
// antes de enviar. Este limite so protege contra envio sem reducao.
const TAMANHO_MAXIMO = 4 * 1024 * 1024;

// POST /api/financeiro/leitura  multipart { imagem: File, guardar?: '0' }
//   -> RespostaLeitura (leitura + sugestoes de fornecedor/produto + calculo do ticket)
// A foto vai para o bucket privado financeiro-comprovantes (salvo guardar=0);
// se o bucket nao existir, a leitura segue e volta aviso_foto.
export async function POST(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], 'o lançamento por foto');
  if (negado) return negado;
  try {
    const form = await request.formData().catch(() => null);
    const arquivo = form?.get('imagem');
    if (!arquivo || typeof arquivo === 'string') return NextResponse.json({ error: 'Envie a foto no campo "imagem".' }, { status: 400 });
    const mime = arquivo.type || 'image/jpeg';
    if (!(MIMES_IMAGEM as readonly string[]).includes(mime)) {
      return NextResponse.json({ error: 'Envie a foto em JPG, PNG ou WebP.' }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAXIMO) return NextResponse.json({ error: 'Foto grande demais (máx. 4 MB). Tire de novo mais de perto.' }, { status: 413 });
    if (arquivo.size === 0) return NextResponse.json({ error: 'Foto vazia.' }, { status: 400 });

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const guardar = form?.get('guardar') !== '0';

    const [resultado, foto] = await Promise.all([
      lerComSugestoes(bytes.toString('base64'), mime),
      guardar ? guardarFoto(bytes, mime) : Promise.resolve({ path: null, aviso: null }),
    ]);
    const resposta: RespostaLeitura = { ...resultado, foto_path: foto.path, aviso_foto: foto.aviso };
    return NextResponse.json(resposta);
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em POST /api/financeiro/leitura:', e);
    return NextResponse.json({ error: e instanceof ErroFinanceiro ? e.message : 'Erro interno' }, { status });
  }
}

async function guardarFoto(bytes: Buffer, mime: string): Promise<{ path: string | null; aviso: string | null }> {
  try {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${mesSP()}/${randomUUID()}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(BUCKET_COMPROVANTES).upload(path, bytes, {
      contentType: mime, upsert: false,
    });
    if (error) {
      console.error('[financeiro/leitura] upload da foto falhou:', error.message);
      return { path: null, aviso: 'A foto não foi guardada (o bucket financeiro-comprovantes existe? aplique a migration 20261017_estoque_gestao_e_densidade).' };
    }
    return { path, aviso: null };
  } catch (e) {
    console.error('[financeiro/leitura] upload da foto falhou:', e);
    return { path: null, aviso: 'A foto não foi guardada.' };
  }
}
