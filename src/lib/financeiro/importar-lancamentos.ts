// Importacao de extrato: do arquivo ja parseado ate as linhas no banco,
// categorizadas, com o saldo da conta registrado e a conciliacao rodada.
//
// Dois filtros de duplicata, porque reimportar periodo sobreposto e o caso
// normal: (1) hash da linha — mesmo arquivo/mesmo layout; (2) conteudo
// (data, valor) no periodo do arquivo — o mesmo mes vindo em xlsx e depois
// em OFX tem hashes diferentes mas sao os mesmos movimentos; so entra o
// excedente de cada par (data, valor).

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { carregarContexto, classificarPorIA, classificarPorRegras, type LancamentoParaCategorizar } from '@/lib/categorizacao';
import type { EntradaImportacao, ResultadoImportacao } from './tipos';
import { ehData } from './datas';
import { ErroFinanceiro } from './eventos';
import { registrarSaldoExtrato } from './saldos';
import { conciliar } from './conciliacao';

type Row = Record<string, any>;
const chaveConteudo = (data: string, valor: number) => `${data}|${Number(valor).toFixed(2)}`;

export async function importarLancamentos(e: EntradaImportacao): Promise<ResultadoImportacao> {
  const lancs = e.lancamentos ?? [];
  if (lancs.length === 0) throw new ErroFinanceiro(400, 'Nenhum lançamento reconhecido no arquivo.');
  const datas = lancs.map(l => l.data).sort();
  const periodo: [string, string] = [datas[0], datas[datas.length - 1]];

  // 1. Dedup por hash (reimportacao do mesmo arquivo/periodo).
  const existentes = new Set<string>();
  const hashes = lancs.map(l => l.hash_linha);
  for (let i = 0; i < hashes.length; i += 500) {
    const { data, error } = await supabaseAdmin.from('lancamentos_bancarios').select('hash_linha').in('hash_linha', hashes.slice(i, i + 500));
    if (error) throw new Error(error.message);
    for (const r of (data || [])) existentes.add(String(r.hash_linha));
  }
  const semHash = lancs.filter(l => !existentes.has(l.hash_linha));

  // 2. Dedup por conteudo: por (data, valor), ja existem E linhas na conta e
  //    o arquivo traz F; entram no maximo F - E das novas.
  const jaNoBanco = await lerTudo<Row>(() => supabaseAdmin
    .from('lancamentos_bancarios').select('data, valor').eq('conta_id', e.conta.id).gte('data', periodo[0]).lte('data', periodo[1]));
  const noBanco = new Map<string, number>();
  for (const r of jaNoBanco) { const k = chaveConteudo(String(r.data), Number(r.valor)); noBanco.set(k, (noBanco.get(k) ?? 0) + 1); }
  const noArquivo = new Map<string, number>();
  for (const l of lancs) { const k = chaveConteudo(l.data, l.valor); noArquivo.set(k, (noArquivo.get(k) ?? 0) + 1); }
  const cota = new Map<string, number>();
  const novos = semHash.filter(l => {
    const k = chaveConteudo(l.data, l.valor);
    if (!cota.has(k)) cota.set(k, Math.max(0, (noArquivo.get(k) ?? 0) - (noBanco.get(k) ?? 0)));
    const restante = cota.get(k) ?? 0;
    if (restante <= 0) return false;
    cota.set(k, restante - 1);
    return true;
  });
  const duplicadosPorConteudo = semHash.length - novos.length;

  // 3. Registro da importacao (mesmo sem novidade: vira historico).
  const { data: importacao, error: errImp } = await supabaseAdmin
    .from('extratos_importacoes')
    .insert({
      conta_id: e.conta.id,
      arquivo_nome: e.arquivo.nome,
      arquivo_hash: e.arquivo.hash,
      periodo_inicio: periodo[0],
      periodo_fim: periodo[1],
      linhas_total: lancs.length,
      linhas_novas: novos.length,
      linhas_duplicadas: lancs.length - novos.length,
    })
    .select('id')
    .single();
  if (errImp) throw new Error(errImp.message);
  const importacaoId = String(importacao.id);

  // 4. Categorizacao: regras primeiro, IA so no que sobrou.
  let inseridos = 0, porIA = 0, semCategoria = 0;
  if (novos.length > 0) {
    const { categorias, categoriasPorId, regras } = await carregarContexto();
    const paraIA: Array<{ indice: number; lanc: LancamentoParaCategorizar }> = [];
    const linhas = novos.map((l, indice) => {
      const alvo: LancamentoParaCategorizar = { descricao: l.descricao, contraparte: l.contraparte, documento: l.documento, valor: l.valor };
      const c = classificarPorRegras(alvo, regras, categoriasPorId);
      if (!c.categoria_id) paraIA.push({ indice, lanc: alvo });
      return {
        conta_id: e.conta.id,
        importacao_id: importacaoId,
        data: l.data,
        descricao: l.descricao,
        contraparte: l.contraparte,
        documento: l.documento,
        valor: l.valor,
        saldo: l.saldo,
        tarifa: l.tarifa,
        hash_linha: l.hash_linha,
        categoria_id: c.categoria_id,
        categoria_origem: c.origem as string | null,
        categoria_confianca: c.confianca,
        revisado: false,
        origem_lancamento: e.origem,
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

    // 5. Grava em lotes. upsert ignoreDuplicates: duas importacoes ao mesmo
    //    tempo nao estouram o UNIQUE do hash.
    for (let i = 0; i < linhas.length; i += 300) {
      const lote = linhas.slice(i, i + 300);
      const { data, error } = await supabaseAdmin
        .from('lancamentos_bancarios')
        .upsert(lote, { onConflict: 'hash_linha', ignoreDuplicates: true })
        .select('id, categoria_id, categoria_origem');
      if (error) throw new ErroFinanceiro(500, `Importação parcial (${inseridos} linhas gravadas): ${error.message}`);
      for (const r of (data || []) as Row[]) {
        inseridos++;
        if (!r.categoria_id) semCategoria++;
        else if (r.categoria_origem === 'ia') porIA++;
      }
    }
  }

  // 6. Saldo final do arquivo -> saldos_conta (origem 'extrato').
  let saldoRegistrado: ResultadoImportacao['saldo_registrado'] = null;
  if (e.saldo_final && ehData(e.saldo_final.data) && Number.isFinite(Number(e.saldo_final.saldo))) {
    try {
      await registrarSaldoExtrato(e.conta.id, e.saldo_final.data, Number(e.saldo_final.saldo), importacaoId);
      saldoRegistrado = { data: e.saldo_final.data, saldo: Number(e.saldo_final.saldo) };
    } catch (err) {
      console.error('[financeiro/importar] saldo do extrato nao registrado:', err);
    }
  }

  // 7. Conciliacao automatica do periodo do arquivo. Falha aqui nao desfaz a
  //    importacao: as linhas ja estao no banco e a tela pode rodar de novo.
  let conciliacao: ResultadoImportacao['conciliacao'] = null;
  try {
    const r = await conciliar({ conta_id: e.conta.id, de: periodo[0], ate: periodo[1], aplicar: true });
    conciliacao = { conciliados: r.totais.conciliadas_agora, sugestoes: r.totais.sugestoes, cartao_agregado_dias: r.cartao_agregado.length };
  } catch (err) {
    console.error('[financeiro/importar] conciliacao automatica falhou:', err);
  }

  return {
    importacao_id: importacaoId,
    conta: e.conta.nome,
    periodo,
    total: lancs.length,
    novos: inseridos,
    duplicados: lancs.length - semHash.length,
    duplicados_por_conteudo: duplicadosPorConteudo,
    classificados_por_regra: inseridos - porIA - semCategoria,
    classificados_por_ia: porIA,
    sem_categoria: semCategoria,
    a_revisar: porIA + semCategoria,
    ignoradas: e.ignoradas ?? [],
    conciliacao,
    saldo_registrado: saldoRegistrado,
    ...(inseridos === 0 ? { mensagem: 'Nada novo: todos os lançamentos deste arquivo já estavam importados.' } : {}),
  };
}
