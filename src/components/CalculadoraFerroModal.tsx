'use client';

import { useState } from 'react';

interface ItemAvulso {
  nome: string;
  quantidade: number;
  preco: number;
  especificacoes?: string;
}

interface PecaMontada {
  tipo: string;
  largura: number;
  comprimento: number;
  quantidade: number;
  quantidadeBarras: number;
}

interface Props {
  onAdicionarItens: (itens: ItemAvulso[]) => void;
  onClose: () => void;
}

const FERRO_PRECOS = {
  padrao: 20.00,
  especial: 25.00,
  montado: { 4: 20.00, 6: 36.00, 8: 42.00 } as Record<number, number>,
  LIMITE_PEDIDO_GRANDE: 100,
};

const TIPOS_PECA = [
  { value: 'sapata', label: 'Sapata', temDuasDirecoes: true },
  { value: 'coluna', label: 'Coluna', temDuasDirecoes: false },
  { value: 'viga', label: 'Viga', temDuasDirecoes: false },
  { value: 'baldrame', label: 'Baldrame', temDuasDirecoes: false },
];

const pecaVazia: PecaMontada = { tipo: 'sapata', largura: 40, comprimento: 3, quantidade: 1, quantidadeBarras: 4 };

export default function CalculadoraFerroModal({ onAdicionarItens, onClose }: Props) {
  const [modo, setModo] = useState('metro');
  const [tipoFerro, setTipoFerro] = useState('padrao');
  const [metros, setMetros] = useState(0);
  const [obsMetro, setObsMetro] = useState('');
  const [pecas, setPecas] = useState([{ ...pecaVazia }]);

  const calcularPecas = () => {
    let totalMetros = 0;
    const resultados: Array<{ peca: PecaMontada; metros: number; precoPorMetro: number }> = [];
    for (const p of pecas) {
      const precoPorMetro = FERRO_PRECOS.montado[p.quantidadeBarras] || 20;
      const tipo = TIPOS_PECA.find(t => t.value === p.tipo);
      let m = 0;
      if (tipo && tipo.temDuasDirecoes) {
        m = (p.largura / 100) * p.quantidadeBarras * 2 * p.quantidade;
      } else {
        m = p.comprimento * p.quantidade;
      }
      totalMetros += m;
      resultados.push({ peca: p, metros: m, precoPorMetro });
    }
    return { totalMetros, resultados };
  };

  const totalMetros = modo === 'pecas' ? calcularPecas().totalMetros : metros;

  const handleAdicionar = () => {
    const itens: ItemAvulso[] = [];
    if (modo === 'metro') {
      const nome = tipoFerro === 'padrao' ? 'Ferro Padrao (9x15/9x20)' : 'Ferro Medida Especial';
      const preco = tipoFerro === 'padrao' ? FERRO_PRECOS.padrao : FERRO_PRECOS.especial;
      itens.push({ nome, quantidade: metros, preco, especificacoes: obsMetro || undefined });
    } else {
      const { resultados } = calcularPecas();
      for (const r of resultados) {
        const tipo = TIPOS_PECA.find(t => t.value === r.peca.tipo);
        const tipoLabel = tipo ? tipo.label : r.peca.tipo;
        const dims = tipo && tipo.temDuasDirecoes
          ? r.peca.largura + 'x' + r.peca.largura + 'cm'
          : r.peca.comprimento + 'm';
        const nome = tipoLabel + ' ' + dims + ' (' + r.peca.quantidadeBarras + ' barras) x' + r.peca.quantidade;
        itens.push({ nome, quantidade: r.metros, preco: r.precoPorMetro });
      }
    }
    onAdicionarItens(itens);
    onClose();
  };

  const atualizarPeca = (idx: number, campo: keyof PecaMontada, valor: string | number) => {
    const novas = [...pecas];
    novas[idx] = { ...novas[idx], [campo]: valor };
    setPecas(novas);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-screen overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">Calculadora de Ferro</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
          </div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setModo('metro')}
              className={"px-4 py-2 rounded font-medium " + (modo === 'metro' ? 'bg-[#F7941D] text-white' : 'bg-gray-200 text-gray-700')}
            >
              Ferro por Metro
            </button>
            <button
              onClick={() => setModo('pecas')}
              className={"px-4 py-2 rounded font-medium " + (modo === 'pecas' ? 'bg-[#F7941D] text-white' : 'bg-gray-200 text-gray-700')}
            >
              Pecas Montadas
            </button>
          </div>

          {modo === 'metro' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Ferro</label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setTipoFerro('padrao')}
                    className={"px-3 py-2 rounded border text-sm " + (tipoFerro === 'padrao' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-300')}
                  >
                    Padrao (9x15/9x20) - R$20/m
                  </button>
                  <button
                    onClick={() => setTipoFerro('especial')}
                    className={"px-3 py-2 rounded border text-sm " + (tipoFerro === 'especial' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-300')}
                  >
                    Medida Especial - R$25/m
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantidade (metros)</label>
                <input
                  type="number"
                  min="0"
                  value={metros}
                  onChange={e => setMetros(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observacao</label>
                <input
                  type="text"
                  value={obsMetro}
                  onChange={e => setObsMetro(e.target.value)}
                  placeholder="Ex: Cortar em barras de 3m"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                />
              </div>
            </div>
          )}

          {modo === 'pecas' && (
            <div className="space-y-3">
              {pecas.map((peca, idx) => {
                const tipoDef = TIPOS_PECA.find(t => t.value === peca.tipo);
                return (
                  <div key={idx} className="border border-gray-200 rounded p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                        <select
                          value={peca.tipo}
                          onChange={e => atualizarPeca(idx, 'tipo', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          {TIPOS_PECA.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Barras</label>
                        <select
                          value={peca.quantidadeBarras}
                          onChange={e => atualizarPeca(idx, 'quantidadeBarras', parseInt(e.target.value))}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value={4}>4 barras - R$20/m</option>
                          <option value={6}>6 barras - R$36/m</option>
                          <option value={8}>8 barras - R$42/m</option>
                        </select>
                      </div>
                      {tipoDef && tipoDef.temDuasDirecoes ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Largura (cm)</label>
                          <input
                            type="number"
                            min="0"
                            value={peca.largura}
                            onChange={e => atualizarPeca(idx, 'largura', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Comprimento (m)</label>
                          <input
                            type="number"
                            min="0"
                            value={peca.comprimento}
                            onChange={e => atualizarPeca(idx, 'comprimento', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade</label>
                        <input
                          type="number"
                          min="1"
                          value={peca.quantidade}
                          onChange={e => atualizarPeca(idx, 'quantidade', parseInt(e.target.value) || 1)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      </div>
                    </div>
                    {pecas.length > 1 && (
                      <button
                        onClick={() => setPecas(pecas.filter((_, i) => i !== idx))}
                        className="mt-2 text-red-500 text-xs hover:text-red-700"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => setPecas([...pecas, { ...pecaVazia, tipo: 'coluna' }])}
                className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded text-gray-500 hover:border-[#F7941D] hover:text-[#F7941D] text-sm"
              >
                + Adicionar Peca
              </button>
            </div>
          )}

          <div className="mt-4 p-3 bg-orange-50 rounded-lg">
            <p className="text-sm text-gray-700">
              Total estimado: <span className="font-bold text-[#F7941D]">{totalMetros.toFixed(1)} metros</span>
            </p>
            {totalMetros > FERRO_PRECOS.LIMITE_PEDIDO_GRANDE && (
              <p className="text-yellow-600 text-xs mt-1">
                Pedido grande ({totalMetros.toFixed(0)}m). Verificar disponibilidade.
              </p>
            )}
          </div>

          <div className="mt-4 flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleAdicionar}
              disabled={totalMetros <= 0}
              className="px-4 py-2 bg-[#F7941D] text-white rounded hover:bg-[#E8850A] disabled:opacity-50 font-medium"
            >
              Adicionar ao Orcamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
