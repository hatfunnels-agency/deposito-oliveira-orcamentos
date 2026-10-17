'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Undo2, FolderOpen } from 'lucide-react';
import type { BaseSimulador, CenarioSalvo, ParametrosCenario, ResultadoSimulacao } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { cenariosPadrao, normalizarParametros, simular } from '@/lib/financeiro/simulador';
import { brl, brlCurto, dataBR, pct, rotuloMes } from '@/lib/financeiro/formato';
import { CORES_CENARIOS, Linhas } from './Graficos';
import {
  Abas, Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Carregando, Cartao, Erro, Estatistica,
  INPUT, Modal, Selo, Vazio,
} from './Comuns';

// Simulador de 12 meses. Tres cenarios partem dos dados reais (ritmo do
// ultimo mes, media de 6 meses, melhor mes); tudo e editavel e recalculado
// no cliente (simular e puro). Salvar guarda os parametros, nao o resultado.

interface Resposta { base: BaseSimulador; cenarios_padrao: ParametrosCenario[]; salvos: CenarioSalvo[] }

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function simularSeguro(p: ParametrosCenario): ResultadoSimulacao | null {
  try { return simular(normalizarParametros(p)); } catch { return null; }
}

export default function Simulador() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [cenarios, setCenarios] = useState<ParametrosCenario[]>([]);
  const [origem, setOrigem] = useState<Array<string | null>>([null, null, null]);   // id do salvo carregado em cada aba
  const [ativo, setAtivo] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modalSalvar, setModalSalvar] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiFinanceiro<Resposta>('/api/financeiro/simulador');
      setDados(r);
      const padrao = r.cenarios_padrao?.length ? r.cenarios_padrao : cenariosPadrao(r.base);
      setCenarios(prev => (prev.length ? prev : padrao));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o simulador');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const resultados = useMemo(() => cenarios.map(simularSeguro), [cenarios]);
  const p = cenarios[ativo];
  const res = resultados[ativo];

  const alterar = (patch: Partial<ParametrosCenario>) => setCenarios(cs => cs.map((c, i) => (i === ativo ? { ...c, ...patch } : c)));

  const restaurar = () => {
    if (!dados) return;
    const padrao = (dados.cenarios_padrao?.length ? dados.cenarios_padrao : cenariosPadrao(dados.base))[ativo];
    if (padrao) { alterar(padrao); setOrigem(o => o.map((x, i) => (i === ativo ? null : x))); }
  };

  const carregarSalvo = (s: CenarioSalvo) => {
    setCenarios(cs => cs.map((c, i) => (i === ativo ? { ...s.parametros, nome: s.nome } : c)));
    setOrigem(o => o.map((x, i) => (i === ativo ? s.id : x)));
    setAviso(`Cenário “${s.nome}” carregado na aba ${ativo + 1}.`);
  };

  const excluirSalvo = async (s: CenarioSalvo) => {
    if (!window.confirm(`Excluir o cenário salvo “${s.nome}”?`)) return;
    try {
      await apiFinanceiro(`/api/financeiro/simulador?id=${s.id}`, { method: 'DELETE' });
      setOrigem(o => o.map(x => (x === s.id ? null : x)));
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  };

  const salvar = async (nome: string, atualizar: boolean) => {
    if (!p) return;
    setSalvando(true);
    try {
      const parametros = normalizarParametros({ ...p, nome });
      const id = origem[ativo];
      if (atualizar && id) {
        await apiFinanceiro('/api/financeiro/simulador', { method: 'PATCH', body: JSON.stringify({ id, nome, parametros }) });
      } else {
        const r = await apiFinanceiro<CenarioSalvo>('/api/financeiro/simulador', { method: 'POST', body: JSON.stringify({ nome, parametros }) });
        if (r?.id) setOrigem(o => o.map((x, i) => (i === ativo ? r.id : x)));
      }
      alterar({ nome });
      setModalSalvar(false);
      setAviso(`Cenário “${nome}” salvo.`);
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando && !dados) return <Carregando texto="Preparando os cenários…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados || !p) return null;

  const base = dados.base;
  const rotulos = res?.linhas.map(l => rotuloMes(l.mes)) ?? [];
  const series = cenarios.map((c, i) => ({
    nome: c.nome, cor: CORES_CENARIOS[i % CORES_CENARIOS.length], valores: resultados[i]?.linhas.map(l => l.caixa_acumulado) ?? [], tracejada: i !== ativo,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">Simulador de cenários</h2>
        <div className="flex items-center gap-2">
          <BotaoSecundario onClick={restaurar} className="min-h-[40px]" title="Volta aos números reais da base"><Undo2 className="w-4 h-4" /> Restaurar da base</BotaoSecundario>
          <BotaoPrimario onClick={() => setModalSalvar(true)}><Save className="w-4 h-4" /> Salvar cenário</BotaoPrimario>
        </div>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="info">{aviso} <button type="button" onClick={() => setAviso(null)} className="ml-2 text-xs underline">fechar</button></Aviso>}

      <Cartao titulo="Base real" descricao={`Últimos 6 meses, a partir de ${rotuloMes(base.mes_inicio)}. Os cenários partem daqui.`}>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          <span>Último mês <strong>{brl(base.faturamento_ultimo_mes)}</strong></span>
          <span>Média 6m <strong>{brl(base.faturamento_medio_6m)}</strong></span>
          <span>Melhor mês <strong>{brl(base.faturamento_melhor_mes)}</strong></span>
          <span>Margem bruta <strong>{pct(base.margem_media_pct)}</strong></span>
          <span>Cartão <strong>{pct(base.mix_cartao_pct)}</strong> do recebido, custo líquido <strong>{pct(base.custo_cartao_liquido_pct, 2)}</strong></span>
          <span>Imposto <strong>{pct(base.imposto_pct_atual, 2)}</strong> do faturamento</span>
          <span>Folha <strong>{brl(base.folha)}</strong></span>
          <span>Caixa inicial <strong>{brl(base.caixa_inicial)}</strong></span>
        </div>
        {base.faturamentos.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {base.faturamentos.map(f => <Selo key={f.mes} tom="cinza">{rotuloMes(f.mes)}: {brlCurto(f.faturamento)}{f.margem_pct !== null ? ` · ${pct(f.margem_pct, 0)}` : ''}</Selo>)}
          </div>
        )}
      </Cartao>

      <Abas<string> valor={String(ativo)} onChange={k => setAtivo(Number(k))}
        opcoes={cenarios.map((c, i) => ({ key: String(i), rotulo: c.nome }))} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Parametros */}
        <Cartao className="lg:col-span-2" titulo="Parâmetros" selo={origem[ativo] ? <Selo tom="azul">salvo</Selo> : undefined}>
          <div className="space-y-3">
            <Campo rotulo="Nome do cenário"><input value={p.nome} onChange={e => alterar({ nome: e.target.value })} className={INPUT} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Faturamento mensal"><CampoMoeda value={p.faturamento_mensal} onChange={v => alterar({ faturamento_mensal: v ?? 0 })} /></Campo>
              <Campo rotulo="Margem bruta"><CampoNumero value={p.margem_bruta_pct} onChange={v => alterar({ margem_bruta_pct: v ?? 0 })} step={0.1} min={0} max={100} sufixo="%" /></Campo>
              <Campo rotulo="Crescimento ao mês"><CampoNumero value={p.crescimento_mensal_pct} onChange={v => alterar({ crescimento_mensal_pct: v ?? 0 })} step={0.1} sufixo="%" /></Campo>
              <Campo rotulo="Meses"><CampoNumero value={p.meses} onChange={v => alterar({ meses: Math.max(1, Math.min(60, Math.trunc(v ?? 12))) })} min={1} max={60} /></Campo>
            </div>

            <Campo rotulo="Sazonalidade" dica="Meses em que o faturamento muda, multiplicado pelo fator (1,2 = +20%; 0,8 = −20%).">
              <div className="flex flex-wrap gap-1 mb-2">
                {MESES_CURTOS.map((m, i) => {
                  const n = i + 1;
                  const on = p.sazonalidade.meses.includes(n);
                  return (
                    <button key={m} type="button" onClick={() => alterar({ sazonalidade: { ...p.sazonalidade, meses: on ? p.sazonalidade.meses.filter(x => x !== n) : [...p.sazonalidade.meses, n].sort((a, b) => a - b) } })}
                      className={`min-h-[36px] px-2.5 rounded-lg text-xs ${on ? 'bg-[#F7941D] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{m}</button>
                  );
                })}
              </div>
              <CampoNumero value={p.sazonalidade.fator} onChange={v => alterar({ sazonalidade: { ...p.sazonalidade, fator: v && v > 0 ? v : 1 } })} step={0.05} min={0.1} max={3} sufixo="×" className="w-32" />
            </Campo>

            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Imposto (% do faturamento)"><CampoNumero value={p.imposto_pct_faturamento} onChange={v => alterar({ imposto_pct_faturamento: v ?? 0 })} step={0.1} min={0} max={100} sufixo="%" /></Campo>
              <Campo rotulo="Teto do Simples (12 meses)"><CampoMoeda value={p.teto_anual} onChange={v => alterar({ teto_anual: v && v > 0 ? v : 4_800_000 })} /></Campo>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[40px] cursor-pointer select-none">
              <input type="checkbox" checked={p.imposto_pct_apos_teto !== null} onChange={e => alterar({ imposto_pct_apos_teto: e.target.checked ? Math.max(p.imposto_pct_faturamento, 15) : null })} className="w-4 h-4 accent-[#F7941D]" />
              alíquota diferente depois do teto
            </label>
            {p.imposto_pct_apos_teto !== null && (
              <Campo rotulo="Alíquota após o teto" dica="Fora do Simples o imposto sobe; o simulador troca a alíquota no mês em que os 12 meses móveis passam do teto.">
                <CampoNumero value={p.imposto_pct_apos_teto} onChange={v => alterar({ imposto_pct_apos_teto: v ?? 0 })} step={0.1} min={0} max={100} sufixo="%" className="w-32" />
              </Campo>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Cartão: % do recebido"><CampoNumero value={p.cartao.participacao_pct} onChange={v => alterar({ cartao: { ...p.cartao, participacao_pct: v ?? 0 } })} step={1} min={0} max={100} sufixo="%" /></Campo>
              <Campo rotulo="Custo líquido do cartão"><CampoNumero value={p.cartao.custo_liquido_pct} onChange={v => alterar({ cartao: { ...p.cartao, custo_liquido_pct: v ?? 0 } })} step={0.01} min={0} max={100} sufixo="%" /></Campo>
            </div>

            <ListaCustos p={p} alterar={alterar} />
            <ListaDividas p={p} alterar={alterar} />

            <Campo rotulo="Caixa inicial"><CampoMoeda value={p.caixa_inicial} onChange={v => alterar({ caixa_inicial: v ?? 0 })} /></Campo>
          </div>
        </Cartao>

        {/* Resultado */}
        <div className="lg:col-span-3 space-y-4">
          {!res ? <Erro mensagem="Parâmetros inválidos para simular." /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Estatistica rotulo={`Caixa livre em ${res.linhas.length} meses`} valor={brl(res.resumo.caixa_no_periodo)} tom={res.resumo.caixa_no_periodo < 0 ? 'vermelho' : 'verde'} detalhe={`média ${brl(res.resumo.media_mes)}/mês`} />
                <Estatistica rotulo="Pior momento do caixa" valor={brl(res.resumo.pior_momento)} tom={res.resumo.pior_momento < 0 ? 'vermelho' : 'neutro'} detalhe={`em ${rotuloMes(res.resumo.pior_mes)}`} />
                <Estatistica rotulo="Meses no vermelho" valor={String(res.resumo.meses_no_vermelho)} tom={res.resumo.meses_no_vermelho > 0 ? 'laranja' : 'verde'} />
                <Estatistica rotulo="Ponto de equilíbrio" valor={res.resumo.break_even_faturamento === null ? 'não fecha' : brl(res.resumo.break_even_faturamento)} tom={res.resumo.break_even_faturamento === null ? 'vermelho' : 'azul'}
                  detalhe={res.resumo.break_even_por_dia_util === null ? 'margem não cobre imposto e cartão' : `${brl(res.resumo.break_even_por_dia_util)} por dia útil (25/mês)`} />
                <Estatistica rotulo="Caixa acumulado no fim" valor={brl(res.linhas[res.linhas.length - 1]?.caixa_acumulado ?? 0)} tom={(res.linhas[res.linhas.length - 1]?.caixa_acumulado ?? 0) < 0 ? 'vermelho' : 'neutro'} detalhe={`a partir de ${brl(p.caixa_inicial)}`} />
                <Estatistica rotulo="Lucro da operação (1º mês)" valor={brl(res.linhas[0]?.lucro_operacao ?? 0)} tom={(res.linhas[0]?.lucro_operacao ?? 0) < 0 ? 'vermelho' : 'neutro'} detalhe={`dívida ${brl(res.linhas[0]?.divida ?? 0)}/mês`} />
              </div>
              {res.alertas.length > 0 && (
                <div className="space-y-1.5">
                  {res.alertas.map((a, i) => <Aviso key={i} tom="alerta">{a}</Aviso>)}
                </div>
              )}

              <Cartao>
                <Linhas titulo="Caixa acumulado por cenário" series={series} rotulos={rotulos} />
              </Cartao>

              <Cartao titulo={`Mês a mês · ${p.nome}`}>
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs min-w-[760px]">
                    <thead className="text-gray-500 text-left">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Mês</th>
                        <th className="py-1.5 px-2 font-medium text-right">Faturamento</th>
                        <th className="py-1.5 px-2 font-medium text-right">Lucro bruto</th>
                        <th className="py-1.5 px-2 font-medium text-right">Fixos</th>
                        <th className="py-1.5 px-2 font-medium text-right">Imposto</th>
                        <th className="py-1.5 px-2 font-medium text-right">Cartão</th>
                        <th className="py-1.5 px-2 font-medium text-right">Lucro op.</th>
                        <th className="py-1.5 px-2 font-medium text-right">Dívida</th>
                        <th className="py-1.5 px-2 font-medium text-right">Caixa livre</th>
                        <th className="py-1.5 pl-2 font-medium text-right">Acumulado</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {res.linhas.map(l => (
                        <tr key={l.mes} className="border-t border-gray-100">
                          <td className="py-1 pr-2 text-gray-700 whitespace-nowrap">{rotuloMes(l.mes)}{l.acima_do_teto && <Selo tom="vermelho" className="ml-1">teto</Selo>}</td>
                          <td className="py-1 px-2 text-right">{brl(l.faturamento)}</td>
                          <td className="py-1 px-2 text-right">{brl(l.lucro_bruto)}</td>
                          <td className="py-1 px-2 text-right text-red-700">{brl(-l.custo_fixo)}</td>
                          <td className="py-1 px-2 text-right text-red-700">{brl(-l.imposto)}</td>
                          <td className="py-1 px-2 text-right text-red-700">{brl(-l.taxas)}</td>
                          <td className={`py-1 px-2 text-right font-semibold ${l.lucro_operacao < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(l.lucro_operacao)}</td>
                          <td className="py-1 px-2 text-right text-red-700">{brl(-l.divida)}</td>
                          <td className={`py-1 px-2 text-right font-semibold ${l.caixa_livre < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(l.caixa_livre)}</td>
                          <td className={`py-1 pl-2 text-right font-bold ${l.caixa_acumulado < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(l.caixa_acumulado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Cartao>
            </>
          )}

          <Cartao titulo="Cenários salvos" descricao="Carregar substitui a aba ativa.">
            {dados.salvos.length === 0 ? <Vazio>Nenhum cenário salvo ainda.</Vazio> : (
              <div className="divide-y divide-gray-100">
                {dados.salvos.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-800 truncate">{s.nome}</p>
                      <p className="text-xs text-gray-500">{brl(s.parametros.faturamento_mensal)}/mês · margem {pct(s.parametros.margem_bruta_pct)} · {s.parametros.meses} meses · atualizado {dataBR(s.atualizado_em)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => carregarSalvo(s)} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-[#C96F00] hover:underline"><FolderOpen className="w-4 h-4" /> Carregar</button>
                      <button type="button" onClick={() => excluirSalvo(s)} aria-label="Excluir" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Cartao>
        </div>
      </div>

      {modalSalvar && (
        <ModalSalvar nome={p.nome} podeAtualizar={!!origem[ativo]} salvando={salvando} onFechar={() => setModalSalvar(false)} onSalvar={salvar} />
      )}
    </div>
  );
}

function ListaCustos({ p, alterar }: { p: ParametrosCenario; alterar: (patch: Partial<ParametrosCenario>) => void }) {
  const set = (lista: ParametrosCenario['custos_fixos']) => alterar({ custos_fixos: lista });
  const total = p.custos_fixos.reduce((a, c) => a + (Number(c.valor) || 0), 0);
  return (
    <Campo rotulo={`Custos fixos (${brl(total)}/mês no início)`} dica="Mês de início/fim relativos ao cenário (1 = primeiro mês). Vazio = o tempo todo.">
      <div className="space-y-1.5">
        {p.custos_fixos.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1 items-center">
            <input value={c.nome} onChange={e => set(p.custos_fixos.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} className={`${INPUT} min-h-[36px] py-1 text-xs`} placeholder="nome" />
            <CampoMoeda value={c.valor} onChange={v => set(p.custos_fixos.map((x, k) => (k === i ? { ...x, valor: v ?? 0 } : x)))} className="w-28" />
            <CampoNumero value={c.mes_inicio ?? null} onChange={v => set(p.custos_fixos.map((x, k) => (k === i ? { ...x, mes_inicio: v ?? undefined } : x)))} min={1} max={60} className="w-14" placeholder="de" />
            <CampoNumero value={c.mes_fim ?? null} onChange={v => set(p.custos_fixos.map((x, k) => (k === i ? { ...x, mes_fim: v ?? undefined } : x)))} min={1} max={60} className="w-14" placeholder="até" />
            <button type="button" onClick={() => set(p.custos_fixos.filter((_, k) => k !== i))} aria-label="Remover" className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => set([...p.custos_fixos, { nome: '', valor: 0 }])} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[36px]"><Plus className="w-3.5 h-3.5" /> adicionar custo</button>
      </div>
    </Campo>
  );
}

function ListaDividas({ p, alterar }: { p: ParametrosCenario; alterar: (patch: Partial<ParametrosCenario>) => void }) {
  const set = (lista: ParametrosCenario['dividas']) => alterar({ dividas: lista });
  const total = p.dividas.reduce((a, d) => a + (Number(d.valor) || 0), 0);
  return (
    <Campo rotulo={`Dívidas (${brl(total)}/mês)`} dica="Parcela mensal e quantas parcelas faltam.">
      <div className="space-y-1.5">
        {p.dividas.map((d, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center">
            <input value={d.nome} onChange={e => set(p.dividas.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} className={`${INPUT} min-h-[36px] py-1 text-xs`} placeholder="nome" />
            <CampoMoeda value={d.valor} onChange={v => set(p.dividas.map((x, k) => (k === i ? { ...x, valor: v ?? 0 } : x)))} className="w-28" />
            <CampoNumero value={d.parcelas_restantes} onChange={v => set(p.dividas.map((x, k) => (k === i ? { ...x, parcelas_restantes: Math.max(0, Math.trunc(v ?? 0)) } : x)))} min={0} max={360} className="w-16" sufixo="x" />
            <button type="button" onClick={() => set(p.dividas.filter((_, k) => k !== i))} aria-label="Remover" className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => set([...p.dividas, { nome: '', valor: 0, parcelas_restantes: 12 }])} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[36px]"><Plus className="w-3.5 h-3.5" /> adicionar dívida</button>
      </div>
    </Campo>
  );
}

function ModalSalvar({ nome, podeAtualizar, salvando, onFechar, onSalvar }: {
  nome: string; podeAtualizar: boolean; salvando: boolean; onFechar: () => void; onSalvar: (nome: string, atualizar: boolean) => void;
}) {
  const [n, setN] = useState(nome);
  return (
    <Modal titulo="Salvar cenário" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        {podeAtualizar && <BotaoSecundario onClick={() => onSalvar(n.trim() || nome, true)} carregando={salvando}>Atualizar o salvo</BotaoSecundario>}
        <BotaoPrimario onClick={() => onSalvar(n.trim() || nome, false)} carregando={salvando}>{podeAtualizar ? 'Salvar como novo' : 'Salvar'}</BotaoPrimario>
      </>}>
      <Campo rotulo="Nome"><input value={n} onChange={e => setN(e.target.value)} className={INPUT} autoFocus /></Campo>
      <p className="text-xs text-gray-500">Salva os parâmetros; o resultado é recalculado ao carregar.</p>
    </Modal>
  );
}
