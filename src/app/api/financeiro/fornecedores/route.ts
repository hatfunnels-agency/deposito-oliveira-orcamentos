import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import type { Fornecedor, NovoFornecedor, TipoFornecedor } from '@/lib/financeiro/tipos';
import { METODOS, carregarFornecedores } from '@/lib/financeiro/contas-pagar';
import { ErroFinanceiro, registrarEvento } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const RECURSO = 'os fornecedores';
const TIPOS: TipoFornecedor[] = ['fornecedor', 'servico', 'imposto', 'divida', 'socio', 'outro'];
const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

async function buscar(id: string): Promise<Fornecedor> {
  const f = (await carregarFornecedores(true)).find(x => x.id === id);
  if (!f) throw new ErroFinanceiro(404, 'Fornecedor não encontrado.');
  return f;
}

function montarCampos(b: Partial<NovoFornecedor>, parcial: boolean): { campos?: Record<string, unknown>; erro?: string } {
  const campos: Record<string, unknown> = {};
  if (b.nome !== undefined || !parcial) {
    const nome = String(b.nome ?? '').replace(/\s+/g, ' ').trim();
    if (!nome) return { erro: 'Informe o nome do fornecedor.' };
    campos.nome = nome;
  }
  if (b.documentos !== undefined) {
    if (!Array.isArray(b.documentos)) return { erro: 'Documentos deve ser uma lista.' };
    // CPF/CNPJ so digitos, como o extrato traz — e assim que a conciliacao casa.
    const docs = [...new Set(b.documentos.map(d => String(d).replace(/\D/g, '')).filter(d => d.length === 11 || d.length === 14))];
    campos.documentos = docs;
  }
  if (b.tipo !== undefined) {
    if (!TIPOS.includes(b.tipo)) return { erro: 'Tipo de fornecedor inválido.' };
    campos.tipo = b.tipo;
  }
  if (b.categoria_padrao_id !== undefined) campos.categoria_padrao_id = b.categoria_padrao_id || null;
  if (b.conta_padrao_id !== undefined) campos.conta_padrao_id = b.conta_padrao_id || null;
  if (b.metodo_padrao !== undefined) {
    if (b.metodo_padrao !== null && !METODOS.includes(b.metodo_padrao)) return { erro: 'Método padrão inválido.' };
    campos.metodo_padrao = b.metodo_padrao || null;
  }
  if (b.observacoes !== undefined) campos.observacoes = String(b.observacoes ?? '').trim() || null;
  if (b.ativo !== undefined) campos.ativo = Boolean(b.ativo);
  return { campos };
}

// GET /api/financeiro/fornecedores?busca=&inativos=1 -> { fornecedores }
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    const inativos = ['1', 'true'].includes(sp.get('inativos') || '');
    const busca = (sp.get('busca') || '').trim().toLowerCase();
    let fornecedores = await carregarFornecedores(inativos);
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      fornecedores = fornecedores.filter(f =>
        f.nome.toLowerCase().includes(busca) || (digitos.length >= 4 && f.documentos.some(d => d.includes(digitos))));
    }
    return NextResponse.json({ fornecedores });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/fornecedores');
  }
}

// POST /api/financeiro/fornecedores  NovoFornecedor -> Fornecedor (201)
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as NovoFornecedor | null;
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    const { campos, erro } = montarCampos(body, false);
    if (erro || !campos) return erro400(erro ?? 'Dados inválidos.');
    const { data, error } = await supabaseAdmin.from('fornecedores').insert(campos).select('id').single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Já existe um fornecedor com esse nome.' }, { status: 409 });
      throw new Error(error.message);
    }
    const criado = await buscar(String(data.id));
    await registrarEvento({ entidade: 'fornecedor', entidade_id: criado.id, acao: 'criar', depois: campos, usuario_id: usuario?.id ?? null });
    return NextResponse.json(criado, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/fornecedores');
  }
}

// PATCH /api/financeiro/fornecedores { id, ...Partial<NovoFornecedor> } -> Fornecedor
export async function PATCH(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) return erro400('Informe o id do fornecedor.');
    const { id, ...resto } = body as { id: string } & Partial<NovoFornecedor>;
    const antes = await buscar(String(id));
    const { campos, erro } = montarCampos(resto, true);
    if (erro || !campos) return erro400(erro ?? 'Dados inválidos.');
    if (Object.keys(campos).length === 0) return erro400('Nada para alterar.');
    const { error } = await supabaseAdmin.from('fornecedores').update(campos).eq('id', id);
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Já existe um fornecedor com esse nome.' }, { status: 409 });
      throw new Error(error.message);
    }
    const depois = await buscar(String(id));
    await registrarEvento({ entidade: 'fornecedor', entidade_id: depois.id, acao: 'editar', antes, depois: campos, usuario_id: usuario?.id ?? null });
    return NextResponse.json(depois);
  } catch (e) {
    return responderErro(e, 'PATCH /api/financeiro/fornecedores');
  }
}

// DELETE /api/financeiro/fornecedores?id= — so sem conta a pagar (senao inative).
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return erro400('Informe o id do fornecedor.');
    const antes = await buscar(id);
    const { count, error: errCount } = await supabaseAdmin
      .from('contas_pagar')
      .select('id', { count: 'exact', head: true })
      .eq('fornecedor_id', id);
    if (errCount) throw new Error(errCount.message);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: 'Fornecedor tem contas a pagar. Inative-o em vez de excluir.' }, { status: 409 });
    }
    const { error } = await supabaseAdmin.from('fornecedores').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await registrarEvento({ entidade: 'fornecedor', entidade_id: id, acao: 'excluir', antes, usuario_id: usuario?.id ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return responderErro(e, 'DELETE /api/financeiro/fornecedores');
  }
}
