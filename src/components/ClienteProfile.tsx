'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ClienteCompleto, EnderecoCliente, TagCliente, CompraResumo } from '@/lib/types';

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

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  );
}

// ---- Seção de Endereços ----

function formatarEndereco(e: EnderecoCliente): string {
  const cidadeEstado =
    e.cidade && e.estado ? `${e.cidade}-${e.estado}` : e.cidade || e.estado || '';
  return [
    e.rua,
    e.numero ? `nº ${e.numero}` : '',
    e.complemento,
    e.bairro,
    cidadeEstado,
    e.cep ? `CEP ${e.cep}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function mascaraCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

interface FormEndereco {
  apelido: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  observacoes: string;
  is_padrao: boolean;
}

const FORM_ENDERECO_VAZIO: FormEndereco = {
  apelido: '', cep: '', rua: '', numero: '', complemento: '',
  bairro: '', cidade: '', estado: '', observacoes: '', is_padrao: false,
};

function EnderecosSecao({
  clienteId,
  enderecos,
  onMudou,
  mostrarToast,
}: {
  clienteId: string;
  enderecos: EnderecoCliente[];
  onMudou: () => Promise<void> | void;
  mostrarToast: (tipo: 'sucesso' | 'erro', msg: string) => void;
}) {
  const [modal, setModal] = useState<{ modo: 'novo' | 'editar'; id: string | null } | null>(null);
  const [form, setForm] = useState<FormEndereco>(FORM_ENDERECO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [confirmandoRemover, setConfirmandoRemover] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState(false);

  function abrirNovo() {
    setForm(FORM_ENDERECO_VAZIO);
    setModal({ modo: 'novo', id: null });
  }

  function abrirEditar(e: EnderecoCliente) {
    setForm({
      apelido: e.apelido || '', cep: e.cep || '', rua: e.rua || '',
      numero: e.numero || '', complemento: e.complemento || '',
      bairro: e.bairro || '', cidade: e.cidade || '', estado: e.estado || '',
      observacoes: e.observacoes || '', is_padrao: e.is_padrao,
    });
    setModal({ modo: 'editar', id: e.id });
  }

  // ViaCEP — autopreenche rua/bairro/cidade/estado ao perder o foco do CEP
  async function buscarCep() {
    const cepLimpo = form.cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          rua: data.logradouro || f.rua,
          bairro: data.bairro || f.bairro,
          cidade: data.localidade || f.cidade,
          estado: data.uf || f.estado,
        }));
      }
    } catch {
      /* silencioso — o usuário preenche manualmente */
    }
    setBuscandoCep(false);
  }

  async function salvar() {
    if (!form.apelido.trim()) {
      mostrarToast('erro', 'Informe um apelido para o endereço');
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        apelido: form.apelido.trim(),
        cep: form.cep.trim(),
        rua: form.rua.trim(),
        numero: form.numero.trim(),
        complemento: form.complemento.trim(),
        bairro: form.bairro.trim(),
        cidade: form.cidade.trim(),
        estado: form.estado.trim(),
        observacoes: form.observacoes.trim(),
        is_padrao: form.is_padrao,
      };
      const editando = modal?.modo === 'editar';
      const url = editando
        ? `/api/clientes/${clienteId}/enderecos/${modal?.id}`
        : `/api/clientes/${clienteId}/enderecos`;
      const res = await fetch(url, {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao salvar o endereço');
      } else {
        setModal(null);
        await onMudou();
        mostrarToast('sucesso', editando ? 'Endereço atualizado' : 'Endereço adicionado');
      }
    } catch {
      mostrarToast('erro', 'Erro ao salvar o endereço');
    }
    setSalvando(false);
  }

  async function tornarPadrao(id: string) {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/enderecos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_padrao: true }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao definir o endereço padrão');
      } else {
        await onMudou();
        mostrarToast('sucesso', 'Endereço padrão atualizado');
      }
    } catch {
      mostrarToast('erro', 'Erro ao definir o endereço padrão');
    }
  }

  async function remover(id: string) {
    setRemovendo(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/enderecos/${id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        mostrarToast('erro', 'Cliente precisa de pelo menos 1 endereço cadastrado');
      } else if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao remover o endereço');
      } else {
        setConfirmandoRemover(null);
        await onMudou();
        mostrarToast('sucesso', 'Endereço removido');
      }
    } catch {
      mostrarToast('erro', 'Erro ao remover o endereço');
    }
    setRemovendo(false);
  }

  return (
    <>
      <Secao
        titulo="Endereços"
        acao={
          <button
            onClick={abrirNovo}
            className="rounded-lg px-3 py-1 text-xs font-bold text-white"
            style={{ background: LARANJA }}
          >
            + Adicionar endereço
          </button>
        }
      >
        {enderecos.length === 0 ? (
          <p className="text-sm italic text-gray-400">Nenhum endereço cadastrado.</p>
        ) : (
          <div className="space-y-3">
            {enderecos.map(e => (
              <div key={e.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-800">{e.apelido || 'Endereço'}</p>
                  {e.is_padrao && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold text-white"
                      style={{ background: LARANJA }}
                    >
                      Padrão
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600">{formatarEndereco(e) || '—'}</p>
                {e.observacoes && (
                  <p className="mt-1 text-xs italic text-gray-500">Obs: {e.observacoes}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => abrirEditar(e)}
                    className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Editar
                  </button>
                  {!e.is_padrao && (
                    <button
                      onClick={() => tornarPadrao(e.id)}
                      className="rounded border border-orange-200 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50"
                    >
                      Tornar padrão
                    </button>
                  )}
                  {confirmandoRemover === e.id ? (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-gray-600">Tem certeza?</span>
                      <button
                        onClick={() => remover(e.id)}
                        disabled={removendo}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {removendo ? '...' : 'Sim'}
                      </button>
                      <button
                        onClick={() => setConfirmandoRemover(null)}
                        disabled={removendo}
                        className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                      >
                        Não
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmandoRemover(e.id)}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Secao>

      {/* Modal adicionar/editar endereço */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black bg-opacity-50 p-4 sm:items-center"
          onClick={() => !salvando && setModal(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={ev => ev.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-bold text-gray-800">
              {modal.modo === 'editar' ? 'Editar endereço' : 'Novo endereço'}
            </h3>
            <div className="space-y-2.5">
              <Campo label="Apelido">
                <input
                  value={form.apelido}
                  onChange={e => setForm(f => ({ ...f, apelido: e.target.value }))}
                  placeholder="Casa, Obra Alphaville..."
                  className={INPUT_CLS}
                />
              </Campo>
              <Campo label="CEP">
                <div className="flex items-center gap-2">
                  <input
                    value={form.cep}
                    onChange={e => setForm(f => ({ ...f, cep: mascaraCep(e.target.value) }))}
                    onBlur={buscarCep}
                    placeholder="00000-000"
                    inputMode="numeric"
                    className={INPUT_CLS}
                  />
                  {buscandoCep && (
                    <span className="shrink-0 text-xs text-gray-400">buscando...</span>
                  )}
                </div>
              </Campo>
              <Campo label="Rua">
                <input
                  value={form.rua}
                  onChange={e => setForm(f => ({ ...f, rua: e.target.value }))}
                  className={INPUT_CLS}
                />
              </Campo>
              <div className="grid grid-cols-2 gap-2">
                <Campo label="Número">
                  <input
                    value={form.numero}
                    onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </Campo>
                <Campo label="Complemento">
                  <input
                    value={form.complemento}
                    onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </Campo>
              </div>
              <Campo label="Bairro">
                <input
                  value={form.bairro}
                  onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))}
                  className={INPUT_CLS}
                />
              </Campo>
              <div className="grid grid-cols-2 gap-2">
                <Campo label="Cidade">
                  <input
                    value={form.cidade}
                    onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </Campo>
                <Campo label="Estado">
                  <input
                    value={form.estado}
                    onChange={e => setForm(f => ({ ...f, estado: e.target.value.toUpperCase() }))}
                    maxLength={2}
                    className={INPUT_CLS}
                  />
                </Campo>
              </div>
              <Campo label="Observações">
                <textarea
                  value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  rows={2}
                  placeholder="Portão azul, falar com Antônio..."
                  className={INPUT_CLS}
                />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_padrao}
                  onChange={e => setForm(f => ({ ...f, is_padrao: e.target.checked }))}
                />
                Tornar este o endereço padrão
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setModal(null)}
                disabled={salvando}
                className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="flex-1 rounded-lg py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: LARANJA }}
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Seção de Tags ----

function TagsSecao({
  clienteId,
  tags,
  onMudou,
  mostrarToast,
}: {
  clienteId: string;
  tags: TagCliente[];
  onMudou: () => Promise<void> | void;
  mostrarToast: (tipo: 'sucesso' | 'erro', msg: string) => void;
}) {
  const [tagsValidas, setTagsValidas] = useState<string[]>([]);
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const [confirmandoTag, setConfirmandoTag] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  // Taxonomia vem do backend — não hardcoda a lista no client
  useEffect(() => {
    fetch('/api/tags-validas', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.tags)) setTagsValidas(d.tags as string[]);
      })
      .catch(() => {});
  }, []);

  const tagsAtuais = tags.map(t => t.tag);
  const disponiveis = tagsValidas.filter(t => !tagsAtuais.includes(t));

  async function adicionar(tag: string) {
    setProcessando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, origem: 'manual' }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao adicionar a tag');
      } else {
        setDropdownAberto(false);
        await onMudou();
        mostrarToast('sucesso', 'Tag adicionada');
      }
    } catch {
      mostrarToast('erro', 'Erro ao adicionar a tag');
    }
    setProcessando(false);
  }

  async function remover(tag: string) {
    setProcessando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/tags/${encodeURIComponent(tag)}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        mostrarToast('erro', data?.error || 'Erro ao remover a tag');
      } else {
        setConfirmandoTag(null);
        await onMudou();
        mostrarToast('sucesso', 'Tag removida');
      }
    } catch {
      mostrarToast('erro', 'Erro ao remover a tag');
    }
    setProcessando(false);
  }

  return (
    <Secao
      titulo="Tags"
      acao={
        disponiveis.length > 0 ? (
          <div className="relative">
            <button
              onClick={() => setDropdownAberto(o => !o)}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              + Adicionar tag
            </button>
            {dropdownAberto && (
              <div className="absolute right-0 z-10 mt-1 max-h-60 w-44 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {disponiveis.map(t => (
                  <button
                    key={t}
                    onClick={() => adicionar(t)}
                    disabled={processando}
                    className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-orange-50 disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
    >
      {tags.length === 0 ? (
        <p className="text-sm italic text-gray-400">Nenhuma tag.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(t => (
            <span
              key={t.tag}
              className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800"
            >
              {t.tag}
              {t.origem === 'auto' && (
                <span className="rounded bg-gray-300 px-1 text-[10px] font-bold text-gray-700">
                  AUTO
                </span>
              )}
              {confirmandoTag === t.tag ? (
                <span className="ml-0.5 flex items-center gap-1">
                  <button
                    onClick={() => remover(t.tag)}
                    disabled={processando}
                    className="font-bold text-red-600 disabled:opacity-50"
                  >
                    sim
                  </button>
                  <button onClick={() => setConfirmandoTag(null)} className="text-gray-500">
                    não
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmandoTag(t.tag)}
                  title="Remover tag"
                  className="ml-0.5 text-orange-500 hover:text-orange-800"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </Secao>
  );
}

// ---- Seção de Histórico de compras ----

const STATUS_COMPRA: Record<string, { label: string; cls: string }> = {
  entrega_pendente: { label: 'Entrega pendente', cls: 'bg-orange-100 text-orange-800' },
  retirada_pendente: { label: 'Retirada pendente', cls: 'bg-purple-100 text-purple-800' },
  em_rota: { label: 'Em rota', cls: 'bg-blue-100 text-blue-800' },
  entrega_parcial: { label: 'Entrega parcial', cls: 'bg-amber-100 text-amber-800' },
  completo: { label: 'Completo', cls: 'bg-green-100 text-green-800' },
  ocorrencia: { label: 'Ocorrência', cls: 'bg-red-100 text-red-800' },
};

function formatarDataCurta(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function HistoricoSecao({
  compras,
  onAbrirPedido,
}: {
  compras: CompraResumo[];
  onAbrirPedido?: (orcamentoId: string) => void;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const visiveis = verTodas ? compras : compras.slice(0, 20);

  return (
    <Secao titulo="Histórico de compras">
      {compras.length === 0 ? (
        <p className="text-sm italic text-gray-400">Nenhuma compra registrada.</p>
      ) : (
        <div className="space-y-1.5">
          {visiveis.map(c => {
            const st = STATUS_COMPRA[c.status] || {
              label: c.status,
              cls: 'bg-gray-100 text-gray-600',
            };
            return (
              <button
                key={c.id}
                onClick={() => onAbrirPedido?.(c.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{c.codigo || '—'}</p>
                  <p className="text-xs text-gray-500">{formatarDataCurta(c.data)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">R$ {formatBRL(c.total)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
              </button>
            );
          })}
          {compras.length > 20 && !verTodas && (
            <button
              onClick={() => setVerTodas(true)}
              className="w-full rounded-lg py-1.5 text-xs font-semibold text-[#F7941D] hover:underline"
            >
              Ver todas ({compras.length})
            </button>
          )}
        </div>
      )}
    </Secao>
  );
}

// ---- Componente principal ----

interface ClienteProfileProps {
  clienteId: string;
  onClose: () => void;
  // Usado a partir da Tarefa 4 (clique numa compra do histórico)
  onAbrirPedido?: (orcamentoId: string) => void;
}

export default function ClienteProfile({ clienteId, onClose, onAbrirPedido }: ClienteProfileProps) {
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

              {/* Endereços */}
              <EnderecosSecao
                clienteId={clienteId}
                enderecos={cliente.enderecos}
                onMudou={carregar}
                mostrarToast={mostrarToast}
              />

              {/* Tags */}
              <TagsSecao
                clienteId={clienteId}
                tags={cliente.tags}
                onMudou={carregar}
                mostrarToast={mostrarToast}
              />

              {/* Histórico de compras */}
              <HistoricoSecao compras={cliente.compras} onAbrirPedido={onAbrirPedido} />
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
