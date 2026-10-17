import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import type { CenarioSalvo, ParametrosCenario } from '@/lib/financeiro/tipos';
import { baseSimulador } from '@/lib/financeiro/simulador-base';
import { cenariosPadrao, normalizarParametros } from '@/lib/financeiro/simulador';
import { ErroFinanceiro, registrarEvento } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const RECURSO = 'o simulador';
const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

function mapearCenario(r: Record<string, any>): CenarioSalvo {
  return {
    id: String(r.id),
    nome: String(r.nome),
    parametros: r.parametros as ParametrosCenario,
    atualizado_em: String(r.atualizado_em ?? r.criado_em ?? ''),
  };
}

// normalizarParametros e puro e lanca Error comum: aqui vira 400.
function normalizar(p: unknown): { parametros?: ParametrosCenario; erro?: string } {
  try {
    return { parametros: normalizarParametros((p ?? {}) as Partial<ParametrosCenario>) };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Parâmetros inválidos.' };
  }
}

async function listarSalvos(): Promise<CenarioSalvo[]> {
  const { data, error } = await supabaseAdmin.from('cenarios_financeiros').select('*').order('atualizado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapearCenario);
}

// GET /api/financeiro/simulador -> { base, cenarios_padrao, salvos }
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const [base, salvos] = await Promise.all([baseSimulador(), listarSalvos()]);
    return NextResponse.json({ base, cenarios_padrao: cenariosPadrao(base), salvos });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/simulador');
  }
}

// POST /api/financeiro/simulador { nome, parametros } -> CenarioSalvo (201)
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    const nome = String(body.nome ?? '').trim();
    if (!nome) return erro400('Dê um nome ao cenário.');
    const { parametros, erro } = normalizar({ ...body.parametros, nome });
    if (erro || !parametros) return erro400(erro ?? 'Parâmetros inválidos.');
    const { data, error } = await supabaseAdmin.from('cenarios_financeiros').insert({ nome, parametros }).select('*').single();
    if (error) throw new Error(error.message);
    const criado = mapearCenario(data);
    await registrarEvento({ entidade: 'cenario', entidade_id: criado.id, acao: 'criar', depois: { nome }, usuario_id: usuario?.id ?? null });
    return NextResponse.json(criado, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/simulador');
  }
}

// PATCH /api/financeiro/simulador { id, nome?, parametros? } -> CenarioSalvo
export async function PATCH(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) return erro400('Informe o id do cenário.');
    const campos: Record<string, unknown> = {};
    if (body.nome !== undefined) {
      const nome = String(body.nome ?? '').trim();
      if (!nome) return erro400('Dê um nome ao cenário.');
      campos.nome = nome;
    }
    if (body.parametros !== undefined) {
      const { parametros, erro } = normalizar({ ...body.parametros, ...(campos.nome ? { nome: campos.nome } : {}) });
      if (erro || !parametros) return erro400(erro ?? 'Parâmetros inválidos.');
      campos.parametros = parametros;
    }
    if (Object.keys(campos).length === 0) return erro400('Nada para alterar.');
    const { data, error } = await supabaseAdmin.from('cenarios_financeiros').update(campos).eq('id', body.id).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Cenário não encontrado.' }, { status: 404 });
    await registrarEvento({ entidade: 'cenario', entidade_id: String(body.id), acao: 'editar', depois: { nome: campos.nome ?? null, parametros: body.parametros !== undefined }, usuario_id: usuario?.id ?? null });
    return NextResponse.json(mapearCenario(data));
  } catch (e) {
    return responderErro(e, 'PATCH /api/financeiro/simulador');
  }
}

// DELETE /api/financeiro/simulador?id=
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return erro400('Informe o id do cenário.');
    const { data, error } = await supabaseAdmin.from('cenarios_financeiros').delete().eq('id', id).select('id, nome');
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: 'Cenário não encontrado.' }, { status: 404 });
    await registrarEvento({ entidade: 'cenario', entidade_id: id, acao: 'excluir', antes: { nome: data[0].nome }, usuario_id: usuario?.id ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return responderErro(e, 'DELETE /api/financeiro/simulador');
  }
}
