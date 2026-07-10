'use client';
import { useState } from 'react';

export interface DetalheFerro {
  tipo_ferro: string;
  metros: number;
}

interface ItemAvulso {
  nome: string;
  quantidade: number;
  preco: number;
  preco_custo: number;
  especificacoes?: string;
  detalhamento_ferro?: DetalheFerro[];
}

interface Props {
  onAdicionarItens: (itens: ItemAvulso[]) => void;
  onClose: () => void;
}

// Espacamento do estribo: opcoes em cm. 25cm e o padrao. Quanto mais
// fechado, mais estribos por metro -> mais aco e mais mao de obra, por
// isso ha acrescimo no preco ao cliente.
type Espacamento = '10' | '15' | '20' | '25';
const ESPACAMENTO_M: Record<Espacamento, number> = {
  '10': 0.10, '15': 0.15, '20': 0.20, '25': 0.25,
};
// Acrescimo no preco/metro (R$) por estribo mais fechado que o padrao de 25cm.
// Valor fixo pequeno por faixa — so pra nao vender abaixo do custo do aco extra.
const ESPACAMENTO_ACRESCIMO: Record<Espacamento, number> = {
  '25': 0, '20': 1, '15': 2, '10': 4,
};

// Tabela de precos base (espacamento padrao 25cm; acrescimo do estribo
// somado por cima). Nao acumulativo entre medida/barras:
// 4 barras: 9x15=R$25/m | 9x20=R$25/m | especial=R$30/m
// 6 barras: R$38/m (independente de medida)
// 8 barras: R$45/m (independente de medida)
function precoBaseTier(medida: '9x15' | '9x20' | 'especial', barras: 4 | 6 | 8): number {
  if (barras === 6) return 38;
  if (barras === 8) return 45;
  // 4 barras: depende da medida
  return medida === 'especial' ? 30 : 25;
}
function calcPreco(medida: '9x15' | '9x20' | 'especial', barras: 4 | 6 | 8, espacamento: Espacamento): number {
  return precoBaseTier(medida, barras) + ESPACAMENTO_ACRESCIMO[espacamento];
}

// Constantes de custo do fornecedor (CMV). Nota: `estribo_4mm_por_metro`
// e nome legado da constante; o estribo real e ferro 4,2mm (convencao do
// schema ferragem_consumo usa 'ferro_4_2mm_estribo').
const FERRO_CUSTO = {
  barra_10mm_por_metro: 3.045,    // R$36,54 / 12m
  estribo_4mm_por_metro: 0.745,   // R$8,94 / 12m (ferro 4,2mm)
  comprimento_estribo: {
    '9x15': 0.58,   // 2*(0.09+0.15)+0.10
    '9x20': 0.68,   // 2*(0.09+0.20)+0.10
    'especial': 0.68,
  } as Record<string, number>,
};

function calcularCustoPorMetro(barras: number, medida: string, espacamentoM: number): number {
  const custoBarras = barras * FERRO_CUSTO.barra_10mm_por_metro;
  const estriboPorMetro = 1 / espacamentoM;
  const compEstribo = FERRO_CUSTO.comprimento_estribo[medida] ?? 0.68;
  const custoEstribos = estriboPorMetro * compEstribo * FERRO_CUSTO.estribo_4mm_por_metro;
  return custoBarras + custoEstribos;
}

type TipoElemento = 'coluna' | 'viga' | 'sapata' | 'cinta' | 'outro';
const TIPO_LABELS: Record<TipoElemento, string> = {
  coluna: 'Coluna',
  viga: 'Viga',
  sapata: 'Sapata',
  cinta: 'Cinta',
  outro: 'Outro',
};

export default function CalculadoraFerroModal({ onAdicionarItens, onClose }: Props) {
  const [medida, setMedida] = useState<'9x15' | '9x20' | 'especial'>('9x15');
  const [barras, setBarras] = useState<4 | 6 | 8>(4);
  const [tipo, setTipo] = useState<TipoElemento>('coluna');
  const [medidaEspecial, setMedidaEspecial] = useState('');
  const [quantidade, setQuantidade] = useState<number>(1);
  const [metrosPorPeca, setMetrosPorPeca] = useState<number>(0);
  const [espacamento, setEspacamento] = useState<Espacamento>('25');
  const [obs, setObs] = useState('');

  const espacamentoM = ESPACAMENTO_M[espacamento];
  const precoPorMetro = calcPreco(medida, barras, espacamento);
  const custoPorMetro = calcularCustoPorMetro(barras, medida, espacamentoM);
  const metrosTotal = quantidade * metrosPorPeca;
  const totalValor = metrosTotal * precoPorMetro;
  const totalCusto = metrosTotal * custoPorMetro;
  const margemPct = precoPorMetro > 0 ? ((precoPorMetro - custoPorMetro) / precoPorMetro) * 100 : 0;

  const handleAdicionar = () => {
    if (metrosTotal <= 0) return;
    const nomeMedida = medida === '9x15' ? '9×15' : medida === '9x20' ? '9×20' : (medidaEspecial || 'Especial');
    const tipoPlural = quantidade > 1 ? TIPO_LABELS[tipo] + 's' : TIPO_LABELS[tipo];
    const barrasLabel = medida === 'especial' ? barras + ' barras (especial)' : barras + ' barras';
    const obsLimpa = obs.trim();
    // Espacamento e observacao ficam embutidos no nome pra sobreviver a
    // persistencia (orcamento_itens nao tem colunas proprias) e aparecer
    // nos cards e na impressao do ferreiro.
    const nome = quantidade + ' ' + tipoPlural + ' ' + metrosPorPeca + 'm ' + nomeMedida + ' ' + barrasLabel
      + ' • Estribo ' + espacamento + 'cm | ' + metrosTotal + 'm'
      + (obsLimpa ? ' • Obs: ' + obsLimpa : '');

    // Detalhamento por tipo de ferro pra persistir em ferragem_consumo
    // (Batch B Fase 2). ferro_10mm = metros_de_peca * num_barras.
    // ferro_4_2mm_estribo = metros_de_peca * (perimetro_estribo / espacamento).
    const compEstribo = FERRO_CUSTO.comprimento_estribo[medida] ?? 0.68;
    const metrosEstribo = (metrosTotal * compEstribo) / espacamentoM;
    const detalhamento_ferro: DetalheFerro[] = [
      { tipo_ferro: 'ferro_10mm', metros: Math.round(metrosTotal * barras * 100) / 100 },
      { tipo_ferro: 'ferro_4_2mm_estribo', metros: Math.round(metrosEstribo * 100) / 100 },
    ];

    onAdicionarItens([{
      nome,
      quantidade: metrosTotal,
      preco: precoPorMetro,
      preco_custo: custoPorMetro,
      especificacoes: obsLimpa || undefined,
      detalhamento_ferro,
    }]);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] flex flex-col">
        <div className="p-6 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Calculadora de Ferro</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Tipo do elemento</label>
              <div className="grid grid-cols-5 gap-1">
                {(Object.entries(TIPO_LABELS) as [TipoElemento, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTipo(key)}
                    className={"p-2 rounded-lg border-2 text-xs font-medium transition-colors " +
                      (tipo === key ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Medida do estribo</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setMedida('9x15')} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (medida === '9x15' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">9×15</div>
                  <div className="text-xs opacity-75">R$25/m</div>
                </button>
                <button onClick={() => setMedida('9x20')} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (medida === '9x20' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">9×20</div>
                  <div className="text-xs opacity-75">R$25/m</div>
                </button>
                <button onClick={() => setMedida('especial')} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (medida === 'especial' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">Especial</div>
                  <div className="text-xs opacity-75">R$30/m</div>
                </button>
              </div>
              {medida === 'especial' && (
                <input type="text" value={medidaEspecial} onChange={e => setMedidaEspecial(e.target.value)} placeholder="Ex: 9×25, 10×30..." className="mt-2 w-full border border-orange-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Quantidade de Barras</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setBarras(4)} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (barras === 4 ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">4 Barras</div>
                  <div className="text-xs opacity-75">{medida === 'especial' ? 'R$30/m' : 'R$25/m'}</div>
                </button>
                <button onClick={() => setBarras(6)} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (barras === 6 ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">6 Barras</div>
                  <div className="text-xs opacity-75">R$38/m</div>
                </button>
                <button onClick={() => setBarras(8)} className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " + (barras === 8 ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                  <div className="font-bold">8 Barras</div>
                  <div className="text-xs opacity-75">R$45/m</div>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Espaçamento do estribo</label>
              <div className="grid grid-cols-4 gap-2">
                {(['25', '20', '15', '10'] as Espacamento[]).map(e => (
                  <button
                    key={e}
                    onClick={() => setEspacamento(e)}
                    className={"p-3 rounded-lg border-2 text-sm font-medium transition-colors " +
                      (espacamento === e ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
                  >
                    <div className="font-bold">{e}cm</div>
                    <div className="text-xs opacity-75">{ESPACAMENTO_ACRESCIMO[e] === 0 ? 'padrão' : '+R$' + ESPACAMENTO_ACRESCIMO[e]}</div>
                  </button>
                ))}
              </div>
              {espacamento !== '25' && (
                <p className="mt-2 text-xs text-orange-600">Estribo mais fechado que 25cm: +R${ESPACAMENTO_ACRESCIMO[espacamento]}/m no preço.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Qtd de peças</label>
                <input type="number" min="1" step="1" value={quantidade || ''} onChange={e => setQuantidade(parseInt(e.target.value) || 1)} placeholder="Ex: 4" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Metros por peça</label>
                <input type="number" min="0" step="0.5" value={metrosPorPeca || ''} onChange={e => setMetrosPorPeca(parseFloat(e.target.value) || 0)} placeholder="Ex: 5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Observação <span className="font-normal text-gray-400">(opcional)</span></label>
              <input type="text" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex: Cortar em barras de 3m" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Preço por metro</span>
                <span className="font-semibold">R$ {precoPorMetro.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-500 mb-1">
                <span>Custo por metro (CMV)</span>
                <span className="font-semibold">R$ {custoPorMetro.toFixed(2).replace('.', ',')} <span className="text-xs text-green-600">({margemPct.toFixed(1)}% margem)</span></span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Metragem total</span>
                <span className="font-semibold">
                  {metrosTotal > 0 ? quantidade + ' peça(s) × ' + metrosPorPeca + 'm = ' + metrosTotal + 'm' : 'Informe as medidas'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Item</span>
                <span className="font-semibold text-right text-xs max-w-[200px]">
                  {TIPO_LABELS[tipo]} {medida === '9x15' ? '9×15' : medida === '9x20' ? '9×20' : (medidaEspecial || 'Especial')} — {barras} barras — estribo {espacamento}cm
                </span>
              </div>
              <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg border-t border-orange-200 pt-2 mt-1">
                <span>Total</span>
                <span>R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
              {metrosTotal > 0 && (
                <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                  <span>Custo total</span>
                  <span>R$ {totalCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">
              Cancelar
            </button>
            <button onClick={handleAdicionar} disabled={metrosTotal <= 0} className="flex-1 px-4 py-2 bg-[#F7941D] text-white rounded-lg hover:bg-[#E8850A] disabled:opacity-50 font-bold">
              Adicionar ao Orçamento
            </button>
          </div>
      </div>
    </div>
  );
}
