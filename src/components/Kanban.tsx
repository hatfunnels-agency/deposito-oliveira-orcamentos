// Pecas do quadro Kanban das paginas /tarefas e /atendimento. Sem estado e
// sem 'use client' — funcionam dentro de server components.
import type { ReactNode } from 'react';

export type CorColuna = 'amarelo' | 'laranja' | 'azul' | 'verde' | 'vermelho' | 'cinza';

const CORES: Record<CorColuna, { faixa: string; bolinha: string; contador: string }> = {
  amarelo: { faixa: 'border-t-amber-400', bolinha: 'bg-amber-400', contador: 'bg-amber-100 text-amber-800' },
  laranja: { faixa: 'border-t-[#F7941D]', bolinha: 'bg-[#F7941D]', contador: 'bg-orange-100 text-orange-800' },
  azul: { faixa: 'border-t-sky-500', bolinha: 'bg-sky-500', contador: 'bg-sky-100 text-sky-800' },
  verde: { faixa: 'border-t-emerald-500', bolinha: 'bg-emerald-500', contador: 'bg-emerald-100 text-emerald-800' },
  vermelho: { faixa: 'border-t-red-500', bolinha: 'bg-red-500', contador: 'bg-red-100 text-red-800' },
  cinza: { faixa: 'border-t-gray-400', bolinha: 'bg-gray-400', contador: 'bg-gray-200 text-gray-700' },
};

// Quadro: no celular as colunas correm de lado (uma por tela, com encaixe);
// no computador ficam lado a lado.
export function Quadro({ colunas, children }: { colunas: number; children: ReactNode }) {
  const grade = colunas >= 4 ? 'lg:grid-cols-4' : colunas === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';
  return (
    <div className={`-mx-4 px-4 flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 lg:mx-0 lg:px-0 lg:grid ${grade} lg:overflow-visible`}>
      {children}
    </div>
  );
}

export function Coluna({ titulo, dica, cor, quantidade, vazio, children }: {
  titulo: string;
  dica?: string;
  cor: CorColuna;
  quantidade: number;
  vazio: string;
  children?: ReactNode;
}) {
  const c = CORES[cor];
  return (
    <section className={`snap-start shrink-0 w-[85vw] sm:w-[22rem] lg:w-auto flex flex-col rounded-2xl bg-gray-100/80 border border-gray-200 border-t-4 ${c.faixa}`}>
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${c.bolinha}`} />
          <h2 className="text-sm font-bold text-gray-800">{titulo}</h2>
          <span className={`ml-auto text-xs font-semibold rounded-full px-2 py-0.5 ${c.contador}`}>{quantidade}</span>
        </div>
        {dica && <p className="text-xs text-gray-500 mt-1 leading-snug">{dica}</p>}
      </header>
      <div className="flex flex-col gap-2 px-2 pb-2 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
        {quantidade === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-xs text-gray-500">{vazio}</div>
        ) : children}
      </div>
    </section>
  );
}

export function Selo({ texto, forte }: { texto: string; forte?: boolean }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
      forte ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-[#C96F00] border-orange-200'
    }`}>{texto}</span>
  );
}

export function BotaoWhatsApp({ href, texto = 'Abrir WhatsApp' }: { href: string; texto?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold bg-[#25D366] text-white rounded-lg px-3 py-2 hover:brightness-95 transition"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
        <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4C2.7 15.6 2.2 13.8 2.2 12 2.2 6.6 6.6 2.2 12 2.2S21.8 6.6 21.8 12 17.4 21.8 12 21.8zM12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.8 1 3.8 1.5 5.8 1.5 6.6 0 12-5.4 12-12S18.6 0 12 0z" />
      </svg>
      {texto}
    </a>
  );
}

export function telefoneBonito(t: string | null | undefined): string {
  if (!t) return '';
  const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

// api.whatsapp.com e nao wa.me: o redirect do wa.me troca emoji por "�".
export function linkWhatsApp(telefone: string, texto?: string): string {
  const d = telefone.replace(/\D/g, '');
  const numero = d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
  return `https://api.whatsapp.com/send?phone=${numero}${texto ? `&text=${encodeURIComponent(texto)}` : ''}`;
}
