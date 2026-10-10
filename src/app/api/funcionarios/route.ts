import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import { DIAS_AVISO_VALIDADE } from '@/lib/documentos-funcionario';
import {
  brutoDoPeriodo, camposFuncionario, diasEntre, encargosMensais, hojeSP, proximoPeriodo, somarDias, tempoDeCasa,
} from '@/lib/folha';

/**
 * Quantos documentos e quais tipos estao vencidos / vencendo (CNH, ASO).
 * Vale a validade mais recente de cada tipo: CNH renovada substitui a
 * antiga vencida, que pode continuar guardada.
 */
function resumoDocumentos(docs: { tipo: string; validade: string | null }[], hoje: string) {
  const limite = somarDias(hoje, DIAS_AVISO_VALIDADE);
  const validadePorTipo = new Map<string, string>();
  for (const d of docs) {
    if (d.validade && (validadePorTipo.get(d.tipo) ?? '') < d.validade) validadePorTipo.set(d.tipo, d.validade);
  }
  const tipos = Array.from(validadePorTipo.entries());
  return {
    total: docs.length,
    tipos: Array.from(new Set(docs.map(d => d.tipo))),
    vencidos: tipos.filter(([, v]) => v < hoje).map(([t]) => t),
    vencendo: tipos.filter(([, v]) => v >= hoje && v <= limite).map(([t]) => t),
  };
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/funcionarios[?inativos=1]
 * Lista com o calculo do proximo pagamento ja feito:
 *   bruto do periodo - vales em aberto = a receber.
 */
export async function GET(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const incluirInativos = request.nextUrl.searchParams.get('inativos') === '1';
    const q = supabaseAdmin.from('funcionarios').select('*').order('nome');

    const [{ data: funcs, error }, { data: vales }, { data: pags }, { data: docs }] = await Promise.all([
      q,
      supabaseAdmin
        .from('funcionario_vales')
        .select('id, funcionario_id, data, valor, descricao')
        .is('pagamento_id', null)
        .order('data'),
      supabaseAdmin
        .from('funcionario_pagamentos')
        .select('funcionario_id, periodo_fim, pago_em, valor_liquido')
        .order('periodo_fim', { ascending: false }),
      // Tabela pode nao existir ainda (migration de documentos): vira lista vazia.
      supabaseAdmin
        .from('funcionario_documentos')
        .select('funcionario_id, tipo, validade'),
    ]);
    if (error) throw error;

    const hoje = hojeSP();
    const lista = (funcs || []).map(f => {
      const base = { ...f, salario_mensal: Number(f.salario_mensal) };
      const ultimo = (pags || []).find(p => p.funcionario_id === f.id) || null;
      const periodo = proximoPeriodo(base, ultimo?.periodo_fim ?? null);
      const bruto = brutoDoPeriodo(base, periodo);
      const valesAbertos = (vales || [])
        .filter(v => v.funcionario_id === f.id)
        .map(v => ({ ...v, valor: Number(v.valor) }));
      const totalVales = valesAbertos.reduce((a, v) => a + v.valor, 0);
      return {
        ...base,
        proximo: {
          ...periodo,
          bruto: bruto.valor,
          proporcional: bruto.proporcional,
          dias: bruto.dias,
          dias_periodo: bruto.diasPeriodo,
          total_vales: Math.round(totalVales * 100) / 100,
          a_receber: Math.round((bruto.valor - totalVales) * 100) / 100,
          atrasado: periodo.pagamento < hoje,
          dias_ate: diasEntre(hoje, periodo.pagamento),
        },
        vales_abertos: valesAbertos,
        ultimo_pagamento: ultimo ? { pago_em: ultimo.pago_em, valor_liquido: Number(ultimo.valor_liquido) } : null,
        documentos: resumoDocumentos((docs || []).filter(d => d.funcionario_id === f.id), hoje),
        tempo_casa: tempoDeCasa(f.data_admissao, hoje),
        encargos: encargosMensais(base.salario_mensal),
      };
    });

    // Desligado continua na lista ate o acerto final (periodo que contem
    // o desligamento) ser pago.
    const filtrada = incluirInativos ? lista : lista.filter(f =>
      f.ativo || (f.data_desligamento && f.proximo.inicio <= f.data_desligamento));

    return NextResponse.json({ hoje, funcionarios: filtrada });
  } catch (e) {
    console.error('Erro em GET /api/funcionarios:', e);
    return NextResponse.json({ error: 'Erro ao carregar funcionários' }, { status: 500 });
  }
}

/** POST /api/funcionarios — cadastra. */
export async function POST(request: NextRequest) {
  const negado = await exigirAdmin(request);
  if (negado) return negado;
  try {
    const campos = camposFuncionario(await request.json(), false);
    if (typeof campos === 'string') return NextResponse.json({ error: campos }, { status: 400 });
    const { data, error } = await supabaseAdmin.from('funcionarios').insert(campos).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro em POST /api/funcionarios:', e);
    return NextResponse.json({ error: 'Erro ao cadastrar funcionário' }, { status: 500 });
  }
}
