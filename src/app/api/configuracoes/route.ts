import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Chaves que a tela pode ler/escrever. O resto da tabela `configuracoes`
// (CNPJ, split da Vloz, capacidade da ferragem) continua so no servidor.
const CHAVES: Record<string, { padrao: string; valida: (v: string) => boolean }> = {
  // Desconto que o orcamento aplica sozinho para pedreiro/empreiteiro (%).
  desconto_profissional_pct: { padrao: '5', valida: v => /^\d{1,2}([.,]\d)?$/.test(v) && Number(v.replace(',', '.')) <= 30 },
};

// GET /api/configuracoes?chave=desconto_profissional_pct -> { chave, valor }
export async function GET(request: NextRequest) {
  const chave = request.nextUrl.searchParams.get('chave') || '';
  const def = CHAVES[chave];
  if (!def) return NextResponse.json({ error: 'Chave não permitida' }, { status: 400 });
  const { data } = await supabaseAdmin.from('configuracoes').select('valor').eq('chave', chave).maybeSingle();
  return NextResponse.json({ chave, valor: data?.valor ?? def.padrao });
}

// PATCH /api/configuracoes { chave, valor }
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { chave?: string; valor?: string | number } | null;
  const chave = String(body?.chave || '');
  const def = CHAVES[chave];
  if (!def) return NextResponse.json({ error: 'Chave não permitida' }, { status: 400 });
  const valor = String(body?.valor ?? '').trim().replace(',', '.');
  if (!def.valida(valor)) return NextResponse.json({ error: 'Valor inválido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('configuracoes')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if (error) return NextResponse.json({ error: 'Erro ao salvar' }, { status: 500 });
  return NextResponse.json({ chave, valor });
}
