// Estoque na gestao: painel (valor, giro, cobertura) e movimentos manuais
// (entrada, perda, ajuste, contagem). SERVER-ONLY.
//
// Regras herdadas do resto do app:
// - Estoque mora no produto PRINCIPAL: quem tem estoque_compartilhado_com
//   aponta para ele. Leitura e gravacao sempre resolvem o principal.
// - estoque_atual e em unidade de ESTOQUE; a venda converte com o
//   fator_conversao do PRINCIPAL (igual a aplicarBaixaItem em
//   src/lib/estoque-baixa.ts).
// - preco_custo e por unidade de VENDA. Custo por unidade de estoque =
//   preco_custo / fator.
// - Toda mudanca de saldo grava uma linha em movimentacoes_estoque junto
//   com o update de produtos.estoque_atual.
//
// O controle comeca agora: quase todo saldo e 0 porque nunca houve
// contagem. Ate a primeira 'contagem' de um produto o saldo dele nao
// significa nada — o painel marca isso (ultima_contagem = null).

import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo, lerTudoEmLotes } from '@/lib/ler-tudo';
import type {
  ItemPainelEstoque, MovimentoEstoque, NovoMovimentoEstoque, PainelEstoque, ResultadoMovimentoEstoque,
  TipoMovimentoEstoque, TotaisEstoque, ProdutoSobDemanda, ReposicaoEstoque,
} from './tipos';
import { arred2, diaSemana, hojeSP, somarDias } from './datas';
import { ErroFinanceiro, registrarEvento } from './eventos';

// Pedido que conta como venda (mesmo criterio do CMV: tudo menos
// orcamento aberto e cancelado).
const STATUS_NAO_VENDA = ['orcamento', 'cancelado'];
const MS_DIA = 24 * 3600 * 1000;

export const TIPOS_MOVIMENTO: TipoMovimentoEstoque[] = ['entrada', 'ajuste', 'perda', 'contagem'];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Quantidade de estoque com 3 casas (coluna numeric com 3 decimais). */
const arred3 = (n: number): number => {
  const r = Math.round((Number(n) || 0) * 1000) / 1000;
  return r === 0 ? 0 : r;
};

interface ProdutoRow {
  id: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  unidade_venda: string;
  fator_conversao: number | string | null;
  preco_custo: number | string | null;
  estoque_atual: number | string | null;
  estoque_minimo: number | string | null;
  ativo: boolean | null;
  tipo_estoque: string | null;
  estoque_compartilhado_com: string | null;
  prazo_entrega_dias?: number | null;
  baixa_estoque_em_produto_id?: string | null;
  baixa_estoque_fator?: number | string | null;
  tipo_ferro?: string | null;
}

// ------------------------------------------------------------ reposicao

// Previsao de compra pelo ritmo de venda. O deposito funciona de segunda a
// sabado: o consumo e por dia de funcionamento e as datas pulam domingo.
const DIAS_SEGURANCA = 3;        // entrega rapida: pedir quando sobrar o equivalente a 3 dias de venda (ou o minimo, se maior)
const DIAS_COBERTURA_PEDIDO = 12; // o pedido cobre 2 semanas de funcionamento
const DIAS_UTEIS_30 = 26;         // dias de funcionamento em 30 corridos (aprox.)

/** Soma n dias de funcionamento (seg-sab) a uma data. */
function somarDiasUteis(data: string, n: number): string {
  let d = data;
  let resta = Math.max(0, Math.floor(n));
  while (resta > 0) {
    d = somarDias(d, 1);
    if (diaSemana(d) !== 0) resta--;
  }
  return diaSemana(d) === 0 ? somarDias(d, 1) : d;
}

/** Prazo em dias corridos -> dias de funcionamento (seg-sab). */
const prazoUteis = (dias: number) => Math.ceil((dias * 6) / 7);

/**
 * Com prazo de entrega P, pede quando o saldo cobre 2 x P (o que vende
 * enquanto o pedido nao chega, mais a mesma folga). Ferro: 1 semana de prazo
 * -> pedir com 2 semanas de estoque. Sem prazo: 3 dias de venda. O minimo
 * cadastrado vale se for maior.
 */
export function calcularReposicao(
  estoque: number, minimo: number, vendido30: number, hoje: string, prazoDias: number | null,
): ReposicaoEstoque | null {
  const consumo = vendido30 / DIAS_UTEIS_30;
  if (consumo <= 0) return null;
  const prazo = prazoDias && prazoDias > 0 ? prazoUteis(prazoDias) : 0;
  const cobertura = prazo > 0 ? Math.max(DIAS_SEGURANCA, 2 * prazo) : DIAS_SEGURANCA;
  const minimoSugerido = consumo * cobertura;
  const pontoPedido = Math.max(minimo, minimoSugerido);
  const saldo = Math.max(0, estoque);
  const diasAtePedido = (saldo - pontoPedido) / consumo;
  const diasAteAcabar = saldo / consumo;
  const pedirEm = diasAtePedido <= 0 ? hoje : somarDiasUteis(hoje, diasAtePedido);
  const saldoNoPedido = Math.max(0, Math.min(saldo, pontoPedido));
  // Quantidade: o que vende ate chegar + 2 semanas depois, menos o que ainda tem.
  const sugerido = consumo * (prazo + DIAS_COBERTURA_PEDIDO) - saldoNoPedido + (pontoPedido - consumo * prazo);
  return {
    consumo_dia: arred3(consumo),
    cobertura_pedido_dias: cobertura,
    ponto_pedido: arred3(pontoPedido),
    minimo_sugerido: arred3(minimoSugerido),
    pedir_em: pedirEm,
    acaba_em: somarDiasUteis(hoje, diasAteAcabar),
    chega_em: prazo > 0 ? somarDiasUteis(pedirEm, prazo) : null,
    falta_antes_de_chegar: prazo > 0 && diasAteAcabar < prazo,
    dias_ate_pedido: Math.round(diasAtePedido * 10) / 10,
    sugerido: Math.ceil(Math.max(0, sugerido) * 10) / 10,
  };
}

// ------------------------------------------------------------ painel

export async function painelEstoque(): Promise<PainelEstoque> {
  const agora = Date.now();
  const desde90 = new Date(agora - 90 * MS_DIA).toISOString();
  const desde30 = new Date(agora - 30 * MS_DIA).toISOString();

  const [produtos, pedidos, movs] = await Promise.all([
    lerTudo<ProdutoRow>(() => supabaseAdmin
      .from('produtos')
      .select('id, nome, categoria, unidade, unidade_venda, fator_conversao, preco_custo, estoque_atual, estoque_minimo, ativo, tipo_estoque, estoque_compartilhado_com, prazo_entrega_dias, baixa_estoque_em_produto_id, baixa_estoque_fator, tipo_ferro')),
    lerTudo<{ id: string; criado_em: string }>(() => supabaseAdmin
      .from('orcamentos')
      .select('id, criado_em')
      .not('status', 'in', `(${STATUS_NAO_VENDA.join(',')})`)
      .gte('criado_em', desde90)),
    lerTudo<{ produto_id: string; tipo: string; criado_em: string }>(() => supabaseAdmin
      .from('movimentacoes_estoque')
      .select('id, produto_id, tipo, criado_em')
      .in('tipo', ['entrada', 'contagem'])),
  ]);

  const itensVenda = await lerTudoEmLotes<{ id: string; orcamento_id: string; produto_id: string | null; quantidade: number | string }>(
    pedidos.map(p => String(p.id)),
    lote => supabaseAdmin.from('orcamento_itens').select('id, orcamento_id, produto_id, quantidade').in('orcamento_id', lote),
  );

  // Ferro feito na calculadora: item sem produto, consumo em metros por tipo de ferro.
  const itensAvulsos = itensVenda.filter(i => !i.produto_id).map(i => String(i.id));
  const consumoFerro = await lerTudoEmLotes<{ orcamento_item_id: string; tipo_ferro: string; metros: number | string }>(
    itensAvulsos,
    lote => supabaseAdmin.from('ferragem_consumo').select('orcamento_item_id, tipo_ferro, metros').in('orcamento_item_id', lote),
  );

  const porId = new Map(produtos.map(p => [p.id, p]));
  const principalDe = (id: string): string => porId.get(id)?.estoque_compartilhado_com || id;
  const criadoPedido = new Map(pedidos.map(p => [String(p.id), p.criado_em]));
  const pedidoDoItem = new Map(itensVenda.map(i => [String(i.id), String(i.orcamento_id)]));
  const produtoDoTipoFerro = new Map(produtos.filter(p => p.tipo_ferro).map(p => [String(p.tipo_ferro), p.id]));

  // Vendido que ja chega em unidade de ESTOQUE do produto que baixa (mesma
  // regra de src/lib/baixa-ferro.ts): barra -> metro (x baixa_estoque_fator)
  // e metros da calculadora de ferragem.
  const direto30 = new Map<string, number>();
  const direto90 = new Map<string, number>();
  const somarDireto = (pid: string, qtd: number, orcamentoId: string | undefined) => {
    direto90.set(pid, (direto90.get(pid) ?? 0) + qtd);
    const criado = orcamentoId ? criadoPedido.get(orcamentoId) : undefined;
    if (criado && criado >= desde30) direto30.set(pid, (direto30.get(pid) ?? 0) + qtd);
  };
  for (const c of consumoFerro) {
    const pid = produtoDoTipoFerro.get(String(c.tipo_ferro));
    const m = num(c.metros);
    if (pid && m > 0) somarDireto(principalDe(pid), m, pedidoDoItem.get(String(c.orcamento_item_id)));
  }

  // Vendido em unidade de VENDA, ja no principal; converte no fim com o
  // fator do principal (o mesmo que a baixa usa).
  const vendido30 = new Map<string, number>();
  const vendido90 = new Map<string, number>();
  for (const it of itensVenda) {
    if (!it.produto_id) continue;
    const qtd = num(it.quantidade);
    if (qtd <= 0) continue;
    const prod = porId.get(it.produto_id);
    if (prod?.baixa_estoque_em_produto_id) {
      somarDireto(principalDe(prod.baixa_estoque_em_produto_id), qtd * (num(prod.baixa_estoque_fator) || 1), String(it.orcamento_id));
      continue;
    }
    const pid = principalDe(it.produto_id);
    vendido90.set(pid, (vendido90.get(pid) ?? 0) + qtd);
    const criado = criadoPedido.get(String(it.orcamento_id));
    if (criado && criado >= desde30) vendido30.set(pid, (vendido30.get(pid) ?? 0) + qtd);
  }

  const ultimaEntrada = new Map<string, string>();
  const ultimaContagem = new Map<string, string>();
  for (const m of movs) {
    const pid = principalDe(m.produto_id);
    const alvo = m.tipo === 'contagem' ? ultimaContagem : ultimaEntrada;
    const atual = alvo.get(pid);
    if (!atual || m.criado_em > atual) alvo.set(pid, m.criado_em);
  }

  const secundarios = new Map<string, string[]>();
  for (const p of produtos) {
    if (p.ativo === false) continue;
    const alvo = p.estoque_compartilhado_com || p.baixa_estoque_em_produto_id;
    if (!alvo) continue;
    const lista = secundarios.get(alvo) ?? [];
    lista.push(p.baixa_estoque_em_produto_id && !p.estoque_compartilhado_com
      ? `${p.nome} (baixa ${String(num(p.baixa_estoque_fator) || 1).replace('.', ',')} ${porId.get(alvo)?.unidade ?? ''})`.replace(/ \)$/, ')')
      : p.nome);
    secundarios.set(alvo, lista);
  }

  const itens: ItemPainelEstoque[] = [];
  const sobDemanda: ProdutoSobDemanda[] = [];
  const excluidos: ProdutoSobDemanda[] = [];
  const hoje = hojeSP();
  for (const p of produtos) {
    if (p.estoque_compartilhado_com) continue;          // secundario: aparece no principal
    if (p.baixa_estoque_em_produto_id) continue;        // baixa de outro produto (ex.: barra -> metro de ferro)
    if (p.ativo === false) {
      excluidos.push({ produto_id: p.id, nome: p.nome, categoria: p.categoria ?? null, unidade: p.unidade, vendido_90d: 0 });
      continue;
    }
    if ((p.tipo_estoque ?? 'estocavel') !== 'estocavel') {
      sobDemanda.push({
        produto_id: p.id, nome: p.nome, categoria: p.categoria ?? null, unidade: p.unidade,
        vendido_90d: arred3((vendido90.get(p.id) ?? 0) * (num(p.fator_conversao) || 1)),
      });
      continue;
    }
    const fator = num(p.fator_conversao) || 1;
    const estoque = arred3(num(p.estoque_atual));
    const precoCusto = num(p.preco_custo);
    const custoUnit = precoCusto / fator;
    const v30 = arred3((vendido30.get(p.id) ?? 0) * fator + (direto30.get(p.id) ?? 0));
    const v90 = arred3((vendido90.get(p.id) ?? 0) * fator + (direto90.get(p.id) ?? 0));
    const mediaDia = v30 / 30;
    const minimo = num(p.estoque_minimo);
    itens.push({
      produto_id: p.id,
      nome: p.nome,
      categoria: p.categoria ?? null,
      unidade: p.unidade,
      unidade_venda: p.unidade_venda,
      fator_conversao: fator,
      estoque_atual: estoque,
      estoque_minimo: minimo,
      preco_custo: precoCusto,
      custo_unitario: Math.round(custoUnit * 10000) / 10000,
      valor_estoque: arred2(Math.max(0, estoque) * custoUnit),
      vendido_30d: v30,
      vendido_90d: v90,
      venda_media_dia_30d: Math.round(mediaDia * 1000) / 1000,
      giro_90d: estoque > 0 ? Math.round((v90 / estoque) * 100) / 100 : null,
      cobertura_dias: mediaDia > 0 ? Math.round((Math.max(0, estoque) / mediaDia) * 10) / 10 : null,
      ultima_entrada: ultimaEntrada.get(p.id) ?? null,
      ultima_contagem: ultimaContagem.get(p.id) ?? null,
      abaixo_minimo: minimo > 0 && estoque < minimo,
      zerado: estoque <= 0,
      sem_venda_90d: v90 <= 0,
      secundarios: (secundarios.get(p.id) ?? []).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      // Sem contagem o saldo nao vale, entao nao ha previsao.
      prazo_entrega_dias: p.prazo_entrega_dias == null ? null : Number(p.prazo_entrega_dias),
      reposicao: ultimaContagem.has(p.id) ? calcularReposicao(estoque, minimo, v30, hoje, p.prazo_entrega_dias == null ? null : Number(p.prazo_entrega_dias)) : null,
    });
  }
  itens.sort((a, b) => b.valor_estoque - a.valor_estoque || b.vendido_90d - a.vendido_90d || a.nome.localeCompare(b.nome, 'pt-BR'));

  const totais: TotaisEstoque = {
    itens: itens.length,
    valor_estoque: arred2(itens.reduce((s, i) => s + i.valor_estoque, 0)),
    zerados: itens.filter(i => i.zerado).length,
    abaixo_minimo: itens.filter(i => i.abaixo_minimo).length,
    sem_venda_90d: itens.filter(i => i.sem_venda_90d).length,
    contados: itens.filter(i => i.ultima_contagem).length,
    nunca_contados: itens.filter(i => !i.ultima_contagem).length,
  };
  const categorias = [...new Set(itens.map(i => i.categoria || 'Geral'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  sobDemanda.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  excluidos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return { gerado_em: new Date(agora).toISOString(), hoje, itens, sob_demanda: sobDemanda, excluidos, totais, categorias };
}

// ------------------------------------------------------------ excluir

/**
 * "Excluir" arquiva (ativo = false): o produto some do catalogo, do
 * orcamento e do estoque, mas pedidos antigos, historico de custo e
 * movimentacoes continuam apontando para ele (apagar de verdade quebraria
 * o historico e a FK de movimentacoes_estoque). Recusa se houver produto
 * ativo compartilhando o estoque dele.
 */
export async function definirAtivo(produtoId: string, ativo: boolean, usuarioId: string | null): Promise<{ produto_id: string; ativo: boolean }> {
  const { data: p } = await supabaseAdmin.from('produtos').select('id, nome, ativo').eq('id', produtoId).maybeSingle();
  if (!p) throw new ErroFinanceiro(404, 'Produto não encontrado.');
  if ((p.ativo !== false) === ativo) return { produto_id: p.id, ativo };
  if (!ativo) {
    const { data: dependentes } = await supabaseAdmin.from('produtos').select('nome').eq('estoque_compartilhado_com', p.id).eq('ativo', true);
    if (dependentes && dependentes.length) {
      throw new ErroFinanceiro(409, `${dependentes.map(d => d.nome).join(', ')} usa o estoque de ${p.nome}. Exclua ${dependentes.length > 1 ? 'esses produtos' : 'esse produto'} antes.`);
    }
  }
  const { error } = await supabaseAdmin.from('produtos').update({ ativo }).eq('id', p.id);
  if (error) throw new Error(error.message);
  await registrarEvento({
    entidade: 'estoque', entidade_id: p.id, acao: ativo ? 'restaurar_produto' : 'excluir_produto',
    antes: { ativo: !ativo }, depois: { ativo, nome: p.nome }, usuario_id: usuarioId,
  });
  return { produto_id: p.id, ativo };
}

// ------------------------------------------------------------ prazo de entrega

/** Prazo de entrega do fornecedor (dias corridos). null/0 = entrega rapida. */
export async function definirPrazoEntrega(produtoId: string, dias: number | null, usuarioId: string | null): Promise<{ produto_id: string; prazo_entrega_dias: number | null }> {
  const { principal } = await resolverPrincipal(produtoId);
  const valor = dias === null || !Number.isFinite(dias) || dias <= 0 ? null : Math.min(120, Math.round(dias));
  const { data: antes } = await supabaseAdmin.from('produtos').select('prazo_entrega_dias').eq('id', principal.id).maybeSingle();
  const { error } = await supabaseAdmin.from('produtos').update({ prazo_entrega_dias: valor }).eq('id', principal.id);
  if (error) throw new Error(error.message);
  await registrarEvento({
    entidade: 'estoque', entidade_id: principal.id, acao: 'prazo_entrega',
    antes: { prazo_entrega_dias: antes?.prazo_entrega_dias ?? null }, depois: { prazo_entrega_dias: valor }, usuario_id: usuarioId,
  });
  return { produto_id: principal.id, prazo_entrega_dias: valor };
}

// ------------------------------------------------------------ sob demanda

/**
 * Marca o produto como estocavel ou sob demanda (pedido ao fornecedor so
 * quando vende: a venda soma em total_vendido e nao baixa estoque). Vale
 * para o principal e todos os secundarios que compartilham o estoque, que
 * herdam o tipo. Para virar sob demanda o saldo tem que estar em zero, senao
 * o estoque some do painel sem baixa registrada.
 */
export async function definirTipoEstoque(
  produtoId: string, tipo: 'estocavel' | 'sob_demanda', usuarioId: string | null,
): Promise<{ produto_id: string; tipo_estoque: 'estocavel' | 'sob_demanda'; afetados: number }> {
  const { principal } = await resolverPrincipal(produtoId);
  const anterior = (principal.tipo_estoque ?? 'estocavel') as 'estocavel' | 'sob_demanda';
  if (anterior === tipo) return { produto_id: principal.id, tipo_estoque: tipo, afetados: 0 };
  if (tipo === 'sob_demanda' && num(principal.estoque_atual) !== 0) {
    throw new ErroFinanceiro(409, `${principal.nome} tem ${num(principal.estoque_atual)} ${principal.unidade} em estoque. Faça uma contagem zerando antes de marcar como sob demanda.`);
  }
  const { data, error } = await supabaseAdmin
    .from('produtos')
    .update({ tipo_estoque: tipo })
    .or(`id.eq.${principal.id},estoque_compartilhado_com.eq.${principal.id}`)
    .select('id');
  if (error) throw new Error(error.message);
  await registrarEvento({
    entidade: 'estoque', entidade_id: principal.id, acao: 'tipo_estoque',
    antes: { tipo_estoque: anterior }, depois: { tipo_estoque: tipo, produtos: (data ?? []).map(r => r.id) },
    usuario_id: usuarioId,
  });
  return { produto_id: principal.id, tipo_estoque: tipo, afetados: (data ?? []).length };
}

// ------------------------------------------------------------ historico

export async function historicoMovimentos(produtoId: string, limite = 30): Promise<MovimentoEstoque[]> {
  const { principal } = await resolverPrincipal(produtoId);
  const { data, error } = await supabaseAdmin
    .from('movimentacoes_estoque')
    .select('id, produto_id, tipo, quantidade, estoque_anterior, estoque_novo, referencia_tipo, referencia_id, observacoes, criado_em')
    .eq('produto_id', principal.id)
    .order('criado_em', { ascending: false })
    .limit(Math.min(100, Math.max(1, limite)));
  if (error) throw new Error(error.message);
  return (data || []).map(normalizarMovimento);
}

function normalizarMovimento(r: Record<string, unknown>): MovimentoEstoque {
  return {
    id: String(r.id),
    produto_id: String(r.produto_id),
    tipo: String(r.tipo),
    quantidade: num(r.quantidade),
    estoque_anterior: num(r.estoque_anterior),
    estoque_novo: num(r.estoque_novo),
    referencia_tipo: (r.referencia_tipo as string | null) ?? null,
    referencia_id: (r.referencia_id as string | null) ?? null,
    observacoes: (r.observacoes as string | null) ?? null,
    criado_em: String(r.criado_em),
  };
}

// ------------------------------------------------------------ movimento

async function resolverPrincipal(produtoId: string): Promise<{ informado: ProdutoRow; principal: ProdutoRow }> {
  const campos = 'id, nome, categoria, unidade, unidade_venda, fator_conversao, preco_custo, estoque_atual, estoque_minimo, ativo, tipo_estoque, estoque_compartilhado_com, baixa_estoque_em_produto_id, baixa_estoque_fator';
  const { data: informado } = await supabaseAdmin.from('produtos').select(campos).eq('id', produtoId).maybeSingle();
  if (!informado) throw new ErroFinanceiro(404, 'Produto não encontrado.');
  const p = informado as ProdutoRow;
  if (!p.estoque_compartilhado_com) return { informado: p, principal: p };
  const { data: principal } = await supabaseAdmin.from('produtos').select(campos).eq('id', p.estoque_compartilhado_com).maybeSingle();
  return { informado: p, principal: (principal as ProdutoRow | null) ?? p };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Registra entrada, perda, ajuste ou contagem.
 *
 * - entrada: soma (quantidade > 0). Com custo_unitario (por unidade de
 *   estoque) diferente do atual, atualiza preco_custo do produto INFORMADO
 *   e grava em historico_custos — o produto escolhido e o que a nota
 *   precifica (secundarios como "s/ entrega" tem custo proprio), enquanto o
 *   saldo vai para o principal.
 * - perda: subtrai (quantidade > 0, motivo obrigatorio).
 * - ajuste: soma com sinal (quantidade != 0, motivo obrigatorio).
 * - contagem: DEFINE o saldo contado (>= 0) e grava a diferenca.
 *
 * Perda/ajuste que deixariam o saldo negativo sao recusados: o caminho e
 * contar. O update e condicional ao saldo lido (eq estoque_atual): se uma
 * venda mexeu no meio, devolve 409 em vez de sobrescrever.
 */
export async function registrarMovimento(
  entrada: NovoMovimentoEstoque & { usuarioId?: string | null },
): Promise<ResultadoMovimentoEstoque> {
  const tipo = entrada.tipo;
  if (!TIPOS_MOVIMENTO.includes(tipo)) throw new ErroFinanceiro(400, 'Tipo de movimento inválido.');
  const qtd = Number(entrada.quantidade);
  if (!Number.isFinite(qtd)) throw new ErroFinanceiro(400, 'Quantidade inválida.');
  const motivo = String(entrada.motivo ?? '').trim();
  if ((tipo === 'entrada' || tipo === 'perda') && qtd <= 0) throw new ErroFinanceiro(400, 'Informe uma quantidade maior que zero.');
  if (tipo === 'ajuste' && qtd === 0) throw new ErroFinanceiro(400, 'Ajuste de zero não muda nada.');
  if (tipo === 'contagem' && qtd < 0) throw new ErroFinanceiro(400, 'Contagem não pode ser negativa.');
  if ((tipo === 'perda' || tipo === 'ajuste') && !motivo) throw new ErroFinanceiro(400, 'Informe o motivo.');
  const custoInformado = entrada.custo_unitario === null || entrada.custo_unitario === undefined ? null : Number(entrada.custo_unitario);
  if (custoInformado !== null && (!Number.isFinite(custoInformado) || custoInformado < 0)) throw new ErroFinanceiro(400, 'Custo unitário inválido.');
  const refId = entrada.referencia_id ? String(entrada.referencia_id) : null;
  if (refId && !UUID.test(refId)) throw new ErroFinanceiro(400, 'referencia_id inválido.');

  const { informado, principal } = await resolverPrincipal(String(entrada.produto_id));
  // Barra/estribo pronto baixam de outro produto (ferro em metro): o saldo
  // so existe la. Entrada, perda e contagem vao direto no produto em metro.
  if (informado.baixa_estoque_em_produto_id) {
    const { data: alvo } = await supabaseAdmin.from('produtos').select('nome, unidade').eq('id', informado.baixa_estoque_em_produto_id).maybeSingle();
    const fator = num(informado.baixa_estoque_fator) || 1;
    throw new ErroFinanceiro(400, `O estoque de "${informado.nome}" é controlado em ${alvo?.nome ?? 'outro produto'} (1 ${informado.unidade} = ${String(fator).replace('.', ',')} ${alvo?.unidade ?? ''}). Lance lá, convertendo a quantidade.`);
  }
  if ((principal.tipo_estoque ?? 'estocavel') !== 'estocavel') {
    throw new ErroFinanceiro(400, `"${principal.nome}" é sob demanda e não controla estoque. Mude para estocável no cadastro do produto.`);
  }

  const anterior = arred3(num(principal.estoque_atual));
  let novo: number;
  switch (tipo) {
    case 'entrada': novo = anterior + qtd; break;
    case 'perda': novo = anterior - qtd; break;
    case 'ajuste': novo = anterior + qtd; break;
    case 'contagem': novo = qtd; break;
    default: throw new ErroFinanceiro(400, 'Tipo de movimento inválido.');
  }
  novo = arred3(novo);
  if (novo < 0) {
    throw new ErroFinanceiro(400, `O estoque ficaria negativo (atual: ${anterior.toLocaleString('pt-BR')} ${principal.unidade}). Faça uma contagem.`);
  }
  const diferenca = arred3(novo - anterior);

  const { data: atualizados, error: updErr } = await supabaseAdmin
    .from('produtos')
    .update({ estoque_atual: novo, atualizado_em: new Date().toISOString() })
    .eq('id', principal.id)
    .eq('estoque_atual', anterior)
    .select('id');
  if (updErr) throw new Error(updErr.message);
  if (!atualizados || atualizados.length === 0) {
    throw new ErroFinanceiro(409, 'O estoque mudou enquanto você lançava (provavelmente uma venda). Abra de novo e confira.');
  }

  const partes: string[] = [];
  if (tipo === 'contagem') partes.push(`Contagem: ${novo.toLocaleString('pt-BR')} ${principal.unidade} (antes ${anterior.toLocaleString('pt-BR')})`);
  if (informado.id !== principal.id) partes.push(`via ${informado.nome}`);
  if (motivo) partes.push(motivo);

  const { data: mov, error: movErr } = await supabaseAdmin
    .from('movimentacoes_estoque')
    .insert({
      produto_id: principal.id,
      tipo,
      // Convencao do app: quantidade positiva; o sentido sai de anterior/novo.
      quantidade: tipo === 'entrada' || tipo === 'perda' ? arred3(qtd) : Math.abs(diferenca),
      estoque_anterior: anterior,
      estoque_novo: novo,
      referencia_tipo: entrada.referencia_tipo ? String(entrada.referencia_tipo) : null,
      referencia_id: refId,
      observacoes: partes.join(' — ') || null,
    })
    .select('id, produto_id, tipo, quantidade, estoque_anterior, estoque_novo, referencia_tipo, referencia_id, observacoes, criado_em')
    .single();
  if (movErr) {
    // Saldo ja mudou e nao ha transacao: loga alto. A causa mais provavel e
    // a CHECK antiga sem 'perda'/'contagem' (migration nao aplicada) —
    // nesse caso desfaz o saldo para nao ficar sem trilha.
    console.error('[financeiro/estoque] insert movimentacao falhou:', movErr);
    await supabaseAdmin.from('produtos').update({ estoque_atual: anterior }).eq('id', principal.id).eq('estoque_atual', novo);
    if (/check/i.test(movErr.message)) {
      throw new ErroFinanceiro(500, 'O banco ainda não aceita este tipo de movimento. Aplique a migration 20261017_estoque_gestao_e_densidade.sql.');
    }
    throw new Error(movErr.message);
  }

  // Custo: so na entrada com custo informado diferente do atual.
  let custoAtualizado: ResultadoMovimentoEstoque['custo_atualizado'] = null;
  if (tipo === 'entrada' && custoInformado !== null) {
    const fator = num(informado.fator_conversao) || 1;
    const custoNovo = Math.round(custoInformado * fator * 100) / 100;   // por unidade de venda
    const custoAnterior = num(informado.preco_custo);
    if (Math.abs(custoNovo - custoAnterior) >= 0.005) {
      const { error: custoErr } = await supabaseAdmin
        .from('produtos')
        .update({ preco_custo: custoNovo, atualizado_em: new Date().toISOString() })
        .eq('id', informado.id);
      if (custoErr) {
        console.error('[financeiro/estoque] update preco_custo falhou (estoque ja lancado):', custoErr);
      } else {
        custoAtualizado = { produto_id: informado.id, anterior: custoAnterior, novo: custoNovo };
        const { error: histErr } = await supabaseAdmin.from('historico_custos').insert({
          produto_id: informado.id,
          usuario_id: entrada.usuarioId ?? null,
          custo_anterior: custoAnterior,
          custo_novo: custoNovo,
        });
        if (histErr) console.error('[financeiro/estoque] historico_custos falhou (custo ja atualizado):', histErr);
      }
    }
  }

  const movimento = normalizarMovimento(mov as Record<string, unknown>);
  await registrarEvento({
    entidade: 'estoque',
    entidade_id: principal.id,
    acao: tipo,
    antes: { estoque: anterior, ...(custoAtualizado ? { preco_custo: custoAtualizado.anterior } : {}) },
    depois: {
      estoque: novo, diferenca, movimento_id: movimento.id, produto_informado: informado.id,
      referencia_tipo: movimento.referencia_tipo, referencia_id: movimento.referencia_id,
      ...(custoAtualizado ? { preco_custo: custoAtualizado.novo } : {}),
    },
    usuario_id: entrada.usuarioId ?? null,
  });

  return {
    movimento,
    produto_principal_id: principal.id,
    estoque_anterior: anterior,
    estoque_novo: novo,
    diferenca,
    custo_atualizado: custoAtualizado,
  };
}
