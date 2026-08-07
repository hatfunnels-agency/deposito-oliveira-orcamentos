'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Trash2, Wallet, Landmark, ShoppingCart } from 'lucide-react';

/**
 * Fechamento do dia: as tres fontes lado a lado.
 *
 * Sistema (o que vendeu) x Banco (o que caiu) x Caixa (o que ficou em
 * dinheiro). Elas nao batem por natureza, entao a tela mostra as tres em
 * vez de tentar reduzir a um numero so — a diferenca e o dado util.
 */

interface Saida { descricao: string; contraparte: string | null; valor: number; categoria: string | null }
interface Categoria { id: string; nome: string; grupo: string }
interface Dia {
  data: string;
  sistema: { vendas_do_dia: number; qtd_pedidos: number; recebido_total: number; recebido_por_metodo: Record<string, number> };
  contas: Array<{ nome: string; tipo: string; entrou: number; saiu: number }>;
  caixa: {
    entrou_no_dia: number; saidas: Saida[]; total_saidas: number; saldo_esperado: number;
    falta_sincronizar: number;
    fechamento: { saldo_esperado: number; saldo_contado: number; diferenca: number } | null;
  };
  conferencia: { entrou_em_banco: number; recebido_no_sistema: number; nota: string };
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeBrt = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

const rotuloMetodo: Record<string, string> = {
  pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito', outro: 'Outro',
};

export default function FechamentoDia() {
  const [data, setData] = useState(hojeBrt());
  const [dia, setDia] = useState<Dia | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [novaDesc, setNovaDesc] = useState('');
  const [novoValor, setNovoValor] = useState('');
  const [novaCat, setNovaCat] = useState('');
  const [contado, setContado] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const [rDia, rCaixa] = await Promise.all([
        fetch(`/api/financeiro/dia?data=${data}`, { cache: 'no-store' }),
        fetch(`/api/financeiro/caixa?de=${data}&ate=${data}`, { cache: 'no-store' }),
      ]);
      const dDia = await rDia.json();
      if (!rDia.ok) throw new Error(dDia.error || 'Erro ao carregar o dia');
      setDia(dDia);
      const dCaixa = await rCaixa.json();
      if (rCaixa.ok) setCategorias(dCaixa.categorias || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
    setCarregando(false);
  }, [data]);

  useEffect(() => { carregar(); }, [carregar]);

  const acao = async (corpo: Record<string, unknown>, marcador: string) => {
    setOcupado(marcador); setErro(null);
    try {
      const r = await fetch('/api/financeiro/caixa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro na operação');
      await carregar();
      return d;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na operação');
    } finally {
      setOcupado(null);
    }
  };

  const lancarSaida = async () => {
    const v = Number(String(novoValor).replace(/\./g, '').replace(',', '.'));
    if (!novaDesc.trim() || !Number.isFinite(v) || v === 0) { setErro('Preencha descrição e valor'); return; }
    const ok = await acao({ acao: 'lancar', data, descricao: novaDesc.trim(), valor: v, categoria_id: novaCat || null }, 'lancar');
    if (ok) { setNovaDesc(''); setNovoValor(''); setNovaCat(''); }
  };

  const excluir = async (id: string) => {
    setOcupado(id);
    try {
      const r = await fetch(`/api/financeiro/caixa?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro ao excluir');
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao excluir'); }
    setOcupado(null);
  };

  const mudarDia = (delta: number) => {
    const d = new Date(data + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setData(d.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => mudarDia(-1)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">‹</button>
        <input type="date" value={data} onChange={e => setData(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
        <button onClick={() => mudarDia(1)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">›</button>
        <button onClick={() => setData(hojeBrt())} className="text-xs text-[#F7941D] hover:underline px-2">hoje</button>
        <button onClick={carregar} disabled={carregando}
          className="ml-auto flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
          <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {erro && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex justify-between">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {dia && (
        <>
          {/* três fontes lado a lado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-[#F7941D]" />
                <h3 className="font-bold text-gray-700 text-sm">Vendeu</h3>
              </div>
              <p className="text-xl font-bold text-gray-800">{brl(dia.sistema.vendas_do_dia)}</p>
              <p className="text-xs text-gray-500">{dia.sistema.qtd_pedidos} pedidos no sistema</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Landmark className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-gray-700 text-sm">Entrou em banco</h3>
              </div>
              <p className="text-xl font-bold text-gray-800">{brl(dia.conferencia.entrou_em_banco)}</p>
              <p className="text-xs text-gray-500">Itaú + Stone</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-green-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-green-600" />
                <h3 className="font-bold text-gray-700 text-sm">Caixa em espécie</h3>
              </div>
              <p className="text-xl font-bold text-gray-800">{brl(dia.caixa.saldo_esperado)}</p>
              <p className="text-xs text-gray-500">saldo acumulado esperado</p>
            </div>
          </div>

          {/* recebido por método */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="font-bold text-gray-700 text-sm mb-3">
              Recebido no dia — {brl(dia.sistema.recebido_total)}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(dia.sistema.recebido_por_metodo).map(([m, v]) => (
                <div key={m} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-500">{rotuloMetodo[m] || m}</p>
                  <p className="font-bold text-gray-800 text-sm">{brl(v)}</p>
                </div>
              ))}
              {Object.keys(dia.sistema.recebido_por_metodo).length === 0 && (
                <p className="text-sm text-gray-400 col-span-full">Nenhum pagamento registrado neste dia</p>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-3">{dia.conferencia.nota}</p>
          </div>

          {/* caixa */}
          <div className="bg-white rounded-xl shadow-sm border border-green-100 p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="font-bold text-green-700 text-sm">Caixa em espécie</h3>
              <button
                onClick={() => acao({ acao: 'sincronizar', de: data, ate: data }, 'sync')}
                disabled={ocupado === 'sync'}
                className="text-xs text-green-700 border border-green-300 px-3 py-1 rounded-lg hover:bg-green-50 disabled:opacity-50">
                {ocupado === 'sync' ? 'Puxando...' : '↻ Puxar vendas em dinheiro'}
              </button>
            </div>

            {dia.caixa.falta_sincronizar > 0.01 && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                {brl(dia.caixa.falta_sincronizar)} de venda em dinheiro ainda não entrou no caixa.
                Clique em &quot;Puxar vendas em dinheiro&quot;.
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
              <div><p className="text-xs text-gray-500">Entrou hoje</p><p className="font-bold text-green-700">{brl(dia.caixa.entrou_no_dia)}</p></div>
              <div><p className="text-xs text-gray-500">Saiu hoje</p><p className="font-bold text-red-700">{brl(dia.caixa.total_saidas)}</p></div>
              <div><p className="text-xs text-gray-500">Saldo esperado</p><p className="font-bold text-gray-800">{brl(dia.caixa.saldo_esperado)}</p></div>
            </div>

            {/* lançar saída */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Pagou em dinheiro? Lance aqui</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={novaDesc} onChange={e => setNovaDesc(e.target.value)}
                  placeholder="Ex: diária do Adalberto, café da manhã"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                <input value={novoValor} onChange={e => setNovoValor(e.target.value)}
                  placeholder="Valor" inputMode="decimal"
                  className="w-full sm:w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                <select value={novaCat} onChange={e => setNovaCat(e.target.value)}
                  className="w-full sm:w-52 border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                  <option value="">— categoria —</option>
                  {categorias.filter(c => !['receita', 'transferencia'].includes(c.grupo)).map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
                <button onClick={lancarSaida} disabled={ocupado === 'lancar'}
                  className="flex items-center justify-center gap-1 bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 disabled:opacity-50 whitespace-nowrap">
                  <Plus className="w-4 h-4" /> Lançar
                </button>
              </div>
            </div>

            {dia.caixa.saidas.length > 0 && (
              <div className="mt-3 space-y-1">
                {dia.caixa.saidas.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
                    <span className="flex-1 min-w-0 truncate text-gray-700">{s.descricao}</span>
                    {s.categoria && <span className="text-gray-400 shrink-0">{s.categoria}</span>}
                    <span className="font-mono text-red-700 shrink-0">{brl(s.valor)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* fechamento */}
            <div className="border-t border-gray-100 pt-3 mt-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Conferiu o dinheiro? Registre quanto tinha</p>
              <div className="flex gap-2 flex-wrap">
                <input value={contado} onChange={e => setContado(e.target.value)}
                  placeholder="Valor contado" inputMode="decimal"
                  className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                <button
                  onClick={async () => {
                    const v = Number(String(contado).replace(/\./g, '').replace(',', '.'));
                    if (!Number.isFinite(v)) { setErro('Valor contado inválido'); return; }
                    const ok = await acao({ acao: 'fechar', data, saldo_contado: v }, 'fechar');
                    if (ok) setContado('');
                  }}
                  disabled={ocupado === 'fechar'}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  Fechar caixa
                </button>
              </div>
              {dia.caixa.fechamento && (
                <p className={`text-xs mt-2 ${Math.abs(dia.caixa.fechamento.diferenca) < 0.01 ? 'text-green-700' : 'text-amber-800'}`}>
                  Fechado: contado {brl(dia.caixa.fechamento.saldo_contado)} · esperado {brl(dia.caixa.fechamento.saldo_esperado)} ·{' '}
                  <strong>diferença {brl(dia.caixa.fechamento.diferenca)}</strong>
                </p>
              )}
            </div>
          </div>

          {dia.contas.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="font-bold text-gray-700 text-sm mb-3">Movimento por conta</h3>
              <div className="space-y-1">
                {dia.contas.map(c => (
                  <div key={c.nome} className="flex items-center gap-2 text-xs border-b border-gray-50 py-1.5">
                    <span className="flex-1 text-gray-700">{c.nome}</span>
                    <span className="text-green-700 font-mono">{brl(c.entrou)}</span>
                    <span className="text-red-700 font-mono">{brl(c.saiu)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
