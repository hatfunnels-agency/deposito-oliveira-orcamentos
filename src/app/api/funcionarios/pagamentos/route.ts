import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { brutoDoPeriodo, hojeSP, periodosSeguintesVencidos, proximoPeriodo } from '@/lib/folha';
import { CATEGORIA_FOLHA, METODOS, carregarCategorias, categoriaPorNome, hashInterno } from '@/lib/financeiro/contas-pagar';
import { carregarContasFinanceiras, contaPorTipo } from '@/lib/financeiro/saldos';
import { dataBR } from '@/lib/financeiro/datas';

export const dynamic = 'force-dynamic';

/**
 * Por onde saiu o dinheiro da folha (secao 3.16 da espec do financeiro).
 * Caixa ou cartao nao tem extrato: o lancamento nasce aqui, ja vinculado,
 * pra aparecer no Dia e no Fechamento uma vez so. Banco fica sem linha —
 * o extrato importado concilia depois. 'dinheiro' sem conta cai no caixa.
 */
async function resolverContaFolha(body: Record<string, unknown>): Promise<{ metodo: string | null; conta_id: string | null; lancar: boolean } | { erro: string }> {
  const metodo = body.metodo == null || body.metodo === '' ? null : String(body.metodo);
  if (metodo && !METODOS.includes(metodo as (typeof METODOS)[number])) return { erro: 'Método de pagamento inválido.' };
  const contas = await carregarContasFinanceiras();
  let conta = body.conta_id ? contas.find(c => c.id === String(body.conta_id)) ?? null : null;
  if (body.conta_id && !conta) return { erro: 'Conta financeira não encontrada.' };
  if (!conta && metodo === 'dinheiro') conta = await contaPorTipo('caixa', contas);
  const lancar = !!conta && (conta.tipo === 'caixa' || conta.tipo === 'cartao_credito' || metodo === 'dinheiro');
  return { metodo, conta_id: conta?.id ?? null, lancar };
}

async function lancarFolha(l: { conta_id: string; data: string; descricao: string; nome: string; valor: number; funcionario_pagamento_id: string }) {
  const cat = categoriaPorNome(await carregarCategorias(), CATEGORIA_FOLHA);
  const { error } = await supabaseAdmin.from('lancamentos_bancarios').upsert({
    conta_id: l.conta_id,
    data: l.data,
    descricao: l.descricao,
    contraparte: l.nome,
    valor: -Math.abs(l.valor),
    hash_linha: hashInterno(l.conta_id, 'folha', l.funcionario_pagamento_id),
    categoria_id: cat?.id ?? null,
    categoria_origem: 'manual',
    categoria_confianca: 1,
    revisado: true,
    origem_lancamento: 'folha',
    funcionario_pagamento_id: l.funcionario_pagamento_id,
    conciliado_em: new Date().toISOString(),
    conciliacao_origem: 'auto',
  }, { onConflict: 'hash_linha', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/**
 * GET /api/funcionarios/pagamentos?funcionario_id=&de=&ate=
 * Historico de pagamentos com os vales que cada um descontou.
 */
export async function GET(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const sp = request.nextUrl.searchParams;
    let q = supabaseAdmin
      .from('funcionario_pagamentos')
      .select('*, funcionarios ( nome, frequencia ), funcionario_vales ( id, data, valor, descricao )')
      .order('pago_em', { ascending: false })
      .order('criado_em', { ascending: false })
      .limit(200);
    const fid = sp.get('funcionario_id');
    if (fid) q = q.eq('funcionario_id', fid);
    if (sp.get('de')) q = q.gte('pago_em', sp.get('de')!);
    if (sp.get('ate')) q = q.lte('pago_em', sp.get('ate')!);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ pagamentos: data || [] });
  } catch (e) {
    console.error('Erro em GET /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao carregar pagamentos' }, { status: 500 });
  }
}

/**
 * POST /api/funcionarios/pagamentos — { funcionario_id, pago_em?, ajuste?, observacoes?, metodo?, conta_id?, ate_periodo_fim? }
 *
 * Paga o PROXIMO periodo em aberto. O calculo e refeito aqui (nao confia
 * no numero da tela) e desconta todos os vales em aberto ate pago_em.
 * Com `ate_periodo_fim` (AAAA-MM-DD), junta num pagamento so os periodos
 * seguintes ja vencidos ate essa data (acerto de atrasados): um registro
 * com periodo_inicio do primeiro e periodo_fim do ultimo, bruto somado.
 */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    const pagoEm = typeof body.pago_em === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.pago_em) ? body.pago_em : hojeSP();
    const ajuste = Math.round((Number(body.ajuste) || 0) * 100) / 100;

    const { data: f, error: eF } = await supabaseAdmin
      .from('funcionarios').select('*').eq('id', body.funcionario_id).single();
    if (eF || !f) return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 });

    const saida = await resolverContaFolha(body);
    if ('erro' in saida) return NextResponse.json({ error: saida.erro }, { status: 400 });

    const { data: ult } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .select('periodo_fim')
      .eq('funcionario_id', f.id)
      .order('periodo_fim', { ascending: false })
      .limit(1)
      .maybeSingle();

    const base = { ...f, salario_mensal: Number(f.salario_mensal) };
    const primeiro = proximoPeriodo(base, ult?.periodo_fim ?? null);
    // Acerto de varios periodos: so os ja vencidos em pago_em, ate a data pedida.
    const atePeriodoFim = typeof body.ate_periodo_fim === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.ate_periodo_fim) ? body.ate_periodo_fim : null;
    const seguintes = atePeriodoFim && atePeriodoFim > primeiro.fim
      ? periodosSeguintesVencidos(base, primeiro, pagoEm).filter(p => p.fim <= atePeriodoFim)
      : [];
    const todos = [primeiro, ...seguintes];
    const ultimoPeriodo = todos[todos.length - 1];
    const periodo = { inicio: primeiro.inicio, fim: ultimoPeriodo.fim, pagamento: ultimoPeriodo.pagamento };
    const bruto = { valor: Math.round(todos.reduce((s, p) => s + brutoDoPeriodo(base, p).valor, 0) * 100) / 100 };
    const obsPeriodos = todos.length > 1 ? `${todos.length} períodos num pagamento só` : '';

    const { data: vales } = await supabaseAdmin
      .from('funcionario_vales')
      .select('id, valor')
      .eq('funcionario_id', f.id)
      .is('pagamento_id', null)
      .lte('data', pagoEm);
    const totalVales = Math.round((vales || []).reduce((a, v) => a + Number(v.valor), 0) * 100) / 100;

    const { data: pag, error: eP } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .insert({
        funcionario_id: f.id,
        periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim,
        data_prevista: periodo.pagamento,
        pago_em: pagoEm,
        valor_bruto: bruto.valor,
        total_vales: totalVales,
        ajuste,
        valor_liquido: Math.round((bruto.valor - totalVales + ajuste) * 100) / 100,
        observacoes: [String(body.observacoes ?? '').trim(), obsPeriodos].filter(Boolean).join(' · ') || null,
        metodo: saida.metodo,
        conta_id: saida.conta_id,
      })
      .select()
      .single();
    if (eP) {
      // 23505 = unique (funcionario_id, periodo_fim): clique duplo.
      if (eP.code === '23505') return NextResponse.json({ error: 'Esse período já foi pago.' }, { status: 409 });
      throw eP;
    }

    if (vales?.length) {
      const { error: eV } = await supabaseAdmin
        .from('funcionario_vales')
        .update({ pagamento_id: pag.id })
        .in('id', vales.map(v => v.id));
      if (eV) {
        // Sem os vales marcados o pagamento ficaria errado: desfaz.
        await supabaseAdmin.from('funcionario_pagamentos').delete().eq('id', pag.id);
        throw eV;
      }
    }

    // Lancamento e espelho do pagamento: se falhar, o pagamento fica (o
    // salario foi pago) e a conciliacao manual cobre depois.
    if (saida.lancar && saida.conta_id && Number(pag.valor_liquido) > 0) {
      try {
        await lancarFolha({
          conta_id: saida.conta_id,
          data: pagoEm,
          descricao: `Salário — ${f.nome} (${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)})`,
          nome: String(f.nome),
          valor: Number(pag.valor_liquido),
          funcionario_pagamento_id: String(pag.id),
        });
      } catch (e) {
        console.error('[funcionarios/pagamentos] falha ao lancar folha no caixa/cartao:', e);
      }
    }
    return NextResponse.json(pag);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao registrar pagamento' }, { status: 500 });
  }
}

/**
 * DELETE /api/funcionarios/pagamentos?id= — desfaz um pagamento lancado
 * por engano. Os vales voltam a ficar em aberto (FK ON DELETE SET NULL).
 * So o ultimo de cada funcionario, senao a sequencia de periodos quebra.
 */
export async function DELETE(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    const { data: pag } = await supabaseAdmin
      .from('funcionario_pagamentos').select('id, funcionario_id').eq('id', id).single();
    if (!pag) return NextResponse.json({ error: 'Pagamento não encontrado.' }, { status: 404 });
    const { data: ult } = await supabaseAdmin
      .from('funcionario_pagamentos')
      .select('id')
      .eq('funcionario_id', pag.funcionario_id)
      .order('periodo_fim', { ascending: false })
      .limit(1)
      .single();
    if (ult?.id !== id) {
      return NextResponse.json({ error: 'Só dá para desfazer o último pagamento deste funcionário.' }, { status: 409 });
    }
    // A linha de caixa/cartao criada no POST vai junto. Linha de extrato
    // vinculada so perde o ponteiro (FK ON DELETE SET NULL) — o dinheiro saiu.
    const { error: eL } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .delete()
      .eq('funcionario_pagamento_id', id)
      .eq('origem_lancamento', 'folha');
    if (eL) throw eL;
    const { error } = await supabaseAdmin.from('funcionario_pagamentos').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/funcionarios/pagamentos:', e);
    return NextResponse.json({ error: 'Erro ao desfazer pagamento' }, { status: 500 });
  }
}
