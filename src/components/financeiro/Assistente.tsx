'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Send, Square, Trash2, Sparkles } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { Aviso, BotaoSecundario, Cartao } from './Comuns';

// Assistente da gestao: chat com o Claude, que consulta as ferramentas de
// /api/financeiro/assistente. A conversa fica so neste navegador
// (localStorage) e vai inteira, em texto, a cada pergunta.

interface Mensagem {
  papel: 'usuario' | 'assistente';
  texto: string;
  ferramentas?: string[];
  aviso?: string;
  erro?: boolean;
}

const CHAVE_STORAGE = 'financeiro.assistente.conversa.v1';
const MAX_GUARDADAS = 40;

const SUGESTOES = [
  'Quanto vendi ontem?',
  'Qual cliente mais comprou este mês?',
  'Quanto tenho a pagar esta semana?',
  'Qual a margem da areia?',
  'Como fechou setembro?',
  'Quanto paguei de taxa na maquininha este mês?',
  'Quem me deve?',
  'Quanto de cimento vendi nos últimos 30 dias?',
];

const ROTULO_FERRAMENTA: Record<string, string> = {
  panorama_hoje: 'panorama',
  fechamento_mes: 'fechamento',
  vendas: 'vendas',
  produto: 'produtos',
  clientes: 'clientes',
  a_receber: 'a receber',
  contas_a_pagar: 'contas a pagar',
  despesas_fixas: 'despesas fixas',
  saldos: 'saldos',
  maquininha: 'maquininha',
  extrato: 'extrato',
  folha: 'folha',
};
const rotular = (nomes: string[]) => [...new Set(nomes.map(n => ROTULO_FERRAMENTA[n] ?? n))].join(', ');

function lerConversa(): Mensagem[] {
  try {
    const bruto = localStorage.getItem(CHAVE_STORAGE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista)
      ? lista.filter((m): m is Mensagem => m && (m.papel === 'usuario' || m.papel === 'assistente') && typeof m.texto === 'string')
      : [];
  } catch {
    return [];
  }
}

function guardarConversa(msgs: Mensagem[]) {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(msgs.slice(-MAX_GUARDADAS)));
  } catch { /* modo privado / cheio: segue sem guardar */ }
}

// ---------------------------------------------------------------- markdown simples

function inline(texto: string, chave: string): ReactNode[] {
  // **negrito**, `codigo`, *italico*
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return partes.filter(Boolean).map((p, i) => {
    const k = `${chave}-${i}`;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={k} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={k} className="px-1 rounded bg-gray-100 text-[13px]">{p.slice(1, -1)}</code>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={k}>{p.slice(1, -1)}</em>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

const celulas = (linha: string) => linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const ehSeparador = (linha: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linha.trim());
const pareceNumero = (s: string) => /^[-+]?\s*(R\$\s*)?[-\d.,]+\s*%?$/.test(s.replace(/\*/g, ''));

function Markdown({ texto }: { texto: string }) {
  const linhas = texto.replace(/\r/g, '').split('\n');
  const blocos: ReactNode[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    const t = linha.trim();
    if (!t) { i++; continue; }

    if (t.startsWith('|')) {
      const tabela: string[] = [];
      while (i < linhas.length && linhas[i].trim().startsWith('|')) tabela.push(linhas[i++]);
      const temCabecalho = tabela.length > 1 && ehSeparador(tabela[1]);
      const cab = temCabecalho ? celulas(tabela[0]) : null;
      const corpo = (temCabecalho ? tabela.slice(2) : tabela).filter(l => !ehSeparador(l)).map(celulas);
      blocos.push(
        <div key={`t${i}`} className="overflow-x-auto -mx-1 px-1 my-2">
          <table className="min-w-full text-[13px] border-collapse">
            {cab && (
              <thead>
                <tr>{cab.map((c, j) => <th key={j} className="text-left font-semibold text-gray-700 border-b border-gray-200 px-2 py-1 whitespace-nowrap">{inline(c, `h${i}${j}`)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {corpo.map((r, k) => (
                <tr key={k} className="border-b border-gray-100 last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className={`px-2 py-1 align-top ${pareceNumero(c) ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>{inline(c, `c${i}${k}${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^([-*•]|\d+[.)])\s+/.test(t)) {
      const ordenada = /^\d+[.)]\s+/.test(t);
      const itens: string[] = [];
      while (i < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) {
        itens.push(linhas[i].trim().replace(/^([-*•]|\d+[.)])\s+/, ''));
        i++;
      }
      const Lista = ordenada ? 'ol' : 'ul';
      blocos.push(
        <Lista key={`l${i}`} className={`${ordenada ? 'list-decimal' : 'list-disc'} pl-5 my-1.5 space-y-0.5`}>
          {itens.map((it, k) => <li key={k}>{inline(it, `l${i}${k}`)}</li>)}
        </Lista>,
      );
      continue;
    }

    if (/^#{1,6}\s+/.test(t)) {
      blocos.push(<p key={`h${i}`} className="font-semibold text-gray-900 mt-2 mb-1">{inline(t.replace(/^#{1,6}\s+/, ''), `h${i}`)}</p>);
      i++;
      continue;
    }

    const paragrafo: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !/^(\||#{1,6}\s|([-*•]|\d+[.)])\s+)/.test(linhas[i].trim())) paragrafo.push(linhas[i++].trim());
    blocos.push(
      <p key={`p${i}`} className="my-1.5">
        {paragrafo.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l, `p${i}${k}`)}</Fragment>)}
      </p>,
    );
  }
  return <>{blocos}</>;
}

// ---------------------------------------------------------------- componente

export default function Assistente() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [entrada, setEntrada] = useState('');
  const [rodando, setRodando] = useState(false);
  const [consultando, setConsultando] = useState<string[]>([]);
  const [rascunho, setRascunho] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { setMensagens(lerConversa()); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensagens, rascunho, consultando]);

  const atualizar = useCallback((msgs: Mensagem[]) => {
    setMensagens(msgs);
    guardarConversa(msgs);
  }, []);

  const perguntar = useCallback(async (pergunta: string) => {
    const texto = pergunta.trim();
    if (!texto || rodando) return;
    const historico: Mensagem[] = [...mensagens, { papel: 'usuario', texto }];
    atualizar(historico);
    setEntrada('');
    setRodando(true);
    setRascunho('');
    setConsultando([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let resposta = '';
    const usadas: string[] = [];
    let aviso: string | undefined;
    let erro: string | null = null;
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const res = await fetch('/api/financeiro/assistente', {
        method: 'POST',
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // So o que deu certo vai como contexto; respostas de erro ficam so na tela.
          mensagens: historico.filter(m => !m.erro).map(m => ({ papel: m.papel, texto: m.texto })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || 'Não foi possível falar com o assistente.');
      }
      const leitor = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let corte: number;
        while ((corte = buffer.indexOf('\n\n')) >= 0) {
          const bloco = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          for (const linha of bloco.split('\n')) {
            if (!linha.startsWith('data:')) continue;
            let ev: { tipo: string; delta?: string; nomes?: string[]; ferramentas_usadas?: string[]; aviso?: string; mensagem?: string };
            try { ev = JSON.parse(linha.slice(5).trim()); } catch { continue; }
            if (ev.tipo === 'texto' && ev.delta) {
              resposta += ev.delta;
              setRascunho(resposta);
              setConsultando([]);
            } else if (ev.tipo === 'reiniciar') {
              resposta = '';
              setRascunho('');
            } else if (ev.tipo === 'ferramentas' && ev.nomes) {
              for (const n of ev.nomes) if (!usadas.includes(n)) usadas.push(n);
              setConsultando(ev.nomes);
            } else if (ev.tipo === 'fim') {
              if (ev.aviso && ev.aviso !== 'recusa') aviso = ev.aviso;
            } else if (ev.tipo === 'erro') {
              erro = ev.mensagem || 'Erro ao responder.';
            }
          }
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) aviso = 'Resposta interrompida.';
      else erro = e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Sem conexão. Tente de novo.';
    } finally {
      abortRef.current = null;
      setRodando(false);
      setRascunho('');
      setConsultando([]);
    }

    const final: Mensagem = erro && !resposta.trim()
      ? { papel: 'assistente', texto: erro, erro: true, ferramentas: usadas }
      : { papel: 'assistente', texto: resposta.trim() || 'Sem resposta.', ferramentas: usadas, aviso: erro ?? aviso, ...(resposta.trim() ? {} : { erro: true }) };
    atualizar([...historico, final]);
    textareaRef.current?.focus();
  }, [mensagens, rodando, atualizar]);

  const limpar = () => {
    abortRef.current?.abort();
    atualizar([]);
    try { localStorage.removeItem(CHAVE_STORAGE); } catch { /* ignora */ }
  };

  const vazio = mensagens.length === 0 && !rodando;

  return (
    <div className="flex flex-col gap-3">
      <Cartao
        titulo={<span className="inline-flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#F7941D]" /> Assistente</span>}
        descricao="Pergunte sobre vendas, clientes, produtos, contas, caixa e resultado. Ele consulta os dados do sistema; não lança nem altera nada."
        acao={mensagens.length > 0 ? (
          <BotaoSecundario onClick={limpar} aria-label="Limpar conversa">
            <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">Limpar conversa</span>
          </BotaoSecundario>
        ) : undefined}
      >
        {vazio && (
          <div className="flex flex-wrap gap-2">
            {SUGESTOES.map(s => (
              <button key={s} type="button" onClick={() => perguntar(s)}
                className="text-sm min-h-[40px] px-3 rounded-full border border-orange-200 bg-orange-50 text-[#8A4B00] hover:bg-orange-100 transition text-left">
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {mensagens.map((m, i) => (
            m.papel === 'usuario' ? (
              <div key={i} className="self-end max-w-[85%] bg-[#F7941D] text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
                {m.texto}
              </div>
            ) : (
              <div key={i} className={`self-start max-w-full sm:max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm break-words border ${m.erro ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-100 text-gray-800'}`}>
                {m.erro ? <p>{m.texto}</p> : <Markdown texto={m.texto} />}
                {m.aviso && <p className="text-[11px] text-amber-700 mt-1">{m.aviso}</p>}
                {m.ferramentas && m.ferramentas.length > 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">Consultou: {rotular(m.ferramentas)}</p>
                )}
              </div>
            )
          ))}

          {rodando && (
            <div className="self-start max-w-full sm:max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm bg-gray-50 border border-gray-100 text-gray-800">
              {rascunho ? <Markdown texto={rascunho} /> : (
                <p className="flex items-center gap-2 text-gray-500">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#F7941D]" />
                  {consultando.length ? `Consultando: ${rotular(consultando)}…` : 'Pensando…'}
                </p>
              )}
            </div>
          )}
          <div ref={fimRef} />
        </div>
      </Cartao>

      {mensagens.length > 0 && !rodando && mensagens.length >= MAX_GUARDADAS && (
        <Aviso tom="info">Conversa longa: só as últimas {MAX_GUARDADAS} mensagens são guardadas. Limpe para começar outro assunto.</Aviso>
      )}

      <form
        onSubmit={e => { e.preventDefault(); perguntar(entrada); }}
        className="sticky bottom-0 bg-white/95 backdrop-blur rounded-xl shadow-sm border border-gray-100 p-2 flex items-end gap-2"
      >
        <textarea
          ref={textareaRef}
          value={entrada}
          onChange={e => setEntrada(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); perguntar(entrada); }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ex.: quanto vendi ontem?"
          aria-label="Pergunta para o assistente"
          className="flex-1 resize-none max-h-40 min-h-[44px] border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
        />
        {rodando ? (
          <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Parar resposta"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button type="submit" disabled={!entrada.trim()} aria-label="Enviar pergunta"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-[#F7941D] text-white hover:bg-[#E8850A] disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" />
          </button>
        )}
      </form>
    </div>
  );
}
