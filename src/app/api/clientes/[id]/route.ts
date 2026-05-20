import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Corpo aceito pelo PATCH de cliente. Todos os campos sao opcionais.
// Os campos legados de endereco continuam suportados — zero breaking change.
interface PatchClienteBody {
  // Campos legados (varias rotas ainda dependem deles)
  nome?: string;
  telefone?: string;
  cep?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  recebedor?: string;
  // Campos novos (CRM Fase 1A)
  email?: string;
  notas_contexto?: string;
  data_followup?: string;
}

// Campos legados repassados direto (telefone tem normalizacao propria)
const CAMPOS_LEGADOS = [
  'nome', 'cep', 'endereco', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'recebedor',
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTAS = 2000;

// PATCH /api/clientes/[id]
// Atualiza um cliente. Aceita os campos legados e os 3 novos campos do CRM.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as PatchClienteBody;

    // ---- Validacoes (ANTES de qualquer chamada ao Supabase) ----

    // email: se fornecido e nao vazio, valida formato (tem @ e . depois do @)
    if (typeof body.email === 'string' && body.email !== '') {
      if (!EMAIL_RE.test(body.email)) {
        return NextResponse.json(
          { error: 'Email inválido', campo: 'email', valor_recebido: body.email },
          { status: 400 },
        );
      }
    }

    // notas_contexto: se fornecido, respeita o limite de 2000 caracteres
    if (typeof body.notas_contexto === 'string' && body.notas_contexto.length > MAX_NOTAS) {
      return NextResponse.json(
        {
          error: 'Notas de contexto muito longas (máx 2000 caracteres)',
          tamanho_recebido: body.notas_contexto.length,
        },
        { status: 400 },
      );
    }

    // data_followup: se fornecido e nao vazio, valida o formato YYYY-MM-DD
    if (typeof body.data_followup === 'string' && body.data_followup !== '') {
      if (!DATA_RE.test(body.data_followup)) {
        return NextResponse.json(
          {
            error: 'Data de followup inválida (formato YYYY-MM-DD esperado)',
            valor_recebido: body.data_followup,
          },
          { status: 400 },
        );
      }
    }

    // ---- Monta o update ----
    const update: Record<string, unknown> = {};

    for (const campo of CAMPOS_LEGADOS) {
      if (body[campo] !== undefined) update[campo] = body[campo];
    }

    // telefone legado: normaliza para digitos (mesma regra do POST/upsert)
    if (body.telefone !== undefined) {
      update.telefone = String(body.telefone).replace(/\D/g, '');
    }

    // Campos novos: string vazia limpa o campo (NULL); nunca grava "" literal
    if (body.email !== undefined) {
      update.email = body.email === '' ? null : body.email;
    }
    if (body.notas_contexto !== undefined) {
      update.notas_contexto = body.notas_contexto === '' ? null : body.notas_contexto;
    }
    if (body.data_followup !== undefined) {
      update.data_followup = body.data_followup === '' ? null : body.data_followup;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
    }

    update.atualizado_em = new Date().toISOString();

    // ---- Persiste ----
    const { data, error } = await supabaseAdmin
      .from('clientes')
      .update(update)
      .eq('id', params.id)
      .select('*');

    if (error) {
      // Traduz erros conhecidos do Postgres sem vazar a mensagem crua
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Telefone já cadastrado em outro cliente' },
          { status: 409 },
        );
      }
      if (error.code === '22007' || error.code === '22008') {
        return NextResponse.json(
          { error: 'Data de followup inválida (formato YYYY-MM-DD esperado)' },
          { status: 400 },
        );
      }
      console.error('Erro PATCH /api/clientes/[id]', error);
      return NextResponse.json({ error: 'Erro ao atualizar cliente' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    return NextResponse.json(data[0]);
  } catch (e) {
    console.error('Erro PATCH /api/clientes/[id]', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
