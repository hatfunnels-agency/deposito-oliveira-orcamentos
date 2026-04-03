'use client';

import { useState, useEffect, useCallback } from 'react';

interface ResumoData {
  total_faturado: number;
  total_subtotal: number;
  total_frete: number;
  qtd_pedidos: number;
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

const STATUS_LABEL: Record<string, string> = {
  orcamento: 'Or\u00e7amento',
  confirmado: 'Confirmado',
  em_entrega: 'Em Entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
  aguardando_pagamento: 'Aguard. Pagamento',
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

const STATUS_COLOR: Record<string, string> = {
  orcamento: 'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  em_entrega: 'bg-purple-100 text-purple-800',
  entregue: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
  aguardando_pagamento: 'bg-orange-100 text-orange-800',
};

export default function DashboardTab() {
  const hoje = new Date().toISOString().split('T')[0];
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [dataInicio, setDataInicio] = useState(trintaDiasAtras);
  const [dataFim, setDataFim] = useState(hoje);
  const [filtroProduto, setFiltroProduto] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
      if (filtroProduto.trim()) params.set('produto', filtroProduto.trim());
      const res = await fetch('/api/dashboard?' + params.toString(), { cache: 'no-store' });
      const json = await res.json();
      if (json.error) { setErro(json.error); setData(null); }
      else setData(json);
    } catch {
      setErro('Erro ao carregar dados.');
    }
    setLoading(false);
  }, [dataInicio, dataFim, filtroProduto]);

  useEffect(() => { carregar(); }, [carregar]);

  // Preset ranges
  const setPreset = (preset: string) => {
    const now = new Date();
    const h = now.toISOString().split('T')[0];
    if (preset === 'hoje') { setDataInicio(h); setDataFim(h); }
    else if (preset === '7d') { setDataInicio(new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]); setDataFim(h); }
    else if (preset === '30d') { setDataInicio(new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0]); setDataFim(h); }
    else if (preset === 'mes') {
      const inicio = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      setDataInicio(inicio); setDataFim(h);
    }
    else if (preset === 'mes_ant') {
      const ini = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const fim = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
      setDataInicio(ini); setDataFim(fim);
    }
  };

  const r = data?.resumo;

  return (
    <div className="space-y-6 pb-10">
      {/* ===== FILTROS ===== */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-800 mb-4">\ud83d\udcc5 Filtros</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data Inicial</label>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data Final</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Filtrar por Produto</label>
            <input type="text" placeholder="Ex: cimento, areia..." value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
          </div>
          <button onClick={carregar} disabled={loading}
            className="bg-[#F7941D] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#E8850A] transition disabled:opacity-50">
            {loading ? 'Carregando...' : '\ud83d\udd04 Atualizar'}
          </button>
        </div>
        {/* Presets */}
        <div className="flex flex-wrap gap-2 mt-3">
          {[['hoje','Hoje'],['7d','7 dias'],['mes','Este m\u00eas'],['mes_ant','M\u00eas anterior'],['30d','30 dias']].map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)}
              className="text-xs px-3 py-1 rounded-full border border-gray-300 hover:bg-[#F7941D] hover:text-white hover:border-[#F7941D] transition text-gray-600">
              {l}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{erro}</div>}

      {loading && !data && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">\u23f3</div>
          <p>Carregando dashboard...</p>
        </div>
      )}

      {data && r && (
        <>
          {/* ===== KPI CARDS ===== */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83d\udcb0 Valor Faturado</p>
              <p className="text-2xl font-bold text-gray-800">{fmt(r.total_faturado)}</p>
              <p className="text-xs text-gray-400 mt-1">Subtotal: {fmt(r.total_subtotal)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83d\udce6 Pedidos</p>
              <p className="text-2xl font-bold text-gray-800">{r.qtd_pedidos}</p>
              <p className="text-xs text-gray-400 mt-1">{r.qtd_cancelados} cancelado(s)</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83c\udfaf Ticket M\u00e9dio</p>
              <p className="text-2xl font-bold text-gray-800">{fmt(r.ticket_medio)}</p>
              <p className="text-xs text-gray-400 mt-1">Frete m\u00e9dio: {fmt(r.qtd_pedidos > 0 ? r.total_frete / r.qtd_pedidos : 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83d\udcc8 Margem Bruta</p>
              <p className="text-2xl font-bold text-gray-800">{fmtPct(r.margem_bruta_pct)}</p>
              <p className="text-xs text-gray-400 mt-1">Lucro: {fmt(r.lucro_bruto)}</p>
            </div>
          </div>

          {/* ===== CMV CARD ===== */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83c\udfed CMV (Custo Merc. Vendida)</p>
              <p className="text-2xl font-bold text-red-600">{fmt(r.cmv_total)}</p>
              <p className="text-xs text-gray-400 mt-1">{fmtPct(r.total_subtotal > 0 ? (r.cmv_total / r.total_subtotal) * 100 : 0)} do faturamento</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">\ud83d\ude9a Frete Total</p>
              <p className="text-2xl font-bold text-gray-800">{fmt(r.total_frete)}</p>
              <p className="text-xs text-gray-400 mt-1">{fmtPct(r.total_faturado > 0 ? (r.total_frete / r.total_faturado) * 100 : 0)} do faturado</p>
            </div>
            {filtroProduto && (
              <div className="bg-orange-50 rounded-2xl border border-orange-200 shadow-sm p-5">
                <p className="text-xs text-orange-600 mb-1">\ud83d\udd0d Filtro: {filtroProduto}</p>
                <p className="text-2xl font-bold text-orange-700">{fmt(r.total_filtrado_produto)}</p>
                <p className="text-xs text-orange-500 mt-1">{r.qtd_filtrado_produto} pedido(s) cont\u00e9m este produto</p>
              </div>
            )}
          </div>

          {/* ===== EVOLUCAO DIARIA ===== */}
          {data.evolucao_diaria.length > 1 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-4">\ud83d\udcc8 Evolu\u00e7\u00e3o Di\u00e1ria</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-4 text-gray-500 font-medium">Data</th>
                      <th className="text-right py-2 pr-4 text-gray-500 font-medium">Faturado</th>
                      <th className="text-right py-2 pr-4 text-gray-500 font-medium">Pedidos</th>
                      <th className="text-right py-2 pr-4 text-gray-500 font-medium">CMV</th>
                      <th className="text-right py-2 text-gray-500 font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evolucao_diaria.slice().reverse().map(d => {
                      const margem = d.faturado > 0 ? ((d.faturado - d.cmv) / d.faturado * 100) : 0;
                      return (
                        <tr key={d.dia} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 pr-4 text-gray-700">{new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                          <td className="py-2 pr-4 text-right font-semibold text-gray-800">{fmt(d.faturado)}</td>
                          <td className="py-2 pr-4 text-right text-gray-600">{d.pedidos}</td>
                          <td className="py-2 pr-4 text-right text-red-500">{fmt(d.cmv)}</td>
                          <td className="py-2 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${margem >= 30 ? 'bg-green-100 text-green-700' : margem >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                              {fmtPct(margem)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-bold">
                      <td className="py-2 pr-4 text-gray-700">Total</td>
                      <td className="py-2 pr-4 text-right text-gray-800">{fmt(r.total_faturado)}</td>
                      <td className="py-2 pr-4 text-right text-gray-800">{r.qtd_pedidos}</td>
                      <td className="py-2 pr-4 text-right text-red-600">{fmt(r.cmv_total)}</td>
                      <td className="py-2 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.margem_bruta_pct >= 30 ? 'bg-green-100 text-green-700' : r.margem_bruta_pct >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {fmtPct(r.margem_bruta_pct)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ===== TOP PRODUTOS ===== */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-4">\ud83c\udfc6 Top Produtos por Receita</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 text-gray-500 font-medium">#</th>
                    <th className="text-left py-2 pr-3 text-gray-500 font-medium">Produto</th>
                    <th className="text-right py-2 pr-3 text-gray-500 font-medium">Qtd</th>
                    <th className="text-right py-2 pr-3 text-gray-500 font-medium">Receita</th>
                    <th className="text-right py-2 pr-3 text-gray-500 font-medium">CMV</th>
                    <th className="text-right py-2 pr-3 text-gray-500 font-medium">Lucro</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_produtos.slice(0, 20).map((p, i) => (
                    <tr key={p.nome} className={`border-b border-gray-50 hover:bg-gray-50 ${filtroProduto && p.nome.toLowerCase().includes(filtroProduto.toLowerCase()) ? 'bg-orange-50' : ''}`}>
                      <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                      <td className="py-2 pr-3 text-gray-700 font-medium max-w-[200px] truncate">{p.nome}</td>
                      <td className="py-2 pr-3 text-right text-gray-600">{p.qtd % 1 === 0 ? p.qtd : p.qtd.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-800">{fmt(p.receita)}</td>
                      <td className="py-2 pr-3 text-right text-red-500">{fmt(p.custo)}</td>
                      <td className="py-2 pr-3 text-right text-green-600">{fmt(p.margem_valor)}</td>
                      <td className="py-2 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.margem_pct >= 30 ? 'bg-green-100 text-green-700' : p.margem_pct >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {fmtPct(p.margem_pct)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== BREAKDOWNS ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">\ud83d\udcca Status dos Pedidos</h3>
              <div className="space-y-2">
                {Object.entries(data.status_breakdown).sort((a, b) => b[1].qtd - a[1].qtd).map(([s, v]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[s] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABEL[s] || s}
                    </span>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-gray-800">{v.qtd} pedidos</span>
                      <span className="text-xs text-gray-400 ml-2">{fmt(v.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pagamento */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">\ud83d\udcb3 Formas de Pagamento</h3>
              <div className="space-y-2">
                {Object.entries(data.pagamento_breakdown).sort((a, b) => b[1].total - a[1].total).map(([p, v]) => (
                  <div key={p} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">{PAGAMENTO_LABEL[p] || p}</span>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-gray-800">{fmt(v.total)}</span>
                      <span className="text-xs text-gray-400 ml-2">({v.qtd}x)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Canal */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">\ud83d\udce1 Canal de Venda</h3>
              <div className="space-y-2">
                {Object.entries(data.canal_breakdown).sort((a, b) => b[1].total - a[1].total).map(([c, v]) => (
                  <div key={c} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 capitalize">{c.replace(/_/g, ' ')}</span>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-gray-800">{fmt(v.total)}</span>
                      <span className="text-xs text-gray-400 ml-2">({v.qtd}x)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Entrega vs Retirada */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">\ud83d\ude9a Entrega vs Retirada</h3>
              <div className="space-y-2">
                {Object.entries(data.entrega_breakdown).sort((a, b) => b[1] - a[1]).map(([t, v]) => {
                  const total = Object.values(data.entrega_breakdown).reduce((s, n) => s + n, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <div key={t}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700 capitalize">{t === 'entrega' ? '\ud83d\ude9a Entrega no Endere\u00e7o' : '\ud83c\udfe0 Retirada na Loja'}</span>
                        <span className="text-gray-600">{v} ({fmtPct(pct)})</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-[#F7941D] h-2 rounded-full" style={{ width: fmtPct(pct) }}></div>
                      </div>
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
