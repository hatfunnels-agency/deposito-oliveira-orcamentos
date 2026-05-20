'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClienteCompleto } from '@/lib/types';

const LARANJA = '#F7941D';

function formatBRL(v: number | null | undefined): string {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarTelefone(tel: string | null | undefined): string {
  if (!tel) return '—';
  const d = String(tel).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(tel);
}

function formatarData(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR');
}

// ---- Sub-componentes de layout ----

function CardMetrica({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-orange-700/70">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-800">{valor}</p>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-bold text-gray-700">{titulo}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PlaceholderSecao() {
  return <p className="text-sm italic text-gray-400">Em breve.</p>;
}

function SkeletonPerfil() {
  return (
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}

// ---- Componente principal ----

interface ClienteProfileProps {
  clienteId: string;
  onClose: () => void;
  // Usado a partir da Tarefa 4 (clique numa compra do histórico)
  onAbrirPedido?: (orcamentoId: string) => void;
}

export default function ClienteProfile({ clienteId, onClose }: ClienteProfileProps) {
  const [cliente, setCliente] = useState<ClienteCompleto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setErro(data?.error || 'Erro ao carregar o cliente');
      } else {
        setCliente(data as ClienteCompleto);
      }
    } catch {
      setErro('Erro ao carregar o cliente');
    }
    setCarregando(false);
  }, [clienteId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black bg-opacity-50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 py-4">
          <div className="min-w-0">
            {carregando ? (
              <>
                <div className="h-6 w-44 animate-pulse rounded bg-gray-200" />
                <div className="mt-1.5 h-4 w-32 animate-pulse rounded bg-gray-100" />
              </>
            ) : (
              <>
                <h1 className="truncate text-xl font-bold text-gray-800">
                  {cliente?.nome || 'Cliente'}
                </h1>
                <p className="text-sm text-gray-500">{formatarTelefone(cliente?.telefone)}</p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="ml-3 text-3xl leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto">
          {erro ? (
            <div className="p-8 text-center">
              <p className="mb-3 text-sm text-red-600">{erro}</p>
              <button
                onClick={carregar}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ background: LARANJA }}
              >
                Tentar de novo
              </button>
            </div>
          ) : carregando ? (
            <SkeletonPerfil />
          ) : cliente ? (
            <div className="space-y-5 p-5">
              {/* Métricas */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <CardMetrica label="Compras" valor={String(cliente.qtd_compras)} />
                <CardMetrica label="Total comprado" valor={`R$ ${formatBRL(cliente.total_compras)}`} />
                <CardMetrica label="Última compra" valor={formatarData(cliente.ultima_compra)} />
              </div>

              {/* Seções (preenchidas nas próximas tarefas) */}
              <Secao titulo="Dados de contato">
                <PlaceholderSecao />
              </Secao>
              <Secao titulo="Endereços">
                <PlaceholderSecao />
              </Secao>
              <Secao titulo="Tags">
                <PlaceholderSecao />
              </Secao>
              <Secao titulo="Histórico de compras">
                <PlaceholderSecao />
              </Secao>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
