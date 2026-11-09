import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buscarContatoId, janelaAbertaEm, enviarWhatsAppTexto, adicionarAoWorkflow } from '@/lib/ghl';
import { resolverWorkflow } from '@/lib/automacoes';
import { montarPedidoConfirmacao } from '@/lib/aviso-entrega';
import { registrarContato } from '@/lib/contatos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/entregas/confirmar { ids: string[] } -> { resultados: [{ id, codigo, ok, via, motivo, link }] }
//
// Pede ao cliente que confirme a entrega do dia (08/11/2026). Mesmo caminho
// do aviso "em rota": conversa aberta (cliente falou nas ultimas 24h) vai o
// texto completo; fechada, entra no workflow `entrega_confirmacao` (template
// aprovado no GHL). Sem os dois, devolve o link wa.me para mandar a mao.
// Enviou = confirmacao_status 'enviada'; quem marca confirmado/sem resposta
// e a atendente (PATCH abaixo).
type Resultado = { id: string; codigo: string; ok: boolean; via: 'texto' | 'template' | null; motivo: string | null; link: string | null };

const WORKFLOW_CONFIRMACAO = 'entrega_confirmacao';

// Data de hoje em Sao Paulo (o servidor roda em UTC).
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { ids?: string[] } | null;
    const ids = Array.isArray(body?.ids) ? body!.ids.map(String).filter(Boolean).slice(0, 40) : [];
    if (!ids.length) return NextResponse.json({ error: 'Informe os pedidos.' }, { status: 400 });

    const { data: pedidos, error } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, data_entrega, periodo_entrega, confirmacao_status, cliente_id, clientes ( nome, telefone )')
      .in('id', ids);
    if (error) throw error;

    const wf = await resolverWorkflow(WORKFLOW_CONFIRMACAO).catch(() => null);
    const hoje = hojeSP();
    const resultados: Resultado[] = [];
    for (const p of pedidos ?? []) {
      const cli = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as { nome?: string; telefone?: string } | null;
      const codigo = String(p.codigo || '');
      const base: Resultado = { id: String(p.id), codigo, ok: false, via: null, motivo: null, link: null };
      const digitos = String(cli?.telefone || '').replace(/\D/g, '');
      const texto = montarPedidoConfirmacao({
        codigo, cliente_nome: cli?.nome || '', data_entrega: p.data_entrega ? String(p.data_entrega) : null,
        periodo_entrega: p.periodo_entrega ? String(p.periodo_entrega) : null, hoje,
      });
      const link = digitos.length >= 10 ? `https://api.whatsapp.com/send?phone=55${digitos.replace(/^55/, '')}&text=${encodeURIComponent(texto)}` : null;
      if (!digitos) { resultados.push({ ...base, motivo: 'Cliente sem telefone.' }); continue; }

      const contactId = await buscarContatoId(digitos);
      if (!contactId) { resultados.push({ ...base, motivo: 'Cliente não está no GHL. Mande pelo link.', link }); continue; }

      let via: Resultado['via'] = null;
      let motivo: string | null = null;
      if (await janelaAbertaEm(contactId)) {
        const r = await enviarWhatsAppTexto(contactId, digitos, texto);
        if (r.ok) via = 'texto'; else motivo = r.motivo ?? 'Falha ao enviar.';
      }
      if (!via && wf) {
        const r = await adicionarAoWorkflow(contactId, wf.id);
        if (r.ok) via = 'template'; else motivo = r.motivo ?? 'Falha no workflow.';
      }
      if (!via) {
        resultados.push({ ...base, motivo: motivo ?? `Conversa fechada há mais de 24h e o template "${WORKFLOW_CONFIRMACAO}" não existe no GHL. Mande pelo link.`, link });
        continue;
      }
      // Ja confirmado nao volta para 'enviada' (reenvio por engano).
      const upd: Record<string, unknown> = { confirmacao_enviada_em: new Date().toISOString() };
      if (p.confirmacao_status !== 'confirmado') upd.confirmacao_status = 'enviada';
      await supabaseAdmin.from('orcamentos').update(upd).eq('id', p.id);
      if (p.cliente_id) {
        await registrarContato({
          clienteId: String(p.cliente_id), origem: 'atendente', canal: 'whatsapp',
          resumo: `Pedido de confirmação da entrega ${codigo}${via === 'template' ? ' (template)' : ''}`, chave: `confirmacao:${p.id}:${p.data_entrega || ''}`,
        });
      }
      resultados.push({ ...base, ok: true, via, link });
    }
    for (const id of ids) if (!resultados.some(r => r.id === id)) resultados.push({ id, codigo: '', ok: false, via: null, motivo: 'Pedido não encontrado.', link: null });
    return NextResponse.json({ resultados });
  } catch (e) {
    console.error('Erro POST /api/entregas/confirmar', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PATCH /api/entregas/confirmar { id, status: 'confirmado' | 'sem_resposta' }
// A atendente marca o que o cliente respondeu (ou nao) — mensagem ou ligacao.
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { id?: string; status?: string | null } | null;
    const id = String(body?.id || '');
    const status = body?.status;
    if (!id) return NextResponse.json({ error: 'Informe o pedido.' }, { status: 400 });
    if (status !== 'confirmado' && status !== 'sem_resposta') {
      return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from('orcamentos')
      .update({ confirmacao_status: status, confirmacao_em: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true, id, status });
  } catch (e) {
    console.error('Erro PATCH /api/entregas/confirmar', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
