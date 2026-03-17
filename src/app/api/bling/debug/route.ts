export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getBlingAccessToken } from '@/lib/bling-auth';

export async function GET() {
  try {
    // Force fresh token (bypass cache by directly calling the refresh)
    const clientId = process.env.BLING_CLIENT_ID!;
    const clientSecret = process.env.BLING_CLIENT_SECRET!;
    
    // Read refresh token from Supabase directly
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    let refreshToken = '';
    let supabaseStatus = '';
    if (supabaseUrl && supabaseKey) {
      const sRes = await fetch(`${supabaseUrl}/rest/v1/bling_tokens?key=eq.refresh_token&select=value`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Accept': 'application/json',
        },
      });
      const rows = await sRes.json();
      supabaseStatus = JSON.stringify(rows);
      if (rows && rows.length > 0) {
        refreshToken = rows[0].value;
      }
    }
    
    // Try to get fresh token using refresh_token
    let tokenResult: any = {};
    if (refreshToken) {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
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
      tokenResult = { status: tokenRes.status, body: await tokenRes.text() };
    }

    // If we got a token, test it
    let apiTest = null;
    try {
      const parsed = JSON.parse(tokenResult.body || '{}');
      if (parsed.access_token) {
        const r = await fetch('https://api.bling.com.br/Api/v3/produtos?limite=1', {
          headers: {
            'Authorization': `Bearer ${parsed.access_token}`,
            'Accept': 'application/json'
          }
        });
        let body;
        try { body = await r.json(); } catch { body = null; }
        apiTest = { status: r.status, ok: r.ok, body: JSON.stringify(body).substring(0, 300) };
      }
    } catch(e) {}

    return NextResponse.json({
      refreshToken: refreshToken.substring(0, 10) + '...',
      supabase: supabaseStatus.substring(0, 100),
      tokenExchange: { status: tokenResult.status, body: tokenResult.body?.substring(0, 300) },
      apiTest,
    });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
