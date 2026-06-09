import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// CSV escape (separator ; — padrao pt-BR / Excel). Aspas duplicadas via "".
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '';
  // Aceita 'YYYY-MM-DD' ou ISO completo. Normaliza pra dd/mm/yyyy.
  const s = String(iso);
  const dataPart = s.length >= 10 ? s.slice(0, 10) : s;
  const m = dataPart.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR');
}

function fmtNumero(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '';
  // Padrao Excel BR: virgula decimal, sem separador de milhar (deixa Excel formatar).
  return Number(n).toFixed(2).replace('.', ',');
}

// GET /api/relatorios/export-pedidos?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&produto_id=...&cliente_id=...&status=...
//
// Gera CSV dos pedidos no periodo. Default exclui cancelados.
// Data entregue efetiva = COALESCE(max(entregas_parciais.data_entrega),
//   levas_entrega.data quando concluida, orcamentos.data_retirada).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const inicio = searchParams.get('inicio');
    const fim = searchParams.get('fim');
    const produtoId = searchParams.get('produto_id');
    const clienteId = searchParams.get('cliente_id');
    const statusFiltro = searchParams.get('status');

    if (!inicio || !fim) {
      return new NextResponse('Parametros inicio e fim sao obrigatorios (YYYY-MM-DD)', { status: 400 });
    }

    let query = supabaseAdmin
      .from('orcamentos')
      .select(`
        id, codigo, criado_em, status, status_pagamento, subtotal, total,
        valor_frete, desconto_valor, forma_pagamento, data_retirada, leva_id, cliente_id,
        clientes (nome, telefone, cep, endereco, numero, complemento, bairro, cidade, estado),
        orcamento_itens (produto_nome, quantidade, unidade, produto_id),
        entregas_parciais (data_entrega),
        levas_entrega:leva_id (data, status)
      `)
      .gte('criado_em', inicio + 'T00:00:00')
      .lte('criado_em', fim + 'T23:59:59.999')
      .order('criado_em', { ascending: false })
      .limit(100000);

    if (statusFiltro) {
      query = query.eq('status', statusFiltro);
    } else {
      query = query.neq('status', 'cancelado');
    }
    if (clienteId) {
      query = query.eq('cliente_id', clienteId);
    }

    const { data: rawOrcamentos, error } = await query;
    if (error) {
      console.error('[export-pedidos] erro:', error);
      return new NextResponse('Erro ao buscar pedidos', { status: 500 });
    }

    // Filtro produto_id em JS (EXISTS sobre orcamento_itens).
    let orcamentos = (rawOrcamentos || []) as Array<Record<string, unknown>>;
    if (produtoId) {
      orcamentos = orcamentos.filter(o => {
        const itens = (o.orcamento_itens as Array<{ produto_id: string | null }> | null) || [];
        return itens.some(i => i.produto_id === produtoId);
      });
    }

    const headers = [
      'Codigo',
      'Data gerada',
      'Data entregue efetiva',
      'Status',
      'Status pagamento',
      'Cliente nome',
      'Cliente telefone',
      'Cliente endereco',
      'Itens',
      'Subtotal',
      'Valor frete',
      'Desconto valor',
      'Total',
      'Forma de pagamento',
    ];

    const linhas: string[] = [headers.join(';')];

    for (const o of orcamentos) {
      const clienteRaw = o.clientes;
      const cliente = (Array.isArray(clienteRaw) ? clienteRaw[0] : clienteRaw) as
        | Record<string, unknown>
        | null;

      const itens = (o.orcamento_itens as Array<{ produto_nome: string; quantidade: number; unidade: string }> | null) || [];
      const itensStr = itens
        .map(i => `${Number(i.quantidade)}${i.unidade && i.unidade !== 'unidade' ? i.unidade : 'x'} ${i.produto_nome}`)
        .join('; ');

      // Data entregue efetiva: COALESCE(max parciais, leva concluida, data_retirada)
      const entregasParciais = (o.entregas_parciais as Array<{ data_entrega: string | null }> | null) || [];
      let maxParcial: string | null = null;
      for (const ep of entregasParciais) {
        if (ep.data_entrega && (!maxParcial || ep.data_entrega > maxParcial)) {
          maxParcial = ep.data_entrega;
        }
      }
      const levaRaw = o.levas_entrega;
      const leva = (Array.isArray(levaRaw) ? levaRaw[0] : levaRaw) as
        | { data: string | null; status: string | null }
        | null;
      const dataLeva = leva && leva.status === 'concluida' ? leva.data : null;
      const dataEntregueEfetiva = maxParcial || dataLeva || (o.data_retirada as string | null) || null;

      const enderecoCompleto = cliente
        ? [
            cliente.endereco,
            cliente.numero ? 'nº ' + cliente.numero : '',
            cliente.complemento,
            cliente.bairro,
            cliente.cidade ? `${cliente.cidade}-${cliente.estado || ''}` : '',
            cliente.cep,
          ]
            .filter(Boolean)
            .join(', ')
        : '';

      const row = [
        o.codigo,
        fmtDataHora(o.criado_em as string),
        fmtData(dataEntregueEfetiva),
        o.status,
        o.status_pagamento ?? '',
        cliente?.nome ?? '',
        cliente?.telefone ?? '',
        enderecoCompleto,
        itensStr,
        fmtNumero(o.subtotal as number),
        fmtNumero(o.valor_frete as number),
        fmtNumero((o.desconto_valor as number) ?? 0),
        fmtNumero(o.total as number),
        o.forma_pagamento ?? '',
      ];
      linhas.push(row.map(csvEscape).join(';'));
    }

    // BOM UTF-8 + CRLF (Excel BR abre limpo).
    const csv = '﻿' + linhas.join('\r\n');
    const filename = `pedidos_${inicio}_${fim}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error('[export-pedidos] erro interno', e);
    return new NextResponse('Erro interno', { status: 500 });
  }
}
