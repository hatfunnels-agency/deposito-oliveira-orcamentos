'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp, Download } from 'lucide-react';
import type {
  NovoReembolso, Reembolso, ResumoMaquininhaMes, StatusStone, TaxaMaquininha, TaxaMaquininhaEntrada,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataBR, dataCurta, hojeBRT, mesBRT, pct, rotuloMes } from '@/lib/financeiro/formato';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Carregando, Cartao, Erro, Estatistica,
  INPUT, Modal, Selo, SeletorMes, Vazio, useContextoFinanceiro,
} from './Comuns';

// Quanto a maquininha custa de verdade: tabela cadastrada (estimativa) x
// taxa efetiva medida no extrato da Stone (real). O editor de taxas cria
// uma NOVA vigencia — a tabela antiga continua valendo pros pagamentos
// antigos, porque o custo e calculado na leitura pela taxa da data.

const MODALIDADES: Array<{ v: TaxaMaquininha['modalidade']; l: string }> = [
  { v: 'debito', l: 'Débito' }, { v: 'credito', l: 'Crédito' }, { v: 'pix', l: 'Pix (maquininha)' },
];
const FORMAS: Array<{ v: Reembolso['forma']; l: string }> = [
  { v: 'credito_compra', l: 'Crédito em compra' }, { v: 'pix', l: 'Pix' }, { v: 'transferencia', l: 'Transferência' },
  { v: 'desconto_boleto', l: 'Desconto em boleto' }, { v: 'outro', l: 'Outro' },
];

type Linha = TaxaMaquininhaEntrada & { chave: string };

const rotuloFaixa = (m: string, de: number, ate: number) =>
  `${MODALIDADES.find(x => x.v === m)?.l ?? m}${m === 'credito' ? ` ${de === ate ? `${de}x` : `${de}–${ate}x`}` : ''}`;

export default function Maquininha() {
  const { recarregar } = useContextoFinanceiro();
  const [mes, setMes] = useState(mesBRT());
  const [dados, setDados] = useState<ResumoMaquininhaMes | null>(null);
  const [taxas, setTaxas] = useState<TaxaMaquininha[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editandoTaxas, setEditandoTaxas] = useState(false);
  const [novoReembolso, setNovoReembolso] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [m, t] = await Promise.all([
        apiFinanceiro<ResumoMaquininhaMes>(`/api/financeiro/maquininha?mes=${mes}`),
        apiFinanceiro<{ taxas: TaxaMaquininha[] }>('/api/financeiro/taxas'),
      ]);
      setDados(m);
      setTaxas(t.taxas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar a maquininha');
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  const vigentes = useMemo(() => (taxas ?? []).filter(t => t.vigencia_fim === null)
    .sort((a, b) => a.modalidade.localeCompare(b.modalidade) || a.parcelas_de - b.parcelas_de), [taxas]);
  const historico = useMemo(() => (taxas ?? []).filter(t => t.vigencia_fim !== null)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio) || a.modalidade.localeCompare(b.modalidade) || a.parcelas_de - b.parcelas_de), [taxas]);

  const excluirReembolso = async (r: Reembolso) => {
    if (!window.confirm(`Apagar o reembolso de ${brl(r.valor)} (${rotuloMes(r.referencia.slice(0, 7))})?`)) return;
    try {
      await apiFinanceiro(`/api/financeiro/reembolsos?id=${r.id}`, { method: 'DELETE' });
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Erro ao apagar');
    }
  };

  if (carregando && !dados) return <Carregando texto="Calculando as taxas…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;

  const taxaTabela = dados.volume_bruto > 0 ? (dados.custo_bruto / dados.volume_bruto) * 100 : null;
  const pctSemParcelas = dados.volume_credito > 0 ? (dados.volume_credito_sem_parcelas / dados.volume_credito) * 100 : 0;
  const seloCusto = dados.sem_tabela ? <Selo tom="vermelho" titulo="Há pagamentos sem taxa cadastrada: custo subestimado">sem tabela</Selo>
    : dados.taxas_padrao_nao_conferidas ? <Selo tom="amarelo" titulo="Taxas cadastradas como valor padrão — confira no contrato Stone">valor padrão</Selo>
    : <Selo tom="cinza">estimado</Selo>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-gray-800">Maquininha</h2>
          <SeletorMes value={mes} onChange={setMes} />
        </div>
      </div>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="info">{aviso} <button type="button" onClick={() => setAviso(null)} className="ml-2 text-xs underline">fechar</button></Aviso>}
      {vigentes.length === 0 && (
        <Aviso tom="alerta">Cadastre as taxas da Stone: sem tabela, o custo do cartão aparece como zero. Use “Editar taxas” abaixo.</Aviso>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Estatistica rotulo="Volume no cartão" valor={brl(dados.volume_bruto)}
          detalhe={`débito ${brl(dados.volume_debito)} · crédito ${brl(dados.volume_credito)}${dados.volume_pix_stone > 0 ? ` · pix ${brl(dados.volume_pix_stone)}` : ''} · ${dados.qtd} pgto(s)`} />
        {(dados.taxas_reais ?? 0) > 0 && (
          <Estatistica rotulo="Taxas pagas (real, arquivo Vloz)" valor={brl(dados.taxas_reais ?? 0)} tom="vermelho"
            detalhe={`cashback da Votoran ${brl(dados.reembolso_recebido)} · custo líquido ${brl(dados.custo_liquido_realizado)}`} />
        )}
        <Estatistica rotulo="Custo pela tabela" valor={brl(dados.custo_bruto)} tom="vermelho" selo={seloCusto}
          detalhe={`${taxaTabela === null ? '—' : pct(taxaTabela, 2)} · MDR ${brl(dados.taxas)} + antecipação ${brl(dados.antecipacao)}`} />
        <Estatistica rotulo="Taxa efetiva real (extrato)" valor={dados.taxa_efetiva_extrato_pct === null ? 'sem extrato' : pct(dados.taxa_efetiva_extrato_pct, 2)}
          tom={dados.taxa_efetiva_extrato_pct === null ? 'neutro' : taxaTabela !== null && dados.taxa_efetiva_extrato_pct > taxaTabela + 0.3 ? 'vermelho' : 'verde'}
          detalhe={dados.taxa_efetiva_extrato_pct === null ? 'importe o extrato da Stone' : `liquidado ${brl(dados.liquidado_extrato)}${dados.cobertura_real_pct > 0 ? ` · ${pct(dados.cobertura_real_pct)} com custo real (API)` : ''}`} />
        <Estatistica rotulo="Reembolso previsto × recebido" valor={`${brl(dados.reembolso_previsto)} × ${brl(dados.reembolso_recebido)}`} selo={<Selo tom="amarelo">a confirmar</Selo>}
          detalhe="acordo Votoran: escopo e forma ainda não confirmados" />
        <Estatistica rotulo="Custo líquido previsto × realizado" valor={`${brl(dados.custo_liquido_previsto)} × ${brl(dados.custo_liquido_realizado)}`}
          detalhe="custo bruto − reembolso (previsto × recebido)" />
        <Estatistica rotulo="Tarifas Pix Stone" valor={brl(dados.tarifas_pix_stone)} detalhe="somadas do extrato (coluna Tarifa)" />
        <Estatistica rotulo="Crédito sem parcelas informadas" valor={pct(pctSemParcelas)} tom={pctSemParcelas > 20 ? 'amarelo' : 'neutro'}
          detalhe={`${brl(dados.volume_credito_sem_parcelas)} tratados como 1x: antecipação subestimada`} />
        <Estatistica rotulo="Líquido recebido" valor={brl(dados.liquido_recebido)} tom="verde" detalhe="volume − custo bruto" />
      </div>

      <Cartao titulo={`Por faixa · ${rotuloMes(dados.mes)}`} descricao="Tabela × efetiva (a efetiva por faixa só existe com a API da Stone).">
        {dados.por_faixa.length === 0 ? <Vazio>Nenhum pagamento de cartão no mês.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="text-xs text-gray-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Faixa</th>
                  <th className="py-1 font-medium text-right">Qtd</th>
                  <th className="py-1 font-medium text-right">Volume</th>
                  <th className="py-1 font-medium text-right">Taxa tabela</th>
                  <th className="py-1 font-medium text-right">Efetiva</th>
                  <th className="py-1 font-medium text-right">Custo bruto</th>
                  <th className="py-1 font-medium text-right">Reembolso</th>
                  <th className="py-1 font-medium text-right">Custo líquido</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {dados.por_faixa.map(f => (
                  <tr key={`${f.modalidade}-${f.parcelas_de}-${f.parcelas_ate}`} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{rotuloFaixa(f.modalidade, f.parcelas_de, f.parcelas_ate)}</td>
                    <td className="py-1.5 text-right text-gray-500">{f.qtd}</td>
                    <td className="py-1.5 text-right">{brl(f.volume)}</td>
                    <td className="py-1.5 text-right">{f.taxa_tabela_pct === null ? <Selo tom="amarelo">sem tabela</Selo> : pct(f.taxa_tabela_pct, 2)}</td>
                    <td className="py-1.5 text-right text-gray-500">{f.taxa_efetiva_pct === null ? '—' : pct(f.taxa_efetiva_pct, 2)}</td>
                    <td className="py-1.5 text-right">{brl(f.custo_bruto)}</td>
                    <td className="py-1.5 text-right">{brl(f.reembolso_previsto)}</td>
                    <td className="py-1.5 text-right font-semibold">{brl(f.custo_liquido_previsto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao titulo="Tabela de taxas" descricao="Vigente hoje. Mudar cria uma nova vigência: as taxas anteriores continuam valendo para os pagamentos antigos."
        acao={!editandoTaxas && <BotaoSecundario onClick={() => setEditandoTaxas(true)} className="min-h-[40px]"><Pencil className="w-4 h-4" /> Editar taxas</BotaoSecundario>}>
        {editandoTaxas ? (
          <EditorTaxas vigentes={vigentes} onCancelar={() => setEditandoTaxas(false)}
            onSalvo={() => { setEditandoTaxas(false); carregar(); recarregar(); }} />
        ) : vigentes.length === 0 ? <Vazio>Nenhuma taxa cadastrada.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-gray-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Faixa</th>
                  <th className="py-1 font-medium text-right">Taxa</th>
                  <th className="py-1 font-medium text-right">Antecipação</th>
                  <th className="py-1 font-medium text-right">Liquida em</th>
                  <th className="py-1 font-medium text-right">Reembolso</th>
                  <th className="py-1 font-medium">Vigente desde</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {vigentes.map(t => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">
                      {rotuloFaixa(t.modalidade, t.parcelas_de, t.parcelas_ate)}
                      {/padr[aã]o/i.test(t.observacoes ?? '') && <Selo tom="amarelo" className="ml-1">valor padrão</Selo>}
                    </td>
                    <td className="py-1.5 text-right">{pct(t.taxa_percentual, 2)}</td>
                    <td className="py-1.5 text-right">{t.antecipacao_percentual > 0 ? `${pct(t.antecipacao_percentual, 2)} ${t.antecipacao_modo === 'por_mes' ? 'a.m.' : 'flat'}` : '—'}</td>
                    <td className="py-1.5 text-right">D+{t.dias_liquidacao}</td>
                    <td className="py-1.5 text-right">{t.reembolso_percentual > 0 ? `${pct(t.reembolso_percentual, 0)}${t.base_reembolso === 'itens_votoran' ? ' (só Votoran)' : ''}` : '—'}</td>
                    <td className="py-1.5 text-gray-500">{dataBR(t.vigencia_inicio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historico.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setVerHistorico(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px]">
              {verHistorico ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} vigências anteriores ({historico.length})
            </button>
            {verHistorico && (
              <div className="divide-y divide-gray-100 text-xs tabular-nums">
                {historico.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-gray-700">{rotuloFaixa(t.modalidade, t.parcelas_de, t.parcelas_ate)} · {pct(t.taxa_percentual, 2)}{t.antecipacao_percentual > 0 ? ` + ${pct(t.antecipacao_percentual, 2)} ${t.antecipacao_modo === 'por_mes' ? 'a.m.' : 'flat'}` : ''}</span>
                    <span className="text-gray-500">{dataBR(t.vigencia_inicio)} → {t.vigencia_fim ? dataBR(t.vigencia_fim) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Cartao>

      <Cartao titulo="Reembolsos recebidos" descricao="O que a Votoran devolveu de taxa, por mês de referência. Só entra aqui o que foi recebido de fato."
        acao={<BotaoSecundario onClick={() => setNovoReembolso(true)} className="min-h-[40px]"><Plus className="w-4 h-4" /> Novo reembolso</BotaoSecundario>}>
        {dados.reembolsos.length === 0 ? <Vazio>Nenhum reembolso registrado para {rotuloMes(dados.mes)}.</Vazio> : (
          <div className="divide-y divide-gray-100">
            {dados.reembolsos.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-800 truncate">{r.fornecedor_nome ?? 'Fornecedor'} · ref. {rotuloMes(r.referencia.slice(0, 7))}</p>
                  <p className="text-xs text-gray-500">recebido {dataBR(r.data_recebimento)} · {FORMAS.find(f => f.v === r.forma)?.l ?? r.forma}{r.observacoes ? ` · ${r.observacoes}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold tabular-nums text-emerald-700">{brl(r.valor)}</span>
                  <button type="button" onClick={() => excluirReembolso(r)} aria-label="Apagar" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Cartao>

      <BlocoStone mes={mes} />

      {novoReembolso && <ModalReembolso mes={mes} onFechar={() => setNovoReembolso(false)} onSalvo={() => { setNovoReembolso(false); carregar(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- editor de taxas

function EditorTaxas({ vigentes, onCancelar, onSalvo }: { vigentes: TaxaMaquininha[]; onCancelar: () => void; onSalvo: () => void }) {
  const [vigencia, setVigencia] = useState(hojeBRT());
  const [linhas, setLinhas] = useState<Linha[]>(() => vigentes.length > 0
    ? vigentes.map(t => ({
      chave: t.id, id: t.id, adquirente: t.adquirente, modalidade: t.modalidade, parcelas_de: t.parcelas_de, parcelas_ate: t.parcelas_ate,
      taxa_percentual: t.taxa_percentual, antecipacao_modo: t.antecipacao_modo, antecipacao_percentual: t.antecipacao_percentual,
      dias_liquidacao: t.dias_liquidacao, reembolso_percentual: t.reembolso_percentual, base_reembolso: t.base_reembolso,
      teto_reembolso_mensal: t.teto_reembolso_mensal, devolve_taxa_no_estorno: t.devolve_taxa_no_estorno, observacoes: t.observacoes,
    }))
    : [novaLinha('debito', 1, 1), novaLinha('credito', 1, 1), novaLinha('credito', 2, 6), novaLinha('credito', 7, 12), novaLinha('pix', 1, 1)]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function novaLinha(modalidade: TaxaMaquininha['modalidade'], de: number, ate: number): Linha {
    return {
      chave: `nova-${Math.random().toString(36).slice(2, 8)}`,
      adquirente: 'stone', modalidade, parcelas_de: de, parcelas_ate: ate, taxa_percentual: 0,
      antecipacao_modo: 'por_mes', antecipacao_percentual: 0, dias_liquidacao: modalidade === 'pix' ? 0 : 1,
      reembolso_percentual: 0, base_reembolso: 'todas_vendas', teto_reembolso_mensal: null, devolve_taxa_no_estorno: false,
      observacoes: null,
    };
  }

  const alterar = (chave: string, patch: Partial<Linha>) => setLinhas(ls => ls.map(l => (l.chave === chave ? { ...l, ...patch } : l)));

  const salvar = async () => {
    setErro(null);
    for (const l of linhas) {
      if (l.parcelas_ate < l.parcelas_de) { setErro(`Faixa ${rotuloFaixa(l.modalidade, l.parcelas_de, l.parcelas_ate)}: "até" menor que "de".`); return; }
      if (l.taxa_percentual < 0 || l.taxa_percentual > 30) { setErro('Taxa fora do razoável (0–30%).'); return; }
    }
    setSalvando(true);
    try {
      // So os campos da tabela: o servidor decide vigencia_inicio/fim ao
      // versionar. Linha existente leva o id pra ele reconhecer "identica".
      const taxas: TaxaMaquininhaEntrada[] = linhas.map(l => ({
        ...(l.id ? { id: l.id } : {}),
        adquirente: l.adquirente, modalidade: l.modalidade, parcelas_de: l.parcelas_de, parcelas_ate: l.parcelas_ate,
        taxa_percentual: l.taxa_percentual, antecipacao_modo: l.antecipacao_modo, antecipacao_percentual: l.antecipacao_percentual,
        dias_liquidacao: l.dias_liquidacao, reembolso_percentual: l.reembolso_percentual, base_reembolso: l.base_reembolso,
        teto_reembolso_mensal: l.teto_reembolso_mensal, devolve_taxa_no_estorno: l.devolve_taxa_no_estorno,
        // 'Valor padrao' sai quando alguem edita: deixa de ser "nao conferida".
        observacoes: l.observacoes && /padr[aã]o/i.test(l.observacoes) ? null : l.observacoes,
      }));
      await apiFinanceiro('/api/financeiro/taxas', { method: 'PUT', body: JSON.stringify({ taxas, vigencia_inicio: vigencia }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar as taxas');
    } finally {
      setSalvando(false);
    }
  };

  const campo = `${INPUT} min-h-[36px] py-1 text-xs`;

  return (
    <div className="space-y-3">
      <Aviso tom="info">
        Salvar cria uma <strong>nova vigência</strong> a partir da data abaixo. As taxas anteriores continuam valendo para os pagamentos antigos — o custo de cada venda é calculado pela tabela vigente na data dela.
      </Aviso>
      <Campo rotulo="Nova vigência a partir de" className="max-w-xs">
        <input type="date" value={vigencia} onChange={e => e.target.value && setVigencia(e.target.value)} className={INPUT} />
      </Campo>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="text-gray-500 text-left">
            <tr>
              <th className="py-1 pr-1 font-medium">Modalidade</th>
              <th className="py-1 px-1 font-medium">Parcelas de</th>
              <th className="py-1 px-1 font-medium">até</th>
              <th className="py-1 px-1 font-medium">Taxa %</th>
              <th className="py-1 px-1 font-medium">Antecipação</th>
              <th className="py-1 px-1 font-medium">%</th>
              <th className="py-1 px-1 font-medium">Dias</th>
              <th className="py-1 px-1 font-medium">Reembolso %</th>
              <th className="py-1 px-1 font-medium">Base</th>
              <th className="py-1 px-1 font-medium">Estorno devolve</th>
              <th className="py-1 pl-1" />
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.chave} className="border-t border-gray-100">
                <td className="py-1 pr-1">
                  <select value={l.modalidade} onChange={e => alterar(l.chave, { modalidade: e.target.value as TaxaMaquininha['modalidade'] })} className={`${campo} w-28`}>
                    {MODALIDADES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                </td>
                <td className="py-1 px-1"><CampoNumero value={l.parcelas_de} onChange={v => alterar(l.chave, { parcelas_de: Math.max(1, Math.trunc(v ?? 1)) })} min={1} max={12} className="w-16" disabled={l.modalidade !== 'credito'} /></td>
                <td className="py-1 px-1"><CampoNumero value={l.parcelas_ate} onChange={v => alterar(l.chave, { parcelas_ate: Math.max(1, Math.trunc(v ?? 1)) })} min={1} max={12} className="w-16" disabled={l.modalidade !== 'credito'} /></td>
                <td className="py-1 px-1"><CampoNumero value={l.taxa_percentual} onChange={v => alterar(l.chave, { taxa_percentual: v ?? 0 })} step={0.01} sufixo="%" className="w-24" /></td>
                <td className="py-1 px-1">
                  <select value={l.antecipacao_modo} onChange={e => alterar(l.chave, { antecipacao_modo: e.target.value as 'flat' | 'por_mes' })} className={`${campo} w-24`}>
                    <option value="por_mes">% ao mês</option>
                    <option value="flat">% fixo</option>
                  </select>
                </td>
                <td className="py-1 px-1"><CampoNumero value={l.antecipacao_percentual} onChange={v => alterar(l.chave, { antecipacao_percentual: v ?? 0 })} step={0.01} sufixo="%" className="w-24" /></td>
                <td className="py-1 px-1"><CampoNumero value={l.dias_liquidacao} onChange={v => alterar(l.chave, { dias_liquidacao: Math.max(0, Math.trunc(v ?? 0)) })} min={0} max={60} className="w-16" /></td>
                <td className="py-1 px-1"><CampoNumero value={l.reembolso_percentual} onChange={v => alterar(l.chave, { reembolso_percentual: v ?? 0 })} step={1} min={0} max={100} sufixo="%" className="w-24" /></td>
                <td className="py-1 px-1">
                  <select value={l.base_reembolso} onChange={e => alterar(l.chave, { base_reembolso: e.target.value as 'todas_vendas' | 'itens_votoran' })} className={`${campo} w-32`}>
                    <option value="todas_vendas">todas as vendas</option>
                    <option value="itens_votoran">só itens Votoran</option>
                  </select>
                </td>
                <td className="py-1 px-1 text-center">
                  <input type="checkbox" checked={l.devolve_taxa_no_estorno} onChange={e => alterar(l.chave, { devolve_taxa_no_estorno: e.target.checked })} className="w-4 h-4 accent-[#F7941D]" />
                </td>
                <td className="py-1 pl-1 text-right">
                  <button type="button" onClick={() => setLinhas(ls => ls.filter(x => x.chave !== l.chave))} aria-label="Remover faixa" className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-gray-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500">
        Antecipação “% ao mês” é cobrada sobre cada parcela pelo tempo adiantado (parcela k seria paga em 30k dias; a Stone paga em D+dias). Débito em D+1 dá ≈ 0.
        Base “só itens Votoran” ainda não é calculada: o reembolso dessas faixas aparece como pendente.
      </p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <BotaoSecundario onClick={() => setLinhas(ls => [...ls, novaLinha('credito', 1, 1)])} className="min-h-[40px]"><Plus className="w-4 h-4" /> Adicionar faixa</BotaoSecundario>
        <div className="flex gap-2 ml-auto">
          <BotaoSecundario onClick={onCancelar}>Cancelar</BotaoSecundario>
          <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar nova vigência</BotaoPrimario>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reembolso

function ModalReembolso({ mes, onFechar, onSalvo }: { mes: string; onFechar: () => void; onSalvo: () => void }) {
  const { contexto } = useContextoFinanceiro();
  const fornecedores = (contexto?.fornecedores ?? []).filter(f => f.ativo);
  const votoran = fornecedores.find(f => /votoran/i.test(f.nome));
  const [fornecedorId, setFornecedorId] = useState(votoran?.id ?? '');
  const [referencia, setReferencia] = useState(mes);
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(hojeBRT());
  const [forma, setForma] = useState<Reembolso['forma']>('credito_compra');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    if (!valor || valor <= 0) { setErro('Informe o valor recebido.'); return; }
    setSalvando(true);
    setErro(null);
    const corpo: NovoReembolso = { fornecedor_id: fornecedorId || null, referencia, valor, data_recebimento: data, forma, observacoes: obs.trim() || null };
    try {
      await apiFinanceiro('/api/financeiro/reembolsos', { method: 'POST', body: JSON.stringify(corpo) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar o reembolso');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Reembolso recebido" onFechar={onFechar}
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar</BotaoPrimario>
      </>}>
      <Campo rotulo="Fornecedor">
        <select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)} className={INPUT}>
          <option value="">— sem fornecedor —</option>
          {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Mês de referência"><SeletorMes value={referencia} onChange={setReferencia} className="w-full" /></Campo>
        <Campo rotulo="Valor"><CampoMoeda value={valor} onChange={setValor} autoFocus /></Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Recebido em"><input type="date" value={data} max={hojeBRT()} onChange={e => e.target.value && setData(e.target.value)} className={INPUT} /></Campo>
        <Campo rotulo="Forma">
          <select value={forma} onChange={e => setForma(e.target.value as Reembolso['forma'])} className={INPUT}>
            {FORMAS.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Observações"><input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} /></Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------------------------------------------------------- fase 2: API Stone

function BlocoStone({ mes }: { mes: string }) {
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState<StatusStone | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setStatus(await apiFinanceiro<StatusStone>(`/api/financeiro/stone?mes=${mes}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Integração com a API da Stone ainda não disponível.');
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => { if (aberto) carregar(); }, [aberto, carregar]);

  const importar = async () => {
    setImportando(true);
    setAviso(null);
    try {
      const r = await apiFinanceiro<{ importacoes: StatusStone['ultimas_importacoes'] }>('/api/financeiro/stone', {
        method: 'POST', body: JSON.stringify({ acao: 'importar' }),
      });
      const partes = r.importacoes.map(i => i.status === 'ok'
        ? `${i.stone_code}: ${i.transacoes} transações (${i.novas} novas), ${i.casadas} casada(s)`
        : i.status === 'vazio' ? `${i.stone_code}: sem movimento${i.erro ? ` (${i.erro})` : ''}` : `${i.stone_code}: erro — ${i.erro ?? ''}`);
      setAviso(partes.length > 0 ? `Importação de D−1: ${partes.join(' · ')}` : 'Nenhum Stone Code configurado.');
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Erro ao importar');
    } finally {
      setImportando(false);
    }
  };

  return (
    <Cartao titulo="API de Conciliação Stone" selo={status?.configurado ? <Selo tom="verde">ligada</Selo> : <Selo tom="cinza">fase 2</Selo>}
      descricao="Traz cada venda do cartão com bruto, líquido e taxa real, sem depender do extrato."
      acao={<button type="button" onClick={() => setAberto(v => !v)} className="inline-flex items-center gap-1 text-xs text-[#C96F00] min-h-[40px] px-2">
        {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{aberto ? 'ocultar' : 'ver'}
      </button>}>
      {aberto && (
        <div className="space-y-3">
          {carregando && <Carregando texto="Consultando…" className="py-4" />}
          {erro && <Aviso tom="info">{erro}</Aviso>}
          {aviso && <Aviso tom="info">{aviso}</Aviso>}
          {status && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {status.configurado ? <Selo tom="verde">configurada · {status.stone_codes.length} Stone Code(s)</Selo> : <Selo tom="amarelo">não configurada</Selo>}
                {status.configurado && (
                  <BotaoSecundario onClick={importar} carregando={importando} className="min-h-[40px] ml-auto"><Download className="w-4 h-4" /> Importar D−1</BotaoSecundario>
                )}
              </div>
              {status.configurado && (
                <p className="text-sm text-gray-700">
                  {rotuloMes(status.vendas_mes.mes)}: {status.vendas_mes.qtd} venda(s) · bruto {brl(status.vendas_mes.bruto)} · líquido {brl(status.vendas_mes.liquido)} · taxas {brl(status.vendas_mes.taxas)} · {status.vendas_mes.casadas} casada(s) com pagamentos, {status.vendas_mes.sem_par} sem par.
                </p>
              )}
              {status.ultimas_importacoes.length > 0 && (
                <div className="divide-y divide-gray-100 text-xs">
                  {status.ultimas_importacoes.map(i => (
                    <div key={`${i.stone_code}-${i.arquivo_data}`} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-gray-700">{dataCurta(i.arquivo_data)} · {i.stone_code}</span>
                      <span className="text-gray-500">{i.status === 'ok' ? `${i.transacoes} transações (${i.novas} novas) · ${i.casadas} casadas` : i.status === 'vazio' ? 'sem movimento' : `erro: ${i.erro ?? ''}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {(!status || !status.configurado) && !carregando && (
            <div className="text-xs text-gray-600 space-y-1">
              <p className="font-semibold">Como ligar:</p>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Portal Stone › Perfil › Chaves de Autenticação › Criar Chave › “API de Conciliação Stone”.</li>
                <li>Guardar a chave na variável <code className="bg-gray-100 px-1 rounded">STONE_CONCILIACAO_CHAVE</code> e o(s) Stone Code(s) em <code className="bg-gray-100 px-1 rounded">STONE_CODES</code> (separados por vírgula) na Vercel.</li>
                <li>O cron diário passa a importar o arquivo de D−1 após 06:00; aqui dá para forçar “Importar D−1”.</li>
              </ol>
              <p className="text-gray-400">Mês consultado: {rotuloMes(mes)}.</p>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
