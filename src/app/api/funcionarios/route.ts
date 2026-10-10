import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirAdmin } from '@/lib/auth-admin';
import {
  brutoDoPeriodo, camposFuncionario, diasEntre, encargosMensais, hojeSP, proximoPeriodo, tempoDeCasa,
} from '@/lib/folha';

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

    const [{ data: funcs, error }, { data: vales }, { data: pags }] = await Promise.all([
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
