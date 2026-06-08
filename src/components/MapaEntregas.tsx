'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// O SDK do Google Maps e carregado via <script> em runtime — sem tipos
// estaticos, por isso os objetos do mapa sao tratados como `any`.

import { useEffect, useMemo, useRef, useState } from 'react';

const DEPOSITO = { lat: -23.5376, lng: -46.8375 };
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Shape minimo que o mapa consome. O parent passa entradas vindas de
// /api/entregas/rota (interface EntregaRota em OrcamentoApp.tsx) — campos
// extras sao ignorados, falta de lat/lng exclui do mapa.
export interface EntregaMapaItem {
  id: string;
  codigo: string;
  status: string;
  total: number;
  cliente_nome: string;
  cliente_telefone?: string | null;
  endereco?: string;
  numero?: string;
  bairro?: string;
  itens_resumo?: string;
  lat?: number | null;
  lng?: number | null;
}

const STATUS_INFO: Record<string, { label: string; cor: string }> = {
  aguardando: { label: 'Aguardando', cor: '#374151' },
  confirmado: { label: 'Confirmado', cor: '#374151' },
  entrega_pendente: { label: 'Pendente', cor: '#F7941D' },
  em_rota: { label: 'Em Rota', cor: '#3B82F6' },
  entrega_parcial: { label: 'Parcial', cor: '#EAB308' },
  completo: { label: 'Entregue', cor: '#9CA3AF' },
};

const COR_DEFAULT = '#374151';
const COR_SELECIONADO = '#10B981';

const FILTRO_KEY = 'do_mapa_status_filtro';
type FiltroStatus = { pendente: boolean; em_rota: boolean; entregue: boolean };
const FILTRO_DEFAULT: FiltroStatus = {
  pendente: true,
  em_rota: true,
  entregue: false,
};

// Mapeia status -> grupo do chip de filtro. null = nao filtrado (sempre exibe).
// entrega_parcial cai no grupo 'pendente' (entrega incompleta a concluir);
// mantem cor amarela no pin pra distinguir visualmente.
function grupoDoStatus(s: string): keyof FiltroStatus | null {
  if (s === 'aguardando' || s === 'confirmado' || s === 'entrega_pendente' || s === 'entrega_parcial') return 'pendente';
  if (s === 'em_rota') return 'em_rota';
  if (s === 'completo') return 'entregue';
  return null;
}

function formatBRL(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
  );
}

// Conteudo HTML do InfoWindow do pin.
function montarConteudo(e: EntregaMapaItem, selecionado: boolean): HTMLElement {
  const st = STATUS_INFO[e.status] || { label: e.status, cor: COR_DEFAULT };
  const div = document.createElement('div');
  div.innerHTML = `
    <div style="font-family:sans-serif;max-width:250px">
      <p style="margin:0;font-weight:bold;font-size:14px">${escapeHtml(e.cliente_nome || 'Cliente')}</p>
      ${
        e.cliente_telefone
          ? `<p style="margin:2px 0;font-size:12px;color:#555">${escapeHtml(e.cliente_telefone)}</p>`
          : ''
      }
      <p style="margin:5px 0;font-size:12px;color:#333">${escapeHtml(e.itens_resumo || '—')}</p>
      <p style="margin:5px 0;font-size:13px;font-weight:bold">R$ ${formatBRL(e.total)}</p>
      <span style="display:inline-block;background:${st.cor};color:#fff;font-size:11px;padding:2px 7px;border-radius:9px">${escapeHtml(st.label)}</span>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button data-action="toggle" type="button" style="background:${selecionado ? '#dc2626' : COR_SELECIONADO};color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer">${selecionado ? '✕ Deselecionar' : '✓ Selecionar'}</button>
        <button data-action="open" type="button" style="background:#F7941D;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer">Abrir Pedido</button>
      </div>
    </div>`;
  return div;
}

// Constroi um icone SVG do pin com cor por status, anel verde quando
// selecionado e numero de parada (quando ordemRotaGerada esta presente).
function buildMarkerIcon(g: any, cor: string, selecionado: boolean, numero: number | null): any {
  const size = 36;
  const cx = size / 2;
  const cy = size / 2;
  const r = 11;
  const ring = selecionado
    ? `<circle cx="${cx}" cy="${cy}" r="14.5" fill="none" stroke="${COR_SELECIONADO}" stroke-width="3"/>`
    : '';
  const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cor}" stroke="#ffffff" stroke-width="2"/>`;
  let centro = '';
  if (numero !== null) {
    centro = `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="#ffffff">${numero}</text>`;
  } else if (selecionado) {
    centro = `<path d="M ${cx - 4} ${cy} L ${cx - 1} ${cy + 3} L ${cx + 5} ${cy - 3}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ring}${circle}${centro}</svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    anchor: new g.Point(cx, cy),
  };
}

// Carrega o SDK do Google Maps uma unica vez (promessa em cache global).
function carregarGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem window'));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve();
  if (w.__gmapsPromise) return w.__gmapsPromise as Promise<void>;
  w.__gmapsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('falha ao carregar o script do Google Maps'));
    document.head.appendChild(s);
  });
  return w.__gmapsPromise as Promise<void>;
}

interface MapaEntregasProps {
  entregas: EntregaMapaItem[];
  selecionadas: Set<string>;
  onToggleSelecionada: (id: string) => void;
  onAbrirPedido: (id: string) => void;
  ordemRotaGerada?: string[];
}

export default function MapaEntregas({
  entregas,
  selecionadas,
  onToggleSelecionada,
  onAbrirPedido,
  ordemRotaGerada,
}: MapaEntregasProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsErro, setMapsErro] = useState(false);
  const [filtros, setFiltros] = useState<FiltroStatus>(FILTRO_DEFAULT);

  // Hidrata filtros do localStorage no mount (uma vez).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTRO_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FiltroStatus>;
        setFiltros({ ...FILTRO_DEFAULT, ...parsed });
      }
    } catch {
      /* localStorage indisponivel — usa default */
    }
  }, []);

  const setFiltroGrupo = (g: keyof FiltroStatus) => {
    setFiltros(prev => {
      const novo = { ...prev, [g]: !prev[g] };
      try {
        localStorage.setItem(FILTRO_KEY, JSON.stringify(novo));
      } catch {
        /* ignora falha de persistencia */
      }
      return novo;
    });
  };

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Refs com callbacks/state atuais — usadas dentro dos listeners dos pins
  // pra evitar capturas obsoletas sem re-disparar o efeito do mapa.
  const onToggleRef = useRef(onToggleSelecionada);
  onToggleRef.current = onToggleSelecionada;
  const onAbrirRef = useRef(onAbrirPedido);
  onAbrirRef.current = onAbrirPedido;
  const selecionadasRef = useRef(selecionadas);
  selecionadasRef.current = selecionadas;

  // Filtra entregas por filtros de status e lat/lng valido. Memo evita
  // recriacao quando deps reais nao mudam.
  const entregasVisiveis = useMemo(() => {
    return entregas.filter(e => {
      if (e.lat == null || e.lng == null) return false;
      const g = grupoDoStatus(e.status);
      if (g === null) return true;
      return filtros[g];
    });
  }, [entregas, filtros]);

  // Carrega o SDK do Google Maps (uma vez)
  useEffect(() => {
    if (!MAPS_KEY) {
      setMapsErro(true);
      return;
    }
    let vivo = true;
    carregarGoogleMaps(MAPS_KEY)
      .then(() => {
        if (vivo) setMapsReady(true);
      })
      .catch(() => {
        if (vivo) setMapsErro(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Renderiza o mapa e (re)desenha os pins quando entregas/selecao/ordem mudam
  useEffect(() => {
    if (!mapsReady || !mapDivRef.current) return;
    const g = (window as any).google.maps;

    if (!mapRef.current) {
      mapRef.current = new g.Map(mapDivRef.current, {
        center: DEPOSITO,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      infoRef.current = new g.InfoWindow();
    }
    const map = mapRef.current;
    const info = infoRef.current;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (entregasVisiveis.length === 0) {
      info.close();
      return;
    }

    const ordemIndex = new Map<string, number>();
    if (ordemRotaGerada) {
      ordemRotaGerada.forEach((id, idx) => {
        ordemIndex.set(id, idx + 1);
      });
    }

    const bounds = new g.LatLngBounds();
    for (const e of entregasVisiveis) {
      const pos = { lat: Number(e.lat), lng: Number(e.lng) };
      const cor = STATUS_INFO[e.status]?.cor || COR_DEFAULT;
      const selecionado = selecionadas.has(e.id);
      const numero = ordemIndex.get(e.id) ?? null;

      const marker = new g.Marker({
        position: pos,
        map,
        title: e.cliente_nome || e.codigo,
        icon: buildMarkerIcon(g, cor, selecionado, numero),
      });
      marker.addListener('click', () => {
        const selAtual = selecionadasRef.current.has(e.id);
        const conteudo = montarConteudo(e, selAtual);
        const btnToggle = conteudo.querySelector('[data-action="toggle"]');
        const btnOpen = conteudo.querySelector('[data-action="open"]');
        if (btnToggle) {
          btnToggle.addEventListener('click', () => {
            info.close();
            onToggleRef.current(e.id);
          });
        }
        if (btnOpen) {
          btnOpen.addEventListener('click', () => {
            info.close();
            onAbrirRef.current(e.id);
          });
        }
        info.setContent(conteudo);
        info.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
    }

    if (entregasVisiveis.length === 1) {
      const u = entregasVisiveis[0];
      map.setCenter({ lat: Number(u.lat), lng: Number(u.lng) });
      map.setZoom(15);
    } else {
      map.fitBounds(bounds);
    }
  }, [mapsReady, entregasVisiveis, selecionadas, ordemRotaGerada]);

  const semMapa = !MAPS_KEY || mapsErro;

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-gray-500">Filtro:</span>
        <FiltroChip
          cor="#F7941D"
          label="Pendente"
          on={filtros.pendente}
          onClick={() => setFiltroGrupo('pendente')}
        />
        <FiltroChip
          cor="#3B82F6"
          label="Em Rota"
          on={filtros.em_rota}
          onClick={() => setFiltroGrupo('em_rota')}
        />
        <FiltroChip
          cor="#9CA3AF"
          label="Entregue"
          on={filtros.entregue}
          onClick={() => setFiltroGrupo('entregue')}
        />
      </div>

      <div className="relative h-[450px] w-full overflow-hidden rounded-xl border border-gray-200 md:h-[600px]">
        {semMapa ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-red-600">
              Falha ao carregar o mapa — verifique a configuração do Google Maps.
            </p>
          </div>
        ) : (
          <>
            <div ref={mapDivRef} className="h-full w-full" />
            {!mapsReady && (
              <div className="absolute inset-0 animate-pulse bg-gray-100" />
            )}
            {mapsReady && entregasVisiveis.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 p-6 text-center">
                <p className="text-sm text-gray-500">
                  Nenhuma entrega visível com os filtros atuais. Ajuste os filtros ou aguarde.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FiltroChip({
  cor,
  label,
  on,
  onClick,
}: {
  cor: string;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        on
          ? 'border-gray-300 bg-white text-gray-800 shadow-sm'
          : 'border-gray-200 bg-gray-50 text-gray-400'
      }`}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: on ? cor : '#d1d5db' }}
      />
      {label}
    </button>
  );
}
