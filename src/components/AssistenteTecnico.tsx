'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Send, Trash2, X } from 'lucide-react';

// Botao "Duvidas" flutuante no sistema: abre um chat com o assistente tecnico
// (produtos, contas de obra, como fazer no sistema). Historico fica no
// navegador. Nada aqui grava no banco.

interface Msg { papel: 'usuario' | 'assistente'; texto: string }

const CHAVE = 'depo:assistente-tecnico';
const SUGESTOES = [
  'Quantas latas tem um metro de areia?',
  'Quantas telhas 2,44x1,10 para 40 m²?',
  'Laje 3x4 de forro: qual kit e quanto de cimento?',
  'O que perguntar pra orçar coluna de ferro?',
  'Como marco uma entrega parcial?',
  'Medidas do tijolo baianão',
];

// Markdown bem simples: **negrito** e listas com "-".
function Texto({ t }: { t: string }) {
  const linhas = t.split('\n');
  return (
    <div className="space-y-1">
      {linhas.map((l, i) => {
        const partes = l.split(/(\*\*[^*]+\*\*)/g).map((p, k) =>
          p.startsWith('**') && p.endsWith('**') ? <b key={k}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
        const lista = /^\s*[-•]\s+/.test(l);
        return lista
          ? <p key={i} className="pl-3 relative"><span className="absolute left-0">•</span>{partes.map((p, k) => k === 0 && typeof p.props.children === 'string' ? <span key={k}>{String(p.props.children).replace(/^\s*[-•]\s+/, '')}</span> : p)}</p>
          : <p key={i} className={l.trim() ? '' : 'h-1'}>{partes}</p>;
      })}
    </div>
  );
}

export default function AssistenteTecnico() {
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(CHAVE); if (s) setMsgs(JSON.parse(s)); } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(msgs.slice(-30))); } catch { /* */ }
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, aberto]);

  const enviar = async (pergunta?: string) => {
    const q = (pergunta ?? texto).trim();
    if (!q || carregando) return;
    setTexto('');
    setErro(null);
    const novas: Msg[] = [...msgs, { papel: 'usuario', texto: q }];
    setMsgs(novas);
    setCarregando(true);
    try {
      const r = await fetch('/api/assistente-tecnico', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: novas.slice(-12) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Erro ao perguntar');
      setMsgs(m => [...m, { papel: 'assistente', texto: String(d.resposta || '') }]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao perguntar');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setAberto(a => !a)} title="Dúvidas de produto, obra e sistema"
        className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-slate-700 print:hidden">
        <CircleHelp size={18} /> Dúvidas
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-end justify-end sm:p-4 print:hidden" onClick={() => setAberto(false)}>
          <div className="flex h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:h-[600px] sm:w-[420px] sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="font-bold text-gray-800">Assistente técnico</p>
                <p className="text-[11px] text-gray-500">Produtos, contas de obra e como fazer no sistema</p>
              </div>
              <div className="flex items-center gap-1">
                {msgs.length > 0 && (
                  <button type="button" onClick={() => { setMsgs([]); setErro(null); }} title="Limpar conversa" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Trash2 size={16} /></button>
                )}
                <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
              {msgs.length === 0 && (
                <div>
                  <p className="text-gray-600 mb-2">Pergunte como se fosse para uma colega. Exemplos:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGESTOES.map(s => (
                      <button key={s} type="button" onClick={() => enviar(s)}
                        className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-[#F7941D] hover:text-[#C96F00]">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`max-w-[92%] rounded-2xl px-3 py-2 ${m.papel === 'usuario' ? 'ml-auto bg-[#F7941D] text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <Texto t={m.texto} />
                </div>
              ))}
              {carregando && <p className="text-xs text-gray-400">Pensando…</p>}
              {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}
              <div ref={fim} />
            </div>

            <div className="flex items-end gap-2 border-t border-gray-100 p-3">
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Sua dúvida…" className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              <button type="button" onClick={() => enviar()} disabled={carregando || !texto.trim()} aria-label="Enviar"
                className="rounded-xl bg-[#F7941D] p-2.5 text-white hover:bg-[#E8850A] disabled:opacity-50"><Send size={18} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
