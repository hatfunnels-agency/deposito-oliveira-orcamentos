import { NextResponse } from 'next/server';
import { getBlingAccessToken, isBlingConfigured } from '@/lib/bling-auth';

export async function GET() {
  if (!isBlingConfigured()) {
    return NextResponse.json({
      connected: false,
      mode: 'DEMO',
      message: 'Bling nao configurado. Acesse /api/bling/auth para autorizar.',
      setup_url: '/api/bling/auth',
    });
  }

  try {
    const token = await getBlingAccessToken();
    
    // Testa a conexao buscando informacoes basicas
    const testRes = await fetch('https://www.bling.com.br/Api/v3/situacoes/modulos', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

    if (!testRes.ok) {
      return NextResponse.json({
        connected: false,
        mode: 'DEMO',
        message: `Bling retornou erro ${testRes.status} ao testar conexao`,
        setup_url: '/api/bling/auth',
      });
    }

    return NextResponse.json({
      connected: true,
      mode: 'BLING',
      message: 'Bling conectado e funcionando',
      client_id: process.env.BLING_CLIENT_ID?.substring(0, 8) + '...',
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({
      connected: false,
      mode: 'DEMO',
      message: `Erro ao conectar com Bling: ${message}`,
      setup_url: '/api/bling/auth',
    });
  }
}