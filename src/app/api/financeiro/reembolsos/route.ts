import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { exigirPapel } from '@/lib/auth-admin';
import type { NovoReembolso, Reembolso } from '@/lib/financeiro/tipos';
import { mapearReembolso } from '@/lib/financeiro/fechamento';
import { arred2, ehData, ehMes, hojeSP, primeiroDiaDoMes } from '@/lib/financeiro/datas';
import { ErroFinanceiro, registrarEvento } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const RECURSO = 'a maquininha';
const FORMAS: Reembolso['forma'][] = ['credito_compra', 'pix', 'transferencia', 'desconto_boleto', 'outro'];
const SELECT = '*, fornecedores ( nome )';
const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

// GET /api/financeiro/reembolsos?ano=2026 -> { reembolsos } (por mes de referencia)
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const anoParam = request.nextUrl.searchParams.get('ano');
    if (anoParam && !/^\d{4}$/.test(anoParam)) return erro400('Ano inválido (use AAAA).');
    const ano = anoParam || hojeSP().slice(0, 4);
    const rows = await lerTudo<Record<string, any>>(() => supabaseAdmin
      .from('reembolsos_fornecedor')
      .select(SELECT)
      .gte('referencia', `${ano}-01-01`)
      .lte('referencia', `${ano}-12-31`)
      .order('referencia', { ascending: false })
      .order('data_recebimento', { ascending: false }));
    return NextResponse.json({ reembolsos: rows.map(mapearReembolso) });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/reembolsos');
  }
}

// POST /api/financeiro/reembolsos  NovoReembolso -> Reembolso (201)
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as NovoReembolso | null;
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    if (!ehMes(body.referencia) && !ehData(body.referencia)) return erro400('Mês de referência inválido (use AAAA-MM).');
    const valor = arred2(Number(body.valor));
    if (!Number.isFinite(valor) || valor <= 0) return erro400('Valor do reembolso inválido.');
    if (!ehData(body.data_recebimento)) return erro400('Data de recebimento inválida (use AAAA-MM-DD).');
    const forma = body.forma ?? 'credito_compra';
    if (!FORMAS.includes(forma)) return erro400('Forma de reembolso inválida.');

    const { data, error } = await supabaseAdmin
      .from('reembolsos_fornecedor')
      .insert({
        fornecedor_id: body.fornecedor_id || null,
        referencia: primeiroDiaDoMes(body.referencia),
        valor,
        data_recebimento: body.data_recebimento,
        forma,
        observacoes: String(body.observacoes ?? '').trim() || null,
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    const criado = mapearReembolso(data as Record<string, any>);
    await registrarEvento({ entidade: 'reembolso', entidade_id: criado.id, acao: 'criar', depois: criado, usuario_id: usuario?.id ?? null });
    return NextResponse.json(criado, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/reembolsos');
  }
}

// DELETE /api/financeiro/reembolsos?id=
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return erro400('Informe o id do reembolso.');
    const { data, error } = await supabaseAdmin.from('reembolsos_fornecedor').delete().eq('id', id).select(SELECT);
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: 'Reembolso não encontrado.' }, { status: 404 });
    await registrarEvento({ entidade: 'reembolso', entidade_id: id, acao: 'excluir', antes: mapearReembolso(data[0] as Record<string, any>), usuario_id: usuario?.id ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return responderErro(e, 'DELETE /api/financeiro/reembolsos');
  }
}
