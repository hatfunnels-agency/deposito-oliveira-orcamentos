'use client';

import { useState, useEffect, useCallback } from 'react';

interface ResumoData {
  total_faturado: number;
  total_subtotal: number;
  total_frete: number;
  qtd_vendas: number;
  qtd_orcamentos: number;
  qtd_cancelados: number;
  ticket_medio: number;
  cmv_total: number;
  lucro_bruto: number;
  margem_bruta_pct: number;
  total_filtrado_produto: number;
  qtd_filtrado_produto: number;
}

interface ProdutoStat {
  nome: string;
  qtd: number;
  receita: number;
  custo: number;
  margem_valor: number;
  margem_pct: number;
}

interface EvolucaoDia {
  dia: string;
  faturado: number;
  pedidos: number;
  cmv: number;
}

interface BreakdownItem {
  qtd: number;
  total: number;
}

interface DashboardData {
  periodo: { inicio: string; fim: string };
  resumo: ResumoData;
  top_produtos: ProdutoStat[];
  status_breakdown: Record<string, BreakdownItem>;
  pagamento_breakdown: Record<string, BreakdownItem>;
  entrega_breakdown: Record<string, number>;
  canal_breakdown: Record<string, BreakdownItem>;
  evolucao_diaria: EvolucaoDia[];
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(v: number) {
  return v.toFixed(1) + '%';
}

function calcDelta(atual: number, anterior: number): { pct: number; direction: 'up' | 'down' | 'same' } {
  if (anterior === 0 && atual === 0) return { pct: 0, direction: 'same' };
  if (anterior === 0) return { pct: 100, direction: 'up' };
  const pct = ((atual - anterior) / anterior) * 100;
  return { pct: Math.abs(pct), direction: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'same' };
}

function DeltaBadge({ atual, anterior, invertColor }: { atual: number; anterior: number; invertColor?: boolean }) {
  const { pct, direction } = calcDelta(atual, anterior);
  if (direction === 'same') return <span className="text-xs text-gray-400 ml-1">—</span>;
  const isGood = invertColor ? direction === 'down' : direction === 'up';
  const colorClass = isGood ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';
  const arrow = direction === 'up' ? '\u2191' : '\u2193';
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded-full ml-2 ${colorClass}`}>
      {arrow} {pct.toFixed(1)}%
    </span>
  );
}

function getPreviousPeriod(inicio: string, fim: string): { inicio: string; fim: string } {
  const d1 = new Date(inicio + 'T12:00:00');
  const d2 = new Date(fim + 'T12:00:00');
  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffMs / 86400000) + 1;
  const prevFim = new Date(d1.getTime() - 86400000);
  const prevInicio = new Date(prevFim.getTime() - (diffDays - 1) * 86400000);
  return {
    inicio: prevInicio.toISOString().split('T')[0],
    fim: prevFim.toISOString().split('T')[0]
  };
}

const STATUS_LABEL: Record<string, string> = {
  entrega_pendente: 'Entrega Pendente',
  em_entrega: 'Em Rota',
  retirada_pendente: 'Retirada Pendente',
  completo: 'Completo',
};

const STATUS_COLOR: Record<string, string> = {
  entrega_pendente: 'bg-blue-100 text-blue-800',
  em_entrega: 'bg-purple-100 text-purple-800',
  retirada_pendente: 'bg-yellow-100 text-yellow-800',
  completo: 'bg-green-100 text-green-800',
};

const PAGAMENTO_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'D\u00e9bito',
  credito: 'Cr\u00e9dito',
  boleto: 'Boleto',
  pagamento_na_entrega: 'Na Entrega',
  nao_informado: 'N\u00e3o Informado',
};

export default function DashboardTab() {
  const hoje = new Date().toISOString().split('T')[0];
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [dataInicio, setDataInicio] = useState(trintaDiasAtras);
  const [dataFim, setDataFim] = useState(hoje);
  const [filtroProduto, setFiltroProduto] = useState('');
  const [listaProdutos, setListaProdutos] = useState<string[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [compararPeriodo, setCompararPeriodo] = useState(false);
  const [dadosAnteriores, setDadosAnteriores] = useState<DashboardData | null>(null);

  // Load product list for dropdown
  useEffect(() => {
    fetch('/api/produtos', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const nomes = (d.produtos || []).map((p: { nome: string }) => p.nome).sort();
        setListaProdutos(nomes);
      })
      .catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
      if (filtroProduto) params.set('produto', filtroProduto);

      const res = await fetch('/api/dashboard?' + params.toString(), { cache: 'no-store' });
      const json = await res.json();
      if (json.error) { setErro(json.error); setData(null); }
      else setData(json);

      // Fetch previous period data if comparison is enabled
      if (compararPeriodo) {
        const prev = getPreviousPeriod(dataInicio, dataFim);
        const prevParams = new URLSearchParams({ data_inicio: prev.inicio, data_fim: prev.fim });
        if (filtroProduto) prevParams.set('produto', filtroProduto);
        const prevRes = await fetch('/api/dashboard?' + prevParams.toString(), { cache: 'no-store' });
        const prevJson = await prevRes.json();
        if (!prevJson.error) setDadosAnteriores(prevJson);
        else setDadosAnteriores(null);
      } else {
        setDadosAnteriores(null);
      }
    } catch {
      setErro('Erro ao carregar dados.');
    }
    setLoading(false);
  }, [dataInicio, dataFim, filtroProduto, compararPeriodo]);

  useEffect(() => { carregar(); }, [carregar]);

  const setPreset = (preset: string) => {
    const h = new Date().toISOString().split('T')[0];
    const now = new Date();
    if (preset === 'hoje') { setDataInicio(h); setDataFim(h); }
    else if (preset === '7d') {
      setDataInicio(new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]);
      setDataFim(h);
    } else if (preset === '30d') {
      setDataInicio(new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0]);
      setDataFim(h);
    } else if (preset === 'mes') {
      setDataInicio(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
      setDataFim(h);
    } else if (preset === 'mes_ant') {
      setDataInicio(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]);
      setDataFim(new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]);
    }
  };

  const r = data?.resumo;
  const rPrev = dadosAnteriores?.resumo;
  const statusVendas = data ? Object.fromEntries(Object.entries(data.status_breakdown)) : {};
  const prevPeriodo = compararPeriodo ? getPreviousPeriod(dataInicio, dataFim) : null;

  return (
    <div className="space-y-6 pb-10">
      {/* FILTROS */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-800 mb-4">&#128197; Filtros</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data Inicial</label>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data Final</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
          </div>
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Filtrar por Produto</label>
            <select value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white">
              <option value="">Todos os produtos</option>
              {listaProdutos.map(nome => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
          </div>
          <button onClick={carregar} disabled={loading} className="bg-[#F7941D] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#E8850A] transition disabled:opacity-50">
            {loading ? 'Carregando...' : '\ud83d\udd04 Atualizar'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          {[['hoje','Hoje'],['7d','7 dias'],['mes','Este m\u00eas'],['mes_ant','M\u00eas anterior'],['30d','30 dias']].map(([k,l]) => (
            <button key={k} onClick={() => setPreset(k)} className="text-xs px-3 py-1 rounded-full border border-gray-300 hover:bg-[#F7941D] hover:text-white hover:border-[#F7941D] transition text-gray-600">{l}</button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCompararPeriodo(!compararPeriodo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition flex items-center gap-1.5 ${
                compararPeriodo
                  ? 'bg-[#F7941D] text-white border border-[#F7941D]'
                  : 'border border-gray-300 text-gray-600 hover:border-[#F7941D] hover:text-[#F7941D]'
              }`}
            >
              <span>\u2194\ufe0f</span>
              <span>Comparar per\u00edodo</span>
            </button>
          </div>
        </div>
        {compararPeriodo && prevPeriodo && (
          <div className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            Comparando com: <span className="font-medium text-gray-700">{new Date(prevPeriodo.inicio + 'T12:00:00').toLocaleDateString('pt-BR')} \u2013 {new Date(prevPeriodo.fim + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
          </div>
        )}
      </div>

      {erro && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{erro}</div>}

      {loading && !data && <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">\u23f3</div><p>Carregando...</p></div>}

      {data && r && (
        <>
          {/* KPI row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#128176; Valor Faturado</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-gray-800">{fmt(r.total_faturado)}</p>
                {rPrev && <DeltaBadge atual={r.total_faturado} anterior={rPrev.total_faturado} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">Subtotal: {fmt(r.total_subtotal)}</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmt(rPrev.total_faturado)}</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#128230; Vendas Confirmadas</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-gray-800">{r.qtd_vendas}</p>
                {rPrev && <DeltaBadge atual={r.qtd_vendas} anterior={rPrev.qtd_vendas} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">Or\u00e7amentos gerados: {r.qtd_orcamentos}</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {rPrev.qtd_vendas}</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#127919; Ticket M\u00e9dio</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-gray-800">{fmt(r.ticket_medio)}</p>
                {rPrev && <DeltaBadge atual={r.ticket_medio} anterior={rPrev.ticket_medio} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">Frete m\u00e9dio: {fmt(r.qtd_vendas > 0 ? r.total_frete / r.qtd_vendas : 0)}</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmt(rPrev.ticket_medio)}</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#128200; Margem Bruta</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-gray-800">{fmtPct(r.margem_bruta_pct)}</p>
                {rPrev && <DeltaBadge atual={r.margem_bruta_pct} anterior={rPrev.margem_bruta_pct} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">Lucro: {fmt(r.lucro_bruto)}</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmtPct(rPrev.margem_bruta_pct)}</p>}
            </div>
          </div>

          {/* KPI row 2 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#127981; CMV (Custo Merc. Vendida)</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-red-600">{fmt(r.cmv_total)}</p>
                {rPrev && <DeltaBadge atual={r.cmv_total} anterior={rPrev.cmv_total} invertColor />}
              </div>
              <p className="text-xs text-gray-400 mt-1">{fmtPct(r.total_subtotal > 0 ? (r.cmv_total/r.total_subtotal)*100 : 0)} do faturamento</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmt(rPrev.cmv_total)}</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">&#128666; Frete Total</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold text-gray-800">{fmt(r.total_frete)}</p>
                {rPrev && <DeltaBadge atual={r.total_frete} anterior={rPrev.total_frete} />}
              </div>
              <p className="text-xs text-gray-400 mt-1">{fmtPct(r.total_faturado > 0 ? (r.total_frete/r.total_faturado)*100 : 0)} do faturado</p>
              {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmt(rPrev.total_frete)}</p>}
            </div>
            {filtroProduto && (
              <div className="bg-orange-50 rounded-2xl border border-orange-200 shadow-sm p-5">
                <p className="text-xs text-orange-600 mb-1">&#128269; {filtroProduto}</p>
                <div className="flex items-center">
                  <p className="text-2xl font-bold text-orange-700">{fmt(r.total_filtrado_produto)}</p>
                  {rPrev && <DeltaBadge atual={r.total_filtrado_produto} anterior={rPrev.total_filtrado_produto} />}
                </div>
                <p className="text-xs text-orange-500 mt-1">{r.qtd_filtrado_produto} pedido(s)</p>
                {rPrev && <p className="text-xs text-gray-300 mt-0.5">Anterior: {fmt(rPrev.total_filtrado_produto)}</p>}
              </div>
            )}
          </div>

          {/* EVOLUCAO DIARIA */}
          {data.evolucao_diaria.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-4">&#128201; Evolu\u00e7\u00e3o Di\u00e1ria</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-4 text-gray-500 font-medium">Data</th>
                    <th className="text-right py-2 pr-4 text-gray-500 font-medium">Faturado</th>
                    <th className="text-right py-2 pr-4 text-gray-500 font-medium">Vendas</th>
                    <th className="text-right py-2 pr-4 text-gray-500 font-medium">CMV</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Margem</th>
                  </tr></thead>
                  <tbody>
                    {data.evolucao_diaria.slice().reverse().map(d => {
                      const m = d.faturado > 0 ? ((d.faturado - d.cmv) / d.faturado * 100) : 0;
                      return (
                        <tr key={d.dia} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 pr-4 text-gray-700">{new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                          <td className="py-2 pr-4 text-right font-semibold text-gray-800">{fmt(d.faturado)}</td>
                          <td className="py-2 pr-4 text-right text-gray-600">{d.pedidos}</td>
                          <td className="py-2 pr-4 text-right text-red-500">{fmt(d.cmv)}</td>
                          <td className="py-2 text-right"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m >= 30 ? 'bg-green-100 text-green-700' : m >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{fmtPct(m)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="bg-gray-50 font-bold">
                    <td className="py-2 pr-4 text-gray-700">Total</td>
                    <td className="py-2 pr-4 text-right text-gray-800">{fmt(r.total_faturado)}</td>
                    <td className="py-2 pr-4 text-right text-gray-800">{r.qtd_vendas}</td>
                    <td className="py-2 pr-4 text-right text-red-600">{fmt(r.cmv_total)}</td>
                    <td className="py-2 text-right"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.margem_bruta_pct >= 30 ? 'bg-green-100 text-green-700' : r.margem_bruta_pct >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{fmtPct(r.margem_bruta_pct)}</span></td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          {/* TOP PRODUTOS */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-4">&#127942; Top Produtos por Receita</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-3 text-gray-500 font-medium">#</th>
                  <th className="text-left py-2 pr-3 text-gray-500 font-medium">Produto</th>
                  <th className="text-right py-2 pr-3 text-gray-500 font-medium">Qtd</th>
                  <th className="text-right py-2 pr-3 text-gray-500 font-medium">Receita</th>
                  <th className="text-right py-2 pr-3 text-gray-500 font-medium">CMV</th>
                  <th className="text-right py-2 pr-3 text-gray-500 font-medium">Lucro</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Margem</th>
                </tr></thead>
                <tbody>
                  {data.top_produtos.slice(0, 20).map((p, i) => (
                    <tr key={p.nome} className={`border-b border-gray-50 hover:bg-gray-50 ${filtroProduto === p.nome ? 'bg-orange-50' : ''}`}>
                      <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                      <td className="py-2 pr-3 text-gray-700 font-medium max-w-[200px] truncate">{p.nome}</td>
                      <td className="py-2 pr-3 text-right text-gray-600">{p.qtd % 1 === 0 ? p.qtd : p.qtd.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-800">{fmt(p.receita)}</td>
                      <td className="py-2 pr-3 text-right text-red-500">{fmt(p.custo)}</td>
                      <td className="py-2 pr-3 text-right text-green-600">{fmt(p.margem_valor)}</td>
                      <td className="py-2 text-right"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.margem_pct >= 30 ? 'bg-green-100 text-green-700' : p.margem_pct >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{fmtPct(p.margem_pct)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* BREAKDOWNS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">&#128202; Status das Vendas</h3>
              {Object.keys(statusVendas).length === 0 && <p className="text-xs text-gray-400">Nenhuma venda no per\u00edodo.</p>}
              <div className="space-y-2">
                {Object.entries(statusVendas).sort((a,b) => b[1].qtd - a[1].qtd).map(([s,v]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[s] || 'bg-gray-100 text-gray-700'}`}>{STATUS_LABEL[s] || s}</span>
                    <div className="text-right"><span className="text-xs font-semibold text-gray-800">{v.qtd} pedido(s)</span><span className="text-xs text-gray-400 ml-2">{fmt(v.total)}</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">&#128179; Formas de Pagamento</h3>
              <div className="space-y-2">
                {Object.entries(data.pagamento_breakdown).sort((a,b) => b[1].total - a[1].total).map(([p,v]) => (
                  <div key={p} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">{PAGAMENTO_LABEL[p] || p}</span>
                    <div className="text-right"><span className="text-xs font-semibold text-gray-800">{fmt(v.total)}</span><span className="text-xs text-gray-400 ml-2">({v.qtd}x)</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">&#128225; Canal de Venda</h3>
              <div className="space-y-2">
                {Object.entries(data.canal_breakdown).sort((a,b) => b[1].total - a[1].total).map(([c,v]) => (
                  <div key={c} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 capitalize">{c.replace(/_/g,' ')}</span>
                    <div className="text-right"><span className="text-xs font-semibold text-gray-800">{fmt(v.total)}</span><span className="text-xs text-gray-400 ml-2">({v.qtd}x)</span></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">&#128666; Entrega vs Retirada</h3>
              <div className="space-y-3">
                {Object.entries(data.entrega_breakdown).sort((a,b) => b[1] - a[1]).map(([t,v]) => {
                  const total = Object.values(data.entrega_breakdown).reduce((s,n) => s + n, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <div key={t}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{t === 'entrega' ? '\ud83d\ude9a Entrega no Endere\u00e7o' : '\ud83c\udfe0 Retirada na Loja'}</span>
                        <span className="text-gray-600">{v} ({fmtPct(pct)})</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-[#F7941D] h-2 rounded-full" style={{ width: fmtPct(pct) }}></div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
