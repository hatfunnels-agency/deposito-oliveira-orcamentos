import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Campos de endereco aceitos no corpo da requisicao
const CAMPOS_ENDERECO = [
  'apelido', 'cep', 'rua', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'observacoes',
] as const;

// PATCH /api/clientes/[id]/enderecos/[enderecoId]
// Atualiza um endereco. Aceita os campos de endereco e is_padrao.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; enderecoId: string } }
) {
  try {
    const body = await request.json();

    // Garante que o endereco existe e pertence ao cliente da rota
    const { data: atual, error: buscaErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, cliente_id, is_padrao')
      .eq('id', params.enderecoId)
      .single();
    if (buscaErr || !atual || atual.cliente_id !== params.id) {
      return NextResponse.json({ error: 'Endereco nao encontrado' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    for (const campo of CAMPOS_ENDERECO) {
      if (body[campo] !== undefined) update[campo] = body[campo];
    }

    // Promover a padrao: zera os demais antes (unique index uk_enderecos_clientes_padrao)
    if (body.is_padrao === true) {
      await supabaseAdmin
        .from('enderecos_clientes')
        .update({ is_padrao: false })
        .eq('cliente_id', params.id)
        .eq('is_padrao', true)
        .neq('id', params.enderecoId);
      update.is_padrao = true;
    } else if (body.is_padrao === false) {
      update.is_padrao = false;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('enderecos_clientes')
      .update(update)
      .eq('id', params.enderecoId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'Erro ao atualizar endereco' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error('Erro PATCH /api/clientes/[id]/enderecos/[enderecoId]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE /api/clientes/[id]/enderecos/[enderecoId]
// Remove um endereco. Se era o padrao, promove o mais antigo restante.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; enderecoId: string } }
) {
  try {
    const { data: atual, error: buscaErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, cliente_id, is_padrao')
      .eq('id', params.enderecoId)
      .single();
    if (buscaErr || !atual || atual.cliente_id !== params.id) {
      return NextResponse.json({ error: 'Endereco nao encontrado' }, { status: 404 });
    }

    const { error: delErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .delete()
      .eq('id', params.enderecoId);
    if (delErr) {
      return NextResponse.json({ error: 'Erro ao remover endereco' }, { status: 500 });
    }

    // Se o removido era o padrao, promove o endereco mais antigo restante
    let novoPadraoId: string | null = null;
    if (atual.is_padrao) {
      const { data: restantes } = await supabaseAdmin
        .from('enderecos_clientes')
        .select('id')
        .eq('cliente_id', params.id)
        .order('criado_em', { ascending: true })
        .limit(1);
      if (restantes && restantes.length > 0) {
        novoPadraoId = restantes[0].id as string;
        await supabaseAdmin
          .from('enderecos_clientes')
          .update({ is_padrao: true })
          .eq('id', novoPadraoId);
      }
    }

    return NextResponse.json({ success: true, novo_padrao_id: novoPadraoId });
  } catch (e) {
    console.error('Erro DELETE /api/clientes/[id]/enderecos/[enderecoId]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
