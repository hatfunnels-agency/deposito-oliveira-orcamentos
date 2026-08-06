import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { parseExtrato, type Layout } from '@/lib/extrato-parser';
import {
  carregarContexto,
  classificarPorRegras,
  classificarPorIA,
  type LancamentoParaCategorizar,
} from '@/lib/categorizacao';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/financeiro/extratos — historico de importacoes + contas
export async function GET() {
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
export async function POST(request: NextRequest) {
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

    // 1. Parse. Erro de layout tem que subir claro pro usuario — nunca
    //    importar pela metade em silencio.
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

    // 2. Dedup pelo hash da linha. Reimportar periodo sobreposto e o caso
    //    normal (extrato de julho e de agosto se cruzam nos dias do meio).
    const hashes = parsed.lancamentos.map(l => l.hash_linha);
    const existentes = new Set<string>();
    for (let i = 0; i < hashes.length; i += 500) {
      const { data } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .select('hash_linha')
        .in('hash_linha', hashes.slice(i, i + 500));
      for (const r of (data || [])) existentes.add(String(r.hash_linha));
    }
    const novos = parsed.lancamentos.filter(l => !existentes.has(l.hash_linha));

    // 3. Registra a importacao (mesmo sem novidade — vira historico).
    const { data: importacao, error: errImp } = await supabaseAdmin
      .from('extratos_importacoes')
      .insert({
        conta_id: conta.id,
        arquivo_nome: arquivo.name,
        arquivo_hash: arquivoHash,
        periodo_inicio: parsed.periodo_inicio,
        periodo_fim: parsed.periodo_fim,
        linhas_total: parsed.lancamentos.length,
        linhas_novas: novos.length,
        linhas_duplicadas: parsed.lancamentos.length - novos.length,
      })
      .select('id')
      .single();
    if (errImp) {
      return NextResponse.json({ error: errImp.message }, { status: 500 });
    }

    if (novos.length === 0) {
      return NextResponse.json({
        importacao_id: importacao.id,
        conta: conta.nome,
        periodo: [parsed.periodo_inicio, parsed.periodo_fim],
        total: parsed.lancamentos.length,
        novos: 0,
        duplicados: parsed.lancamentos.length,
        ignoradas: parsed.ignoradas,
        mensagem: 'Nada novo: todos os lancamentos deste arquivo ja estavam importados.',
      });
    }

    // 4. Categorizacao — regras primeiro, IA so no resto.
    const { categorias, categoriasPorId, regras } = await carregarContexto();
    const paraIA: { indice: number; lanc: LancamentoParaCategorizar }[] = [];

    const linhas = novos.map((l, indice) => {
      const alvo: LancamentoParaCategorizar = {
        descricao: l.descricao,
        contraparte: l.contraparte,
        documento: l.documento,
        valor: l.valor,
      };
      const c = classificarPorRegras(alvo, regras, categoriasPorId);
      if (!c.categoria_id) paraIA.push({ indice, lanc: alvo });
      return {
        conta_id: conta.id,
        importacao_id: importacao.id,
        data: l.data,
        descricao: l.descricao,
        contraparte: l.contraparte,
        documento: l.documento,
        valor: l.valor,
        saldo: l.saldo,
        tarifa: l.tarifa,
        hash_linha: l.hash_linha,
        categoria_id: c.categoria_id,
        categoria_origem: c.origem,
        categoria_confianca: c.confianca,
        revisado: false,
      };
    });

    if (paraIA.length > 0) {
      const sugestoes = await classificarPorIA(paraIA.map(p => p.lanc), categorias);
      sugestoes.forEach((catId, iLocal) => {
        const alvo = paraIA[iLocal];
        if (!alvo) return;
        linhas[alvo.indice].categoria_id = catId;
        linhas[alvo.indice].categoria_origem = 'ia';
        linhas[alvo.indice].categoria_confianca = 0.5;
      });
    }

    // 5. Grava em lotes.
    let inseridos = 0;
    for (let i = 0; i < linhas.length; i += 300) {
      const { error, count } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .insert(linhas.slice(i, i + 300), { count: 'exact' });
      if (error) {
        console.error('Erro ao inserir lancamentos:', error);
        return NextResponse.json(
          { error: `Importacao parcial: ${error.message}`, inseridos },
          { status: 500 }
        );
      }
      inseridos += count ?? linhas.slice(i, i + 300).length;
    }

    const semCategoria = linhas.filter(l => !l.categoria_id).length;
    const porIA = linhas.filter(l => l.categoria_origem === 'ia').length;

    return NextResponse.json({
      importacao_id: importacao.id,
      conta: conta.nome,
      periodo: [parsed.periodo_inicio, parsed.periodo_fim],
      total: parsed.lancamentos.length,
      novos: inseridos,
      duplicados: parsed.lancamentos.length - novos.length,
      classificados_por_regra: inseridos - porIA - semCategoria,
      classificados_por_ia: porIA,
      sem_categoria: semCategoria,
      a_revisar: porIA + semCategoria,
      ignoradas: parsed.ignoradas,
    });
  } catch (e) {
    console.error('Erro em POST /api/financeiro/extratos:', e);
    return NextResponse.json({ error: 'Erro interno ao importar' }, { status: 500 });
  }
}
