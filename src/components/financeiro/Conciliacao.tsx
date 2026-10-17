'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Unlink, Upload, RefreshCw, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type {
  CandidatoConciliacao, Categoria, LancamentoResumo, PedidoParaVincular, ResultadoConciliacao, ResultadoVinculoPedido,
  SugestaoConciliacao, VinculoAplicado,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataBR, dataCurta, hojeBRT, pct, rotuloMetodo, somarDiasISO } from '@/lib/financeiro/formato';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, Carregando, Cartao, Erro, Estatistica, INPUT, LinkSecao, Modal, Selo, Vazio,
  useContextoFinanceiro,
} from './Comuns';

// Conciliacao por conta e periodo. A automatica grava so os pares de
// confianca alta; o resto vira sugestao pra confirmar em um toque.
// Cartao da Stone nao casa por linha (cai liquido, agregado em D+1):
// mostra o agregado por dia e a taxa efetiva real.

const ROTULO_CANDIDATO: Record<CandidatoConciliacao['tipo'], string> = {
  pagamento: 'pagamento de venda', grupo: 'grupo de pagamentos', conta_pagar: 'conta a pagar', folha: 'folha', vale: 'vale',
};

export default function Conciliacao() {
  const { contexto } = useContextoFinanceiro();
  const hoje = hojeBRT();
  const contas = useMemo(() => (contexto?.contas ?? []).filter(c => c.ativo && (c.tipo === 'banco' || c.tipo === 'adquirente')), [contexto]);
  // Sem escolha explicita vale a primeira conta (derivado, sem efeito).
  const [contaEscolhida, setContaEscolhida] = useState('');
  const contaId = contaEscolhida || contas[0]?.id || '';
  const [de, setDe] = useState(somarDiasISO(hoje, -7));
  const [ate, setAte] = useState(hoje);
  const [res, setRes] = useState<ResultadoConciliacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verSemPar, setVerSemPar] = useState(false);
  const [verSistema, setVerSistema] = useState(false);
  const [vinculandoPedido, setVinculandoPedido] = useState<LancamentoResumo | null>(null);
  const categorias = useMemo(() => [...(contexto?.categorias ?? [])].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome, 'pt-BR')), [contexto]);

  // Linha sem par: so a categoria (entra no Fechamento por ela). Entrada de
  // cliente nao vira regra (nome de cliente varia); saida aprende.
  const categorizar = async (l: LancamentoResumo, categoriaId: string) => {
    setOcupado(l.id);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/lancamentos', {
        method: 'PATCH', body: JSON.stringify({ id: l.id, categoria_id: categoriaId || null, aprender: l.valor < 0 }),
      });
      setAviso(`Categoria salva: ${categorias.find(c => c.id === categoriaId)?.nome ?? 'sem categoria'}.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a categoria');
    } finally {
      setOcupado(null);
    }
  };

  const carregar = useCallback(async () => {
    if (!contaId) return;
    setCarregando(true);
    setErro(null);
    try {
      setRes(await apiFinanceiro<ResultadoConciliacao>(`/api/financeiro/conciliar?conta_id=${contaId}&de=${de}&ate=${ate}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar a conciliação');
    } finally {
      setCarregando(false);
    }
  }, [contaId, de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  const conciliarAuto = async () => {
    setAplicando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await apiFinanceiro<ResultadoConciliacao>('/api/financeiro/conciliar', { method: 'POST', body: JSON.stringify({ acao: 'auto', conta_id: contaId, de, ate }) });
      setRes(r);
      setAviso(`${r.totais.conciliadas_agora} conciliada(s) agora · ${r.totais.sugestoes} sugestão(ões) · ${r.totais.sem_par} sem par${r.totais.conflitos > 0 ? ` · ${r.totais.conflitos} conflito(s) ignorado(s)` : ''}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao conciliar');
    } finally {
      setAplicando(false);
    }
  };

  const vincular = async (s: SugestaoConciliacao, c: CandidatoConciliacao) => {
    setOcupado(s.lancamento.id);
    setErro(null);
    const chave = c.tipo === 'pagamento' ? 'pagamento_id' : c.tipo === 'conta_pagar' ? 'conta_pagar_id' : c.tipo === 'folha' ? 'funcionario_pagamento_id' : c.tipo === 'vale' ? 'funcionario_vale_id' : null;
    if (!chave) { setOcupado(null); return; }
    try {
      await apiFinanceiro('/api/financeiro/conciliar', { method: 'POST', body: JSON.stringify({ acao: 'vincular', lancamento_id: s.lancamento.id, [chave]: c.id }) });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao vincular');
    } finally {
      setOcupado(null);
    }
  };

  const desvincular = async (v: VinculoAplicado) => {
    if (!window.confirm(`Desfazer o vínculo de "${v.descricao}"?${v.conta_marcada_paga ? ' A conta volta a pendente.' : ''}`)) return;
    setOcupado(v.lancamento_id);
    try {
      await apiFinanceiro('/api/financeiro/conciliar', { method: 'POST', body: JSON.stringify({ acao: 'desvincular', lancamento_id: v.lancamento_id }) });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao desvincular');
    } finally {
      setOcupado(null);
    }
  };

  const contaSel = contas.find(c => c.id === contaId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">Conciliação bancária</h2>
        <LinkSecao secao="extratos" className="inline-flex items-center gap-1 text-sm min-h-[44px] px-2"><Upload className="w-4 h-4" /> Importar extrato</LinkSecao>
      </div>

      <Cartao>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <Campo rotulo="Conta" className="sm:col-span-2">
            <select value={contaId} onChange={e => setContaEscolhida(e.target.value)} className={INPUT}>
              {contas.length === 0 && <option value="">Nenhuma conta de banco/adquirente</option>}
              {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="De"><input type="date" value={de} max={ate} onChange={e => e.target.value && setDe(e.target.value)} className={INPUT} /></Campo>
          <Campo rotulo="Até"><input type="date" value={ate} min={de} max={hoje} onChange={e => e.target.value && setAte(e.target.value)} className={INPUT} /></Campo>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3 flex-wrap">
          <BotaoSecundario onClick={carregar} carregando={carregando} className="min-h-[40px]"><RefreshCw className="w-4 h-4" /> Analisar de novo</BotaoSecundario>
          <BotaoPrimario onClick={conciliarAuto} carregando={aplicando} disabled={!contaId}>
            <Link2 className="w-4 h-4" /> Conciliar automaticamente
          </BotaoPrimario>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          A automática grava só os pares certos (valor exato e, nas saídas, fornecedor identificado). O que ficou em dúvida aparece em Sugestões.
          {contaSel?.tipo === 'adquirente' && ' Na Stone, o cartão é conferido pelo agregado do dia de liquidação, não linha a linha.'}
        </p>
      </Cartao>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}
      {carregando && !res && <Carregando texto="Analisando o período…" />}

      {res && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Estatistica rotulo="Linhas no período" valor={String(res.totais.linhas)} detalhe={`${res.totais.transferencias_ignoradas} transferência(s) própria(s) fora`} />
            <Estatistica rotulo="Já conciliadas" valor={String(res.totais.ja_conciliadas)} tom="verde" />
            <Estatistica rotulo="Sugestões" valor={String(res.totais.sugestoes)} tom={res.totais.sugestoes > 0 ? 'laranja' : 'neutro'} />
            <Estatistica rotulo="Sem par" valor={String(res.totais.sem_par)} tom={res.totais.sem_par > 0 ? 'amarelo' : 'neutro'} />
            <Estatistica rotulo="Taxa efetiva do cartão" valor={res.taxa_efetiva_periodo_pct === null ? '—' : pct(res.taxa_efetiva_periodo_pct, 2)}
              detalhe={res.cartao_agregado.length > 0 ? `${res.cartao_agregado.length} dia(s) de liquidação` : 'sem liquidações no período'} />
          </div>

          {res.aplicados.length > 0 && (
            <Cartao titulo={`Conciliadas agora (${res.aplicados.length})`} descricao="Pares de confiança alta gravados. Desfaça se algum estiver errado.">
              <div className="divide-y divide-gray-100">
                {res.aplicados.map(v => (
                  <div key={v.lancamento_id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{v.descricao}</p>
                      <p className="text-xs text-gray-500">{ROTULO_CANDIDATO[v.tipo === 'estorno' ? 'pagamento' : v.tipo]}{v.conta_marcada_paga ? ' · conta marcada como paga' : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold tabular-nums text-gray-900">{brl(v.valor)}</span>
                      <button type="button" onClick={() => desvincular(v)} disabled={ocupado === v.lancamento_id}
                        className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-600 hover:text-red-700 disabled:opacity-50">
                        <Unlink className="w-3.5 h-3.5" /> Desfazer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Cartao>
          )}

          <Cartao titulo={`Sugestões (${res.sugestoes.length})`} descricao="Linha do extrato à esquerda, candidatos do sistema à direita. Vincule o certo.">
            {res.sugestoes.length === 0 ? <Vazio>Nenhuma sugestão pendente.</Vazio> : (
              <div className="space-y-3">
                {res.sugestoes.map(s => (
                  <div key={s.lancamento.id} className="border border-gray-200 rounded-lg p-3">
                    <Lanc l={s.lancamento} />
                    <div className="mt-2 space-y-1.5">
                      {s.candidatos.map(c => (
                        <div key={`${c.tipo}-${c.id}`} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-800 truncate">{c.descricao}</p>
                            <p className="text-xs text-gray-500">
                              {ROTULO_CANDIDATO[c.tipo]} · {dataCurta(c.data)} · {c.motivo}
                              {Math.abs(c.diferenca_valor) >= 0.01 && ` · diferença ${brl(c.diferenca_valor)}`}
                              {c.diferenca_dias !== 0 && ` · ${Math.abs(c.diferenca_dias)}d`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Selo tom={c.confianca === 'alta' ? 'verde' : 'amarelo'}>{c.confianca}</Selo>
                            <span className="font-semibold tabular-nums text-gray-900">{brl(c.valor)}</span>
                            {c.tipo === 'grupo'
                              ? <span className="text-[11px] text-gray-400 max-w-[90px] leading-tight" title="Soma de vários pagamentos: vincule pelo pedido, um a um">vincule por pedido</span>
                              : <button type="button" onClick={() => vincular(s, c)} disabled={ocupado === s.lancamento.id}
                                className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg bg-[#F7941D] text-white text-xs font-semibold hover:bg-[#E8850A] disabled:opacity-50">
                                <Link2 className="w-3.5 h-3.5" /> Vincular
                              </button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Cartao>

          {res.cartao_agregado.length > 0 && (
            <Cartao titulo="Cartão por dia de liquidação" descricao="Liquidado no extrato × líquido estimado pela tabela. Diferença grande = taxa diferente da cadastrada ou venda sem pagamento registrado.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="text-xs text-gray-500 text-left">
                    <tr>
                      <th className="py-1 font-medium">Dia</th>
                      <th className="py-1 font-medium text-right">Liquidado</th>
                      <th className="py-1 font-medium text-right">Bruto estimado</th>
                      <th className="py-1 font-medium text-right">Líquido estimado</th>
                      <th className="py-1 font-medium text-right">Diferença</th>
                      <th className="py-1 font-medium text-right">Taxa efetiva</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {res.cartao_agregado.map(d => (
                      <tr key={d.data} className="border-t border-gray-100">
                        <td className="py-1.5 text-gray-700">{dataCurta(d.data)} <span className="text-gray-400 text-xs">{d.qtd_linhas} linha(s) · {d.qtd_pagamentos} pgto(s)</span></td>
                        <td className="py-1.5 text-right">{brl(d.liquidado)}</td>
                        <td className="py-1.5 text-right">{brl(d.bruto_estimado)}</td>
                        <td className="py-1.5 text-right">{brl(d.liquido_estimado)}</td>
                        <td className={`py-1.5 text-right ${Math.abs(d.diferenca) > 1 ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>{brl(d.diferenca)}</td>
                        <td className="py-1.5 text-right">{d.taxa_efetiva_pct === null ? '—' : pct(d.taxa_efetiva_pct, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Cartao>
          )}

          <Cartao titulo={`Sem par (${res.sem_par.entradas.length + res.sem_par.saidas.length})`}
            descricao="Linhas do extrato sem nada no sistema. Entrada sem par pode ser venda não registrada; saída sem par, pagamento sem conta cadastrada."
            acao={(res.sem_par.entradas.length + res.sem_par.saidas.length) > 0 && (
              <button type="button" onClick={() => setVerSemPar(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px] px-2">
                {verSemPar ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{verSemPar ? 'ocultar' : 'ver'}
              </button>
            )}>
            {(res.sem_par.entradas.length + res.sem_par.saidas.length) === 0 ? <Vazio>Tudo casou.</Vazio> : verSemPar && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListaLanc titulo={`Entradas (${res.sem_par.entradas.length})`} itens={res.sem_par.entradas} categorias={categorias}
                  ocupado={ocupado} onCategoria={categorizar} onPedido={setVinculandoPedido} />
                <ListaLanc titulo={`Saídas (${res.sem_par.saidas.length})`} itens={res.sem_par.saidas} categorias={categorias}
                  ocupado={ocupado} onCategoria={categorizar} />
              </div>
            )}
          </Cartao>

          <Cartao titulo={`Sistema sem banco (${res.sistema_sem_banco.pagamentos.length + res.sistema_sem_banco.contas_pagas.length + res.sistema_sem_banco.folha.length})`}
            descricao={`Registrado no sistema sem linha no extrato. ${res.totais.legado_ignorados > 0 ? `${res.totais.legado_ignorados} pagamento(s) legado(s) fora.` : ''}`}
            acao={<button type="button" onClick={() => setVerSistema(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px] px-2">
              {verSistema ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{verSistema ? 'ocultar' : 'ver'}
            </button>}>
            {verSistema && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Pagamentos de venda ({res.sistema_sem_banco.pagamentos.length})</p>
                  {res.sistema_sem_banco.pagamentos.length === 0 ? <p className="text-xs text-gray-400">nenhum</p> : (
                    <div className="divide-y divide-gray-100">
                      {res.sistema_sem_banco.pagamentos.map(p => (
                        <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-gray-700">{dataCurta(p.data)} · {p.cliente_nome}{p.codigo ? ` · ${p.codigo}` : ''} · {rotuloMetodo(p.metodo)}{p.metodo === 'credito' ? ` ${p.parcelas}x` : ''}</span>
                          <span className="tabular-nums font-semibold shrink-0">{brl(p.valor)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Contas pagas ({res.sistema_sem_banco.contas_pagas.length})</p>
                  {res.sistema_sem_banco.contas_pagas.length === 0 ? <p className="text-xs text-gray-400">nenhuma</p> : (
                    <div className="divide-y divide-gray-100">
                      {res.sistema_sem_banco.contas_pagas.map(c => (
                        <div key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-gray-700">{dataCurta(c.data)} · {c.descricao}{c.fornecedor_nome ? ` · ${c.fornecedor_nome}` : ''}</span>
                          <span className="tabular-nums font-semibold shrink-0">{brl(c.valor)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Folha ({res.sistema_sem_banco.folha.length})</p>
                  {res.sistema_sem_banco.folha.length === 0 ? <p className="text-xs text-gray-400">nenhuma</p> : (
                    <div className="divide-y divide-gray-100">
                      {res.sistema_sem_banco.folha.map(f => (
                        <div key={f.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-gray-700">{dataCurta(f.data)} · {f.tipo === 'vale' ? 'Vale' : 'Salário'} · {f.nome}</span>
                          <span className="tabular-nums font-semibold shrink-0">{brl(f.valor)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Cartao>

          <p className="text-[11px] text-gray-400">Período {dataBR(res.de)} a {dataBR(res.ate)}.</p>
        </>
      )}

      {vinculandoPedido && (
        <ModalVincularPedido linha={vinculandoPedido} onFechar={() => setVinculandoPedido(null)}
          onFeito={r => {
            setVinculandoPedido(null);
            const oque = r.acao === 'vinculado' ? 'vinculada ao pagamento' : r.acao === 'dividido' ? 'vinculada (pagamento dividido)' : 'vinculada (pagamento registrado)';
            setAviso(`Linha ${oque} do pedido ${r.pedido.codigo ?? ''}. Saldo do pedido: ${brl(r.pedido.saldo)}.`);
            carregar();
          }} />
      )}
    </div>
  );
}

function Lanc({ l }: { l: LancamentoResumo }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{l.contraparte || l.descricao}</p>
        <p className="text-xs text-gray-500 truncate">{dataCurta(l.data)} · {l.descricao}{l.documento ? ` · doc ${l.documento}` : ''}{l.categoria_nome ? ` · ${l.categoria_nome}` : ''}</p>
      </div>
      <span className={`font-bold tabular-nums shrink-0 ${l.valor < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{brl(l.valor)}</span>
    </div>
  );
}

function ListaLanc({ titulo, itens, categorias, ocupado, onCategoria, onPedido }: {
  titulo: string; itens: LancamentoResumo[]; categorias: Categoria[]; ocupado: string | null;
  onCategoria: (l: LancamentoResumo, categoriaId: string) => void; onPedido?: (l: LancamentoResumo) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 mb-1">{titulo}</p>
      {itens.length === 0 ? <p className="text-xs text-gray-400">nenhuma</p> : (
        <div className="divide-y divide-gray-100">
          {itens.map(l => (
            <div key={l.id} className="py-2 space-y-1.5">
              <Lanc l={l} />
              <div className="flex flex-wrap items-center gap-2">
                {onPedido && l.valor > 0 && (
                  <BotaoSecundario onClick={() => onPedido(l)} disabled={ocupado === l.id}><Link2 className="w-4 h-4" /> Vincular a pedido</BotaoSecundario>
                )}
                <select value={l.categoria_id ?? ''} onChange={e => onCategoria(l, e.target.value)} disabled={ocupado === l.id}
                  aria-label={`Categoria de ${l.contraparte || l.descricao}`} className={`${INPUT} flex-1 min-w-[180px] min-h-[40px] text-xs`}>
                  <option value="">{l.categoria_id ? '— tirar categoria —' : 'Categorizar…'}</option>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- vincular a pedido

function ModalVincularPedido({ linha, onFechar, onFeito }: {
  linha: LancamentoResumo; onFechar: () => void; onFeito: (r: ResultadoVinculoPedido) => void;
}) {
  const [termo, setTermo] = useState(linha.contraparte?.split(' ').slice(0, 2).join(' ') ?? '');
  const [pedidos, setPedidos] = useState<PedidoParaVincular[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const valor = linha.valor;

  const buscar = useCallback(async (t: string) => {
    if (t.trim().length < 2) { setPedidos(null); return; }
    setBuscando(true);
    setErro(null);
    try {
      const r = await apiFinanceiro<{ pedidos: PedidoParaVincular[] }>(`/api/financeiro/conciliar?buscar_pedido=${encodeURIComponent(t.trim())}&valor=${valor}`);
      setPedidos(r.pedidos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      setBuscando(false);
    }
  }, [valor]);

  useEffect(() => {
    const h = setTimeout(() => buscar(termo), 350);
    return () => clearTimeout(h);
  }, [termo, buscar]);

  const plano = (p: PedidoParaVincular): { texto: string; ok: boolean } => {
    const exato = p.pagamentos_livres.find(x => Math.abs(x.valor - valor) <= 0.01);
    if (exato) return { texto: `Vincula ao pagamento de ${brl(exato.valor)} (${rotuloMetodo(exato.metodo)} ${dataCurta(exato.data)})`, ok: true };
    const maior = p.pagamentos_livres.filter(x => x.valor > valor + 0.01 && x.metodo !== 'dinheiro').sort((a, b) => a.valor - b.valor)[0];
    if (maior) return { texto: `Divide o pagamento de ${brl(maior.valor)}: ${brl(valor)} fica com esta linha e ${brl(maior.valor - valor)} continua aguardando`, ok: true };
    if (p.saldo >= valor - 0.01) return { texto: `Registra um pagamento de ${brl(valor)} no pedido (saldo ${brl(p.saldo)})`, ok: true };
    return { texto: `Saldo ${brl(p.saldo)} não comporta ${brl(valor)}`, ok: false };
  };

  const vincular = async (p: PedidoParaVincular) => {
    setSalvando(p.id);
    setErro(null);
    try {
      const r = await apiFinanceiro<ResultadoVinculoPedido>('/api/financeiro/conciliar', {
        method: 'POST', body: JSON.stringify({ acao: 'vincular_pedido', lancamento_id: linha.id, orcamento_id: p.id }),
      });
      onFeito(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao vincular');
    } finally {
      setSalvando(null);
    }
  };

  return (
    <Modal titulo="Vincular a pedido" onFechar={onFechar} largura="md" rodape={<BotaoSecundario onClick={onFechar}>Fechar</BotaoSecundario>}>
      <div className="bg-gray-50 rounded-lg px-3 py-2"><Lanc l={linha} /></div>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input value={termo} onChange={e => setTermo(e.target.value)} autoFocus placeholder="Cliente, código do pedido ou valor"
          aria-label="Buscar pedido" className={`${INPUT} pl-9 min-h-[44px]`} />
      </div>
      <p className="text-[11px] text-gray-500">Vários Pix do mesmo pedido: vincule um por um. Se o pedido tem um pagamento único maior, ele é dividido; o total recebido não muda.</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {buscando && <p className="text-xs text-gray-400">Buscando…</p>}
      {pedidos && !buscando && (pedidos.length === 0 ? <Vazio>Nenhum pedido encontrado.</Vazio> : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {pedidos.map(p => {
            const pl = plano(p);
            return (
              <li key={p.id} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 break-words">{p.cliente}</p>
                    <p className="text-[11px] text-gray-500">{p.codigo ?? '—'} · {dataCurta(p.criado_em)} · total {brl(p.total)} · pago {brl(p.valor_pago)}</p>
                  </div>
                  <p className={`text-sm font-semibold tabular-nums shrink-0 ${p.saldo > 0.009 ? 'text-amber-700' : 'text-emerald-700'}`}>{p.saldo > 0.009 ? `falta ${brl(p.saldo)}` : 'pago'}</p>
                </div>
                <p className={`text-[11px] ${pl.ok ? 'text-gray-600' : 'text-red-700'}`}>{pl.texto}</p>
                <BotaoPrimario onClick={() => vincular(p)} disabled={!pl.ok || !!salvando} carregando={salvando === p.id}><Link2 className="w-4 h-4" /> Vincular</BotaoPrimario>
              </li>
            );
          })}
        </ul>
      ))}
    </Modal>
  );
}
