'use client';

import { useEffect, useRef, useState } from 'react';

// Pedreiro / empreiteiro ao lado do nome do cliente, marcado com um toque.
// Sao clientes de relacionamento (brindes, desconto, mensagens frequentes e,
// no futuro, lista de transmissao). Guarda nas tags 'pedreiro' e
// 'empreiteiro' de cliente_tags — a tag sozinha ficava escondida no perfil.

const TIPOS = [
  { tag: 'pedreiro', rotulo: 'Pedreiro', icone: '🧱' },
  { tag: 'empreiteiro', rotulo: 'Empreiteiro', icone: '👷' },
] as const;
type Tag = (typeof TIPOS)[number]['tag'];

export default function TipoProfissional({ clienteId, compacto = false }: { clienteId: string; compacto?: boolean }) {
  const [marcadas, setMarcadas] = useState<Set<Tag> | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState<Tag | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/clientes/${clienteId}/tags`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!vivo) return;
        const tags = ((d?.tags ?? []) as Array<{ tag: string }>).map(t => t.tag);
        setMarcadas(new Set(TIPOS.map(t => t.tag).filter(t => tags.includes(t))));
      })
      .catch(() => { if (vivo) setMarcadas(new Set()); });
    return () => { vivo = false; };
  }, [clienteId]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const alternar = async (tag: Tag) => {
    if (!marcadas) return;
    const tem = marcadas.has(tag);
    setSalvando(tag);
    try {
      const res = tem
        ? await fetch(`/api/clientes/${clienteId}/tags/${tag}`, { method: 'DELETE' })
        : await fetch(`/api/clientes/${clienteId}/tags`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, origem: 'manual' }),
          });
      if (res.ok || res.status === 409) {
        const nova = new Set(marcadas);
        if (tem) nova.delete(tag); else nova.add(tag);
        setMarcadas(nova);
      }
    } finally {
      setSalvando(null);
    }
  };

  if (!marcadas) return null;
  const ativos = TIPOS.filter(t => marcadas.has(t.tag));

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1 align-middle" onClick={e => e.stopPropagation()}>
      {ativos.map(t => (
        <button key={t.tag} type="button" onClick={() => setAberto(a => !a)} title="Tipo de cliente (toque para mudar)"
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200">
          {t.icone} {t.rotulo}
        </button>
      ))}
      {ativos.length === 0 && (
        <button type="button" onClick={() => setAberto(a => !a)} title="Marcar como pedreiro ou empreiteiro"
          className="inline-flex items-center rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-[#F7941D] hover:text-[#C96F00]">
          {compacto ? '+ tipo' : '+ Pedreiro / Empreiteiro'}
        </button>
      )}
      {aberto && (
        <span className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          {TIPOS.map(t => (
            <label key={t.tag} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <input type="checkbox" checked={marcadas.has(t.tag)} disabled={salvando !== null}
                onChange={() => alternar(t.tag)} className="h-4 w-4 accent-[#F7941D]" />
              {t.icone} {t.rotulo}
            </label>
          ))}
        </span>
      )}
    </span>
  );
}
