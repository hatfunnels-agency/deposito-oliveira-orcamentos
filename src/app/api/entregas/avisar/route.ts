import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buscarContatoId, janelaAbertaEm, enviarWhatsAppTexto, adicionarAoWorkflow } from '@/lib/ghl';
import { resolverWorkflow } from '@/lib/automacoes';
import { montarAvisoEntrega } from '@/lib/aviso-entrega';
import { registrarContato } from '@/lib/contatos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/entregas/avisar { ids: string[] } -> { resultados: [{ id, codigo, ok, via, motivo, link }] }
//
// Avisa o cliente que o pedido saiu para entrega SEM abrir o WhatsApp no
// celular: manda pelo GHL. Com a conversa aberta (cliente falou nas ultimas
// 24h) vai o texto completo; fechada, entra no workflow `entrega_em_rota`
// (template aprovado). Sem os dois, devolve o link wa.me para mandar a mao.
type Resultado = { id: string; codigo: string; ok: boolean; via: 'texto' | 'template' | null; motivo: string | null; link: string | null };

const WORKFLOW_ROTA = 'entrega_em_rota';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { ids?: string[] } | null;
    const ids = Array.isArray(body?.ids) ? body!.ids.map(String).filter(Boolean).slice(0, 30) : [];
    if (!ids.length) return NextResponse.json({ error: 'Informe os pedidos.' }, { status: 400 });

    const { data: pedidos, error } = await supabaseAdmin
      .from('orcamentos')
      .select('id, codigo, status, total, valor_pago, forma_pagamento, aviso_rota_em, cliente_id, clientes ( nome, telefone, recebedor, endereco, numero, bairro ), endereco_completo:enderecos_clientes ( rua, numero, bairro )')
      .in('id', ids);
    if (error) throw error;

    const wf = await resolverWorkflow(WORKFLOW_ROTA).catch(() => null);
    const resultados: Resultado[] = [];
    for (const p of pedidos ?? []) {
      const cli = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as { nome?: string; telefone?: string; recebedor?: string; endereco?: string; numero?: string; bairro?: string } | null;
      const ec = (Array.isArray(p.endereco_completo) ? p.endereco_completo[0] : p.endereco_completo) as { rua?: string; numero?: string; bairro?: string } | null;
      const codigo = String(p.codigo || '');
      const base: Resultado = { id: String(p.id), codigo, ok: false, via: null, motivo: null, link: null };
      const digitos = String(cli?.telefone || '').replace(/\D/g, '');
      const texto = montarAvisoEntrega({
        codigo, cliente_nome: cli?.nome || '', endereco: ec?.rua ?? cli?.endereco ?? null, numero: ec?.numero ?? cli?.numero ?? null,
        bairro: ec?.bairro ?? cli?.bairro ?? null, a_cobrar: Math.max(0, Number(p.total) - (Number(p.valor_pago) || 0)),
        forma_pagamento: p.forma_pagamento, recebedor: cli?.recebedor,
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
        resultados.push({ ...base, motivo: motivo ?? `Conversa fechada há mais de 24h e o template "${WORKFLOW_ROTA}" não existe no GHL. Mande pelo link.`, link });
        continue;
      }
      await supabaseAdmin.from('orcamentos').update({ aviso_rota_em: new Date().toISOString() }).eq('id', p.id);
      if (p.cliente_id) {
        await registrarContato({
          clienteId: String(p.cliente_id), origem: 'atendente', canal: 'whatsapp',
          resumo: `Aviso enviado: pedido ${codigo} saiu para entrega${via === 'template' ? ' (template)' : ''}`, chave: `rota:${p.id}`,
        });
      }
      resultados.push({ ...base, ok: true, via, link });
    }
    for (const id of ids) if (!resultados.some(r => r.id === id)) resultados.push({ id, codigo: '', ok: false, via: null, motivo: 'Pedido não encontrado.', link: null });
    return NextResponse.json({ resultados });
  } catch (e) {
    console.error('Erro POST /api/entregas/avisar', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
