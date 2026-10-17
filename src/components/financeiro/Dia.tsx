'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Lock } from 'lucide-react';
import type { DiaFinanceiro, ItemPagoDia } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataBR, dataCurta, hojeBRT, rotuloMetodo } from '@/lib/financeiro/formato';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, Carregando, Cartao, Erro, Estatistica, INPUT, LinhaValor,
  Modal, Selo, SeletorData, Vazio,
} from './Comuns';
import { CartaoContaPagar, ModalContaForm, ModalPagarConta } from './ContasPagar';
import VendasDia from './VendasDia';

// O dia em uma tela: vendeu, recebeu (bruto -> liquido), pagou, sobrou.
// Substitui o antigo FechamentoDia. "Lancar pagamento" e o unico formulario:
// dinheiro vira saida de caixa, cartao vira fatura, banco e conciliado pelo
// extrato depois.

const ROTULO_TIPO: Record<ItemPagoDia['tipo'], { rotulo: string; tom: 'cinza' | 'azul' | 'roxo' | 'verde' | 'laranja' | 'amarelo' }> = {
  conta_pagar: { rotulo: 'conta', tom: 'azul' },
  folha: { rotulo: 'folha', tom: 'roxo' },
  vale: { rotulo: 'vale', tom: 'roxo' },
  caixa: { rotulo: 'caixa', tom: 'verde' },
  extrato: { rotulo: 'extrato', tom: 'cinza' },
  cartao: { rotulo: 'cartão · sai na fatura', tom: 'laranja' },
};

export default function Dia() {
  const [data, setData] = useState(hojeBRT());
  const [dados, setDados] = useState<DiaFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [lancando, setLancando] = useState(false);
  const [pagando, setPagando] = useState<DiaFinanceiro['a_pagar_hoje'][number] | null>(null);
  const [fechando, setFechando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [versaoVendas, setVersaoVendas] = useState(0);
  // Da pra navegar pro futuro pra ver contas a vencer, mas nao pra pagar la.
  const futuro = data > hojeBRT();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setVersaoVendas(v => v + 1);
    try {
      setDados(await apiFinanceiro<DiaFinanceiro>(`/api/financeiro/dia-gestao?data=${data}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o dia');
    } finally {
      setCarregando(false);
    }
  }, [data]);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await apiFinanceiro<{ novos: number; valor: number; ja_estavam: number }>('/api/financeiro/caixa', {
        method: 'POST', body: JSON.stringify({ acao: 'sincronizar', de: data, ate: data }),
      });
      setAviso({ tom: 'ok', texto: `${r.novos} venda(s) em dinheiro lançada(s) no caixa (${brl(r.valor)}); ${r.ja_estavam} já estavam.` });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao sincronizar' });
    } finally {
      setOcupado(false);
    }
  };

  const apagarSaida = async (id: string, descricao: string) => {
    if (!window.confirm(`Apagar a saída "${descricao}" do caixa?`)) return;
    try {
      await apiFinanceiro(`/api/financeiro/caixa?id=${id}`, { method: 'DELETE' });
      await carregar();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Erro ao apagar' });
    }
  };

  if (carregando && !dados) return <Carregando texto="Carregando o dia…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const rl = dados.recebido_liquido;
  const taxasTotal = rl.taxas + rl.antecipacao + rl.tarifa_pix_stone;
  const parcial = dados.liquido_dia_status === 'parcial';
  const semExtrato = Object.entries(dados.extrato_ate).filter(([, ate]) => !ate || ate < data).map(([nome, ate]) => `${nome}${ate ? ` (até ${dataCurta(ate)})` : ' (nunca)'}`);
  const metodos = Object.entries(rl.por_metodo).sort((a, b) => b[1].bruto - a[1].bruto);
  const caixa = dados.caixa;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-gray-800">Dia</h2>
          <SeletorData value={data} onChange={setData} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={carregar} aria-label="Atualizar" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-500 hover:text-gray-800">
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
          <BotaoPrimario onClick={() => setLancando(true)} disabled={futuro} title={futuro ? 'Não dá para lançar pagamento em data futura' : undefined}><Plus className="w-4 h-4" /> Lançar pagamento</BotaoPrimario>
        </div>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom={aviso.tom}>{aviso.texto} <button type="button" onClick={() => setAviso(null)} className="ml-2 text-xs underline">fechar</button></Aviso>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Estatistica rotulo="Vendeu" valor={brl(dados.sistema.vendas_do_dia)} detalhe={`${dados.sistema.qtd_pedidos} pedido(s) criado(s)`} />
        <Estatistica rotulo="Recebido bruto" valor={brl(rl.bruto)} detalhe={`${Object.values(rl.por_metodo).reduce((a, m) => a + m.qtd, 0)} pagamento(s)`} />
        <Estatistica rotulo="Taxas da maquininha" valor={brl(-taxasTotal)} tom={taxasTotal > 0 ? 'vermelho' : 'neutro'}
          detalhe={`MDR ${brl(rl.taxas)} · antecipação ${brl(rl.antecipacao)} · tarifa Pix ${brl(rl.tarifa_pix_stone)}`}
          selo={rl.sem_tabela ? <Selo tom="amarelo" titulo="Cadastre as taxas da Stone em Maquininha">sem tabela</Selo> : rl.tarifa_pix_estimada ? <Selo tom="amarelo">estimado</Selo> : <Selo tom="cinza">estimado</Selo>} />
        <Estatistica rotulo="Recebido líquido" valor={brl(rl.liquido)} tom="verde"
          detalhe={rl.reembolso_previsto > 0 ? `reembolso previsto ${brl(rl.reembolso_previsto)} (a confirmar)` : undefined} />
        <Estatistica rotulo="Pago no dia" valor={brl(-dados.pago.total)} tom={dados.pago.total > 0 ? 'vermelho' : 'neutro'}
          detalhe={dados.pago_no_cartao.total > 0 ? `+ ${brl(dados.pago_no_cartao.total)} no cartão (sai na fatura)` : `${dados.pago.itens.length} item(ns)`} />
        <Estatistica rotulo="Líquido do dia" valor={brl(dados.liquido_dia)} tom={dados.liquido_dia < 0 ? 'vermelho' : 'verde'}
          selo={parcial
            ? <Selo tom="amarelo" titulo={semExtrato.length ? `Sem extrato do dia: ${semExtrato.join(', ')}` : 'Falta extrato do dia'}>parcial</Selo>
            : <Selo tom="verde">completo</Selo>}
          detalhe={parcial && semExtrato.length > 0 ? `sem extrato: ${semExtrato.join(', ')}` : 'recebido líquido − pago no dia'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Cartao titulo="Recebido por método" descricao="Bruto → líquido depois da taxa prevista na tabela vigente.">
          {metodos.length === 0 ? <Vazio>Nenhum recebimento no dia.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 text-left">
                  <tr><th className="py-1 font-medium">Método</th><th className="py-1 font-medium text-right">Qtd</th><th className="py-1 font-medium text-right">Bruto</th><th className="py-1 font-medium text-right">Líquido</th></tr>
                </thead>
                <tbody className="tabular-nums">
                  {metodos.map(([m, v]) => (
                    <tr key={m} className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-700">{rotuloMetodo(m)}</td>
                      <td className="py-1.5 text-right text-gray-500">{v.qtd}</td>
                      <td className="py-1.5 text-right">{brl(v.bruto)}</td>
                      <td className="py-1.5 text-right font-semibold">{brl(v.liquido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>

        <Cartao titulo="Conferência banco × sistema" descricao={dados.conferencia.nota}>
          <LinhaValor rotulo="Recebido no sistema" valor={brl(dados.conferencia.recebido_no_sistema)} />
          <LinhaValor rotulo="Entrou em banco (sem transferências próprias)" valor={brl(dados.conferencia.entrou_em_banco)} />
          <div className="mt-2 divide-y divide-gray-100">
            {dados.contas.map(c => (
              <div key={c.nome} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="text-gray-700">{c.nome}</span>
                <span className="tabular-nums"><span className="text-emerald-700">+{brl(c.entrou)}</span> <span className="text-red-700">{brl(c.saiu)}</span></span>
              </div>
            ))}
            {dados.contas.length === 0 && <p className="text-xs text-gray-400 py-1.5">Nenhum movimento nas contas neste dia.</p>}
          </div>
        </Cartao>
      </div>

      <VendasDia data={data} versao={versaoVendas} />

      {/* A pagar hoje */}
      <Cartao titulo="A pagar hoje" descricao="Contas vencendo até hoje (as atrasadas também). Toque em Paguei.">
        {dados.a_pagar_hoje.length === 0 && dados.folha_hoje.length === 0 ? <Vazio>Nada vencendo até hoje.</Vazio> : (
          <div className="space-y-2">
            {dados.a_pagar_hoje.map(c => <CartaoContaPagar key={c.id} c={c} onPagar={() => setPagando(c)} />)}
            {dados.folha_hoje.map(f => (
              <div key={`${f.funcionario_id}-${f.periodo_fim}`} className="flex items-center justify-between gap-3 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">Folha · {f.nome}</p>
                  <p className="text-xs text-gray-500">{dataCurta(f.periodo_inicio)}–{dataCurta(f.periodo_fim)} · pague em Funcionários</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold tabular-nums text-gray-900">{brl(f.liquido)}</p>
                  <Selo tom="roxo">folha</Selo>
                </div>
              </div>
            ))}
          </div>
        )}
      </Cartao>

      {/* Pago hoje */}
      <Cartao titulo={`Pago em ${dataBR(data)}`} descricao="Tudo que saiu, de qualquer fonte, uma vez só.">
        {dados.pago.itens.length === 0 && dados.pago_no_cartao.itens.length === 0 ? <Vazio>Nenhum pagamento registrado no dia.</Vazio> : (
          <div className="divide-y divide-gray-100">
            {[...dados.pago.itens, ...dados.pago_no_cartao.itens].map(i => {
              const t = ROTULO_TIPO[i.tipo];
              return (
                <div key={`${i.tipo}-${i.id}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{i.descricao}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[i.fornecedor, i.categoria, i.metodo ? rotuloMetodo(i.metodo) : null, i.conta_nome].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums text-gray-900">{brl(i.valor)}</p>
                    <Selo tom={t.tom}>{t.rotulo}</Selo>
                  </div>
                </div>
              );
            })}
            <LinhaValor destaque rotulo="Total pago (sem cartão)" valor={brl(dados.pago.total)} />
            {dados.pago_no_cartao.total > 0 && <LinhaValor rotulo="Pago no cartão (sai na fatura)" valor={brl(dados.pago_no_cartao.total)} tom="cinza" />}
          </div>
        )}
      </Cartao>

      {/* Caixa em especie */}
      <Cartao titulo="Caixa em espécie" selo={caixa.fechamento ? <Selo tom="verde">fechado</Selo> : undefined}
        acao={<>
          {caixa.falta_sincronizar > 0.009 && (
            <BotaoSecundario onClick={sincronizar} carregando={ocupado} className="min-h-[40px]">Sincronizar vendas em dinheiro</BotaoSecundario>
          )}
          <BotaoSecundario onClick={() => setFechando(true)} disabled={futuro} title={futuro ? 'Não dá para fechar o caixa de um dia que ainda não chegou' : undefined} className="min-h-[40px]"><Lock className="w-4 h-4" /> {caixa.fechamento ? 'Refazer fechamento' : 'Fechar caixa'}</BotaoSecundario>
        </>}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Estatistica rotulo="Entrou (dinheiro)" valor={brl(caixa.entrou_no_dia)} tom="verde" className="shadow-none" />
          <Estatistica rotulo="Saiu" valor={brl(caixa.total_saidas)} tom={caixa.total_saidas < 0 ? 'vermelho' : 'neutro'} className="shadow-none" />
          <Estatistica rotulo="Saldo esperado" valor={brl(caixa.saldo_esperado)} className="shadow-none"
            selo={caixa.falta_sincronizar > 0.009 ? <Selo tom="amarelo" titulo="Venda em dinheiro ainda não lançada no caixa">parcial</Selo> : undefined}
            detalhe={caixa.falta_sincronizar > 0.009 ? `faltam ${brl(caixa.falta_sincronizar)} de vendas em dinheiro` : undefined} />
        </div>
        {caixa.fechamento && (
          <Aviso tom={Math.abs(caixa.fechamento.diferenca) < 0.01 ? 'ok' : 'alerta'} className="mb-3">
            Contado {brl(caixa.fechamento.saldo_contado)} × esperado {brl(caixa.fechamento.saldo_esperado)} — diferença {brl(caixa.fechamento.diferenca)}.
          </Aviso>
        )}
        <p className="text-xs font-medium text-gray-600 mb-1">Saídas do caixa</p>
        {caixa.saidas.length === 0 ? <p className="text-sm text-gray-400">Nenhuma saída em dinheiro no dia.</p> : (
          <div className="divide-y divide-gray-100">
            {caixa.saidas.map((s, i) => (
              <div key={s.id ?? `${s.descricao}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{s.descricao}</p>
                  <p className="text-xs text-gray-500 truncate">{[s.contraparte, s.categoria].filter(Boolean).join(' · ') || 'sem categoria'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.vinculo && <Selo tom="verde" titulo="Já aparece em Pago no dia como conta/folha">já contado</Selo>}
                  <span className="font-semibold tabular-nums text-red-700">{brl(s.valor)}</span>
                  {s.id && s.origem === 'manual' && !s.vinculo && (
                    <button type="button" onClick={() => apagarSaida(s.id!, s.descricao)} aria-label="Apagar saída"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Cartao>

      {lancando && <ModalContaForm conta={null} modo="lancar" dataPadrao={data} onFechar={() => setLancando(false)} onSalvo={() => { setLancando(false); carregar(); }} />}
      {pagando && <ModalPagarConta conta={pagando} onFechar={() => setPagando(null)} onSalvo={() => { setPagando(null); carregar(); }} />}
      {fechando && <ModalFecharCaixa data={data} esperado={caixa.saldo_esperado} onFechar={() => setFechando(false)} onSalvo={() => { setFechando(false); carregar(); }} />}
    </div>
  );
}

function ModalFecharCaixa({ data, esperado: esperadoInicial, onFechar, onSalvo }: { data: string; esperado: number; onFechar: () => void; onSalvo: () => void }) {
  // O servidor calcula o esperado SEM o ajuste do proprio dia (refechar
  // recalcula a diferenca inteira). O saldo do Dia inclui esse ajuste, entao
  // num 'Refazer fechamento' buscamos a mesma base que o 'fechar' vai usar.
  const [esperado, setEsperado] = useState(esperadoInicial);
  const [contado, setContado] = useState<number | null>(esperadoInicial);
  useEffect(() => {
    let vivo = true;
    apiFinanceiro<{ saldo_sem_ajuste_do_dia?: number }>(`/api/financeiro/caixa?de=${data}&ate=${data}`)
      .then(r => {
        if (!vivo || typeof r.saldo_sem_ajuste_do_dia !== 'number') return;
        setEsperado(r.saldo_sem_ajuste_do_dia);
        setContado(c => (c === esperadoInicial ? r.saldo_sem_ajuste_do_dia! : c));
      })
      .catch(() => { /* fica com o valor da tela */ });
    return () => { vivo = false; };
  }, [data, esperadoInicial]);
  const [obs, setObs] = useState('');
  const [ajustar, setAjustar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const diferenca = (contado ?? 0) - esperado;

  const salvar = async () => {
    if (contado === null) { setErro('Informe o valor contado.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/caixa', {
        method: 'POST', body: JSON.stringify({ acao: 'fechar', data, saldo_contado: contado, observacoes: obs.trim() || null, ajustar }),
      });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao fechar o caixa');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo={`Fechar caixa · ${dataBR(data)}`} onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Fechar caixa</BotaoPrimario>
      </>}>
      <p className="text-xs text-gray-500">Saldo esperado pelos lançamentos: <strong>{brl(esperado)}</strong>{esperado !== esperadoInicial ? ' (sem o ajuste do fechamento anterior)' : ''}.</p>
      <Campo rotulo="Dinheiro contado na gaveta">
        <CampoMoeda value={contado} onChange={setContado} autoFocus />
      </Campo>
      {Math.abs(diferenca) >= 0.01 && (
        <Aviso tom="alerta">
          Diferença de {brl(diferenca)} ({diferenca > 0 ? 'sobra' : 'falta'}).
          <label className="flex items-center gap-2 mt-2 min-h-[40px] cursor-pointer select-none">
            <input type="checkbox" checked={ajustar} onChange={e => setAjustar(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" />
            Ajustar o caixa pela contagem (lança a diferença como “Caixa - diferença de conta”)
          </label>
        </Aviso>
      )}
      <Campo rotulo="Observações">
        <input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} placeholder="ex.: troco emprestado" />
      </Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
