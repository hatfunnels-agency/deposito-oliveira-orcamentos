'use client';
import { useEffect, useMemo, useState } from 'react';

// Aviso de isencao: aparece no modal, no orcamento do cliente e no pedido da
// fabrica. A sugestao do sistema e comercial, nao e projeto estrutural.
export const AVISO_LAJE =
  'Sugestão do sistema. Especificação final (tipo e armadura) é confirmada pela fábrica.';

export interface DetalhesLaje {
  comprimento: number | null;
  largura: number | null;
  area_m2: number;
  vao_livre: number;
  uso: 'forro' | 'piso';
  tem_viga_intermediaria: boolean;
}

// Linha que a calculadora manda pro orcamento. produto_id e sempre real (os
// produtos existem no catalogo), entao preco/CMV/baixa de estoque seguem o
// fluxo normal: kit e sob_demanda (nao baixa), cimento/areia/pedra baixam.
export interface LinhaLaje {
  produto_id: string;
  nome: string;
  quantidade: number;
  unidade: string;
  preco: number;
  preco_custo: number;
  laje_detalhes?: DetalhesLaje;
}

interface ProdutoLaje {
  id: string;
  nome: string;
  unidade: string;
  preco: number;
  preco_custo: number;
  categoria: string;
}

interface Props {
  produtos: ProdutoLaje[];
  onAdicionar: (linhas: LinhaLaje[]) => void;
  onClose: () => void;
}

// Os 6 kits vendidos por m2. A ordem e a da regua do vao (H8 -> H16).
const KITS = [
  'Laje H08 Isopor',
  'Laje H08 Lajota',
  'Laje H08 Lajota Piso',
  'Laje H12 Isopor',
  'Laje H12 Lajota',
  'Laje H16 Isopor',
];

// Nomes exatos no catalogo (conferidos no banco). Cimento tem duas marcas
// ativas; Votoram e o default. As variantes "s/ Entrega" estao inativas.
const CIMENTO_VOTORAM = 'Cimento CP2 c/ Entrega - Votoram';
const CIMENTO_CAUE = 'Cimento CP2 c/ Entrega - Cauê';
const AREIA = 'Areia Média';
const PEDRA = 'Pedra Brita';
const TELA = 'Tela Pop 2 x 3 (20 x 20) Ferro 3.4';

// Fallback dos parametros do traco caso /api/laje/config falhe. Mesmos
// valores do seed em laje_parametros — a fonte da verdade e o banco.
const PARAMS_FALLBACK: Record<string, number> = {
  cimento_sacos_por_m3: 7,
  areia_m3_por_m3: 0.55,
  pedra_m3_por_m3: 0.55,
  tela_m2_por_painel: 5.1,
};

// Arredonda pra cima com guarda de float: sem isso, 2.0000000001 viraria 3.
function tetoSeguro(v: number): number {
  return Math.ceil(parseFloat(v.toFixed(6)));
}
// Arredonda pra cima em multiplos de 0,5 (areia e pedra sao vendidas assim).
function tetoMeioM3(v: number): number {
  return tetoSeguro(v / 0.5) * 0.5;
}
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// R1 — Regua do vao. As vigotas correm no sentido do lado menor, entao o vao
// livre e a menor medida do ambiente (ou o maior trecho, se houver viga no
// meio). Quanto maior o vao, mais alta a laje.
function sugerirKit(vao: number, uso: 'forro' | 'piso'): string {
  if (vao <= 4) return uso === 'piso' ? 'Laje H08 Lajota Piso' : 'Laje H08 Lajota';
  if (vao <= 5) return uso === 'piso' ? 'Laje H12 Lajota' : 'Laje H12 Isopor';
  return 'Laje H16 Isopor';
}

export default function CalculadoraLajeModal({ produtos, onAdicionar, onClose }: Props) {
  const [aba, setAba] = useState<'ambiente' | 'avulso'>('ambiente');
  const [consumo, setConsumo] = useState<Record<string, number>>({});
  const [parametros, setParametros] = useState<Record<string, number>>(PARAMS_FALLBACK);

  // Aba "ambiente"
  const [comprimento, setComprimento] = useState<number>(0);
  const [largura, setLargura] = useState<number>(0);
  const [uso, setUso] = useState<'forro' | 'piso'>('forro');
  const [temViga, setTemViga] = useState(false);
  const [trechos, setTrechos] = useState<number[]>([0, 0]);
  const [kitEscolhido, setKitEscolhido] = useState<string>('');
  const [marcaCimento, setMarcaCimento] = useState<string>(CIMENTO_VOTORAM);

  // Aba "avulso"
  const [buscaAvulso, setBuscaAvulso] = useState('');
  const [avulsoId, setAvulsoId] = useState('');
  const [avulsoQtd, setAvulsoQtd] = useState<number>(1);

  useEffect(() => {
    fetch('/api/laje/config', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d?.consumo) setConsumo(d.consumo);
        if (d?.parametros && Object.keys(d.parametros).length) setParametros(d.parametros);
      })
      .catch(() => { /* mantem o fallback */ });
  }, []);

  const acharProduto = (nome: string) => produtos.find(p => p.nome === nome) || null;

  const kitsDisponiveis = useMemo(
    () => KITS.map(acharProduto).filter((p): p is ProdutoLaje => p !== null),
    [produtos],
  );

  // Avulsos = tudo da categoria Laje que nao e kit (treliça por barra, isopor
  // e lajota por unidade, telas por peça, viga por metro).
  const avulsos = useMemo(() => {
    const termo = buscaAvulso.trim().toLowerCase();
    return produtos
      .filter(p => p.categoria === 'Laje' && !KITS.includes(p.nome))
      .filter(p => !termo || p.nome.toLowerCase().includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [produtos, buscaAvulso]);

  const area = useMemo(() => {
    const a = comprimento * largura;
    return a > 0 ? Math.round(a * 100) / 100 : 0;
  }, [comprimento, largura]);

  // Com viga intermediaria o vao que manda e o MAIOR trecho (o mais critico).
  // Sem viga, e o lado menor do ambiente.
  const vaoLivre = useMemo(() => {
    if (temViga) {
      const validos = trechos.filter(t => t > 0);
      return validos.length ? Math.max(...validos) : 0;
    }
    if (comprimento > 0 && largura > 0) return Math.min(comprimento, largura);
    return 0;
  }, [temViga, trechos, comprimento, largura]);

  const kitSugerido = vaoLivre > 0 ? sugerirKit(vaoLivre, uso) : '';
  const kitAtivo = kitEscolhido || kitSugerido;
  const produtoKit = kitAtivo ? acharProduto(kitAtivo) : null;
  const vaoGrande = vaoLivre > 5;

  // R2/R3 — quantidades da venda casada.
  const calc = useMemo(() => {
    if (!produtoKit || area <= 0) return null;
    const m3PorM2 = consumo[produtoKit.id] ?? 0;
    const concreto = area * m3PorM2;
    return {
      concreto,
      cimento: tetoSeguro(concreto * (parametros.cimento_sacos_por_m3 ?? 7)),
      areia: tetoMeioM3(concreto * (parametros.areia_m3_por_m3 ?? 0.55)),
      pedra: tetoMeioM3(concreto * (parametros.pedra_m3_por_m3 ?? 0.55)),
      tela: tetoSeguro(area / (parametros.tela_m2_por_painel ?? 5.1)),
    };
  }, [produtoKit, area, consumo, parametros]);

  // Monta as linhas com os produtos que existem. Se algum casado sumir do
  // catalogo, a linha e omitida e a atendente e avisada — nao trava a venda.
  const { linhas, faltando } = useMemo(() => {
    const linhas: LinhaLaje[] = [];
    const faltando: string[] = [];
    if (!produtoKit || !calc || area <= 0) return { linhas, faltando };

    linhas.push({
      produto_id: produtoKit.id,
      nome: produtoKit.nome,
      quantidade: area,
      unidade: produtoKit.unidade,
      preco: produtoKit.preco,
      preco_custo: produtoKit.preco_custo,
      laje_detalhes: {
        comprimento: temViga ? null : comprimento,
        largura: temViga ? null : largura,
        area_m2: area,
        vao_livre: vaoLivre,
        uso,
        tem_viga_intermediaria: temViga,
      },
    });

    const casados: Array<[string, number]> = [
      [marcaCimento, calc.cimento],
      [AREIA, calc.areia],
      [PEDRA, calc.pedra],
      [TELA, calc.tela],
    ];
    for (const [nome, qtd] of casados) {
      const p = acharProduto(nome);
      if (!p) { faltando.push(nome); continue; }
      if (qtd <= 0) continue;
      linhas.push({
        produto_id: p.id,
        nome: p.nome,
        quantidade: qtd,
        unidade: p.unidade,
        preco: p.preco,
        preco_custo: p.preco_custo,
      });
    }
    return { linhas, faltando };
  }, [produtoKit, calc, area, comprimento, largura, vaoLivre, uso, temViga, marcaCimento, produtos]);

  const total = linhas.reduce((s, l) => s + l.quantidade * l.preco, 0);

  const adicionarAmbiente = () => {
    if (!linhas.length) return;
    onAdicionar(linhas);
    onClose();
  };

  const adicionarAvulso = () => {
    const p = avulsos.find(x => x.id === avulsoId);
    if (!p || avulsoQtd <= 0) return;
    onAdicionar([{
      produto_id: p.id,
      nome: p.nome,
      quantidade: avulsoQtd,
      unidade: p.unidade,
      preco: p.preco,
      preco_custo: p.preco_custo,
    }]);
    onClose();
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
        <div className="p-6 pb-0 shrink-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">Laje</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setAba('ambiente')}
              className={'p-3 rounded-lg border-2 text-sm font-medium transition-colors ' +
                (aba === 'ambiente' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
            >
              <div className="font-bold">Calcular ambiente</div>
              <div className="text-xs opacity-75">Monta o pedido pelas medidas</div>
            </button>
            <button
              onClick={() => setAba('avulso')}
              className={'p-3 rounded-lg border-2 text-sm font-medium transition-colors ' +
                (aba === 'avulso' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
            >
              <div className="font-bold">Item avulso</div>
              <div className="text-xs opacity-75">Treliça, isopor, lajota, tela</div>
            </button>
          </div>
        </div>

        <div className="px-6 overflow-y-auto">
          {aba === 'ambiente' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Comprimento (m)</label>
                  <input type="number" min="0" step="0.1" value={comprimento || ''} placeholder="Ex: 6"
                    onChange={e => setComprimento(parseFloat(e.target.value) || 0)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Largura (m)</label>
                  <input type="number" min="0" step="0.1" value={largura || ''} placeholder="Ex: 4,5"
                    onChange={e => setLargura(parseFloat(e.target.value) || 0)} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Uso da laje</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['forro', 'piso'] as const).map(u => (
                    <button key={u} onClick={() => { setUso(u); setKitEscolhido(''); }}
                      className={'p-3 rounded-lg border-2 text-sm font-medium transition-colors ' +
                        (uso === u ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                      <div className="font-bold">{u === 'forro' ? 'Forro' : 'Piso'}</div>
                      <div className="text-xs opacity-75">{u === 'forro' ? 'Só telhado em cima' : 'Vai ter tráfego'}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={temViga}
                    onChange={e => { setTemViga(e.target.checked); setKitEscolhido(''); }}
                    className="w-4 h-4 accent-[#F7941D]" />
                  Tem viga intermediária (apoio no meio do vão)
                </label>
                {temViga && (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-2">
                      Informe o vão livre de cada trecho (entre apoios). O sistema usa o maior deles.
                    </p>
                    <div className="space-y-2">
                      {trechos.map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Trecho {i + 1}</span>
                          <input type="number" min="0" step="0.1" value={t || ''} placeholder="m"
                            onChange={e => {
                              const v = parseFloat(e.target.value) || 0;
                              setTrechos(prev => prev.map((x, j) => (j === i ? v : x)));
                              setKitEscolhido('');
                            }}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          {trechos.length > 2 && (
                            <button onClick={() => setTrechos(prev => prev.filter((_, j) => j !== i))}
                              className="text-gray-400 hover:text-red-500 text-lg leading-none px-1">&times;</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setTrechos(prev => [...prev, 0])}
                      className="mt-2 text-xs font-medium text-[#F7941D] hover:underline">+ Adicionar trecho</button>
                  </div>
                )}
              </div>

              {vaoLivre > 0 && (
                <div className={'rounded-lg p-4 border ' + (vaoGrande ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-200')}>
                  <div className="flex justify-between text-sm text-gray-700 mb-1">
                    <span>Vão livre</span>
                    <span className="font-bold">{vaoLivre.toString().replace('.', ',')} m</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>Sugestão do sistema</span>
                    <span className="font-bold">{kitSugerido}</span>
                  </div>
                  {vaoGrande && (
                    <p className="mt-2 text-xs font-bold text-red-700">
                      ⚠ Vão grande (acima de 5m) — especificação obrigatória da fábrica antes de produzir.
                    </p>
                  )}
                </div>
              )}

              {kitsDisponiveis.length > 0 && vaoLivre > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Kit <span className="font-normal text-gray-400">(pode trocar se precisar)</span>
                  </label>
                  <select value={kitAtivo} onChange={e => setKitEscolhido(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                    {kitsDisponiveis.map(k => (
                      <option key={k.id} value={k.nome}>
                        {k.nome} — R$ {brl(k.preco)}/m²{k.nome === kitSugerido ? ' (sugerido)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Cimento</label>
                <div className="grid grid-cols-2 gap-2">
                  {[CIMENTO_VOTORAM, CIMENTO_CAUE].filter(n => acharProduto(n)).map(n => (
                    <button key={n} onClick={() => setMarcaCimento(n)}
                      className={'p-2 rounded-lg border-2 text-xs font-medium transition-colors ' +
                        (marcaCimento === n ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                      {n.includes('Votoram') ? 'Votoram' : 'Cauê'}
                      <div className="text-xs opacity-75">R$ {brl(acharProduto(n)?.preco ?? 0)}/saco</div>
                    </button>
                  ))}
                </div>
              </div>

              {calc && linhas.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2 pb-2 border-b border-orange-200">
                    <span>Área</span>
                    <span className="font-bold">{brl(area)} m²</span>
                  </div>
                  {linhas.map(l => (
                    <div key={l.produto_id} className="flex justify-between items-baseline text-sm text-gray-700 mb-1">
                      <span className="text-xs pr-2">{l.nome}</span>
                      <span className="whitespace-nowrap">
                        <span className="font-semibold">{brl(l.quantidade)} {l.unidade}</span>
                        <span className="text-gray-400 text-xs"> · R$ {brl(l.quantidade * l.preco)}</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-orange-200">
                    <span>Concreto da capa (informativo)</span>
                    <span>{brl(calc.concreto)} m³</span>
                  </div>
                  <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg mt-1">
                    <span>Total</span>
                    <span>R$ {brl(total)}</span>
                  </div>
                  {faltando.length > 0 && (
                    <p className="mt-2 text-xs text-red-600">
                      Não encontrei no catálogo: {faltando.join(', ')}. Adicione manualmente se precisar.
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                {AVISO_LAJE} As linhas abaixo entram no orçamento e podem ser editadas ou removidas antes de salvar.
              </p>
            </div>
          )}

          {aba === 'avulso' && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Produto</label>
                <input type="text" value={buscaAvulso} onChange={e => setBuscaAvulso(e.target.value)}
                  placeholder="Buscar... ex: treliça, isopor, lajota, tela"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {avulsos.length === 0 && (
                    <div className="p-3 text-sm text-gray-400 text-center">Nenhum item de laje encontrado</div>
                  )}
                  {avulsos.map(p => (
                    <button key={p.id} onClick={() => setAvulsoId(p.id)}
                      className={'w-full text-left px-3 py-2 transition-colors ' + (avulsoId === p.id ? 'bg-orange-50' : 'hover:bg-gray-50')}>
                      <div className="flex justify-between items-center gap-2">
                        <span className={'text-sm font-medium ' + (avulsoId === p.id ? 'text-[#F7941D]' : 'text-gray-800')}>{p.nome}</span>
                        <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">R$ {brl(p.preco)}/{p.unidade}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Quantidade</label>
                <input type="number" min="0" step="1" value={avulsoQtd || ''} placeholder="Ex: 10"
                  onChange={e => setAvulsoQtd(parseFloat(e.target.value) || 0)} className={inputCls} />
              </div>

              {avulsoId && avulsoQtd > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex justify-between items-center font-bold text-[#F7941D] text-lg">
                  <span>Total</span>
                  <span>R$ {brl(avulsoQtd * (avulsos.find(p => p.id === avulsoId)?.preco ?? 0))}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">
            Cancelar
          </button>
          <button
            onClick={aba === 'ambiente' ? adicionarAmbiente : adicionarAvulso}
            disabled={aba === 'ambiente' ? linhas.length === 0 : (!avulsoId || avulsoQtd <= 0)}
            className="flex-1 px-4 py-2 bg-[#F7941D] text-white rounded-lg hover:bg-[#E8850A] disabled:opacity-50 font-bold"
          >
            Adicionar ao Orçamento
          </button>
        </div>
      </div>
    </div>
  );
}
