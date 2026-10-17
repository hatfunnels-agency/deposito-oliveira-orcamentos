// Chamadas da tela /financeiro para /api/financeiro/*.
//
// As rotas gerenciais exigem Bearer (exigirPapel): toda chamada leva o
// access_token da sessao do navegador. Mesmo padrao do helper api() do
// FuncionariosTab, tipado. Rotas antigas sem auth ignoram o header.
import { supabaseBrowser } from '@/lib/supabase-client';

function normalizarHeaders(h: HeadersInit | undefined): Record<string, string> {
  const saida: Record<string, string> = {};
  if (!h) return saida;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((v, k) => { saida[k] = v; });
    return saida;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) saida[k] = v;
    return saida;
  }
  return { ...(h as Record<string, string>) };
}

export async function apiFinanceiro<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  // Upload de extrato manda FormData: o navegador precisa montar o boundary,
  // entao nao se fixa Content-Type nesse caso.
  const ehFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token ?? ''}`,
    ...(ehFormData ? {} : { 'Content-Type': 'application/json' }),
    ...normalizarHeaders(init.headers),
  };
  const res = await fetch(path, { cache: 'no-store', ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Erro na requisição');
  return json as T;
}
