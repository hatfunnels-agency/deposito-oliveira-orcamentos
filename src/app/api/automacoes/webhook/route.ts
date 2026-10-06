import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buscarContatoId,
  formatPhoneBR,
  historicoConversa,
  type MensagemHistorico,
  contatoEmDnd,
  marcarDndNoGhl,
} from '@/lib/ghl';
import { dentroHorarioComercial, horaBrasilia } from '@/lib/automacoes';
import { candidatosTelefone } from '@/lib/contexto';
import { catalogoParaPrompt } from '@/lib/catalogo';
import { transcreverAudio } from '@/lib/transcricao';
import { regrasComLink, INSTRUCAO_SAIDA, type AcaoRobo } from '@/lib/robo-regras';

export const dynamic = 'force-dynamic';
// Buffer (25s) + transcricao + IA + GHL. 60s ficava apertado.
export const maxDuration = 120;

// POST /api/automacoes/webhook
// Chamado pelo GHL quando o CLIENTE manda mensagem no WhatsApp.
// Auth: header x-automacao-secret === AUTOMACAO_SECRET.
//
// TRAVA PRINCIPAL — AUTOMACOES_WEBHOOK_ALLOWLIST:
//   nao setada ou vazia  -> NAO responde ninguem, so registra o que responderia
//   "11992940712"        -> responde so esses numeros (separados por virgula)
//   "*"                  -> responde todo mundo
// O padrao e o seguro: sem a variavel, o robo le, pensa, grava e cala a boca.
//
// ANTI-LOOP: so processa mensagem de ENTRADA. Mensagem que nos mandamos nunca
// entra aqui. Alem disso ha teto de respostas por contato por hora — se o robo
// ja respondeu demais, ele para e passa pra humano em vez de insistir.

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
// Uma negociacao de material vai e volta bastante em poucos minutos — 6 cortava
// o cliente no meio do fechamento (20 vezes em 28/09). 15 ainda barra loop.
const TETO_RESPOSTAS_HORA = 15;

// Quanto tempo o robo fica calado depois que alguem do deposito manda
// mensagem na mao. Em 01/10, na conversa da Edna, a Mariana escreveu as
// 20h32 e as 20h33 e o robo entrou por cima as 20h46 dizendo quase a mesma
// coisa, duas vezes. Quem assumiu a conversa fica com ela.
//
// 2h e tempo de quem esta ATENDENDO agora. Passou disso, a Mariana ja foi
// pra outra coisa e o robo pode voltar.
const MINUTOS_CALADO_APOS_HUMANO = 120;

// Tem que bater com o CHECK chk_categoria_valida em atendimento_fila.
const CATEGORIAS_RECLAMACAO = ['entrega', 'material', 'atendimento', 'outro'];

// Quanto o robo espera antes de responder. Cliente de WhatsApp manda em
// rajada — "oi", "bom dia", "consegue entregar 10 sacos?" — e o robo
// respondia a primeira em segundos, atropelando as outras. Cada mensagem
// nova durante a espera empurra a resposta: so a ULTIMA chamada responde, e
// responde tudo de uma vez.
const BUFFER_SEGUNDOS = 25;

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

function alvosPermitidos(): { modo: 'ninguem' | 'lista' | 'todos'; lista: string[] } {
  const raw = (process.env.AUTOMACOES_WEBHOOK_ALLOWLIST || '').trim();
  if (!raw) return { modo: 'ninguem', lista: [] };
  if (raw === '*') return { modo: 'todos', lista: [] };
  return { modo: 'lista', lista: raw.split(',').map(s => s.replace(/\D/g, '')).filter(Boolean) };
}

function podeResponder(telefone: string): boolean {
  const { modo, lista } = alvosPermitidos();
  if (modo === 'ninguem') return false;
  if (modo === 'todos') return true;
  const d = telefone.replace(/\D/g, '');
  return lista.some(l => d.endsWith(l.slice(-8)));
}

// IDEMPOTENCIA — o GHL entrega a MESMA mensagem do cliente varias vezes.
// Nao e teoria: no log de 25/09, das 12h03 as 12h05, a mesma cliente gerou
// CINCO respostas quase identicas ("Poxa Aline, sinto muito por isso...").
// Com a allowlist fechada isso era so ruido no log; aberta, seriam cinco
// mensagens de verdade no zap dela — a mesma cara do incidente de 04/09.
//
// A chave abaixo e deterministica (telefone + texto + faixa de 10 min) e a
// UNIQUE em chave_dedup e a trava de verdade: a segunda entrega do mesmo
// texto nao consegue inserir e o webhook desiste antes de chamar a IA.
// Limite conhecido: uma rajada que atravesse a virada dos 10 min passa uma
// vez. O teto por hora continua sendo o segundo cinto.
function chaveResposta(digitos: string, texto: string): string {
  const faixa = Math.floor(Date.now() / (10 * 60_000));
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (Math.imul(h, 31) + texto.charCodeAt(i)) | 0;
  return `resposta:${digitos}:${faixa}:${h >>> 0}`;
}

// A conversa e NOSSA quando fomos nos que batemos na porta: follow-up,
// pos-venda ou reativacao enviados nas ultimas 24h — ou uma resposta que o
// proprio robo ja mandou, pra conversa nao morrer no meio.
//
// Nesses casos ele responde durante o dia. Quem chega sozinho continua com a
// Mariana ate as 17h30: o robo nao disputa a conversa dela.
//
// 24h nao e numero solto — e a mesma janela do WhatsApp.
async function reguaCutucou(digitos: string): Promise<boolean> {
  // .in() com as formas do numero, nunca .eq(). A regua grava o telefone como
  // esta no cadastro — 11 digitos, sem DDI ("11949913965") — e o webhook
  // recebe do GHL com o 55 na frente ("5511949913965"). Com .eq() nenhuma
  // conversa iniciada pela regua era reconhecida: em 01/10 tres clientes
  // responderam ao pos-venda das 9h e o robo ficou mudo com todos.
  const { count } = await supabaseAdmin
    .from('automacao_envios')
    .select('id', { count: 'exact', head: true })
    .in('telefone', candidatosTelefone(digitos))
    .eq('status', 'enviado')
    .gte('criado_em', new Date(Date.now() - 24 * 3600_000).toISOString());
  return (count || 0) > 0;
}

// O GHL varia o formato do payload conforme a origem. Procura nos campos
// mais provaveis em vez de assumir um formato so.
function extrair(body: any): { telefone: string; texto: string; direcao: string; tipo: string } {
  const p = body?.message || body?.data || body;
  return {
    telefone: String(p?.phone || p?.from || p?.contact?.phone || body?.phone || ''),
    texto: String(p?.body || p?.message || p?.text || body?.body || '').trim(),
    direcao: String(p?.direction || body?.direction || 'inbound').toLowerCase(),
    tipo: String(p?.messageType || p?.type || body?.messageType || '').toUpperCase(),
  };
}

// O GHL manda o tipo de duas formas conforme a origem: a string
// "TYPE_WHATSAPP" na API de conversas, e o codigo NUMERICO 19 no webhook.
// Sao o mesmo canal — na resposta da API de mensagens os dois vem juntos.
// Tipo vazio passa: outras travas (direcao, texto, telefone) ja filtram.
function ehWhatsApp(tipo: string): boolean {
  if (!tipo) return true;
  return tipo.includes('WHATSAPP') || tipo === '19';
}

async function pensar(
  contexto: string,
  catalogo: string,
): Promise<{ mensagem: string; acao: AcaoRobo } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 500,
        // effort baixo: a resposta e curta e precisa sair rapido no zap.
        output_config: { effort: 'low' },
        system: [
          {
            type: 'text',
            text: `${regrasComLink()}\n\n${catalogo}\n\n${INSTRUCAO_SAIDA}`,
            // As regras nao mudam entre chamadas — cacheia e fica ~90% mais barato.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: contexto }],
      }),
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    const txt = (await resp.json())?.content?.find((b: any) => b.type === 'text')?.text || '';
    const bruto = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    const j = JSON.parse(bruto);
    const acao: AcaoRobo = j?.acao?.tipo ? j.acao : { tipo: 'nenhuma' };
    // mensagem vazia e resposta VALIDA: quer dizer "a conversa acabou, nao
    // responde". So trata como falha se o campo nem veio no JSON.
    if (typeof j?.mensagem !== 'string') return null;
    return { mensagem: String(j.mensagem).trim().slice(0, 600), acao };
  } catch {
    return null;
  }
}

// O robo PEDE a acao; quem valida e executa e este codigo.
async function executar(acao: AcaoRobo, ctx: {
  clienteId: string | null; telefone: string; orcamentoId: string | null; origem: string;
  contactId: string | null;
}): Promise<string> {
  // nao_perturbe vale ANTES da guarda de cadastro. Lead de anuncio que nunca
  // comprou nao esta em `clientes` — em 28/09 foram 60 acoes descartadas assim.
  // Para as outras acoes isso e inofensivo (sem cadastro ele nao entra em
  // regua nenhuma), mas descartar um "para de me mandar mensagem" nao e.
  // A tag no GHL e lida de volta por contatoEmDnd(), entao o pedido vale.
  if (acao.tipo === 'nao_perturbe' && !ctx.clienteId) {
    await marcarDndNoGhl(ctx.contactId);
    return ctx.contactId
      ? 'sem cadastro — nao perturbe gravado no GHL'
      : 'sem cadastro e sem contato no GHL — nao perturbe nao pode ser gravado';
  }
  if (!ctx.clienteId) return 'sem cliente no banco — acao ignorada';
  switch (acao.tipo) {
    case 'marcar_retorno': {
      const d = String(acao.data || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'data invalida — ignorada';
      const hoje = new Date().toISOString().slice(0, 10);
      if (d <= hoje) return 'data no passado — ignorada';
      await supabaseAdmin.from('clientes').update({ data_followup: d }).eq('id', ctx.clienteId);
      return `retorno marcado para ${d}`;
    }
    case 'nao_perturbe': {
      await supabaseAdmin.from('cliente_tags')
        .upsert({ cliente_id: ctx.clienteId, tag: 'nao_perturbe' }, { onConflict: 'cliente_id,tag', ignoreDuplicates: true });
      // Espelha no CRM pra Mariana ver a tag no perfil — senao o pedido do
      // cliente valeria so pra automacao e nao pro atendimento na mao.
      await marcarDndNoGhl(ctx.contactId);
      return 'cliente marcado como nao_perturbe (e no GHL)';
    }
    case 'passar_humano': {
      const caso = {
        cliente_id: ctx.clienteId,
        orcamento_id: ctx.orcamentoId,
        telefone: ctx.telefone,
        motivo: String(acao.motivo || 'outro').slice(0, 60),
        resumo: String(acao.resumo || '').slice(0, 500),
        origem: ctx.origem,
        status: 'aberto',
      };
      // Categoria so entra se for uma das validas — o CHECK do banco recusa
      // o resto, e um insert barrado aqui perderia o caso inteiro.
      const categoria = CATEGORIAS_RECLAMACAO.includes(String(acao.categoria || ''))
        ? String(acao.categoria)
        : 'outro';
      const { error } = await supabaseAdmin.from('atendimento_fila').insert({ ...caso, categoria });
      if (error) {
        // Sem a coluna `categoria` (migration ainda nao rodada) o insert falha
        // inteiro. Perder o tema e aceitavel; perder a reclamacao, nao.
        const { error: erro2 } = await supabaseAdmin.from('atendimento_fila').insert(caso);
        if (erro2) return `falha ao abrir caso na fila: ${erro2.message}`;
        return 'caso aberto na fila (sem categoria — rodar supabase-categoria-reclamacao.sql)';
      }
      return 'caso aberto na fila de atendimento';
    }
    default:
      return 'nenhuma';
  }
}


// Toda saida do webhook deixa rastro. Sem isso, "nao apareceu nada no log"
// e indistinguivel de "o GHL nunca chamou" — foi exatamente o que aconteceu
// no primeiro teste.
async function registrar(
  telefone: string,
  status: 'simulado' | 'enviado' | 'erro' | 'pulado',
  motivo: string,
  extra: Record<string, unknown> = {},
) {
  try {
    await supabaseAdmin.from('automacao_envios').insert({
      chave_dedup: `resposta:${telefone || 'sem-telefone'}:${Date.now()}`,
      tipo: 'followup',
      momento: 'resposta',
      telefone: telefone || null,
      status,
      motivo: motivo.slice(0, 300),
      ...extra,
    });
  } catch {
    // log nunca derruba o webhook
  }
}


export async function POST(request: NextRequest) {
  const segredo = process.env.AUTOMACAO_SECRET;
  if (segredo && request.headers.get('x-automacao-secret') !== segredo) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { telefone, texto, direcao, tipo } = extrair(body);

  // ANTI-LOOP: so mensagem de entrada, so WhatsApp.
  if (direcao !== 'inbound') {
    await registrar(telefone, 'pulado', `direcao "${direcao}" — so processo mensagem de entrada`);
    return NextResponse.json({ ignorado: 'nao e mensagem de entrada', direcao });
  }
  if (!ehWhatsApp(tipo)) {
    await registrar(telefone, 'pulado', `tipo "${tipo}" nao e WhatsApp — ignorado`);
    return NextResponse.json({ ignorado: `tipo ${tipo}` });
  }

  // Sem texto pode ser MIDIA: audio, foto, figurinha. Chega no payload
  // padrao do GHL — o que tem `message` — com o body vazio, e o arquivo so
  // aparece depois, no historico da conversa. Os workflows de sincronizacao
  // tambem mandam payload sem texto, mas sem `message`: esses sao lixo e
  // continuam descartados.
  const talvezMidia = !texto && !!telefone && !!body?.message && typeof body.message === 'object';
  if (!telefone || (!texto && !talvezMidia)) {
    await registrar(telefone, 'pulado',
      `payload sem ${!telefone ? 'telefone' : 'texto'} — chaves recebidas: ${Object.keys(body || {}).join(', ')}`);
    return NextResponse.json({ ignorado: 'sem telefone ou sem texto', chaves: Object.keys(body || {}) });
  }

  const digitos = telefone.replace(/\D/g, '');
  // Casamento EXATO pelas formas possiveis do numero (com e sem 55), nunca
  // por "contem os ultimos 8 digitos": ha cadastro com digito a mais no banco,
  // e o ilike atribuia a conversa ao cliente errado — com o contexto errado,
  // e pior, gravando nao_perturbe e data de retorno na pessoa errada.
  const { data: cliente } = await supabaseAdmin
    .from('clientes').select('id, nome, notas_contexto')
    .in('telefone', candidatosTelefone(digitos)).limit(1).maybeSingle();

  // Uma porta so pra falar: conversa que a REGUA comecou, em horario
  // comercial. A janela da noite (17h30-20h) foi desligada em 01/10 — lead
  // que chega sozinho e da Mariana.
  const nossaConversa = await reguaCutucou(digitos);
  const dentroDaJanelaDeResposta = nossaConversa && dentroHorarioComercial();

  // nao_perturbe cala tudo. ia_pausada cala SO o robo — as reguas continuam,
  // e e assim de proposito: serve pra tirar o robo de uma conversa que a
  // equipe quer tocar na mao.
  if (cliente?.id) {
    const { data: tag } = await supabaseAdmin.from('cliente_tags')
      .select('tag').eq('cliente_id', cliente.id)
      .in('tag', ['nao_perturbe', 'ia_pausada']).limit(1).maybeSingle();
    if (tag) {
      await registrar(digitos, 'pulado', `cliente com ${tag.tag}`, { cliente_id: cliente.id });
      return NextResponse.json({ ignorado: `cliente com ${tag.tag}` });
    }
  }

  // Teto por contato: se ja respondeu demais na ultima hora, para e escala.
  const { count } = await supabaseAdmin
    .from('automacao_envios')
    .select('id', { count: 'exact', head: true })
    .eq('telefone', digitos).eq('momento', 'resposta')
    .gte('criado_em', new Date(Date.now() - 3600_000).toISOString());
  if ((count || 0) >= TETO_RESPOSTAS_HORA) {
    await registrar(digitos, 'pulado', `teto de ${TETO_RESPOSTAS_HORA} respostas/hora atingido`);
    return NextResponse.json({ ignorado: `teto de ${TETO_RESPOSTAS_HORA} respostas/hora atingido` });
  }

  // Reserva a vaga. Texto repetido bate na UNIQUE e sai calado (entrega
  // duplicada do GHL). Midia nao tem texto pra deduplicar — mas o buffer ja
  // resolve: entrega repetida vira mais uma chamada, e so a ultima responde.
  // A linha nasce 'processando' e e o que o buffer usa pra saber se chegou
  // mensagem mais nova; quem ficar 'processando' no log morreu no meio.
  const chave = texto ? chaveResposta(digitos, texto) : `resposta:${digitos}:midia:${Date.now()}`;
  const { data: vaga, error: erroVaga } = await supabaseAdmin
    .from('automacao_envios')
    .insert({
      chave_dedup: chave,
      tipo: 'followup',
      momento: 'resposta',
      cliente_id: cliente?.id || null,
      telefone: digitos,
      status: 'pulado',
      motivo: 'processando',
    })
    .select('id, criado_em')
    .single();

  if (erroVaga || !vaga) {
    // 23505 = violacao de UNIQUE, ou seja, mensagem repetida. Qualquer outro
    // erro e problema nosso de banco: registra e para, nunca responde as cegas.
    const repetida = (erroVaga as { code?: string } | null)?.code === '23505';
    if (!repetida) {
      await registrar(digitos, 'erro', `falha ao reservar a vaga: ${erroVaga?.message || 'sem retorno'}`.slice(0, 300));
    }
    return NextResponse.json({
      ignorado: repetida
        ? 'mensagem repetida — o GHL entregou o mesmo texto de novo'
        : 'erro ao reservar a vaga no log',
    });
  }

  // Devolve 200 pro GHL JA, e espera o buffer depois. Segurar a resposta 25s
  // arriscaria o GHL estourar o tempo dele e reenviar a mensagem.
  after(async () => {
    try {
      await responderDepoisDoBuffer({ digitos, texto, cliente, vaga, nossaConversa, dentroDaJanelaDeResposta });
    } catch (e) {
      await supabaseAdmin.from('automacao_envios')
        .update({ status: 'erro', motivo: `falha inesperada: ${(e as Error).message}`.slice(0, 300) })
        .eq('id', vaga.id);
    }
  });

  return NextResponse.json({ ok: true, aguardando: `${BUFFER_SEGUNDOS}s de buffer` });
}

async function responderDepoisDoBuffer({
  digitos, texto, cliente, vaga, nossaConversa, dentroDaJanelaDeResposta,
}: {
  digitos: string;
  texto: string;
  cliente: { id: string; nome: string | null; notas_contexto: string | null } | null;
  vaga: { id: string; criado_em: string };
  nossaConversa: boolean;
  dentroDaJanelaDeResposta: boolean;
}): Promise<void> {
  const marcar = (campos: Record<string, unknown>) =>
    supabaseAdmin.from('automacao_envios').update(campos).eq('id', vaga.id);

  await esperar(BUFFER_SEGUNDOS * 1000);

  // Chegou outra mensagem do mesmo cliente durante a espera? Entao esta
  // chamada abre mao: a mais nova vai acordar depois, ler o historico com
  // TUDO que ele mandou e responder uma vez so.
  const { count: maisNovas } = await supabaseAdmin
    .from('automacao_envios')
    .select('id', { count: 'exact', head: true })
    .eq('telefone', digitos).eq('momento', 'resposta').eq('motivo', 'processando')
    .gt('criado_em', vaga.criado_em).neq('id', vaga.id);
  if ((maisNovas || 0) > 0) {
    await marcar({ status: 'pulado', motivo: 'agrupada — o cliente mandou outra mensagem durante o buffer' });
    return;
  }

  const contactId = await buscarContatoId(digitos);

  // DND marcado no CRM. O check do Supabase no POST e o caminho rapido; este
  // pega quem acabou de ser marcado no GHL. Cala e pronto.
  if (contactId) {
    const dnd = await contatoEmDnd(contactId);
    if (dnd.dnd) {
      await marcar({ status: 'pulado', motivo: `nao perturbe — ${dnd.motivo}`, ghl_contact_id: contactId });
      return;
    }
  }

  const [hist, orcRes] = await Promise.all([
    contactId
      ? historicoConversa(contactId, 16)
      : Promise.resolve({ mensagens: [] as MensagemHistorico[], humanoFalouEm: null }),
    cliente?.id
      ? supabaseAdmin.from('orcamentos')
          .select('id, codigo, total, status, criado_em, orcamento_itens (produto_nome, quantidade)')
          .eq('cliente_id', cliente.id).order('criado_em', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  const orc = (orcRes as any)?.data;
  const historico = hist.mensagens;

  // Humano assumiu: o robo sai de cena. Checado DEPOIS do buffer de
  // proposito — se a Mariana respondeu enquanto o robo esperava, ele cala.
  if (hist.humanoFalouEm) {
    const minutos = (Date.now() - new Date(hist.humanoFalouEm).getTime()) / 60_000;
    if (minutos >= 0 && minutos < MINUTOS_CALADO_APOS_HUMANO) {
      await marcar({
        status: 'pulado',
        ghl_contact_id: contactId,
        motivo: `humano respondeu ha ${Math.round(minutos)} min — robo calado por ${MINUTOS_CALADO_APOS_HUMANO} min`,
      });
      return;
    }
  }

  const naAllowlist = podeResponder(digitos);
  const liberado = naAllowlist && dentroDaJanelaDeResposta;

  // Tudo que o cliente mandou depois da NOSSA ultima mensagem. O GHL as vezes
  // nao chama o webhook pra uma das mensagens (Ana Paula, 29/09), e com o
  // buffer esta e a chamada que responde pela rajada inteira.
  const cauda: MensagemHistorico[] = [];
  for (let i = historico.length - 1; i >= 0; i--) {
    if (historico[i].de !== 'cliente') break;
    cauda.unshift(historico[i]);
  }

  // Audio vira texto. So quando a resposta vai sair de verdade: em conversa
  // que nao e nossa a resposta e so simulada, e transcrever pra isso e gasto
  // a toa. Os 3 ultimos audios bastam — quem manda mais que isso numa rajada
  // e caso pra humano de qualquer jeito.
  const falhasTranscricao: string[] = [];
  if (liberado) {
    await Promise.all(
      cauda.filter(m => m.midia?.tipo === 'audio').slice(-3).map(async m => {
        const r = await transcreverAudio(m.midia!.url);
        if (r.ok) {
          m.texto = `[audio transcrito] ${r.texto}`;
        } else {
          m.texto = '[audio que nao deu pra ouvir]';
          falhasTranscricao.push(r.motivo);
        }
      }),
    );
  }

  const semResposta = cauda.map(m => m.texto);
  if (texto && !semResposta.some(m => m.trim() === texto.trim())) semResposta.push(texto);
  if (!semResposta.length) {
    // Payload de midia sem nada correspondente no historico do GHL.
    await marcar({ status: 'pulado', ghl_contact_id: contactId, motivo: 'midia sem conteudo no historico do GHL' });
    return;
  }

  // Agenda de entrega: e o que autoriza (ou nao) prometer "proximo dia util".
  const amanha = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
  const { count: entregasAmanha } = await supabaseAdmin
    .from('orcamentos').select('id', { count: 'exact', head: true })
    .eq('tipo_entrega', 'entrega').eq('data_entrega', amanha)
    .not('status', 'in', '(orcamento,cancelado)');

  const contexto = [
    `CLIENTE: ${cliente?.nome || 'desconhecido'} (${formatPhoneBR(digitos)})`,
    cliente?.notas_contexto ? `CONTEXTO: ${cliente.notas_contexto}` : '',
    orc ? `ULTIMO ORCAMENTO: ${orc.codigo} — R$ ${Number(orc.total).toFixed(2)} — status ${orc.status} — ` +
          `itens: ${(orc.orcamento_itens || []).map((i: any) => `${i.quantidade}x ${i.produto_nome}`).join(', ')}` : '',
    `AGENDA: ${entregasAmanha || 0} entregas marcadas para amanha. ` +
      ((entregasAmanha || 0) < 15
        ? 'Pode prometer entrega no proximo dia util.'
        : 'NAO prometa o proximo dia util — ofereca o dia seguinte.'),
    '',
    'CONVERSA ATE AGORA:',
    ...historico.map(h => `${h.de === 'cliente' ? 'CLIENTE' : 'NOS'}: ${h.texto}`),
    '',
    `AGORA: ${String(horaBrasilia().hora).padStart(2, '0')}h${String(horaBrasilia().minuto).padStart(2, '0')} de Brasilia. ` +
      'A Mariana ESTA no atendimento agora — quem voce passar pra ela tem retorno HOJE, nao amanha.',
    '',
    semResposta.length > 1
      ? `O CLIENTE MANDOU ${semResposta.length} MENSAGENS DEPOIS DA NOSSA ULTIMA RESPOSTA — ` +
        `responda TODAS numa mensagem so:\n` + semResposta.map(m => `- ${m}`).join('\n')
      : `O CLIENTE ACABOU DE DIZER: ${semResposta[0]}`,
  ].filter(Boolean).join('\n');

  const notaTranscricao = falhasTranscricao.length ? ` | transcricao falhou: ${falhasTranscricao.join('; ')}` : '';

  const pensado = await pensar(contexto, await catalogoParaPrompt());
  if (!pensado) {
    await marcar({ status: 'erro', motivo: `a IA nao devolveu JSON valido${notaTranscricao}`.slice(0, 300) });
    return;
  }

  const resultadoAcao = await executar(pensado.acao, {
    clienteId: cliente?.id || null,
    telefone: digitos,
    orcamentoId: orc?.id || null,
    origem: 'resposta',
    contactId,
  });

  if (!pensado.mensagem) {
    // A IA leu a conversa e concluiu que nao ha o que responder.
    await marcar({
      status: 'pulado',
      ghl_contact_id: contactId,
      motivo: `nada a responder — conversa encerrada | acao: ${pensado.acao.tipo} -> ${resultadoAcao}${notaTranscricao}`.slice(0, 300),
    });
    return;
  }

  let envio = 'nao enviado';
  if (liberado && contactId) {
    const r = await fetch(`${GHL_API_BASE}/conversations/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'WhatsApp', contactId, toNumber: formatPhoneBR(digitos), message: pensado.mensagem,
      }),
      cache: 'no-store',
    });
    envio = r.ok ? 'enviado' : `erro GHL ${r.status}`;
  } else {
    const barrou = [
      !dentroDaJanelaDeResposta
        ? (nossaConversa ? 'conversa nossa, mas fora de 8h-18h' : 'conversa nao iniciada por nos — e da Mariana')
        : '',
      !naAllowlist ? 'numero fora da allowlist' : '',
      naAllowlist && dentroDaJanelaDeResposta && !contactId ? 'contato nao existe no GHL' : '',
    ].filter(Boolean);
    envio = `nao enviado — ${barrou.join(' + ')}`;
  }

  await marcar({
    ghl_contact_id: contactId,
    mensagem: pensado.mensagem,
    status: envio === 'enviado' ? 'enviado' : 'simulado',
    motivo: `${envio} | acao: ${pensado.acao.tipo} -> ${resultadoAcao}${notaTranscricao}`.slice(0, 300),
  });
}
