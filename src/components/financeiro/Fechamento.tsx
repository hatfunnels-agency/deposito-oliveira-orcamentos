'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { FechamentoMensal, GrupoFechamento, GrupoGestao } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataCurta, hojeBRT, mesBRT, numero, pct, rotuloMes, rotuloMetodo, somarDiasISO, ultimoDia } from '@/lib/financeiro/formato';
import ExtratosTab from '@/components/ExtratosTab';
import { Aviso, Carregando, Cartao, Erro, LinhaValor, Selo, SeletorMes, LinkSecao } from './Comuns';

// Fechamento do mes em dois blocos que nao batem de proposito: Resultado por
// competencia (venda quando o pedido nasce, conta pelo mes a que se refere,
// folha pelo periodo trabalhado) e Caixa do mes (tudo pela data em que o
// dinheiro se moveu). A tela explica a diferenca em vez de esconder.

const GRUPOS_OPERACAO: Array<{ key: GrupoGestao; rotulo: string }> = [
  { key: 'folha', rotulo: 'Folha' },
  { key: 'estrutura', rotulo: 'Estrutura' },
  { key: 'operacao', rotulo: 'Operação' },
  { key: 'comercial', rotulo: 'Comercial' },
  { key: 'imposto_socios', rotulo: 'Imposto e sócios' },
  { key: 'outro', rotulo: 'Outros' },
];

const ROTULO_ORIGEM: Record<GrupoFechamento['itens'][number]['origem'], string> = {
  conta_pagar: 'conta', folha: 'folha', vale: 'vale', extrato: 'extrato', caixa: 'caixa', orcado: 'orçado',
};

export default function Fechamento() {
  const [mes, setMes] = useState(mesBRT());
  const [dados, setDados] = useState<FechamentoMensal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verDre, setVerDre] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<FechamentoMensal>(`/api/financeiro/fechamento?mes=${mes}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao montar o fechamento');
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  const cabecalho = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800">Fechamento do mês</h2>
        <SeletorMes value={mes} onChange={setMes} />
      </div>
    </div>
  );

  if (carregando && !dados) return <div className="space-y-4">{cabecalho}<Carregando texto="Fechando o mês…" /></div>;
  if (erro && !dados) return <div className="space-y-4">{cabecalho}<Erro mensagem={erro} onTentar={carregar} /></div>;
  if (!dados) return null;

  const { vendas, recebimentos, despesas, resultado, caixa, comparativo, qualidade } = dados;
  const grupo = (k: GrupoGestao): GrupoFechamento => despesas.grupos.find(g => g.grupo === k) ?? { grupo: k, rotulo: k, orcado: 0, realizado: 0, provisao: false, itens: [] };
  const divida = grupo('divida');
  const compras = grupo('cmv_compras');
  const parcial = mes >= mesBRT();

  const avisos: ReactNode[] = [];
  if (qualidade.contas_vencidas_pendentes > 0) avisos.push(<><LinkSecao secao="pagar">{qualidade.contas_vencidas_pendentes} conta(s) vencida(s) sem pagamento</LinkSecao>: o realizado está menor que o devido.</>);
  if (qualidade.lancamentos_a_revisar > 0) avisos.push(<><LinkSecao secao="extratos">{qualidade.lancamentos_a_revisar} lançamento(s) do extrato sem revisão</LinkSecao>: podem mudar de grupo.</>);
  if (qualidade.possiveis_duplicidades > 0) avisos.push(<>{qualidade.possiveis_duplicidades} linha(s) do extrato coincidem com contas pagas e ficaram fora para não contar duas vezes. <LinkSecao secao="conciliacao">Vincule na conciliação</LinkSecao>.</>);
  if (qualidade.folha_ja_contada > 0) avisos.push(<>{qualidade.folha_ja_contada} linha(s) de extrato categorizadas como folha ficaram fora: a folha vem de Funcionários.</>);
  if (qualidade.taxas_sem_tabela) avisos.push(<><LinkSecao secao="maquininha">Há pagamentos de cartão sem taxa cadastrada</LinkSecao>: as taxas estão subestimadas.</>);
  if (qualidade.reembolso_pendente > 0.009) avisos.push(<>Reembolso da Votoran previsto e ainda não recebido: {brl(qualidade.reembolso_pendente)} (a confirmar).</>);
  if (qualidade.receita_sem_custo_pct > 2) avisos.push(<>{pct(qualidade.receita_sem_custo_pct)} da receita é de itens sem custo cadastrado: o CMV está subestimado e a margem, inflada.</>);
  if (qualidade.pedidos_sem_pagamento > 0) avisos.push(<>{qualidade.pedidos_sem_pagamento} pedido(s) do mês ainda sem nenhum pagamento registrado.</>);
  // Mes fechado: o extrato precisa cobrir ate o ultimo dia. Mes em andamento:
  // mais de 7 dias sem extrato ja deixa o realizado defasado.
  for (const [conta, ate] of Object.entries(qualidade.extrato_ate)) {
    if (!ate) avisos.push(<>Extrato de {conta} nunca importado: saídas pelo banco não aparecem no realizado.</>);
    else if (!parcial && ate < ultimoDia(mes)) avisos.push(<>Extrato de {conta} só até {dataCurta(ate)}: saídas do fim do mês podem faltar.</>);
    else if (parcial && ate < somarDiasISO(hojeBRT(), -7)) avisos.push(<>Extrato de {conta} parado em {dataCurta(ate)}: <LinkSecao secao="extratos">importe o extrato</LinkSecao> para o realizado acompanhar.</>);
  }

  return (
    <div className="space-y-4">
      {cabecalho}
      {erro && <Erro mensagem={erro} onTentar={carregar} />}

      {/* Resultado (competencia) */}
      <Cartao titulo={`Resultado de ${rotuloMes(dados.mes)} (competência)`} selo={parcial ? <Selo tom="amarelo">mês em andamento</Selo> : undefined}
        descricao="Orçado = despesas fixas e folha previstas; Realizado = o que foi pago ou lançado; mês anterior para comparar.">
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs text-gray-500 text-left">
              <tr>
                <th className="py-1.5 font-medium">Linha</th>
                <th className="py-1.5 font-medium text-right">Orçado</th>
                <th className="py-1.5 font-medium text-right">Realizado</th>
                <th className="py-1.5 font-medium text-right">{comparativo ? rotuloMes(comparativo.mes) : 'mês anterior'}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <Linha rotulo="Faturamento" realizado={vendas.faturamento} anterior={comparativo?.faturamento} detalhe={`${vendas.qtd_pedidos} pedido(s) · ticket ${brl(vendas.ticket_medio)}`} />
              <Linha rotulo="(−) CMV" realizado={-vendas.cmv} tom="neg" detalhe={vendas.receita_sem_custo > 0 ? `${brl(vendas.receita_sem_custo)} de receita sem custo cadastrado` : undefined} />
              <Linha rotulo={`= Lucro bruto${vendas.margem_bruta_pct !== null ? ` (${pct(vendas.margem_bruta_pct)})` : ''}`} realizado={vendas.lucro_bruto} anterior={comparativo?.lucro_bruto} total />
              {GRUPOS_OPERACAO.map(g => {
                const d = grupo(g.key);
                const chave = `g-${g.key}`;
                return (
                  <LinhaGrupo key={g.key} rotulo={`(−) ${g.rotulo}`} g={d} aberto={aberto === chave} onToggle={() => setAberto(aberto === chave ? null : chave)} />
                );
              })}
              <Linha rotulo="(−) Taxas líquidas da maquininha" orcado={-recebimentos.taxas_liquidas_previstas} realizado={-recebimentos.taxas_liquidas_realizadas} tom="neg"
                detalhe={`custo bruto ${brl(recebimentos.maquininha.custo_bruto)} + tarifas Pix ${brl(recebimentos.tarifa_pix_stone)} − reembolso ${brl(recebimentos.reembolso_recebido)} recebido (previsto ${brl(recebimentos.maquininha.reembolso_previsto)})`} />
              <Linha rotulo="= Lucro da operação" orcado={resultado.orcado.lucro_operacao} realizado={resultado.realizado.lucro_operacao} total />
              <LinhaGrupo rotulo="(−) Dívida" g={{ ...divida, orcado: resultado.orcado.divida, realizado: resultado.realizado.divida }} aberto={aberto === 'g-divida'} onToggle={() => setAberto(aberto === 'g-divida' ? null : 'g-divida')}
                detalhe={despesas.juros_divida > 0 ? `juros embutidos ${brl(despesas.juros_divida)}` : undefined} />
              <Linha rotulo="= Caixa livre" orcado={resultado.orcado.caixa_livre} realizado={resultado.realizado.caixa_livre} anterior={comparativo?.caixa_livre_realizado} total forte />
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <p>Compras de mercadoria pagas no mês (CMV de caixa, informativo): <strong>{brl(compras.realizado || despesas.compras_pagas)}</strong> — já estão no CMV acima pelo custo dos itens vendidos.</p>
          <p>Despesas: orçado {brl(despesas.total_orcado)} × realizado {brl(despesas.total_realizado)} (folha realizada {brl(despesas.folha_realizada)}).{comparativo ? ` Mês anterior: ${brl(comparativo.despesas_realizadas)}.` : ''}</p>
        </div>
      </Cartao>

      {/* Caixa do mes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Cartao titulo="Caixa do mês" descricao="Tudo pela data em que o dinheiro se moveu (contas, faturas, dívida, folha, caixa, extrato).">
          <LinhaValor rotulo="Saldo inicial (contas de banco)" valor={caixa.saldo_inicial === null ? 'sem saldo informado' : brl(caixa.saldo_inicial)} tom={caixa.saldo_inicial === null ? 'cinza' : undefined} />
          <LinhaValor rotulo="(+) Entradas (recebido − custos do cartão)" valor={brl(caixa.entradas)} tom="verde" />
          <LinhaValor rotulo="(−) Saídas" valor={brl(-caixa.saidas)} tom="vermelho" />
          <LinhaValor destaque rotulo="= Saldo final calculado" valor={caixa.saldo_final_calculado === null ? '—' : brl(caixa.saldo_final_calculado)} />
          <LinhaValor rotulo="Saldo final informado / extrato" valor={caixa.saldo_final_informado === null ? '—' : brl(caixa.saldo_final_informado)} />
          <LinhaValor rotulo="Diferença" valor={caixa.diferenca === null ? '—' : brl(caixa.diferenca)} tom={caixa.diferenca !== null && Math.abs(caixa.diferenca) > 1 ? 'vermelho' : 'cinza'} />
          {Object.keys(caixa.saidas_por_tipo).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(caixa.saidas_por_tipo).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <Selo key={k} tom="cinza">{k}: {brl(v)}</Selo>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">Diferença grande = saída sem registro (nem conta, nem extrato) ou saldo informado desatualizado.</p>
        </Cartao>

        <Cartao titulo="Recebimentos no mês" descricao="Por método, bruto. O custo do cartão já está descontado nas taxas acima.">
          {Object.entries(recebimentos.por_metodo).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
            <LinhaValor key={m} rotulo={rotuloMetodo(m)} valor={brl(v)} />
          ))}
          <LinhaValor destaque rotulo="Total recebido" valor={brl(recebimentos.total)} />
          <p className="text-[11px] text-gray-400 mt-2">
            Maquininha: {brl(recebimentos.maquininha.volume_bruto)} em {numero(recebimentos.maquininha.qtd)} pagamento(s), líquido {brl(recebimentos.maquininha.liquido_recebido)}
            {recebimentos.maquininha.sem_tabela ? ' · há pagamentos sem taxa cadastrada' : ''}.
          </p>
        </Cartao>
      </div>

      {avisos.length > 0 && (
        <Cartao titulo="Qualidade dos números">
          <ul className="space-y-1.5">
            {avisos.map((a, i) => <li key={i}><Aviso tom="alerta">{a}</Aviso></li>)}
          </ul>
        </Cartao>
      )}

      {/* DRE pelo extrato (vista do ExtratosTab) */}
      <Cartao titulo="DRE pelo extrato" selo={<Selo tom="cinza">outra visão</Selo>}
        descricao="Soma só o que passou pelo banco e pela Stone, pela data do lançamento e pela categoria de cada linha. Difere do Resultado acima porque este usa competência e inclui caixa em espécie, cartão e folha de Funcionários."
        acao={<button type="button" onClick={() => setVerDre(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px] px-2">
          {verDre ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{verDre ? 'ocultar' : 'ver'}
        </button>}>
        {verDre && <ExtratosTab vistas={['dre']} mes={mes} />}
      </Cartao>
    </div>
  );
}

function Linha({ rotulo, orcado, realizado, anterior, tom, total = false, forte = false, detalhe }: {
  rotulo: string; orcado?: number; realizado: number; anterior?: number; tom?: 'neg'; total?: boolean; forte?: boolean; detalhe?: string;
}) {
  const cor = (v: number) => (total ? (v < 0 ? 'text-red-700 font-bold' : 'text-gray-900 font-bold') : tom === 'neg' ? 'text-red-700' : 'text-gray-900');
  return (
    <tr className={total ? 'border-t border-gray-200' : ''}>
      <td className={`py-1.5 pr-2 ${total ? 'font-bold text-gray-800' : 'text-gray-600 pl-2'} ${forte ? 'text-base' : ''}`}>
        {rotulo}
        {detalhe && <p className="text-[11px] text-gray-400 font-normal">{detalhe}</p>}
      </td>
      <td className={`py-1.5 px-2 text-right align-top ${orcado === undefined ? 'text-gray-300' : cor(orcado)}`}>{orcado === undefined ? '—' : brl(orcado)}</td>
      <td className={`py-1.5 px-2 text-right align-top ${cor(realizado)}`}>{brl(realizado)}</td>
      <td className={`py-1.5 pl-2 text-right align-top ${anterior === undefined ? 'text-gray-300' : 'text-gray-500'}`}>{anterior === undefined ? '—' : brl(anterior)}</td>
    </tr>
  );
}

function LinhaGrupo({ rotulo, g, aberto, onToggle, detalhe }: { rotulo: string; g: GrupoFechamento; aberto: boolean; onToggle: () => void; detalhe?: string }) {
  const temItens = g.itens.length > 0;
  return (
    <>
      <tr>
        <td className="py-1.5 pr-2 pl-2 text-gray-600">
          <button type="button" onClick={onToggle} disabled={!temItens} className="inline-flex items-center gap-1 text-left min-h-[32px] disabled:cursor-default">
            {temItens && (aberto ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />)}
            {rotulo}
            {g.provisao && <Selo tom="cinza" className="ml-1" titulo="Provisão: orçado sem boleto; realizado é o gasto categorizado">provisão</Selo>}
          </button>
          {detalhe && <p className="text-[11px] text-gray-400">{detalhe}</p>}
        </td>
        <td className="py-1.5 px-2 text-right text-red-700 align-top">{brl(-g.orcado)}</td>
        <td className="py-1.5 px-2 text-right text-red-700 align-top">{brl(-g.realizado)}</td>
        <td className="py-1.5 pl-2 text-right text-gray-300 align-top">—</td>
      </tr>
      {aberto && temItens && (
        <tr>
          <td colSpan={4} className="pb-2 pl-6 pr-2">
            <div className="divide-y divide-gray-100 text-xs bg-gray-50 rounded-lg px-3">
              {g.itens.map((i, k) => (
                <div key={`${i.descricao}-${i.data ?? ''}-${k}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-gray-700">
                    {i.data ? `${dataCurta(i.data)} · ` : ''}{i.descricao}{i.fornecedor ? ` · ${i.fornecedor}` : ''}
                    <span className="text-gray-400"> · {ROTULO_ORIGEM[i.origem]}</span>
                  </span>
                  <span className="tabular-nums shrink-0 text-gray-800">{brl(i.valor)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
