import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/financeiro/dre?mes=2026-07
 *
 * Monta o DRE do mes a partir dos lancamentos categorizados, e cruza a
 * receita do banco com a venda registrada no sistema.
 *
 * Tres regras que o resto do sistema nao pode esquecer:
 *
 * 1. TRANSFERENCIA ENTRE CONTAS FICA FORA. Em julho/2026, R$112k das
 *    entradas do Itau vieram da propria Stone. Sao dinheiro mudando de
 *    bolso, nao faturamento.
 * 2. SERVICO DE DIVIDA FICA ABAIXO DO LUCRO OPERACIONAL. Parcela de
 *    emprestimo e saida de caixa, nao despesa do periodo.
 * 3. RECEITA DO BANCO != VENDA DO SISTEMA, e esta certo que difira:
 *    dinheiro em especie nao passa em conta, venda a prazo entra depois,
 *    e cartao liquida com atraso. A diferenca e reportada, nao escondida.
 */

interface LinhaAgrupada {
  categoria: string;
  grupo: string;
  entra_no_dre: boolean;
  valor: number;
  lancamentos: number;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const mes = /^\d{4}-\d{2}$/.test(sp.get('mes') || '')
      ? sp.get('mes')!
      : new Date().toISOString().slice(0, 7);

    const inicio = `${mes}-01`;
    const [ano, m] = mes.split('-').map(Number);
    const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);

    const { data: lancs, error } = await supabaseAdmin
      .from('lancamentos_bancarios')
      .select(`
        valor, tarifa, categoria_id, revisado, categoria_origem,
        categorias_financeiras ( nome, grupo, entra_no_dre )
      `)
      .gte('data', inicio)
      .lte('data', fim);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const porCategoria = new Map<string, LinhaAgrupada>();
    const porGrupo = new Map<string, number>();
    let semCategoriaValor = 0;
    let semCategoriaQtd = 0;
    let aRevisar = 0;
    let tarifas = 0;

    for (const l of (lancs || [])) {
      const raw = (l as Record<string, unknown>).categorias_financeiras;
      const cat = (Array.isArray(raw) ? raw[0] : raw) as
        | { nome: string; grupo: string; entra_no_dre: boolean }
        | null;
      const valor = Number(l.valor) || 0;
      tarifas += Number(l.tarifa) || 0;

      if (!l.revisado && (!l.categoria_id || l.categoria_origem === 'ia')) aRevisar++;

      if (!cat) {
        semCategoriaValor += valor;
        semCategoriaQtd++;
        continue;
      }

      const linha = porCategoria.get(cat.nome) || {
        categoria: cat.nome, grupo: cat.grupo, entra_no_dre: cat.entra_no_dre, valor: 0, lancamentos: 0,
      };
      linha.valor += valor;
      linha.lancamentos++;
      porCategoria.set(cat.nome, linha);
      porGrupo.set(cat.grupo, (porGrupo.get(cat.grupo) || 0) + valor);
    }

    const g = (nome: string) => porGrupo.get(nome) || 0;
    const receita = g('receita');                    // positivo
    const cmv = Math.abs(g('cmv'));
    const custoVariavel = Math.abs(g('custo_variavel'));
    const custoFixo = Math.abs(g('custo_fixo'));
    const imposto = Math.abs(g('imposto'));
    const taxaFinanceira = Math.abs(g('taxa_financeira'));
    const servicoDivida = Math.abs(g('servico_divida'));
    const socio = Math.abs(g('socio'));
    const transferencia = g('transferencia');
    const naoOperacional = g('nao_operacional');

    const lucroBruto = receita - cmv;
    const lucroOperacional = lucroBruto - custoVariavel - custoFixo - imposto - taxaFinanceira;
    const caixaLivre = lucroOperacional - servicoDivida - socio;

    // Venda registrada no sistema, pra confrontar com o que entrou em conta.
    const { data: vendas } = await supabaseAdmin
      .from('orcamentos')
      .select('total')
      .not('status', 'in', '("orcamento","cancelado")')
      .gte('criado_em', `${inicio}T00:00:00Z`)
      .lte('criado_em', `${fim}T23:59:59Z`);
    const vendaSistema = (vendas || []).reduce((a, o) => a + (Number(o.total) || 0), 0);

    const categorias = [...porCategoria.values()].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

    return NextResponse.json({
      mes,
      periodo: { inicio, fim },
      dre: {
        receita,
        cmv,
        lucro_bruto: lucroBruto,
        margem_bruta_pct: receita > 0 ? Number(((lucroBruto / receita) * 100).toFixed(1)) : null,
        custo_variavel: custoVariavel,
        custo_fixo: custoFixo,
        imposto,
        taxa_financeira: taxaFinanceira,
        lucro_operacional: lucroOperacional,
        margem_operacional_pct: receita > 0 ? Number(((lucroOperacional / receita) * 100).toFixed(1)) : null,
        servico_divida: servicoDivida,
        retirada_socio: socio,
        caixa_livre: caixaLivre,
      },
      fora_do_dre: {
        transferencia_entre_contas: transferencia,
        nao_operacional: naoOperacional,
        tarifas_embutidas: Number(tarifas.toFixed(2)),
      },
      conciliacao_receita: {
        receita_no_banco: receita,
        venda_no_sistema: vendaSistema,
        diferenca: Number((vendaSistema - receita).toFixed(2)),
        // Sem explicar a diferenca, o DRE nao pode ser dado como fechado.
        nota: 'Diferenca esperada: dinheiro em especie nao transita em conta, venda a prazo entra depois e cartao liquida com atraso.',
      },
      qualidade: {
        lancamentos_no_mes: (lancs || []).length,
        a_revisar: aRevisar,
        sem_categoria_qtd: semCategoriaQtd,
        sem_categoria_valor: Number(semCategoriaValor.toFixed(2)),
        // Enquanto houver fila de revisao, o DRE e provisorio. Dizer isso
        // e mais util que entregar um numero redondo e errado.
        confiavel: aRevisar === 0 && semCategoriaQtd === 0,
      },
      categorias,
    });
  } catch (e) {
    console.error('Erro em GET /api/financeiro/dre:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
