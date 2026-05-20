'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ClienteCompleto } from '@/lib/types';

const LARANJA = '#F7941D';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const INPUT_CLS =
  'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#F7941D]';

// ---- Sub-componentes de layout ----

function CardMetrica({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-orange-700/70">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-800">{valor}</p>
    </div>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-bold text-gray-700">{titulo}</h2>
        {acao}
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

// ---- Tipos locais ----

interface FormContato {
  nome: string;
  email: string;
  data_followup: string;
  notas_contexto: string;
}

type ErrosContato = Partial<Record<keyof FormContato, string>>;

function validarContato(f: FormContato): ErrosContato {
  const e: ErrosContato = {};
  if (!f.nome.trim()) e.nome = 'Nome é obrigatório';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Email inválido';
  if (f.notas_contexto.length > 2000) e.notas_contexto = 'Máximo de 2000 caracteres';
  if (f.data_followup && !DATA_RE.test(f.data_followup)) {
    e.data_followup = 'Data inválida (AAAA-MM-DD)';
  }
  return e;
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
  const [toast, setToast] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

  // Edição de "Dados de contato" (inclui o nome do header)
  const [editandoContato, setEditandoContato] = useState(false);
  const [formContato, setFormContato] = useState<FormContato>({
    nome: '', email: '', data_followup: '', notas_contexto: '',
  });
  const [errosContato, setErrosContato] = useState<ErrosContato>({});
  const [salvandoContato, setSalvandoContato] = useState(false);

  const mostrarToast = useCallback((tipo: 'sucesso' | 'erro', msg: string) => {
    setToast({ tipo, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

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

  function iniciarEdicaoContato() {
    if (!cliente) return;
    setFormContato({
      nome: cliente.nome || '',
      email: cliente.email || '',
      data_followup: cliente.data_followup || '',
      notas_contexto: cliente.notas_contexto || '',
    });
    setErrosContato({});
    setEditandoContato(true);
  }

  async function salvarContato() {
    const errs = validarContato(formContato);
    setErrosContato(errs);
    if (Object.keys(errs).length > 0) return;
    setSalvandoContato(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: formContato.nome.trim(),
          email: formContato.email.trim(),
          data_followup: formContato.data_followup,
          notas_contexto: formContato.notas_contexto,
        }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao salvar os dados');
      } else {
        setCliente(prev =>
          prev
            ? {
                ...prev,
                nome: data.nome,
                email: data.email,
                data_followup: data.data_followup,
                notas_contexto: data.notas_contexto,
              }
            : prev,
        );
        setEditandoContato(false);
        mostrarToast('sucesso', 'Dados de contato salvos');
      }
    } catch {
      mostrarToast('erro', 'Erro ao salvar os dados');
    }
    setSalvandoContato(false);
  }

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
          <div className="min-w-0 flex-1">
            {carregando ? (
              <>
                <div className="h-6 w-44 animate-pulse rounded bg-gray-200" />
                <div className="mt-1.5 h-4 w-32 animate-pulse rounded bg-gray-100" />
              </>
            ) : editandoContato ? (
              <>
                <input
                  value={formContato.nome}
                  onChange={e => setFormContato(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome do cliente"
                  className={`${INPUT_CLS} text-lg font-bold`}
                />
                {errosContato.nome && (
                  <p className="mt-0.5 text-xs text-red-600">{errosContato.nome}</p>
                )}
                <p className="mt-1 text-sm text-gray-500">{formatarTelefone(cliente?.telefone)}</p>
              </>
            ) : (
              <>
                <h1
                  onClick={() => cliente && iniciarEdicaoContato()}
                  title="Clique para editar"
                  className="cursor-pointer truncate text-xl font-bold text-gray-800 hover:text-[#F7941D]"
                >
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

              {/* Dados de contato */}
              <Secao
                titulo="Dados de contato"
                acao={
                  editandoContato ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditandoContato(false)}
                        disabled={salvandoContato}
                        className="rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={salvarContato}
                        disabled={salvandoContato}
                        className="rounded-lg px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                        style={{ background: LARANJA }}
                      >
                        {salvandoContato ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={iniciarEdicaoContato}
                      className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Editar
                    </button>
                  )
                }
              >
                {editandoContato ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500">Email</label>
                      <input
                        type="email"
                        value={formContato.email}
                        onChange={e => setFormContato(f => ({ ...f, email: e.target.value }))}
                        placeholder="cliente@exemplo.com"
                        className={INPUT_CLS}
                      />
                      {errosContato.email && (
                        <p className="mt-0.5 text-xs text-red-600">{errosContato.email}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">
                        Próxima data de follow-up
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={formContato.data_followup}
                          onChange={e =>
                            setFormContato(f => ({ ...f, data_followup: e.target.value }))
                          }
                          className={INPUT_CLS}
                        />
                        {formContato.data_followup && (
                          <button
                            onClick={() => setFormContato(f => ({ ...f, data_followup: '' }))}
                            title="Limpar data"
                            className="shrink-0 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {errosContato.data_followup && (
                        <p className="mt-0.5 text-xs text-red-600">{errosContato.data_followup}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500">Notas de contexto</label>
                      <textarea
                        value={formContato.notas_contexto}
                        onChange={e =>
                          setFormContato(f => ({ ...f, notas_contexto: e.target.value }))
                        }
                        rows={4}
                        maxLength={2000}
                        placeholder="Preferências, histórico de conversa, lembretes..."
                        className={INPUT_CLS}
                      />
                      <div className="flex justify-between">
                        {errosContato.notas_contexto ? (
                          <p className="text-xs text-red-600">{errosContato.notas_contexto}</p>
                        ) : (
                          <span />
                        )}
                        <span className="text-xs text-gray-400">
                          {formContato.notas_contexto.length}/2000
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs font-medium text-gray-500">Email</p>
                      <p className="text-gray-800">{cliente.email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Próxima data de follow-up</p>
                      <p className="text-gray-800">{formatarData(cliente.data_followup)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Notas de contexto</p>
                      <p className="whitespace-pre-wrap text-gray-800">
                        {cliente.notas_contexto || '—'}
                      </p>
                    </div>
                  </div>
                )}
              </Secao>

              {/* Seções (preenchidas nas próximas tarefas) */}
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

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
            toast.tipo === 'sucesso' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
