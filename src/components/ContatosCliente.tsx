'use client';

import { useCallback, useEffect, useState } from 'react';

// Ultimo contato com o cliente (data + do que se falou) e o historico.
// `compacto`: uma linha so, para o cartao do cliente no orcamento/pedido.
// Completo (perfil): historico + "Registrar contato".

interface Contato { id: string; data: string; origem: 'conversa' | 'robo' | 'atendente'; canal: string; resumo: string }

const ORIGEM: Record<Contato['origem'], string> = { conversa: '💬 conversa', robo: '🤖 robô', atendente: '🙋 atendente' };
const CANAIS = [
  { v: 'whatsapp', l: 'WhatsApp' }, { v: 'ligacao', l: 'Ligação' }, { v: 'loja', l: 'Na loja' }, { v: 'visita', l: 'Visita' }, { v: 'outro', l: 'Outro' },
];

function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const dias = Math.floor((Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return dias <= 0 ? `hoje` : dias === 1 ? `ontem (${data})` : `${data} · há ${dias} dias`;
}

export default function ContatosCliente({ clienteId, compacto = false }: { clienteId: string; compacto?: boolean }) {
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [notas, setNotas] = useState<string | null>(null);
  const [resumo, setResumo] = useState('');
  const [canal, setCanal] = useState('whatsapp');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const carregar = useCallback(() => {
    fetch(`/api/clientes/${clienteId}/contatos?limite=${compacto ? 1 : 30}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { setContatos((d?.contatos ?? []) as Contato[]); setNotas(d?.notas_contexto ?? null); })
      .catch(() => setContatos([]));
  }, [clienteId, compacto]);
  useEffect(() => { carregar(); }, [carregar]);

  if (contatos === null) return null;
  const ultimo = contatos[0];

  if (compacto) {
    return (
      <div className="mt-1 space-y-0.5 text-xs text-gray-600">
        <p>
          <span className="font-semibold text-gray-700">Último contato:</span>{' '}
          {ultimo ? <>{quando(ultimo.data)} — {ultimo.resumo}</> : <span className="text-gray-400">nenhum registrado</span>}
        </p>
        {notas && <p><span className="font-semibold text-gray-700">Contexto:</span> {notas}</p>}
      </div>
    );
  }

  const salvar = async () => {
    setErro(null);
    if (!resumo.trim()) { setErro('Escreva do que foi o contato.'); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/contatos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumo: resumo.trim(), canal }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Erro ao registrar');
      setResumo('');
      carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar');
    } finally {
      setSalvando(false);
    }
  };

  const lista = verTodos ? contatos : contatos.slice(0, 5);
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
        <p className="text-xs text-gray-500">Último contato</p>
        {ultimo
          ? <p className="text-sm text-gray-800"><b>{quando(ultimo.data)}</b> — {ultimo.resumo}</p>
          : <p className="text-sm text-gray-400">Nenhum contato registrado ainda.</p>}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={canal} onChange={e => setCanal(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm sm:w-32">
          {CANAIS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
        <input value={resumo} onChange={e => setResumo(e.target.value)} maxLength={500}
          onKeyDown={e => { if (e.key === 'Enter') salvar(); }}
          placeholder="Registrar contato: do que vocês falaram?" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={salvar} disabled={salvando} className="bg-[#F7941D] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#E8850A] disabled:opacity-60">
          {salvando ? '...' : 'Registrar'}
        </button>
      </div>
      {erro && <p className="text-xs text-red-700">{erro}</p>}
      {contatos.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {lista.map(c => (
            <li key={c.id} className="py-1.5 text-sm">
              <span className="text-xs text-gray-500">{new Date(c.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} · {ORIGEM[c.origem]}</span>
              <p className="text-gray-700">{c.resumo}</p>
            </li>
          ))}
        </ul>
      )}
      {contatos.length > 5 && (
        <button onClick={() => setVerTodos(v => !v)} className="text-xs font-semibold text-[#F7941D] hover:underline">
          {verTodos ? 'Ver menos' : `Ver todos (${contatos.length})`}
        </button>
      )}
    </div>
  );
}
