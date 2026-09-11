import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buscarContatoId, formatPhoneBR, historicoConversa } from '@/lib/ghl';
import { dentroHorarioComercial, horaBrasilia } from '@/lib/automacoes';
import { regrasComLink, INSTRUCAO_SAIDA, type AcaoRobo } from '@/lib/robo-regras';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
const TETO_RESPOSTAS_HORA = 6;

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

async function pensar(
  contexto: string,
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
            text: `${regrasComLink()}\n\n${INSTRUCAO_SAIDA}`,
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
    if (!j?.mensagem) return null;
    return { mensagem: String(j.mensagem).slice(0, 600), acao };
  } catch {
    return null;
  }
}

// O robo PEDE a acao; quem valida e executa e este codigo.
async function executar(acao: AcaoRobo, ctx: {
  clienteId: string | null; telefone: string; orcamentoId: string | null; origem: string;
}): Promise<string> {
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
      return 'cliente marcado como nao_perturbe';
    }
    case 'passar_humano': {
      await supabaseAdmin.from('atendimento_fila').insert({
        cliente_id: ctx.clienteId,
        orcamento_id: ctx.orcamentoId,
        telefone: ctx.telefone,
        motivo: String(acao.motivo || 'outro').slice(0, 60),
        resumo: String(acao.resumo || '').slice(0, 500),
        origem: ctx.origem,
        status: 'aberto',
      });
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

  // ANTI-LOOP: so mensagem de entrada, so WhatsApp, so com texto.
  if (direcao !== 'inbound') {
    await registrar(telefone, 'pulado', `direcao "${direcao}" — so processo mensagem de entrada`);
    return NextResponse.json({ ignorado: 'nao e mensagem de entrada', direcao });
  }
  if (tipo && !tipo.includes('WHATSAPP')) {
    await registrar(telefone, 'pulado', `tipo "${tipo}" — so processo WhatsApp`);
    return NextResponse.json({ ignorado: `tipo ${tipo}` });
  }
  if (!telefone || !texto) {
    await registrar(telefone, 'pulado',
      `payload sem ${!telefone ? 'telefone' : 'texto'} — chaves recebidas: ${Object.keys(body || {}).join(', ')}`);
    return NextResponse.json({ ignorado: 'sem telefone ou sem texto', chaves: Object.keys(body || {}) });
  }

  const { hora } = horaBrasilia();
  const dentroDaJanelaDeResposta = dentroHorarioComercial() || (hora >= 18 && hora < 20);

  const digitos = telefone.replace(/\D/g, '');
  const { data: cliente } = await supabaseAdmin
    .from('clientes').select('id, nome, notas_contexto')
    .ilike('telefone', `%${digitos.slice(-8)}%`).limit(1).maybeSingle();

  // nao_perturbe cala o robo, sempre.
  if (cliente?.id) {
    const { data: tag } = await supabaseAdmin.from('cliente_tags')
      .select('tag').eq('cliente_id', cliente.id).eq('tag', 'nao_perturbe').limit(1).maybeSingle();
    if (tag) {
      await registrar(digitos, 'pulado', 'cliente com nao_perturbe', { cliente_id: cliente.id });
      return NextResponse.json({ ignorado: 'cliente com nao_perturbe' });
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

  const contactId = await buscarContatoId(digitos);
  const [historico, orcRes] = await Promise.all([
    contactId ? historicoConversa(contactId, 16) : Promise.resolve([]),
    cliente?.id
      ? supabaseAdmin.from('orcamentos')
          .select('id, codigo, total, status, criado_em, orcamento_itens (produto_nome, quantidade)')
          .eq('cliente_id', cliente.id).order('criado_em', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  const orc = (orcRes as any)?.data;

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
    `O CLIENTE ACABOU DE DIZER: ${texto}`,
  ].filter(Boolean).join('\n');

  const pensado = await pensar(contexto);
  if (!pensado) {
    await registrar(digitos, 'erro', 'a IA nao devolveu JSON valido', { cliente_id: cliente?.id || null });
    return NextResponse.json({ erro: 'IA nao respondeu', telefone: digitos });
  }

  const resultadoAcao = await executar(pensado.acao, {
    clienteId: cliente?.id || null,
    telefone: digitos,
    orcamentoId: orc?.id || null,
    origem: 'resposta',
  });

  const liberado = podeResponder(digitos) && dentroDaJanelaDeResposta;
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
  } else if (!dentroDaJanelaDeResposta) {
    envio = 'fora do horario de resposta (8h-20h, seg a sab)';
  } else if (!podeResponder(digitos)) {
    envio = 'numero fora da allowlist — so registrado';
  }

  await supabaseAdmin.from('automacao_envios').insert({
    chave_dedup: `resposta:${digitos}:${Date.now()}`,
    tipo: 'followup',
    momento: 'resposta',
    cliente_id: cliente?.id || null,
    telefone: digitos,
    ghl_contact_id: contactId,
    mensagem: pensado.mensagem,
    status: envio === 'enviado' ? 'enviado' : 'simulado',
    motivo: `${envio} | acao: ${pensado.acao.tipo} -> ${resultadoAcao}`,
  });

  return NextResponse.json({
    ok: true,
    cliente: cliente?.nome || null,
    entendeu: texto,
    responderia: pensado.mensagem,
    acao: pensado.acao.tipo,
    acaoResultado: resultadoAcao,
    envio,
  });
}
