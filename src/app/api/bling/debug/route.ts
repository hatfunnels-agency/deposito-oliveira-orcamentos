export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const clientId = process.env.BLING_CLIENT_ID!;
    const clientSecret = process.env.BLING_CLIENT_SECRET!;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Read refresh token from Supabase
    let refreshToken = '';
    const sRes = await fetch(`${supabaseUrl}/rest/v1/bling_tokens?key=eq.refresh_token&select=value`, {
      headers: { 'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' },
    });
    const rows = await sRes.json();
    if (rows?.[0]?.value) refreshToken = rows[0].value;

    // Get fresh access token
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'No access token', tokenData });
    }

    const token = tokenData.access_token;

    // Save new refresh token if changed
    if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
      await fetch(`${supabaseUrl}/rest/v1/bling_tokens`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ key: 'refresh_token', value: tokenData.refresh_token, updated_at: new Date().toISOString() }),
      });
    }

    // Test BOTH hosts
    const hosts = ['https://www.bling.com.br/Api/v3', 'https://api.bling.com.br/Api/v3'];
    const tests = [];

    for (const host of hosts) {
      try {
        const r = await fetch(host + '/produtos?limite=1', {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        let body;
        try { body = await r.json(); } catch { body = null; }
        tests.push({ host, status: r.status, ok: r.ok, body: JSON.stringify(body).substring(0, 200) });
      } catch(e) {
        tests.push({ host, error: String(e) });
      }
    }

    return NextResponse.json({
      refreshToken: refreshToken.substring(0, 10) + '...',
      newRefreshToken: tokenData.refresh_token?.substring(0, 10) + '...',
      tokenPreview: token.substring(0, 30) + '...',
      tests,
    });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
