import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import type { DespesaFixa, NovaDespesaFixa } from '@/lib/financeiro/tipos';
import { GRUPOS_DESPESA, listarDespesasFixas, propagarDespesaFixa, totalMensal } from '@/lib/financeiro/despesas-fixas';
import { vendasDoMes } from '@/lib/financeiro/cmv';
import { ehData, ehMes, mesAnterior, mesSP, primeiroDiaDoMes } from '@/lib/financeiro/datas';
import { ErroFinanceiro, registrarEvento } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

const RECURSO = 'as despesas fixas';
const erro400 = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function responderErro(e: unknown, rotulo: string) {
  const status = e instanceof ErroFinanceiro ? e.status : 500;
  if (status === 500) console.error(`Erro em ${rotulo}:`, e);
  return NextResponse.json({ error: status === 500 ? 'Erro interno' : (e as Error).message }, { status });
}

async function buscar(id: string): Promise<DespesaFixa> {
  const d = (await listarDespesasFixas(true)).find(x => x.id === id);
  if (!d) throw new ErroFinanceiro(404, 'Despesa fixa não encontrada.');
  return d;
}

// Campos que vao direto pra tabela. Valida e normaliza; devolve a mensagem
// de erro em vez de lancar, pra rota responder 400.
function montarCampos(b: Partial<NovaDespesaFixa>, parcial: boolean): { campos?: Record<string, unknown>; erro?: string } {
  const campos: Record<string, unknown> = {};
  if (b.nome !== undefined || !parcial) {
    const nome = String(b.nome ?? '').replace(/\s+/g, ' ').trim();
    if (!nome) return { erro: 'Dê um nome à despesa.' };
    campos.nome = nome;
  }
  if (b.grupo !== undefined || !parcial) {
    if (!GRUPOS_DESPESA.includes(b.grupo as DespesaFixa['grupo'])) return { erro: 'Grupo inválido.' };
    campos.grupo = b.grupo;
  }
  if (b.categoria_id !== undefined) campos.categoria_id = b.categoria_id || null;
  if (b.fornecedor_id !== undefined) campos.fornecedor_id = b.fornecedor_id || null;
  if (b.tipo_valor !== undefined) {
    if (!['fixo', 'pct_faturamento'].includes(b.tipo_valor)) return { erro: 'Tipo de valor inválido.' };
    campos.tipo_valor = b.tipo_valor;
  }
  if (b.valor !== undefined) {
    if (!Number.isFinite(Number(b.valor)) || Number(b.valor) < 0) return { erro: 'Valor inválido.' };
    campos.valor = Number(b.valor);
  }
  if (b.percentual !== undefined) {
    if (b.percentual !== null && (!Number.isFinite(Number(b.percentual)) || Number(b.percentual) < 0 || Number(b.percentual) > 100)) {
      return { erro: 'Percentual inválido (0 a 100).' };
    }
    campos.percentual = b.percentual === null ? null : Number(b.percentual);
  }
  if (b.valor_juros !== undefined) {
    if (!Number.isFinite(Number(b.valor_juros)) || Number(b.valor_juros) < 0) return { erro: 'Valor de juros inválido.' };
    campos.valor_juros = Number(b.valor_juros);
  }
  if (b.dia_vencimento !== undefined) {
    const d = Number(b.dia_vencimento);
    if (!Number.isInteger(d) || d < 1 || d > 31) return { erro: 'Dia de vencimento inválido (1 a 31).' };
    campos.dia_vencimento = d;
  }
  if (b.inicio !== undefined) {
    if (!ehData(b.inicio) && !ehMes(b.inicio)) return { erro: 'Início inválido (use AAAA-MM).' };
    campos.inicio = primeiroDiaDoMes(b.inicio);
  }
  if (b.fim !== undefined) {
    if (b.fim !== null && !ehData(b.fim) && !ehMes(b.fim)) return { erro: 'Fim inválido (use AAAA-MM).' };
    campos.fim = b.fim === null ? null : primeiroDiaDoMes(b.fim);
  }
  if (b.parcelas_total !== undefined) {
    if (b.parcelas_total !== null && (!Number.isInteger(Number(b.parcelas_total)) || Number(b.parcelas_total) < 1)) return { erro: 'Total de parcelas inválido.' };
    campos.parcelas_total = b.parcelas_total === null ? null : Number(b.parcelas_total);
  }
  if (b.gera_conta !== undefined) campos.gera_conta = Boolean(b.gera_conta);
  if (b.ativo !== undefined) campos.ativo = Boolean(b.ativo);
  if (b.observacoes !== undefined) campos.observacoes = String(b.observacoes ?? '').trim() || null;
  if (b.ordem !== undefined) campos.ordem = Number.isFinite(Number(b.ordem)) ? Math.trunc(Number(b.ordem)) : 100;
  return { campos };
}

// GET /api/financeiro/despesas-fixas?inativas=1&mes=AAAA-MM -> { despesas, totais }
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    const mesParam = sp.get('mes');
    if (mesParam && !ehMes(mesParam)) return erro400('Mês inválido (use AAAA-MM).');
    const mes = mesParam || mesSP();
    const inativas = ['1', 'true'].includes(sp.get('inativas') || '');
    const despesas = await listarDespesasFixas(inativas, mes);
    // Despesa em % do faturamento usa o mes anterior como base; so le vendas se existir alguma.
    const precisaFaturamento = despesas.some(d => d.ativo && d.tipo_valor === 'pct_faturamento');
    const fat = precisaFaturamento ? (await vendasDoMes(mesAnterior(mes))).faturamento : 0;
    return NextResponse.json({ despesas, totais: totalMensal(despesas.filter(d => d.ativo), mes, fat) });
  } catch (e) {
    return responderErro(e, 'GET /api/financeiro/despesas-fixas');
  }
}

// POST /api/financeiro/despesas-fixas  NovaDespesaFixa -> DespesaFixa (201)
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = (await request.json().catch(() => null)) as NovaDespesaFixa | null;
    if (!body || typeof body !== 'object') return erro400('Corpo inválido.');
    const { campos, erro } = montarCampos(body, false);
    if (erro || !campos) return erro400(erro ?? 'Dados inválidos.');
    if (campos.tipo_valor === 'pct_faturamento' && !(Number(campos.percentual) > 0)) return erro400('Informe o percentual do faturamento.');

    const { data, error } = await supabaseAdmin.from('despesas_fixas').insert({ ...campos, fonte: 'manual' }).select('id').single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Já existe uma despesa fixa com esse nome.' }, { status: 409 });
      throw new Error(error.message);
    }
    const criada = await buscar(String(data.id));
    await registrarEvento({ entidade: 'despesa_fixa', entidade_id: criada.id, acao: 'criar', depois: campos, usuario_id: usuario?.id ?? null });
    return NextResponse.json(criada, { status: 201 });
  } catch (e) {
    return responderErro(e, 'POST /api/financeiro/despesas-fixas');
  }
}

// PATCH /api/financeiro/despesas-fixas { id, ...Partial<NovaDespesaFixa> } -> DespesaFixa
// Depois de salvar, as contas pendentes nao editadas a mao acompanham.
export async function PATCH(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) return erro400('Informe o id da despesa.');
    const { id, ...resto } = body as { id: string } & Partial<NovaDespesaFixa>;
    const antes = await buscar(String(id));
    const { campos, erro } = montarCampos(resto, true);
    if (erro || !campos) return erro400(erro ?? 'Dados inválidos.');
    if (Object.keys(campos).length === 0) return erro400('Nada para alterar.');

    const { error } = await supabaseAdmin.from('despesas_fixas').update(campos).eq('id', id);
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Já existe uma despesa fixa com esse nome.' }, { status: 409 });
      throw new Error(error.message);
    }
    const propagadas = await propagarDespesaFixa(String(id));
    const depois = await buscar(String(id));
    await registrarEvento({ entidade: 'despesa_fixa', entidade_id: depois.id, acao: 'editar', antes, depois: { ...campos, contas_propagadas: propagadas }, usuario_id: usuario?.id ?? null });
    return NextResponse.json(depois);
  } catch (e) {
    return responderErro(e, 'PATCH /api/financeiro/despesas-fixas');
  }
}

// DELETE /api/financeiro/despesas-fixas?id= -> { ok, inativada }
// Se ja gerou conta a pagar, so inativa (as pendentes sao canceladas pela
// propagacao; as pagas ficam como historico). Sem conta, apaga de vez.
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return erro400('Informe o id da despesa.');
    const antes = await buscar(id);
    if (antes.fonte === 'funcionarios') return NextResponse.json({ error: 'A folha vem de Funcionários e não pode ser removida daqui.' }, { status: 409 });

    const { count, error: errCount } = await supabaseAdmin
      .from('contas_pagar')
      .select('id', { count: 'exact', head: true })
      .eq('despesa_fixa_id', id);
    if (errCount) throw new Error(errCount.message);

    if ((count ?? 0) > 0) {
      const { error } = await supabaseAdmin.from('despesas_fixas').update({ ativo: false }).eq('id', id);
      if (error) throw new Error(error.message);
      const canceladas = await propagarDespesaFixa(id);
      await registrarEvento({ entidade: 'despesa_fixa', entidade_id: id, acao: 'inativar', antes, depois: { contas_canceladas: canceladas }, usuario_id: usuario?.id ?? null });
      return NextResponse.json({ ok: true, inativada: true, contas_canceladas: canceladas });
    }

    const { error } = await supabaseAdmin.from('despesas_fixas').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await registrarEvento({ entidade: 'despesa_fixa', entidade_id: id, acao: 'excluir', antes, usuario_id: usuario?.id ?? null });
    return NextResponse.json({ ok: true, inativada: false });
  } catch (e) {
    return responderErro(e, 'DELETE /api/financeiro/despesas-fixas');
  }
}
