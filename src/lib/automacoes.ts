// Motor das automacoes de WhatsApp. SERVER-ONLY — usa supabaseAdmin e GHL_API_KEY.
// A regua (quem recebe o que, e quando) mora aqui. O disparo mora em
// /api/automacoes/tick, chamado pelo cron da Vercel.
//
// Divisao de responsabilidade com o GHL: a regua (quem, quando, dedup,
// horario, opt-out) e daqui, porque o gatilho de verdade esta no Supabase
// (status do orcamento, data de entrega, ultima compra), nao no CRM. O GHL
// so executa o envio — e, para template, isso passa por um workflow, porque
// a API dele nao expoe template de WhatsApp. Ver resolverWorkflow().
import { supabaseAdmin } from '@/lib/supabase';
import { lerTudo } from '@/lib/ler-tudo';
import { isObraAtivaActive } from '@/lib/tags';
import { listarWorkflows } from '@/lib/ghl';

export type TipoAutomacao = 'followup' | 'posvenda' | 'reativacao';

export type Candidato = {
  chaveDedup: string;
  tipo: TipoAutomacao;
  momento: string;
  clienteId: string;
  clienteNome: string;
  telefone: string;
  orcamentoId: string | null;
  // Template aprovado na Meta. Vazio quando o momento so existe dentro da
  // janela de 24h (ex.: 'quente'), onde a IA escreve livre.
  template: string;
  // Variaveis posicionais do template aprovado na Meta ({{1}}, {{2}}...).
  variaveis: string[];
  // Resumo pra copy da IA quando a janela de 24h estiver aberta.
  contexto: string;
  // true = so dispara com a janela de 24h aberta (nao tem template de fallback).
  exigeJanelaAberta: boolean;
  // tipo/momento aceitos por /api/ia/mensagem, que tem vocabulario proprio.
  iaTipo: 'followup' | 'review' | 'reativacao' | 'retorno';
  iaMomento: string;
};

// Nome do template aprovado na Meta por momento da regua. O nome e a chave
// que casa com o workflow correspondente no GHL — ver resolverWorkflow().
export const TEMPLATES: Record<string, string> = {
  'followup:dia1': 'followup_dia1',
  'followup:dia4': 'followup_dia4',
  'followup:dia7': 'followup_dia7',
  'posvenda:check': 'posvenda_check',
  // Reativacao por cadencia: texto diferente pra nao virar robo — quem tem
  // obra ativa recebe toda semana e nao pode ler a mesma frase 3x seguidas.
  'reativacao:semanal': 'reativacao_semanal',
  'reativacao:quinzenal': 'reativacao_geral',
  'reativacao:mensal': 'reativacao_retorno',
  // Dia de retorno combinado com o cliente. Nao ha template proprio aprovado
  // ainda ("combinamos de falar hoje") — usa o mais proximo de cada caso.
  // Com a janela de 24h aberta a IA escreve livre e nada disso e usado.
  'retorno:com_orcamento': 'followup_dia1',
  'retorno:sem_orcamento': 'reativacao_geral',
};

// Resolve o template para o WORKFLOW do GHL que dispara aquele template.
//
// A API do GHL nao expoe template de WhatsApp — nao existe id pra passar em
// /conversations/messages. O caminho suportado e por workflow: cada template
// tem um workflow de um passo so ("contato adicionado" -> "enviar template X"),
// e workflow tem id acessivel por API.
//
// Ordem de resolucao:
//   1. GHL_WORKFLOW_IDS no env, se alguem quiser fixar o mapeamento na mao;
//   2. o workflow cujo NOME contem o nome do template (ex.: um workflow
//      chamado "followup_dia1" ou "WhatsApp - followup_dia1" casa com
//      followup_dia1). E o caminho normal: nao exige configurar nada;
//   3. a versao Utility (`<nome>_util`) tem preferencia quando existe —
//      Utility entrega melhor que Marketing e nao e barrada por opt-out;
//   4. reativacao degrada pra reativacao_geral quando o workflow da cadencia
//      especifica ainda nao foi criado.
// null = nao achou; quem chama decide o que fazer.
export async function resolverWorkflow(
  nomeTemplate: string,
): Promise<{ nome: string; id: string } | null> {
  if (!nomeTemplate) return null;

  let fixos: Record<string, string> = {};
  try {
    fixos = JSON.parse(process.env.GHL_WORKFLOW_IDS || '{}');
  } catch {
    fixos = {};
  }
  const util = `${nomeTemplate}_util`;
  if (fixos[util]) return { nome: util, id: fixos[util] };
  if (fixos[nomeTemplate]) return { nome: nomeTemplate, id: fixos[nomeTemplate] };

  const wfs = await listarWorkflows();
  const acha = (alvo: string) =>
    wfs.find(w => w.name.toLowerCase().includes(alvo.toLowerCase()));

  const porUtil = acha(util);
  if (porUtil) return { nome: porUtil.name, id: porUtil.id };
  const direto = acha(nomeTemplate);
  if (direto) return { nome: direto.name, id: direto.id };

  if (nomeTemplate.startsWith('reativacao_') && nomeTemplate !== 'reativacao_geral') {
    return resolverWorkflow('reativacao_geral');
  }
  return null;
}

// ------------------------------------------------------- horario comercial
// Brasilia e UTC-3 fixo (o Brasil nao tem horario de verao desde 2019).
export function horaBrasilia(agora = new Date()): { hora: number; minuto: number; diaSemana: number } {
  const brt = new Date(agora.getTime() - 3 * 3600_000);
  return { hora: brt.getUTCHours(), minuto: brt.getUTCMinutes(), diaSemana: brt.getUTCDay() };
}

// Janela em que o ROBO responde quem mandou mensagem — diferente da janela
// em que ele INICIA conversa (dentroHorarioComercial, 8h-18h).
//
// Das 8h as 17h30 quem atende e a Mariana: o robo fica calado de proposito,
// para nao atropelar o atendimento humano. Das 17h30 as 20h ela ja saiu, e
// o robo entra para nao perder o lead que chega no fim do dia. Domingo nao
// responde — o deposito esta fechado.
// DESLIGADA em 01/10 — nao e mais chamada por ninguem. Fica aqui porque a
// janela da noite deve voltar quando as automacoes estiverem alinhadas e o
// robo voltar a atender lead que chega sozinho.
export function dentroJanelaResposta(agora = new Date()): boolean {
  const { hora, minuto, diaSemana } = horaBrasilia(agora);
  if (diaSemana === 0) return false;
  const emMinutos = hora * 60 + minuto;
  return emMinutos >= 17 * 60 + 30 && emMinutos < 20 * 60;
}

// Guarda de envio: 8h–18h de Brasilia, segunda a sabado. Domingo nada.
// Cliente recebendo WhatsApp de deposito as 3 da manha e dano de marca.
export function dentroHorarioComercial(agora = new Date()): boolean {
  const { hora, diaSemana } = horaBrasilia(agora);
  if (diaSemana === 0) return false;
  return hora >= 8 && hora < 18;
}

// Cadencia da regua de follow-up, em horas desde a emissao do orcamento.
//
// 'quente' nao tem template aprovado de proposito: ele so dispara se o CLIENTE
// mandou mensagem nas ultimas 24h (janela aberta), e ai a IA escreve livre —
// sem precisar de template. Se a janela estiver fechada, ele e pulado e o
// dia1 assume. Os demais momentos caem fora da janela quase sempre, entao
// usam template — mas se a janela estiver aberta, a IA tambem assume.
const JANELAS_FOLLOWUP: Array<{
  momento: string; deHoras: number; ateHoras: number; exigeJanelaAberta: boolean;
}> = [
  { momento: 'quente', deHoras: 3, ateHoras: 8, exigeJanelaAberta: true },
  { momento: 'dia1', deHoras: 24, ateHoras: 48, exigeJanelaAberta: false },
  { momento: 'dia4', deHoras: 96, ateHoras: 120, exigeJanelaAberta: false },
  { momento: 'dia7', deHoras: 168, ateHoras: 192, exigeJanelaAberta: false },
];

const primeiroNome = (nome: string | null | undefined): string =>
  (nome || '').trim().split(/\s+/)[0] || 'tudo bem';

const brl = (v: number | null | undefined): string =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

function horasAtras(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}


// Data de retorno combinada com o cliente ("me chama semana que vem").
// Enquanto nao chegar o dia, NENHUMA regua fala com ele.
//
// Antes isto so existia dentro do follow-up: o cliente pedia pra ser chamado
// dia 20, o follow-up respeitava, e no dia seguinte a reativacao mandava
// mensagem assim mesmo. Combinar uma data e nao cumprir e pior que nao
// perguntar.
// Data de hoje em Brasilia (AAAA-MM-DD). toISOString() sozinho da a data em
// UTC, que vira o dia seguinte depois das 21h.
export function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

// true enquanto a data combinada NAO passou — inclusive NO PROPRIO DIA. No
// dia, quem fala com o cliente e a regua de retorno (candidatosRetorno); as
// outras ficam quietas pra ele nao receber duas mensagens.
export function retornoAindaNaoChegou(dataFollowup: string | null | undefined): boolean {
  if (!dataFollowup) return false;
  return dataFollowup >= hojeBrasilia();
}

// Clientes que pediram pra nao receber mais. Bloqueia as tres automacoes.
// Uma consulta por execucao do tick, nao uma por candidato.
export async function clientesNaoPerturbe(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('cliente_tags')
    .select('cliente_id')
    .eq('tag', 'nao_perturbe');
  return new Set((data || []).map((r: any) => String(r.cliente_id)));
}

// Clientes com quem a atendente acabou de trabalhar (pagina /tarefas). As
// reguas ficam quietas com eles por 48h: ela acabou de ligar ou mandar
// mensagem, e um template automatico logo em seguida soa como robo atropelando
// gente. Tolerante a tabela ainda nao criada — sem ela, nao bloqueia ninguem.
export async function clientesComTarefaRecente(horas = 48): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('tarefas_atendente')
    .select('cliente_id')
    .gte('criado_em', new Date(Date.now() - horas * 3600_000).toISOString());
  if (error) return new Set();
  return new Set((data || []).filter((r: any) => r.cliente_id).map((r: any) => String(r.cliente_id)));
}

// Quem as reguas NAO devem tocar agora: pediu pra parar, ou a atendente
// acabou de falar com ele.
async function clientesForaDasReguas(): Promise<Set<string>> {
  const [dnd, tarefa] = await Promise.all([clientesNaoPerturbe(), clientesComTarefaRecente()]);
  return new Set([...dnd, ...tarefa]);
}

// Data do pedido fechado mais recente de cada cliente (qualquer status que
// nao seja orcamento nem cancelado). Uma consulta por tick, nao uma por
// candidato.
// Janela de 60 dias: quem usa isto compara com orcamentos de no maximo 30
// dias atras, entao compra mais antiga nunca decide nada. lerTudo porque o
// Supabase corta em 1.000 linhas sem avisar (.limit(6000) nao mudava isso).
export async function ultimaCompraFechadaPorCliente(): Promise<Map<string, string>> {
  const data = await lerTudo(() => supabaseAdmin
    .from('orcamentos')
    .select('cliente_id, criado_em')
    .not('cliente_id', 'is', null)
    .not('status', 'in', '(orcamento,cancelado)')
    .gte('criado_em', new Date(Date.now() - 60 * 86_400_000).toISOString())
    .order('criado_em', { ascending: false }));
  const mapa = new Map<string, string>();
  for (const r of (data || []) as Array<{ cliente_id: string; criado_em: string }>) {
    if (!mapa.has(r.cliente_id)) mapa.set(r.cliente_id, r.criado_em);
  }
  return mapa;
}

// ---------------------------------------------------------------- retorno
// O dia que o cliente combinou ("me chama semana que vem", "dia 20").
//
// Antes, a data so PAUSAVA as outras reguas ate o dia chegar — e quando
// chegava, nada acontecia. O cliente que pediu pra ser chamado nunca era
// chamado. Esta regua e quem chama, e tem prioridade sobre as outras no tick:
// e uma promessa feita ao cliente.
//
// Vale pra data marcada pela IA (marcar_retorno) e pra data posta a mao no
// perfil do cliente — as duas gravam em clientes.data_followup.
export async function candidatosRetorno(): Promise<Candidato[]> {
  const hoje = hojeBrasilia();
  const { data: clientes, error } = await supabaseAdmin
    .from('clientes')
    .select('id, nome, telefone, data_followup')
    .eq('data_followup', hoje);
  if (error) throw new Error(`retorno: ${error.message}`);
  if (!clientes?.length) return [];

  const bloqueados = await clientesForaDasReguas();

  // Orcamento ainda em aberto de cada um (o mais recente). Perdido ou
  // cancelado nao entra — status 'cancelado' sai deste filtro sozinho.
  const { data: abertos } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, cliente_id')
    .eq('status', 'orcamento')
    .in('cliente_id', clientes.map(c => c.id))
    .order('criado_em', { ascending: false });
  const orcamentoDe = new Map<string, any>();
  for (const o of abertos || []) if (!orcamentoDe.has(o.cliente_id)) orcamentoDe.set(o.cliente_id, o);

  const saida: Candidato[] = [];
  for (const cli of clientes) {
    if (!cli.telefone || bloqueados.has(String(cli.id))) continue;
    const orc = orcamentoDe.get(cli.id);
    saida.push({
      chaveDedup: `retorno:${cli.id}:${hoje}`,
      tipo: 'followup',
      momento: 'retorno',
      clienteId: cli.id,
      clienteNome: cli.nome || '',
      telefone: cli.telefone,
      orcamentoId: orc?.id || null,
      template: TEMPLATES[orc ? 'retorno:com_orcamento' : 'retorno:sem_orcamento'],
      variaveis: [primeiroNome(cli.nome)],
      contexto: orc
        ? `Combinamos com o cliente de voltar a falar HOJE sobre o orcamento ${orc.codigo || ''} de ${brl(orc.total)}.`
        : 'Combinamos com o cliente de voltar a falar HOJE.',
      exigeJanelaAberta: false,
      iaTipo: 'retorno',
      iaMomento: orc ? 'com_orcamento' : 'sem_orcamento',
    });
  }
  return saida;
}

// ---------------------------------------------------------------- follow-up
// Orcamento emitido e nao respondido. Sai da regua sozinho quando o status
// muda (converteu ou cancelou) — por isso o filtro status='orcamento'.
export async function candidatosFollowup(): Promise<Candidato[]> {
  const saida: Candidato[] = [];
  const bloqueados = await clientesForaDasReguas();
  const fechouDepois = await ultimaCompraFechadaPorCliente();

  for (const janela of JANELAS_FOLLOWUP) {
    const { data, error } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, total, criado_em, cliente_id, clientes (id, nome, telefone, data_followup)')
      .eq('status', 'orcamento')
      .gte('criado_em', horasAtras(janela.ateHoras))
      .lt('criado_em', horasAtras(janela.deHoras));

    if (error) throw new Error(`followup ${janela.momento}: ${error.message}`);

    for (const orc of data || []) {
      const cli = (orc as any).clientes;
      if (!cli?.telefone || !cli?.id || bloqueados.has(String(cli.id))) continue;

      // Data Follow-up preenchida pausa a regua: so dispara no dia marcado.
      if (retornoAindaNaoChegou(cli.data_followup)) continue;

      // Orcamento superado: o cliente fechou OUTRO pedido depois deste. E o
      // caso classico de refazer o carrinho — pede retirada, muda de ideia e
      // fecha com entrega 1h depois. O primeiro vira lixo, e cobrar resposta
      // dele soa como se nao soubessemos que ele ja comprou.
      const fechado = fechouDepois.get(String(cli.id));
      if (fechado && fechado > String((orc as any).criado_em)) continue;

      saida.push({
        chaveDedup: `followup:${orc.id}:${janela.momento}`,
        tipo: 'followup',
        momento: janela.momento,
        clienteId: cli.id,
        clienteNome: cli.nome || '',
        telefone: cli.telefone,
        orcamentoId: orc.id,
        template: TEMPLATES[`followup:${janela.momento}`] || '',
        variaveis: [primeiroNome(cli.nome)],
        contexto: `Orcamento ${orc.codigo || ''} de ${brl(orc.total)}, emitido ha ${janela.deHoras}h e sem resposta.`,
        exigeJanelaAberta: janela.exigeJanelaAberta,
        iaTipo: 'followup',
        iaMomento: janela.momento,
      });
    }
  }
  return saida;
}

// ---------------------------------------------------------------- pos-venda
// Dispara 1 dia depois da entrega. Uma vez por cliente, pra sempre — por isso
// a chave de dedup nao inclui o orcamento.
export async function candidatosPosvenda(): Promise<Candidato[]> {
  // Janela de 3 dias, nao so "ontem". O pos-venda so tem chance de rodar na
  // execucao das 9h; se ela falhar (deploy no ar, timeout), com janela de um
  // dia exato aquela turma nunca mais seria alcancada — no dia seguinte a
  // query olha outra data. Com 3 dias o tick se recupera sozinho, e nao ha
  // risco de duplicata porque a chave_dedup e `posvenda:{cliente_id}`: uma
  // por cliente pra sempre, independente da data da entrega.
  const ate = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const de = new Date(Date.now() - 72 * 3600_000).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, data_entrega, cliente_id, clientes (id, nome, telefone, data_followup)')
    .eq('status', 'completo')
    .gte('data_entrega', de)
    .lte('data_entrega', ate)
    .order('data_entrega', { ascending: false });

  if (error) throw new Error(`posvenda: ${error.message}`);

  const bloqueados = await clientesForaDasReguas();
  const vistos = new Set<string>();
  const saida: Candidato[] = [];

  for (const orc of data || []) {
    const cli = (orc as any).clientes;
    if (!cli?.telefone || !cli?.id || vistos.has(cli.id)) continue;
    if (bloqueados.has(String(cli.id))) continue;
    if (retornoAindaNaoChegou(cli.data_followup)) continue;
    vistos.add(cli.id);

    saida.push({
      chaveDedup: `posvenda:${cli.id}`,
      tipo: 'posvenda',
      momento: 'check',
      clienteId: cli.id,
      clienteNome: cli.nome || '',
      telefone: cli.telefone,
      orcamentoId: orc.id,
      template: TEMPLATES['posvenda:check'],
      variaveis: [primeiroNome(cli.nome)],
      contexto: `Pedido ${orc.codigo || ''} de ${brl(orc.total)} entregue em ${(orc as any).data_entrega}.`,
      exigeJanelaAberta: false,
      iaTipo: 'review',
      iaMomento: 'pergunta',
    });
  }
  return saida;
}

// -------------------------------------------------------------- reativacao
// Cadencia por tempo desde a ultima compra:
//   obra ativa (<=30d) -> 7 dias | 31-60d -> 15 dias | >60d -> 30 dias
// Nao dispara pra quem tem orcamento aberto (o follow-up ja esta cuidando).
// Ate onde a reativacao olha pra tras. Antes isto nao existia por escrito:
// o Supabase corta em 1.000 linhas, e as 1.000 mais recentes davam ~54 dias
// (e encolhendo conforme o movimento cresce). Na pratica quem nao compra ha
// 60+ dias NUNCA recebeu reativacao — a faixa "mensal" da cadencia nunca
// funcionou. Ligar e decisao de negocio: sao centenas de clientes frios
// entrando de uma vez, o publico que mais bloqueia. Ate la, fica 60 dias,
// igual ao comportamento real de antes — so que agora explicito e estavel.
export const REATIVACAO_MAX_DIAS = 60;

export async function candidatosReativacao(limite = 120): Promise<Candidato[]> {
  let compras: any[];
  try {
    compras = await lerTudo(() => supabaseAdmin
      .from('orcamentos')
      .select('cliente_id, criado_em, status, clientes (id, nome, telefone, data_followup)')
      .not('cliente_id', 'is', null)
      .gte('criado_em', new Date(Date.now() - REATIVACAO_MAX_DIAS * 86_400_000).toISOString())
      .order('criado_em', { ascending: false }));
  } catch (e) {
    throw new Error(`reativacao: ${(e as Error).message}`);
  }

  const ultimaCompra = new Map<string, { quando: string; cli: any }>();
  const temOrcamentoAberto = new Set<string>();

  for (const row of compras || []) {
    const r = row as any;
    if (!r.cliente_id) continue;
    if (r.status === 'orcamento') { temOrcamentoAberto.add(r.cliente_id); continue; }
    if (r.status === 'cancelado') continue;
    if (!ultimaCompra.has(r.cliente_id)) {
      ultimaCompra.set(r.cliente_id, { quando: r.criado_em, cli: r.clientes });
    }
  }

  // Ultimo envio de reativacao por cliente, pro freio de cadencia.
  // So os ultimos 31 dias: a maior cadencia e 30. lerTudo pelo corte de 1.000.
  const envios = await lerTudo(() => supabaseAdmin
    .from('automacao_envios')
    .select('cliente_id, criado_em')
    .eq('tipo', 'reativacao')
    .gte('criado_em', new Date(Date.now() - 31 * 86_400_000).toISOString())
    .order('criado_em', { ascending: false }));

  const ultimoEnvio = new Map<string, string>();
  for (const e of envios || []) {
    const r = e as any;
    if (r.cliente_id && !ultimoEnvio.has(r.cliente_id)) ultimoEnvio.set(r.cliente_id, r.criado_em);
  }

  const bloqueados = await clientesForaDasReguas();
  const hoje = new Date();
  const saida: Candidato[] = [];

  for (const [clienteId, { quando, cli }] of ultimaCompra) {
    if (temOrcamentoAberto.has(clienteId)) continue;
    if (bloqueados.has(clienteId)) continue;
    if (!cli?.telefone) continue;
    if (retornoAindaNaoChegou(cli.data_followup)) continue;

    const diasSemComprar = Math.floor((hoje.getTime() - new Date(quando).getTime()) / 86_400_000);
    if (diasSemComprar < 7) continue;

    const cadenciaDias = isObraAtivaActive(quando) ? 7 : diasSemComprar <= 60 ? 15 : 30;
    const momento = cadenciaDias === 7 ? 'semanal' : cadenciaDias === 15 ? 'quinzenal' : 'mensal';

    const anterior = ultimoEnvio.get(clienteId);
    if (anterior) {
      const diasDesdeEnvio = Math.floor((hoje.getTime() - new Date(anterior).getTime()) / 86_400_000);
      if (diasDesdeEnvio < cadenciaDias) continue;
    }

    saida.push({
      chaveDedup: `reativacao:${clienteId}:${hoje.toISOString().slice(0, 10)}`,
      tipo: 'reativacao',
      momento,
      clienteId,
      clienteNome: cli.nome || '',
      telefone: cli.telefone,
      orcamentoId: null,
      template: TEMPLATES[`reativacao:${momento}`],
      variaveis: [primeiroNome(cli.nome)],
      contexto: `Ultima compra ha ${diasSemComprar} dias. Cadencia de ${cadenciaDias} dias.`,
      exigeJanelaAberta: false,
      iaTipo: 'reativacao',
      iaMomento: momento,
    });

    if (saida.length >= limite) break;
  }
  return saida;
}
