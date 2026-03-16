import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/bling-auth';

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
    .steps { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .steps ol { margin: 8px 0 0 0; padding-left: 20px; }
    .steps li { margin: 8px 0; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px; }
    .copy-btn { background: #64748b; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-left: 8px; font-size: 13px; }
    .warning { background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin: 16px 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Bling Conectado com sucesso!</h1>
    <p>Seu app foi autorizado. Agora salve o <strong>Refresh Token</strong> abaixo no Vercel para conectar permanentemente.</p>
    
    <div class="warning">
      <strong>Importante:</strong> O access_token expira a cada 6h, mas o refresh_token nao expira enquanto for usado regularmente. Salve o refresh_token abaixo.
    </div>

    <h3>Refresh Token:
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('rt').textContent).then(()=>this.textContent='Copiado!').catch(()=>alert('Copie manualmente'))">
        Copiar
      </button>
    </h3>
    <div class="token-box" id="rt">${tokens.refresh_token}</div>

    <div class="steps">
      <strong>Passos para ativar:</strong>
      <ol>
        <li>Copie o Refresh Token acima</li>
        <li>Acesse: <a href="https://vercel.com/hat-funnels/deposito-oliveira-orcamentos/settings/environment-variables" target="_blank">Vercel → Environment Variables</a></li>
        <li>Adicione a variavel: <strong>BLING_REFRESH_TOKEN</strong> = (cole o token)</li>
        <li>Clique em "Save" e depois em "Redeploy"</li>
        <li>Acesse /api/bling/status para confirmar conexao</li>
      </ol>
    </div>

    <a href="/" class="btn">Voltar ao sistema</a>
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