'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Pencil, Undo2, Trash2, CircleX, ChevronDown, ChevronUp, Repeat, CreditCard, Search } from 'lucide-react';
import type {
  ContaPagar, ContextoFinanceiro, GeracaoMes, ItemFolhaPrevisto, Metodo, NovaContaPagar, PagamentoConta,
  ResumoContasPagar, SituacaoConta,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import {
  brl, dataBR, dataCurta, hojeBRT, mesBRT, METODOS, rotuloMetodo, rotuloMes, somarDiasISO, primeiroDia, ultimoDia,
} from '@/lib/financeiro/formato';
import {
  Abas, Aviso, BotaoPerigo, BotaoPrimario, BotaoSecundario, Campo, CampoFornecedor, CampoMoeda, CampoNumero,
  Carregando, Cartao, Erro, Estatistica, INPUT, Modal, Selo, SeletorMes, Vazio, useContextoFinanceiro,
  type EscolhaFornecedor,
} from './Comuns';

// Contas a pagar: boletos, parcelas e faturas. "Paguei" e o toque mais comum
// do dia, entao o modal abre pronto (hoje, valor cheio, metodo e conta do
// fornecedor) e os detalhes ficam escondidos ate serem necessarios.

type Filtro = 'atrasadas' | 'hoje' | '7d' | 'mes' | 'todas' | 'pagas';

interface Resposta { contas: ContaPagar[]; resumo: ResumoContasPagar; folha_prevista: ItemFolhaPrevisto[] }

const SITUACAO: Record<SituacaoConta, { rotulo: string; tom: 'vermelho' | 'laranja' | 'cinza' | 'verde' | 'amarelo' }> = {
  atrasada: { rotulo: 'atrasada', tom: 'vermelho' },
  hoje: { rotulo: 'vence hoje', tom: 'laranja' },
  a_vencer: { rotulo: 'a vencer', tom: 'cinza' },
  paga: { rotulo: 'paga', tom: 'verde' },
  cancelada: { rotulo: 'cancelada', tom: 'cinza' },
  confirmar: { rotulo: 'já pagou?', tom: 'amarelo' },
};

// Dinheiro sai do caixa e credito vai pra conta do cartao; os outros metodos
// ficam na conta padrao do fornecedor (ou no primeiro banco).
export function contaParaMetodo(metodo: Metodo, atual: string | null, ctx: ContextoFinanceiro | null, padrao: string | null): string | null {
  if (!ctx) return atual;
  if (metodo === 'dinheiro') return ctx.conta_caixa_id ?? atual;
  if (metodo === 'credito') return ctx.conta_cartao_id ?? atual;
  const c = ctx.contas.find(x => x.id === atual);
  if (!c || c.tipo === 'caixa' || c.tipo === 'cartao_credito') {
    const p = ctx.contas.find(x => x.id === padrao);
    if (p && p.tipo !== 'caixa' && p.tipo !== 'cartao_credito') return p.id;
    return ctx.contas.find(x => x.tipo === 'banco' && x.ativo)?.id ?? atual;
  }
  return atual;
}

export default function ContasPagar() {
  const { contexto } = useContextoFinanceiro();
  const hoje = hojeBRT();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [mes, setMes] = useState(mesBRT());
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'alerta' | 'erro' | 'info'; texto: ReactNode } | null>(null);

  const [pagando, setPagando] = useState<ContaPagar | null>(null);
  const [editando, setEditando] = useState<{ conta: ContaPagar | null } | null>(null);
  const [cancelando, setCancelando] = useState<ContaPagar | null>(null);
  const [estornando, setEstornando] = useState<ContaPagar | null>(null);
  const [gerando, setGerando] = useState(false);
  const [mostrarFolha, setMostrarFolha] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (filtro === 'pagas') { p.set('status', 'pago'); p.set('competencia', mes); }
    else if (filtro === 'mes') { p.set('status', 'todas'); p.set('de', primeiroDia(mes)); p.set('ate', ultimoDia(mes)); }
    else p.set('status', 'pendente');
    return `/api/financeiro/contas-pagar?${p.toString()}`;
  }, [filtro, mes]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<Resposta>(url));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as contas');
    } finally {
      setCarregando(false);
    }
  }, [url]);

  useEffect(() => { carregar(); }, [carregar]);

  const contas = useMemo(() => dados?.contas ?? [], [dados]);
  const aConfirmar = contas.filter(c => c.precisa_confirmacao && c.status === 'pendente');

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const limite7 = somarDiasISO(hoje, 7);
    return contas
      .filter(c => {
        if (filtro === 'atrasadas') return c.situacao === 'atrasada';
        if (filtro === 'hoje') return c.situacao === 'hoje';
        if (filtro === '7d') return c.status === 'pendente' && !c.precisa_confirmacao && c.vencimento <= limite7;
        return true;
      })
      .filter(c => !q || [c.descricao, c.fornecedor_nome, c.categoria_nome, c.documento, c.observacoes]
        .some(x => (x ?? '').toLowerCase().includes(q)))
      .sort((a, b) => filtro === 'pagas'
        ? (b.data_pagamento ?? '').localeCompare(a.data_pagamento ?? '')
        : a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao));
  }, [contas, filtro, busca, hoje]);

  const totalLista = lista.reduce((a, c) => a + (c.status === 'pago' ? (c.valor_pago ?? c.valor) : c.status === 'cancelado' ? 0 : c.valor), 0);

  // ---------- acoes ----------
  const confirmarRetroativa = async (c: ContaPagar, jaPagou: boolean) => {
    setConfirmando(c.id);
    try {
      await apiFinanceiro('/api/financeiro/contas-pagar/acoes', {
        method: 'POST', body: JSON.stringify({ acao: 'confirmar', id: c.id, ja_pagou: jaPagou, ...(jaPagou ? { data: c.vencimento } : {}) }),
      });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao confirmar' });
    } finally {
      setConfirmando(null);
    }
  };

  const excluir = async (c: ContaPagar) => {
    if (!window.confirm(`Excluir "${c.descricao}" (${brl(c.valor)})? Só é possível para conta pendente ou cancelada sem lançamento vinculado.`)) return;
    try {
      await apiFinanceiro(`/api/financeiro/contas-pagar?id=${c.id}`, { method: 'DELETE' });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao excluir' });
    }
  };

  const gerarMes = async () => {
    setGerando(true);
    setAviso(null);
    try {
      const g = await apiFinanceiro<GeracaoMes>('/api/financeiro/contas-pagar/acoes', { method: 'POST', body: JSON.stringify({ acao: 'gerar_mes', mes }) });
      setAviso({
        tom: 'ok',
        texto: <>
          Contas de {rotuloMes(g.mes)}: {g.geradas} gerada(s), {g.ja_existiam} já existiam, {g.atualizadas} atualizada(s)
          {g.retroativas > 0 && <>, {g.retroativas} retroativa(s) aguardando “já pagou?”</>}.
          {g.ignoradas_sem_valor.length > 0 && <> Sem valor cadastrado (não geradas): {g.ignoradas_sem_valor.join(', ')}.</>}
        </>,
      });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao gerar as contas do mês' });
    } finally {
      setGerando(false);
    }
  };

  const gerarFatura = async () => {
    const cartao = contexto?.contas.find(c => c.id === contexto.conta_cartao_id) ?? contexto?.contas.find(c => c.tipo === 'cartao_credito');
    if (!cartao) { setAviso({ tom: 'alerta', texto: 'Não há conta de cartão de crédito cadastrada.' }); return; }
    if (!cartao.dia_fechamento || !cartao.dia_vencimento) {
      setAviso({ tom: 'alerta', texto: `A conta "${cartao.nome}" ainda não tem dia de fechamento e de vencimento. Peça para cadastrar os dois dias do cartão (hoje isso é feito pelo suporte) para gerar a fatura.` });
      return;
    }
    setGerando(true);
    setAviso(null);
    try {
      const f = await apiFinanceiro<ContaPagar | null>('/api/financeiro/contas-pagar/acoes', { method: 'POST', body: JSON.stringify({ acao: 'gerar_fatura', conta_id: cartao.id, mes }) });
      setAviso(f
        ? { tom: 'ok', texto: `Fatura de ${rotuloMes(mes)}: ${brl(f.valor)}, vence ${dataBR(f.vencimento)}.` }
        : { tom: 'info', texto: `Nenhuma compra no cartão sem fatura no ciclo de ${rotuloMes(mes)}.` });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao gerar a fatura' });
    } finally {
      setGerando(false);
    }
  };

  if (carregando && !dados) return <Carregando texto="Carregando contas a pagar…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const r = dados.resumo;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">Contas a pagar</h2>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <BotaoSecundario onClick={gerarMes} carregando={gerando} className="min-h-[40px]" title="Gera as contas das despesas fixas do mês escolhido">
            <Repeat className="w-4 h-4" /> Gerar contas do mês
          </BotaoSecundario>
          <BotaoSecundario onClick={gerarFatura} carregando={gerando} className="min-h-[40px]">
            <CreditCard className="w-4 h-4" /> Gerar fatura do cartão
          </BotaoSecundario>
          <BotaoPrimario onClick={() => setEditando({ conta: null })}>
            <Plus className="w-4 h-4" /> Nova conta
          </BotaoPrimario>
        </div>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && (
        <Aviso tom={aviso.tom}>
          <div className="flex items-start gap-2">
            <div className="flex-1">{aviso.texto}</div>
            <button type="button" onClick={() => setAviso(null)} className="text-xs underline shrink-0">fechar</button>
          </div>
        </Aviso>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Estatistica rotulo={`Atrasado (${r.qtd_atrasadas})`} valor={brl(r.atrasado)} tom={r.atrasado > 0 ? 'vermelho' : 'neutro'} />
        <Estatistica rotulo={`Hoje (${r.qtd_hoje})`} valor={brl(r.hoje)} tom={r.hoje > 0 ? 'laranja' : 'neutro'} />
        <Estatistica rotulo="Próximos 7 dias" valor={brl(r.proximos_7d)} />
        <Estatistica rotulo="Próximos 30 dias" valor={brl(r.proximos_30d)} detalhe={`pendente total ${brl(r.pendente_total)}`} />
        <Estatistica rotulo="Pago no mês" valor={brl(r.pago_no_mes)} tom="verde" detalhe="sem faturas de cartão" />
      </div>

      {/* Retroativas: nasceram vencidas na primeira geracao; nao contam como atraso ate alguem responder */}
      {aConfirmar.length > 0 && (
        <Cartao titulo={`Contas de ${rotuloMes(aConfirmar[0].competencia.slice(0, 7))}: já pagou?`}
          descricao="Geradas com vencimento no passado. Responda para elas entrarem no atrasado ou no pago.">
          <div className="space-y-2">
            {aConfirmar.map(c => (
              <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.descricao}</p>
                  <p className="text-xs text-gray-500">{c.fornecedor_nome ?? '—'} · venceu {dataBR(c.vencimento)} · {brl(c.valor)}</p>
                </div>
                <div className="flex gap-2 justify-end">
                  <BotaoSecundario onClick={() => confirmarRetroativa(c, false)} disabled={confirmando === c.id} className="min-h-[40px]">Ainda não</BotaoSecundario>
                  <BotaoPrimario onClick={() => confirmarRetroativa(c, true)} carregando={confirmando === c.id} className="min-h-[40px]">Sim, em {dataCurta(c.vencimento)}</BotaoPrimario>
                </div>
              </div>
            ))}
          </div>
        </Cartao>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <Abas<Filtro> valor={filtro} onChange={setFiltro} opcoes={[
          { key: 'atrasadas', rotulo: 'Atrasadas', contagem: filtro !== 'pagas' && filtro !== 'mes' ? contas.filter(c => c.situacao === 'atrasada').length : undefined },
          { key: 'hoje', rotulo: 'Hoje' },
          { key: '7d', rotulo: '7 dias' },
          { key: 'mes', rotulo: 'Mês' },
          { key: 'todas', rotulo: 'Todas' },
          { key: 'pagas', rotulo: 'Pagas' },
        ]} className="flex-1" />
        {(filtro === 'mes' || filtro === 'pagas') && <SeletorMes value={mes} onChange={setMes} futuros={2} />}
      </div>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por descrição, fornecedor, categoria ou documento"
          className={`${INPUT} pl-9 min-h-[44px]`} />
      </div>

      {lista.length === 0 ? (
        <Vazio>{carregando ? 'Carregando…' : 'Nenhuma conta neste filtro.'}</Vazio>
      ) : (
        <>
          <p className="text-xs text-gray-500">{lista.length} conta(s) · {brl(totalLista)}</p>
          <div className="space-y-2">
            {lista.map(c => (
              <CartaoContaPagar key={c.id} c={c}
                onPagar={c.status === 'pendente' ? () => setPagando(c) : undefined}
                extras={<>
                  {c.status === 'pendente' && (
                    <button type="button" onClick={() => setEditando({ conta: c })} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-600 hover:text-gray-900">
                      <Pencil className="w-3.5 h-3.5" /> Editar
                    </button>
                  )}
                  {c.status === 'pendente' && (
                    <button type="button" onClick={() => setCancelando(c)} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-600 hover:text-red-700">
                      <CircleX className="w-3.5 h-3.5" /> Cancelar
                    </button>
                  )}
                  {c.status === 'pago' && (
                    <button type="button" onClick={() => setEstornando(c)} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-600 hover:text-red-700">
                      <Undo2 className="w-3.5 h-3.5" /> Estornar
                    </button>
                  )}
                  {c.status !== 'pago' && !c.lancamento_id && (
                    <button type="button" onClick={() => excluir(c)} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-500 hover:text-red-700">
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                  )}
                </>} />
            ))}
          </div>
        </>
      )}

      {/* Folha prevista: somente leitura, a folha se paga em Funcionarios */}
      <Cartao titulo="Folha prevista" selo={<Selo tom="cinza">somente leitura</Selo>}
        descricao="Pagamentos de funcionários por vencer. Pague em Funcionários: eles aparecem aqui e no Dia sozinhos."
        acao={dados.folha_prevista.length > 0 && (
          <button type="button" onClick={() => setMostrarFolha(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px] px-2">
            {mostrarFolha ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {mostrarFolha ? 'ocultar' : `ver ${dados.folha_prevista.length}`}
          </button>
        )}>
        {dados.folha_prevista.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum pagamento de folha previsto.</p>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              Total previsto: <strong>{brl(dados.folha_prevista.reduce((a, f) => a + f.liquido, 0))}</strong>
              {' '}· próximo em {dataCurta([...dados.folha_prevista].sort((a, b) => a.data_pagamento.localeCompare(b.data_pagamento))[0].data_pagamento)}
            </p>
            {mostrarFolha && (
              <div className="mt-2 divide-y divide-gray-100">
                {dados.folha_prevista.map(f => (
                  <div key={`${f.funcionario_id}-${f.periodo_fim}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-800 truncate">{f.nome}</p>
                      <p className="text-xs text-gray-500">{f.frequencia} · {dataCurta(f.periodo_inicio)}–{dataCurta(f.periodo_fim)} · paga {dataBR(f.data_pagamento)}</p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="font-semibold text-gray-900">{brl(f.liquido)}</p>
                      {f.vales > 0 && <p className="text-[11px] text-gray-500">bruto {brl(f.bruto)} − vales {brl(f.vales)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Cartao>

      {pagando && <ModalPagarConta conta={pagando} onFechar={() => setPagando(null)} onSalvo={() => { setPagando(null); carregar(); }} />}
      {editando && <ModalContaForm conta={editando.conta} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
      {cancelando && <ModalCancelar conta={cancelando} onFechar={() => setCancelando(null)} onSalvo={() => { setCancelando(null); carregar(); }} />}
      {estornando && <ModalEstornar conta={estornando} onFechar={() => setEstornando(null)} onSalvo={() => { setEstornando(null); carregar(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- cartao

export function CartaoContaPagar({ c, onPagar, extras }: { c: ContaPagar; onPagar?: () => void; extras?: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const s = SITUACAO[c.situacao];
  const borda = c.situacao === 'atrasada' ? 'border-red-200' : c.situacao === 'hoje' ? 'border-orange-200' : c.situacao === 'confirmar' ? 'border-amber-200' : 'border-gray-100';
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-3 ${borda}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => setAberto(v => !v)} className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold text-gray-800 truncate">{c.descricao}</p>
          <p className="text-xs text-gray-500 truncate">
            {c.fornecedor_nome ?? 'sem fornecedor'}{c.categoria_nome ? ` · ${c.categoria_nome}` : ''}
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            <Selo tom={s.tom}>{s.rotulo}{c.situacao === 'atrasada' && c.dias_atraso > 0 ? ` ${c.dias_atraso}d` : ''}</Selo>
            {c.origem === 'fixa' && <Selo tom="azul">fixa</Selo>}
            {c.origem === 'fatura' && <Selo tom="roxo">fatura</Selo>}
            {c.parcelas_total && c.parcela_num && <Selo tom="cinza">{c.parcela_num}/{c.parcelas_total}</Selo>}
            {c.status === 'pago' && c.lancamento_id && <Selo tom="verde">conciliada</Selo>}
            {c.editada_manualmente && <Selo tom="cinza">editada</Selo>}
          </div>
        </button>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-500">{c.status === 'pago' && c.data_pagamento ? `pago ${dataCurta(c.data_pagamento)}` : `vence ${dataCurta(c.vencimento)}`}</p>
          <p className={`font-bold tabular-nums ${c.status === 'cancelado' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {brl(c.status === 'pago' ? (c.valor_pago ?? c.valor) : c.valor)}
          </p>
          {c.status === 'pago' && c.ajuste !== 0 && (
            <p className={`text-[11px] ${c.ajuste > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{c.ajuste > 0 ? `+${brl(c.ajuste)} juros/multa` : `${brl(c.ajuste)} desconto`}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 mt-2 flex-wrap">
        <button type="button" onClick={() => setAberto(v => !v)} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-500 mr-auto">
          {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} detalhes
        </button>
        {extras}
        {onPagar && <BotaoPrimario onClick={onPagar}>Paguei</BotaoPrimario>}
      </div>

      {aberto && (
        <dl className="mt-2 border-t border-gray-100 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-xs">
          <Detalhe r="Vencimento" v={dataBR(c.vencimento)} />
          <Detalhe r="Competência" v={rotuloMes(c.competencia.slice(0, 7))} />
          <Detalhe r="Valor" v={brl(c.valor)} />
          {c.status === 'pago' && <Detalhe r="Pago em" v={c.data_pagamento ? dataBR(c.data_pagamento) : '—'} />}
          {c.status === 'pago' && <Detalhe r="Como" v={`${rotuloMetodo(c.metodo_pagamento)}${c.conta_nome ? ` · ${c.conta_nome}` : ''}`} />}
          {c.documento && <Detalhe r="Documento" v={c.documento} />}
          {c.observacoes && <Detalhe r="Observações" v={c.observacoes} />}
          {c.estornado_em && <Detalhe r="Estornada" v={`${dataBR(c.estornado_em)}${c.estorno_motivo ? ` — ${c.estorno_motivo}` : ''}`} />}
        </dl>
      )}
    </div>
  );
}

function Detalhe({ r, v }: { r: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-400">{r}</dt>
      <dd className="text-gray-700 break-words">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- paguei

export function ModalPagarConta({ conta, onFechar, onSalvo }: { conta: ContaPagar; onFechar: () => void; onSalvo: () => void }) {
  const { contexto } = useContextoFinanceiro();
  const hoje = hojeBRT();
  const fornecedor = contexto?.fornecedores.find(f => f.id === conta.fornecedor_id) ?? null;
  const metodoInicial: Metodo = fornecedor?.metodo_padrao ?? conta.metodo_pagamento ?? 'pix';
  const [metodo, setMetodo] = useState<Metodo>(metodoInicial);
  const [contaId, setContaId] = useState<string | null>(contaParaMetodo(metodoInicial, fornecedor?.conta_padrao_id ?? null, contexto, fornecedor?.conta_padrao_id ?? null));
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState<number | null>(conta.valor);
  const [obs, setObs] = useState('');
  const [detalhes, setDetalhes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mudarMetodo = (m: Metodo) => {
    setMetodo(m);
    setContaId(contaParaMetodo(m, contaId, contexto, fornecedor?.conta_padrao_id ?? null));
  };

  const ajuste = (valor ?? conta.valor) - conta.valor;
  const contas = (contexto?.contas ?? []).filter(c => c.ativo);
  const contaSel = contas.find(c => c.id === contaId);

  const salvar = async () => {
    if (!valor || valor <= 0) { setErro('Informe o valor pago.'); return; }
    setSalvando(true);
    setErro(null);
    const pagamento: PagamentoConta = {
      data_pagamento: data, valor_pago: valor, metodo_pagamento: metodo, conta_id: contaId,
      ...(obs.trim() ? { observacoes: obs.trim() } : {}),
    };
    try {
      await apiFinanceiro('/api/financeiro/contas-pagar/acoes', { method: 'POST', body: JSON.stringify({ acao: 'pagar', id: conta.id, pagamento }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar o pagamento');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Paguei" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>{data === hoje ? 'Paguei hoje' : `Paguei em ${dataCurta(data)}`}</BotaoPrimario>
      </>}>
      <p className="text-sm font-medium text-gray-800">{conta.descricao}</p>
      <p className="text-xs text-gray-500">{conta.fornecedor_nome ?? 'sem fornecedor'} · vence {dataBR(conta.vencimento)} · <strong>{brl(conta.valor)}</strong></p>

      <Campo rotulo="Como pagou">
        <select value={metodo} onChange={e => mudarMetodo(e.target.value as Metodo)} className={INPUT}>
          {METODOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
      </Campo>
      <Campo rotulo="De qual conta" dica={contaSel?.tipo === 'caixa' ? 'Sai do caixa em espécie.' : contaSel?.tipo === 'cartao_credito' ? 'Vai pra fatura do cartão; o caixa só sai quando a fatura for paga.' : contaSel ? 'O extrato dessa conta vai conciliar este pagamento.' : undefined}>
        <select value={contaId ?? ''} onChange={e => setContaId(e.target.value || null)} className={INPUT}>
          <option value="">— sem conta —</option>
          {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Campo>

      {!detalhes ? (
        <button type="button" onClick={() => setDetalhes(true)} className="text-xs text-[#C96F00] hover:underline min-h-[40px]">
          editar detalhes (data, valor, observação)
        </button>
      ) : (
        <>
          <Campo rotulo="Data do pagamento">
            <input type="date" value={data} max={hoje} onChange={e => e.target.value && setData(e.target.value)} className={INPUT} />
          </Campo>
          <Campo rotulo="Valor pago" dica={Math.abs(ajuste) >= 0.01 ? (ajuste > 0 ? `+${brl(ajuste)} de juros/multa` : `${brl(ajuste)} de desconto`) : undefined}>
            <CampoMoeda value={valor} onChange={setValor} />
          </Campo>
          <Campo rotulo="Observação">
            <input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} />
          </Campo>
        </>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------------------------------------------------------- nova / editar / lancar

// `modo 'lancar'` e o "Lancar pagamento" do Dia: a conta nasce ja paga na
// data do dia. `conta` preenchido = edicao (pendente: tudo; paga: so
// documento e observacoes).
export function ModalContaForm({ conta, modo = 'conta', dataPadrao, onFechar, onSalvo }: {
  conta: ContaPagar | null; modo?: 'conta' | 'lancar'; dataPadrao?: string; onFechar: () => void; onSalvo: () => void;
}) {
  const { contexto } = useContextoFinanceiro();
  const hoje = hojeBRT();
  const dataBase = dataPadrao ?? hoje;
  const edicao = !!conta;
  const soAnotacoes = conta?.status === 'pago';
  const lancar = modo === 'lancar';

  const [descricao, setDescricao] = useState(conta?.descricao ?? '');
  const [fornecedor, setFornecedor] = useState<EscolhaFornecedor>({ id: conta?.fornecedor_id ?? null, nome: conta?.fornecedor_nome ?? '' });
  const [categoriaId, setCategoriaId] = useState<string>(conta?.categoria_id ?? '');
  const [valor, setValor] = useState<number | null>(conta?.valor ?? null);
  const [vencimento, setVencimento] = useState(conta?.vencimento ?? dataBase);
  const [competencia, setCompetencia] = useState((conta?.competencia ?? dataBase).slice(0, 7));
  const [documento, setDocumento] = useState(conta?.documento ?? '');
  const [obs, setObs] = useState(conta?.observacoes ?? '');
  const [parcelas, setParcelas] = useState<number | null>(1);
  const [jaPaga, setJaPaga] = useState(lancar);
  const [metodo, setMetodo] = useState<Metodo>('pix');
  const [contaId, setContaId] = useState<string | null>(contaParaMetodo('pix', null, contexto, null));
  const [dataPagamento, setDataPagamento] = useState(dataBase <= hoje ? dataBase : hoje);
  const [valorPago, setValorPago] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categorias = (contexto?.categorias ?? []).filter(c => c.grupo !== 'receita');
  const contas = (contexto?.contas ?? []).filter(c => c.ativo);
  const contaSel = contas.find(c => c.id === contaId);

  const mudarMetodo = (m: Metodo) => {
    setMetodo(m);
    const f = contexto?.fornecedores.find(x => x.id === fornecedor.id);
    setContaId(contaParaMetodo(m, contaId, contexto, f?.conta_padrao_id ?? null));
  };

  const salvar = async () => {
    setErro(null);
    if (!soAnotacoes) {
      if (!descricao.trim()) { setErro('Descreva a conta.'); return; }
      if (!valor || valor <= 0) { setErro('Informe o valor.'); return; }
      if (!vencimento) { setErro('Informe o vencimento.'); return; }
    }
    setSalvando(true);
    try {
      if (edicao && conta) {
        const corpo: Partial<NovaContaPagar> & { id: string } = soAnotacoes
          ? { id: conta.id, documento: documento.trim() || null, observacoes: obs.trim() || null }
          : {
            id: conta.id, descricao: descricao.trim(), valor: valor!, vencimento, competencia,
            categoria_id: categoriaId || null,
            ...(fornecedor.id ? { fornecedor_id: fornecedor.id } : fornecedor.nome.trim() ? { fornecedor_nome: fornecedor.nome.trim(), fornecedor_id: null } : { fornecedor_id: null }),
            documento: documento.trim() || null, observacoes: obs.trim() || null,
          };
        await apiFinanceiro('/api/financeiro/contas-pagar', { method: 'PATCH', body: JSON.stringify(corpo) });
      } else {
        const n = Math.max(1, Math.trunc(parcelas ?? 1));
        const corpo: NovaContaPagar = {
          descricao: descricao.trim(), valor: valor!, vencimento, competencia,
          categoria_id: categoriaId || null,
          ...(fornecedor.id ? { fornecedor_id: fornecedor.id } : fornecedor.nome.trim() ? { fornecedor_nome: fornecedor.nome.trim() } : {}),
          documento: documento.trim() || null, observacoes: obs.trim() || null,
          // Parcelado manda um id gerado aqui: reenviar o formulario nao
          // duplica as parcelas.
          ...(n > 1 ? { parcelas: n, grupo_parcelas_id: crypto.randomUUID() } : {}),
          ...(jaPaga ? {
            pagamento: {
              data_pagamento: dataPagamento, metodo_pagamento: metodo, conta_id: contaId,
              ...(valorPago !== null && Math.abs(valorPago - valor!) >= 0.01 ? { valor_pago: valorPago } : {}),
            },
          } : {}),
        };
        await apiFinanceiro('/api/financeiro/contas-pagar', { method: 'POST', body: JSON.stringify(corpo) });
      }
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a conta');
    } finally {
      setSalvando(false);
    }
  };

  const titulo = lancar ? 'Lançar pagamento' : edicao ? 'Editar conta' : 'Nova conta';

  return (
    <Modal titulo={titulo} onFechar={onFechar} largura="md"
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>{lancar ? 'Lançar' : 'Salvar'}</BotaoPrimario>
      </>}>
      {lancar && <p className="text-xs text-gray-500">Um pagamento feito que não veio de boleto cadastrado: compra no mercado, frete avulso, compra no cartão. Dinheiro sai do caixa; cartão de crédito vai pra fatura.</p>}
      {soAnotacoes && <Aviso tom="info">Conta paga: só documento e observações podem mudar. Para alterar valor ou data, estorne e pague de novo.</Aviso>}

      <Campo rotulo="Descrição">
        <input value={descricao} onChange={e => setDescricao(e.target.value)} className={INPUT} disabled={soAnotacoes} autoFocus={!edicao} placeholder="ex.: Cimento Votoran NF 1234" />
      </Campo>
      <Campo rotulo="Fornecedor">
        <CampoFornecedor fornecedores={contexto?.fornecedores ?? []} value={fornecedor}
          onChange={(f, forn) => {
            setFornecedor(f);
            if (forn) {
              if (!categoriaId && forn.categoria_padrao_id) setCategoriaId(forn.categoria_padrao_id);
              if (forn.metodo_padrao) { setMetodo(forn.metodo_padrao); setContaId(contaParaMetodo(forn.metodo_padrao, forn.conta_padrao_id, contexto, forn.conta_padrao_id)); }
            }
          }} />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Categoria">
          <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} className={INPUT} disabled={soAnotacoes}>
            <option value="">— sem categoria —</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Valor">
          <CampoMoeda value={valor} onChange={v => { setValor(v); if (valorPago === null || valorPago === valor) setValorPago(v); }} disabled={soAnotacoes} />
        </Campo>
      </div>
      {!lancar && (
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Vencimento">
            <input type="date" value={vencimento} onChange={e => { if (e.target.value) { setVencimento(e.target.value); setCompetencia(e.target.value.slice(0, 7)); } }} className={INPUT} disabled={soAnotacoes} />
          </Campo>
          <Campo rotulo="Competência" dica="Mês a que a despesa se refere.">
            <SeletorMes value={competencia} onChange={setCompetencia} futuros={3} className="w-full" />
          </Campo>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Documento (NF/boleto)">
          <input value={documento} onChange={e => setDocumento(e.target.value)} className={INPUT} />
        </Campo>
        {!edicao && !lancar && (
          <Campo rotulo="Parcelas" dica={parcelas && parcelas > 1 ? `${parcelas} contas mensais de ${brl((valor ?? 0))}` : undefined}>
            <CampoNumero value={parcelas} onChange={setParcelas} min={1} max={60} sufixo="x" />
          </Campo>
        )}
      </div>
      <Campo rotulo="Observações">
        <input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} />
      </Campo>

      {!edicao && (
        <div className="border-t border-gray-100 pt-3 space-y-3">
          {!lancar && (
            <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[40px] cursor-pointer select-none">
              <input type="checkbox" checked={jaPaga} onChange={e => setJaPaga(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" />
              Já está paga
            </label>
          )}
          {jaPaga && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Pago em">
                  <input type="date" value={dataPagamento} max={hoje} onChange={e => e.target.value && setDataPagamento(e.target.value)} className={INPUT} />
                </Campo>
                <Campo rotulo="Como">
                  <select value={metodo} onChange={e => mudarMetodo(e.target.value as Metodo)} className={INPUT}>
                    {METODOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                </Campo>
              </div>
              <Campo rotulo="De qual conta" dica={contaSel?.tipo === 'caixa' ? 'Sai do caixa em espécie.' : contaSel?.tipo === 'cartao_credito' ? 'Vai pra fatura do cartão.' : undefined}>
                <select value={contaId ?? ''} onChange={e => setContaId(e.target.value || null)} className={INPUT}>
                  <option value="">— sem conta —</option>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              {!lancar && (
                <Campo rotulo="Valor pago (se diferente)">
                  <CampoMoeda value={valorPago} onChange={setValorPago} />
                </Campo>
              )}
            </>
          )}
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------------------------------------------------------- cancelar / estornar

function ModalCancelar({ conta, onFechar, onSalvo }: { conta: ContaPagar; onFechar: () => void; onSalvo: () => void }) {
  const [escopo, setEscopo] = useState<'esta' | 'esta_e_seguintes'>('esta');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const parcelada = !!conta.grupo_parcelas_id;
  const cancelar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/contas-pagar/acoes', { method: 'POST', body: JSON.stringify({ acao: 'cancelar', id: conta.id, ...(parcelada ? { escopo } : {}) }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal titulo="Cancelar conta" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Voltar</BotaoSecundario>
        <BotaoPerigo onClick={cancelar} carregando={salvando}>Cancelar conta</BotaoPerigo>
      </>}>
      <p className="text-sm text-gray-700">{conta.descricao} · {brl(conta.valor)} · vence {dataBR(conta.vencimento)}</p>
      <p className="text-xs text-gray-500">A conta fica como cancelada (não some do histórico) e sai do a pagar.</p>
      {parcelada && (
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2 min-h-[40px] cursor-pointer">
            <input type="radio" name="escopo" checked={escopo === 'esta'} onChange={() => setEscopo('esta')} className="accent-[#F7941D]" />
            Só esta parcela{conta.parcela_num && conta.parcelas_total ? ` (${conta.parcela_num}/${conta.parcelas_total})` : ''}
          </label>
          <label className="flex items-center gap-2 min-h-[40px] cursor-pointer">
            <input type="radio" name="escopo" checked={escopo === 'esta_e_seguintes'} onChange={() => setEscopo('esta_e_seguintes')} className="accent-[#F7941D]" />
            Esta e as seguintes
          </label>
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

function ModalEstornar({ conta, onFechar, onSalvo }: { conta: ContaPagar; onFechar: () => void; onSalvo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const estornar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/contas-pagar/acoes', { method: 'POST', body: JSON.stringify({ acao: 'estornar', id: conta.id, motivo: motivo.trim() || null }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao estornar');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal titulo="Estornar pagamento" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Voltar</BotaoSecundario>
        <BotaoPerigo onClick={estornar} carregando={salvando}>Estornar</BotaoPerigo>
      </>}>
      <p className="text-sm text-gray-700">{conta.descricao} · pago {brl(conta.valor_pago ?? conta.valor)}{conta.data_pagamento ? ` em ${dataBR(conta.data_pagamento)}` : ''}</p>
      <p className="text-xs text-gray-500">
        A conta volta a pendente. Lançamento de caixa/cartão criado por este pagamento é apagado;
        {conta.lancamento_id ? ' a linha do extrato continua existindo, só perde o vínculo.' : ' se havia linha de extrato vinculada, ela só perde o vínculo.'}
      </p>
      <Campo rotulo="Motivo (opcional)">
        <input value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT} placeholder="ex.: paguei a conta errada" autoFocus />
      </Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
