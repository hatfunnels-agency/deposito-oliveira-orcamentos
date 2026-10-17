'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Pencil, Check, X, Trash2, Users } from 'lucide-react';
import type { DespesaFixa, GrupoDespesaFixa, NovaDespesaFixa, TotaisDespesasFixas } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataCurta, mesBRT, pct, rotuloMes } from '@/lib/financeiro/formato';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Carregando, Cartao, Erro, INPUT, Modal,
  Selo, SeletorMes, useContextoFinanceiro,
} from './Comuns';

// A planilha de custos fixos, dentro do banco. Folha e somente leitura (vem
// de funcionarios); o resto edita inline e a API propaga pras contas
// pendentes do mes que ainda nao foram mexidas a mao.

interface Resposta { despesas: DespesaFixa[]; totais: TotaisDespesasFixas }

const GRUPOS: Array<{ key: GrupoDespesaFixa; rotulo: string }> = [
  { key: 'folha', rotulo: 'Folha' },
  { key: 'estrutura', rotulo: 'Estrutura' },
  { key: 'operacao', rotulo: 'Operação' },
  { key: 'comercial', rotulo: 'Comercial' },
  { key: 'imposto_socios', rotulo: 'Imposto e sócios' },
  { key: 'divida', rotulo: 'Dívida' },
  { key: 'outro', rotulo: 'Outros' },
];

interface Edicao {
  valor: number | null; percentual: number | null; dia_vencimento: number | null; gera_conta: boolean;
  inicio: string; fim: string; parcelas_total: number | null; valor_juros: number | null; observacoes: string;
}

export default function DespesasFixas() {
  const [mes, setMes] = useState(mesBRT());
  const [inativas, setInativas] = useState(false);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; e: Edicao } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [nova, setNova] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<Resposta>(`/api/financeiro/despesas-fixas?mes=${mes}${inativas ? '&inativas=1' : ''}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as despesas fixas');
    } finally {
      setCarregando(false);
    }
  }, [mes, inativas]);

  useEffect(() => { carregar(); }, [carregar]);

  const porGrupo = useMemo(() => {
    const m = new Map<GrupoDespesaFixa, DespesaFixa[]>();
    for (const d of dados?.despesas ?? []) {
      const lista = m.get(d.grupo) ?? [];
      lista.push(d);
      m.set(d.grupo, lista);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
    return m;
  }, [dados]);

  const iniciarEdicao = (d: DespesaFixa) => setEditando({
    id: d.id,
    e: {
      valor: d.valor, percentual: d.percentual, dia_vencimento: d.dia_vencimento, gera_conta: d.gera_conta,
      inicio: d.inicio, fim: d.fim ?? '', parcelas_total: d.parcelas_total, valor_juros: d.valor_juros, observacoes: d.observacoes ?? '',
    },
  });

  const salvarEdicao = async (d: DespesaFixa) => {
    if (!editando) return;
    const e = editando.e;
    setSalvando(true);
    setAviso(null);
    try {
      const corpo: Partial<NovaDespesaFixa> & { id: string } = {
        id: d.id,
        ...(d.tipo_valor === 'fixo' ? { valor: e.valor ?? 0 } : { percentual: e.percentual }),
        dia_vencimento: e.dia_vencimento ?? d.dia_vencimento,
        gera_conta: e.gera_conta,
        inicio: e.inicio || d.inicio,
        fim: e.fim ? `${e.fim.slice(0, 7)}-01` : null,
        parcelas_total: e.parcelas_total,
        valor_juros: e.valor_juros ?? 0,
        observacoes: e.observacoes.trim() || null,
      };
      await apiFinanceiro('/api/financeiro/despesas-fixas', { method: 'PATCH', body: JSON.stringify(corpo) });
      setEditando(null);
      await carregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const inativar = async (d: DespesaFixa) => {
    if (!window.confirm(`Inativar "${d.nome}"? As contas pendentes dela são canceladas; as pagas ficam.`)) return;
    try {
      await apiFinanceiro(`/api/financeiro/despesas-fixas?id=${d.id}`, { method: 'DELETE' });
      await carregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Erro ao inativar');
    }
  };

  const reativar = async (d: DespesaFixa) => {
    try {
      await apiFinanceiro('/api/financeiro/despesas-fixas', { method: 'PATCH', body: JSON.stringify({ id: d.id, ativo: true }) });
      await carregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Erro ao reativar');
    }
  };

  if (carregando && !dados) return <Carregando texto="Carregando despesas fixas…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const t = dados.totais;
  const semValor = dados.despesas.filter(d => d.ativo && d.gera_conta && d.fonte !== 'funcionarios' && d.valor_no_mes <= 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-gray-800">Despesas fixas</h2>
          <SeletorMes value={mes} onChange={setMes} futuros={3} />
          <label className="flex items-center gap-2 text-xs text-gray-600 min-h-[40px] cursor-pointer select-none">
            <input type="checkbox" checked={inativas} onChange={e => setInativas(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" />
            mostrar inativas
          </label>
        </div>
        <BotaoPrimario onClick={() => setNova(true)}><Plus className="w-4 h-4" /> Nova despesa</BotaoPrimario>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="erro">{aviso} <button type="button" onClick={() => setAviso(null)} className="ml-2 text-xs underline">fechar</button></Aviso>}
      {semValor.length > 0 && (
        <Aviso tom="alerta">
          Sem valor cadastrado (não geram conta): {semValor.map(d => d.nome).join(', ')}. Edite a linha e informe o valor.
        </Aviso>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Resumo rotulo={`Total em ${rotuloMes(t.mes)}`} valor={brl(t.total)} forte />
        <Resumo rotulo="Sem dívida" valor={brl(t.total_sem_divida)} />
        <Resumo rotulo="Dívida" valor={brl(t.divida)} />
        <Resumo rotulo="Folha + encargos estimados" valor={`${brl(t.folha)}${t.encargos_estimados > 0 ? ` + ${brl(t.encargos_estimados)}` : ''}`} />
      </div>

      <Cartao>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-xs text-gray-500 text-left">
              <tr>
                <th className="py-2 pr-2 font-medium">Despesa</th>
                <th className="py-2 px-2 font-medium text-right">Valor no mês</th>
                <th className="py-2 px-2 font-medium text-center">Dia</th>
                <th className="py-2 px-2 font-medium text-center">Gera conta?</th>
                <th className="py-2 px-2 font-medium">Início / fim</th>
                <th className="py-2 px-2 font-medium text-center">Parcelas</th>
                <th className="py-2 pl-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {GRUPOS.map(g => {
                const lista = porGrupo.get(g.key) ?? [];
                if (lista.length === 0) return null;
                return (
                  <GrupoLinhas key={g.key} rotulo={g.rotulo} total={t.por_grupo[g.key] ?? 0}>
                    {lista.map(d => (
                      editando?.id === d.id
                        ? <LinhaEdicao key={d.id} d={d} e={editando.e} onChange={e => setEditando({ id: d.id, e })} onSalvar={() => salvarEdicao(d)} onCancelar={() => setEditando(null)} salvando={salvando} />
                        : <LinhaLeitura key={d.id} d={d} onEditar={() => iniciarEdicao(d)} onInativar={() => inativar(d)} onReativar={() => reativar(d)} />
                    ))}
                  </GrupoLinhas>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Pró-labore = salário do sócio (custo da operação). Retirada de sócio = distribuição de lucro, fica abaixo do resultado.
          Linhas com <Selo tom="amarelo">Confirmar</Selo> vieram da planilha sem valor ou dia confirmado.
          Provisões (não geram conta) entram no orçado; o gasto real aparece pelo extrato e caixa.
        </p>
      </Cartao>

      {nova && <ModalNovaDespesa onFechar={() => setNova(false)} onSalvo={() => { setNova(false); carregar(); }} />}
    </div>
  );
}

function Resumo({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <p className="text-xs text-gray-500">{rotulo}</p>
      <p className={`mt-1 tabular-nums ${forte ? 'text-lg font-bold text-gray-900' : 'text-base font-semibold text-gray-800'}`}>{valor}</p>
    </div>
  );
}

function GrupoLinhas({ rotulo, total, children }: { rotulo: string; total: number; children: ReactNode }) {
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={6} className="py-1.5 pr-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">{rotulo}</td>
        <td className="py-1.5 pl-2 text-right text-xs font-semibold text-gray-700">{brl(total)}</td>
      </tr>
      {children}
    </>
  );
}

function LinhaLeitura({ d, onEditar, onInativar, onReativar }: { d: DespesaFixa; onEditar: () => void; onInativar: () => void; onReativar: () => void }) {
  const folha = d.fonte === 'funcionarios';
  const confirmar = /confirmar/i.test(d.observacoes ?? '');
  return (
    <tr className={`border-t border-gray-100 ${!d.ativo ? 'opacity-50' : ''}`}>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {folha && <Users className="w-3.5 h-3.5 text-purple-600" />}
          <span className="text-gray-800">{d.nome}</span>
          {confirmar && <Selo tom="amarelo">Confirmar</Selo>}
          {!d.ativo && <Selo tom="cinza">inativa</Selo>}
          {folha && <Selo tom="roxo">de Funcionários</Selo>}
        </div>
        {d.categoria_nome && <p className="text-[11px] text-gray-400">{d.categoria_nome}{d.fornecedor_nome ? ` · ${d.fornecedor_nome}` : ''}</p>}
        {folha && d.detalhe_folha && (
          <p className="text-[11px] text-gray-500">{d.detalhe_folha.funcionarios} funcionário(s) · salários {brl(d.detalhe_folha.salarios)} · encargos estimados {brl(d.detalhe_folha.encargos_estimados)}</p>
        )}
        {d.observacoes && !folha && <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{d.observacoes}</p>}
      </td>
      <td className="py-2 px-2 text-right">
        <span className={d.valor_no_mes <= 0 && d.ativo ? 'text-amber-700' : 'text-gray-900'}>{brl(d.valor_no_mes)}</span>
        {d.tipo_valor === 'pct_faturamento' && <p className="text-[11px] text-gray-500">{pct(d.percentual, 2)} do faturamento anterior</p>}
        {d.valor_juros > 0 && <p className="text-[11px] text-gray-500">juros {brl(d.valor_juros)}</p>}
      </td>
      <td className="py-2 px-2 text-center text-gray-700">{d.gera_conta ? d.dia_vencimento : '—'}</td>
      <td className="py-2 px-2 text-center">{d.gera_conta ? <Selo tom="azul">boleto</Selo> : <Selo tom="cinza">provisão</Selo>}</td>
      <td className="py-2 px-2 text-xs text-gray-600 whitespace-nowrap">{rotuloMes(d.inicio.slice(0, 7))}{d.fim ? ` → ${rotuloMes(d.fim.slice(0, 7))}` : ''}</td>
      <td className="py-2 px-2 text-center text-xs text-gray-600">
        {d.parcelas_total ? `${d.parcelas_restantes ?? '?'} de ${d.parcelas_total}` : '—'}
      </td>
      <td className="py-2 pl-2 text-right whitespace-nowrap">
        {folha ? <span className="text-[11px] text-gray-400">somente leitura</span> : (
          <>
            <button type="button" onClick={onEditar} aria-label="Editar" className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-gray-500 hover:text-gray-900"><Pencil className="w-4 h-4" /></button>
            {d.ativo
              ? <button type="button" onClick={onInativar} aria-label="Inativar" className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
              : <button type="button" onClick={onReativar} className="min-h-[40px] px-2 text-xs text-[#C96F00] hover:underline">reativar</button>}
          </>
        )}
      </td>
    </tr>
  );
}

function LinhaEdicao({ d, e, onChange, onSalvar, onCancelar, salvando }: {
  d: DespesaFixa; e: Edicao; onChange: (e: Edicao) => void; onSalvar: () => void; onCancelar: () => void; salvando: boolean;
}) {
  const campo = `${INPUT} min-h-[36px] py-1 text-xs`;
  return (
    <tr className="border-t border-orange-200 bg-orange-50/40">
      <td className="py-2 pr-2 align-top">
        <p className="text-gray-800">{d.nome}</p>
        <input value={e.observacoes} onChange={ev => onChange({ ...e, observacoes: ev.target.value })} placeholder="observações" className={`${campo} mt-1 w-56`} />
      </td>
      <td className="py-2 px-2 align-top">
        {d.tipo_valor === 'fixo'
          ? <CampoMoeda value={e.valor} onChange={v => onChange({ ...e, valor: v })} className="w-36 ml-auto" />
          : <CampoNumero value={e.percentual} onChange={v => onChange({ ...e, percentual: v })} step={0.01} sufixo="%" className="w-28 ml-auto" />}
        {d.grupo === 'divida' && (
          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-500">juros <CampoMoeda value={e.valor_juros} onChange={v => onChange({ ...e, valor_juros: v })} className="w-32" /></div>
        )}
      </td>
      <td className="py-2 px-2 align-top"><CampoNumero value={e.dia_vencimento} onChange={v => onChange({ ...e, dia_vencimento: v })} min={1} max={31} className="w-16 mx-auto" /></td>
      <td className="py-2 px-2 align-top text-center">
        <label className="inline-flex items-center gap-1 text-xs min-h-[36px] cursor-pointer">
          <input type="checkbox" checked={e.gera_conta} onChange={ev => onChange({ ...e, gera_conta: ev.target.checked })} className="w-4 h-4 accent-[#F7941D]" /> boleto
        </label>
      </td>
      <td className="py-2 px-2 align-top">
        <div className="flex flex-col gap-1">
          <input type="month" value={e.inicio.slice(0, 7)} onChange={ev => ev.target.value && onChange({ ...e, inicio: `${ev.target.value}-01` })} className={`${campo} w-36`} />
          <input type="month" value={e.fim.slice(0, 7)} onChange={ev => onChange({ ...e, fim: ev.target.value ? `${ev.target.value}-01` : '' })} className={`${campo} w-36`} placeholder="sem fim" />
        </div>
      </td>
      <td className="py-2 px-2 align-top"><CampoNumero value={e.parcelas_total} onChange={v => onChange({ ...e, parcelas_total: v })} min={1} className="w-16 mx-auto" /></td>
      <td className="py-2 pl-2 align-top text-right whitespace-nowrap">
        <button type="button" onClick={onSalvar} disabled={salvando} aria-label="Salvar" className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-emerald-700 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check className="w-5 h-5" /></button>
        <button type="button" onClick={onCancelar} disabled={salvando} aria-label="Cancelar" className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
      </td>
    </tr>
  );
}

function ModalNovaDespesa({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const { contexto } = useContextoFinanceiro();
  const [nome, setNome] = useState('');
  const [grupo, setGrupo] = useState<GrupoDespesaFixa>('estrutura');
  const [categoriaId, setCategoriaId] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [tipoValor, setTipoValor] = useState<'fixo' | 'pct_faturamento'>('fixo');
  const [valor, setValor] = useState<number | null>(null);
  const [percentual, setPercentual] = useState<number | null>(null);
  const [dia, setDia] = useState<number | null>(5);
  const [inicio, setInicio] = useState(mesBRT());
  const [fim, setFim] = useState('');
  const [parcelas, setParcelas] = useState<number | null>(null);
  const [geraConta, setGeraConta] = useState(true);
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    if (!nome.trim()) { setErro('Dê um nome à despesa.'); return; }
    if (tipoValor === 'fixo' && (valor === null || valor < 0)) { setErro('Informe o valor.'); return; }
    if (tipoValor === 'pct_faturamento' && (percentual === null || percentual <= 0)) { setErro('Informe o percentual.'); return; }
    setSalvando(true);
    setErro(null);
    const corpo: NovaDespesaFixa = {
      nome: nome.trim(), grupo, categoria_id: categoriaId || null, fornecedor_id: fornecedorId || null,
      tipo_valor: tipoValor, valor: tipoValor === 'fixo' ? (valor ?? 0) : 0, percentual: tipoValor === 'pct_faturamento' ? percentual : null,
      dia_vencimento: dia ?? 5, inicio: `${inicio}-01`, fim: fim ? `${fim}-01` : null, parcelas_total: parcelas,
      gera_conta: geraConta, observacoes: obs.trim() || null,
    };
    try {
      await apiFinanceiro('/api/financeiro/despesas-fixas', { method: 'POST', body: JSON.stringify(corpo) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Nova despesa fixa" onFechar={onFechar} largura="md"
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar</BotaoPrimario>
      </>}>
      <Campo rotulo="Nome"><input value={nome} onChange={e => setNome(e.target.value)} className={INPUT} autoFocus /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Grupo">
          <select value={grupo} onChange={e => setGrupo(e.target.value as GrupoDespesaFixa)} className={INPUT}>
            {GRUPOS.filter(g => g.key !== 'folha').map(g => <option key={g.key} value={g.key}>{g.rotulo}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Categoria">
          <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} className={INPUT}>
            <option value="">— sem categoria —</option>
            {(contexto?.categorias ?? []).filter(c => c.grupo !== 'receita').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Fornecedor">
        <select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)} className={INPUT}>
          <option value="">— sem fornecedor —</option>
          {(contexto?.fornecedores ?? []).filter(f => f.ativo).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo de valor">
          <select value={tipoValor} onChange={e => setTipoValor(e.target.value as 'fixo' | 'pct_faturamento')} className={INPUT}>
            <option value="fixo">Valor fixo</option>
            <option value="pct_faturamento">% do faturamento do mês anterior</option>
          </select>
        </Campo>
        {tipoValor === 'fixo'
          ? <Campo rotulo="Valor mensal"><CampoMoeda value={valor} onChange={setValor} /></Campo>
          : <Campo rotulo="Percentual"><CampoNumero value={percentual} onChange={setPercentual} step={0.01} sufixo="%" /></Campo>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Dia do vencimento"><CampoNumero value={dia} onChange={setDia} min={1} max={31} /></Campo>
        <Campo rotulo="Início"><input type="month" value={inicio} onChange={e => e.target.value && setInicio(e.target.value)} className={INPUT} /></Campo>
        <Campo rotulo="Fim (opcional)"><input type="month" value={fim} onChange={e => setFim(e.target.value)} className={INPUT} /></Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Parcelas (dívida)"><CampoNumero value={parcelas} onChange={setParcelas} min={1} placeholder="—" /></Campo>
        <Campo rotulo="Gera conta a pagar?" dica={geraConta ? 'Vira boleto todo mês.' : 'Provisão: só entra no orçado.'}>
          <label className="flex items-center gap-2 text-sm min-h-[40px] cursor-pointer select-none">
            <input type="checkbox" checked={geraConta} onChange={e => setGeraConta(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" /> sim
          </label>
        </Campo>
      </div>
      <Campo rotulo="Observações"><input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} /></Campo>
      <p className="text-[11px] text-gray-400">Início e fim em mês: o fim é o último mês cobrado (inclusive). Ex.: {rotuloMes(inicio)}{fim ? ` → ${rotuloMes(fim)}` : ''}. {dataCurta(`${inicio}-${String(dia ?? 5).padStart(2, '0')}`)} é o primeiro vencimento.</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
