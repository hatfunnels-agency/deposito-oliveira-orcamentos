// Tarefas do dia da atendente: retornos combinados, orcamentos grandes em
// aberto e reativacao. Server component — le o Supabase direto, como a
// /atendimento; a pagina e protegida pelo proxy de auth como as demais.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { tarefasDoDia, placar, type Tarefa } from '@/lib/tarefas';

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

function telefoneBonito(t: string): string {
  const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

// api.whatsapp.com e nao wa.me: o redirect do wa.me troca emoji por "�".
function linkWhatsApp(t: Tarefa): string {
  const d = t.telefone.replace(/\D/g, '');
  const numero = d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
  return `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(t.mensagem)}`;
}

function Botao({ t, resultado, texto, classe }: { t: Tarefa; resultado: string; texto: string; classe: string }) {
  return (
    <form action={registrar}>
      <input type="hidden" name="chave" value={t.chave} />
      <input type="hidden" name="tipo" value={t.tipo} />
      <input type="hidden" name="resultado" value={resultado} />
      <input type="hidden" name="cliente_id" value={t.clienteId} />
      <input type="hidden" name="orcamento_id" value={t.orcamentoId || ''} />
      <button type="submit" className={`text-sm rounded-lg px-3 py-2 transition ${classe}`}>{texto}</button>
    </form>
  );
}

function Cartao({ t }: { t: Tarefa }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium text-gray-900">{t.motivo}</span>
            {t.selo && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                t.seloForte ? 'bg-red-100 text-red-800 border-red-200' : 'bg-orange-50 text-[#E8850A] border-orange-200'
              }`}>{t.selo}</span>
            )}
          </div>
          <p className="text-gray-900">
            {t.nome}
            <span className="text-gray-400 ml-2 text-sm">{telefoneBonito(t.telefone)}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">{t.detalhe}</p>
        </div>
        <a
          href={linkWhatsApp(t)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-[#25D366] text-white rounded-lg px-3 py-2 hover:brightness-95 transition flex-none"
        >
          WhatsApp
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
        <Botao t={t} resultado="feito" texto="✓ Falei com ele" classe="bg-gray-900 text-white hover:bg-gray-700" />
        <Botao t={t} resultado="sem_resposta" texto="Sem resposta" classe="border border-gray-300 text-gray-600 hover:bg-gray-100" />
        {t.tipo === 'orcamento' ? (
          <form action={registrar} className="flex items-center gap-1">
            <input type="hidden" name="chave" value={t.chave} />
            <input type="hidden" name="tipo" value={t.tipo} />
            <input type="hidden" name="resultado" value="perdido" />
            <input type="hidden" name="cliente_id" value={t.clienteId} />
            <input type="hidden" name="orcamento_id" value={t.orcamentoId || ''} />
            <select name="motivo_perda" defaultValue="concorrente"
              className="text-sm border border-gray-300 rounded-lg px-2 py-2 text-gray-600 bg-white">
              {MOTIVOS_PERDA.map(m => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
            </select>
            <button type="submit" className="text-sm rounded-lg px-3 py-2 border border-red-200 text-red-700 hover:bg-red-50 transition">
              Perdido
            </button>
          </form>
        ) : (
          <Botao t={t} resultado="perdido"
            texto={t.tipo === 'retorno' ? 'Não quer mais' : 'Não volta'}
            classe="border border-red-200 text-red-700 hover:bg-red-50" />
        )}
      </div>
    </div>
  );
}

function Bloco({ titulo, explicacao, tarefas, vazio }: {
  titulo: string; explicacao: string; tarefas: Tarefa[]; vazio: string;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
        <span className="text-sm text-gray-400">{tarefas.length}</span>
      </div>
      <p className="text-sm text-gray-500 mb-3">{explicacao}</p>
      {tarefas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-gray-500">{vazio}</div>
      ) : (
        <div className="flex flex-col gap-3">{tarefas.map(t => <Cartao key={t.chave} t={t} />)}</div>
      )}
    </section>
  );
}

export default async function TarefasPage() {
  const [listas, p] = await Promise.all([tarefasDoDia(), placar()]);
  const total = listas.retornos.length + listas.orcamentos.length + listas.reativacao.length;
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tarefas do dia</h1>
            <p className="text-sm text-gray-500 mt-1">
              {total === 0 ? 'Tudo em dia.' : `${total} contato${total > 1 ? 's' : ''} pra fazer hoje, em ordem de prioridade.`}
            </p>
          </div>
          <Link href="/" className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition">
            ← Voltar ao sistema
          </Link>
        </div>

        {p === null ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 mb-6 text-sm">
            O registro de tarefas ainda não está ativo — falta rodar <code>supabase-tarefas-atendente.sql</code> no Supabase.
            A lista abaixo funciona, mas os botões não guardam o resultado.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {[
              ['Falei hoje', String(p.hoje.feito)],
              ['Sem resposta', String(p.hoje.sem_resposta)],
              ['Perdidos', String(p.hoje.perdido)],
              ['Vendido (7 dias)', `${brl(p.vendas7d.valor)}`],
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="bg-white rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{rotulo}</p>
                <p className="text-lg font-bold text-gray-900">{valor}</p>
              </div>
            ))}
          </div>
        )}

        <Bloco
          titulo="Retornos combinados"
          explicacao="O cliente pediu pra ser chamado nesta data. É promessa — atrasados primeiro."
          tarefas={listas.retornos}
          vazio="Nenhum retorno pra hoje."
        />
        <Bloco
          titulo="Orçamentos grandes em aberto"
          explicacao="Acima de R$ 1.000, dos últimos 30 dias. Os de hoje primeiro, depois por valor."
          tarefas={listas.orcamentos}
          vazio="Nenhum orçamento grande esperando contato."
        />
        <Bloco
          titulo="Reativação"
          explicacao="Obra ativa que parou de comprar (provavelmente comprando em outro lugar) e clientes de gasto alto parados."
          tarefas={listas.reativacao}
          vazio="Ninguém pra reativar hoje."
        />

        <p className="text-xs text-gray-400 mt-2">
          Quando você marca &quot;Falei com ele&quot;, o robô e as mensagens automáticas ficam quietos com esse cliente
          por 24–48h — a conversa é sua.
        </p>
      </div>
    </main>
  );
}
