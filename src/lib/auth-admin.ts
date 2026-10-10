import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Exige sessao de admin numa rota /api.
 *
 * O middleware pula /api/* e quase todas as rotas confiam nisso. Salario
 * nao pode: quem soubesse a URL leria a folha. O browser manda o
 * access_token da sessao Supabase em `Authorization: Bearer ...` e aqui
 * conferimos o papel em `usuarios`.
 *
 * Retorna uma resposta de erro, ou null se pode seguir.
 */
export async function exigirAdmin(request: NextRequest): Promise<NextResponse | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Faça login de novo.' }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Sessão expirada. Faça login de novo.' }, { status: 401 });

  const { data: perfil } = await supabaseAdmin
    .from('usuarios')
    .select('papel')
    .eq('id', user.id)
    .single();
  if (perfil?.papel !== 'admin') {
    return NextResponse.json({ error: 'Só administradores acessam funcionários.' }, { status: 403 });
  }
  return null;
}
