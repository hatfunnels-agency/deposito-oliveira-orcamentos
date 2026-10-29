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

// Fallback dos parametros do traco caso /api/laje/config falhe. Mesmos
// valores do seed em laje_parametros — a fonte da verdade e o banco.
const PARAMS_FALLBACK: Record<string, number> = {
  cimento_sacos_por_m3: 7,
  areia_m3_por_m3: 0.55,
  pedra_m3_por_m3: 0.55,
  tela_m2_por_painel: 5.1,
};

// Vigotas treliçadas (pedido "por vigota", quando o cliente ja sabe quantas
// quer). Especificacao da Laje Master:
//   - cada vigota + lajota ocupa 0,42 m de largura (o "vao" = qtd x 0,42);
//   - a fabrica so produz em numeros pares de 20 em 20 cm, de 1,20 a 6,00 m;
//   - a vigota e vendida por metro linear; lajota, concreto etc. ficam so
//     como referencia (a atendente adiciona pelo catalogo se o cliente levar).
export const LARGURA_VIGOTA_M = 0.42;
export const TAMANHOS_VIGOTA: number[] = Array.from({ length: 25 }, (_, i) => Math.round((1.2 + i * 0.2) * 100) / 100);
// Lajotas por m² de laje (11,5 = mesma conta do sistema da fabrica:
// 6 m² -> 69 lajotas). Fica em laje_parametros, chave lajotas_por_m2.
export const LAJOTAS_POR_M2_FALLBACK = 11.5;
export type AlturaVigota = 'H8' | 'H12';
// Nome do produto no catalogo (o antigo "Mt. Linear Viga" fica como fallback
// enquanto o banco nao for renomeado).
const NOMES_VIGOTA: Record<AlturaVigota, string[]> = {
  H8: ['Vigota Treliçada H8', 'Mt. Linear Viga H8'],
  H12: ['Vigota Treliçada H12', 'Mt. Linear Viga H12'],
};
export const ehVigota = (nome: string) => /vigota treli|mt\. linear viga/i.test(nome);

export function calcularVigotas(qtd: number, comprimento: number, lajotasPorM2 = LAJOTAS_POR_M2_FALLBACK) {
  const vao = Math.round(qtd * LARGURA_VIGOTA_M * 100) / 100;
  const area = Math.round(vao * comprimento * 100) / 100;
  return { vao, area, lajotas: tetoSeguro(area * lajotasPorM2), metros: Math.round(qtd * comprimento * 100) / 100 };
}

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
  const [aba, setAba] = useState<'ambiente' | 'vigotas' | 'avulso'>('ambiente');
  const [consumo, setConsumo] = useState<Record<string, number>>({});
  const [parametros, setParametros] = useState<Record<string, number>>(PARAMS_FALLBACK);

  // Aba "ambiente"
  const [comprimento, setComprimento] = useState<number>(0);
  const [largura, setLargura] = useState<number>(0);
  const [uso, setUso] = useState<'forro' | 'piso'>('forro');
  const [temViga, setTemViga] = useState(false);
  const [trechos, setTrechos] = useState<number[]>([0, 0]);
  const [kitEscolhido, setKitEscolhido] = useState<string>('');

  // Aba "vigotas": o cliente ja sabe quantas quer e de que tamanho. Pode ter
  // mais de um tamanho no mesmo pedido (cada um vira uma linha).
  const [vigAltura, setVigAltura] = useState<AlturaVigota>('H8');
  const [vigUso, setVigUso] = useState<'forro' | 'piso'>('forro');
  const [vigLinhas, setVigLinhas] = useState<Array<{ qtd: number; comprimento: number }>>([{ qtd: 0, comprimento: 0 }]);

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

  // Avulsos = tudo da categoria Laje que nao e kit nem vigota (treliça por
  // barra, isopor e lajota por unidade, telas por peça). Vigota tem aba
  // propria, pra sair com as medidas pra fabrica.
  const avulsos = useMemo(() => {
    const termo = buscaAvulso.trim().toLowerCase();
    return produtos
      .filter(p => p.categoria === 'Laje' && !KITS.includes(p.nome) && !ehVigota(p.nome))
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

  // So o kit de laje vai pro orcamento. Cimento, areia, pedra e tela ficam
  // como referencia na tela (a atendente ve quanto o cliente vai precisar) mas
  // sao adicionados pelo catalogo, e so se o cliente pedir.
  const linhas: LinhaLaje[] = useMemo(() => {
    if (!produtoKit || area <= 0) return [];
    return [{
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
    }];
  }, [produtoKit, area, comprimento, largura, vaoLivre, uso, temViga]);

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

  // ---- Aba "vigotas" ----
  const produtoVigota = useMemo(() => {
    for (const nome of NOMES_VIGOTA[vigAltura]) {
      const p = acharProduto(nome);
      if (p) return p;
    }
    return null;
  }, [produtos, vigAltura]);
  const lajotasPorM2 = parametros.lajotas_por_m2 ?? LAJOTAS_POR_M2_FALLBACK;

  const vigCalc = useMemo(() => {
    const validas = vigLinhas.filter(l => l.qtd > 0 && l.comprimento > 0);
    const porLinha = validas.map(l => ({ ...l, ...calcularVigotas(l.qtd, l.comprimento, lajotasPorM2) }));
    const area = Math.round(porLinha.reduce((s, l) => s + l.area, 0) * 100) / 100;
    const metros = Math.round(porLinha.reduce((s, l) => s + l.metros, 0) * 100) / 100;
    const qtd = porLinha.reduce((s, l) => s + l.qtd, 0);
    return { porLinha, area, metros, qtd, lajotas: tetoSeguro(area * lajotasPorM2) };
  }, [vigLinhas, lajotasPorM2]);

  // Referencia de capa: usa o consumo do kit equivalente (lajota da mesma
  // altura), igual a aba ambiente. Nada disso entra no orcamento.
  const vigRef = useMemo(() => {
    if (vigCalc.area <= 0) return null;
    const nomeKit = vigAltura === 'H12' ? 'Laje H12 Lajota' : (vigUso === 'piso' ? 'Laje H08 Lajota Piso' : 'Laje H08 Lajota');
    const kit = acharProduto(nomeKit);
    const concreto = vigCalc.area * (kit ? (consumo[kit.id] ?? 0) : 0);
    const lajotaProd = acharProduto(vigAltura === 'H12' ? 'Lajota H12' : 'Lajota H8 / Forro e Piso');
    return {
      lajotaNome: lajotaProd?.nome ?? `Lajota ${vigAltura}`,
      concreto,
      cimento: tetoSeguro(concreto * (parametros.cimento_sacos_por_m3 ?? 7)),
      areia: tetoMeioM3(concreto * (parametros.areia_m3_por_m3 ?? 0.55)),
      pedra: tetoMeioM3(concreto * (parametros.pedra_m3_por_m3 ?? 0.55)),
      tela: tetoSeguro(vigCalc.area / (parametros.tela_m2_por_painel ?? 5.1)),
    };
  }, [vigCalc, vigAltura, vigUso, consumo, parametros, produtos]);

  const vigItens: LinhaLaje[] = useMemo(() => {
    if (!produtoVigota) return [];
    return vigCalc.porLinha.map(l => ({
      produto_id: produtoVigota.id,
      nome: produtoVigota.nome,
      quantidade: l.metros,
      unidade: produtoVigota.unidade,
      preco: produtoVigota.preco,
      preco_custo: produtoVigota.preco_custo,
      // comprimento = tamanho da vigota (e o vao que ela vence); largura =
      // faixa coberta (qtd x 0,42). A impressao recupera a qtd por largura/0,42.
      laje_detalhes: {
        comprimento: l.comprimento,
        largura: l.vao,
        area_m2: l.area,
        vao_livre: l.comprimento,
        uso: vigUso,
        tem_viga_intermediaria: false,
      },
    }));
  }, [produtoVigota, vigCalc, vigUso]);
  const vigTotal = vigItens.reduce((s, l) => s + l.quantidade * l.preco, 0);

  const adicionarVigotas = () => {
    if (!vigItens.length) return;
    onAdicionar(vigItens);
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
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button
              onClick={() => setAba('ambiente')}
              className={'p-3 rounded-lg border-2 text-sm font-medium transition-colors ' +
                (aba === 'ambiente' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
            >
              <div className="font-bold">Calcular ambiente</div>
              <div className="text-xs opacity-75">Monta o pedido pelas medidas</div>
            </button>
            <button
              onClick={() => setAba('vigotas')}
              className={'p-3 rounded-lg border-2 text-sm font-medium transition-colors ' +
                (aba === 'vigotas' ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}
            >
              <div className="font-bold">Por vigotas</div>
              <div className="text-xs opacity-75">Cliente já sabe quantas quer</div>
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

              {linhas.length > 0 && (
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
                  <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg mt-2 pt-2 border-t border-orange-200">
                    <span>Total</span>
                    <span>R$ {brl(total)}</span>
                  </div>
                </div>
              )}

              {/* Material da capa: SO referencia. Nao entra no orcamento — se o
                  cliente quiser, a atendente adiciona pelo catalogo. */}
              {calc && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">
                    Material da capa — referência
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                    <span>Concreto</span><span className="text-right font-semibold">{brl(calc.concreto)} m³</span>
                    <span>Cimento</span><span className="text-right font-semibold">{calc.cimento} sacos</span>
                    <span>Areia</span><span className="text-right font-semibold">{brl(calc.areia)} m³</span>
                    <span>Pedra</span><span className="text-right font-semibold">{brl(calc.pedra)} m³</span>
                    <span>Tela 20×20</span><span className="text-right font-semibold">{calc.tela} peças</span>
                  </div>
                  <p className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                    Não entra no orçamento. Se o cliente quiser levar, adicione pelo catálogo.
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                {AVISO_LAJE}
              </p>
            </div>
          )}

          {aba === 'vigotas' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Altura</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['H8', 'H12'] as const).map(h => (
                      <button key={h} onClick={() => setVigAltura(h)}
                        className={'p-2 rounded-lg border-2 text-sm font-bold transition-colors ' +
                          (vigAltura === h ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Uso</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['forro', 'piso'] as const).map(u => (
                      <button key={u} onClick={() => setVigUso(u)}
                        className={'p-2 rounded-lg border-2 text-sm font-bold transition-colors ' +
                          (vigUso === u ? 'border-[#F7941D] bg-orange-50 text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                        {u === 'forro' ? 'Forro' : 'Piso'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Vigotas</label>
                <div className="space-y-2">
                  {vigLinhas.map((l, i) => {
                    const c = l.qtd > 0 && l.comprimento > 0 ? calcularVigotas(l.qtd, l.comprimento, lajotasPorM2) : null;
                    return (
                      <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" step="1" value={l.qtd || ''} placeholder="Qtd"
                            onChange={e => {
                              const v = Math.max(0, Math.floor(parseFloat(e.target.value) || 0));
                              setVigLinhas(prev => prev.map((x, j) => (j === i ? { ...x, qtd: v } : x)));
                            }}
                            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          <span className="text-sm text-gray-500">vigotas de</span>
                          <select value={l.comprimento || ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || 0;
                              setVigLinhas(prev => prev.map((x, j) => (j === i ? { ...x, comprimento: v } : x)));
                            }}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                            <option value="">tamanho</option>
                            {TAMANHOS_VIGOTA.map(t => (
                              <option key={t} value={t}>{brl(t)} m</option>
                            ))}
                          </select>
                          {vigLinhas.length > 1 && (
                            <button onClick={() => setVigLinhas(prev => prev.filter((_, j) => j !== i))}
                              className="text-gray-400 hover:text-red-500 text-xl leading-none px-1">&times;</button>
                          )}
                        </div>
                        {c && (
                          <div className="mt-2 text-xs text-gray-600">
                            Vão {brl(c.vao)} m ({l.qtd} × 0,42) · Área {brl(c.area)} m² · {brl(c.metros)} m lineares
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setVigLinhas(prev => [...prev, { qtd: 0, comprimento: 0 }])}
                  className="mt-2 text-xs font-medium text-[#F7941D] hover:underline">+ Outro tamanho</button>
                <p className="mt-2 text-xs text-gray-500">
                  A fábrica produz de 1,20 m a 6,00 m, de 20 em 20 cm. Treliça avulsa é barra de 12 m.
                </p>
              </div>

              {!produtoVigota && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  Produto &quot;Vigota Treliçada {vigAltura}&quot; não encontrado no catálogo.
                </p>
              )}

              {vigItens.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2 pb-2 border-b border-orange-200">
                    <span>{vigCalc.qtd} vigotas · {brl(vigCalc.area)} m² de laje</span>
                    <span className="font-bold">{brl(vigCalc.metros)} m lineares</span>
                  </div>
                  {vigItens.map((l, i) => (
                    <div key={i} className="flex justify-between items-center text-sm py-1">
                      <span className="text-gray-800">{l.nome} — {vigCalc.porLinha[i].qtd} × {brl(vigCalc.porLinha[i].comprimento)} m</span>
                      <span className="text-gray-600 whitespace-nowrap">
                        {brl(l.quantidade)} m · R$ {brl(l.quantidade * l.preco)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center font-bold text-[#F7941D] text-lg mt-2 pt-2 border-t border-orange-200">
                    <span>Total</span>
                    <span>R$ {brl(vigTotal)}</span>
                  </div>
                </div>
              )}

              {vigRef && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">
                    Material sugerido — referência
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                    <span>{vigRef.lajotaNome}</span><span className="text-right font-semibold">{vigCalc.lajotas} un</span>
                    <span>Concreto</span><span className="text-right font-semibold">{brl(vigRef.concreto)} m³</span>
                    <span>Cimento</span><span className="text-right font-semibold">{vigRef.cimento} sacos</span>
                    <span>Areia</span><span className="text-right font-semibold">{brl(vigRef.areia)} m³</span>
                    <span>Pedra</span><span className="text-right font-semibold">{brl(vigRef.pedra)} m³</span>
                    <span>Tela 20×20</span><span className="text-right font-semibold">{vigRef.tela} peças</span>
                  </div>
                  <p className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                    Não entra no orçamento. Se o cliente quiser levar, adicione pelo catálogo.
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                {AVISO_LAJE}
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
            onClick={aba === 'ambiente' ? adicionarAmbiente : aba === 'vigotas' ? adicionarVigotas : adicionarAvulso}
            disabled={aba === 'ambiente' ? linhas.length === 0 : aba === 'vigotas' ? vigItens.length === 0 : (!avulsoId || avulsoQtd <= 0)}
            className="flex-1 px-4 py-2 bg-[#F7941D] text-white rounded-lg hover:bg-[#E8850A] disabled:opacity-50 font-bold"
          >
            Adicionar ao Orçamento
          </button>
        </div>
      </div>
    </div>
  );
}
