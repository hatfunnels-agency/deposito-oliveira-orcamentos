'use client';

import {
  cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import Link from 'next/link';
import { X, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle, Info } from 'lucide-react';
import type { ContextoFinanceiro, Fornecedor } from '@/lib/financeiro/tipos';
import { hojeBRT, mesBRT, parseMoeda, rotuloMes, somarDiasISO, somarMeses } from '@/lib/financeiro/formato';

// Pecas compartilhadas da tela /financeiro. Mobile first: a atendente e o
// Roger usam no celular, entao botao de acao tem >= 44px e fica a direita.

export const INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D] disabled:bg-gray-50 disabled:text-gray-500';
export const LABEL = 'block text-xs font-medium text-gray-600 mb-1';

// ---------------------------------------------------------------- contexto

export interface ValorContextoFinanceiro {
  contexto: ContextoFinanceiro | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

const PADRAO: ValorContextoFinanceiro = { contexto: null, carregando: false, erro: null, recarregar: () => {} };
const Ctx = createContext<ValorContextoFinanceiro>(PADRAO);

export function ContextoFinanceiroProvider({ value, children }: { value: ValorContextoFinanceiro; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Fora do provider (ex.: ClientesAReceber dentro do app principal) devolve o
// padrao vazio em vez de quebrar.
export function useContextoFinanceiro(): ValorContextoFinanceiro {
  return useContext(Ctx);
}

// ---------------------------------------------------------------- layout

export function Cartao({ titulo, descricao, selo, acao, children, className = '', id }: {
  titulo?: ReactNode; descricao?: ReactNode; selo?: ReactNode; acao?: ReactNode;
  children?: ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${className}`}>
      {(titulo || acao) && (
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="min-w-0">
            {titulo && (
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 flex-wrap">
                {titulo}
                {selo}
              </h3>
            )}
            {descricao && <p className="text-xs text-gray-500 mt-0.5">{descricao}</p>}
          </div>
          {acao && <div className="flex items-center gap-2 ml-auto">{acao}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// Cartao de numero (stat tile): rotulo, valor, detalhe e selo de qualidade.
export function Estatistica({ rotulo, valor, detalhe, tom = 'neutro', selo, className = '' }: {
  rotulo: ReactNode; valor: ReactNode; detalhe?: ReactNode; selo?: ReactNode;
  tom?: 'neutro' | 'verde' | 'vermelho' | 'laranja' | 'azul' | 'amarelo'; className?: string;
}) {
  const cores: Record<string, string> = {
    neutro: 'border-gray-100 text-gray-900',
    verde: 'border-emerald-100 text-emerald-800',
    vermelho: 'border-red-100 text-red-700',
    laranja: 'border-orange-100 text-[#C96F00]',
    azul: 'border-blue-100 text-blue-800',
    amarelo: 'border-amber-200 text-amber-900',
  };
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-3 min-w-0 ${cores[tom]} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-500 truncate">{rotulo}</p>
        {selo}
      </div>
      <p className="text-lg font-bold mt-1 leading-tight break-words">{valor}</p>
      {detalhe && <p className="text-[11px] text-gray-500 mt-0.5">{detalhe}</p>}
    </div>
  );
}

export function LinhaValor({ rotulo, valor, destaque = false, tom, selo, className = '' }: {
  rotulo: ReactNode; valor: ReactNode; destaque?: boolean; selo?: ReactNode;
  tom?: 'verde' | 'vermelho' | 'cinza'; className?: string;
}) {
  const cor = tom === 'verde' ? 'text-emerald-700' : tom === 'vermelho' ? 'text-red-700' : tom === 'cinza' ? 'text-gray-500' : 'text-gray-900';
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${destaque ? 'border-t border-gray-200 font-bold' : ''} ${className}`}>
      <span className={`min-w-0 flex items-center gap-2 ${destaque ? 'text-gray-800' : 'text-gray-600'}`}>{rotulo}{selo}</span>
      <span className={`shrink-0 tabular-nums ${cor}`}>{valor}</span>
    </div>
  );
}

export function Campo({ rotulo, children, dica, className = '' }: { rotulo: ReactNode; children: ReactNode; dica?: ReactNode; className?: string }) {
  // Rotulo ligado ao campo: tocar no texto foca o input e o leitor de tela
  // le o nome. O filho ganha o id se ainda nao tiver um.
  const id = useId();
  const filho = isValidElement<{ id?: string }>(children) && !children.props.id
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL}>{rotulo}</label>
      {filho}
      {dica && <p className="text-[11px] text-gray-500 mt-1">{dica}</p>}
    </div>
  );
}

export function Selo({ children, tom = 'cinza', className = '', titulo }: {
  children: ReactNode; className?: string; titulo?: string;
  tom?: 'cinza' | 'verde' | 'vermelho' | 'amarelo' | 'azul' | 'laranja' | 'roxo';
}) {
  const cores: Record<string, string> = {
    cinza: 'bg-gray-100 text-gray-700 border-gray-200',
    verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    vermelho: 'bg-red-50 text-red-700 border-red-200',
    amarelo: 'bg-amber-50 text-amber-800 border-amber-200',
    azul: 'bg-blue-50 text-blue-700 border-blue-200',
    laranja: 'bg-orange-50 text-orange-800 border-orange-200',
    roxo: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <span title={titulo} className={`inline-flex items-center text-[11px] leading-4 px-2 py-0.5 rounded-full border whitespace-nowrap ${cores[tom]} ${className}`}>
      {children}
    </span>
  );
}

export function Aviso({ tom = 'info', children, className = '' }: { tom?: 'info' | 'alerta' | 'erro' | 'ok'; children: ReactNode; className?: string }) {
  const cores: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    alerta: 'bg-amber-50 border-amber-200 text-amber-900',
    erro: 'bg-red-50 border-red-200 text-red-800',
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  const Icone = tom === 'info' || tom === 'ok' ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 text-sm border rounded-lg px-3 py-2 ${cores[tom]} ${className}`}>
      <Icone className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Vazio({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-center py-8 text-gray-400 text-sm ${className}`}>{children}</div>;
}

export function Carregando({ texto = 'Carregando…', className = '' }: { texto?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-gray-400 text-sm ${className}`}>
      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#F7941D]" />
      {texto}
    </div>
  );
}

export function Erro({ mensagem, onTentar, className = '' }: { mensagem: string; onTentar?: () => void; className?: string }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3 ${className}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 hidden sm:block" />
      <span className="flex-1 min-w-0 break-words">{mensagem}</span>
      {onTentar && (
        <button type="button" onClick={onTentar}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-red-300 bg-white text-red-700 font-medium hover:bg-red-100 sm:ml-auto">
          <RefreshCw className="w-4 h-4" /> Tentar de novo
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- botoes

type PropsBotao = ButtonHTMLAttributes<HTMLButtonElement> & { carregando?: boolean };

export function BotaoPrimario({ carregando = false, className = '', children, disabled, ...rest }: PropsBotao) {
  return (
    <button type="button" {...rest} disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[#F7941D] text-white text-sm font-semibold hover:bg-[#E8850A] transition disabled:opacity-50 disabled:cursor-not-allowed ${className}`}>
      {carregando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
      {children}
    </button>
  );
}

export function BotaoSecundario({ carregando = false, className = '', children, disabled, ...rest }: PropsBotao) {
  return (
    <button type="button" {...rest} disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed ${className}`}>
      {children}
    </button>
  );
}

export function BotaoPerigo({ carregando = false, className = '', children, disabled, ...rest }: PropsBotao) {
  return (
    <button type="button" {...rest} disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-medium hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed ${className}`}>
      {children}
    </button>
  );
}

// Abas em pilula (filtros). Contagem opcional entre parenteses.
export function Abas<T extends string>({ opcoes, valor, onChange, className = '' }: {
  opcoes: Array<{ key: T; rotulo: string; contagem?: number }>; valor: T; onChange: (k: T) => void; className?: string;
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 ${className}`}>
      {opcoes.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`shrink-0 text-sm min-h-[40px] px-3 rounded-lg transition ${valor === o.key ? 'bg-[#F7941D] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {o.rotulo}{o.contagem !== undefined ? ` (${o.contagem})` : ''}
        </button>
      ))}
    </div>
  );
}

export function LinkSecao({ secao, children, className = '' }: { secao: string; children: ReactNode; className?: string }) {
  return (
    <Link href={`/financeiro?secao=${secao}`} className={`text-[#C96F00] hover:underline ${className}`}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- modal

export function Modal({ titulo, onFechar, children, largura = 'sm', rodape }: {
  titulo: ReactNode; onFechar: () => void; children: ReactNode; largura?: 'sm' | 'md' | 'lg'; rodape?: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);
  const max = largura === 'lg' ? 'sm:max-w-2xl' : largura === 'md' ? 'sm:max-w-lg' : 'sm:max-w-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-modal="true" className={`bg-white rounded-t-2xl sm:rounded-2xl w-full ${max} max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h3 className="font-bold text-gray-800 text-base">{titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto space-y-3">{children}</div>
        {rodape && <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2 justify-end">{rodape}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- campos

// Digita "1.234,56"; devolve numero (ou null quando vazio). Formata ao sair.
export function CampoMoeda({ value, onChange, placeholder = '0,00', className = '', autoFocus, disabled, id }: {
  value: number | null; onChange: (n: number | null) => void; placeholder?: string;
  className?: string; autoFocus?: boolean; disabled?: boolean; id?: string;
}) {
  const formatar = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [texto, setTexto] = useState(value === null ? '' : formatar(value));
  const focado = useRef(false);
  useEffect(() => {
    if (!focado.current) setTexto(value === null ? '' : formatar(value));
  }, [value]);
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">R$</span>
      <input id={id} type="text" inputMode="decimal" value={texto} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled}
        onFocus={() => { focado.current = true; }}
        onChange={e => { setTexto(e.target.value); onChange(parseMoeda(e.target.value)); }}
        onBlur={() => { focado.current = false; if (value !== null) setTexto(formatar(value)); }}
        className={`${INPUT} pl-9 tabular-nums`} />
    </div>
  );
}

export function CampoNumero({ value, onChange, min, max, sufixo, className = '', disabled, placeholder, id }: {
  value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; step?: number;
  sufixo?: string; className?: string; disabled?: boolean; placeholder?: string; id?: string;
}) {
  // Texto, nao type="number": no iOS/Safari a virgula do teclado brasileiro
  // deixava o input em badInput e o valor chegava como null -> taxa 0.
  const formatar = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const [texto, setTexto] = useState(value === null ? '' : formatar(value));
  const focado = useRef(false);
  useEffect(() => {
    if (!focado.current) setTexto(value === null ? '' : formatar(value));
  }, [value]);
  const limitar = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <div className={`relative ${className}`}>
      <input id={id} type="text" inputMode="decimal" value={texto} disabled={disabled} placeholder={placeholder}
        onFocus={() => { focado.current = true; }}
        onChange={e => { setTexto(e.target.value); onChange(parseMoeda(e.target.value)); }}
        onBlur={() => {
          focado.current = false;
          if (value === null) { setTexto(''); return; }
          const n = limitar(value);
          if (n !== value) onChange(n);
          setTexto(formatar(n));
        }}
        className={`${INPUT} ${sufixo ? 'pr-9' : ''} tabular-nums`} />
      {sufixo && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">{sufixo}</span>}
    </div>
  );
}

// Ultimos N meses (e, opcionalmente, alguns futuros) como 'out/2026'.
export function SeletorMes({ value, onChange, quantidade = 14, futuros = 0, className = '' }: {
  value: string; onChange: (mes: string) => void; quantidade?: number; futuros?: number; className?: string;
}) {
  const atual = mesBRT();
  const meses: string[] = [];
  for (let i = futuros; i > 0; i--) meses.push(somarMeses(atual, i));
  for (let i = 0; i < quantidade; i++) meses.push(somarMeses(atual, -i));
  if (!meses.includes(value)) meses.push(value);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${INPUT} w-auto min-h-[40px] ${className}`}>
      {meses.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
    </select>
  );
}

export function SeletorData({ value, onChange, className = '', comHoje = true }: {
  value: string; onChange: (d: string) => void; className?: string; comHoje?: boolean;
}) {
  const hoje = hojeBRT();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button type="button" aria-label="Dia anterior" onClick={() => onChange(somarDiasISO(value, -1))}
        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)}
        className={`${INPUT} w-auto min-h-[40px]`} />
      <button type="button" aria-label="Dia seguinte" onClick={() => onChange(somarDiasISO(value, 1))}
        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
        <ChevronRight className="w-4 h-4" />
      </button>
      {comHoje && value !== hoje && (
        <button type="button" onClick={() => onChange(hoje)} className="text-xs text-[#C96F00] hover:underline px-2 min-h-[40px]">hoje</button>
      )}
    </div>
  );
}

// Parcelas do cartao de credito. Sem default silencioso: comeca vazio e quem
// usa valida `value !== null` antes de enviar (3.067 pagamentos nasceram com
// parcelas=1 porque a UI nunca pediu).
export function SeletorParcelas({ metodo, value, onChange, className = '', obrigatorio = true }: {
  metodo: string; value: number | null; onChange: (n: number | null) => void; className?: string; obrigatorio?: boolean;
}) {
  if (metodo !== 'credito') return null;
  return (
    <select aria-label="Parcelas" required={obrigatorio} value={value === null ? '' : String(value)}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className={`${className || INPUT} ${value === null && obrigatorio ? 'border-amber-400' : ''}`}>
      <option value="">— parcelas —</option>
      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}x</option>)}
    </select>
  );
}

// Fornecedor com busca (datalist). Nome novo = cria ao salvar (fornecedor_nome).
export interface EscolhaFornecedor { id: string | null; nome: string }

export function CampoFornecedor({ fornecedores, value, onChange, className = '', placeholder = 'Buscar ou digitar novo', id }: {
  fornecedores: Fornecedor[]; value: EscolhaFornecedor; onChange: (f: EscolhaFornecedor, fornecedor: Fornecedor | null) => void;
  className?: string; placeholder?: string; id?: string;
}) {
  // useId: estavel entre servidor e cliente (Math.random num ref quebrava a
  // hidratacao e a regra de pureza do React Compiler).
  const listaId = `forn-${useId()}`;
  const ativos = fornecedores.filter(f => f.ativo || f.id === value.id);
  return (
    <div className={className}>
      <input id={id} list={listaId} value={value.nome} placeholder={placeholder}
        onChange={e => {
          const nome = e.target.value;
          const achado = ativos.find(f => f.nome.toLowerCase() === nome.trim().toLowerCase()) ?? null;
          onChange({ id: achado?.id ?? null, nome }, achado);
        }}
        className={INPUT} />
      <datalist id={listaId}>
        {ativos.map(f => <option key={f.id} value={f.nome} />)}
      </datalist>
      {value.nome.trim() && !value.id && (
        <p className="text-[11px] text-amber-700 mt-1">Fornecedor novo: será criado ao salvar.</p>
      )}
    </div>
  );
}
