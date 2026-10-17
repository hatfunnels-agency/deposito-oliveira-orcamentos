import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import type { ContextoFinanceiro, Papel } from '@/lib/financeiro/tipos';
import { hojeSP } from '@/lib/financeiro/datas';
import { carregarCategorias, carregarFornecedores } from '@/lib/financeiro/contas-pagar';
import { carregarContasFinanceiras, contaPorTipo } from '@/lib/financeiro/saldos';
import { carregarTaxas, taxasVigentes } from '@/lib/financeiro/taxas';

export const dynamic = 'force-dynamic';

// GET /api/financeiro/contexto — tudo que a tela /financeiro carrega uma vez
// pra montar selects e decidir o que mostrar (ContextoFinanceiro).
export async function GET(request: NextRequest) {
  const { negado, usuario } = await exigirPapel(request, ['admin'], 'a gestão financeira');
  if (negado) return negado;
  try {
    const hoje = hojeSP();
    const [categorias, contas, fornecedores, taxas, cnpj] = await Promise.all([
      carregarCategorias(),
      carregarContasFinanceiras(),
      carregarFornecedores(),
      carregarTaxas(),
      supabaseAdmin.from('configuracoes').select('valor').eq('chave', 'financeiro_cnpj_proprio').maybeSingle(),
    ]);
    const ativas = contas.filter(c => c.ativo);
    const vigentes = taxasVigentes(taxas, hoje);
    const caixa = await contaPorTipo('caixa', contas);
    const cartao = await contaPorTipo('cartao_credito', contas);
    const ctx: ContextoFinanceiro = {
      hoje,
      papel: (usuario?.papel as Papel) ?? 'admin',
      categorias,
      contas: ativas,
      fornecedores,
      taxas_vigentes: vigentes,
      tem_taxas: vigentes.length > 0,
      tem_cnpj_proprio: Boolean(String(cnpj.data?.valor ?? '').replace(/\D/g, '')),
      conta_caixa_id: caixa?.id ?? null,
      conta_cartao_id: cartao?.id ?? null,
    };
    return NextResponse.json(ctx);
  } catch (e) {
    console.error('Erro em GET /api/financeiro/contexto:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
