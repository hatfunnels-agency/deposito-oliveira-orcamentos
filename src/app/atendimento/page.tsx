// Fila de atendimento: os casos que o robo passou para humano.
// Server component — le o Supabase direto, sem passar por rota de API. A
// pagina e protegida pelo proxy de auth como as demais.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Caso = {
  id: string;
  cliente_id: string | null;
  orcamento_id: string | null;
  telefone: string | null;
  motivo: string;
  resumo: string | null;
  origem: string | null;
  status: string;
  criado_em: string;
  resolvido_em: string | null;
  clientes: { nome: string | null; notas_contexto: string | null } | null;
  orcamentos: { codigo: string | null; total: number | null } | null;
};

// Cada motivo tem urgencia diferente — a cor precisa dizer isso de longe.
const MOTIVOS: Record<string, { rotulo: string; classe: string }> = {
  juridico: { rotulo: 'Jurídico', classe: 'bg-red-100 text-red-800 border-red-200' },
  reclamacao: { rotulo: 'Reclamação', classe: 'bg-red-100 text-red-800 border-red-200' },
  cliente_irritado: { rotulo: 'Cliente irritado', classe: 'bg-orange-100 text-orange-800 border-orange-200' },
  desconto_acima_regra: { rotulo: 'Desconto acima da regra', classe: 'bg-amber-100 text-amber-800 border-amber-200' },
  nao_sabe_responder: { rotulo: 'Robô não soube responder', classe: 'bg-gray-100 text-gray-700 border-gray-200' },
  outro: { rotulo: 'Outro', classe: 'bg-gray-100 text-gray-700 border-gray-200' },
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function haQuanto(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)} dia(s)`;
}

async function resolver(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '');
  if (!id) return;
  await supabaseAdmin
    .from('atendimento_fila')
    .update({ status: 'resolvido', resolvido_em: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/atendimento');
}

async function reabrir(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '');
  if (!id) return;
  await supabaseAdmin
    .from('atendimento_fila')
    .update({ status: 'aberto', resolvido_em: null })
    .eq('id', id);
  revalidatePath('/atendimento');
}

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtro = (Array.isArray(sp.status) ? sp.status[0] : sp.status) || 'aberto';

  let q = supabaseAdmin
    .from('atendimento_fila')
    .select('*, clientes (nome, notas_contexto), orcamentos (codigo, total)')
    .order('criado_em', { ascending: false })
    .limit(100);
  if (filtro !== 'todos') q = q.eq('status', filtro);

  const { data, error } = await q;
  const casos = (data || []) as unknown as Caso[];

  const { count: abertos } = await supabaseAdmin
    .from('atendimento_fila')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'aberto');

  const aba = (valor: string, texto: string) => (
    <Link
      href={`/atendimento?status=${valor}`}
      className={`px-4 py-2 rounded-lg text-sm transition ${
        filtro === valor
          ? 'bg-[#F7941D] text-white font-medium'
          : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
      }`}
    >
      {texto}
    </Link>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Atendimento
              {(abertos || 0) > 0 && (
                <span className="ml-3 text-sm font-medium bg-red-100 text-red-800 px-3 py-1 rounded-full align-middle">
                  {abertos} aberto{(abertos || 0) > 1 ? 's' : ''}
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Conversas que o robô passou para uma pessoa. Resolva e marque como concluído.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition"
          >
            ← Voltar ao sistema
          </Link>
        </div>

        <div className="flex gap-2 mb-6">
          {aba('aberto', 'Abertos')}
          {aba('resolvido', 'Resolvidos')}
          {aba('todos', 'Todos')}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-6 text-sm">
            {error.message}
          </div>
        )}

        {casos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <p className="text-gray-500">
              {filtro === 'aberto'
                ? 'Nenhum caso aberto. O robô está dando conta sozinho.'
                : 'Nada por aqui.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {casos.map(c => {
              const m = MOTIVOS[c.motivo] || MOTIVOS.outro;
              const zap = (c.telefone || '').replace(/\D/g, '');
              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-2xl border shadow-sm p-5 ${
                    c.status === 'aberto' ? 'border-gray-200' : 'border-gray-100 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-medium px-2 py-1 rounded border ${m.classe}`}>
                          {m.rotulo}
                        </span>
                        <span className="text-xs text-gray-400">
                          {fmt(c.criado_em)} · {haQuanto(c.criado_em)}
                        </span>
                        {c.origem && <span className="text-xs text-gray-400">· {c.origem}</span>}
                      </div>
                      <p className="font-medium text-gray-900">
                        {c.clientes?.nome || 'Cliente sem cadastro'}
                        {c.telefone && <span className="text-gray-400 font-normal ml-2">{c.telefone}</span>}
                      </p>
                      {c.resumo && <p className="text-sm text-gray-700 mt-2">{c.resumo}</p>}
                      {c.orcamentos?.codigo && (
                        <p className="text-xs text-gray-500 mt-2">
                          Orçamento {c.orcamentos.codigo}
                          {c.orcamentos.total != null &&
                            ` — R$ ${Number(c.orcamentos.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                        </p>
                      )}
                      {c.clientes?.notas_contexto && (
                        <p className="text-xs text-gray-500 mt-1 italic">{c.clientes.notas_contexto}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-none">
                      {zap && (
                        <a
                          href={`https://wa.me/${zap.startsWith('55') ? zap : '55' + zap}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm bg-[#25D366] text-white rounded-lg px-3 py-2 hover:brightness-95 transition"
                        >
                          Abrir WhatsApp
                        </a>
                      )}
                      <form action={c.status === 'aberto' ? resolver : reabrir}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className={`text-sm rounded-lg px-3 py-2 transition ${
                            c.status === 'aberto'
                              ? 'bg-gray-900 text-white hover:bg-gray-700'
                              : 'border border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {c.status === 'aberto' ? 'Marcar resolvido' : 'Reabrir'}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
