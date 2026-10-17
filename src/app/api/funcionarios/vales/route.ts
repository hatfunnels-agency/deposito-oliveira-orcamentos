import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { hojeSP } from '@/lib/folha';
import { CATEGORIA_FOLHA, METODOS, carregarCategorias, categoriaPorNome, hashInterno } from '@/lib/financeiro/contas-pagar';
import { carregarContasFinanceiras, contaPorTipo } from '@/lib/financeiro/saldos';

export const dynamic = 'force-dynamic';

/**
 * Por onde saiu o dinheiro do vale (secao 3.16 da espec do financeiro).
 * Caixa ou cartao nao tem extrato: o lancamento nasce aqui, ja vinculado.
 * Banco fica sem linha — o extrato concilia. 'dinheiro' sem conta -> caixa.
 * (Mesma regra de /api/funcionarios/pagamentos.)
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

async function lancarVale(l: { conta_id: string; data: string; nome: string; valor: number; funcionario_vale_id: string }) {
  const cat = categoriaPorNome(await carregarCategorias(), CATEGORIA_FOLHA);
  const { error } = await supabaseAdmin.from('lancamentos_bancarios').upsert({
    conta_id: l.conta_id,
    data: l.data,
    descricao: `Vale — ${l.nome}`,
    contraparte: l.nome,
    valor: -Math.abs(l.valor),
    hash_linha: hashInterno(l.conta_id, 'folha', l.funcionario_vale_id),
    categoria_id: cat?.id ?? null,
    categoria_origem: 'manual',
    categoria_confianca: 1,
    revisado: true,
    origem_lancamento: 'folha',
    funcionario_vale_id: l.funcionario_vale_id,
    conciliado_em: new Date().toISOString(),
    conciliacao_origem: 'auto',
  }, { onConflict: 'hash_linha', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** POST /api/funcionarios/vales — { funcionario_id, valor, data?, descricao?, metodo?, conta_id? } */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const body = await request.json();
    const valor = Number(body.valor);
    if (!body.funcionario_id) return NextResponse.json({ error: 'Escolha o funcionário.' }, { status: 400 });
    if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'Valor do vale inválido.' }, { status: 400 });
    const data = typeof body.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : hojeSP();

    const saida = await resolverContaFolha(body);
    if ('erro' in saida) return NextResponse.json({ error: saida.erro }, { status: 400 });

    const { data: vale, error } = await supabaseAdmin
      .from('funcionario_vales')
      .insert({
        funcionario_id: body.funcionario_id,
        valor: Math.round(valor * 100) / 100,
        data,
        descricao: String(body.descricao ?? '').trim() || null,
        metodo: saida.metodo,
        conta_id: saida.conta_id,
      })
      .select('*, funcionarios ( nome )')
      .single();
    if (error) throw error;

    if (saida.lancar && saida.conta_id) {
      try {
        const func = Array.isArray(vale.funcionarios) ? vale.funcionarios[0] : vale.funcionarios;
        await lancarVale({
          conta_id: saida.conta_id,
          data,
          nome: String((func as { nome?: string } | null)?.nome ?? 'Funcionário'),
          valor: Number(vale.valor),
          funcionario_vale_id: String(vale.id),
        });
      } catch (e) {
        // O vale ficou registrado; a linha pode ser vinculada a mao depois.
        console.error('[funcionarios/vales] falha ao lancar vale no caixa/cartao:', e);
      }
    }
    // Resposta igual a de antes: o join do funcionario era so pro lancamento.
    const { funcionarios, ...resposta } = vale;
    void funcionarios;
    return NextResponse.json(resposta);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios/vales:', e);
    return NextResponse.json({ error: 'Erro ao lançar vale' }, { status: 500 });
  }
}

/** DELETE /api/funcionarios/vales?id= — so vale em aberto (ja descontado nao se apaga). */
export async function DELETE(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
    const { data: alvo } = await supabaseAdmin
      .from('funcionario_vales')
      .select('id, pagamento_id')
      .eq('id', id)
      .maybeSingle();
    if (!alvo) return NextResponse.json({ error: 'Vale não encontrado.' }, { status: 404 });
    if (alvo.pagamento_id) {
      return NextResponse.json({ error: 'Vale já descontado num pagamento. Desfaça o pagamento antes.' }, { status: 409 });
    }
    // A linha de caixa/cartao criada no POST e reflexo do vale: vai junto —
    // e ANTES do vale, porque a FK e ON DELETE SET NULL (depois nao se acha mais).
    const { error: eL } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .delete()
      .eq('funcionario_vale_id', id)
      .eq('origem_lancamento', 'folha');
    if (eL) throw eL;
    const { data, error } = await supabaseAdmin
      .from('funcionario_vales')
      .delete()
      .eq('id', id)
      .is('pagamento_id', null)
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: 'Vale já descontado num pagamento. Desfaça o pagamento antes.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/funcionarios/vales:', e);
    return NextResponse.json({ error: 'Erro ao apagar vale' }, { status: 500 });
  }
}
