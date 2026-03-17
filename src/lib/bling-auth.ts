// src/lib/bling-auth.ts
// Modulo core de autenticacao OAuth2 com Bling v3
// O access_token expira a cada 6h - este modulo faz refresh automatico
// O refresh_token e salvo no Supabase para persistencia sem redeploy

const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';

// Cache em memoria do token (reinicia ao redeploy - ok para uso interno)
let tokenCache: {
  access_token: string;
  expires_at: number;
} | null = null;

// Busca o refresh_token: primeiro do Supabase, fallback para env var
async function getRefreshToken(): Promise<string> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const res = await fetch(`${supabaseUrl}/rest/v1/bling_tokens?key=eq.refresh_token&select=value`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].value) {
          return rows[0].value;
        }
      }
    }
  } catch (e) {
    // fallback to env var
  }

  const envToken = process.env.BLING_REFRESH_TOKEN;
  if (envToken) return envToken;

  throw new Error('Nenhum refresh_token disponivel. Execute /api/bling/auth para autorizar.');
}

// Salva o refresh_token no Supabase (upsert)
export async function saveRefreshTokenToSupabase(refreshToken: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  await fetch(`${supabaseUrl}/rest/v1/bling_tokens`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: 'refresh_token',
      value: refreshToken,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function getNewTokenFromRefreshToken(): Promise<string> {
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  const refreshToken = await getRefreshToken();

  if (!clientId || !clientSecret) {
    throw new Error('BLING_CLIENT_ID e BLING_CLIENT_SECRET sao obrigatorios');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bling refresh token falhou (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Se o Bling retornou um novo refresh_token, salva no Supabase
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await saveRefreshTokenToSupabase(data.refresh_token).catch(() => {});
  }

  tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in - 300) * 1000),
  };

  return data.access_token;
}

export async function getBlingAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expires_at) {
    return tokenCache.access_token;
  }
  return getNewTokenFromRefreshToken();
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bling token exchange falhou (${res.status}): ${errText}`);
  }

  return res.json();
}

export async function blingFetch(endpoint: string, options?: RequestInit): Promise<Response> {
  const token = await getBlingAccessToken();

  const res = await fetch(`${BLING_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (res.status === 401) {
    tokenCache = null;
    const newToken = await getBlingAccessToken();
    return fetch(`${BLING_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
  }

  return res;
}

export function isBlingConfigured(): boolean {
  return !!(
    process.env.BLING_CLIENT_ID &&
    process.env.BLING_CLIENT_SECRET
  );
}
