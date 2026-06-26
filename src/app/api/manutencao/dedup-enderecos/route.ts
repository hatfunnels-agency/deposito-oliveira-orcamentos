import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ENDPOINT DE MANUTENCAO TEMPORARIO — dedup de enderecos_clientes.
// Remove enderecos duplicados (mesmo cliente + mesma rua/numero/complemento/
// bairro/cidade/estado/cep), repontando orcamentos.endereco_id pro canonico
// antes de deletar. Unica tabela que referencia enderecos_clientes.id e
// orcamentos.endereco_id (verificado).
//
// Uso:
//   GET /api/manutencao/dedup-enderecos?token=TOKEN            -> dry-run (so relatorio)
//   GET /api/manutencao/dedup-enderecos?token=TOKEN&apply=true -> executa
//
// REMOVER este arquivo apos rodar.

const TOKEN = 'dedup-oliveira-2026-x7k';

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normCep = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const chave = (e: Record<string, unknown>) =>
  [norm(e.rua), norm(e.numero), norm(e.complemento), norm(e.bairro), norm(e.cidade), norm(e.estado), normCep(e.cep)].join('|');

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'token invalido' }, { status: 403 });
  }
  const apply = url.searchParams.get('apply') === 'true';

  const { data: enderecos, error } = await supabaseAdmin
    .from('enderecos_clientes')
    .select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupa por cliente_id + chave normalizada
  const grupos = new Map<string, Record<string, unknown>[]>();
  for (const e of enderecos || []) {
    const k = `${e.cliente_id}::${chave(e as Record<string, unknown>)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(e as Record<string, unknown>);
  }

  const plano: Array<{ cliente_id: string; keep: string; dups: string[]; resumo: string }> = [];
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    // canonico: o padrao, senao o mais antigo (criado_em asc)
    const ordenado = [...lista].sort((a, b) => {
      if (a.is_padrao && !b.is_padrao) return -1;
      if (!a.is_padrao && b.is_padrao) return 1;
      return String(a.criado_em).localeCompare(String(b.criado_em));
    });
    const keep = ordenado[0];
    const dups = ordenado.slice(1);
    plano.push({
      cliente_id: String(keep.cliente_id),
      keep: String(keep.id),
      dups: dups.map((d) => String(d.id)),
      resumo: `${keep.rua ?? ''}, ${keep.numero ?? ''} - ${keep.bairro ?? ''} (${dups.length} dup)`,
    });
  }

  const totalDups = plano.reduce((s, g) => s + g.dups.length, 0);

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      total_enderecos: (enderecos || []).length,
      grupos_com_duplicata: plano.length,
      duplicatas_a_remover: totalDups,
      amostra: plano.slice(0, 15),
    });
  }

  // APLICA: repointa orcamentos e deleta duplicatas
  let repointados = 0;
  let removidos = 0;
  const erros: string[] = [];
  for (const g of plano) {
    if (g.dups.length === 0) continue;
    const { data: up, error: upErr } = await supabaseAdmin
      .from('orcamentos')
      .update({ endereco_id: g.keep })
      .in('endereco_id', g.dups)
      .select('id');
    if (upErr) { erros.push(`repoint ${g.keep}: ${upErr.message}`); continue; }
    repointados += up?.length || 0;

    const { error: delErr } = await supabaseAdmin
      .from('enderecos_clientes')
      .delete()
      .in('id', g.dups);
    if (delErr) { erros.push(`delete ${g.keep}: ${delErr.message}`); continue; }
    removidos += g.dups.length;
  }

  return NextResponse.json({
    applied: true,
    grupos_limpos: plano.length,
    pedidos_repointados: repointados,
    enderecos_removidos: removidos,
    erros,
  });
}
