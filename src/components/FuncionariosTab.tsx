'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Wallet, CalendarClock, HandCoins, Plus, X, Trash2, Pencil } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { FREQUENCIA_LABELS, valorPeriodo, type Frequencia } from '@/lib/folha';

interface Vale {
  id: string;
  data: string;
  valor: number;
  descricao: string | null;
}

interface Funcionario {
  id: string;
  nome: string;
  funcao: string | null;
  telefone: string | null;
  data_admissao: string;
  data_desligamento: string | null;
  ativo: boolean;
  frequencia: Frequencia;
  salario_mensal: number;
  registrado: boolean;
  controle_desde: string;
  observacoes: string | null;
  proximo: {
    inicio: string;
    fim: string;
    pagamento: string;
    bruto: number;
    proporcional: boolean;
    dias: number;
    dias_periodo: number;
    total_vales: number;
    a_receber: number;
    atrasado: boolean;
    dias_ate: number;
  };
  vales_abertos: Vale[];
  ultimo_pagamento: { pago_em: string; valor_liquido: number } | null;
  tempo_casa: { anos: number; meses: number; proximo_aniversario: string };
  encargos: {
    salario: number;
    fgts: number;
    decimo_terceiro: number;
    ferias: number;
    fgts_provisoes: number;
    custo_total: number;
    acrescimo_pct: number;
  };
}

interface Pagamento {
  id: string;
  funcionario_id: string;
  periodo_inicio: string;
  periodo_fim: string;
  data_prevista: string;
  pago_em: string;
  valor_bruto: number;
  total_vales: number;
  ajuste: number;
  valor_liquido: number;
  observacoes: string | null;
  funcionarios: { nome: string; frequencia: Frequencia } | null;
  funcionario_vales: Vale[];
}

type Vista = 'pagamentos' | 'equipe' | 'historico' | 'encargos';

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (s: string | null | undefined) => (s ? s.split('-').reverse().join('/') : '—');
const dataCurta = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7);
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = (s: string) => DIA_SEMANA[new Date(`${s}T00:00:00Z`).getUTCDay()];

const FREQ_CURTA: Record<Frequencia, string> = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };
const FREQ_COR: Record<Frequencia, string> = {
  semanal: 'bg-blue-100 text-blue-800',
  quinzenal: 'bg-purple-100 text-purple-800',
  mensal: 'bg-emerald-100 text-emerald-800',
};

// Toda chamada leva o token da sessao: as rotas de funcionarios exigem admin.
async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Erro na requisição');
  return json;
}

const FORM_VAZIO = {
  nome: '',
  funcao: '',
  telefone: '',
  data_admissao: '',
  frequencia: 'mensal' as Frequencia,
  salario_mensal: '',
  registrado: false,
  controle_desde: '',
  observacoes: '',
  ativo: true,
  data_desligamento: '',
};

export default function FuncionariosTab() {
  const [vista, setVista] = useState<Vista>('pagamentos');
  const [funcs, setFuncs] = useState<Funcionario[]>([]);
  const [hoje, setHoje] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [historico, setHistorico] = useState<Pagamento[]>([]);

  // Modais
  const [modalVale, setModalVale] = useState<{ funcionario_id: string; valor: string; data: string; descricao: string } | null>(null);
  const [modalPagar, setModalPagar] = useState<{ f: Funcionario; ajuste: string; pago_em: string; observacoes: string } | null>(null);
  const [modalFunc, setModalFunc] = useState<{ id: string | null; form: typeof FORM_VAZIO } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const json = await api(`/api/funcionarios${mostrarInativos ? '?inativos=1' : ''}`);
      setFuncs(json.funcionarios || []);
      setHoje(json.hoje);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [mostrarInativos]);

  const carregarHistorico = useCallback(async () => {
    try {
      const json = await api('/api/funcionarios/pagamentos');
      setHistorico(json.pagamentos || []);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (vista === 'historico') carregarHistorico(); }, [vista, carregarHistorico]);

  const ativos = funcs.filter(f => f.ativo);
  // Desligado aparece aqui ate o acerto final ser pago (a API ja filtra).
  const aPagar = funcs.filter(f => f.ativo || (f.data_desligamento && f.proximo.inicio <= f.data_desligamento));
  const porPagamento = [...aPagar].sort((a, b) => a.proximo.pagamento.localeCompare(b.proximo.pagamento) || a.nome.localeCompare(b.nome));
  const proximos7 = ativos.filter(f => f.proximo.dias_ate <= 7);
  const totalProximos7 = proximos7.reduce((a, f) => a + f.proximo.a_receber, 0);
  const totalVales = ativos.reduce((a, f) => a + f.proximo.total_vales, 0);
  const folhaMensal = ativos.reduce((a, f) => a + Number(f.salario_mensal), 0);
  const custoRegistrado = ativos.reduce((a, f) => a + f.encargos.custo_total, 0);

  // ---------- acoes ----------
  const salvarVale = async () => {
    if (!modalVale) return;
    setSalvando(true);
    try {
      await api('/api/funcionarios/vales', {
        method: 'POST',
        body: JSON.stringify({ ...modalVale, valor: Number(modalVale.valor.replace(',', '.')) }),
      });
      setModalVale(null);
      await carregar();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const apagarVale = async (v: Vale) => {
    if (!confirm(`Apagar o vale de ${brl(v.valor)} de ${dataBR(v.data)}?`)) return;
    try {
      await api(`/api/funcionarios/vales?id=${v.id}`, { method: 'DELETE' });
      await carregar();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const confirmarPagamento = async () => {
    if (!modalPagar) return;
    setSalvando(true);
    try {
      await api('/api/funcionarios/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          funcionario_id: modalPagar.f.id,
          pago_em: modalPagar.pago_em,
          ajuste: Number(modalPagar.ajuste.replace(',', '.')) || 0,
          observacoes: modalPagar.observacoes,
        }),
      });
      setModalPagar(null);
      await carregar();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const desfazerPagamento = async (p: Pagamento) => {
    if (!confirm(`Desfazer o pagamento de ${brl(p.valor_liquido)} para ${p.funcionarios?.nome}? Os vales voltam a ficar em aberto.`)) return;
    try {
      await api(`/api/funcionarios/pagamentos?id=${p.id}`, { method: 'DELETE' });
      await Promise.all([carregarHistorico(), carregar()]);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const abrirNovoFunc = () => setModalFunc({ id: null, form: { ...FORM_VAZIO, controle_desde: hoje } });
  const abrirEditarFunc = (f: Funcionario) => setModalFunc({
    id: f.id,
    form: {
      nome: f.nome,
      funcao: f.funcao ?? '',
      telefone: f.telefone ?? '',
      data_admissao: f.data_admissao,
      frequencia: f.frequencia,
      salario_mensal: String(f.salario_mensal),
      registrado: f.registrado,
      controle_desde: f.controle_desde,
      observacoes: f.observacoes ?? '',
      ativo: f.ativo,
      data_desligamento: f.data_desligamento ?? '',
    },
  });

  const salvarFunc = async () => {
    if (!modalFunc) return;
    const { id, form } = modalFunc;
    setSalvando(true);
    try {
      const body = { ...form, salario_mensal: Number(String(form.salario_mensal).replace(',', '.')) };
      await api(id ? `/api/funcionarios/${id}` : '/api/funcionarios', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setModalFunc(null);
      await carregar();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  // ---------- render ----------
  const quando = (f: Funcionario) => {
    const d = f.proximo.dias_ate;
    if (f.proximo.atrasado) return { txt: `Atrasado (${dataBR(f.proximo.pagamento)})`, cor: 'text-red-600' };
    if (d === 0) return { txt: 'Hoje', cor: 'text-green-700 font-bold' };
    if (d === 1) return { txt: 'Amanhã', cor: 'text-orange-600 font-semibold' };
    return { txt: `${diaSemana(f.proximo.pagamento)} ${dataCurta(f.proximo.pagamento)} · em ${d} dias`, cor: 'text-gray-600' };
  };

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]';
  const label = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="space-y-4 pb-8">
      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><CalendarClock size={14} /> A pagar em 7 dias</div>
          <p className="text-xl font-bold text-gray-900 mt-1">{brl(totalProximos7)}</p>
          <p className="text-xs text-gray-500">{proximos7.length} pagamento(s)</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><HandCoins size={14} /> Vales em aberto</div>
          <p className="text-xl font-bold text-orange-600 mt-1">{brl(totalVales)}</p>
          <p className="text-xs text-gray-500">descontados no próximo pagamento</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><Wallet size={14} /> Folha mensal</div>
          <p className="text-xl font-bold text-gray-900 mt-1">{brl(folhaMensal)}</p>
          <p className="text-xs text-gray-500">{ativos.length} funcionário(s) ativo(s)</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><Users size={14} /> Custo se todos registrados</div>
          <p className="text-xl font-bold text-gray-900 mt-1">{brl(custoRegistrado)}</p>
          <p className="text-xs text-gray-500">+{brl(custoRegistrado - folhaMensal)}/mês (estimativa)</p>
        </div>
      </div>

      {/* Navegacao + acoes */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
          {([
            ['pagamentos', '💸 Pagamentos'],
            ['equipe', '👷 Equipe'],
            ['historico', '📜 Histórico'],
            ['encargos', '📊 Encargos'],
          ] as [Vista, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setVista(k)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${vista === k ? 'bg-white text-[#F7941D] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setModalVale({ funcionario_id: ativos[0]?.id ?? '', valor: '', data: hoje, descricao: '' })}
            disabled={!ativos.length}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#F7941D] text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          ><HandCoins size={16} /> Lançar vale</button>
          <button
            onClick={abrirNovoFunc}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
          ><Plus size={16} /> Funcionário</button>
        </div>
      </div>

      {erro && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{erro}</div>}
      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}

      {!carregando && !erro && funcs.length === 0 && vista !== 'historico' && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          <p className="mb-3">Nenhum funcionário cadastrado ainda.</p>
          <button onClick={abrirNovoFunc} className="px-4 py-2 rounded-lg bg-[#F7941D] text-white text-sm font-medium">Cadastrar o primeiro</button>
        </div>
      )}

      {/* ===== PAGAMENTOS ===== */}
      {vista === 'pagamentos' && !carregando && porPagamento.length > 0 && (
        <div className="space-y-2">
          {porPagamento.map(f => {
            const q = quando(f);
            const aberto = expandido === f.id;
            return (
              <div key={f.id} className={`bg-white rounded-xl border ${f.proximo.atrasado ? 'border-red-300' : ''}`}>
                <div className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{f.nome}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${FREQ_COR[f.frequencia]}`}>{FREQ_CURTA[f.frequencia]}</span>
                      {!f.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Acerto final</span>}
                    </div>
                    <p className={`text-sm ${q.cor}`}>{q.txt}</p>
                    <p className="text-xs text-gray-500">
                      Período {dataBR(f.proximo.inicio)} a {dataBR(f.proximo.fim)}
                      {f.proximo.proporcional && ` · proporcional ${f.proximo.dias}/${f.proximo.dias_periodo} dias`}
                    </p>
                  </div>
                  <div className="text-right text-sm min-w-[150px]">
                    <p className="text-gray-500">Salário do período <span className="text-gray-800">{brl(f.proximo.bruto)}</span></p>
                    <button
                      onClick={() => setExpandido(aberto ? null : f.id)}
                      className="text-orange-600 hover:underline"
                    >− Vales ({f.vales_abertos.length}) {brl(f.proximo.total_vales)}</button>
                    <p className="font-bold text-gray-900 text-base">A receber {brl(f.proximo.a_receber)}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setModalPagar({ f, ajuste: '', pago_em: hoje, observacoes: '' })}
                      className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >Pagar</button>
                    <button
                      onClick={() => setModalVale({ funcionario_id: f.id, valor: '', data: hoje, descricao: '' })}
                      className="px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
                    >+ Vale</button>
                  </div>
                </div>
                {aberto && (
                  <div className="border-t px-4 py-3 bg-gray-50 rounded-b-xl">
                    {f.vales_abertos.length === 0 ? (
                      <p className="text-sm text-gray-500">Nenhum vale em aberto.</p>
                    ) : (
                      <ul className="space-y-1">
                        {f.vales_abertos.map(v => (
                          <li key={v.id} className="flex items-center justify-between text-sm">
                            <span>{dataBR(v.data)} · {brl(v.valor)}{v.descricao ? ` · ${v.descricao}` : ''}</span>
                            <button onClick={() => apagarVale(v)} className="text-gray-400 hover:text-red-600" aria-label="Apagar vale"><Trash2 size={14} /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {f.proximo.a_receber < 0 && (
                      <p className="mt-2 text-xs text-red-600">Os vales passaram do salário do período. A diferença pode ser compensada com um ajuste no pagamento.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== EQUIPE ===== */}
      {vista === 'equipe' && !carregando && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar desligados
          </label>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Admissão</th>
                  <th className="px-3 py-2">Tempo de casa</th>
                  <th className="px-3 py-2">Pagamento</th>
                  <th className="px-3 py-2 text-right">Salário/mês</th>
                  <th className="px-3 py-2 text-right">Por período</th>
                  <th className="px-3 py-2">Carteira</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {funcs.map(f => (
                  <tr key={f.id} className={`border-t ${f.ativo ? '' : 'opacity-50'}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{f.nome}</p>
                      <p className="text-xs text-gray-500">{f.funcao || '—'}{!f.ativo && ` · desligado ${dataBR(f.data_desligamento)}`}</p>
                    </td>
                    <td className="px-3 py-2">{dataBR(f.data_admissao)}</td>
                    <td className="px-3 py-2">
                      {f.tempo_casa.anos > 0 && `${f.tempo_casa.anos}a `}{f.tempo_casa.meses}m
                      <p className="text-xs text-gray-500">faz {f.tempo_casa.anos + 1} ano(s) em {dataBR(f.tempo_casa.proximo_aniversario)}</p>
                    </td>
                    <td className="px-3 py-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${FREQ_COR[f.frequencia]}`}>{FREQ_CURTA[f.frequencia]}</span></td>
                    <td className="px-3 py-2 text-right">{brl(f.salario_mensal)}</td>
                    <td className="px-3 py-2 text-right">{brl(valorPeriodo(f.frequencia, Number(f.salario_mensal)))}</td>
                    <td className="px-3 py-2">{f.registrado ? 'Sim' : 'Não'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => abrirEditarFunc(f)} className="text-gray-500 hover:text-[#F7941D]" aria-label="Editar"><Pencil size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Semanal = salário mensal × 12 ÷ 52 (fecha exato com o mensal no ano). Quinzenal = mensal ÷ 2.
          </p>
        </div>
      )}

      {/* ===== HISTORICO ===== */}
      {vista === 'historico' && (
        <div className="space-y-2">
          {historico.length === 0 && <p className="text-sm text-gray-500">Nenhum pagamento registrado ainda.</p>}
          {historico.map(p => (
            <div key={p.id} className="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-start">
              <div className="flex-1 min-w-[180px]">
                <p className="font-semibold">{p.funcionarios?.nome ?? '—'}</p>
                <p className="text-xs text-gray-500">
                  Pago em {dataBR(p.pago_em)} · período {dataBR(p.periodo_inicio)} a {dataBR(p.periodo_fim)}
                  {p.pago_em > p.data_prevista && <span className="text-red-600"> · previsto {dataBR(p.data_prevista)}</span>}
                </p>
                {p.funcionario_vales?.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Vales: {p.funcionario_vales.map(v => `${dataCurta(v.data)} ${brl(v.valor)}`).join(' · ')}
                  </p>
                )}
                {p.observacoes && <p className="text-xs text-gray-500 mt-1">Obs.: {p.observacoes}</p>}
              </div>
              <div className="text-right text-sm">
                <p className="text-gray-500">Bruto {brl(p.valor_bruto)}</p>
                <p className="text-orange-600">− Vales {brl(p.total_vales)}</p>
                {Number(p.ajuste) !== 0 && <p className="text-gray-600">Ajuste {Number(p.ajuste) > 0 ? '+' : ''}{brl(p.ajuste)}</p>}
                <p className="font-bold">Pago {brl(p.valor_liquido)}</p>
                <button onClick={() => desfazerPagamento(p)} className="text-xs text-gray-400 hover:text-red-600 mt-1">desfazer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== ENCARGOS ===== */}
      {vista === 'encargos' && !carregando && ativos.length > 0 && (
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-blue-50 text-blue-900 text-sm">
            Estimativa do custo mensal <b>se a pessoa for registrada</b> (CLT), com a empresa no Simples Nacional, Anexo I (comércio).
            Nesse caso o INSS patronal já está dentro do DAS, então o custo a mais é o FGTS (8%) e a reserva para 13º e férias + 1/3.
            O INSS do funcionário sai do salário dele e não aumenta o seu custo. Confirme os valores com a contabilidade.
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2 text-right">Salário</th>
                  <th className="px-3 py-2 text-right">FGTS 8%</th>
                  <th className="px-3 py-2 text-right">13º (1/12)</th>
                  <th className="px-3 py-2 text-right">Férias + 1/3</th>
                  <th className="px-3 py-2 text-right">FGTS s/ 13º e férias</th>
                  <th className="px-3 py-2 text-right">Custo total/mês</th>
                </tr>
              </thead>
              <tbody>
                {ativos.map(f => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2">{f.nome}{f.registrado && <span className="ml-1 text-[11px] text-green-700">(registrado)</span>}</td>
                    <td className="px-3 py-2 text-right">{brl(f.encargos.salario)}</td>
                    <td className="px-3 py-2 text-right">{brl(f.encargos.fgts)}</td>
                    <td className="px-3 py-2 text-right">{brl(f.encargos.decimo_terceiro)}</td>
                    <td className="px-3 py-2 text-right">{brl(f.encargos.ferias)}</td>
                    <td className="px-3 py-2 text-right">{brl(f.encargos.fgts_provisoes)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{brl(f.encargos.custo_total)}</td>
                  </tr>
                ))}
                <tr className="border-t bg-gray-50 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  {(['salario', 'fgts', 'decimo_terceiro', 'ferias', 'fgts_provisoes', 'custo_total'] as const).map(k => (
                    <td key={k} className="px-3 py-2 text-right">{brl(ativos.reduce((a, f) => a + f.encargos[k], 0))}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Registrar alguém custa cerca de {ativos[0]?.encargos.acrescimo_pct.toLocaleString('pt-BR')}% a mais que o salário, todo mês.
          </p>
        </div>
      )}

      {/* ===== MODAL VALE ===== */}
      {modalVale && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Lançar vale</h3>
              <button onClick={() => setModalVale(null)} aria-label="Fechar"><X size={20} /></button>
            </div>
            <div>
              <label className={label}>Funcionário</label>
              <select className={input} value={modalVale.funcionario_id} onChange={e => setModalVale({ ...modalVale, funcionario_id: e.target.value })}>
                {aPagar.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Valor (R$)</label>
                <input className={input} inputMode="decimal" autoFocus value={modalVale.valor} onChange={e => setModalVale({ ...modalVale, valor: e.target.value })} />
              </div>
              <div>
                <label className={label}>Data</label>
                <input type="date" className={input} value={modalVale.data} onChange={e => setModalVale({ ...modalVale, data: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={label}>Observação (opcional)</label>
              <input className={input} placeholder="ex.: adiantamento, farmácia" value={modalVale.descricao} onChange={e => setModalVale({ ...modalVale, descricao: e.target.value })} />
            </div>
            <button
              onClick={salvarVale}
              disabled={salvando || !modalVale.funcionario_id || !modalVale.valor}
              className="w-full py-2 rounded-lg bg-[#F7941D] text-white font-medium disabled:opacity-50"
            >{salvando ? 'Salvando…' : 'Salvar vale'}</button>
          </div>
        </div>
      )}

      {/* ===== MODAL PAGAR ===== */}
      {modalPagar && (() => {
        const f = modalPagar.f;
        const ajuste = Number(modalPagar.ajuste.replace(',', '.')) || 0;
        // Vale com data depois do dia do pagamento fica pro proximo.
        const valesConsiderados = f.vales_abertos.filter(v => v.data <= modalPagar.pago_em);
        const vales = valesConsiderados.reduce((a, v) => a + v.valor, 0);
        const liquido = f.proximo.bruto - vales + ajuste;
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Pagar {f.nome}</h3>
                <button onClick={() => setModalPagar(null)} aria-label="Fechar"><X size={20} /></button>
              </div>
              <p className="text-xs text-gray-500">
                {FREQUENCIA_LABELS[f.frequencia]} · período {dataBR(f.proximo.inicio)} a {dataBR(f.proximo.fim)}
              </p>
              <div className="text-sm space-y-1 bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between"><span>Salário do período</span><span>{brl(f.proximo.bruto)}</span></div>
                <div className="flex justify-between text-orange-600"><span>− Vales ({valesConsiderados.length})</span><span>{brl(vales)}</span></div>
                {ajuste !== 0 && <div className="flex justify-between"><span>Ajuste</span><span>{brl(ajuste)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t pt-1"><span>A pagar</span><span>{brl(liquido)}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Ajuste (+/−)</label>
                  <input className={input} inputMode="decimal" placeholder="ex.: -80 falta" value={modalPagar.ajuste} onChange={e => setModalPagar({ ...modalPagar, ajuste: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Pago em</label>
                  <input type="date" className={input} value={modalPagar.pago_em} onChange={e => setModalPagar({ ...modalPagar, pago_em: e.target.value })} />
                </div>
              </div>
              <div>
                <label className={label}>Observação (opcional)</label>
                <input className={input} placeholder="ex.: falta dia 08, hora extra" value={modalPagar.observacoes} onChange={e => setModalPagar({ ...modalPagar, observacoes: e.target.value })} />
              </div>
              <button
                onClick={confirmarPagamento}
                disabled={salvando}
                className="w-full py-2 rounded-lg bg-green-600 text-white font-medium disabled:opacity-50"
              >{salvando ? 'Salvando…' : `Confirmar pagamento de ${brl(liquido)}`}</button>
            </div>
          </div>
        );
      })()}

      {/* ===== MODAL FUNCIONARIO ===== */}
      {modalFunc && (() => {
        const form = modalFunc.form;
        const set = (patch: Partial<typeof FORM_VAZIO>) => setModalFunc({ ...modalFunc, form: { ...form, ...patch } });
        const sal = Number(String(form.salario_mensal).replace(',', '.')) || 0;
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 my-8">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{modalFunc.id ? 'Editar funcionário' : 'Novo funcionário'}</h3>
                <button onClick={() => setModalFunc(null)} aria-label="Fechar"><X size={20} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className={label}>Nome</label>
                  <input className={input} value={form.nome} onChange={e => set({ nome: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Função</label>
                  <input className={input} placeholder="ex.: motorista" value={form.funcao} onChange={e => set({ funcao: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Telefone</label>
                  <input className={input} inputMode="tel" value={form.telefone} onChange={e => set({ telefone: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Data de admissão</label>
                  <input type="date" className={input} value={form.data_admissao} onChange={e => set({ data_admissao: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Salário mensal (R$)</label>
                  <input className={input} inputMode="decimal" value={form.salario_mensal} onChange={e => set({ salario_mensal: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className={label}>Recebe</label>
                  <select className={input} value={form.frequencia} onChange={e => set({ frequencia: e.target.value as Frequencia })}>
                    {(Object.keys(FREQUENCIA_LABELS) as Frequencia[]).map(k => <option key={k} value={k}>{FREQUENCIA_LABELS[k]}</option>)}
                  </select>
                  {sal > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Recebe {brl(valorPeriodo(form.frequencia, sal))} por {form.frequencia === 'semanal' ? 'semana' : form.frequencia === 'quinzenal' ? 'quinzena' : 'mês'} (antes dos vales).
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <label className={label}>Controlar pagamentos a partir de</label>
                  <input type="date" className={input} value={form.controle_desde} onChange={e => set({ controle_desde: e.target.value })} />
                  <p className="text-xs text-gray-500 mt-1">O primeiro pagamento que aparece é o primeiro com dia de pagar a partir desta data.</p>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.registrado} onChange={e => set({ registrado: e.target.checked })} />
                  Registrado em carteira (CLT)
                </label>
                <div className="col-span-2">
                  <label className={label}>Observações</label>
                  <input className={input} value={form.observacoes} onChange={e => set({ observacoes: e.target.value })} />
                </div>
                {modalFunc.id && (
                  <div className="col-span-2 border-t pt-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!form.ativo}
                        onChange={e => set({ ativo: !e.target.checked, data_desligamento: e.target.checked ? (form.data_desligamento || hoje) : '' })}
                      />
                      Desligado
                    </label>
                    {!form.ativo && (
                      <div>
                        <label className={label}>Data de desligamento</label>
                        <input type="date" className={input} value={form.data_desligamento} onChange={e => set({ data_desligamento: e.target.value })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={salvarFunc}
                disabled={salvando || !form.nome.trim() || !form.data_admissao || !sal}
                className="w-full py-2 rounded-lg bg-[#F7941D] text-white font-medium disabled:opacity-50"
              >{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
