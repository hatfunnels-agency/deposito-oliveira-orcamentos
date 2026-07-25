'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Wallet, Clock, TrendingUp, X } from 'lucide-react';

interface ContaAberta {
  id: string;
  codigo: string | null;
  cliente_id: string | null;
  cliente_nome: string;
  cliente_telefone: string | null;
  total: number;
  valor_pago: number;
  saldo: number;
  status: string;
  status_pagamento: string | null;
  condicao_pagamento: string | null;
  vencimento: string | null;
  entregue_sem_pagamento?: boolean;
  entregue: boolean;
  vencido: boolean;
  dias_em_aberto: number;
}

interface TriagemParcial {
  id: string;
  codigo: string | null;
  cliente_nome: string;
  total: number;
}

interface Resumo {
  recebido_periodo: number;
  recebido_por_metodo: Record<string, number>;
  total_a_receber: number;
  vencido: number;
  a_vencer: number;
  sem_prazo: number;
  entregue_nao_pago: number;
  qtd_a_receber: number;
  qtd_vencidos: number;
  qtd_entregue_nao_pago: number;
}

interface FinanceiroData {
  periodo_dias: number;
  resumo: Resumo;
  em_aberto: ContaAberta[];
  triagem_parcial: TriagemParcial[];
}

const METODOS = [
  { v: 'pix', l: '📱 Pix' },
  { v: 'debito', l: '💳 Débito' },
  { v: 'credito', l: '💳 Crédito' },
  { v: 'dinheiro', l: '💵 Dinheiro' },
  { v: 'transferencia', l: '🏦 Transferência' },
  { v: 'boleto', l: '📄 Boleto' },
  { v: 'outro', l: 'Outro' },
];

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Filtro = 'todos' | 'vencidos' | 'entregues';

// `simples` = visao da atendente: sem os cartoes gerenciais (recebido no
// periodo, quebra por metodo), so a gestao dos pedidos a receber.
// `onAbrirPedido` abre o modal de detalhe do pedido (com itens) — vive no
// OrcamentoApp e e passado por prop pra as linhas ficarem clicaveis.
export default function FinanceiroTab({
  simples = false,
  onAbrirPedido,
}: {
  simples?: boolean;
  onAbrirPedido?: (id: string) => void;
}) {
  const [data, setData] = useState<FinanceiroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dias, setDias] = useState(30);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [cobrando, setCobrando] = useState<ContaAberta | null>(null);
  // Conciliacao do dia e uma visao gerencial (oculta no modo simples).
  const [modo, setModo] = useState<'receber' | 'conciliacao'>('receber');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/financeiro?dias=${dias}`);
      setData(await res.json());
    } catch (e) {
      console.error('Erro ao carregar financeiro:', e);
    } finally {
      setLoading(false);
    }
  }, [dias]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (loading && !data) {
    return <div className="p-8 text-center text-gray-400">Carregando…</div>;
  }
  if (!data) {
    return <div className="p-8 text-center text-red-500">Erro ao carregar o financeiro.</div>;
  }

  const { resumo, em_aberto, triagem_parcial } = data;

  const lista = em_aberto.filter(c =>
    filtro === 'vencidos' ? c.vencido : filtro === 'entregues' ? c.entregue : true,
  );

  return (
    <div className="px-4 pt-4 pb-8 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">
          {simples ? 'Pedidos a receber' : modo === 'conciliacao' ? 'Conciliação do dia' : 'Financeiro'}
        </h2>
        <div className="flex items-center gap-2">
          {!simples && (
            <div className="flex bg-gray-100 rounded-lg p-0.5 text-sm">
              <button
                onClick={() => setModo('receber')}
                className={`px-3 py-1 rounded-md transition ${modo === 'receber' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                A receber
              </button>
              <button
                onClick={() => setModo('conciliacao')}
                className={`px-3 py-1 rounded-md transition ${modo === 'conciliacao' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Conciliação do dia
              </button>
            </div>
          )}
          {!simples && modo === 'receber' && (
            <select
              value={dias}
              onChange={e => setDias(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          )}
        </div>
      </div>

      {!simples && modo === 'conciliacao' ? (
        <Conciliacao onAbrirPedido={onAbrirPedido} />
      ) : (
      <>
      {/* ===== visao "A receber" (padrao) ===== */}

      {/* Cards de resumo. Na visao simples, sem o "Recebido no periodo"
          (metrica gerencial) — so o que a atendente precisa perseguir. */}
      <div className={`grid gap-3 ${simples ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {!simples && (
          <Card
            icon={<TrendingUp className="w-4 h-4" />}
            titulo={`Recebido (${dias}d)`}
            valor={brl(resumo.recebido_periodo)}
            cor="text-green-700 bg-green-50 border-green-200"
          />
        )}
        <Card
          icon={<Wallet className="w-4 h-4" />}
          titulo="A receber"
          valor={brl(resumo.total_a_receber)}
          rodape={`${resumo.qtd_a_receber} pedido(s)`}
          cor="text-blue-700 bg-blue-50 border-blue-200"
        />
        <Card
          icon={<Clock className="w-4 h-4" />}
          titulo="Vencido"
          valor={brl(resumo.vencido)}
          rodape={`${resumo.qtd_vencidos} pedido(s)`}
          cor="text-red-700 bg-red-50 border-red-200"
        />
        <Card
          icon={<AlertTriangle className="w-4 h-4" />}
          titulo="Entregue e não pago"
          valor={brl(resumo.entregue_nao_pago)}
          rodape={`${resumo.qtd_entregue_nao_pago} pedido(s)`}
          cor="text-orange-700 bg-orange-50 border-orange-200"
        />
      </div>

      {/* Recebido por metodo — detalhe gerencial, oculto na visao simples */}
      {!simples && Object.keys(resumo.recebido_por_metodo).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(resumo.recebido_por_metodo)
            .sort((a, b) => b[1] - a[1])
            .map(([metodo, valor]) => (
              <span
                key={metodo}
                className="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1"
              >
                {METODOS.find(m => m.v === metodo)?.l ?? metodo}: {brl(valor)}
              </span>
            ))}
        </div>
      )}

      {/* Lacuna herdada: 'parcial' sem valor registrado */}
      {triagem_parcial.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-900 mb-1">
            ⚠️ {triagem_parcial.length} pedido(s) marcados como &quot;pagamento parcial&quot; sem
            valor registrado
          </p>
          <p className="text-xs text-yellow-800 mb-2">
            Vêm de antes do controle de recebíveis existir — ninguém anotou quanto entrou.
            Registre o pagamento pra fechar o saldo.
          </p>
          <div className="flex flex-wrap gap-2">
            {triagem_parcial.map(t => (
              <span key={t.id} className="text-xs bg-white border border-yellow-300 rounded-lg px-2 py-1">
                {t.codigo} · {t.cliente_nome} · {brl(t.total)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2">
        {([
          ['todos', `Todos (${em_aberto.length})`],
          ['vencidos', `Vencidos (${resumo.qtd_vencidos})`],
          ['entregues', `Entregues (${resumo.qtd_entregue_nao_pago})`],
        ] as [Filtro, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={`text-sm px-3 py-1.5 rounded-lg transition ${
              filtro === k
                ? 'bg-[#F7941D] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Contas em aberto */}
      {lista.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          Nenhuma conta em aberto neste filtro. 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(c => (
            <div
              key={c.id}
              className={`border rounded-xl p-3 flex items-center justify-between gap-3 ${
                c.vencido
                  ? 'border-red-300 bg-red-50'
                  : c.entregue
                  ? 'border-orange-200 bg-orange-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-800 truncate">
                  {c.cliente_nome}
                </p>
                <p className="text-xs text-gray-500">
                  {c.codigo} · {c.dias_em_aberto}d em aberto
                  {c.vencimento && ` · vence ${c.vencimento.split('-').reverse().join('/')}`}
                  {c.entregue && ' · 🚚 já entregue'}
                </p>
                {c.entregue_sem_pagamento && (
                  <span className="inline-block text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-0.5">
                    ⚠️ entregue sem pagamento
                  </span>
                )}
                {c.valor_pago > 0 && (
                  <p className="text-xs text-gray-500">
                    Pago {brl(c.valor_pago)} de {brl(c.total)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="font-bold text-sm text-gray-900">{brl(c.saldo)}</p>
                  <p className="text-[10px] text-gray-400">em aberto</p>
                </div>
                {c.cliente_telefone && (
                  <a
                    href={`https://wa.me/55${c.cliente_telefone.replace(/\D/g, '')}?text=${encodeURIComponent(
                      `Olá ${c.cliente_nome}, tudo bem? Passando pra lembrar do saldo em aberto do pedido ${c.codigo}: ${brl(c.saldo)}. Qualquer dúvida é só chamar!`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-green-600 text-white px-2 py-1.5 rounded-lg hover:bg-green-700 transition"
                  >
                    Cobrar
                  </a>
                )}
                <button
                  onClick={() => setCobrando(c)}
                  className="text-xs bg-[#F7941D] text-white px-3 py-1.5 rounded-lg hover:bg-[#E8850A] transition"
                >
                  Registrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      </>
      )}

      {cobrando && (
        <ModalPagamento
          conta={cobrando}
          onFechar={() => setCobrando(null)}
          onSalvo={() => {
            setCobrando(null);
            carregar();
          }}
        />
      )}
    </div>
  );
}

// ===== Conciliacao bancaria das vendas do dia =====
interface PagamentoDia {
  id: string;
  valor: number;
  metodo: string;
  parcelas: number;
  data_pagamento: string;
  origem: string;
  observacoes: string | null;
  orcamento_id: string;
  codigo: string;
  status: string | null;
  tipo_entrega: string | null;
  cliente_nome: string;
}
interface ConciliacaoData {
  data: string;
  total: number;
  quantidade: number;
  por_metodo: Record<string, { total: number; qtd: number }>;
  pagamentos: PagamentoDia[];
}

// data local do navegador no formato YYYY-MM-DD (deposito opera em BRT).
const hojeInputBRT = () => new Date().toLocaleDateString('en-CA');

function Conciliacao({ onAbrirPedido }: { onAbrirPedido?: (id: string) => void }) {
  const [dia, setDia] = useState<string>(hojeInputBRT());
  const [dados, setDados] = useState<ConciliacaoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroMetodo, setFiltroMetodo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/financeiro/conciliacao?data=${dia}`);
      const json = await res.json();
      setDados(res.ok ? json : null);
    } catch (e) {
      console.error('Erro ao carregar conciliacao:', e);
      setDados(null);
    } finally {
      setLoading(false);
    }
  }, [dia]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const mudarDia = (delta: number) => {
    const d = new Date(`${dia}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDia(d.toLocaleDateString('en-CA'));
    setFiltroMetodo(null);
  };

  const metodosPresentes = dados
    ? Object.entries(dados.por_metodo).sort((a, b) => b[1].total - a[1].total)
    : [];
  const listaFiltrada = dados
    ? dados.pagamentos.filter(p => !filtroMetodo || p.metodo === filtroMetodo)
    : [];
  const labelMetodo = (m: string) => METODOS.find(x => x.v === m)?.l ?? m;
  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => mudarDia(-1)} className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm">‹</button>
        <input
          type="date"
          value={dia}
          onChange={e => { setDia(e.target.value); setFiltroMetodo(null); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
        />
        <button onClick={() => mudarDia(1)} className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm">›</button>
        <button onClick={() => { setDia(hojeInputBRT()); setFiltroMetodo(null); }} className="text-xs text-[#F7941D] hover:underline ml-1">hoje</button>
      </div>

      {loading && !dados ? (
        <div className="p-8 text-center text-gray-400">Carregando…</div>
      ) : !dados ? (
        <div className="p-8 text-center text-red-500">Erro ao carregar a conciliação.</div>
      ) : (
        <>
          {/* Total do dia + total por metodo (cartao clicavel = filtro) */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card
              icon={<TrendingUp className="w-4 h-4" />}
              titulo="Total do dia"
              valor={brl(dados.total)}
              rodape={`${dados.quantidade} pagamento(s)`}
              cor="text-green-700 bg-green-50 border-green-200"
            />
            {metodosPresentes.map(([m, info]) => (
              <button key={m} onClick={() => setFiltroMetodo(filtroMetodo === m ? null : m)} className="text-left">
                <div className={`border rounded-xl p-3 transition ${filtroMetodo === m ? 'ring-2 ring-[#F7941D] border-[#F7941D] bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className="text-xs font-medium text-gray-500">{labelMetodo(m)}</div>
                  <p className="text-lg font-bold mt-1 text-gray-900">{brl(info.total)}</p>
                  <p className="text-[11px] text-gray-400">{info.qtd} pagamento(s)</p>
                </div>
              </button>
            ))}
          </div>

          {metodosPresentes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setFiltroMetodo(null)} className={`text-sm px-3 py-1.5 rounded-lg transition ${filtroMetodo === null ? 'bg-[#F7941D] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                Todos ({dados.quantidade})
              </button>
              {metodosPresentes.map(([m, info]) => (
                <button key={m} onClick={() => setFiltroMetodo(m)} className={`text-sm px-3 py-1.5 rounded-lg transition ${filtroMetodo === m ? 'bg-[#F7941D] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {labelMetodo(m)} ({info.qtd})
                </button>
              ))}
            </div>
          )}

          {listaFiltrada.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Nenhum pagamento neste dia/filtro.</div>
          ) : (
            <div className="space-y-2">
              {listaFiltrada.map(p => (
                <button
                  key={p.id}
                  onClick={() => onAbrirPedido?.(p.orcamento_id)}
                  className="w-full text-left border border-gray-200 bg-white rounded-xl p-3 flex items-center justify-between gap-3 hover:border-[#F7941D] hover:bg-orange-50/40 transition"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-800 truncate">{p.cliente_nome}</p>
                    <p className="text-xs text-gray-500">
                      {hora(p.data_pagamento)} · {p.codigo}
                      {p.tipo_entrega ? ` · ${p.tipo_entrega === 'retirada' ? 'retirada' : 'entrega'}` : ''}
                      {p.valor < 0 ? ' · estorno' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 whitespace-nowrap">{labelMetodo(p.metodo)}</span>
                    <p className={`font-bold text-sm ${p.valor < 0 ? 'text-red-600' : 'text-gray-900'}`}>{brl(p.valor)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({
  icon,
  titulo,
  valor,
  rodape,
  cor,
}: {
  icon: React.ReactNode;
  titulo: string;
  valor: string;
  rodape?: string;
  cor: string;
}) {
  return (
    <div className={`border rounded-xl p-3 ${cor}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {titulo}
      </div>
      <p className="text-lg font-bold mt-1">{valor}</p>
      {rodape && <p className="text-[11px] opacity-70">{rodape}</p>}
    </div>
  );
}

function ModalPagamento({
  conta,
  onFechar,
  onSalvo,
}: {
  conta: ContaAberta;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [valor, setValor] = useState(String(conta.saldo.toFixed(2)));
  const [metodo, setMetodo] = useState('pix');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/pagamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orcamento_id: conta.id,
          valor: Number(valor.replace(',', '.')),
          metodo,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? 'Erro ao registrar pagamento');
        return;
      }
      onSalvo();
    } catch {
      setErro('Erro de conexão');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800">Registrar pagamento</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-1">
          {conta.cliente_nome} · {conta.codigo}
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Total {brl(conta.total)} · já pago {brl(conta.valor_pago)} ·{' '}
          <strong>em aberto {brl(conta.saldo)}</strong>
        </p>

        <label className="block text-xs font-medium text-gray-600 mb-1">Valor recebido</label>
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={e => setValor(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-3 text-sm"
        />

        <label className="block text-xs font-medium text-gray-600 mb-1">Forma</label>
        <select
          value={metodo}
          onChange={e => setMetodo(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-4 text-sm"
        >
          {METODOS.map(m => (
            <option key={m.v} value={m.v}>
              {m.l}
            </option>
          ))}
        </select>

        {erro && <p className="text-xs text-red-600 mb-3">{erro}</p>}

        <button
          onClick={salvar}
          disabled={salvando}
          className="w-full bg-[#F7941D] text-white rounded-lg py-2.5 font-medium hover:bg-[#E8850A] transition disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Confirmar recebimento'}
        </button>
      </div>
    </div>
  );
}
