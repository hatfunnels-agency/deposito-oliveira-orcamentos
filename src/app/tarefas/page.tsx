// Tarefas do dia da atendente: retornos combinados, orcamentos grandes em
// aberto e reativacao. Server component — le o Supabase direto, como a
// /atendimento; a pagina e protegida pelo proxy de auth como as demais.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { tarefasDoDia, placar, feitosHoje, type Tarefa, type TarefaFeita } from '@/lib/tarefas';
import { Quadro, Coluna, Selo, BotaoWhatsApp, telefoneBonito, linkWhatsApp } from '@/components/Kanban';

export const dynamic = 'force-dynamic';

const MOTIVOS_PERDA = [
  { valor: 'concorrente', rotulo: 'Comprou em outro depósito' },
  { valor: 'preco', rotulo: 'Achou caro' },
  { valor: 'desistiu', rotulo: 'Desistiu / adiou a obra' },
  { valor: 'outro', rotulo: 'Outro motivo' },
];

async function registrar(formData: FormData) {
  'use server';
  const chave = String(formData.get('chave') || '');
  const tipo = String(formData.get('tipo') || '');
  const resultado = String(formData.get('resultado') || '');
  const clienteId = String(formData.get('cliente_id') || '') || null;
  const orcamentoId = String(formData.get('orcamento_id') || '') || null;
  if (!chave || !['retorno', 'orcamento', 'reativacao'].includes(tipo)) return;
  if (!['feito', 'sem_resposta', 'perdido'].includes(resultado)) return;

  await supabaseAdmin.from('tarefas_atendente').insert({
    chave, tipo, resultado, cliente_id: clienteId, orcamento_id: orcamentoId,
  });

  // Orcamento perdido aqui = o mesmo "Marcar como perdido" do painel do
  // orcamento: status 'cancelado' + motivo. So mexe se ainda estiver aberto.
  if (tipo === 'orcamento' && resultado === 'perdido' && orcamentoId) {
    const motivo = String(formData.get('motivo_perda') || 'outro');
    await supabaseAdmin.from('orcamentos')
      .update({
        status: 'cancelado',
        perdido_em: new Date().toISOString(),
        motivo_perda: MOTIVOS_PERDA.some(m => m.valor === motivo) ? motivo : 'outro',
      })
      .eq('id', orcamentoId)
      .eq('status', 'orcamento');
  }
  revalidatePath('/tarefas');
}

function CamposOcultos({ t, resultado }: { t: Tarefa; resultado: string }) {
  return (
    <>
      <input type="hidden" name="chave" value={t.chave} />
      <input type="hidden" name="tipo" value={t.tipo} />
      <input type="hidden" name="resultado" value={resultado} />
      <input type="hidden" name="cliente_id" value={t.clienteId} />
      <input type="hidden" name="orcamento_id" value={t.orcamentoId || ''} />
    </>
  );
}

function Acao({ t, resultado, texto, classe, titulo }: {
  t: Tarefa; resultado: string; texto: string; classe: string; titulo: string;
}) {
  return (
    <form action={registrar} className="flex-1">
      <CamposOcultos t={t} resultado={resultado} />
      <button type="submit" title={titulo}
        className={`w-full text-xs font-medium rounded-lg px-2 py-1.5 transition ${classe}`}>{texto}</button>
    </form>
  );
}

function Cartao({ t }: { t: Tarefa }) {
  return (
    <article className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 hover:shadow-md transition">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900 leading-tight">{t.nome}</p>
        {t.selo && <Selo texto={t.selo} forte={t.seloForte} />}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">{telefoneBonito(t.telefone)}</p>
      <p className="text-sm text-gray-700 mt-2 leading-snug">{t.motivo}</p>
      <p className="text-xs text-gray-500 mt-1 leading-snug">{t.detalhe}</p>

      <div className="mt-3">
        <BotaoWhatsApp href={linkWhatsApp(t.telefone, t.mensagem)} />
      </div>

      <div className="flex gap-1.5 mt-2">
        <Acao t={t} resultado="feito" texto="✓ Falei" titulo="Falei com o cliente"
          classe="bg-gray-900 text-white hover:bg-gray-700" />
        <Acao t={t} resultado="sem_resposta" texto="Sem resposta" titulo="Mandei mensagem e não respondeu"
          classe="border border-gray-300 text-gray-600 hover:bg-gray-100" />
        {t.tipo !== 'orcamento' && (
          <Acao t={t} resultado="perdido" texto={t.tipo === 'retorno' ? 'Não quer' : 'Não volta'}
            titulo="Tirar da lista" classe="border border-red-200 text-red-700 hover:bg-red-50" />
        )}
      </div>

      {/* Perdido do orcamento pede o motivo — abre no proprio cartao. */}
      {t.tipo === 'orcamento' && (
        <details className="mt-1.5 group">
          <summary className="list-none cursor-pointer text-center text-xs font-medium rounded-lg px-2 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 transition">
            Orçamento perdido…
          </summary>
          <form action={registrar} className="mt-2 flex gap-1.5">
            <CamposOcultos t={t} resultado="perdido" />
            <select name="motivo_perda" defaultValue="concorrente"
              className="flex-1 min-w-0 text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 bg-white">
              {MOTIVOS_PERDA.map(m => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
            </select>
            <button type="submit" className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 transition">
              Confirmar
            </button>
          </form>
        </details>
      )}
    </article>
  );
}

const RESULTADO: Record<string, { rotulo: string; classe: string }> = {
  feito: { rotulo: '✓ Falou', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  sem_resposta: { rotulo: 'Sem resposta', classe: 'bg-gray-100 text-gray-600 border-gray-200' },
  perdido: { rotulo: 'Perdido', classe: 'bg-red-50 text-red-700 border-red-200' },
};
const TIPO_ROTULO: Record<string, string> = { retorno: 'Retorno', orcamento: 'Orçamento', reativacao: 'Reativação' };

function CartaoFeito({ f }: { f: TarefaFeita }) {
  const r = RESULTADO[f.resultado] || RESULTADO.feito;
  const hora = new Date(f.quando).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bg-white/70 rounded-xl border border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-700 truncate">{f.nome}</p>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${r.classe}`}>{r.rotulo}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5">{TIPO_ROTULO[f.tipo] || f.tipo} · {hora}</p>
    </div>
  );
}

export default async function TarefasPage() {
  const [listas, p, feitos] = await Promise.all([tarefasDoDia(), placar(), feitosHoje()]);
  const total = listas.retornos.length + listas.orcamentos.length + listas.reativacao.length;
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1500px] mx-auto px-4 py-5">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tarefas do dia</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {total === 0 ? 'Tudo em dia. 🎉' : `${total} contato${total > 1 ? 's' : ''} pra fazer — comece pela esquerda.`}
            </p>
          </div>
          <Link href="/" className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition">
            ← Voltar ao sistema
          </Link>
        </div>

        {p === null ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 mb-4 text-sm">
            O registro de tarefas ainda não está ativo — falta rodar <code>supabase-tarefas-atendente.sql</code> no Supabase.
            O quadro funciona, mas os botões não guardam o resultado.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              ['Falei hoje', String(p.hoje.feito), 'text-emerald-700'],
              ['Sem resposta', String(p.hoje.sem_resposta), 'text-gray-700'],
              ['Perdidos', String(p.hoje.perdido), 'text-red-700'],
              ['Vendido após contato (7 dias)', brl(p.vendas7d.valor), 'text-[#C96F00]'],
            ].map(([rotulo, valor, cor]) => (
              <div key={rotulo} className="bg-white rounded-xl border border-gray-200 px-4 py-2 flex items-baseline gap-2">
                <span className={`text-lg font-bold ${cor}`}>{valor}</span>
                <span className="text-xs text-gray-500">{rotulo}</span>
              </div>
            ))}
          </div>
        )}

        <Quadro colunas={4}>
          <Coluna titulo="Retornos combinados" cor="amarelo" quantidade={listas.retornos.length}
            dica="O cliente pediu pra ser chamado hoje. É promessa — atrasados primeiro."
            vazio="Nenhum retorno pra hoje.">
            {listas.retornos.map(t => <Cartao key={t.chave} t={t} />)}
          </Coluna>
          <Coluna titulo="Orçamentos grandes" cor="laranja" quantidade={listas.orcamentos.length}
            dica="Acima de R$ 1.000, últimos 30 dias. Os de hoje primeiro."
            vazio="Nenhum orçamento grande esperando.">
            {listas.orcamentos.map(t => <Cartao key={t.chave} t={t} />)}
          </Coluna>
          <Coluna titulo="Reativação" cor="azul" quantidade={listas.reativacao.length}
            dica="Obra ativa que parou de comprar e clientes de gasto alto parados."
            vazio="Ninguém pra reativar hoje.">
            {listas.reativacao.map(t => <Cartao key={t.chave} t={t} />)}
          </Coluna>
          <Coluna titulo="Feito hoje" cor="verde" quantidade={feitos.length}
            dica="O que já saiu do quadro hoje."
            vazio="Nada ainda — os cartões vêm pra cá quando você marca.">
            {feitos.map(f => <CartaoFeito key={f.id} f={f} />)}
          </Coluna>
        </Quadro>

        <p className="text-xs text-gray-400 mt-2">
          Quando você marca &quot;Falei&quot;, o robô e as mensagens automáticas ficam quietos com esse cliente
          por 24–48h — a conversa é sua.
        </p>
      </div>
    </main>
  );
}
