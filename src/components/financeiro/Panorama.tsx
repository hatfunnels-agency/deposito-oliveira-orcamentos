'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleCheck, Circle, RefreshCw, TriangleAlert, Info } from 'lucide-react';
import type { Alerta, Panorama as PanoramaDados, SaldoConta } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataBR, dataCurta, hojeBRT, pct, rotuloMes } from '@/lib/financeiro/formato';
import { FluxoCaixa30d } from './Graficos';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, Carregando, Cartao, Erro, INPUT, LinhaValor,
  LinkSecao, Modal, Selo,
} from './Comuns';

// Primeira tela do Roger de manha: o cartao "Hoje" diz o que falta fazer e
// os demais resumem cada secao. Numero de fonte parcial sempre vem com selo
// — nunca um valor "limpo" que pareca conferido.

export default function Panorama() {
  const [dados, setDados] = useState<PanoramaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [informando, setInformando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<PanoramaDados>('/api/financeiro/panorama'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o panorama');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando && !dados) return <Carregando texto="Montando o panorama…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const { checklist, a_receber, a_pagar, dia, mes, maquininha_mes } = dados;
  const contasBanco = dados.contas.filter(c => c.tipo === 'banco' || c.tipo === 'adquirente');
  const taxaTabelaPct = maquininha_mes.volume > 0 ? (maquininha_mes.custo_estimado / maquininha_mes.volume) * 100 : null;
  const extratoVelho = checklist.extrato_ate.filter(e => e.dias === null || e.dias > 7);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Panorama</h2>
          <p className="text-xs text-gray-500">{dataBR(dados.hoje)}</p>
        </div>
        <button type="button" onClick={carregar} className="inline-flex items-center gap-1 text-xs text-[#C96F00] hover:underline min-h-[40px] px-2">
          <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}

      {/* Hoje: a rotina de 2 minutos */}
      <Cartao titulo="Hoje" descricao="O que ainda falta na rotina do dia."
        acao={!checklist.saldo_informado_hoje && <BotaoSecundario onClick={() => setInformando(true)}>Informar saldo</BotaoSecundario>}>
        <ul className="space-y-1.5 text-sm">
          <ItemChecklist ok={checklist.saldo_informado_hoje}>
            {checklist.saldo_informado_hoje ? 'Saldo do banco informado hoje' : 'Saldo do banco ainda não informado hoje (ou importe o extrato)'}
          </ItemChecklist>
          <ItemChecklist ok={checklist.contas_hoje.total === 0 || checklist.contas_hoje.pagas >= checklist.contas_hoje.total}>
            <LinkSecao secao="pagar">
              Contas de hoje: {checklist.contas_hoje.pagas} de {checklist.contas_hoje.total} pagas
            </LinkSecao>
          </ItemChecklist>
          {checklist.extrato_ate.map(e => (
            <ItemChecklist key={e.conta} ok={e.dias !== null && e.dias <= 7}>
              <LinkSecao secao="extratos">
                Extrato {e.conta}: {e.data ? `até ${dataCurta(e.data)}${e.dias !== null ? ` (${e.dias} dia${e.dias === 1 ? '' : 's'})` : ''}` : 'nunca importado'}
              </LinkSecao>
            </ItemChecklist>
          ))}
          <ItemChecklist ok={checklist.sugestoes_pendentes === 0}>
            <LinkSecao secao="conciliacao">
              {checklist.sugestoes_pendentes === 0 ? 'Nenhuma sugestão de conciliação pendente' : `${checklist.sugestoes_pendentes} sugestão(ões) de conciliação para confirmar`}
            </LinkSecao>
          </ItemChecklist>
          {checklist.a_confirmar > 0 && (
            <ItemChecklist ok={false}>
              <LinkSecao secao="pagar">{checklist.a_confirmar} conta(s) retroativa(s) aguardando “já pagou?”</LinkSecao>
            </ItemChecklist>
          )}
        </ul>
      </Cartao>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Em conta */}
        <Cartao titulo="Em conta" descricao="Saldo informado ou do extrato + o que o sistema sabe que entrou e saiu desde então."
          acao={<BotaoSecundario onClick={() => setInformando(true)} className="min-h-[40px]">Informar saldo</BotaoSecundario>}>
          <div className="divide-y divide-gray-100">
            {dados.contas.map(c => <LinhaConta key={c.conta_id} c={c} />)}
          </div>
          <LinhaValor destaque rotulo="Total disponível"
            valor={dados.total_disponivel === null ? 'informe os saldos' : brl(dados.total_disponivel)}
            selo={dados.total_disponivel !== null && contasBanco.some(c => (c.defasagem_dias ?? 0) > 0) ? <Selo tom="amarelo">estimado</Selo> : undefined} />
          {dados.fatura_cartao_aberta > 0 && (
            <p className="text-xs text-gray-500 mt-1">Fatura do cartão em aberto: {brl(dados.fatura_cartao_aberta)} (não entra no disponível).</p>
          )}
        </Cartao>

        {/* A receber */}
        <Cartao titulo="A receber" acao={<LinkSecao secao="receber" className="text-xs">ver clientes →</LinkSecao>}>
          <LinhaValor rotulo="Em aberto" valor={brl(a_receber.total)} />
          <LinhaValor rotulo="Vencido" valor={brl(a_receber.vencido)} tom={a_receber.vencido > 0 ? 'vermelho' : undefined} />
          <LinhaValor rotulo="Entregue e não pago" valor={brl(a_receber.entregue_nao_pago)} tom={a_receber.entregue_nao_pago > 0 ? 'vermelho' : undefined} />
          <p className="text-xs text-gray-500 mt-1">{a_receber.qtd} pedido(s) · {a_receber.qtd_clientes} cliente(s)</p>
        </Cartao>

        {/* A pagar */}
        <Cartao titulo="A pagar" acao={<LinkSecao secao="pagar" className="text-xs">ver contas →</LinkSecao>}>
          <LinhaValor rotulo={`Atrasado (${a_pagar.qtd_atrasadas})`} valor={brl(a_pagar.atrasado)} tom={a_pagar.atrasado > 0 ? 'vermelho' : 'cinza'} />
          <LinhaValor rotulo={`Hoje (${a_pagar.qtd_hoje})`} valor={brl(a_pagar.hoje)} />
          <LinhaValor rotulo="Próximos 7 dias" valor={brl(a_pagar.proximos_7d)} />
          <LinhaValor rotulo="Próximos 30 dias" valor={brl(a_pagar.proximos_30d)} />
          {a_pagar.folha_proxima && (
            <LinhaValor rotulo={`Folha em ${dataCurta(a_pagar.folha_proxima.data)}`} valor={brl(a_pagar.folha_proxima.valor)} selo={<Selo tom="cinza">previsto</Selo>} />
          )}
          {a_pagar.a_confirmar > 0 && (
            <p className="text-xs text-amber-800 mt-1">{a_pagar.a_confirmar} conta(s) retroativa(s) a confirmar ficam fora do atrasado.</p>
          )}
        </Cartao>

        {/* Liquido do dia */}
        <Cartao titulo="Líquido do dia" selo={dia.status === 'parcial' ? <Selo tom="amarelo" titulo="Falta extrato de alguma conta no dia">parcial</Selo> : <Selo tom="verde">completo</Selo>}
          acao={<LinkSecao secao="dia" className="text-xs">ver o dia →</LinkSecao>}>
          <LinhaValor rotulo="Recebido bruto" valor={brl(dia.recebido_bruto)} />
          <LinhaValor rotulo="(−) Taxas da maquininha" valor={brl(-dia.taxas)} tom="vermelho" />
          <LinhaValor rotulo="= Recebido líquido" valor={brl(dia.recebido_liquido)} />
          <LinhaValor rotulo="(−) Pago no dia" valor={brl(-dia.pago)} tom="vermelho" />
          <LinhaValor destaque rotulo="= Líquido do dia" valor={brl(dia.liquido_dia)} tom={dia.liquido_dia < 0 ? 'vermelho' : 'verde'} />
        </Cartao>

        {/* Mes */}
        <Cartao titulo={`Mês · ${rotuloMes(mes.mes)}`} acao={<LinkSecao secao="fechamento" className="text-xs">fechamento →</LinkSecao>}>
          <LinhaValor rotulo="Faturamento" valor={brl(mes.faturamento)} />
          <LinhaValor rotulo="Lucro bruto" valor={`${brl(mes.lucro_bruto)}${mes.margem_pct !== null ? ` (${pct(mes.margem_pct)})` : ''}`} />
          <LinhaValor rotulo="Despesas realizadas" valor={brl(-mes.despesas_realizadas)} tom="vermelho" />
          <LinhaValor destaque rotulo="Resultado parcial" valor={brl(mes.resultado_parcial)} tom={mes.resultado_parcial < 0 ? 'vermelho' : 'verde'} selo={<Selo tom="amarelo">parcial</Selo>} />
          <LinhaValor rotulo="Projeção de faturamento" valor={brl(mes.projecao_faturamento)}
            selo={<Selo tom="cinza" titulo={`${mes.dias_uteis_passados} de ${mes.dias_uteis_total} dias úteis`}>ritmo atual</Selo>} />
        </Cartao>

        {/* Maquininha */}
        <Cartao titulo="Maquininha no mês" acao={<LinkSecao secao="maquininha" className="text-xs">detalhes →</LinkSecao>}>
          <LinhaValor rotulo="Volume no cartão" valor={brl(maquininha_mes.volume)} />
          <LinhaValor rotulo="Custo pela tabela" valor={`${brl(maquininha_mes.custo_estimado)}${taxaTabelaPct !== null ? ` (${pct(taxaTabelaPct, 2)})` : ''}`} selo={<Selo tom="cinza">estimado</Selo>} />
          <LinhaValor rotulo="Taxa efetiva real (extrato)"
            valor={maquininha_mes.taxa_efetiva_extrato_pct === null ? 'sem extrato Stone' : pct(maquininha_mes.taxa_efetiva_extrato_pct, 2)}
            tom={maquininha_mes.taxa_efetiva_extrato_pct === null ? 'cinza' : undefined} />
          <LinhaValor rotulo="Reembolso previsto × recebido" valor={`${brl(maquininha_mes.reembolso_previsto)} × ${brl(maquininha_mes.reembolso_recebido)}`} selo={<Selo tom="amarelo">a confirmar</Selo>} />
          <LinhaValor rotulo="Custo líquido previsto" valor={brl(maquininha_mes.custo_liquido_previsto)} />
        </Cartao>
      </div>

      {/* Alertas */}
      <Cartao titulo="Alertas" descricao={dados.alertas.length === 0 ? 'Nada pendente.' : undefined}>
        {dados.alertas.length > 0 && (
          <ul className="space-y-1.5">
            {dados.alertas.map((a, i) => <LinhaAlerta key={`${a.secao}-${i}`} a={a} />)}
          </ul>
        )}
        {extratoVelho.length > 0 && dados.alertas.length === 0 && (
          <Aviso tom="alerta">Extrato de {extratoVelho.map(e => e.conta).join(', ')} com mais de 7 dias: a conciliação e o líquido do dia ficam parciais.</Aviso>
        )}
      </Cartao>

      <Cartao>
        <FluxoCaixa30d dias={dados.fluxo_30d} entradasAtrasadas={dados.entradas_atrasadas} />
      </Cartao>

      {informando && (
        <ModalInformarSaldo contas={contasBanco} onFechar={() => setInformando(false)}
          onSalvo={() => { setInformando(false); carregar(); }} />
      )}
    </div>
  );
}

function ItemChecklist({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CircleCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> : <Circle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />}
      <span className={ok ? 'text-gray-600' : 'text-gray-800'}>{children}</span>
    </li>
  );
}

function LinhaConta({ c }: { c: SaldoConta }) {
  const semBase = c.saldo_estimado === null;
  const defasada = (c.defasagem_dias ?? 0) > 0;
  let detalhe = '';
  if (c.tipo === 'cartao_credito') detalhe = c.fatura_aberta > 0 ? `fatura aberta ${brl(c.fatura_aberta)}` : 'sem compras em aberto';
  else if (c.tipo === 'caixa') detalhe = c.data_base ? `contado ${dataCurta(c.data_base)} + lançamentos` : 'soma dos lançamentos';
  else if (semBase) detalhe = 'nenhum saldo informado';
  else detalhe = `${c.origem === 'extrato' ? 'extrato' : c.origem === 'conector' ? 'banco' : 'informado'} ${dataCurta(c.data_base)}${defasada ? ' · ≈ estimado hoje' : ''}`;
  const ajustes = c.pagos_apos_base + c.folha_apos_base;
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="text-gray-800 truncate">{c.nome}</p>
        <p className="text-[11px] text-gray-500">
          {detalhe}
          {ajustes > 0 && ` · −${brl(ajustes)} pagos sem extrato`}
        </p>
      </div>
      <div className="text-right shrink-0">
        {semBase && c.tipo !== 'cartao_credito'
          ? <span className="text-xs text-amber-700">informe o saldo</span>
          : <span className={`tabular-nums font-semibold ${(c.saldo_estimado ?? 0) < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(c.saldo_estimado ?? 0)}</span>}
        {defasada && !semBase && c.tipo !== 'caixa' && <div><Selo tom="amarelo">estimado</Selo></div>}
      </div>
    </div>
  );
}

function LinhaAlerta({ a }: { a: Alerta }) {
  const cor = a.nivel === 'alto' ? 'bg-red-50 border-red-200 text-red-800' : a.nivel === 'medio' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-700';
  const Icone = a.nivel === 'baixo' ? Info : TriangleAlert;
  return (
    <li>
      <LinkSecao secao={a.secao} className={`flex items-start gap-2 text-sm border rounded-lg px-3 py-2 hover:no-underline hover:brightness-95 ${cor} !text-inherit`}>
        <Icone className="w-4 h-4 mt-0.5 shrink-0" />
        <span className="flex-1">{a.texto}</span>
      </LinkSecao>
    </li>
  );
}

// Um numero por dia quando nao ha extrato: vira a base de "Em conta".
function ModalInformarSaldo({ contas, onFechar, onSalvo }: { contas: SaldoConta[]; onFechar: () => void; onSalvo: () => void }) {
  const [contaId, setContaId] = useState(contas[0]?.conta_id ?? '');
  const [data, setData] = useState(hojeBRT());
  const [saldo, setSaldo] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    if (!contaId) { setErro('Escolha a conta.'); return; }
    if (saldo === null) { setErro('Informe o saldo.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/saldos', { method: 'POST', body: JSON.stringify({ conta_id: contaId, data, saldo }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar o saldo');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Informar saldo" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar saldo</BotaoPrimario>
      </>}>
      <p className="text-xs text-gray-500">O saldo que aparece no app do banco agora. Quando o extrato for importado, ele substitui este número.</p>
      <Campo rotulo="Conta">
        <select value={contaId} onChange={e => setContaId(e.target.value)} className={INPUT}>
          {contas.length === 0 && <option value="">Nenhuma conta de banco</option>}
          {contas.map(c => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Data">
        <input type="date" value={data} max={hojeBRT()} onChange={e => e.target.value && setData(e.target.value)} className={INPUT} />
      </Campo>
      <Campo rotulo="Saldo">
        <CampoMoeda value={saldo} onChange={setSaldo} autoFocus />
      </Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
