import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { geocodeEnderecoAsync } from '@/lib/geocode';

export const dynamic = 'force-dynamic';

// Campos de endereco aceitos no corpo da requisicao
const CAMPOS_ENDERECO = [
  'apelido', 'cep', 'rua', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'observacoes',
] as const;

// Campos que, ao mudar, invalidam o geocoding (lat/lng precisa ser refeito)
const CAMPOS_GEO = ['rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep'] as const;

// PATCH /api/clientes/[id]/enderecos/[enderecoId]
// Atualiza um endereco. Aceita os campos de endereco e is_padrao.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; enderecoId: string }> }
) {
  try {
    const params = await ctx.params;
    const body = await request.json();

    // Garante que o endereco existe e pertence ao cliente da rota
    const { data: atual, error: buscaErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, cliente_id, is_padrao, rua, numero, complemento, bairro, cidade, estado, cep')
      .eq('id', params.enderecoId)
      .single();
    if (buscaErr || !atual || atual.cliente_id !== params.id) {
      return NextResponse.json({ error: 'Endereco nao encontrado' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    for (const campo of CAMPOS_ENDERECO) {
      if (body[campo] !== undefined) update[campo] = body[campo];
    }

    // Se algum campo de endereco mudou, o lat/lng atual fica invalido:
    // zera as colunas de geocoding e dispara o re-geocode depois do update.
    // apelido/observacoes/is_padrao nao afetam o geocoding.
    const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
    const atualRec = atual as Record<string, unknown>;
    const enderecoMudou = CAMPOS_GEO.some(
      campo => body[campo] !== undefined && norm(body[campo]) !== norm(atualRec[campo]),
    );
    if (enderecoMudou) {
      update.lat = null;
      update.lng = null;
      update.geocoded_em = null;
      update.geocode_status = null;
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
    // Endereco mudou -> regeocoda em background (fire-and-forget)
    if (enderecoMudou) {
      void geocodeEnderecoAsync(params.enderecoId);
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
  ctx: { params: Promise<{ id: string; enderecoId: string }> }
) {
  try {
    const params = await ctx.params;
    const { data: atual, error: buscaErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .select('id, cliente_id, is_padrao')
      .eq('id', params.enderecoId)
      .single();
    if (buscaErr || !atual || atual.cliente_id !== params.id) {
      return NextResponse.json({ error: 'Endereco nao encontrado' }, { status: 404 });
    }

    // Cliente pode ficar sem endereco (ex.: apagar o unico endereco
    // cadastrado errado). Pedidos que apontavam pra ele ficam com
    // endereco_id NULL (FK ON DELETE SET NULL).
    // Sem ?confirmar=1, avisa antes se ha pedidos em andamento (ainda vao
    // sair pra entrega) usando este endereco — eles sumiriam da rota.
    // Orcamentos, completos e cancelados nao contam.
    const confirmado = request.nextUrl.searchParams.get('confirmar') === '1';
    if (!confirmado) {
      const { data: emAberto } = await supabaseAdmin
        .from('orcamentos')
        .select('codigo, status')
        .eq('endereco_id', params.enderecoId)
        .not('status', 'in', '(orcamento,completo,cancelado)');
      if (emAberto && emAberto.length > 0) {
        return NextResponse.json(
          {
            error: 'Endereco usado por pedidos em andamento',
            pedidos_em_aberto: emAberto,
          },
          { status: 409 },
        );
      }
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
