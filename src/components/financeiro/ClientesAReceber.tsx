'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, MessageCircle, Search, HandCoins, ExternalLink } from 'lucide-react';
import type {
  ClienteAReceber, ContaAberta, Metodo, PagamentoCriado, ReceberDoCliente, ReceberPorCliente,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataBR, hojeBRT, METODOS, rotuloMetodo } from '@/lib/financeiro/formato';
import { linkWhatsApp, telefoneBonito } from '@/components/Kanban';
import {
  Abas, Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, Carregando, Erro, Estatistica,
  INPUT, Modal, Selo, SeletorParcelas, Vazio,
} from './Comuns';

// Clientes com saldo em aberto, agrupados. E a unica secao que a atendente
// ve — tanto na aba Financeiro do app principal quanto em /financeiro — por
// isso o componente nao depende do ContextoFinanceiroProvider.

type Filtro = 'todos' | 'vencidos' | 'entregues';
const DIAS = 90;

// Mesmo texto da cobranca do FinanceiroTab, com o total do cliente.
function textoCobranca(c: ClienteAReceber): string {
  const codigos = c.pedidos.map(p => p.codigo).filter((x): x is string => !!x);
  const ref = codigos.length === 1 ? `do pedido ${codigos[0]}`
    : codigos.length > 1 ? `dos pedidos ${codigos.join(', ')}` : 'dos seus pedidos';
  return `Olá ${c.nome}, tudo bem? Passando pra lembrar do saldo em aberto ${ref}: ${brl(c.saldo_total)}. Qualquer dúvida é só chamar!`;
}

export default function ClientesAReceber({ papel, onAbrirPedido }: {
  papel: 'admin' | 'atendente';
  onAbrirPedido?: (id: string) => void;
}) {
  const [dados, setDados] = useState<ReceberPorCliente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [aberto, setAberto] = useState<string | null>(null);
  const [recebendo, setRecebendo] = useState<{ cliente: ClienteAReceber; pedido: ContaAberta | null } | null>(null);
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<ReceberPorCliente>(`/api/financeiro/receber?dias=${DIAS}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os clientes a receber');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    if (!dados) return [];
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    return dados.clientes.filter(c => {
      if (filtro === 'vencidos' && !c.tem_vencido) return false;
      if (filtro === 'entregues' && !c.tem_entregue_nao_pago) return false;
      if (!q) return true;
      if (c.nome.toLowerCase().includes(q)) return true;
      if (digitos && c.telefone && c.telefone.replace(/\D/g, '').includes(digitos)) return true;
      return c.pedidos.some(p => (p.codigo ?? '').toLowerCase().includes(q));
    });
  }, [dados, busca, filtro]);

  const abrirPedido = (p: ContaAberta) => {
    if (onAbrirPedido) onAbrirPedido(p.id);
    else setAvisoPedido(p.codigo ?? p.id);
  };

  if (carregando && !dados) return <Carregando texto="Carregando clientes a receber…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const { resumo } = dados;
  const qtdVencidos = dados.clientes.filter(c => c.tem_vencido).length;
  const qtdEntregues = dados.clientes.filter(c => c.tem_entregue_nao_pago).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">Clientes a receber</h2>
        <button type="button" onClick={carregar} className="text-xs text-[#C96F00] hover:underline min-h-[40px] px-2">
          Atualizar
        </button>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}

      {/* "Recebido no periodo" e metrica gerencial: a atendente ve so o que precisa cobrar. */}
      <div className={`grid grid-cols-2 gap-3 ${papel === 'admin' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <Estatistica rotulo="A receber" valor={brl(resumo.total_a_receber)} tom="azul"
          detalhe={`${resumo.qtd_a_receber} pedido(s) · ${resumo.qtd_clientes} cliente(s)`} />
        <Estatistica rotulo="Vencido" valor={brl(resumo.vencido)} tom={resumo.vencido > 0 ? 'vermelho' : 'neutro'}
          detalhe={`${resumo.qtd_vencidos} pedido(s)`} />
        <Estatistica rotulo="Entregue e não pago" valor={brl(resumo.entregue_nao_pago)} tom={resumo.entregue_nao_pago > 0 ? 'laranja' : 'neutro'}
          detalhe={`${resumo.qtd_entregue_nao_pago} pedido(s)`} />
        {papel === 'admin' && (
          <Estatistica rotulo={`Recebido (${dados.periodo_dias}d)`} valor={brl(resumo.recebido_periodo)} tom="verde"
            detalhe={Object.entries(resumo.recebido_por_metodo).sort((a, b) => b[1] - a[1]).slice(0, 3)
              .map(([m, v]) => `${rotuloMetodo(m)} ${brl(v)}`).join(' · ') || undefined} />
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, telefone ou pedido"
            className={`${INPUT} pl-9 min-h-[44px]`} />
        </div>
        <Abas<Filtro> valor={filtro} onChange={setFiltro} opcoes={[
          { key: 'todos', rotulo: 'Todos', contagem: dados.clientes.length },
          { key: 'vencidos', rotulo: 'Vencidos', contagem: qtdVencidos },
          { key: 'entregues', rotulo: 'Entregues', contagem: qtdEntregues },
        ]} />
      </div>

      {avisoPedido && (
        <Aviso tom="info">
          Pedido <strong>{avisoPedido}</strong>: abra pelo sistema (Histórico) para ver os itens.{' '}
          <Link href="/" className="underline inline-flex items-center gap-1">Ir para o sistema <ExternalLink className="w-3 h-3" /></Link>
          <button type="button" onClick={() => setAvisoPedido(null)} className="ml-3 text-xs underline">fechar</button>
        </Aviso>
      )}

      {lista.length === 0 ? (
        <Vazio>Nenhum cliente com saldo em aberto neste filtro.</Vazio>
      ) : (
        <div className="space-y-2">
          {lista.map(c => {
            const expandido = aberto === c.chave;
            const semIdentidade = !c.cliente_id && !c.telefone;
            return (
              <div key={c.chave} className={`bg-white rounded-xl shadow-sm border p-3 ${c.tem_vencido ? 'border-red-200' : c.tem_entregue_nao_pago ? 'border-orange-200' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setAberto(expandido ? null : c.chave)} className="min-w-0 flex-1 text-left">
                    <p className="font-semibold text-sm text-gray-800 truncate">{c.nome}</p>
                    <p className="text-xs text-gray-500">
                      {c.telefone ? `${telefoneBonito(c.telefone)} · ` : ''}{c.qtd_pedidos} pedido(s)
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.tem_vencido && <Selo tom="vermelho">vencido há {c.maior_atraso_dias}d</Selo>}
                      {c.tem_entregue_nao_pago && <Selo tom="laranja">entregue sem pagamento</Selo>}
                    </div>
                  </button>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-gray-900 tabular-nums">{brl(c.saldo_total)}</p>
                    <p className="text-[10px] text-gray-400">em aberto</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 mt-2">
                  <button type="button" onClick={() => setAberto(expandido ? null : c.chave)}
                    className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-gray-600 hover:text-gray-900 mr-auto">
                    {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {expandido ? 'ocultar pedidos' : 'ver pedidos'}
                  </button>
                  {c.telefone && (
                    <a href={linkWhatsApp(c.telefone, textoCobranca(c))} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                      <MessageCircle className="w-4 h-4" /> Cobrar
                    </a>
                  )}
                  <BotaoPrimario onClick={() => setRecebendo({ cliente: c, pedido: null })} disabled={semIdentidade}
                    title={semIdentidade ? 'Pedido sem cliente: receba pelo pedido' : undefined}>
                    <HandCoins className="w-4 h-4" /> Receber
                  </BotaoPrimario>
                </div>

                {expandido && (
                  <div className="mt-3 border-t border-gray-100 pt-2 space-y-1">
                    {c.pedidos.map(p => (
                      <div key={p.id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${p.vencido ? 'bg-red-50' : p.entregue ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <button type="button" onClick={() => abrirPedido(p)} className="min-w-0 flex-1 text-left group">
                          <p className="text-sm text-gray-800 font-medium group-hover:text-[#C96F00] group-hover:underline">
                            {p.codigo ?? 'sem código'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {p.dias_em_aberto}d em aberto
                            {p.vencimento ? ` · vence ${dataBR(p.vencimento)}` : ''}
                            {p.entregue ? ' · já entregue' : ''}
                            {p.valor_pago > 0 ? ` · pago ${brl(p.valor_pago)} de ${brl(p.total)}` : ''}
                          </p>
                        </button>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">{brl(p.saldo)}</span>
                        <button type="button" onClick={() => setRecebendo({ cliente: c, pedido: p })}
                          className="shrink-0 min-h-[44px] px-3 rounded-lg border border-[#F7941D] text-[#C96F00] text-xs font-semibold hover:bg-orange-50">
                          Receber
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {recebendo && (
        <ModalReceber cliente={recebendo.cliente} pedido={recebendo.pedido} papel={papel}
          onFechar={() => setRecebendo(null)}
          onSalvo={() => { setRecebendo(null); carregar(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- receber

function ModalReceber({ cliente, pedido, papel, onFechar, onSalvo }: {
  cliente: ClienteAReceber; pedido: ContaAberta | null; papel: 'admin' | 'atendente';
  onFechar: () => void; onSalvo: () => void;
}) {
  const saldoAlvo = pedido ? pedido.saldo : cliente.saldo_total;
  const hoje = hojeBRT();
  const [valor, setValor] = useState<number | null>(saldoAlvo);
  const [metodo, setMetodo] = useState<Metodo>('pix');
  const [parcelas, setParcelas] = useState<number | null>(null);
  const [data, setData] = useState(hoje);
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PagamentoCriado[] | null>(null);

  const salvar = async () => {
    if (!valor || valor <= 0) { setErro('Informe o valor recebido.'); return; }
    if (valor > saldoAlvo + 0.009) { setErro(`O valor passa do saldo em aberto (${brl(saldoAlvo)}).`); return; }
    if (metodo === 'credito' && !parcelas) { setErro('Informe o número de parcelas do crédito.'); return; }
    setSalvando(true);
    setErro(null);
    const corpo: ReceberDoCliente = {
      cliente_id: cliente.cliente_id,
      telefone: cliente.telefone,
      orcamento_id: pedido?.id ?? null,
      valor,
      metodo,
      ...(metodo === 'credito' && parcelas ? { parcelas } : {}),
      // Data retroativa e privilegio do admin; a API ignora pra atendente.
      ...(papel === 'admin' && data !== hoje ? { data_pagamento: new Date(`${data}T12:00:00-03:00`).toISOString() } : {}),
      ...(obs.trim() ? { observacoes: obs.trim() } : {}),
    };
    try {
      const r = await apiFinanceiro<{ pagamentos: PagamentoCriado[]; grupo_recebimento: string }>(
        '/api/financeiro/receber', { method: 'POST', body: JSON.stringify(corpo) },
      );
      setResultado(r.pagamentos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar o recebimento');
    } finally {
      setSalvando(false);
    }
  };

  if (resultado) {
    return (
      <Modal titulo="Recebimento registrado" onFechar={onSalvo}
        rodape={<BotaoPrimario onClick={onSalvo}>Fechar</BotaoPrimario>}>
        <p className="text-sm text-gray-700">
          {brl(resultado.reduce((a, p) => a + p.valor, 0))} em {rotuloMetodo(metodo)}
          {metodo === 'credito' && parcelas ? ` (${parcelas}x)` : ''} de <strong>{cliente.nome}</strong>.
        </p>
        <div className="space-y-1">
          {resultado.map(p => (
            <div key={p.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-700">{p.codigo ?? 'pedido'}</span>
              <span className="tabular-nums">
                <strong>{brl(p.valor)}</strong>
                <span className="text-xs text-gray-500"> · resta {brl(p.saldo_restante)}</span>
              </span>
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={pedido ? `Receber · ${pedido.codigo ?? 'pedido'}` : 'Receber do cliente'} onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Confirmar recebimento</BotaoPrimario>
      </>}>
      <p className="text-sm text-gray-700">{cliente.nome}</p>
      <p className="text-xs text-gray-500">
        {pedido
          ? <>Total {brl(pedido.total)} · já pago {brl(pedido.valor_pago)} · <strong>em aberto {brl(pedido.saldo)}</strong></>
          : <>{cliente.qtd_pedidos} pedido(s) · <strong>em aberto {brl(cliente.saldo_total)}</strong>. O valor é distribuído do pedido mais antigo para o mais novo.</>}
      </p>
      <Campo rotulo="Valor recebido">
        <CampoMoeda value={valor} onChange={setValor} autoFocus />
      </Campo>
      <Campo rotulo="Forma">
        <select value={metodo} onChange={e => { setMetodo(e.target.value as Metodo); setParcelas(null); }} className={INPUT}>
          {METODOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
      </Campo>
      {metodo === 'credito' && (
        <Campo rotulo="Parcelas" dica="A taxa da maquininha depende do número de parcelas.">
          <SeletorParcelas metodo={metodo} value={parcelas} onChange={setParcelas} obrigatorio />
        </Campo>
      )}
      {papel === 'admin' && (
        <Campo rotulo="Data do recebimento">
          <input type="date" value={data} max={hoje} onChange={e => e.target.value && setData(e.target.value)} className={INPUT} />
        </Campo>
      )}
      <Campo rotulo="Observação (opcional)">
        <input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} placeholder="ex.: pagou na entrega" />
      </Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
