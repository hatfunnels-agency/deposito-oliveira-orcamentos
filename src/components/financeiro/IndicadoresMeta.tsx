'use client';

import { useState } from 'react';
import { Target } from 'lucide-react';
import type { IndicadoresMes, MetasFinanceiras } from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, pct, rotuloMes } from '@/lib/financeiro/formato';
import { Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Cartao, LinhaValor, Modal, Selo } from './Comuns';

// Meta e minimo do mes no Panorama. Meta e o que o Roger quer; minimo e o
// faturamento que paga os custos do mes (ponto de equilibrio). A barra mostra
// onde o mes esta, a projecao no ritmo atual e as duas marcas.

const ROTULO_GRUPO: Record<string, string> = {
  folha: 'Folha', estrutura: 'Estrutura', operacao: 'Operação', comercial: 'Comercial',
  imposto_socios: 'Impostos e sócios', divida: 'Parcelas de dívida', outro: 'Outros',
};

const STATUS = {
  acima_meta: { tom: 'verde' as const, texto: 'No ritmo de bater a meta' },
  acima_minimo: { tom: 'laranja' as const, texto: 'Acima do mínimo, abaixo da meta' },
  abaixo_minimo: { tom: 'vermelho' as const, texto: 'No ritmo atual o mês fecha no vermelho' },
  sem_dados: { tom: 'cinza' as const, texto: 'Sem dados suficientes ainda' },
};

export default function IndicadoresMeta({ ind, onSalvo }: { ind: IndicadoresMes; onSalvo: () => void }) {
  const [editando, setEditando] = useState(false);
  const { minimo, meta, metas } = ind;
  const st = STATUS[ind.status];

  // Escala da barra: o maior entre meta, minimo, projecao e faturado.
  const escala = Math.max(meta.valor ?? 0, minimo.valor ?? 0, ind.projecao, ind.faturamento, 1) * 1.05;
  const pos = (v: number) => `${Math.min(100, (v / escala) * 100)}%`;
  const corBarra = ind.status === 'abaixo_minimo' ? 'bg-red-500' : ind.status === 'acima_meta' ? 'bg-emerald-500' : 'bg-[#F7941D]';

  return (
    <Cartao titulo={`Meta do mês · ${rotuloMes(ind.mes)}`} selo={<Selo tom={st.tom}>{st.texto}</Selo>}
      acao={<BotaoSecundario onClick={() => setEditando(true)}><Target className="w-4 h-4" /> {metas.faturamento_mes ? 'Editar metas' : 'Definir meta'}</BotaoSecundario>}>
      {/* barra */}
      <div className="relative h-6 rounded-full bg-gray-100 overflow-visible mt-1 mb-7" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-full ${corBarra}`} style={{ width: pos(ind.faturamento) }} />
        {ind.projecao > ind.faturamento && (
          <div className="absolute inset-y-0 rounded-r-full bg-gray-300/70" style={{ left: pos(ind.faturamento), width: `calc(${pos(ind.projecao)} - ${pos(ind.faturamento)})` }} />
        )}
        {minimo.valor !== null && <Marca left={pos(minimo.valor)} rotulo="mínimo" cor="bg-red-600" />}
        {meta.valor !== null && <Marca left={pos(meta.valor)} rotulo="meta" cor="bg-emerald-700" />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <Bloco rotulo="Faturado até hoje" valor={brl(ind.faturamento)}
          detalhe={meta.pct !== null ? `${pct(meta.pct, 0)} da meta · ${ind.qtd_pedidos} pedidos` : `${ind.qtd_pedidos} pedidos`} />
        <Bloco rotulo="Projeção no ritmo atual" valor={brl(ind.projecao)}
          detalhe={`${brl(ind.media_por_dia)}/dia · ${ind.dias_uteis_passados} de ${ind.dias_uteis_total} dias`}
          tom={ind.status === 'abaixo_minimo' ? 'vermelho' : ind.status === 'acima_meta' ? 'verde' : undefined} />
        <Bloco rotulo="Mínimo (não fechar no vermelho)" valor={minimo.valor === null ? '—' : brl(minimo.valor)}
          detalhe={minimo.valor === null ? 'sem margem no mês ainda'
            : minimo.atingido ? 'já atingido ✓'
            : minimo.falta_por_dia !== null ? `faltam ${brl(minimo.falta_por_dia)}/dia nos ${ind.dias_uteis_restantes} dias` : undefined}
          tom={minimo.atingido ? 'verde' : undefined} />
        <Bloco rotulo="Meta" valor={meta.valor === null ? 'não definida' : brl(meta.valor)}
          detalhe={meta.valor === null ? 'toque em Definir meta'
            : meta.falta_por_dia === 0 ? 'batida ✓'
            : meta.falta_por_dia !== null ? `faltam ${brl(meta.falta_por_dia)}/dia nos ${ind.dias_uteis_restantes} dias` : undefined}
          tom={meta.falta_por_dia === 0 ? 'verde' : undefined} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm mt-3">
        <Bloco rotulo="Resultado projetado" valor={ind.resultado_projetado === null ? '—' : brl(ind.resultado_projetado)}
          detalhe="se mantiver o ritmo" tom={ind.resultado_projetado === null ? undefined : ind.resultado_projetado < 0 ? 'vermelho' : 'verde'} />
        <Bloco rotulo="Margem bruta" valor={minimo.margem_pct === null ? '—' : pct(minimo.margem_pct)}
          detalhe={metas.margem_pct ? `meta ${pct(metas.margem_pct, 0)}` : undefined}
          tom={metas.margem_pct && minimo.margem_pct !== null ? (minimo.margem_pct >= metas.margem_pct ? 'verde' : 'vermelho') : undefined} />
        <Bloco rotulo="Ticket médio" valor={brl(ind.ticket_medio)}
          detalhe={metas.ticket_medio ? `meta ${brl(metas.ticket_medio)}` : undefined}
          tom={metas.ticket_medio ? (ind.ticket_medio >= metas.ticket_medio ? 'verde' : 'vermelho') : undefined} />
        <Bloco rotulo="Mínimo por dia" valor={minimo.por_dia === null ? '—' : brl(minimo.por_dia)}
          detalhe={meta.por_dia !== null ? `meta ${brl(meta.por_dia)}/dia` : 'seg a sáb'} />
      </div>

      <details className="mt-3 text-xs text-gray-600">
        <summary className="cursor-pointer select-none min-h-[32px] flex items-center">Como o mínimo é calculado</summary>
        <div className="mt-2 space-y-1">
          <p>Mínimo = custos do mês ÷ (margem bruta − custo líquido do cartão). A mercadoria já está descontada na margem.</p>
          <LinhaValor rotulo="Custos do mês (despesas fixas)" valor={brl(minimo.custos_mes)} />
          {Object.entries(minimo.composicao).filter(([, v]) => v > 0).map(([g, v]) => (
            <LinhaValor key={g} rotulo={<span className="pl-3">{ROTULO_GRUPO[g] ?? g}</span>} valor={brl(v)} />
          ))}
          <LinhaValor rotulo="Margem bruta do mês" valor={minimo.margem_pct === null ? '—' : pct(minimo.margem_pct)} />
          <LinhaValor rotulo="Custo líquido do cartão (após reembolso Votoran)" valor={pct(minimo.custo_cartao_pct, 2)} />
          <p className="text-gray-500">Os custos vêm de Despesas fixas: ajuste lá para o mínimo acompanhar.</p>
        </div>
      </details>

      {editando && <ModalMetas metas={metas} onFechar={() => setEditando(false)} onSalvo={() => { setEditando(false); onSalvo(); }} />}
    </Cartao>
  );
}

function Marca({ left, rotulo, cor }: { left: string; rotulo: string; cor: string }) {
  return (
    <div className="absolute -top-1 -bottom-1 w-0.5" style={{ left }}>
      <div className={`h-full w-0.5 ${cor}`} />
      <span className="absolute top-full mt-0.5 -translate-x-1/2 text-[10px] font-medium text-gray-600 whitespace-nowrap">{rotulo}</span>
    </div>
  );
}

function Bloco({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: 'verde' | 'vermelho' }) {
  const cor = tom === 'verde' ? 'text-emerald-700' : tom === 'vermelho' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-0">
      <p className="text-[11px] text-gray-500">{rotulo}</p>
      <p className={`text-base font-bold tabular-nums ${cor}`}>{valor}</p>
      {detalhe && <p className="text-[11px] text-gray-500">{detalhe}</p>}
    </div>
  );
}

function ModalMetas({ metas, onFechar, onSalvo }: { metas: MetasFinanceiras; onFechar: () => void; onSalvo: () => void }) {
  const [fat, setFat] = useState<number | null>(metas.faturamento_mes);
  const [ticket, setTicket] = useState<number | null>(metas.ticket_medio);
  const [margem, setMargem] = useState<number | null>(metas.margem_pct);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/metas', { method: 'PUT', body: JSON.stringify({ faturamento_mes: fat, ticket_medio: ticket, margem_pct: margem }) });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal titulo="Metas" onFechar={onFechar}
      rodape={<><BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario><BotaoPrimario onClick={salvar} carregando={salvando}>Salvar</BotaoPrimario></>}>
      <p className="text-xs text-gray-500">Valem para todos os meses até você mudar. Deixe vazio para não acompanhar.</p>
      <Campo rotulo="Faturamento por mês"><CampoMoeda value={fat} onChange={setFat} autoFocus /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Ticket médio"><CampoMoeda value={ticket} onChange={setTicket} /></Campo>
        <Campo rotulo="Margem bruta"><CampoNumero value={margem} onChange={setMargem} min={0} max={99} sufixo="%" /></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
