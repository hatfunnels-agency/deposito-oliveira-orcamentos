import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import { registrarEvento } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';

/**
 * Caixa em especie.
 *
 * ENTRADA e derivada, nao digitada: cada pagamento com metodo='dinheiro'
 * vira um lancamento de caixa. Pedir pro Roger digitar de novo o que o
 * sistema ja sabe seria trabalho duplicado e fonte de divergencia.
 *
 * SAIDA e lancada a mao, porque nao existe em lugar nenhum: folha paga em
 * dinheiro, compra no mercado, frete avulso. E o dado que hoje some.
 */

const contaCaixa = async () => {
  const { data } = await supabaseAdmin
    .from('contas_financeiras')
    .select('id')
    .eq('tipo', 'caixa')
    .limit(1)
    .single();
  return data?.id as string | undefined;
};

const hashManual = (contaId: string, chave: string) =>
  createHash('sha256').update(`${contaId}|caixa|${chave}`).digest('hex').slice(0, 32);

/**
 * GET /api/financeiro/caixa?de=2026-07-01&ate=2026-07-31
 * Extrato do caixa no periodo + saldo acumulado desde sempre.
 */
export async function GET(request: NextRequest) {
  // O caixa recebe folha e contas pagas em dinheiro: dado gerencial, so admin.
  const { negado } = await exigirPapel(request, ['admin'], 'o caixa');
  if (negado) return negado;
  try {
    const contaId = await contaCaixa();
    if (!contaId) {
      return NextResponse.json({ error: 'Conta de caixa nao existe. Rode a migration 20260807.' }, { status: 400 });
    }
    const sp = request.nextUrl.searchParams;
    const hoje = new Date().toISOString().slice(0, 10);
    const de = sp.get('de') || hoje;
    const ate = sp.get('ate') || de;

    const [{ data: mov }, { data: tudo }] = await Promise.all([
      supabaseAdmin
        .from('lancamentos_bancarios')
        .select('id, data, descricao, contraparte, valor, origem_lancamento, categoria_id, categorias_financeiras ( nome, grupo )')
        .eq('conta_id', contaId)
        .gte('data', de).lte('data', ate)
        .order('data', { ascending: false }),
      supabaseAdmin
        .from('lancamentos_bancarios')
        .select('valor')
        .eq('conta_id', contaId)
        .lte('data', ate),
    ]);

    const movimentos = mov || [];
    const entrou = movimentos.filter(l => Number(l.valor) > 0).reduce((a, l) => a + Number(l.valor), 0);
    const saiu = movimentos.filter(l => Number(l.valor) < 0).reduce((a, l) => a + Number(l.valor), 0);
    const saldo = (tudo || []).reduce((a, l) => a + Number(l.valor), 0);
    // Esperado sem o ajuste do proprio dia: e o que o 'fechar' usa de base,
    // entao o modal de refechar mostra a mesma referencia do servidor.
    const { data: ajusteDia } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select('valor')
      .eq('conta_id', contaId)
      .eq('hash_linha', hashManual(contaId, `ajuste:${ate}`))
      .maybeSingle();
    const saldoSemAjuste = saldo - Number(ajusteDia?.valor ?? 0);

    const { data: categorias } = await supabaseAdmin
      .from('categorias_financeiras')
      .select('id, nome, grupo')
      .order('ordem');

    return NextResponse.json({
      conta_id: contaId,
      periodo: { de, ate },
      movimentos,
      entrou: Number(entrou.toFixed(2)),
      saiu: Number(saiu.toFixed(2)),
      saldo_acumulado: Number(saldo.toFixed(2)),
      saldo_sem_ajuste_do_dia: Number(saldoSemAjuste.toFixed(2)),
      categorias: categorias || [],
    });
  } catch (e) {
    console.error('Erro em GET /api/financeiro/caixa:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * POST /api/financeiro/caixa
 *   { acao: 'sincronizar', de, ate }  -> puxa as vendas em dinheiro do periodo
 *   { acao: 'lancar', data, descricao, valor, categoria_id }  -> saida (ou entrada) manual
 *   { acao: 'fechar', data, saldo_contado, observacoes, ajustar? } -> contagem do dia
 *       ajustar=true: diferenca != 0 vira lancamento 'Caixa - diferenca de conta'
 *       pro ledger bater com o que foi contado
 */
export async function POST(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'o caixa');
  if (negado) return negado;
  try {
    const contaId = await contaCaixa();
    if (!contaId) {
      return NextResponse.json({ error: 'Conta de caixa nao existe. Rode a migration 20260807.' }, { status: 400 });
    }
    const body = await request.json();

    // ---------- sincronizar vendas em dinheiro ----------
    if (body.acao === 'sincronizar') {
      const de = String(body.de || '').slice(0, 10);
      const ate = String(body.ate || de).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de)) {
        return NextResponse.json({ error: 'Informe o periodo (de/ate)' }, { status: 400 });
      }

      const { data: pagamentos, error } = await supabaseAdmin
        .from('pagamentos')
        .select('id, valor, data_pagamento, orcamento_id, orcamentos:orcamento_id ( codigo, clientes ( nome ) )')
        .eq('metodo', 'dinheiro')
        .gte('data_pagamento', `${de}T00:00:00Z`)
        .lte('data_pagamento', `${ate}T23:59:59Z`);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const { data: jaExistem } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .select('pagamento_id')
        .eq('conta_id', contaId)
        .not('pagamento_id', 'is', null);
      const existentes = new Set((jaExistem || []).map(r => String(r.pagamento_id)));

      const { data: catVenda } = await supabaseAdmin
        .from('categorias_financeiras')
        .select('id')
        .eq('nome', 'Venda - Dinheiro (caixa)')
        .single();

      const novos = (pagamentos || [])
        .filter(p => !existentes.has(String(p.id)))
        .map(p => {
          const orc = (Array.isArray(p.orcamentos) ? p.orcamentos[0] : p.orcamentos) as
            | { codigo?: string; clientes?: { nome?: string } | Array<{ nome?: string }> } | null;
          const cli = Array.isArray(orc?.clientes) ? orc?.clientes[0] : orc?.clientes;
          const data = String(p.data_pagamento).slice(0, 10);
          return {
            conta_id: contaId,
            data,
            descricao: `Venda em dinheiro${orc?.codigo ? ` — ${orc.codigo}` : ''}`,
            contraparte: cli?.nome || null,
            valor: Number(p.valor),
            hash_linha: hashManual(contaId, `pag:${p.id}`),
            categoria_id: catVenda?.id ?? null,
            categoria_origem: 'regra' as const,
            categoria_confianca: 1,
            revisado: true,
            pagamento_id: p.id,
            orcamento_id: p.orcamento_id,
            origem_lancamento: 'pagamento' as const,
          };
        });

      let inseridos = 0;
      for (let i = 0; i < novos.length; i += 300) {
        const { error: errIns, count } = await supabaseAdmin
          .from('lancamentos_bancarios')
          .insert(novos.slice(i, i + 300), { count: 'exact' });
        if (errIns) return NextResponse.json({ error: errIns.message, inseridos }, { status: 500 });
        inseridos += count ?? 0;
      }

      return NextResponse.json({
        pagamentos_em_dinheiro: (pagamentos || []).length,
        ja_estavam: (pagamentos || []).length - novos.length,
        novos: inseridos,
        valor: Number(novos.reduce((a, n) => a + n.valor, 0).toFixed(2)),
      });
    }

    // ---------- lancamento manual ----------
    if (body.acao === 'lancar') {
      const data = String(body.data || '').slice(0, 10);
      const descricao = String(body.descricao || '').trim();
      const valorBruto = Number(body.valor);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: 'Data invalida' }, { status: 400 });
      if (!descricao) return NextResponse.json({ error: 'Descreva o lancamento' }, { status: 400 });
      if (!Number.isFinite(valorBruto) || valorBruto === 0) return NextResponse.json({ error: 'Valor invalido' }, { status: 400 });

      // Saida e o caso normal: o valor chega positivo e vira negativo, a
      // menos que o tipo seja explicitamente 'entrada'.
      const valor = body.tipo === 'entrada' ? Math.abs(valorBruto) : -Math.abs(valorBruto);

      const { data: criado, error } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .insert({
          conta_id: contaId,
          data,
          descricao,
          contraparte: body.contraparte || null,
          valor,
          hash_linha: hashManual(contaId, `man:${data}:${valor}:${descricao}:${Date.now()}`),
          categoria_id: body.categoria_id || null,
          categoria_origem: body.categoria_id ? 'manual' : null,
          categoria_confianca: body.categoria_id ? 1 : null,
          revisado: !!body.categoria_id,
          origem_lancamento: 'manual',
        })
        .select('id, data, descricao, valor')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await registrarEvento({ entidade: 'lancamento', entidade_id: String(criado.id), acao: 'lancar_caixa', depois: criado, usuario_id: usuario?.id ?? null });
      return NextResponse.json(criado, { status: 201 });
    }

    // ---------- fechamento do dia ----------
    if (body.acao === 'fechar') {
      const data = String(body.data || '').slice(0, 10);
      const contado = Number(body.saldo_contado);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: 'Data invalida' }, { status: 400 });
      if (!Number.isFinite(contado)) return NextResponse.json({ error: 'Informe o valor contado' }, { status: 400 });

      // O ajuste do proprio dia fica fora do "esperado": refechar o dia com
      // outra contagem recalcula a diferenca inteira em vez de somar em cima
      // do ajuste anterior. Ajustes de dias passados sao historico e contam.
      const hashAjuste = hashManual(contaId, `ajuste:${data}`);
      const { data: ate } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .select('valor')
        .eq('conta_id', contaId)
        .lte('data', data)
        .neq('hash_linha', hashAjuste);
      const esperado = (ate || []).reduce((a, l) => a + Number(l.valor), 0);

      const { data: fech, error } = await supabaseAdmin
        .from('fechamentos_caixa')
        .upsert(
          { data, saldo_esperado: Number(esperado.toFixed(2)), saldo_contado: contado, observacoes: body.observacoes || null },
          { onConflict: 'data' }
        )
        .select('data, saldo_esperado, saldo_contado, diferenca')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      let ajuste: { id: string; valor: number } | null = null;
      if (body.ajustar === true) {
        const diferenca = Number((contado - esperado).toFixed(2));
        if (Math.abs(diferenca) >= 0.01) {
          const { data: cat } = await supabaseAdmin
            .from('categorias_financeiras')
            .select('id')
            .eq('nome', 'Caixa - diferenca de conta')
            .maybeSingle();
          // Hash determinístico por data: fechar de novo substitui o ajuste, nao duplica.
          const { data: linha, error: errAj } = await supabaseAdmin
            .from('lancamentos_bancarios')
            .upsert({
              conta_id: contaId,
              data,
              descricao: 'Caixa - diferenca de conta',
              contraparte: null,
              valor: diferenca,
              hash_linha: hashAjuste,
              categoria_id: cat?.id ?? null,
              categoria_origem: cat?.id ? 'manual' : null,
              categoria_confianca: cat?.id ? 1 : null,
              revisado: true,
              origem_lancamento: 'manual',
            }, { onConflict: 'hash_linha' })
            .select('id, valor')
            .single();
          if (errAj) return NextResponse.json({ error: errAj.message }, { status: 400 });
          ajuste = { id: String(linha.id), valor: Number(linha.valor) };
        } else {
          // Contagem bateu: um ajuste antigo desse dia nao faz mais sentido.
          await supabaseAdmin.from('lancamentos_bancarios').delete().eq('hash_linha', hashAjuste);
        }
      }
      // Fechar mexe no ledger sem passar pela lib: a trilha fica aqui.
      await registrarEvento({
        entidade: 'lancamento', entidade_id: ajuste?.id ?? null, acao: 'ajuste_caixa',
        depois: { data, saldo_esperado: Number(esperado.toFixed(2)), saldo_contado: contado, ajustar: body.ajustar === true, ajuste: ajuste?.valor ?? null },
        usuario_id: usuario?.id ?? null,
      });
      return NextResponse.json({ ...fech, ajuste });
    }

    return NextResponse.json({ error: 'Acao desconhecida' }, { status: 400 });
  } catch (e) {
    console.error('Erro em POST /api/financeiro/caixa:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** DELETE /api/financeiro/caixa?id=uuid — so lancamento manual. */
export async function DELETE(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'o caixa');
  if (negado) return negado;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Informe o id' }, { status: 400 });

    // Entrada derivada de venda nao se apaga aqui: ela e reflexo do
    // pagamento. Apagar criaria divergencia silenciosa com a venda.
    const { data: alvo } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select('origem_lancamento, data, descricao, valor')
      .eq('id', id)
      .single();
    if (alvo?.origem_lancamento !== 'manual') {
      return NextResponse.json(
        { error: 'So da pra excluir lancamento manual. Entrada de venda em dinheiro se corrige no pedido.' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from('lancamentos_bancarios').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await registrarEvento({ entidade: 'lancamento', entidade_id: id, acao: 'excluir', antes: { data: alvo.data, descricao: alvo.descricao, valor: alvo.valor }, usuario_id: usuario?.id ?? null });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro em DELETE /api/financeiro/caixa:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
