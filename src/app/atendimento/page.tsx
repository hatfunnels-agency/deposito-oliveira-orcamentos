// Fila de atendimento: os casos que o robo passou para humano.
// Server component — le o Supabase direto, sem passar por rota de API. A
// pagina e protegida pelo proxy de auth como as demais.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { Quadro, Coluna, BotaoWhatsApp, telefoneBonito, linkWhatsApp } from '@/components/Kanban';

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

const URGENTES = new Set(['juridico', 'reclamacao', 'cliente_irritado']);

function CartaoCaso({ c }: { c: Caso }) {
  const m = MOTIVOS[c.motivo] || MOTIVOS.outro;
  const aberto = c.status === 'aberto';
  return (
    <article className={`bg-white rounded-xl border border-gray-200 shadow-sm p-3 hover:shadow-md transition ${aberto ? '' : 'opacity-75'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${m.classe}`}>{m.rotulo}</span>
        <span className="text-[11px] text-gray-400 shrink-0" title={fmt(c.criado_em)}>
          {aberto ? haQuanto(c.criado_em) : `resolvido ${haQuanto(c.resolvido_em || c.criado_em)}`}
        </span>
      </div>
      <p className="font-semibold text-gray-900 leading-tight mt-2">{c.clientes?.nome || 'Cliente sem cadastro'}</p>
      {c.telefone && <p className="text-xs text-gray-400 mt-0.5">{telefoneBonito(c.telefone)}</p>}
      {c.resumo && <p className="text-sm text-gray-700 mt-2 leading-snug">{c.resumo}</p>}
      {c.orcamentos?.codigo && (
        <p className="text-xs text-gray-500 mt-1.5">
          Orçamento {c.orcamentos.codigo}
          {c.orcamentos.total != null &&
            ` — R$ ${Number(c.orcamentos.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
        </p>
      )}
      {aberto && c.clientes?.notas_contexto && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">Contexto do cliente</summary>
          <p className="text-xs text-gray-500 mt-1 italic leading-snug">{c.clientes.notas_contexto}</p>
        </details>
      )}
      {c.origem && <p className="text-[11px] text-gray-400 mt-1.5">Origem: {c.origem}</p>}

      <div className="flex gap-1.5 mt-3">
        {aberto && c.telefone && (
          <div className="flex-1"><BotaoWhatsApp href={linkWhatsApp(c.telefone)} texto="WhatsApp" /></div>
        )}
        <form action={aberto ? resolver : reabrir} className="flex-1">
          <input type="hidden" name="id" value={c.id} />
          <button type="submit" className={`w-full text-sm font-medium rounded-lg px-3 py-2 transition ${
            aberto ? 'bg-gray-900 text-white hover:bg-gray-700' : 'border border-gray-300 text-gray-600 hover:bg-gray-100'
          }`}>
            {aberto ? '✓ Resolvido' : 'Reabrir'}
          </button>
        </form>
      </div>
    </article>
  );
}

export default async function AtendimentoPage() {
  const seteDias = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [abertosRes, resolvidosRes] = await Promise.all([
    supabaseAdmin
      .from('atendimento_fila')
      .select('*, clientes (nome, notas_contexto), orcamentos (codigo, total)')
      .eq('status', 'aberto')
      .order('criado_em', { ascending: true })
      .limit(500),
    supabaseAdmin
      .from('atendimento_fila')
      .select('*, clientes (nome, notas_contexto), orcamentos (codigo, total)')
      .eq('status', 'resolvido')
      .gte('resolvido_em', seteDias)
      .order('resolvido_em', { ascending: false })
      .limit(50),
  ]);
  const erro = abertosRes.error || resolvidosRes.error;
  const abertos = (abertosRes.data || []) as unknown as Caso[];
  const resolvidos = (resolvidosRes.data || []) as unknown as Caso[];
  const urgentes = abertos.filter(c => URGENTES.has(c.motivo));
  const outros = abertos.filter(c => !URGENTES.has(c.motivo));

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1300px] mx-auto px-4 py-5">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Atendimento</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {abertos.length === 0
                ? 'Nenhum caso aberto. O robô está dando conta sozinho.'
                : `${abertos.length} conversa${abertos.length > 1 ? 's' : ''} que o robô passou pra uma pessoa — os mais antigos no topo.`}
            </p>
          </div>
          <Link href="/" className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition">
            ← Voltar ao sistema
          </Link>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-4 text-sm">{erro.message}</div>
        )}

        <Quadro colunas={3}>
          <Coluna titulo="Urgente" cor="vermelho" quantidade={urgentes.length}
            dica="Reclamação, cliente irritado ou jurídico. Responda primeiro."
            vazio="Nenhum caso urgente.">
            {urgentes.map(c => <CartaoCaso key={c.id} c={c} />)}
          </Coluna>
          <Coluna titulo="Precisa de resposta" cor="laranja" quantidade={outros.length}
            dica="Desconto acima da regra, dúvida que o robô não soube e outros."
            vazio="Nada esperando resposta.">
            {outros.map(c => <CartaoCaso key={c.id} c={c} />)}
          </Coluna>
          <Coluna titulo="Resolvidos" cor="verde" quantidade={resolvidos.length}
            dica="Últimos 7 dias. Reabra se o cliente voltar a falar."
            vazio="Nenhum resolvido nos últimos 7 dias.">
            {resolvidos.map(c => <CartaoCaso key={c.id} c={c} />)}
          </Coluna>
        </Quadro>
      </div>
    </main>
  );
}
