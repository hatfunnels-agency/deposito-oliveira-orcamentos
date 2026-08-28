// Pagina de acompanhamento das automacoes de WhatsApp (read-only).
// Server component: busca o log via /api/automacoes/log (a chave de admin
// fica no servidor, nunca chega ao navegador). Protegida pelo proxy de auth
// como as demais paginas.
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Envio = {
  id: string;
  criado_em: string;
  tipo: string;
  momento: string;
  cliente_nome: string | null;
  telefone: string | null;
  via: string;
  template_nome: string | null;
  mensagem: string | null;
  status: string;
  motivo: string | null;
};

type LogResposta = {
  total: number;
  pagina: number;
  porPagina: number;
  totais: { porStatus: Record<string, number>; porTipo: Record<string, number> };
  envios: Envio[];
  error?: string;
};

const TIPO_LABELS: Record<string, string> = {
  followup: 'Follow-up',
  posvenda: 'Pós-venda',
  reativacao: 'Reativação',
  contexto: 'Contexto (IA)',
};

const STATUS_ESTILO: Record<string, string> = {
  simulado: 'bg-blue-100 text-blue-800',
  enviado: 'bg-green-100 text-green-800',
  concluido: 'bg-green-100 text-green-800',
  erro: 'bg-red-100 text-red-800',
  pulado: 'bg-gray-100 text-gray-600',
};

function fmtData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

async function buscarLog(params: URLSearchParams): Promise<LogResposta | { error: string }> {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { error: 'ADMIN_API_KEY não configurada no servidor.' };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
  try {
    const resp = await fetch(`${appUrl}/api/automacoes/log?${params.toString()}`, {
      headers: { 'x-admin-key': adminKey },
      cache: 'no-store',
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json?.error || `Erro ${resp.status} ao buscar o log.` };
    return json as LogResposta;
  } catch (e: any) {
    return { error: e?.message || 'Falha ao buscar o log.' };
  }
}

type Previa = { mensagem?: string; error?: string };

// Previa da copy da IA: o formulario e GET (sem JS) e a chamada acontece aqui
// no servidor, via /api/automacoes/preview — a chave de admin nunca sai do
// servidor e NADA e enviado ao cliente.
async function buscarPrevia(telefone: string, tipo: string, momento: string): Promise<Previa> {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { error: 'ADMIN_API_KEY não configurada no servidor.' };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
  try {
    const q = new URLSearchParams({ telefone, tipo, momento });
    const resp = await fetch(`${appUrl}/api/automacoes/preview?${q.toString()}`, {
      headers: { 'x-admin-key': adminKey },
      cache: 'no-store',
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json?.error || `Erro ${resp.status} ao gerar a prévia.` };
    return { mensagem: json?.mensagem || '' };
  } catch (e: any) {
    return { error: e?.message || 'Falha ao gerar a prévia.' };
  }
}

const MOMENTOS_PREVIA: Array<{ grupo: string; tipo: string; opcoes: Array<[string, string]> }> = [
  {
    grupo: 'Follow-up de orçamento',
    tipo: 'followup',
    opcoes: [['quente', 'quente (3–8h)'], ['dia1', 'dia 1'], ['dia4', 'dia 4'], ['dia7', 'dia 7']],
  },
  {
    grupo: 'Pós-venda',
    tipo: 'posvenda',
    opcoes: [['pergunta', 'pergunta (deu tudo certo?)'], ['positivo', 'resposta positiva'], ['negativo', 'resposta negativa']],
  },
  {
    grupo: 'Reativação',
    tipo: 'reativacao',
    opcoes: [['semanal', 'semanal (obra ativa)'], ['quinzenal', 'quinzenal'], ['mensal', 'mensal (sumiu)']],
  },
];

export default async function AutomacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

  const tipo = primeiro(sp.tipo);
  const status = primeiro(sp.status);
  const de = primeiro(sp.de);
  const ate = primeiro(sp.ate);
  const pagina = Math.max(1, Number(primeiro(sp.pagina)) || 1);

  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo);
  if (status) params.set('status', status);
  if (de) params.set('de', de);
  if (ate) params.set('ate', ate);
  params.set('pagina', String(pagina));

  const pTelefone = primeiro(sp.p_telefone).trim();
  const pAlvo = primeiro(sp.p_alvo) || 'followup:quente';
  const [pTipo, pMomento] = pAlvo.split(':');
  const previa = pTelefone ? await buscarPrevia(pTelefone, pTipo || 'followup', pMomento || '') : null;

  const log = await buscarLog(params);
  const erro = 'error' in log && log.error ? log.error : null;
  const dados = erro ? null : (log as LogResposta);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;
  const linkPagina = (p: number) => {
    const q = new URLSearchParams(params);
    q.set('pagina', String(p));
    return `/automacoes?${q.toString()}`;
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Automações de WhatsApp</h1>
            <p className="text-sm text-gray-500 mt-1">
              Log da régua de mensagens — em modo simulação nada é enviado, só registrado aqui.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition"
          >
            ← Voltar ao sistema
          </Link>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-6 text-sm">
            {erro}
            {erro.includes('automacao_envios') && (
              <span className="block mt-1 text-red-600">
                A tabela ainda não existe? Rode o <code>supabase-automacoes.sql</code> no SQL Editor do Supabase.
              </span>
            )}
          </div>
        )}

        {/* Previa da copy da IA — le o contexto real do cliente e mostra o
            texto que a IA escreveria. Nao envia nada. */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900">Prévia da copy da IA</h2>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Veja o que a IA escreveria para um cliente antes de ligar o envio. Só leitura — nada é enviado.
          </p>
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Telefone do cliente</label>
              <input
                type="text"
                name="p_telefone"
                defaultValue={pTelefone}
                placeholder="11999999999"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Automação / momento</label>
              <select
                name="p_alvo"
                defaultValue={pAlvo}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white"
              >
                {MOMENTOS_PREVIA.map(g => (
                  <optgroup key={g.tipo} label={g.grupo}>
                    {g.opcoes.map(([v, l]) => (
                      <option key={v} value={`${g.tipo}:${v}`}>{l}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="bg-[#F7941D] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#E8850A] transition"
            >
              Gerar prévia
            </button>
          </form>
          {previa && (
            previa.error ? (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">
                {previa.error}
              </div>
            ) : (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-xs text-green-700 mb-2">
                  O que a IA escreveria para {pTelefone} ({pAlvo.replace(':', ' · ')}) — <strong>não foi enviado</strong>:
                </p>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{previa.mensagem || '(vazio)'}</p>
              </div>
            )
          )}
        </div>

        {dados && (
          <>
            {/* Totais por status */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {['simulado', 'enviado', 'erro', 'pulado'].map(s => (
                <div key={s} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm text-gray-500 capitalize">{s}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{dados.totais.porStatus[s] || 0}</p>
                </div>
              ))}
            </div>

            {/* Totais por tipo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {Object.keys(TIPO_LABELS).map(t => (
                <div key={t} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm text-gray-500">{TIPO_LABELS[t]}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{dados.totais.porTipo[t] || 0}</p>
                </div>
              ))}
            </div>

            {/* Filtros (form GET simples — sem JS) */}
            <form method="GET" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                <select
                  name="tipo"
                  defaultValue={tipo}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white"
                >
                  <option value="">Todos</option>
                  {Object.entries(TIPO_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Status</label>
                <select
                  name="status"
                  defaultValue={status}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white"
                >
                  <option value="">Todos</option>
                  {['simulado', 'enviado', 'concluido', 'erro', 'pulado'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">De</label>
                <input
                  type="date"
                  name="de"
                  defaultValue={de}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Até</label>
                <input
                  type="date"
                  name="ate"
                  defaultValue={ate}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
              </div>
              <button
                type="submit"
                className="bg-[#F7941D] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#E8850A] transition"
              >
                Filtrar
              </button>
              <Link href="/automacoes" className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">
                Limpar
              </Link>
            </form>

            {/* Tabela */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Momento</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Telefone</th>
                    <th className="px-4 py-3 font-medium">Via</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.envios.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                        Nenhum registro ainda. O tick roda de hora em hora pelo cron (dentro do horário comercial) — ou dispare manualmente para testar.
                      </td>
                    </tr>
                  )}
                  {dados.envios.map(e => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtData(e.criado_em)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{TIPO_LABELS[e.tipo] || e.tipo}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{e.momento}</td>
                      <td className="px-4 py-3">{e.cliente_nome || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{e.telefone || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {e.via === 'ia' ? 'IA' : e.via === 'template' ? `template (${e.template_nome})` : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_ESTILO[e.status] || 'bg-gray-100 text-gray-600'}`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs">{e.motivo || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginacao */}
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>
                {dados.total} registro{dados.total === 1 ? '' : 's'} — página {dados.pagina} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                {dados.pagina > 1 && (
                  <Link href={linkPagina(dados.pagina - 1)} className="border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition">
                    ← Anterior
                  </Link>
                )}
                {dados.pagina < totalPaginas && (
                  <Link href={linkPagina(dados.pagina + 1)} className="border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition">
                    Próxima →
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
