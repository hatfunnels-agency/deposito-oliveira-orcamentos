import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buscarContatoId,
  formatPhoneBR,
  janelaAbertaEm,
  adicionarAoWorkflow,
  contatoEmDnd,
} from '@/lib/ghl';
import {
  candidatosRetorno,
  candidatosFollowup,
  candidatosPosvenda,
  candidatosReativacao,
  dentroHorarioComercial,
  horaBrasilia,
  resolverWorkflow,
  type Candidato,
} from '@/lib/automacoes';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/automacoes/tick
// Cron da Vercel de hora em hora (schedule em vercel.json). Auth: Bearer CRON_SECRET.
//
// SEGURANCA: sai em MODO SIMULACAO por padrao. So envia de verdade quando
// AUTOMACOES_DRY_RUN === 'false' no env. Em simulacao ele calcula tudo,
// grava em automacao_envios com status='simulado' e nao chama o WhatsApp.
//
// HORARIO COMERCIAL: so processa entre 8h e 18h de Brasilia, segunda a
// sabado. Fora disso o tick roda, conta o que esta pendente e devolve no
// JSON, mas NAO grava no log nem fala com o GHL — gravar fora do horario
// queimaria a chave_dedup e o candidato nunca mais dispararia.
//
// Escopo: ?tipos=followup,posvenda,reativacao. Sem o parametro, o padrao
// depende da hora local: as 9h roda tudo (reativacao varre a base inteira e
// pos-venda e por dia de entrega — 1x/dia basta); nas demais horas, so
// follow-up, que e o unico que precisa de granularidade de hora (o momento
// 'quente' e 3–8h depois do orcamento).
// Teste:  ?telefone=11999999999 restringe o envio a um numero so.

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
// Teto POR TICK, nao por dia. Sao 10 ticks dentro do horario comercial
// (8h as 17h), entao o teto de 12 da ~120 mensagens/dia espalhadas — contra
// pico medido de 83/dia, sobra folga de 45%.
//
// O motivo nao e o Meta: 33 num minuto e volume irrelevante pra API, e a nota
// do numero esta High. O motivo e raio de alcance — se uma mensagem sair
// errada, hoje 33 pessoas recebem antes de alguem perceber. Foi a forma do
// incidente de 04/09. Com teto por tick da pra interromper no meio.
//
// Quem for cortado pelo teto NAO se perde: os candidatos sao montados na
// ordem follow-up -> pos-venda -> reativacao, entao quem sobra e sempre a
// reativacao, que e a unica que pode esperar uma hora (ou um dia) sem dano.
const LIMITE_PADRAO = 12;

// Respiro entre uma mensagem e outra dentro do mesmo tick. Com 10 por tick
// sao ~20s — nao atrasa nada (maxDuration e 300s) e evita que as 10 saiam
// no mesmo segundo.
const PAUSA_ENTRE_ENVIOS_MS = 2000;

type Resultado = {
  chave: string;
  tipo: string;
  momento: string;
  cliente: string;
  telefone: string;
  template: string;
  status: 'simulado' | 'enviado' | 'erro' | 'pulado';
  via: 'ia' | 'template' | '—';
  motivo?: string;
};

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Copy escrita pela IA — so vale com a janela de 24h aberta.
async function copyDaIa(
  telefone: string,
  tipo: string,
  momento: string,
  orcamentoId: string | null,
): Promise<string | null> {
  // Fallback explicito: sem ele, a variavel ausente fazia a copy da IA voltar
  // null em silencio e o toque 'quente' era descartado (14 casos em 4 dias).
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
  try {
    const resp = await fetch(`${base}/api/ia/mensagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-automacao-secret': process.env.AUTOMACAO_SECRET || '',
      },
      body: JSON.stringify({ tipo, momento, telefone, orcamento_id: orcamentoId }),
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    return (await resp.json())?.mensagem || null;
  } catch {
    return null;
  }
}

// Mensagem livre (dentro da janela). Nao usa template.
async function enviarTexto(
  contactId: string,
  telefone: string,
  mensagem: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const resp = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      type: 'WhatsApp',
      contactId,
      toNumber: formatPhoneBR(telefone),
      message: mensagem,
    }),
    cache: 'no-store',
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, motivo: `GHL ${resp.status}: ${txt.slice(0, 300)}` };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET nao configurada' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  const manual = request.headers.get('x-admin-key');
  const autorizado =
    auth === `Bearer ${cronSecret}` ||
    (!!process.env.ADMIN_API_KEY && manual === process.env.ADMIN_API_KEY);
  if (!autorizado) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const dryRun = process.env.AUTOMACOES_DRY_RUN !== 'false';
  const limite = Number(url.searchParams.get('limite') || LIMITE_PADRAO);
  const soTelefone = url.searchParams.get('telefone');
  const { hora, diaSemana } = horaBrasilia();
  // Sem ?tipos: as 9h da manha roda a regua inteira; no resto do dia so o
  // follow-up (reativacao e pos-venda nao precisam de granularidade de hora).
  // Antes: as 9h rodava a regua inteira e o resto do dia so follow-up — era
  // isso que criava a rajada das 09:01. Agora as tres rodam a cada hora, com
  // o teto baixo fazendo o espalhamento. Reativacao e pos-venda nao dependem
  // de hora exata, entao nada se perde ao distribuir.
  const tiposPadrao = 'retorno,followup,posvenda,reativacao';
  const tipos = (url.searchParams.get('tipos') || tiposPadrao)
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  try {
    let candidatos: Candidato[] = [];
    // Retorno primeiro: e promessa feita ao cliente, e o teto por tick corta
    // pelo fim da fila — quem sobra e sempre a reativacao.
    if (tipos.includes('retorno')) candidatos.push(...(await candidatosRetorno()));
    if (tipos.includes('followup')) candidatos.push(...(await candidatosFollowup()));
    if (tipos.includes('posvenda')) candidatos.push(...(await candidatosPosvenda()));
    if (tipos.includes('reativacao')) candidatos.push(...(await candidatosReativacao()));

    if (soTelefone) {
      const alvo = soTelefone.replace(/\D/g, '');
      candidatos = candidatos.filter(c => c.telefone.replace(/\D/g, '').endsWith(alvo.slice(-8)));
    }

    // Tira o que ja foi de fato concluido. So 'enviado' (mensagem saiu) e
    // 'concluido' (contexto gravado) bloqueiam a chave para sempre.
    //
    // 'simulado', 'pulado' e 'erro' NAO bloqueiam, de proposito: sao tentativas
    // que nao chegaram no cliente. Sem esse filtro, cada dia rodando em
    // simulacao queimava a safra do dia — no momento em que o envio ligasse,
    // aqueles candidatos jamais sairiam porque ja existia linha no log.
    const CONCLUIDOS = ['enviado', 'concluido'];
    const chaves = candidatos.map(c => c.chaveDedup);
    const jaEnviados = new Set<string>();
    for (let i = 0; i < chaves.length; i += 200) {
      const { data } = await supabaseAdmin
        .from('automacao_envios')
        .select('chave_dedup')
        .in('chave_dedup', chaves.slice(i, i + 200))
        .in('status', CONCLUIDOS);
      for (const r of data || []) jaEnviados.add((r as any).chave_dedup);
    }
    candidatos = candidatos.filter(c => !jaEnviados.has(c.chaveDedup)).slice(0, limite);

    // Guarda de horario comercial: fora de 8h–18h seg–sab (Brasilia) o tick
    // para AQUI — depois de calcular, antes de gravar ou falar com o GHL.
    // Nao grava de proposito: a chave_dedup e UNIQUE, e um registro 'pulado'
    // as 3h da manha mataria o envio que o tick das 8h faria.
    if (!dentroHorarioComercial()) {
      return NextResponse.json({
        modo: dryRun ? 'SIMULACAO — nada foi enviado' : 'ENVIO REAL',
        horarioComercial: false,
        mensagem:
          `Fora do horario comercial (8h–18h de Brasilia, segunda a sabado)` +
          `${diaSemana === 0 ? ' — domingo nao envia nada' : ` — agora sao ${hora}h`}. ` +
          `Nada foi gravado; os pendentes ficam pro proximo tick dentro do horario.`,
        tipos,
        pendentes: candidatos.length,
      });
    }

    const resultados: Resultado[] = [];
    let enviadosNesteTick = 0;

    for (const c of candidatos) {
      let status: Resultado['status'] = dryRun ? 'simulado' : 'enviado';
      let via: Resultado['via'] = '—';
      let motivo: string | undefined;
      let contactId: string | null = null;
      let texto: string | null = null;
      let templateResolvido: { nome: string; id: string } | null = null;

      // A busca do contato e a checagem da janela rodam tambem em simulacao —
      // e o que permite conferir a decisao (IA x template) antes de ligar.
      contactId = await buscarContatoId(c.telefone);
      if (!contactId) {
        status = 'pulado';
        motivo = 'contato nao encontrado no GHL';
      } else {
        const janelaAberta = await janelaAbertaEm(contactId);

        if (c.exigeJanelaAberta && !janelaAberta) {
          status = 'pulado';
          motivo = 'janela de 24h fechada e este momento nao tem template';
        } else if (janelaAberta) {
          via = 'ia';
          texto = await copyDaIa(c.telefone, c.iaTipo, c.iaMomento, c.orcamentoId);
          if (!texto) {
            // IA indisponivel: cai pro template, se existir.
            via = c.template ? 'template' : '—';
            if (!c.template) {
              status = 'pulado';
              motivo = 'IA indisponivel e sem template de fallback';
            }
          }
        } else {
          via = 'template';
        }

        // Resolve template -> workflow ANTES de decidir enviar (e tambem em
        // simulacao, pro log mostrar qual workflow dispararia).
        if (via === 'template' && status !== 'pulado') {
          templateResolvido = await resolverWorkflow(c.template);
          if (!templateResolvido) {
            const falta = `sem workflow no GHL para o template ${c.template}`;
            if (dryRun) {
              motivo = `${falta} (no envio real isso seria erro)`;
            } else {
              status = 'erro';
              motivo = falta;
            }
          }
        }

        // DND do CRM. Lido AO VIVO do GHL a cada tick, de proposito: o que a
        // Mariana marca no perfil ela tem que poder desmarcar no perfil. Se
        // copiassemos pra nossa base, virava porta de mao unica — o cliente
        // ficaria calado pra sempre mesmo depois dela tirar a marca.
        //
        // Roda TAMBEM em simulacao: a previa tem que mostrar 'pulado' e nao
        // uma mensagem que nunca sairia.
        if (status !== 'pulado' && status !== 'erro') {
          const dnd = await contatoEmDnd(contactId);
          if (dnd.dnd) {
            status = 'pulado';
            motivo = dnd.motivo;
          }
        }

        if (!dryRun && status !== 'pulado' && status !== 'erro') {
          // Respiro antes de cada envio real. So entre envios de verdade:
          // candidato pulado nao gasta espera.
          if (enviadosNesteTick > 0) {
            await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
          }
          enviadosNesteTick++;
          const envio =
            via === 'ia' && texto
              ? await enviarTexto(contactId, c.telefone, texto)
              : await adicionarAoWorkflow(contactId, templateResolvido!.id);
          if (!envio.ok) {
            status = 'erro';
            motivo = envio.motivo;
          }
        }
      }

      // onConflict na chave: se duas execucoes correrem juntas, a segunda
      // simplesmente nao insere — nao manda duas vezes.
      await supabaseAdmin.from('automacao_envios').upsert(
        {
          chave_dedup: c.chaveDedup,
          tipo: c.tipo,
          momento: c.momento,
          cliente_id: c.clienteId,
          orcamento_id: c.orcamentoId,
          telefone: c.telefone,
          ghl_contact_id: contactId,
          template_nome: via === 'ia' ? null : templateResolvido?.nome || c.template || null,
          mensagem: texto || c.contexto,
          status,
          motivo: motivo || null,
        },
        // ignoreDuplicates: false — a linha e ATUALIZADA na retentativa, senao
        // um candidato reprocessado ficaria com o status antigo ('simulado')
        // mesmo depois de ter sido enviado de verdade.
        { onConflict: 'chave_dedup', ignoreDuplicates: false },
      );

      resultados.push({
        chave: c.chaveDedup,
        tipo: c.tipo,
        momento: c.momento,
        cliente: c.clienteNome,
        telefone: c.telefone,
        template: via === 'ia' ? '(IA — janela aberta)' : templateResolvido?.nome || c.template,
        status,
        via,
        motivo,
      });
    }

    const porStatus = resultados.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      modo: dryRun ? 'SIMULACAO — nada foi enviado' : 'ENVIO REAL',
      tipos,
      total: resultados.length,
      porStatus,
      resultados,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'falha no tick' }, { status: 500 });
  }
}
