export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getBlingAccessToken } from '@/lib/bling-auth';

export async function GET() {
  try {
    const token = await getBlingAccessToken();
    const tokenPreview = token.substring(0, 20) + '...';
    
    // Test multiple endpoints
    const tests = await Promise.allSettled([
      fetch('https://www.bling.com.br/Api/v3/produtos?limite=1', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      }).then(r => ({ url: '/produtos', status: r.status, ok: r.ok })),
      fetch('https://www.bling.com.br/Api/v3/contatos?limite=1', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      }).then(r => ({ url: '/contatos', status: r.status, ok: r.ok })),
      fetch('https://www.bling.com.br/Api/v3/orcamentos?limite=1', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      }).then(r => ({ url: '/orcamentos', status: r.status, ok: r.ok })),
    ]);
    
    return NextResponse.json({
      token: tokenPreview,
      tests: tests.map(t => t.status === 'fulfilled' ? t.value : { error: String(t.reason) })
    });
  } catch(err) {
    return NextResponse.json({ error: String(err) });
  }
}
