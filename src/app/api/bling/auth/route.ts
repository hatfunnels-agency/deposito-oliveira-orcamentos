import { NextResponse } from 'next/server';

const BLING_AUTH_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize';

export async function GET() {
  const clientId = process.env.BLING_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json({ error: 'BLING_CLIENT_ID nao configurado' }, { status: 500 });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    state: 'deposito-oliveira-auth',
  });

  const authUrl = `${BLING_AUTH_URL}?${params.toString()}`;
  
  return NextResponse.redirect(authUrl);
}