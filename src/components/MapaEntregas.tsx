'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// O SDK do Google Maps e carregado via <script> em runtime — sem tipos
// estaticos, por isso os objetos do mapa sao tratados como `any`.

import { useCallback, useEffect, useRef, useState } from 'react';

const DEPOSITO = { lat: -23.5376, lng: -46.8375 };
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface ItemEntrega {
  produto_nome: string;
  quantidade: number;
  quantidade_entregue: number;
  unidade: string;
}

interface EntregaMapa {
  id: string;
  codigo: string;
  status: string;
  total: number;
  leva_id: string | null;
  observacoes: string | null;
  cliente: { id: string; nome: string; telefone: string | null };
  endereco: {
    rua: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    lat: number;
    lng: number;
  };
  itens: ItemEntrega[];
}

const STATUS_INFO: Record<string, { label: string; cor: string }> = {
  aguardando: { label: 'Aguardando', cor: '#6B7280' },
  confirmado: { label: 'Confirmado', cor: '#2563EB' },
  entrega_pendente: { label: 'Entrega Pendente', cor: '#EA580C' },
  entrega_parcial: { label: 'Entrega Parcial', cor: '#7C3AED' },
  em_rota: { label: 'Em Rota', cor: '#2563EB' },
  completo: { label: 'Completo', cor: '#16A34A' },
};

// Cor HSL deterministica por leva — mesma leva, mesma cor entre sessoes.
// Sem leva (null) => cinza.
export function getLevaColor(levaId: string | null): string {
  if (!levaId) return '#9CA3AF';
  let hash = 0;
  for (let i = 0; i < levaId.length; i++) {
    hash = (hash * 31 + levaId.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
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
function montarConteudo(e: EntregaMapa): HTMLElement {
  const st = STATUS_INFO[e.status] || { label: e.status, cor: '#6B7280' };
  const itens = e.itens
    .map(i => `${i.produto_nome} ${i.quantidade}${i.unidade === 'unidade' ? '' : i.unidade}`)
    .join(', ');
  const div = document.createElement('div');
  div.innerHTML = `
    <div style="font-family:sans-serif;max-width:240px">
      <p style="margin:0;font-weight:bold;font-size:14px">${escapeHtml(e.cliente.nome || 'Cliente')}</p>
      ${
        e.cliente.telefone
          ? `<p style="margin:2px 0;font-size:12px;color:#555">${escapeHtml(e.cliente.telefone)}</p>`
          : ''
      }
      <p style="margin:5px 0;font-size:12px;color:#333">${escapeHtml(itens) || '—'}</p>
      <p style="margin:5px 0;font-size:13px;font-weight:bold">R$ ${formatBRL(e.total)}</p>
      <span style="display:inline-block;background:${st.cor};color:#fff;font-size:11px;padding:2px 7px;border-radius:9px">${st.label}</span>
      <div style="margin-top:8px">
        <button type="button" style="background:#F7941D;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:bold;cursor:pointer">Abrir pedido</button>
      </div>
    </div>`;
  return div;
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
  data: string; // YYYY-MM-DD
  onAbrirPedido: (orcamentoId: string) => void;
}

export default function MapaEntregas({ data, onAbrirPedido }: MapaEntregasProps) {
  const [entregas, setEntregas] = useState<EntregaMapa[]>([]);
  const [excluidos, setExcluidos] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erroFetch, setErroFetch] = useState<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsErro, setMapsErro] = useState(false);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  // Mantem a callback sempre atual sem re-disparar o efeito do mapa
  const onAbrirRef = useRef(onAbrirPedido);
  onAbrirRef.current = onAbrirPedido;

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

  // Busca as entregas da data
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroFetch(null);
    try {
      const res = await fetch(`/api/entregas/mapa?data=${encodeURIComponent(data)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        setErroFetch(json?.error || 'Erro ao carregar as entregas');
        setEntregas([]);
        setExcluidos(0);
      } else {
        setEntregas((json.entregas || []) as EntregaMapa[]);
        setExcluidos(json.excluidos_sem_coords || 0);
      }
    } catch {
      setErroFetch('Erro ao carregar as entregas');
      setEntregas([]);
      setExcluidos(0);
    }
    setCarregando(false);
  }, [data]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Renderiza o mapa e (re)desenha os pins quando as entregas mudam
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

    // Remove os pins antigos (cobre tambem o caso de lista vazia)
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (entregas.length === 0) return;

    const bounds = new g.LatLngBounds();
    for (const e of entregas) {
      const pos = { lat: e.endereco.lat, lng: e.endereco.lng };
      const marker = new g.Marker({
        position: pos,
        map,
        title: e.cliente.nome || e.codigo,
        icon: {
          path: g.SymbolPath.CIRCLE,
          fillColor: getLevaColor(e.leva_id),
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 9,
        },
      });
      marker.addListener('click', () => {
        const conteudo = montarConteudo(e);
        const btn = conteudo.querySelector('button');
        if (btn) {
          btn.addEventListener('click', () => {
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

    // Auto-fit nos pins (zoom fixo quando ha so uma entrega)
    if (entregas.length === 1) {
      map.setCenter({ lat: entregas[0].endereco.lat, lng: entregas[0].endereco.lng });
      map.setZoom(15);
    } else {
      map.fitBounds(bounds);
    }
  }, [mapsReady, entregas]);

  const semMapa = !MAPS_KEY || mapsErro;

  return (
    <div className="w-full">
      {excluidos > 0 && !carregando && !erroFetch && entregas.length > 0 && (
        <p className="mb-2 text-xs text-orange-700">
          ⚠️ {excluidos} entrega{excluidos > 1 ? 's' : ''} sem endereço geocodado —{' '}
          {excluidos > 1 ? 'não aparecem' : 'não aparece'} no mapa.
        </p>
      )}
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
            {carregando && (
              <div className="absolute inset-0 animate-pulse bg-gray-100" />
            )}
            {!carregando && erroFetch && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center">
                <p className="text-sm text-red-600">{erroFetch}</p>
                <button
                  onClick={carregar}
                  className="rounded-lg bg-[#F7941D] px-4 py-2 text-sm font-medium text-white hover:bg-[#E8850A]"
                >
                  Tentar de novo
                </button>
              </div>
            )}
            {!carregando && !erroFetch && entregas.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white p-6 text-center">
                <p className="text-sm text-gray-500">Nenhuma entrega geocodada pra esta data.</p>
                {excluidos > 0 && (
                  <p className="text-xs text-orange-700">
                    {excluidos} entrega{excluidos > 1 ? 's' : ''} sem endereço geocodado —
                    atualize o endereço do cliente pra incluí-las.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
