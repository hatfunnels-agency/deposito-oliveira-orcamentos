import { normalizar } from '@/lib/categorizacao';

/**
 * Como o extrato da conta Stone descreve cada tipo de linha. O CSV e o OFX
 * usam textos diferentes para a mesma coisa, entao toda regra que olha a
 * descricao passa por aqui.
 *
 *   venda no cartao (ja liquida)  CSV: "Transferência entre contas Stone", "Recebível de Cartão"
 *                                 OFX: "Recebimento vendas - Antecipação", "Recebimento de vendas - ...",
 *                                      "Recebimento vendas - Visa | Crédito"
 *   Pix na maquininha             CSV: "Transação" (valor bruto + coluna Tarifa)
 *                                 OFX: "<cliente> - Pix | Maquininha" (valor ja LIQUIDO da tarifa)
 */
const PREFIXOS_CARTAO = ['TRANSFERENCIA ENTRE CONTAS STONE', 'RECEBIVEL DE CARTAO', 'RECEBIMENTO VENDAS', 'RECEBIMENTO DE VENDAS'];

export function ehLinhaCartaoStone(descricao: string | null | undefined): boolean {
  const d = normalizar(descricao);
  return PREFIXOS_CARTAO.some(p => d.startsWith(p));
}

export function ehPixMaquininha(descricao: string | null | undefined): boolean {
  const d = normalizar(descricao);
  return d.startsWith('TRANSACAO') || d.endsWith('| MAQUININHA') || d.includes('PIX | MAQUININHA');
}

/**
 * Tarifa de uma linha de Pix na maquininha. No CSV ela vem na coluna Tarifa.
 * No OFX a linha ja chega liquida e a conciliacao so preenche a tarifa quando
 * acha o pagamento; ate la, estima pela taxa Pix da tabela sobre o liquido.
 */
export function tarifaPixDaLinha(l: { valor?: unknown; tarifa?: unknown }, pctTabela: number): number {
  const tarifa = Number(l.tarifa) || 0;
  if (tarifa > 0) return tarifa;
  const valor = Number(l.valor) || 0;
  if (valor <= 0 || pctTabela <= 0 || pctTabela >= 100) return 0;
  return Math.round(valor * pctTabela / (100 - pctTabela) * 100) / 100;
}

/** Taxa Pix vigente na tabela (0 se nao cadastrada). */
export function pctPixTabela(taxas: Array<{ modalidade: string; taxa_percentual: number; vigencia_fim: string | null }>): number {
  return Number(taxas.find(t => t.modalidade === 'pix' && !t.vigencia_fim)?.taxa_percentual ?? 0);
}
