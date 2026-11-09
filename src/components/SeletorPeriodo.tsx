'use client';

import { useEffect, useState } from 'react';
import type { PeriodoEntrega } from '@/lib/aviso-entrega';

// Manha (8h-12h) ou tarde (13h-17h), com quantas entregas o periodo ja tem
// contra o teto (configuracoes.entregas_capacidade_periodo). Periodo cheio
// pede confirmacao antes de marcar: a atendente ve que esta passando do que
// os caminhoes dao conta, em vez de descobrir no dia.

type Vagas = { capacidade: number; manha: number; tarde: number; sem_periodo: number };

const OPCOES: Array<{ valor: PeriodoEntrega; rotulo: string; faixa: string }> = [
  { valor: 'manha', rotulo: 'Manhã', faixa: '8h–12h' },
  { valor: 'tarde', rotulo: 'Tarde', faixa: '13h–17h' },
];

export default function SeletorPeriodo({ data, valor, onChange, ignorarId }: {
  data: string;
  valor: PeriodoEntrega | '';
  onChange: (p: PeriodoEntrega | '') => void;
  // Pedido que esta sendo editado/reagendado: nao conta ele mesmo.
  ignorarId?: string | null;
}) {
  const [vagas, setVagas] = useState<Vagas | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { setVagas(null); return; }
    let vivo = true;
    const q = new URLSearchParams({ data });
    if (ignorarId) q.set('ignorar', ignorarId);
    fetch(`/api/entregas/vagas?${q}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (vivo) setVagas(d && typeof d.capacidade === 'number' ? d : null); })
      .catch(() => { if (vivo) setVagas(null); });
    return () => { vivo = false; };
  }, [data, ignorarId]);

  const escolher = (p: PeriodoEntrega) => {
    if (valor === p) return;
    const usadas = vagas ? vagas[p] : 0;
    if (vagas && usadas >= vagas.capacidade) {
      const dia = data.split('-').reverse().join('/');
      const ok = window.confirm(`A ${p === 'manha' ? 'manhã' : 'tarde'} de ${dia} já tem ${usadas} de ${vagas.capacidade} entregas.\n\nAgendar mesmo assim? Os caminhões podem não dar conta.`);
      if (!ok) return;
    }
    onChange(p);
  };

  if (!data) return null;
  return (
    <div className="mt-1.5">
      <span className="block text-xs font-medium text-gray-600 mb-1">Período</span>
      <div className="grid grid-cols-2 gap-2">
        {OPCOES.map(o => {
          const usadas = vagas ? vagas[o.valor] : null;
          const cheio = vagas != null && usadas != null && usadas >= vagas.capacidade;
          const ativo = valor === o.valor;
          return (
            <button key={o.valor} type="button" onClick={() => escolher(o.valor)}
              className={`rounded-lg border px-2 py-1.5 text-left text-sm transition min-h-[44px] ${
                ativo ? 'border-[#F7941D] bg-[#FFF3E6] ring-1 ring-[#F7941D]' : 'border-gray-300 bg-white hover:bg-gray-50'}`}>
              <span className="font-semibold text-gray-800">{o.rotulo}</span>
              <span className="text-gray-500 text-xs"> {o.faixa}</span>
              {usadas != null && vagas && (
                <span className={`block text-xs font-medium ${cheio ? 'text-red-600' : 'text-gray-500'}`}>
                  {cheio ? `Lotado · ${usadas}/${vagas.capacidade}` : `${usadas}/${vagas.capacidade} agendadas`}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {vagas && vagas.sem_periodo > 0 && (
        <p className="mt-1 text-[11px] text-gray-500">+ {vagas.sem_periodo} entrega(s) nesse dia sem período definido.</p>
      )}
    </div>
  );
}
