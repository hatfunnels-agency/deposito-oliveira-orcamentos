import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/automacoes/preview?telefone=11999999999&tipo=followup&momento=quente
// Previa da copy que a IA escreveria pra um cliente, com o contexto real dele
// (notas, tags, ultimo orcamento). SO LEITURA: devolve o texto no JSON e NAO
// envia nada, independente de AUTOMACOES_DRY_RUN.
//
// Auth: header x-admin-key (ADMIN_API_KEY), como as demais rotas de admin.
// tipo/momento usam o vocabulario do /api/ia/mensagem:
//   followup:   quente | dia1 | dia4 | dia7
//   review:     pergunta | positivo | negativo   (aceita 'posvenda' como apelido)
//   reativacao: semanal | quinzenal | mensal
//   resposta:   (momento vazio; opcional ?mensagem_cliente=... pra simular resposta)

const TIPOS_VALIDOS = ['followup', 'review', 'reativacao', 'resposta'];

export async function GET(request: NextRequest) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_API_KEY nao configurada no servidor' }, { status: 500 });
  }
  if (request.headers.get('x-admin-key') !== adminKey) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const telefone = (url.searchParams.get('telefone') || '').trim();
  let tipo = (url.searchParams.get('tipo') || 'followup').trim();
  const momento = (url.searchParams.get('momento') || '').trim();
  const mensagemCliente = (url.searchParams.get('mensagem_cliente') || '').trim();

  if (tipo === 'posvenda') tipo = 'review'; // apelido: a regua chama de pos-venda
  if (!telefone) {
    return NextResponse.json({ error: 'telefone obrigatorio' }, { status: 400 });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return NextResponse.json(
      { error: `tipo invalido — use ${TIPOS_VALIDOS.join(', ')} (ou posvenda)` },
      { status: 400 },
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
  if (!base) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL nao configurada' }, { status: 500 });
  }

  try {
    const resp = await fetch(`${base}/api/ia/mensagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-automacao-secret': process.env.AUTOMACAO_SECRET || '',
      },
      body: JSON.stringify({
        tipo,
        momento,
        telefone,
        ...(mensagemCliente ? { mensagem_cliente: mensagemCliente } : {}),
      }),
      cache: 'no-store',
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return NextResponse.json(
        { error: json?.error || `erro ${resp.status} ao gerar a previa` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      aviso: 'PREVIA — nada foi enviado ao cliente',
      telefone,
      tipo,
      momento: momento || null,
      mensagem: json?.mensagem || '',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'falha ao gerar a previa' }, { status: 500 });
  }
}
