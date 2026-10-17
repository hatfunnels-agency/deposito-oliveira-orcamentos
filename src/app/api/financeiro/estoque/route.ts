import { NextRequest, NextResponse } from 'next/server';
import { exigirPapel } from '@/lib/auth-admin';
import type { NovoMovimentoEstoque, TipoMovimentoEstoque } from '@/lib/financeiro/tipos';
import { definirAtivo, definirPrazoEntrega, definirTipoEstoque, historicoMovimentos, painelEstoque, registrarMovimento, TIPOS_MOVIMENTO } from '@/lib/financeiro/estoque';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const RECURSO = 'o estoque';

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  const msg = e instanceof ErroFinanceiro ? e.message : 'Erro interno';
  return NextResponse.json({ error: msg }, { status });
}

// GET /api/financeiro/estoque            -> PainelEstoque
// GET /api/financeiro/estoque?produto_id= -> { movimentacoes } (do principal, mais recentes primeiro)
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const produtoId = request.nextUrl.searchParams.get('produto_id');
    if (produtoId) {
      const limite = Number(request.nextUrl.searchParams.get('limite') || 30);
      return NextResponse.json({ movimentacoes: await historicoMovimentos(produtoId, Number.isFinite(limite) ? limite : 30) });
    }
    return NextResponse.json(await painelEstoque());
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/estoque');
  }
}

// POST /api/financeiro/estoque  NovoMovimentoEstoque -> ResultadoMovimentoEstoque (201)
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as NovoMovimentoEstoque | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
    if (!body.produto_id) return NextResponse.json({ error: 'Escolha o produto.' }, { status: 400 });
    if (!TIPOS_MOVIMENTO.includes(body.tipo as TipoMovimentoEstoque)) {
      return NextResponse.json({ error: 'Tipo deve ser entrada, perda, ajuste ou contagem.' }, { status: 400 });
    }
    if (body.quantidade === undefined || body.quantidade === null || !Number.isFinite(Number(body.quantidade))) {
      return NextResponse.json({ error: 'Quantidade inválida.' }, { status: 400 });
    }
    if (body.custo_unitario !== undefined && body.custo_unitario !== null && body.tipo !== 'entrada') {
      return NextResponse.json({ error: 'Custo unitário só vale na entrada.' }, { status: 400 });
    }
    const resultado = await registrarMovimento({
      produto_id: String(body.produto_id),
      tipo: body.tipo,
      quantidade: Number(body.quantidade),
      custo_unitario: body.custo_unitario === undefined || body.custo_unitario === null ? null : Number(body.custo_unitario),
      motivo: body.motivo ?? null,
      referencia_tipo: body.referencia_tipo ?? null,
      referencia_id: body.referencia_id ?? null,
      usuarioId: usuario?.id ?? null,
    });
    return NextResponse.json(resultado, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/estoque');
  }
}

// PATCH /api/financeiro/estoque  { produto_id, tipo_estoque: 'estocavel' | 'sob_demanda' } | { produto_id, ativo }
export async function PATCH(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as { produto_id?: string; tipo_estoque?: string; ativo?: boolean; prazo_entrega_dias?: number | null } | null;
    if (!body?.produto_id) return NextResponse.json({ error: 'Escolha o produto.' }, { status: 400 });
    // { produto_id, ativo: false } = excluir (arquiva); ativo: true = restaurar.
    // { produto_id, prazo_entrega_dias } = prazo do fornecedor (null = entrega rapida).
    if ('prazo_entrega_dias' in body) {
      const d = body.prazo_entrega_dias;
      if (d !== null && (typeof d !== 'number' || !Number.isFinite(d) || d < 0)) return NextResponse.json({ error: 'Prazo inválido.' }, { status: 400 });
      return NextResponse.json(await definirPrazoEntrega(String(body.produto_id), d, usuario?.id ?? null));
    }
    if (typeof body.ativo === 'boolean') {
      return NextResponse.json(await definirAtivo(String(body.produto_id), body.ativo, usuario?.id ?? null));
    }
    if (body.tipo_estoque !== 'estocavel' && body.tipo_estoque !== 'sob_demanda') {
      return NextResponse.json({ error: 'Tipo deve ser estocavel ou sob_demanda.' }, { status: 400 });
    }
    return NextResponse.json(await definirTipoEstoque(String(body.produto_id), body.tipo_estoque, usuario?.id ?? null));
  } catch (e) {
    return responderErro(e, 'PATCH /api/financeiro/estoque');
  }
}
