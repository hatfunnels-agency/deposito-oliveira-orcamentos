// Venda fechada pela IA no WhatsApp. SERVER-ONLY.
//
// O robo nao cria pedido: quando o cliente fecha, ele devolve a acao
// `venda_fechada` com os itens. Aqui os itens sao casados com o catalogo e
// vira um caso no kanban do atendimento (motivo 'venda_fechada') para a
// atendente lancar no sistema com um clique (/?lancar=<caso>).
import { supabaseAdmin } from '@/lib/supabase';
import { normalizar } from '@/lib/categorizacao';

export interface ItemVendaIA {
  descricao: string;            // como a IA escreveu
  quantidade: number;
  unidade: string | null;
  produto_id: string | null;    // casado com o catalogo (null = nao achou)
  produto_nome: string | null;
  preco: number | null;         // preco de venda do catalogo
  confianca: number;            // 0..1 do casamento
}

export interface DadosVendaIA {
  itens: ItemVendaIA[];
  total_estimado: number | null;
  entrega: 'entrega' | 'retirada' | null;
  endereco: string | null;
  pagamento: string | null;
  observacao: string | null;
}

export interface AcaoVendaFechada {
  tipo: 'venda_fechada';
  itens?: Array<{ produto?: unknown; quantidade?: unknown; unidade?: unknown }>;
  entrega?: unknown;
  endereco?: unknown;
  pagamento?: unknown;
  resumo?: unknown;
}

const VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'SEM', 'PARA', 'POR', 'UN', 'UND', 'SACO', 'SACOS', 'UNIDADE', 'UNIDADES']);
const tokens = (s: unknown): string[] =>
  normalizar(String(s ?? '')).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(t => t.length >= 2 && !VAZIAS.has(t));

function pontuar(descricao: string, nome: string): number {
  const td = tokens(descricao);
  const tp = tokens(nome);
  if (!td.length || !tp.length) return 0;
  const setD = new Set(td);
  const casa = (t: string) => setD.has(t) || td.some(d => d.length >= 4 && t.length >= 4 && d.slice(0, 4) === t.slice(0, 4));
  const acertos = tp.filter(casa).length;
  if (!acertos) return 0;
  // Nome exato (todos os tokens dos dois lados) vale 1.
  const s = (acertos / tp.length) * 0.7 + (acertos / td.length) * 0.3;
  return Math.min(1, Math.round(s * 100) / 100);
}

/** Casa os itens que a IA descreveu com o catalogo (produtos ativos e vendaveis). */
export async function casarItensComCatalogo(itens: AcaoVendaFechada['itens']): Promise<ItemVendaIA[]> {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return [];
  const { data: produtos } = await supabaseAdmin
    .from('produtos')
    .select('id, nome, unidade_venda, preco_venda')
    .eq('ativo', true)
    .neq('vendavel', false)
    .limit(1000);
  const cat = (produtos ?? []) as Array<{ id: string; nome: string; unidade_venda: string; preco_venda: number | string }>;

  return lista.map(it => {
    const descricao = String(it?.produto ?? '').trim().slice(0, 120);
    const qtd = Number(String(it?.quantidade ?? '').replace(',', '.'));
    let melhor: { p: (typeof cat)[number]; s: number } | null = null;
    for (const p of cat) {
      const s = pontuar(descricao, p.nome);
      if (s > 0 && (!melhor || s > melhor.s)) melhor = { p, s };
    }
    const ok = melhor && melhor.s >= 0.5 ? melhor : null;
    return {
      descricao,
      quantidade: Number.isFinite(qtd) && qtd > 0 ? Math.round(qtd * 1000) / 1000 : 1,
      unidade: it?.unidade ? String(it.unidade).slice(0, 20) : ok?.p.unidade_venda ?? null,
      produto_id: ok?.p.id ?? null,
      produto_nome: ok?.p.nome ?? null,
      preco: ok ? Number(ok.p.preco_venda) || null : null,
      confianca: melhor?.s ?? 0,
    };
  }).filter(i => i.descricao);
}

function textoResumo(d: DadosVendaIA): string {
  const partes = d.itens.map(i => `${i.quantidade}${i.unidade ? ' ' + i.unidade : 'x'} ${i.produto_nome ?? i.descricao}${i.produto_id ? '' : ' (?)'}`);
  const linha = [
    partes.join(', '),
    d.entrega === 'entrega' ? `entrega${d.endereco ? ' em ' + d.endereco : ''}` : d.entrega === 'retirada' ? 'retirada na loja' : '',
    d.pagamento ? `pagamento: ${d.pagamento}` : '',
    d.total_estimado !== null ? `~R$ ${d.total_estimado.toFixed(2).replace('.', ',')}` : '',
  ].filter(Boolean).join(' · ');
  return linha.slice(0, 500);
}

/**
 * Abre o caso "venda fechada pela IA" no kanban. Funciona mesmo sem cadastro
 * (lead de anuncio): o caso fica pelo telefone. Devolve o texto para o log.
 */
export async function abrirVendaIA(acao: AcaoVendaFechada, ctx: {
  clienteId: string | null; telefone: string; orcamentoId: string | null; origem: string;
}): Promise<string> {
  const itens = await casarItensComCatalogo(acao.itens);
  const entregaRaw = normalizar(String(acao.entrega ?? ''));
  const entrega: DadosVendaIA['entrega'] = entregaRaw.startsWith('ENTREG') ? 'entrega' : entregaRaw.startsWith('RETIR') ? 'retirada' : null;
  const total = itens.reduce((s, i) => (i.preco !== null ? s + i.preco * i.quantidade : s), 0);
  const dados: DadosVendaIA = {
    itens,
    total_estimado: itens.length && itens.every(i => i.preco !== null) ? Math.round(total * 100) / 100 : null,
    entrega,
    endereco: acao.endereco ? String(acao.endereco).slice(0, 200) : null,
    pagamento: acao.pagamento ? String(acao.pagamento).slice(0, 60) : null,
    observacao: acao.resumo ? String(acao.resumo).slice(0, 300) : null,
  };
  // Mesma venda repetida pelo robo (cliente confirmou duas vezes): nao abre
  // dois casos — atualiza o aberto das ultimas 6 horas.
  const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
  let q = supabaseAdmin.from('atendimento_fila').select('id').eq('motivo', 'venda_fechada').eq('status', 'aberto').gte('criado_em', desde);
  q = ctx.clienteId ? q.eq('cliente_id', ctx.clienteId) : q.eq('telefone', ctx.telefone);
  const { data: existente } = await q.limit(1);
  const caso = {
    cliente_id: ctx.clienteId, orcamento_id: ctx.orcamentoId, telefone: ctx.telefone,
    motivo: 'venda_fechada', resumo: textoResumo(dados), origem: ctx.origem, status: 'aberto', dados,
  };
  if (existente && existente.length) {
    const { error } = await supabaseAdmin.from('atendimento_fila').update({ resumo: caso.resumo, dados }).eq('id', existente[0].id);
    return error ? `falha ao atualizar venda da IA: ${error.message}` : 'venda da IA atualizada no kanban';
  }
  const { error } = await supabaseAdmin.from('atendimento_fila').insert(caso);
  if (error) return `falha ao abrir venda da IA no kanban: ${error.message}`;
  const semCatalogo = itens.filter(i => !i.produto_id).length;
  return `venda da IA no kanban (${itens.length} item(ns)${semCatalogo ? `, ${semCatalogo} fora do catalogo` : ''})`;
}
