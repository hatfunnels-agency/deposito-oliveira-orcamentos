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
  // Delega a exigirPapel: mesma resposta, e admin desativado tambem e barrado.
  const { negado } = await exigirPapel(request, ['admin'], 'funcionários');
  return negado;
}

const ROTULO_PAPEL: Record<string, string> = {
  admin: 'administradores',
  atendente: 'atendentes',
  motorista: 'motoristas',
};

/**
 * Exige sessao com um dos papeis informados numa rota /api.
 *
 * Mesmo mecanismo do exigirAdmin (Bearer da sessao Supabase + papel em
 * `usuarios`), mas devolve tambem quem e o usuario: as rotas do financeiro
 * gravam `usuario_id` na trilha de eventos e decidem por papel (ex.: so
 * admin pode datar um recebimento no passado).
 *
 *   const { negado, usuario } = await exigirPapel(req, ['admin']);
 *   if (negado) return negado;
 */
export async function exigirPapel(
  request: NextRequest,
  papeis: string[],
  recurso = 'esta área',
): Promise<{ negado: NextResponse | null; usuario: { id: string; papel: string } | null }> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { negado: NextResponse.json({ error: 'Faça login de novo.' }, { status: 401 }), usuario: null };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return { negado: NextResponse.json({ error: 'Sessão expirada. Faça login de novo.' }, { status: 401 }), usuario: null };
  }

  const { data: perfil } = await supabaseAdmin
    .from('usuarios')
    .select('papel, ativo')
    .eq('id', user.id)
    .single();
  const papel = String(perfil?.papel ?? '');
  if (!perfil || perfil.ativo === false || !papeis.includes(papel)) {
    const quem = papeis.map(p => ROTULO_PAPEL[p] ?? p).join(' e ');
    return { negado: NextResponse.json({ error: `Só ${quem} acessam ${recurso}.` }, { status: 403 }), usuario: null };
  }
  return { negado: null, usuario: { id: user.id, papel } };
}
