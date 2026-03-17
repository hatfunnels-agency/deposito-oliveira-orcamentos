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

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // Test token from BOTH OAuth endpoints
    const tokenUrls = [
      'https://www.bling.com.br/Api/v3/oauth/token',
      'https://api.bling.com.br/Api/v3/oauth/token',
    ];

    const results = [];
    for (const tokenUrl of tokenUrls) {
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      });
      const tokenData = await tokenRes.json();

      // Save new refresh token
      if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
        await fetch(`${supabaseUrl}/rest/v1/bling_tokens`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: 'refresh_token', value: tokenData.refresh_token, updated_at: new Date().toISOString() }),
        });
        refreshToken = tokenData.refresh_token;
      }

      let apiTest = null;
      if (tokenData.access_token) {
        const r = await fetch('https://api.bling.com.br/Api/v3/produtos?limite=1', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Accept': 'application/json' }
        });
        let body;
        try { body = await r.json(); } catch { body = null; }
        apiTest = { status: r.status, ok: r.ok, body: JSON.stringify(body).substring(0, 300) };
      }

      results.push({
        tokenUrl,
        tokenStatus: tokenRes.status,
        hasAccessToken: !!tokenData.access_token,
        tokenError: tokenData.error || null,
        apiTest,
      });
    }

    return NextResponse.json({ results });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
