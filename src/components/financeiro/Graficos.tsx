'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FluxoDia } from '@/lib/financeiro/tipos';
import { brl, brlCurto, dataCurta, diaSemanaCurto } from '@/lib/financeiro/formato';

// Graficos em SVG inline, sem biblioteca. Regras seguidas (skill dataviz):
// marcas finas (barra <= 24px, linha 2px, marcador r=4 com anel branco),
// grade em linha fina solida, legenda sempre presente com 2+ series,
// rotulo direto so no ponto final, tooltip por hover/toque e vista em
// tabela (o laranja da marca fica abaixo de 3:1 no fundo claro — a tabela
// e o rotulo direto sao o alivio exigido). Paleta validada com o script da
// skill: entrada #059669 / projetado #10b981 (rampa ordinal) / saida
// #ef4444 / saldo #F7941D / cenarios #2563eb, #F7941D, #059669.

const COR = {
  entrada: '#059669',
  entradaProjetada: '#10b981',
  saida: '#ef4444',
  saldo: '#F7941D',
  contratado: '#4b5563',
  grade: '#e5e7eb',
  eixo: '#9ca3af',
  texto: '#6b7280',
  textoForte: '#374151',
};

export const CORES_CENARIOS = ['#2563eb', '#F7941D', '#059669'];

const FONTE = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Largura real do container: textos do SVG ficam em px de verdade no celular
// (um viewBox fixo encolheria a fonte pela metade a 360px).
function useLargura<T extends HTMLElement>(padrao = 720) {
  const ref = useRef<T | null>(null);
  const [largura, setLargura] = useState(padrao);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(entradas => {
      const w = entradas[0]?.contentRect.width;
      if (w && w > 0) setLargura(Math.round(w));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, largura };
}

// Ticks "redondos" entre min e max (3 a 5 valores), sempre incluindo o zero
// quando ele esta no intervalo.
function ticks(min: number, max: number, qtd = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min];
  const bruto = (max - min) / qtd;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * pot).find(p => p >= bruto) ?? pot * 10;
  const saida: number[] = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + 1e-9; v += passo) saida.push(Number(v.toFixed(6)));
  if (min <= 0 && max >= 0 && !saida.some(v => Math.abs(v) < 1e-9)) saida.push(0);
  return saida.sort((a, b) => a - b);
}

function Tooltip({ x, largura, children }: { x: number; largura: number; children: React.ReactNode }) {
  // Flipa para a esquerda na metade direita pra nao sair da tela.
  const esquerda = x > largura / 2;
  const estilo = esquerda ? { right: Math.max(0, largura - x + 10) } : { left: Math.min(largura - 10, x + 10) };
  return (
    <div className="absolute top-2 z-10 pointer-events-none bg-white border border-gray-200 shadow-md rounded-lg px-3 py-2 text-xs text-gray-700 min-w-[170px]" style={estilo}>
      {children}
    </div>
  );
}

function LinhaTooltip({ cor, rotulo, valor, tracejada = false }: { cor: string; rotulo: string; valor: string; tracejada?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-1.5 text-gray-500">
        <svg width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={cor} strokeWidth="2" strokeDasharray={tracejada ? '3 2' : undefined} /></svg>
        {rotulo}
      </span>
      <strong className="text-gray-900 tabular-nums">{valor}</strong>
    </div>
  );
}

function ChaveLegenda({ cor, rotulo, tipo = 'rect', tracejada = false }: { cor: string; rotulo: string; tipo?: 'rect' | 'linha'; tracejada?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      {tipo === 'rect'
        ? <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: cor }} />
        : <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={cor} strokeWidth="2" strokeDasharray={tracejada ? '4 3' : undefined} /></svg>}
      {rotulo}
    </span>
  );
}

// ---------------------------------------------------------------- fluxo 30d

export function FluxoCaixa30d({ dias, entradasAtrasadas = 0, titulo = 'Fluxo de caixa — próximos 30 dias' }: {
  dias: FluxoDia[]; entradasAtrasadas?: number; titulo?: string;
}) {
  const [incluirProjetadas, setIncluirProjetadas] = useState(true);
  const [tabela, setTabela] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const { ref, largura } = useLargura<HTMLDivElement>();

  const n = dias.length;
  const margem = { esq: 56, dir: 16, topo: 12 };
  const alturaSaldo = 150;
  const vao = 22;
  const alturaBarras = 110;
  const bandaEixo = 26;
  const H = margem.topo + alturaSaldo + vao + alturaBarras + bandaEixo;
  const plotW = Math.max(40, largura - margem.esq - margem.dir);
  const slot = n > 0 ? plotW / n : plotW;
  const barraW = Math.max(2, Math.min(24, slot - 2));
  const xDe = (i: number) => margem.esq + slot * i + slot / 2;

  const serie = useMemo(() => dias.map(d => ({
    ...d,
    entradaTotal: d.entradas_contratadas + (incluirProjetadas ? d.entradas_projetadas : 0),
    saldoLinha: incluirProjetadas ? d.saldo_projetado : d.saldo_so_contratado,
  })), [dias, incluirProjetadas]);

  // Painel do saldo (linhas) — escala propria, zero destacado.
  const saldos = serie.flatMap(d => incluirProjetadas ? [d.saldo_projetado, d.saldo_so_contratado] : [d.saldo_so_contratado]);
  const sMin = Math.min(0, ...saldos);
  const sMax = Math.max(0, ...saldos);
  const sTopo = margem.topo;
  const sBase = margem.topo + alturaSaldo;
  const yS = (v: number) => sMax === sMin ? sBase : sBase - ((v - sMin) / (sMax - sMin)) * alturaSaldo;

  // Painel das barras: entradas pra cima e saidas pra baixo, na mesma escala.
  const maxEnt = Math.max(0, ...serie.map(d => d.entradaTotal));
  const maxSai = Math.max(0, ...serie.map(d => d.saidas));
  const bTopo = sBase + vao;
  const unidade = maxEnt + maxSai > 0 ? alturaBarras / (maxEnt + maxSai) : 0;
  const yZeroBarras = bTopo + maxEnt * unidade;

  const cadaRotulo = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 48))));

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - margem.esq;
    if (x < -slot / 2 || x > plotW + slot / 2 || n === 0) { setHover(null); return; }
    setHover(Math.max(0, Math.min(n - 1, Math.floor(x / slot))));
  };

  const caminho = (chave: 'saldo_projetado' | 'saldo_so_contratado') =>
    serie.map((d, i) => `${i === 0 ? 'M' : 'L'}${xDe(i).toFixed(1)},${yS(d[chave]).toFixed(1)}`).join(' ');

  const ultimo = serie[n - 1];
  const tSaldo = ticks(sMin, sMax, 3);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-800 text-sm">{titulo}</h3>
          <p className="text-xs text-gray-500">Saldo projetado em cima; entradas e saídas por dia embaixo.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-gray-700 min-h-[40px] cursor-pointer select-none">
            <input type="checkbox" checked={incluirProjetadas} onChange={e => setIncluirProjetadas(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" />
            incluir vendas no ritmo atual
          </label>
          <button type="button" onClick={() => setTabela(t => !t)} className="text-xs text-[#C96F00] hover:underline min-h-[40px] px-1">
            {tabela ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </div>

      {n === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">Sem dados de fluxo.</div>
      ) : tabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 text-left">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Dia</th>
                <th className="py-1.5 px-2 font-medium text-right">Contratado</th>
                <th className="py-1.5 px-2 font-medium text-right">Projetado</th>
                <th className="py-1.5 px-2 font-medium text-right">Saídas</th>
                <th className="py-1.5 px-2 font-medium text-right">Saldo projetado</th>
                <th className="py-1.5 pl-2 font-medium text-right">Só contratado</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {dias.map(d => (
                <tr key={d.data} className="border-t border-gray-100">
                  <td className="py-1 pr-2 text-gray-700 whitespace-nowrap">{dataCurta(d.data)} <span className="text-gray-400">{diaSemanaCurto(d.data)}</span></td>
                  <td className="py-1 px-2 text-right">{brl(d.entradas_contratadas)}</td>
                  <td className="py-1 px-2 text-right">{brl(d.entradas_projetadas)}</td>
                  <td className="py-1 px-2 text-right">{brl(d.saidas)}</td>
                  <td className={`py-1 px-2 text-right font-semibold ${d.saldo_projetado < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(d.saldo_projetado)}</td>
                  <td className={`py-1 pl-2 text-right ${d.saldo_so_contratado < 0 ? 'text-red-700' : 'text-gray-700'}`}>{brl(d.saldo_so_contratado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full">
          <svg width={largura} height={H} role="img" aria-label={titulo} style={{ fontFamily: FONTE, touchAction: 'pan-y' }}
            onPointerMove={aoMover} onPointerDown={aoMover} onPointerLeave={() => setHover(null)}>
            {/* grade do saldo */}
            {tSaldo.map(v => (
              <g key={`s${v}`}>
                <line x1={margem.esq} x2={margem.esq + plotW} y1={yS(v)} y2={yS(v)} stroke={v === 0 ? COR.eixo : COR.grade} strokeWidth={1} />
                <text x={margem.esq - 6} y={yS(v) + 3} textAnchor="end" fontSize={10} fill={COR.texto}>{brlCurto(v)}</text>
              </g>
            ))}
            {/* linhas de saldo */}
            <path d={caminho('saldo_so_contratado')} fill="none" stroke={COR.contratado} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
            {incluirProjetadas && (
              <path d={caminho('saldo_projetado')} fill="none" stroke={COR.saldo} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {ultimo && (
              <g>
                <circle cx={xDe(n - 1)} cy={yS(ultimo.saldo_so_contratado)} r={4} fill={COR.contratado} stroke="#fff" strokeWidth={2} />
                {incluirProjetadas && <circle cx={xDe(n - 1)} cy={yS(ultimo.saldo_projetado)} r={4} fill={COR.saldo} stroke="#fff" strokeWidth={2} />}
                <text x={Math.min(xDe(n - 1), margem.esq + plotW) - 8} y={yS(ultimo.saldoLinha) - 8} textAnchor="end" fontSize={11} fontWeight={600} fill={COR.textoForte}>
                  {brlCurto(ultimo.saldoLinha)}
                </text>
              </g>
            )}
            {/* barras */}
            <line x1={margem.esq} x2={margem.esq + plotW} y1={yZeroBarras} y2={yZeroBarras} stroke={COR.eixo} strokeWidth={1} />
            {serie.map((d, i) => {
              const x = xDe(i) - barraW / 2;
              const hC = d.entradas_contratadas * unidade;
              const hP = incluirProjetadas ? d.entradas_projetadas * unidade : 0;
              const hS = d.saidas * unidade;
              const vaoStack = hC > 0 && hP > 0 ? 2 : 0;
              return (
                <g key={d.data} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {hC > 0 && <rect x={x} y={yZeroBarras - hC} width={barraW} height={hC} fill={COR.entrada} rx={hP > 0 ? 0 : 3} />}
                  {hP > 0 && <rect x={x} y={yZeroBarras - hC - vaoStack - hP} width={barraW} height={hP} fill={COR.entradaProjetada} rx={3} />}
                  {hS > 0 && <rect x={x} y={yZeroBarras + 1} width={barraW} height={hS} fill={COR.saida} rx={3} />}
                </g>
              );
            })}
            {/* eixo x */}
            {serie.map((d, i) => (i % cadaRotulo === 0 || i === n - 1) && (
              <text key={`x${d.data}`} x={xDe(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={COR.texto}>{dataCurta(d.data)}</text>
            ))}
            {/* crosshair */}
            {hover !== null && (
              <line x1={xDe(hover)} x2={xDe(hover)} y1={sTopo} y2={H - bandaEixo} stroke={COR.eixo} strokeWidth={1} />
            )}
          </svg>
          {hover !== null && serie[hover] && (
            <Tooltip x={xDe(hover)} largura={largura}>
              <p className="font-semibold text-gray-900 mb-1">{dataCurta(serie[hover].data)} · {diaSemanaCurto(serie[hover].data)}</p>
              <LinhaTooltip cor={COR.entrada} rotulo="Contratado" valor={brl(serie[hover].entradas_contratadas)} />
              {incluirProjetadas && <LinhaTooltip cor={COR.entradaProjetada} rotulo="Projetado" valor={brl(serie[hover].entradas_projetadas)} />}
              <LinhaTooltip cor={COR.saida} rotulo="Saídas" valor={brl(serie[hover].saidas)} />
              {incluirProjetadas && <LinhaTooltip cor={COR.saldo} rotulo="Saldo projetado" valor={brl(serie[hover].saldo_projetado)} />}
              <LinhaTooltip cor={COR.contratado} rotulo="Só contratado" valor={brl(serie[hover].saldo_so_contratado)} tracejada />
            </Tooltip>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <ChaveLegenda cor={COR.entrada} rotulo="Entradas contratadas" />
        {incluirProjetadas && <ChaveLegenda cor={COR.entradaProjetada} rotulo="Vendas no ritmo atual (estimado)" />}
        <ChaveLegenda cor={COR.saida} rotulo="Saídas" />
        {incluirProjetadas && <ChaveLegenda cor={COR.saldo} rotulo="Saldo projetado" tipo="linha" />}
        <ChaveLegenda cor={COR.contratado} rotulo="Saldo só com o contratado" tipo="linha" tracejada />
      </div>
      {entradasAtrasadas > 0 && (
        <p className="text-xs text-gray-500">
          Recebíveis vencidos ({brl(entradasAtrasadas)}) ficam fora do fluxo: não têm data para entrar.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- linhas

export interface SerieLinha {
  nome: string;
  cor: string;
  valores: number[];
  tracejada?: boolean;
}

export function Linhas({ series, rotulos, formatar = brlCurto, formatarCompleto = brl, altura = 220, titulo, destacarZero = true }: {
  series: SerieLinha[]; rotulos: string[]; formatar?: (n: number) => string; formatarCompleto?: (n: number) => string;
  altura?: number; titulo?: string; destacarZero?: boolean;
}) {
  const [tabela, setTabela] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const { ref, largura } = useLargura<HTMLDivElement>();

  const n = rotulos.length;
  const margem = { esq: 60, dir: 72, topo: 12 };
  const bandaEixo = 26;
  const H = margem.topo + altura + bandaEixo;
  const plotW = Math.max(40, largura - margem.esq - margem.dir);
  const xDe = (i: number) => margem.esq + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);

  const todos = series.flatMap(s => s.valores.slice(0, n));
  const vMin = Math.min(destacarZero ? 0 : Infinity, ...todos);
  const vMax = Math.max(destacarZero ? 0 : -Infinity, ...todos);
  const base = margem.topo + altura;
  const yDe = (v: number) => vMax === vMin ? base : base - ((v - vMin) / (vMax - vMin)) * altura;
  const t = ticks(vMin, vMax, 4);
  const cadaRotulo = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    let melhor = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xDe(i) - x) < Math.abs(xDe(melhor) - x)) melhor = i;
    setHover(melhor);
  };

  // Rotulo direto so no ponto final; se dois colidem (< 12px), eles saem e a
  // legenda + tooltip assumem (nao se empilha rotulo descolado da linha).
  const finais = series.map((s, i) => ({ i, y: yDe(s.valores[n - 1] ?? 0) }));
  const colide = (i: number) => finais.some(f => f.i !== i && Math.abs(f.y - finais[i].y) < 12);

  return (
    <div className="space-y-3">
      {(titulo || true) && (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {titulo ? <h3 className="font-bold text-gray-800 text-sm">{titulo}</h3> : <span />}
          <button type="button" onClick={() => setTabela(v => !v)} className="text-xs text-[#C96F00] hover:underline min-h-[40px] px-1">
            {tabela ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      )}

      {n === 0 || series.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">Sem dados.</div>
      ) : tabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 text-left">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Mês</th>
                {series.map(s => <th key={s.nome} className="py-1.5 px-2 font-medium text-right">{s.nome}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rotulos.map((r, i) => (
                <tr key={`${r}-${i}`} className="border-t border-gray-100">
                  <td className="py-1 pr-2 text-gray-700 whitespace-nowrap">{r}</td>
                  {series.map(s => {
                    const v = s.valores[i] ?? 0;
                    return <td key={s.nome} className={`py-1 px-2 text-right ${v < 0 ? 'text-red-700' : 'text-gray-900'}`}>{formatarCompleto(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full">
          <svg width={largura} height={H} role="img" aria-label={titulo ?? 'Gráfico de linhas'} style={{ fontFamily: FONTE, touchAction: 'pan-y' }}
            onPointerMove={aoMover} onPointerDown={aoMover} onPointerLeave={() => setHover(null)}>
            {t.map(v => (
              <g key={v}>
                <line x1={margem.esq} x2={margem.esq + plotW} y1={yDe(v)} y2={yDe(v)}
                  stroke={destacarZero && v === 0 ? COR.textoForte : COR.grade} strokeWidth={1} />
                <text x={margem.esq - 6} y={yDe(v) + 3} textAnchor="end" fontSize={10} fill={COR.texto}>{formatar(v)}</text>
              </g>
            ))}
            {series.map(s => (
              <path key={s.nome} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={s.tracejada ? '5 4' : undefined}
                d={rotulos.map((_, i) => `${i === 0 ? 'M' : 'L'}${xDe(i).toFixed(1)},${yDe(s.valores[i] ?? 0).toFixed(1)}`).join(' ')} />
            ))}
            {series.map((s, si) => {
              const v = s.valores[n - 1] ?? 0;
              return (
                <g key={`fim-${s.nome}`}>
                  <circle cx={xDe(n - 1)} cy={yDe(v)} r={4} fill={s.cor} stroke="#fff" strokeWidth={2} />
                  {!colide(si) && (
                    <text x={xDe(n - 1) + 8} y={yDe(v) + 4} fontSize={11} fontWeight={600} fill={COR.textoForte}>{formatar(v)}</text>
                  )}
                </g>
              );
            })}
            {hover !== null && series.map(s => (
              <circle key={`h-${s.nome}`} cx={xDe(hover)} cy={yDe(s.valores[hover] ?? 0)} r={4} fill={s.cor} stroke="#fff" strokeWidth={2} />
            ))}
            {rotulos.map((r, i) => (i % cadaRotulo === 0 || i === n - 1) && (
              <text key={`x-${r}-${i}`} x={xDe(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={COR.texto}>{r}</text>
            ))}
            {hover !== null && (
              <line x1={xDe(hover)} x2={xDe(hover)} y1={margem.topo} y2={base} stroke={COR.eixo} strokeWidth={1} />
            )}
          </svg>
          {hover !== null && (
            <Tooltip x={xDe(hover)} largura={largura}>
              <p className="font-semibold text-gray-900 mb-1">{rotulos[hover]}</p>
              {series.map(s => (
                <LinhaTooltip key={s.nome} cor={s.cor} rotulo={s.nome} valor={formatarCompleto(s.valores[hover] ?? 0)} tracejada={s.tracejada} />
              ))}
            </Tooltip>
          )}
        </div>
      )}

      {series.length >= 2 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map(s => <ChaveLegenda key={s.nome} cor={s.cor} rotulo={s.nome} tipo="linha" tracejada={s.tracejada} />)}
        </div>
      )}
    </div>
  );
}
