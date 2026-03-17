import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, saveRefreshTokenToSupabase } from '@/lib/bling-auth';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
      <h2>Erro na autorizacao Bling</h2>
      <p>Erro: ${error}</p>
      <a href="/">Voltar ao sistema</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (!code) {
    return new NextResponse(`
      <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
      <h2>Erro: codigo de autorizacao nao recebido</h2>
      <a href="/">Voltar ao sistema</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Salva o refresh_token automaticamente no Supabase
    let savedToSupabase = false;
    try {
      await saveRefreshTokenToSupabase(tokens.refresh_token);
      savedToSupabase = true;
    } catch (saveErr) {
      console.error('Erro ao salvar token no Supabase:', saveErr);
    }

    const statusMsg = savedToSupabase
      ? '<span style="color:#16a34a">Token salvo automaticamente no banco de dados!</span>'
      : '<span style="color:#dc2626">Aviso: nao foi possivel salvar automaticamente. Salve manualmente abaixo.</span>';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bling Conectado!</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #f9f9f9; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #16a34a; margin-bottom: 8px; }
    .token-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; }
    .success { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 15px; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px; }
    .btn-green { background: #16a34a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Bling Conectado com sucesso!</h1>
    <div class="success">
      ${statusMsg}
      ${savedToSupabase ? '<br><br>O sistema ja esta pronto para usar o Bling. Nenhum redeploy necessario!' : ''}
    </div>
    <p>Refresh Token (backup):</p>
    <div class="token-box">${tokens.refresh_token}</div>
    <a href="/api/bling/status" class="btn btn-green">Verificar Status</a>
    <a href="/" class="btn" style="margin-left:12px">Voltar ao sistema</a>
  </div>
</body>
</html>`;

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return new NextResponse(`
      <html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
      <h2>Erro ao trocar o codigo pelo token</h2>
      <p>${message}</p>
      <a href="/api/bling/auth">Tentar novamente</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
}
