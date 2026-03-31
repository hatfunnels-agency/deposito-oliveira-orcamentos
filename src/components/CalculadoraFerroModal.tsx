'use client';

import { useState } from 'react';

interface ItemAvulso {
  nome: string;
  quantidade: number;
  preco: number;
  especificacoes?: string;
}

interface Props {
  onAdicionarItens: (itens: ItemAvulso[]) => void;
  onClose: () => void;
}

// Tabela de precos (nao acumulativo):
// 4 barras: 9x15=R$20/m | 9x20=R$20/m | especial=R$25/m
// 6 barras: R$36/m (independente de medida)
// 8 barras: R$42/m (independente de medida)

function calcPreco(medida: '9x15' | '9x20' | 'especial', barras: 4 | 6 | 8): number {
  if (barras === 6) return 36;
  if (barras === 8) return 42;
  // 4 barras: depende da medida
  return medida === 'especial' ? 25 : 20;
}

export default function CalculadoraFerroModal({ onAdicionarItens, onClose }: Props) {
  const [medida, setMedida] = useState<'9x15' | '9x20' | 'especial'>('9x15');
  const [barras, setBarras] = useState<4 | 6 | 8>(4);
  const [quantidade, setQuantidade] = useState<number>(1);
  const [metrosPorPeca, setMetrosPorPeca] = useState<number>(0);
  const [obs, setObs] = useState('');

  const precoPorMetro = calcPreco(medida, barras);
  const metrosTotal = quantidade * metrosPorPeca;
  const totalValor = metrosTotal * precoPorMetro;

  const handleAdicionar = () => {
    if (metrosTotal <= 0) return;
    const nomeMedida = medida === '9x15' ? '9×15' : medida === '9x20' ? '9×20' : 'Especial';
    const nomeBase = 'Ferro ' + nomeMedida + ' - ' + barras + ' barras';
    const nome = obs ? nomeBase + ' | ' + obs : nomeBase;
    const especDesc = quantidade + ' peça(s) x ' + metrosPorPeca + 'm' + (obs ? ' | ' + obs : '');
    onAdicionarItens([{
      nome,
      quantidade: metrosTotal,
      preco: precoPorMetro,
      especificacoes: especDesc,
    }]);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Calculadora de Ferro</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>

          <div className="space-y-5">
            {/* Medida */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Medida do estribo</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setMedida('9x15')}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (medida === '9x15'
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">9×15</div>
                  <div className="text-xs opacity-75">R$20/m</div>
                </button>
                <button
                  onClick={() => setMedida('9x20')}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (medida === '9x20'
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">9×20</div>
                  <div className="text-xs opacity-75">R$20/m</div>
                </button>
                <button
                  onClick={() => setMedida('especial')}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (medida === 'especial'
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">Especial</div>
                  <div className="text-xs opacity-75">R$25/m</div>
                </button>
              </div>
            </div>

            {/* Barras */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Quantidade de Barras</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setBarras(4)}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (barras === 4
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">4 Barras</div>
                  <div className="text-xs opacity-75">{medida === 'especial' ? 'R$25/m' : 'R$20/m'}</div>
                </button>
                <button
                  onClick={() => setBarras(6)}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (barras === 6
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">6 Barras</div>
                  <div className="text-xs opacity-75">R$36/m</div>
                </button>
                <button
                  onClick={() => setBarras(8)}
                  className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                    (barras === 8
                      ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                >
                  <div className="font-bold">8 Barras</div>
                  <div className="text-xs opacity-75">R$42/m</div>
                </button>
              </div>
            </div>

            {/* Quantidade e Metros por peca */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Qtd de peças</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantidade || ''}
                  onChange={e => setQuantidade(parseInt(e.target.value) || 1)}
                  placeholder="Ex: 4"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Metros por peça</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={metrosPorPeca || ''}
                  onChange={e => setMetrosPorPeca(parseFloat(e.target.value) || 0)}
                  placeholder="Ex: 5"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
            </div>

            {/* Observacao */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Observação <span className="font-normal text-gray-400">(opcional)</span></label>
              <input
                type="text"
                value={obs}
                onChange={e => setObs(e.target.value)}
                placeholder="Ex: Cortar em barras de 3m"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
              />
            </div>

            {/* Resumo */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Preço por metro</span>
                <span className="font-semibold">R$ {precoPorMetro.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Metragem total</span>
                <span className="font-semibold">
                  {metrosTotal > 0
                    ? quantidade + ' peça(s) × ' + metrosPorPeca + 'm = ' + metrosTotal + 'm'
                    : 'Informe as medidas'}
                </span>
              </div>
              <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg border-t border-orange-200 pt-2 mt-1">
                <span>Total</span>
                <span>R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="mt-5 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={handleAdicionar}
              disabled={metrosTotal <= 0}
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
