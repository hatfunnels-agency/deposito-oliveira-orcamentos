'use client';

import { useEffect, useMemo, useState } from 'react';
import type { VendasDoDia } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, horaBRT, rotuloMetodo } from '@/lib/financeiro/formato';
import { Abas, Cartao, Erro, INPUT, Selo, Vazio } from './Comuns';

// Lista do dia para conciliar na mao: os pedidos fechados no dia e os
// pagamentos registrados no dia (com a linha do extrato que ja casou, ou
// "sem extrato"). Fica dentro da aba Dia.

const STATUS: Record<string, string> = {
  pagamento_pendente: 'Pgto. pendente', pagamento_ok: 'Pgto. OK', separacao: 'Separação', entrega_pendente: 'Entrega pendente',
  entrega_parcial: 'Entrega parcial', em_rota: 'Em rota', completo: 'Completo', ocorrencia: 'Ocorrência', retirada_pendente: 'Retirada pendente',
};

type Vista = 'vendas' | 'recebimentos';
type FiltroRec = 'todos' | 'sem_extrato';

export default function VendasDia({ data, versao }: { data: string; versao: number }) {
  const [dados, setDados] = useState<VendasDoDia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('vendas');
  const [filtroRec, setFiltroRec] = useState<FiltroRec>('todos');
  const [metodo, setMetodo] = useState('');
  const [busca, setBusca] = useState('');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    apiFinanceiro<VendasDoDia>(`/api/financeiro/dia/vendas?data=${data}`)
      .then(r => { if (vivo) setDados(r); })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Erro ao carregar as vendas do dia'); });
    return () => { vivo = false; };
  }, [data, versao, tentativa]);

  const termo = busca.trim().toLowerCase();
  const casa = (...campos: Array<string | null>) => !termo || campos.some(c => c?.toLowerCase().includes(termo));
  const metodos = useMemo(() => Object.keys(dados?.totais.por_metodo ?? {}).sort(), [dados]);

  if (erro) return <Erro mensagem={erro} onTentar={() => setTentativa(t => t + 1)} />;
  const atual = dados && dados.data === data ? dados : null;

  const vendas = (atual?.vendas ?? []).filter(v =>
    casa(v.codigo, v.cliente, v.telefone, String(v.total)) &&
    (!metodo || v.forma_pagamento === metodo || v.metodos_pagos.includes(metodo)));
  const recebimentos = (atual?.recebimentos ?? []).filter(r =>
    casa(r.codigo, r.cliente, String(r.valor)) && (!metodo || r.metodo === metodo) && (filtroRec === 'todos' || !r.extrato));
  const somaRec = recebimentos.reduce((a, r) => a + r.valor, 0);
  const t = atual?.totais;

  return (
    <Cartao titulo="Vendas do dia" descricao="Para conferir na mão: cada pedido e cada pagamento, com o que já casou com o extrato.">
      {!t ? <p className="text-sm text-gray-400">Carregando…</p> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
            <Mini rotulo="Pedidos" valor={`${t.pedidos} · ${brl(t.faturamento)}`} />
            <Mini rotulo="Em aberto nos pedidos" valor={brl(t.em_aberto)} />
            <Mini rotulo="Recebido no dia" valor={brl(t.recebido)} />
            <Mini rotulo="Casado com extrato" valor={`${brl(t.recebido_conciliado)}`} tom={t.recebido_conciliado + 0.01 < t.recebido ? 'amarelo' : 'verde'} />
          </div>
          {metodos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {metodos.map(m => {
                const x = t.por_metodo[m];
                return (
                  <Selo key={m} tom={x.conciliado + 0.01 >= x.valor ? 'verde' : 'cinza'} titulo={`${x.qtd} pagamento(s); casado com extrato: ${brl(x.conciliado)}`}>
                    {rotuloMetodo(m)} {brl(x.valor)}
                  </Selo>
                );
              })}
            </div>
          )}

          <Abas valor={vista} onChange={setVista} opcoes={[
            { key: 'vendas', rotulo: 'Pedidos do dia', contagem: t.pedidos },
            { key: 'recebimentos', rotulo: 'Pagamentos recebidos', contagem: atual!.recebimentos.length },
          ]} />
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar código, cliente ou valor" aria-label="Buscar"
              className={`${INPUT} flex-1 min-h-[44px]`} />
            <select value={metodo} onChange={e => setMetodo(e.target.value)} aria-label="Método" className={`${INPUT} sm:w-48 min-h-[44px]`}>
              <option value="">Todos os métodos</option>
              {metodos.map(m => <option key={m} value={m}>{rotuloMetodo(m)}</option>)}
            </select>
            {vista === 'recebimentos' && (
              <select value={filtroRec} onChange={e => setFiltroRec(e.target.value as FiltroRec)} aria-label="Extrato" className={`${INPUT} sm:w-48 min-h-[44px]`}>
                <option value="todos">Com e sem extrato</option>
                <option value="sem_extrato">Só sem extrato</option>
              </select>
            )}
          </div>

          {vista === 'vendas' ? (
            vendas.length === 0 ? <Vazio className="mt-3">Nenhum pedido com esse filtro.</Vazio> : (
              <ul className="mt-3 divide-y divide-gray-100">
                {vendas.map(v => (
                  <li key={v.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 break-words">
                        <span className="text-gray-500 tabular-nums">{horaBRT(v.hora)}</span> · {v.cliente}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {v.codigo ?? '—'} · {STATUS[v.status] ?? v.status}
                        {v.forma_pagamento && <> · {rotuloMetodo(v.forma_pagamento)}</>}
                        {v.condicao_pagamento && v.condicao_pagamento !== 'a_vista' && <> · {v.condicao_pagamento.replace(/_/g, ' ')}</>}
                        {v.tipo_entrega && <> · {v.tipo_entrega}</>}
                      </p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="font-semibold text-gray-900">{brl(v.total)}</p>
                      {v.saldo > 0.009
                        ? <p className="text-[11px] text-amber-700">falta {brl(v.saldo)}</p>
                        : <p className="text-[11px] text-emerald-700">pago</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            recebimentos.length === 0 ? <Vazio className="mt-3">Nenhum pagamento com esse filtro.</Vazio> : (
              <>
                <ul className="mt-3 divide-y divide-gray-100">
                  {recebimentos.map(r => (
                    <li key={r.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 break-words">
                          <span className="text-gray-500 tabular-nums">{horaBRT(r.hora)}</span> · {r.cliente}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {r.codigo ?? 'sem pedido'} · {rotuloMetodo(r.metodo)}{r.parcelas && r.parcelas > 1 ? ` ${r.parcelas}x` : ''}
                          {r.pedido_de_outro_dia && <> · pedido de outro dia</>}
                          {r.observacoes && <> · {r.observacoes}</>}
                        </p>
                        {r.extrato
                          ? <p className="text-[11px] text-emerald-700 break-words">✓ {r.extrato.conta ?? 'extrato'} {r.extrato.data.split('-').reverse().slice(0, 2).join('/')} · {brl(r.extrato.valor)}{r.extrato.tarifa > 0 ? ` (taxa ${brl(r.extrato.tarifa)})` : ''}</p>
                          : <p className="text-[11px] text-amber-700">sem extrato vinculado</p>}
                      </div>
                      <p className="font-semibold text-gray-900 tabular-nums shrink-0">{brl(r.valor)}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-600 text-right mt-2 tabular-nums">Soma da lista: <b>{brl(somaRec)}</b></p>
              </>
            )
          )}
        </>
      )}
    </Cartao>
  );
}

function Mini({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: 'verde' | 'amarelo' }) {
  const cor = tom === 'verde' ? 'text-emerald-700' : tom === 'amarelo' ? 'text-amber-700' : 'text-gray-800';
  return (
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 min-w-0">
      <p className="text-[10px] text-gray-500 truncate">{rotulo}</p>
      <p className={`font-medium tabular-nums truncate ${cor}`}>{valor}</p>
    </div>
  );
}
