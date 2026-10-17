'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Alerta de venda fechada pela IA: consulta /api/atendimento?pendentes=1 a
// cada 30 s e, quando aparece venda nova, toca um som e avisa. Usado na
// sidebar do sistema (selo + som) e na pagina /atendimento (recarrega o
// quadro). O som so toca depois de um clique na pagina (regra do navegador)
// e pode ser desligado — fica guardado no navegador.

const INTERVALO_MS = 30_000;
const CHAVE_SOM = 'depo:som-venda-ia';

let ctx: AudioContext | null = null;
function destravarAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* sem audio */ }
}
function tocar() {
  try {
    if (!ctx || ctx.state !== 'running') return;
    const agora = ctx.currentTime;
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([f, t]) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, agora + t);
      g.gain.exponentialRampToValueAtTime(0.25, agora + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, agora + t + 0.35);
      o.connect(g).connect(ctx!.destination);
      o.start(agora + t);
      o.stop(agora + t + 0.4);
    });
  } catch { /* sem audio */ }
}

export function usePendentesIA(aoNova?: () => void) {
  const [vendas, setVendas] = useState(0);
  const [abertos, setAbertos] = useState(0);
  const [somLigado, setSomLigado] = useState(true);
  const ultimaVista = useRef<string | null | undefined>(undefined);
  const aoNovaRef = useRef(aoNova);
  aoNovaRef.current = aoNova;

  useEffect(() => {
    try { setSomLigado(localStorage.getItem(CHAVE_SOM) !== 'off'); } catch { /* sem storage */ }
    const destrava = () => destravarAudio();
    document.addEventListener('pointerdown', destrava);
    document.addEventListener('keydown', destrava);
    return () => { document.removeEventListener('pointerdown', destrava); document.removeEventListener('keydown', destrava); };
  }, []);

  const consultar = useCallback(async () => {
    try {
      const r = await fetch('/api/atendimento?pendentes=1', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setVendas(Number(d.vendas_ia) || 0);
      setAbertos(Number(d.abertos) || 0);
      const ult = (d.ultima_venda_em as string | null) ?? null;
      // Primeira leitura so memoriza; venda nova = criado_em mais recente que o visto.
      if (ultimaVista.current !== undefined && ult && (!ultimaVista.current || ult > ultimaVista.current)) {
        let ligado = true;
        try { ligado = localStorage.getItem(CHAVE_SOM) !== 'off'; } catch { /* */ }
        if (ligado) tocar();
        aoNovaRef.current?.();
      }
      ultimaVista.current = ult;
    } catch { /* rede */ }
  }, []);

  useEffect(() => {
    consultar();
    const id = setInterval(consultar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [consultar]);

  const alternarSom = () => {
    const novo = !somLigado;
    setSomLigado(novo);
    try { localStorage.setItem(CHAVE_SOM, novo ? 'on' : 'off'); } catch { /* */ }
    if (novo) { destravarAudio(); setTimeout(tocar, 50); }
  };

  return { vendas, abertos, somLigado, alternarSom, consultar };
}

/** Selo com a quantidade de vendas da IA a lancar (sidebar). Toca o som. */
export function SeloVendasIA() {
  const { vendas } = usePendentesIA();
  if (!vendas) return null;
  return (
    <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white animate-pulse"
      title={`${vendas} venda(s) fechada(s) pela IA para lançar no sistema`}>
      {vendas}
    </span>
  );
}

/** Barra da pagina /atendimento: recarrega o quadro quando chega venda nova. */
export function AlertaVendasIA() {
  const router = useRouter();
  const { vendas, somLigado, alternarSom } = usePendentesIA(() => router.refresh());
  useEffect(() => {
    const base = 'Atendimento — Depósito Oliveira';
    document.title = vendas > 0 ? `(${vendas}) Venda da IA — ${base}` : base;
  }, [vendas]);
  return (
    <button type="button" onClick={alternarSom}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${somLigado ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-300 bg-white text-gray-600'}`}
      title="Toca um aviso quando a IA fecha uma venda (a página verifica a cada 30 s)">
      {somLigado ? '🔔 Som ligado' : '🔕 Som desligado'}
    </button>
  );
}
