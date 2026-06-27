'use client';
import { useMemo, useState } from 'react';

// Produto vendido por metro (viga, caibro, prancha, ripao...). Recebe os
// produtos ja filtrados pelo OrcamentoApp (unidade de venda = 'metro').
interface ProdutoMadeira {
  id: string;
  nome: string;
  unidade: string;
  preco: number;
  preco_custo: number;
  categoria: string;
  estoque: number;
}

interface Props {
  produtos: ProdutoMadeira[];
  onAdicionar: (produtoId: string, metrosTotal: number) => void;
  onClose: () => void;
}

// Comprimentos mais comuns de madeira/viga pra selecao rapida (em metros).
const COMPRIMENTOS_COMUNS = [2, 3, 4, 5, 6];

export default function CalculadoraMadeiraModal({ produtos, onAdicionar, onClose }: Props) {
  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState<string>('');
  const [quantidade, setQuantidade] = useState<number>(1);
  const [metrosPorPeca, setMetrosPorPeca] = useState<number>(0);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? produtos.filter(p => p.nome.toLowerCase().includes(termo))
      : produtos;
    return [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [produtos, busca]);

  const produtoSelecionado = produtos.find(p => p.id === produtoId) || null;

  const metrosTotal = Math.round(quantidade * metrosPorPeca * 100) / 100;
  const precoPorMetro = produtoSelecionado?.preco ?? 0;
  const custoPorMetro = produtoSelecionado?.preco_custo ?? 0;
  const totalValor = metrosTotal * precoPorMetro;
  const totalCusto = metrosTotal * custoPorMetro;

  const handleAdicionar = () => {
    if (!produtoSelecionado || metrosTotal <= 0) return;
    onAdicionar(produtoSelecionado.id, metrosTotal);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] flex flex-col">
        <div className="p-6 overflow-y-auto">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-gray-800">Calculadora de Madeira</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            Para produtos vendidos por metro (viga, caibro, prancha...). Informe quantas
            peças e o comprimento de cada uma — o total em metros é calculado automaticamente.
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Produto (vendido por metro)</label>
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar... ex: caibro, viga 5x15, prancha"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
              />
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {produtosFiltrados.length === 0 && (
                  <div className="p-3 text-sm text-gray-400 text-center">Nenhum produto por metro encontrado</div>
                )}
                {produtosFiltrados.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setProdutoId(p.id)}
                    className={"w-full text-left px-3 py-2 transition-colors " +
                      (produtoId === p.id ? 'bg-orange-50' : 'hover:bg-gray-50')}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className={"text-sm font-medium " + (produtoId === p.id ? 'text-[#F7941D]' : 'text-gray-800')}>{p.nome}</span>
                      <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">R$ {p.preco.toFixed(2).replace('.', ',')}/m</span>
                    </div>
                    <div className="text-xs text-gray-400">{p.categoria}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Qtd de peças</label>
                <input
                  type="number" min="1" step="1"
                  value={quantidade || ''}
                  onChange={e => setQuantidade(parseInt(e.target.value) || 1)}
                  placeholder="Ex: 3"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Comprimento (m)</label>
                <input
                  type="number" min="0" step="0.5"
                  value={metrosPorPeca || ''}
                  onChange={e => setMetrosPorPeca(parseFloat(e.target.value) || 0)}
                  placeholder="Ex: 8"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {COMPRIMENTOS_COMUNS.map(c => (
                <button
                  key={c}
                  onClick={() => setMetrosPorPeca(c)}
                  className={"px-3 py-1 rounded-full border text-sm font-medium transition-colors " +
                    (metrosPorPeca === c ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  {c}m
                </button>
              ))}
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-center mb-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total em metros (vai no orçamento)</div>
                {metrosTotal > 0 ? (
                  <div className="text-2xl font-bold text-[#F7941D]">
                    {quantidade} {quantidade > 1 ? 'peças' : 'peça'} × {metrosPorPeca}m = {metrosTotal}m
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">Informe quantidade e comprimento</div>
                )}
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1 border-t border-orange-200 pt-2">
                <span>Produto</span>
                <span className="font-semibold text-right text-xs max-w-[220px]">
                  {produtoSelecionado ? produtoSelecionado.nome : 'Selecione acima'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Preço por metro</span>
                <span className="font-semibold">R$ {precoPorMetro.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg border-t border-orange-200 pt-2 mt-1">
                <span>Total</span>
                <span>R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
              {metrosTotal > 0 && custoPorMetro > 0 && (
                <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                  <span>Custo total</span>
                  <span>R$ {totalCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">
              Cancelar
            </button>
            <button
              onClick={handleAdicionar}
              disabled={!produtoSelecionado || metrosTotal <= 0}
              className="flex-1 px-4 py-2 bg-[#F7941D] text-white rounded-lg hover:bg-[#E8850A] disabled:opacity-50 font-bold"
            >
              Adicionar ao Orçamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
