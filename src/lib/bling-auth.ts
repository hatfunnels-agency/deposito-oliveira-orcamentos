// src/lib/bling-auth.ts
// Modulo core de autenticacao OAuth2 com Bling v3
// O access_token expira a cada 6h - este modulo faz refresh automatico

const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_API_BASE = 'https://www.bling.com.br/Api/v3';

// Cache em memoria do token (reinicia ao redeploy - ok para uso interno)
let tokenCache: {
  access_token: string;
  expires_at: number; // timestamp ms
} | null = null;

async function getNewTokenFromRefreshToken(): Promise<string> {
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  const refreshToken = process.env.BLING_REFRESH_TOKEN!;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REFRESH_TOKEN sao obrigatorios');
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
  
  // Cache o token com expiracao (6h = 21600s, guardamos com 5min de margem)
  tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in - 300) * 1000),
  };

  // Nota: o refresh_token do Bling nao muda a cada refresh, entao nao precisamos atualizar a env var

  return data.access_token;
}

export async function getBlingAccessToken(): Promise<string> {
  // Se tem cache valido, usa ele
  if (tokenCache && Date.now() < tokenCache.expires_at) {
    return tokenCache.access_token;
  }

  // Senao, faz refresh
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

// Faz request para a API do Bling com retry automatico em caso de 401
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

  // Se 401, limpa cache e tenta de novo uma vez
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
    process.env.BLING_CLIENT_SECRET &&
    process.env.BLING_REFRESH_TOKEN
  );
}