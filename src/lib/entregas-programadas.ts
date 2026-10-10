// Entregas de um pedido em varias viagens. SERVER-ONLY.
//
// entregas_parciais.status:
//   'programada' -> viagem combinada (data + itens), ainda nao saiu
//   'entregue'   -> viagem feita; ja somou em orcamento_itens.quantidade_entregue
//
// A aba Entregas e a folha de rota listam pedidos por orcamentos.data_entrega
// E por viagem programada (cada viagem e um cartao no dia dela). Depois de
// qualquer mudanca, o pedido e "sincronizado":
//   - com viagem programada, o PEDIDO PRINCIPAL fica sem data — so controle.
//     Antes ele ganhava a data da viagem mais cedo e entrava inteiro na lista
//     daquele dia (e sumia do dia original). Pedido do Roger em 10/10: o
//     principal nao tem data; quem tem data e cada entrega;
//   - sem programada e com coisa faltando: a data informada pra proxima
//     viagem, ou null (vai pro quadro "entregas sem data" — melhor que ficar
//     preso num dia que ja passou, invisivel);
//   - status = completo / entrega_parcial pelo que ja foi entregue.
import { supabaseAdmin } from '@/lib/supabase';

const STATUS_DE_ENTREGA = ['entrega_pendente', 'entrega_parcial', 'em_rota', 'ocorrencia', 'completo'];

export async function sincronizarPedidoEntregas(
  orcamentoId: string,
  opcoes: { dataProxima?: string | null } = {},
): Promise<{ status: string; data_entrega: string | null }> {
  const [{ data: orc }, { data: itens }, { data: programadas }] = await Promise.all([
    supabaseAdmin.from('orcamentos').select('status, data_entrega').eq('id', orcamentoId).single(),
    supabaseAdmin.from('orcamento_itens').select('quantidade, quantidade_entregue').eq('orcamento_id', orcamentoId),
    supabaseAdmin.from('entregas_parciais').select('data_entrega')
      .eq('orcamento_id', orcamentoId).eq('status', 'programada')
      .not('data_entrega', 'is', null)
      .order('data_entrega', { ascending: true }).limit(1),
  ]);
  if (!orc) throw new Error('pedido nao encontrado');

  let tudoEntregue = (itens?.length || 0) > 0;
  let algumEntregue = false;
  for (const it of itens || []) {
    const q = Number(it.quantidade) || 0;
    const e = Number(it.quantidade_entregue) || 0;
    if (e + 1e-9 < q) tudoEntregue = false;
    if (e > 1e-9) algumEntregue = true;
  }

  const update: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  let status = orc.status as string;
  if (STATUS_DE_ENTREGA.includes(status)) {
    status = tudoEntregue ? 'completo' : algumEntregue ? 'entrega_parcial' : (status === 'completo' ? 'entrega_pendente' : status);
    update.status = status;
  }

  let dataEntrega = (orc.data_entrega as string | null) ?? null;
  if (!tudoEntregue) {
    const temViagem = !!programadas?.[0]?.data_entrega;
    if (temViagem) dataEntrega = null;
    else if (opcoes.dataProxima !== undefined) dataEntrega = opcoes.dataProxima;
    update.data_entrega = dataEntrega;
  }

  const { error } = await supabaseAdmin.from('orcamentos').update(update).eq('id', orcamentoId);
  if (error) console.error('[entregas] falha ao sincronizar pedido', orcamentoId, error);
  return { status, data_entrega: dataEntrega };
}

// Quanto de cada item ainda nao esta nem entregue nem programado — o limite
// pra programar uma nova viagem.
export async function livreParaProgramar(orcamentoId: string, ignorarEntregaId?: string): Promise<Map<string, number>> {
  const [{ data: itens }, { data: progs }] = await Promise.all([
    supabaseAdmin.from('orcamento_itens').select('id, quantidade, quantidade_entregue').eq('orcamento_id', orcamentoId),
    supabaseAdmin.from('entregas_parciais')
      .select('id, entregas_parciais_itens ( orcamento_item_id, quantidade )')
      .eq('orcamento_id', orcamentoId).eq('status', 'programada'),
  ]);
  const livre = new Map<string, number>();
  for (const it of itens || []) livre.set(it.id, (Number(it.quantidade) || 0) - (Number(it.quantidade_entregue) || 0));
  for (const p of (progs || []) as Array<{ id: string; entregas_parciais_itens: Array<{ orcamento_item_id: string; quantidade: number }> }>) {
    if (p.id === ignorarEntregaId) continue;
    for (const i of p.entregas_parciais_itens || []) {
      livre.set(i.orcamento_item_id, (livre.get(i.orcamento_item_id) || 0) - (Number(i.quantidade) || 0));
    }
  }
  return livre;
}

type ItemPedido = { id?: unknown; quantidade?: unknown; quantidade_entregue?: unknown; unidade?: unknown; produto_nome?: unknown };
type ViagemPedido = {
  id?: unknown; numero_entrega?: unknown; status?: unknown; data_entrega?: unknown;
  entregas_parciais_itens?: Array<{ orcamento_item_id?: unknown; quantidade?: unknown }> | null;
};

function fmtItem(qtd: number, unidade: unknown, nome: unknown): string {
  const q = Number.isInteger(qtd) ? String(qtd) : String(Math.round(qtd * 100) / 100);
  return q + (unidade === 'unidade' ? 'x' : String(unidade || '')) + ' ' + String(nome || '');
}

// "Itens para carregar" de um pedido num dia — o que vai na folha de rota.
// Antes era sempre o pedido INTEIRO, e o time levava de novo o que ja tinha
// sido entregue (10/10). Agora:
//   1) viagem programada pra esse dia -> so os itens dela;
//   2) senao, se ja houve entrega     -> so o que falta;
//   3) senao                          -> o pedido todo.
export function cargaDoDia(itens: ItemPedido[] | null | undefined, viagens: ViagemPedido[] | null | undefined, dia: string | null) {
  const lista = itens || [];
  const viagem = (viagens || []).find(v => v.status === 'programada' && dia && String(v.data_entrega) === dia);
  if (viagem) {
    const porId = new Map(lista.map(i => [String(i.id), i]));
    const resumo = (viagem.entregas_parciais_itens || [])
      .map(vi => {
        const it = porId.get(String(vi.orcamento_item_id));
        return it ? fmtItem(Number(vi.quantidade) || 0, it.unidade, it.produto_nome) : null;
      })
      .filter((x): x is string => !!x)
      .join(', ');
    return { resumo, tipo: 'programada' as const, numero: Number(viagem.numero_entrega) || null, viagemId: String(viagem.id) };
  }
  const algumEntregue = lista.some(i => (Number(i.quantidade_entregue) || 0) > 1e-9);
  if (algumEntregue) {
    const resumo = lista
      .map(i => {
        const falta = (Number(i.quantidade) || 0) - (Number(i.quantidade_entregue) || 0);
        return falta > 1e-9 ? fmtItem(falta, i.unidade, i.produto_nome) : null;
      })
      .filter((x): x is string => !!x)
      .join(', ');
    return { resumo, tipo: 'restante' as const, numero: null, viagemId: null };
  }
  return {
    resumo: lista.map(i => fmtItem(Number(i.quantidade) || 0, i.unidade, i.produto_nome)).join(', '),
    tipo: 'completa' as const, numero: null, viagemId: null,
  };
}
