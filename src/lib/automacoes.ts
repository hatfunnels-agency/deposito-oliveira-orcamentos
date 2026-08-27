// Motor das automacoes de WhatsApp. SERVER-ONLY — usa supabaseAdmin e GHL_API_KEY.
// A regua (quem recebe o que, e quando) mora aqui. O disparo mora em
// /api/automacoes/tick, chamado pelo cron da Vercel.
//
// Por que nao usamos workflow do GHL: a API do GHL so expoe GET /workflows/,
// nao da pra criar workflow por API. E o gatilho de verdade esta no Supabase
// (status do orcamento, data de entrega, ultima compra), nao no CRM.
import { supabaseAdmin } from '@/lib/supabase';
import { isObraAtivaActive } from '@/lib/tags';

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
  iaTipo: 'followup' | 'review' | 'reativacao';
  iaMomento: string;
};

// Nome do template aprovado na Meta por momento da regua.
// O ID numerico do GHL vai em GHL_TEMPLATE_IDS (env) — ver enviarWhatsApp().
export const TEMPLATES: Record<string, string> = {
  'followup:dia1': 'followup_dia1',
  'followup:dia4': 'followup_dia4',
  'followup:dia7': 'followup_dia7',
  'posvenda:check': 'posvenda_check',
  'reativacao:geral': 'reativacao_geral',
};

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
  { momento: 'quente', deHoras: 3, ateHoras: 24, exigeJanelaAberta: true },
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

// ---------------------------------------------------------------- follow-up
// Orcamento emitido e nao respondido. Sai da regua sozinho quando o status
// muda (converteu ou cancelou) — por isso o filtro status='orcamento'.
export async function candidatosFollowup(): Promise<Candidato[]> {
  const saida: Candidato[] = [];

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
      if (!cli?.telefone || !cli?.id) continue;

      // Data Follow-up preenchida pausa a regua: so dispara no dia marcado.
      if (cli.data_followup) {
        const hoje = new Date().toISOString().slice(0, 10);
        if (cli.data_followup > hoje) continue;
      }

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
  const ontem = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('orcamentos')
    .select('id, codigo, total, data_entrega, cliente_id, clientes (id, nome, telefone)')
    .eq('status', 'completo')
    .eq('data_entrega', ontem);

  if (error) throw new Error(`posvenda: ${error.message}`);

  const vistos = new Set<string>();
  const saida: Candidato[] = [];

  for (const orc of data || []) {
    const cli = (orc as any).clientes;
    if (!cli?.telefone || !cli?.id || vistos.has(cli.id)) continue;
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
      contexto: `Pedido ${orc.codigo || ''} de ${brl(orc.total)} entregue ontem.`,
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
export async function candidatosReativacao(limite = 120): Promise<Candidato[]> {
  const { data: compras, error } = await supabaseAdmin
    .from('orcamentos')
    .select('cliente_id, criado_em, status, clientes (id, nome, telefone)')
    .not('cliente_id', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(6000);

  if (error) throw new Error(`reativacao: ${error.message}`);

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
  const { data: envios } = await supabaseAdmin
    .from('automacao_envios')
    .select('cliente_id, criado_em')
    .eq('tipo', 'reativacao')
    .order('criado_em', { ascending: false })
    .limit(4000);

  const ultimoEnvio = new Map<string, string>();
  for (const e of envios || []) {
    const r = e as any;
    if (r.cliente_id && !ultimoEnvio.has(r.cliente_id)) ultimoEnvio.set(r.cliente_id, r.criado_em);
  }

  const hoje = new Date();
  const saida: Candidato[] = [];

  for (const [clienteId, { quando, cli }] of ultimaCompra) {
    if (temOrcamentoAberto.has(clienteId)) continue;
    if (!cli?.telefone) continue;

    const diasSemComprar = Math.floor((hoje.getTime() - new Date(quando).getTime()) / 86_400_000);
    if (diasSemComprar < 7) continue;

    const cadenciaDias = isObraAtivaActive(quando) ? 7 : diasSemComprar <= 60 ? 15 : 30;

    const anterior = ultimoEnvio.get(clienteId);
    if (anterior) {
      const diasDesdeEnvio = Math.floor((hoje.getTime() - new Date(anterior).getTime()) / 86_400_000);
      if (diasDesdeEnvio < cadenciaDias) continue;
    }

    saida.push({
      chaveDedup: `reativacao:${clienteId}:${hoje.toISOString().slice(0, 10)}`,
      tipo: 'reativacao',
      momento: 'geral',
      clienteId,
      clienteNome: cli.nome || '',
      telefone: cli.telefone,
      orcamentoId: null,
      template: TEMPLATES['reativacao:geral'],
      variaveis: [primeiroNome(cli.nome)],
      contexto: `Ultima compra ha ${diasSemComprar} dias. Cadencia de ${cadenciaDias} dias.`,
      exigeJanelaAberta: false,
      iaTipo: 'reativacao',
      iaMomento: cadenciaDias === 7 ? 'semanal' : cadenciaDias === 15 ? 'quinzenal' : 'mensal',
    });

    if (saida.length >= limite) break;
  }
  return saida;
}
