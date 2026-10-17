// Trilha append-only do financeiro (financeiro_eventos) e o erro tipado
// que as funcoes da lib lancam pra rota devolver o status certo.

import { supabaseAdmin } from '@/lib/supabase';
import type { EventoFinanceiro } from './tipos';

/**
 * Grava um evento. Nunca derruba a operacao que o gerou: a trilha e
 * auditoria, nao requisito — falha so vai pro log.
 */
export async function registrarEvento(e: EventoFinanceiro): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('financeiro_eventos').insert({
      entidade: e.entidade,
      entidade_id: e.entidade_id ?? null,
      acao: e.acao,
      antes: e.antes === undefined ? null : e.antes,
      depois: e.depois === undefined ? null : e.depois,
      usuario_id: e.usuario_id ?? null,
    });
    if (error) console.error('[financeiro/eventos] falha ao registrar', e.entidade, e.acao, error.message);
  } catch (err) {
    console.error('[financeiro/eventos] falha ao registrar', e.entidade, e.acao, err);
  }
}

/**
 * Erro com status HTTP. A rota faz
 *   `e instanceof ErroFinanceiro ? e.status : 500`
 * e devolve `{ error: e.message }` — a mensagem ja vem em pt-BR pra tela.
 */
export class ErroFinanceiro extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroFinanceiro';
    this.status = status;
  }
}

/** Violacao de UNIQUE no Postgres (indices parciais de vinculo, chave_recorrencia, hash_linha). */
export function ehConflitoUnico(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === '23505') return true;
  return /23505|duplicate key/i.test(String(err.message ?? ''));
}
