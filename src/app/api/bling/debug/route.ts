export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const clientId = process.env.BLING_CLIENT_ID!;
    const clientSecret = process.env.BLING_CLIENT_SECRET!;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Read refresh token from Supabase
    const sRes = await fetch(`${supabaseUrl}/rest/v1/bling_tokens?key=eq.refresh_token&select=value,updated_at`, {
      headers: { 'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' },
    });
    const rows = await sRes.json();
    const refreshToken = rows?.[0]?.value || '';
    const updatedAt = rows?.[0]?.updated_at || '';

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // Try refresh with www.bling.com.br (to get a token that works)
    // then use that token on www.bling.com.br/Api/v3/produtos
    const wwwTokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    const wwwTokenData = await wwwTokenRes.json();
    
    // Save new refresh token if received
    if (wwwTokenData.refresh_token) {
      await fetch(`${supabaseUrl}/rest/v1/bling_tokens`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey!, 'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ key: 'refresh_token', value: wwwTokenData.refresh_token, updated_at: new Date().toISOString() }),
      });
    }

    // Test the www token on BOTH hosts
    let wwwOnWww = null;
    let wwwOnApi = null;
    if (wwwTokenData.access_token) {
      // Test on www
      const r1 = await fetch('https://www.bling.com.br/Api/v3/produtos?limite=1', {
        headers: { 'Authorization': `Bearer ${wwwTokenData.access_token}`, 'Accept': 'application/json' }
      });
      let b1; try { b1 = await r1.json(); } catch { b1 = null; }
      wwwOnWww = { status: r1.status, body: JSON.stringify(b1).substring(0, 200) };

      // Test on api
      const r2 = await fetch('https://api.bling.com.br/Api/v3/produtos?limite=1', {
        headers: { 'Authorization': `Bearer ${wwwTokenData.access_token}`, 'Accept': 'application/json' }
      });
      let b2; try { b2 = await r2.json(); } catch { b2 = null; }
      wwwOnApi = { status: r2.status, body: JSON.stringify(b2).substring(0, 200) };
    }

    return NextResponse.json({
      refreshToken: refreshToken.substring(0, 10) + '...',
      updatedAt,
      wwwToken: { status: wwwTokenRes.status, hasToken: !!wwwTokenData.access_token, error: wwwTokenData.error || null },
      wwwOnWww,
      wwwOnApi,
    });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
