import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { filtrarTagsObraAtiva } from '@/lib/tags';

export const dynamic = 'force-dynamic';

// Endpoint chamado pelos workflows do GHL (webhook) pra gerar o texto da
// mensagem de WhatsApp com IA — curto e informal (publico de baixa renda).
// Fora da janela de 24h o GHL envia via TEMPLATE aprovado; aqui a IA escreve
// a variavel personalizada e conduz as RESPOSTAS (dentro das 24h).
//
// Auth: header x-automacao-secret === AUTOMACAO_SECRET (se a env estiver setada).
//
// Body: {
//   tipo: 'followup' | 'review' | 'reativacao' | 'resposta',
//   telefone: string,
//   momento?: string,          // followup: quente|dia1|dia4|dia7
//                              // review: pergunta|positivo|negativo
//                              // reativacao: semanal|quinzenal|mensal
//   mensagem_cliente?: string, // ultima msg do cliente (tipo=resposta)
// }
// Resposta: { mensagem: string }

const GOOGLE_REVIEW_URL = 'https://share.google/HxNnPvB3da412vDLq';

const VOZ = [
  'Voce escreve mensagens de WhatsApp pro Deposito Oliveira, um deposito de',
  'material de construcao em Carapicuiba/SP. REGRAS DE ESTILO (obrigatorias):',
  '- Curtssimo: no maximo 2 frases curtas. Nunca passe de ~250 caracteres.',
  '- Informal e simples, como quem fala no zap. Publico e de baixa renda e as',
  '  vezes le pouco — nada de palavra dificil, nada de formalidade.',
  '- Trate por voce, tom amigavel. No maximo 1 emoji, so se combinar.',
  '- Nunca invente preco, produto, prazo ou desconto que nao esteja no contexto.',
  '- Nao use assinatura nem saudacao longa. Va direto ao ponto.',
  '- Portugues do Brasil. Responda SO com o texto da mensagem, nada mais.',
].join('\n');

// Instrucao especifica por tipo/momento.
function tarefaPara(tipo: string, momento: string): string {
  if (tipo === 'followup') {
    if (momento === 'quente') return 'O cliente acabou de receber um orcamento (poucas horas atras). Manda uma mensagem leve perguntando se conseguiu ver e se ficou alguma duvida, pra ajudar a fechar enquanto ta fresco.';
    if (momento === 'dia4') return 'Ja faz uns dias que mandamos o orcamento e o cliente nao respondeu. Puxa de leve, pergunta se ainda tem interesse e se oferece pra ajudar (ex: tirar duvida). Sem pressao.';
    if (momento === 'dia7') return 'Ultimo lembrete do orcamento em aberto. Pergunta se ainda quer o material, de forma simpatica, deixando claro que e so chamar quando quiser.';
    return 'Faz 1 dia do orcamento. Lembra o cliente de forma amigavel e pergunta se ele quer seguir com o pedido.';
  }
  if (tipo === 'review') {
    if (momento === 'positivo') return `O cliente disse que deu tudo certo com o pedido. Agradece rapidinho e pede com jeitinho pra ele deixar uma avaliacao no Google, mandando este link: ${GOOGLE_REVIEW_URL}`;
    if (momento === 'negativo') return 'O cliente disse que teve algum problema com o pedido. Responde com empatia, pede desculpa e diz que a equipe ja vai olhar e resolver. NAO peca avaliacao.';
    return 'O pedido do cliente foi entregue/concluido. Pergunta de forma simples e simpatica se deu tudo certo com o material.';
  }
  if (tipo === 'reativacao') {
    if (momento === 'semanal') return 'Cliente com obra ativa (compra com frequencia). Manda um toque rapido perguntando se ele precisa de mais algum material essa semana.';
    if (momento === 'quinzenal') return 'Faz um tempinho que o cliente nao compra. Manda um oi leve perguntando se esta precisando de material, sem forcar.';
    if (momento === 'mensal') return 'Faz bastante tempo que o cliente nao compra. Manda um oi simpatico pra lembrar que a gente ta aqui quando precisar de material.';
    return 'Cliente que ja comprou antes. Manda um oi leve perguntando se esta precisando de material.';
  }
  // resposta livre dentro da janela de 24h
  return 'O cliente respondeu no WhatsApp. Responda a mensagem dele de forma util e curta, usando o contexto. Se ele quiser comprar, incentive de leve a fechar; se for duvida, responda objetivo.';
}

// Candidatos de telefone (com/sem DDI 55) pra casar com clientes.telefone (digitos).
function candidatosTelefone(raw: string): string[] {
  const d = (raw || '').replace(/\D/g, '');
  const set = new Set<string>();
  if (d) set.add(d);
  if (d.startsWith('55') && d.length >= 12) set.add(d.slice(2));
  if (d.length <= 11) set.add('55' + d);
  return Array.from(set);
}

export async function POST(request: Request) {
  try {
    const secret = process.env.AUTOMACAO_SECRET;
    if (secret) {
      const enviado = request.headers.get('x-automacao-secret');
      if (enviado !== secret) {
        return NextResponse.json({ error: 'nao autorizado' }, { status: 401 });
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY ausente' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const tipo = String(body?.tipo || 'resposta');
    const momento = String(body?.momento || '');
    const telefone = String(body?.telefone || '');
    const mensagemCliente = body?.mensagem_cliente ? String(body.mensagem_cliente) : '';

    if (!telefone) {
      return NextResponse.json({ error: 'telefone obrigatorio' }, { status: 400 });
    }

    // ---- Contexto do cliente (Supabase) ----
    const candidatos = candidatosTelefone(telefone);
    const { data: cliente } = await supabaseAdmin
      .from('clientes')
      .select('id, nome, notas_contexto')
      .in('telefone', candidatos)
      .limit(1)
      .maybeSingle();

    let contexto = '';
    if (cliente) {
      const [orcRes, tagsRes] = await Promise.all([
        supabaseAdmin
          .from('orcamentos')
          .select('codigo, total, status, criado_em, tipo_entrega, orcamento_itens (produto_nome, quantidade)')
          .eq('cliente_id', cliente.id)
          .order('criado_em', { ascending: false })
          .limit(1),
        supabaseAdmin
          .from('cliente_tags')
          .select('tag')
          .eq('cliente_id', cliente.id),
      ]);

      // ultima compra (venda real) pra filtrar obra_ativa
      const { data: vendas } = await supabaseAdmin
        .from('orcamentos')
        .select('criado_em, data_entrega, total')
        .eq('cliente_id', cliente.id)
        .not('status', 'in', '(orcamento,cancelado)');
      let ultimaCompra: string | null = null;
      let qtdCompras = 0;
      for (const v of vendas || []) {
        qtdCompras++;
        const dt = (v.data_entrega as string | null) || (v.criado_em as string);
        if (dt && (!ultimaCompra || new Date(dt) > new Date(ultimaCompra))) ultimaCompra = dt;
      }
      const tags = filtrarTagsObraAtiva((tagsRes.data || []) as Array<{ tag: string }>, ultimaCompra).map(t => t.tag);

      const ult = (orcRes.data || [])[0] as
        | { codigo?: string; total?: number; status?: string; tipo_entrega?: string; orcamento_itens?: Array<{ produto_nome: string; quantidade: number }> }
        | undefined;
      const produtos = ult?.orcamento_itens?.map(i => `${i.quantidade}x ${i.produto_nome}`).join(', ') || '';

      const linhas = [
        `Nome: ${cliente.nome || 'Cliente'}`,
        cliente.notas_contexto ? `Contexto: ${cliente.notas_contexto}` : '',
        tags.length ? `Tags: ${tags.join(', ')}` : '',
        qtdCompras ? `Compras ja feitas: ${qtdCompras}` : 'Ainda nao comprou (so orcamento)',
        ult ? `Ultimo orcamento ${ult.codigo || ''} — R$ ${Number(ult.total || 0).toLocaleString('pt-BR')} (${ult.tipo_entrega || ''})` : '',
        produtos ? `Itens: ${produtos}` : '',
      ].filter(Boolean);
      contexto = linhas.join('\n');
    } else {
      contexto = 'Cliente ainda nao cadastrado no sistema. Use um tom generico.';
    }

    const primeiroNome = (cliente?.nome || '').split(' ')[0] || '';
    const tarefa = tarefaPara(tipo, momento);
    const userPrompt = [
      `DADOS DO CLIENTE:`,
      contexto,
      primeiroNome ? `\nUse o primeiro nome (${primeiroNome}) no comeco, se ficar natural.` : '',
      mensagemCliente ? `\nMENSAGEM QUE O CLIENTE ENVIOU:\n"${mensagemCliente}"` : '',
      `\nTAREFA:\n${tarefa}`,
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        system: VOZ,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[IA Mensagem] Anthropic error:', err);
      return NextResponse.json({ error: 'Erro ao gerar mensagem' }, { status: 500 });
    }

    const data = await response.json();
    const mensagem = (data.content?.[0]?.text || '').trim();
    return NextResponse.json({ mensagem });
  } catch (e) {
    console.error('[IA Mensagem] erro:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
