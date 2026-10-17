// Tarefas do dia da atendente (pagina /tarefas). SERVER-ONLY.
//
// Nao e um painel de numeros: e uma LISTA CURTA do que fazer hoje, ja
// priorizada. As listas brutas sao grandes demais pra uma pessoa (em 06/10:
// 179 clientes recorrentes sumidos, 95 orcamentos acima de R$ 1.000 em aberto)
// — painel com isso vira coisa que se olha e se fecha. Cada bloco tem teto.
//
// As tarefas sao calculadas na hora. O que a atendente FAZ com cada uma vai
// pra tarefas_atendente, e e isso que tira a tarefa da lista por um tempo,
// cala as reguas e o robo com o cliente, e alimenta o placar.
import { ultimosContatos } from './contatos';
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { hojeBrasilia, clientesNaoPerturbe, ultimaCompraFechadaPorCliente, orcamentoEraRecente } from '@/lib/automacoes';

export type TipoTarefa = 'retorno' | 'orcamento' | 'reativacao' | 'perdido';
export type ResultadoTarefa = 'feito' | 'sem_resposta' | 'perdido';

export type Tarefa = {
  chave: string;
  tipo: TipoTarefa;
  clienteId: string;
  orcamentoId: string | null;
  nome: string;
  telefone: string;
  motivo: string;          // por que falar com ele, numa linha
  detalhe: string;         // os numeros que sustentam o motivo
  selo?: string;           // "hoje", "atrasado 3 dias", "novo", "robo ja mandou"
  seloForte?: boolean;     // selo que pede atencao (atraso)
  mensagem: string;        // rascunho do WhatsApp — a atendente edita la
  ultimoContato?: { data: string; resumo: string } | null; // cliente_contatos
  contexto?: string | null;                                 // clientes.notas_contexto
};

// Quantos dias a tarefa some depois de cada resultado. Retorno tem a data na
// chave, entao "feito" fecha aquela data pra sempre; orcamento "feito" volta
// em 3 dias porque continua aberto; reativacao "feito" so volta em um mes.
export const ESPERA_DIAS: Record<TipoTarefa, Record<ResultadoTarefa, number>> = {
  retorno: { feito: 3650, sem_resposta: 1, perdido: 3650 },
  orcamento: { feito: 3, sem_resposta: 2, perdido: 3650 },
  reativacao: { feito: 30, sem_resposta: 7, perdido: 90 },
  // Orcamento perdido: falou -> volta em 2 semanas; nao volta -> some.
  perdido: { feito: 14, sem_resposta: 7, perdido: 3650 },
};

export const LIMITE_POR_BLOCO = { orcamento: 10, reativacao: 10, perdido: 10 };
// Orcamento perdido que vale correr atras (90% do valor perdido esta acima disto).
const VALOR_MINIMO_PERDIDO = 2000;

// Orcamento pequeno a regua resolve sozinha; ligacao de gente e pro que pesa.
// 90% do dinheiro em aberto (R$ 378 mil de R$ 419 mil) esta acima disto.
const VALOR_MINIMO_ORCAMENTO = 1000;
// Cliente que ja gastou isto e parou e a reativacao que paga.
const GASTO_ALTO = 3000;

const DIA_MS = 86_400_000;

function primeiroNome(nome: string | null | undefined): string {
  const n = (nome || '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

function brl(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DIA_MS);
}

function ola(nome: string | null): string {
  const p = primeiroNome(nome);
  return p ? `Olá, ${p}! Aqui é do Depósito Oliveira.` : 'Olá! Aqui é do Depósito Oliveira.';
}

// Chaves escondidas pelo resultado mais recente de cada uma. Tolerante a
// tabela ainda nao criada: sem ela, nada fica escondido.
async function chavesEscondidas(chaves: string[], tipo: TipoTarefa): Promise<Set<string>> {
  const escondidas = new Set<string>();
  const visto = new Set<string>();
  for (let i = 0; i < chaves.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('tarefas_atendente')
      .select('chave, resultado, criado_em')
      .in('chave', chaves.slice(i, i + 200))
      .order('criado_em', { ascending: false });
    if (error) return new Set();
    for (const r of data || []) {
      if (visto.has(r.chave)) continue; // so o mais recente decide
      visto.add(r.chave);
      const espera = ESPERA_DIAS[tipo][r.resultado as ResultadoTarefa] ?? 0;
      if (Date.now() - new Date(r.criado_em).getTime() < espera * DIA_MS) escondidas.add(r.chave);
    }
  }
  return escondidas;
}

// ---------------------------------------------------------------- retornos
// Data combinada com o cliente, hoje ou ja vencida (ate 30 dias). E promessa:
// vai no topo, e atraso aparece em destaque.
async function retornos(dnd: Set<string>): Promise<Tarefa[]> {
  const hoje = hojeBrasilia();
  const desde = new Date(Date.now() - 3 * 3600_000 - 30 * DIA_MS).toISOString().slice(0, 10);
  const { data: clientes } = await supabaseAdmin
    .from('clientes')
    .select('id, nome, telefone, data_followup')
    .gte('data_followup', desde)
    .lte('data_followup', hoje);
  const lista = (clientes || []).filter(c => c.telefone && !dnd.has(String(c.id)));
  if (!lista.length) return [];

  const chave = (c: any) => `retorno:${c.id}:${c.data_followup}`;
  const [escondidas, { data: abertos }, { data: enviados }] = await Promise.all([
    chavesEscondidas(lista.map(chave), 'retorno'),
    supabaseAdmin.from('orcamentos').select('id, codigo, total, cliente_id')
      .eq('status', 'orcamento').in('cliente_id', lista.map(c => c.id))
      .order('criado_em', { ascending: false }),
    supabaseAdmin.from('automacao_envios').select('chave_dedup')
      .in('chave_dedup', lista.map(chave)).eq('status', 'enviado'),
  ]);
  const orcDe = new Map<string, any>();
  for (const o of abertos || []) if (!orcDe.has(o.cliente_id)) orcDe.set(o.cliente_id, o);
  const roboMandou = new Set((enviados || []).map(e => e.chave_dedup));

  // Retorno que o robo/IA ja fez (envio registrado para essa data) sai da
  // lista: so fica o que esta pendente de verdade pra atendente (out/2026).
  return lista
    .filter(c => !escondidas.has(chave(c)) && !roboMandou.has(chave(c)))
    .map(c => {
      const atraso = Math.round((Date.parse(hoje) - Date.parse(c.data_followup)) / DIA_MS);
      const orc = orcDe.get(c.id);
      return {
        chave: chave(c),
        tipo: 'retorno' as const,
        clienteId: c.id,
        orcamentoId: orc?.id || null,
        nome: c.nome || 'Cliente',
        telefone: c.telefone,
        motivo: 'Combinou de voltar a falar' + (atraso === 0 ? ' hoje' : ''),
        detalhe: orc ? `Orçamento ${orc.codigo || ''} em aberto · ${brl(orc.total)}` : 'Sem orçamento em aberto',
        selo: atraso > 0
          ? `atrasado ${atraso} dia${atraso > 1 ? 's' : ''}`
          : 'hoje',
        seloForte: atraso > 0,
        mensagem: `${ola(c.nome)} Combinamos de conversar ${atraso > 0 ? 'nesses dias' : 'hoje'}${orc ? ` sobre o seu orçamento ${orc.codigo}` : ''}. Como posso te ajudar?`,
      };
    })
    .sort((a, b) => Number(b.seloForte) - Number(a.seloForte));
}

// ---------------------------------------------------------------- orcamentos
// Os maiores em aberto dos ultimos 30 dias, com os das ultimas 24h na frente.
async function orcamentosGrandes(dnd: Set<string>): Promise<Tarefa[]> {
  const { data } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, criado_em, cliente_id, clientes (id, nome, telefone)')
    .eq('status', 'orcamento')
    .gte('total', VALOR_MINIMO_ORCAMENTO)
    .gte('criado_em', new Date(Date.now() - 30 * DIA_MS).toISOString());

  // Orcamento superado: o cliente fechou OUTRO pedido depois dele (refez o
  // carrinho). Mesma regra da regua de follow-up — ligar sobre ele e ruido.
  const fechouDepois = await ultimaCompraFechadaPorCliente();

  const lista = (data || []).filter((o: any) => {
    const cli = o.clientes;
    if (!cli?.telefone || dnd.has(String(o.cliente_id))) return false;
    const fechado = fechouDepois.get(String(o.cliente_id));
    return !(fechado && fechado > o.criado_em);
  });
  const escondidas = await chavesEscondidas(lista.map((o: any) => `orcamento:${o.id}`), 'orcamento');

  return lista
    .filter((o: any) => !escondidas.has(`orcamento:${o.id}`))
    .sort((a: any, b: any) => {
      const novoA = diasDesde(a.criado_em) < 1, novoB = diasDesde(b.criado_em) < 1;
      if (novoA !== novoB) return Number(novoB) - Number(novoA);
      return Number(b.total) - Number(a.total);
    })
    .slice(0, LIMITE_POR_BLOCO.orcamento)
    .map((o: any) => {
      const dias = diasDesde(o.criado_em);
      return {
        chave: `orcamento:${o.id}`,
        tipo: 'orcamento' as const,
        clienteId: o.cliente_id,
        orcamentoId: o.id,
        nome: o.clientes?.nome || 'Cliente',
        telefone: o.clientes.telefone,
        motivo: `Orçamento de ${brl(o.total)} em aberto`,
        detalhe: `${o.codigo || ''} · ${dias === 0 ? 'feito hoje' : `há ${dias} dia${dias > 1 ? 's' : ''}`}`,
        selo: dias < 1 ? 'novo' : undefined,
        mensagem: `${ola(o.clientes?.nome)} Vi o seu orçamento ${o.codigo} de ${brl(o.total)}. Ficou alguma dúvida? Posso te ajudar a fechar?`,
      };
    });
}

// ---------------------------------------------------------------- reativacao
// Dois sinais, nesta ordem:
//   1. obra ativa que parou de comprar ha 10+ dias — quase sempre esta
//      comprando em outro lugar; e o sinal mais forte;
//   2. cliente de gasto alto parado ha 45+ dias (em 06/10: 78 clientes que
//      ja gastaram R$ 468 mil).
// "Mais tempo inativo" de proposito NAO e criterio: quem esta parado ha mais
// tempo costuma ser cliente de compra unica, que nao volta.
async function reativacao(dnd: Set<string>, jaNaLista: Set<string>): Promise<Tarefa[]> {
  // lerTudo: o historico INTEIRO de compras (gasto total, ultima compra). Com
  // o corte de 1.000 do Supabase vinha uma amostra aleatoria: a Tay aparecia
  // com 9 pedidos, R$ 34 mil e "13 dias" — eram 24, R$ 106 mil, e compra no dia.
  const [compras, obra, { data: abertos }] = await Promise.all([
    lerTudo(() => supabaseAdmin.from('orcamentos')
      .select('cliente_id, total, criado_em, data_entrega')
      .not('status', 'in', '(orcamento,cancelado)')
      .not('cliente_id', 'is', null)),
    lerTudo(() => supabaseAdmin.from('cliente_tags').select('cliente_id').eq('tag', 'obra_ativa')),
    supabaseAdmin.from('orcamentos').select('cliente_id')
      .eq('status', 'orcamento').gte('criado_em', new Date(Date.now() - 30 * DIA_MS).toISOString()),
  ]);

  const resumo = new Map<string, { ultima: string; gasto: number; pedidos: number }>();
  for (const c of compras || []) {
    const quando = (c.data_entrega as string | null) || (c.criado_em as string);
    const r = resumo.get(c.cliente_id) || { ultima: quando, gasto: 0, pedidos: 0 };
    if (quando > r.ultima) r.ultima = quando;
    r.gasto += Number(c.total) || 0;
    r.pedidos += 1;
    resumo.set(c.cliente_id, r);
  }
  const temObra = new Set((obra || []).map(o => String(o.cliente_id)));
  // Quem tem orcamento recente em aberto ja esta no fluxo de orcamento.
  const emNegociacao = new Set((abertos || []).map(o => String(o.cliente_id)));

  type Cand = { id: string; sinal: 'obra' | 'gasto'; dias: number; gasto: number; pedidos: number };
  const cands: Cand[] = [];
  for (const [id, r] of resumo) {
    if (dnd.has(id) || jaNaLista.has(id) || emNegociacao.has(id)) continue;
    const dias = diasDesde(r.ultima);
    if (temObra.has(id) && dias >= 10 && dias <= 30) cands.push({ id, sinal: 'obra', dias, ...r });
    else if (r.gasto >= GASTO_ALTO && dias >= 45 && dias <= 365) cands.push({ id, sinal: 'gasto', dias, ...r });
  }
  // Intercala os dois sinais, cada um ordenado por gasto. Ordenar "obra
  // primeiro" escondia os de gasto alto: em 06/10 eram 111 obras paradas, e os
  // 76 clientes de gasto alto so apareceriam semanas depois.
  const porGasto = (x: Cand, y: Cand) => y.gasto - x.gasto;
  const obras = cands.filter(c => c.sinal === 'obra').sort(porGasto);
  const altos = cands.filter(c => c.sinal === 'gasto').sort(porGasto);
  cands.length = 0;
  for (let i = 0; i < Math.max(obras.length, altos.length); i++) {
    if (obras[i]) cands.push(obras[i]);
    if (altos[i]) cands.push(altos[i]);
  }

  const chave = (id: string) => `reativacao:${id}`;
  const escondidas = await chavesEscondidas(cands.map(c => chave(c.id)), 'reativacao');
  const fila = cands.filter(c => !escondidas.has(chave(c.id))).slice(0, LIMITE_POR_BLOCO.reativacao * 3);
  if (!fila.length) return [];

  const { data: clientes } = await supabaseAdmin
    .from('clientes').select('id, nome, telefone').in('id', fila.map(c => c.id));
  const cliDe = new Map((clientes || []).map(c => [String(c.id), c]));

  return fila
    .filter(c => cliDe.get(c.id)?.telefone)
    .slice(0, LIMITE_POR_BLOCO.reativacao)
    .map(c => {
      const cli = cliDe.get(c.id)!;
      return {
        chave: chave(c.id),
        tipo: 'reativacao' as const,
        clienteId: c.id,
        orcamentoId: null,
        nome: cli.nome || 'Cliente',
        telefone: cli.telefone,
        motivo: c.sinal === 'obra' ? 'Obra ativa parou de comprar' : 'Cliente de gasto alto parado',
        detalhe: `Última compra há ${c.dias} dias · ${c.pedidos} pedido${c.pedidos > 1 ? 's' : ''} · ${brl(c.gasto)} no total`,
        mensagem: c.sinal === 'obra'
          ? `${ola(cli.nome)} Como está a obra? Está precisando de material essa semana?`
          : `${ola(cli.nome)} Faz um tempo que a gente não se fala. Está precisando de algum material?`,
      };
    });
}

// ---------------------------------------------------------------- perdidos
// Orcamento grande dado como perdido nos ultimos 90 dias e o cliente nao
// comprou nem abriu orcamento depois: a obra existe, so nao fechou com a
// gente. Os maiores primeiro; obra ativa na frente. Se o robo mandou a
// recuperacao nos ultimos 7 dias, espera a resposta antes de aparecer aqui.
async function perdidos(dnd: Set<string>, jaNaLista: Set<string>): Promise<Tarefa[]> {
  const desde = new Date(Date.now() - 90 * DIA_MS).toISOString();
  const [{ data: lista }, fechouDepois, obra] = await Promise.all([
    supabaseAdmin.from('orcamentos')
      .select('id, codigo, total, criado_em, perdido_em, motivo_perda, cliente_id, clientes (id, nome, telefone)')
      .eq('status', 'cancelado').not('perdido_em', 'is', null).gte('total', VALOR_MINIMO_PERDIDO)
      .gte('perdido_em', desde).order('total', { ascending: false }).limit(400),
    ultimaCompraFechadaPorCliente(),
    lerTudo(() => supabaseAdmin.from('cliente_tags').select('cliente_id').eq('tag', 'obra_ativa')),
  ]);
  const temObra = new Set((obra || []).map(o => String(o.cliente_id)));
  const cands = (lista || []).filter(o => {
    const cli = (o as any).clientes;
    if (!cli?.id || !cli?.telefone || dnd.has(String(cli.id)) || jaNaLista.has(String(cli.id))) return false;
    if (!orcamentoEraRecente(String(o.criado_em), String(o.perdido_em))) return false;
    const fechado = fechouDepois.get(String(cli.id));
    return !(fechado && fechado > String(o.perdido_em));
  });
  if (!cands.length) return [];
  // Um por cliente (o maior), obra ativa primeiro.
  const porCliente = new Map<string, any>();
  for (const o of cands) if (!porCliente.has(String(o.cliente_id))) porCliente.set(String(o.cliente_id), o);
  const unicos = [...porCliente.values()].sort((a, b) =>
    Number(temObra.has(String(b.cliente_id))) - Number(temObra.has(String(a.cliente_id))) || Number(b.total) - Number(a.total));

  const chave = (o: any) => `perdido:${o.id}`;
  const [escondidas, { data: abertos }, { data: envios }] = await Promise.all([
    chavesEscondidas(unicos.map(chave), 'perdido'),
    supabaseAdmin.from('orcamentos').select('cliente_id, criado_em').eq('status', 'orcamento')
      .in('cliente_id', unicos.map(o => String(o.cliente_id))),
    supabaseAdmin.from('automacao_envios').select('orcamento_id')
      .in('orcamento_id', unicos.map(o => String(o.id))).eq('tipo', 'recuperacao').eq('status', 'enviado')
      .gte('criado_em', new Date(Date.now() - 7 * DIA_MS).toISOString()),
  ]);
  const abriuDepois = new Map<string, string>();
  for (const o of abertos || []) {
    const k = String(o.cliente_id);
    if (!abriuDepois.has(k) || String(o.criado_em) > abriuDepois.get(k)!) abriuDepois.set(k, String(o.criado_em));
  }
  const roboMandou = new Set((envios || []).map(e => String(e.orcamento_id)));
  const fila = unicos.filter(o => !escondidas.has(chave(o)) && !roboMandou.has(String(o.id))
    && !(abriuDepois.get(String(o.cliente_id)) && abriuDepois.get(String(o.cliente_id))! > String(o.perdido_em)))
    .slice(0, LIMITE_POR_BLOCO.perdido);
  if (!fila.length) return [];

  const { data: itens } = await supabaseAdmin.from('orcamento_itens').select('orcamento_id, produto_nome, quantidade, unidade')
    .in('orcamento_id', fila.map(o => String(o.id)));
  const itensDe = new Map<string, string[]>();
  for (const i of itens || []) {
    const k = String(i.orcamento_id);
    const lista = itensDe.get(k) ?? [];
    // Ferro montado na calculadora ja traz a metragem no nome ("... | 78m").
    const nome = String(i.produto_nome || '');
    const rotulo = /barras/i.test(nome) ? nome : `${Number(i.quantidade)} ${i.unidade || ''} ${nome}`;
    if (lista.length < 3) lista.push(rotulo.replace(/\s+/g, ' ').trim());
    itensDe.set(k, lista);
  }
  const MOTIVO: Record<string, string> = { concorrente: 'comprou em outro depósito', preco: 'achou caro', desistiu: 'desistiu / adiou', outro: 'motivo não informado' };

  return fila.map(o => {
    const cli = (o as any).clientes;
    const dias = diasDesde(String(o.perdido_em));
    const resumoItens = (itensDe.get(String(o.id)) ?? []).join(', ');
    return {
      chave: chave(o),
      tipo: 'perdido' as const,
      clienteId: String(cli.id),
      orcamentoId: String(o.id),
      nome: cli.nome || 'Cliente',
      telefone: cli.telefone,
      motivo: temObra.has(String(o.cliente_id)) ? 'Obra ativa com orçamento grande perdido' : 'Orçamento grande perdido',
      detalhe: `${o.codigo || ''} · ${brl(Number(o.total))} · perdido há ${dias} dia${dias === 1 ? '' : 's'} · ${MOTIVO[String(o.motivo_perda)] ?? String(o.motivo_perda || '')}${resumoItens ? ` · ${resumoItens}` : ''}`,
      selo: temObra.has(String(o.cliente_id)) ? 'obra ativa' : undefined,
      mensagem: `${ola(cli.nome)} Vi que o orçamento ${o.codigo || ''} de ${brl(Number(o.total))}${resumoItens ? ` (${resumoItens})` : ''} acabou não saindo. Como está a obra? Se ainda for usar o material, consigo rever o preço e as condições pra fechar com a gente.`,
    };
  });
}

// ---------------------------------------------------------------- tudo
export async function tarefasDoDia(): Promise<{ retornos: Tarefa[]; orcamentos: Tarefa[]; reativacao: Tarefa[]; perdidos: Tarefa[] }> {
  const dnd = await clientesNaoPerturbe();
  const ret = await retornos(dnd);
  const orc = (await orcamentosGrandes(dnd))
    .filter(t => !ret.some(r => r.clienteId === t.clienteId)); // um cliente, uma tarefa
  const jaNaLista = new Set([...ret, ...orc].map(t => t.clienteId));
  const perd = await perdidos(dnd, jaNaLista);
  for (const t of perd) jaNaLista.add(t.clienteId);
  const reat = await reativacao(dnd, jaNaLista);

  // Ultimo contato + nota de contexto em cada cartao: a atendente escreve
  // continuando o assunto, sem abrir o perfil.
  const todas = [...ret, ...orc, ...reat, ...perd];
  const ids = [...new Set(todas.map(t => t.clienteId))];
  if (ids.length) {
    const [ultimos, { data: notas }] = await Promise.all([
      ultimosContatos(ids),
      supabaseAdmin.from('clientes').select('id, notas_contexto').in('id', ids),
    ]);
    const notaDe = new Map((notas || []).map(n => [String(n.id), n.notas_contexto as string | null]));
    for (const t of todas) {
      const u = ultimos.get(t.clienteId);
      t.ultimoContato = u ? { data: u.data, resumo: u.resumo } : null;
      t.contexto = notaDe.get(t.clienteId) ?? null;
    }
  }
  return { retornos: ret, orcamentos: orc, reativacao: reat, perdidos: perd };
}

// ---------------------------------------------------------------- placar
// Hoje: quantas tarefas fechou, por resultado. E o que interessa de verdade:
// quanto virou pedido nos 7 dias depois de um contato "feito".
export async function placar(): Promise<{
  hoje: Record<ResultadoTarefa, number>;
  vendas7d: { pedidos: number; valor: number };
} | null> {
  const inicioDia = `${hojeBrasilia()}T00:00:00-03:00`;
  const { data: deHoje, error } = await supabaseAdmin
    .from('tarefas_atendente').select('resultado').gte('criado_em', inicioDia);
  if (error) return null; // tabela ainda nao existe

  const hoje: Record<ResultadoTarefa, number> = { feito: 0, sem_resposta: 0, perdido: 0 };
  for (const r of deHoje || []) hoje[r.resultado as ResultadoTarefa] = (hoje[r.resultado as ResultadoTarefa] || 0) + 1;

  const { data: feitos } = await supabaseAdmin
    .from('tarefas_atendente').select('cliente_id, criado_em')
    .eq('resultado', 'feito')
    .gte('criado_em', new Date(Date.now() - 7 * DIA_MS).toISOString());
  const primeiroContato = new Map<string, string>();
  for (const f of feitos || []) {
    if (!f.cliente_id) continue;
    const atual = primeiroContato.get(f.cliente_id);
    if (!atual || f.criado_em < atual) primeiroContato.set(f.cliente_id, f.criado_em);
  }
  let pedidos = 0, valor = 0;
  if (primeiroContato.size) {
    const { data: vendas } = await supabaseAdmin
      .from('orcamentos').select('cliente_id, total, criado_em')
      .not('status', 'in', '(orcamento,cancelado)')
      .in('cliente_id', [...primeiroContato.keys()]);
    for (const v of vendas || []) {
      const contato = primeiroContato.get(v.cliente_id)!;
      const depois = Date.parse(v.criado_em) - Date.parse(contato);
      if (depois >= 0 && depois <= 7 * DIA_MS) { pedidos++; valor += Number(v.total) || 0; }
    }
  }
  return { hoje, vendas7d: { pedidos, valor } };
}

// ---------------------------------------------------------- feitos de hoje
// Coluna "Feito hoje" do quadro: o que a atendente ja fechou hoje, do mais
// recente pro mais antigo. tarefas_atendente nao tem FK pra clientes, entao
// o nome vem numa segunda consulta.
export type TarefaFeita = {
  id: string;
  tipo: TipoTarefa;
  resultado: ResultadoTarefa;
  nome: string;
  quando: string;
};

export async function feitosHoje(): Promise<TarefaFeita[]> {
  const inicioDia = `${hojeBrasilia()}T00:00:00-03:00`;
  const { data, error } = await supabaseAdmin
    .from('tarefas_atendente').select('id, tipo, resultado, cliente_id, criado_em')
    .gte('criado_em', inicioDia).order('criado_em', { ascending: false }).limit(200);
  if (error || !data?.length) return [];
  const ids = [...new Set(data.map(r => r.cliente_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: cli } = await supabaseAdmin.from('clientes').select('id, nome').in('id', ids);
    for (const c of cli || []) nomes.set(c.id, c.nome || 'Cliente');
  }
  return data.map(r => ({
    id: r.id,
    tipo: r.tipo as TipoTarefa,
    resultado: r.resultado as ResultadoTarefa,
    nome: (r.cliente_id && nomes.get(r.cliente_id)) || 'Cliente',
    quando: r.criado_em,
  }));
}
