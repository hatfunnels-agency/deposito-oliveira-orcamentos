import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { exigirPapel } from '@/lib/auth-admin';
import { parseExtrato, type Layout } from '@/lib/extrato-parser';
import { importarLancamentos } from '@/lib/financeiro/importar-lancamentos';
import { ErroFinanceiro } from '@/lib/financeiro/eventos';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Extrato e dado gerencial (saldo, fornecedores, folha): so admin. O
// ExtratosTab manda o Bearer da sessao (apiFinanceiro).
const RECURSO = 'os extratos';

// GET /api/financeiro/extratos — historico de importacoes + contas
export async function GET(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const [{ data: contas }, { data: importacoes }] = await Promise.all([
      supabaseAdmin
        .from('contas_financeiras')
        .select('id, nome, tipo, layout, instituicao')
        .eq('ativo', true)
        .order('nome'),
      supabaseAdmin
        .from('extratos_importacoes')
        .select('id, conta_id, arquivo_nome, periodo_inicio, periodo_fim, linhas_total, linhas_novas, linhas_duplicadas, criado_em')
        .order('criado_em', { ascending: false })
        .limit(40),
    ]);

    return NextResponse.json({
      contas: contas || [],
      importacoes: importacoes || [],
    });
  } catch (e) {
    console.error('Erro em GET /api/financeiro/extratos:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST /api/financeiro/extratos — upload de extrato (multipart)
//   campos: arquivo (File), conta_id (uuid)
//   -> ResultadoImportacao (dedupe por hash e por conteudo, categorizacao,
//      saldo da conta e conciliacao automatica — tudo em importarLancamentos)
export async function POST(request: NextRequest) {
  const { negado } = await exigirPapel(request, ['admin'], RECURSO);
  if (negado) return negado;
  try {
    const form = await request.formData();
    const arquivo = form.get('arquivo');
    const contaId = String(form.get('conta_id') || '');

    if (!(arquivo instanceof File)) {
      return NextResponse.json({ error: 'Envie o arquivo do extrato' }, { status: 400 });
    }
    if (!contaId) {
      return NextResponse.json({ error: 'Escolha a conta de origem' }, { status: 400 });
    }

    const { data: conta, error: errConta } = await supabaseAdmin
      .from('contas_financeiras')
      .select('id, nome, layout')
      .eq('id', contaId)
      .single();
    if (errConta || !conta) {
      return NextResponse.json({ error: 'Conta nao encontrada' }, { status: 404 });
    }

    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const arquivoHash = createHash('sha256').update(buffer).digest('hex');

    // Parse. Erro de layout tem que subir claro pro usuario — nunca
    // importar pela metade em silencio.
    let parsed;
    try {
      parsed = parseExtrato(buffer, arquivo.name, conta.layout as Layout, conta.id);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Nao consegui ler o arquivo' },
        { status: 400 }
      );
    }
    if (parsed.lancamentos.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum lancamento reconhecido no arquivo', ignoradas: parsed.ignoradas.slice(0, 10) },
        { status: 400 }
      );
    }

    const resultado = await importarLancamentos({
      conta: { id: String(conta.id), nome: String(conta.nome), layout: String(conta.layout) },
      lancamentos: parsed.lancamentos,
      origem: 'extrato',
      arquivo: { nome: arquivo.name, hash: arquivoHash },
      saldo_final: parsed.saldo_final,
      ignoradas: parsed.ignoradas,
    });
    return NextResponse.json(resultado);
  } catch (e) {
    const status = e instanceof ErroFinanceiro ? e.status : 500;
    if (status === 500) console.error('Erro em POST /api/financeiro/extratos:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno ao importar' }, { status });
  }
}
