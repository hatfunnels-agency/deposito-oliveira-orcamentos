export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getBlingAccessToken } from '@/lib/bling-auth';

export async function GET() {
  try {
    const token = await getBlingAccessToken();
    const tokenPreview = token.substring(0, 20) + '...';

    const endpoints = [
      '/produtos?limite=1',
      '/contatos?limite=1',
      '/pedidos/vendas?limite=1',
      '/propostas-comerciais?limite=1',
      '/situacoes/modulos',
    ];

    const tests = [];
    for (const ep of endpoints) {
      try {
        const r = await fetch('https://www.bling.com.br/Api/v3' + ep, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        let body = null;
        try { body = await r.json(); } catch(e) { body = await r.text().catch(() => null); }
        tests.push({ url: ep, status: r.status, ok: r.ok, body: typeof body === 'object' ? JSON.stringify(body).substring(0, 200) : String(body).substring(0, 200) });
      } catch(e) {
        tests.push({ url: ep, error: String(e) });
      }
    }

    return NextResponse.json({ token: tokenPreview, tests });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
