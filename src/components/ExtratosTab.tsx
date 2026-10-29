'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FileText, AlertTriangle, CheckCircle2, TrendingUp, Landmark, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import type { ResultadoImportacao, StatusItau, TesteItau } from '@/lib/financeiro/tipos';

/**
 * Importacao de extrato + revisao + DRE.
 *
 * A tela e organizada pela pergunta que o Roger faz, nesta ordem:
 *   1. Importar    — subir o arquivo do mes
 *   2. Revisar     — so o que a IA chutou ou ninguem classificou
 *   3. DRE         — o resultado, com aviso quando ainda ha fila de revisao
 *
 * Quem embute escolhe as vistas pela prop `vistas` (/financeiro usa
 * ['importar','revisar']; o Fechamento reaproveita so ['dre']). O fechamento
 * do dia saiu daqui: virou Dia.tsx em /financeiro.
 */

export type VistaExtratos = 'dia' | 'importar' | 'revisar' | 'dre';
type VistaAtiva = Exclude<VistaExtratos, 'dia'>;

interface Conta { id: string; nome: string; tipo: string; layout: string; instituicao: string | null }
interface Categoria { id: string; nome: string; grupo: string; entra_no_dre: boolean }
interface Importacao {
  id: string; conta_id: string; arquivo_nome: string;
  periodo_inicio: string | null; periodo_fim: string | null;
  linhas_total: number; linhas_novas: number; linhas_duplicadas: number; criado_em: string;
}
interface Lancamento {
  id: string; data: string; descricao: string; contraparte: string | null;
  documento: string | null; valor: number; tarifa: number;
  categoria_id: string | null; categoria_origem: string | null; categoria_confianca: number | null;
  revisado: boolean;
  categorias_financeiras?: { id: string; nome: string; grupo: string } | null;
  contas_financeiras?: { nome: string } | null;
}
interface Dre {
  mes: string;
  dre: {
    receita: number; cmv: number; lucro_bruto: number; margem_bruta_pct: number | null;
    custo_variavel: number; custo_fixo: number; imposto: number; taxa_financeira: number;
    lucro_operacional: number; margem_operacional_pct: number | null;
    servico_divida: number; retirada_socio: number; caixa_livre: number;
  };
  fora_do_dre: { transferencia_entre_contas: number; nao_operacional: number; tarifas_embutidas: number };
  conciliacao_receita: { receita_no_banco: number; venda_no_sistema: number; diferenca: number; nota: string };
  qualidade: { lancamentos_no_mes: number; a_revisar: number; sem_categoria_qtd: number; sem_categoria_valor: number; confiavel: boolean };
  categorias: Array<{ categoria: string; grupo: string; entra_no_dre: boolean; valor: number; lancamentos: number }>;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const mesAtual = () => new Date().toISOString().slice(0, 7);
const rotuloMes = (m: string) => {
  const [a, mm] = m.split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(mm) - 1]}/${a}`;
};
const dataBR = (d: string) => d.split('-').reverse().join('/');

const ROTULO_VISTA: Record<VistaAtiva, string> = {
  importar: '📥 Importar',
  revisar: '🔍 Revisar',
  dre: '📊 DRE',
};
const VISTAS_PADRAO: VistaExtratos[] = ['importar', 'revisar', 'dre'];

export default function ExtratosTab({
  vistas = VISTAS_PADRAO,
  mes: mesProp,
}: {
  vistas?: ReadonlyArray<VistaExtratos>;
  mes?: string;
}) {
  // 'dia' segue no tipo por compatibilidade, mas nao renderiza mais aqui.
  const vistasAtivas = vistas.filter((v): v is VistaAtiva => v !== 'dia');
  const temImportar = vistasAtivas.includes('importar');
  const temRevisar = vistasAtivas.includes('revisar');
  const [vista, setVista] = useState<VistaAtiva>(vistasAtivas[0] ?? 'importar');
  const [mes, setMes] = useState(mesProp ?? mesAtual());

  const [contas, setContas] = useState<Conta[]>([]);
  const [importacoes, setImportacoes] = useState<Importacao[]>([]);
  const [contaSel, setContaSel] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [aRevisar, setARevisar] = useState(0);
  const [carregandoLanc, setCarregandoLanc] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const [dre, setDre] = useState<Dre | null>(null);
  const [carregandoDre, setCarregandoDre] = useState(false);

  const carregarContas = useCallback(async () => {
    try {
      const d = await apiFinanceiro<{ contas?: Conta[]; importacoes?: Importacao[] }>(
        '/api/financeiro/extratos', { cache: 'no-store' },
      );
      setContas(d.contas || []);
      setImportacoes(d.importacoes || []);
      if (!contaSel && d.contas?.[0]) setContaSel(d.contas[0].id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar contas');
    }
  }, [contaSel]);

  const carregarLancamentos = useCallback(async () => {
    setCarregandoLanc(true);
    try {
      const d = await apiFinanceiro<{ lancamentos?: Lancamento[]; categorias?: Categoria[]; a_revisar?: number }>(
        `/api/financeiro/lancamentos?mes=${mes}&filtro=revisar`, { cache: 'no-store' },
      );
      setLancamentos(d.lancamentos || []);
      setCategorias(d.categorias || []);
      setARevisar(d.a_revisar || 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar lancamentos');
    }
    setCarregandoLanc(false);
  }, [mes]);

  const carregarDre = useCallback(async () => {
    setCarregandoDre(true);
    try {
      const d = await apiFinanceiro<Dre>(`/api/financeiro/dre?mes=${mes}`, { cache: 'no-store' });
      setDre(d);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar DRE');
    }
    setCarregandoDre(false);
  }, [mes]);

  // Quando o pai controla o mes (Fechamento), a troca dele vale aqui tambem.
  useEffect(() => { if (mesProp) setMes(mesProp); }, [mesProp]);
  useEffect(() => { if (temImportar) carregarContas(); }, [temImportar, carregarContas]);
  useEffect(() => {
    if (vista === 'revisar') carregarLancamentos();
    if (vista === 'dre') carregarDre();
  }, [vista, mes, carregarLancamentos, carregarDre]);

  const enviarArquivo = async (arquivo: File) => {
    if (!contaSel) { setErro('Escolha a conta de origem'); return; }
    setEnviando(true); setErro(null); setResultado(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      fd.append('conta_id', contaSel);
      // Multipart vai por fetch direto: o navegador precisa definir o
      // Content-Type com o boundary, entao so o Authorization entra aqui.
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const r = await fetch('/api/financeiro/extratos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erro ao importar');
      setResultado(d as ResultadoImportacao);
      await carregarContas();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao importar');
    }
    setEnviando(false);
    if (inputArquivo.current) inputArquivo.current.value = '';
  };

  const categorizar = async (id: string, categoriaId: string) => {
    setSalvando(id);
    try {
      await apiFinanceiro('/api/financeiro/lancamentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, categoria_id: categoriaId }),
      });
      setLancamentos(prev => prev.filter(l => l.id !== id));
      setARevisar(n => Math.max(0, n - 1));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    }
    setSalvando(null);
  };

  const confirmar = async (id: string) => {
    setSalvando(id);
    try {
      await apiFinanceiro('/api/financeiro/lancamentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, revisado: true }),
      });
      setLancamentos(prev => prev.filter(l => l.id !== id));
      setARevisar(n => Math.max(0, n - 1));
    } catch { /* ignora: recarregar resolve */ }
    setSalvando(null);
  };

  const meses = (() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    return out;
  })();

  // Com uma vista so nao ha o que alternar; com o mes vindo do pai, o seletor
  // local so confundiria.
  const mostrarAbas = vistasAtivas.length > 1;
  const mostrarMes = vista !== 'importar' && !mesProp;
  const conciliacao = resultado?.conciliacao ?? null;
  const duplicadosConteudo = resultado?.duplicados_por_conteudo ?? 0;

  return (
    <div className="pb-8 space-y-4">
      {(mostrarAbas || mostrarMes) && (
        <div className="flex items-center gap-3 flex-wrap">
          {mostrarAbas && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {vistasAtivas.map(v => (
                <button
                  key={v}
                  onClick={() => setVista(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${vista === v ? 'bg-white text-[#F7941D] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {ROTULO_VISTA[v]}{v === 'revisar' && aRevisar > 0 ? ` (${aRevisar})` : ''}
                </button>
              ))}
            </div>
          )}
          {mostrarMes && (
            <select value={mes} onChange={e => setMes(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
              {meses.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
            </select>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">{erro}</div>
          <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {/* ---------------- IMPORTAR ---------------- */}
      {vista === 'importar' && (
        <div className="space-y-4">
          <BlocoItau onImportou={(r) => { setResultado(r); setErro(null); carregarContas(); }} />
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h2 className="font-bold text-gray-700 mb-1">Importar extrato</h2>
            <p className="text-xs text-gray-500 mb-4">
              Reimportar um período que já subiu não duplica nada — cada lançamento tem
              impressão digital própria. Depois de importar, a conciliação roda sozinha.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <select value={contaSel} onChange={e => setContaSel(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                {contas.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
                {contas.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nome} {c.instituicao ? `— ${c.instituicao}` : ''}
                  </option>
                ))}
              </select>
              <input ref={inputArquivo} type="file" accept=".xlsx,.csv,.txt,.ofx"
                onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); }}
                className="hidden" id="arquivo-extrato" />
              <label htmlFor="arquivo-extrato"
                className={`flex items-center justify-center gap-2 bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap ${enviando ? 'opacity-50' : 'hover:bg-orange-600 cursor-pointer'}`}>
                <Upload className="w-4 h-4" />
                {enviando ? 'Importando...' : 'Escolher arquivo'}
              </label>
            </div>
            <p className="text-xs text-gray-400">
              Itaú Empresas: Extrato › Salvar em outros formatos › OFX (até 90 dias). Conta Stone: Extrato › Baixar › OFX.
              Também aceita o .xlsx do Itaú e o .csv da Stone.
            </p>
          </div>

          {resultado && (
            <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h3 className="font-bold text-green-700">Importado</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {([
                  ['Lançamentos no arquivo', resultado.total],
                  ['Novos', resultado.novos],
                  ['Já existiam', resultado.duplicados],
                  ['A revisar', resultado.a_revisar],
                ] as const).map(([rot, v]) => (
                  <div key={rot} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-500">{rot}</p>
                    <p className="font-bold text-gray-800">{String(v ?? 0)}</p>
                  </div>
                ))}
              </div>
              {(resultado.classificados_por_regra ?? 0) > 0 && (
                <p className="text-xs text-gray-600 mt-3">
                  {resultado.classificados_por_regra} classificados por regra ·{' '}
                  {resultado.classificados_por_ia ?? 0} pela IA ·{' '}
                  {resultado.sem_categoria ?? 0} sem categoria
                </p>
              )}
              {duplicadosConteudo > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {duplicadosConteudo} com a mesma data e valor de linhas já importadas (outro formato do mesmo extrato) — não entraram.
                </p>
              )}
              {conciliacao && (
                <div className="mt-3 text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <span className="font-semibold">Conciliação automática:</span>{' '}
                  {conciliacao.conciliados} conciliado(s) · {conciliacao.sugestoes} sugestão(ões) para confirmar
                  {conciliacao.cartao_agregado_dias > 0 && ` · cartão agregado em ${conciliacao.cartao_agregado_dias} dia(s)`}
                </div>
              )}
              {resultado.saldo_registrado && (
                <p className="text-xs text-gray-600 mt-2">
                  Saldo da conta registrado: <strong>{brl(resultado.saldo_registrado.saldo)}</strong> em {dataBR(resultado.saldo_registrado.data)}
                </p>
              )}
              {resultado.mensagem && (
                <p className="text-xs text-gray-500 mt-2">{resultado.mensagem}</p>
              )}
              {Array.isArray(resultado.ignoradas) && resultado.ignoradas.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                    {resultado.ignoradas.length} linhas ignoradas (saldo, subtotal, cabeçalho)
                  </summary>
                  <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                    {resultado.ignoradas.map((x, i) => (
                      <p key={i} className="text-xs text-gray-500 font-mono">L{x.linha}: {x.motivo} — {x.conteudo.slice(0, 60)}</p>
                    ))}
                  </div>
                </details>
              )}
              {temRevisar && (resultado.a_revisar ?? 0) > 0 && (
                <button onClick={() => setVista('revisar')}
                  className="mt-3 w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-700">
                  Revisar {resultado.a_revisar} lançamentos
                </button>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="font-bold text-gray-700 mb-3 text-sm">Importações anteriores</h3>
            {importacoes.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhuma importação ainda</p>}
            <div className="space-y-1">
              {importacoes.map(i => (
                <div key={i.id} className="flex items-center gap-2 text-xs border border-gray-100 rounded px-2 py-1.5">
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-gray-700">{i.arquivo_nome}</span>
                  <span className="text-gray-400 shrink-0">{i.periodo_inicio} a {i.periodo_fim}</span>
                  <span className="text-green-600 font-medium shrink-0">+{i.linhas_novas}</span>
                  {i.linhas_duplicadas > 0 && <span className="text-gray-400 shrink-0">({i.linhas_duplicadas} rep.)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- REVISAR ---------------- */}
      {vista === 'revisar' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h2 className="font-bold text-gray-700 mb-1">Revisar classificação</h2>
          <p className="text-xs text-gray-500 mb-4">
            Só aparece aqui o que a IA sugeriu ou o que ninguém classificou. Ao escolher a
            categoria, o sistema cria a regra — esse fornecedor não pergunta de novo.
          </p>

          {carregandoLanc && <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#F7941D]" /></div>}

          {!carregandoLanc && lancamentos.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Nada para revisar em {rotuloMes(mes)}</p>
            </div>
          )}

          <div className="space-y-2">
            {lancamentos.map(l => (
              <div key={l.id} className={`border rounded-lg p-3 ${l.valor > 0 ? 'border-green-100 bg-green-50/40' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-gray-800 truncate">
                      {l.contraparte || l.descricao}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{l.descricao}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR')}
                      {l.contas_financeiras?.nome ? ` · ${l.contas_financeiras.nome}` : ''}
                      {l.categoria_origem === 'ia' ? ' · sugerido pela IA' : ''}
                    </p>
                  </div>
                  <p className={`font-bold text-sm shrink-0 ${l.valor > 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {brl(l.valor)}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <select
                    defaultValue={l.categoria_id || ''}
                    onChange={e => e.target.value && categorizar(l.id, e.target.value)}
                    disabled={salvando === l.id}
                    className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#F7941D] disabled:opacity-50"
                  >
                    <option value="">— escolher categoria —</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  {l.categoria_id && (
                    <button onClick={() => confirmar(l.id)} disabled={salvando === l.id}
                      className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
                      ✓ Está certo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- DRE ---------------- */}
      {vista === 'dre' && (
        <div className="space-y-4">
          {carregandoDre && <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#F7941D]" /></div>}

          {!carregandoDre && dre && dre.qualidade.lancamentos_no_mes === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <p className="text-sm text-gray-500">Nenhum lançamento importado em {rotuloMes(mes)}</p>
            </div>
          )}

          {!carregandoDre && dre && dre.qualidade.lancamentos_no_mes > 0 && (
            <>
              {!dre.qualidade.confiavel && (
                <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>DRE provisório.</strong> {dre.qualidade.a_revisar} lançamentos ainda
                    pendentes de revisão
                    {dre.qualidade.sem_categoria_qtd > 0 && `, ${dre.qualidade.sem_categoria_qtd} sem categoria (${brl(dre.qualidade.sem_categoria_valor)})`}.
                    Os números abaixo mudam conforme você revisa.
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-[#F7941D]" />
                  <h2 className="font-bold text-gray-700">DRE — {rotuloMes(dre.mes)}</h2>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {([
                      ['Receita', dre.dre.receita, 'pos', false],
                      ['(−) CMV', -dre.dre.cmv, 'neg', false],
                      [`= Lucro bruto${dre.dre.margem_bruta_pct !== null ? ` (${dre.dre.margem_bruta_pct}%)` : ''}`, dre.dre.lucro_bruto, 'tot', true],
                      ['(−) Custo variável', -dre.dre.custo_variavel, 'neg', false],
                      ['(−) Custo fixo', -dre.dre.custo_fixo, 'neg', false],
                      ['(−) Imposto', -dre.dre.imposto, 'neg', false],
                      ['(−) Taxas financeiras', -dre.dre.taxa_financeira, 'neg', false],
                      [`= Lucro operacional${dre.dre.margem_operacional_pct !== null ? ` (${dre.dre.margem_operacional_pct}%)` : ''}`, dre.dre.lucro_operacional, 'tot', true],
                      ['(−) Serviço de dívida', -dre.dre.servico_divida, 'neg', false],
                      ['(−) Retirada de sócio', -dre.dre.retirada_socio, 'neg', false],
                      ['= Caixa livre', dre.dre.caixa_livre, 'tot', true],
                    ] as const).map(([rot, val, tipo, destaque]) => (
                      <tr key={rot} className={destaque ? 'border-t border-gray-200' : ''}>
                        <td className={`py-1.5 ${destaque ? 'font-bold text-gray-800' : 'text-gray-600 pl-2'}`}>{rot}</td>
                        <td className={`py-1.5 text-right font-mono ${
                          destaque ? (val < 0 ? 'font-bold text-red-700' : 'font-bold text-gray-800')
                          : tipo === 'neg' ? 'text-red-600' : 'text-green-700'
                        }`}>{brl(val)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-3">
                  Serviço de dívida e retirada de sócio ficam abaixo do lucro operacional de
                  propósito: são saída de caixa, não despesa do período.
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-blue-100 p-4">
                <h3 className="font-bold text-blue-700 text-sm mb-3">Receita: banco × sistema</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-gray-500">Entrou em conta</p><p className="font-bold text-gray-800">{brl(dre.conciliacao_receita.receita_no_banco)}</p></div>
                  <div><p className="text-xs text-gray-500">Vendido no sistema</p><p className="font-bold text-gray-800">{brl(dre.conciliacao_receita.venda_no_sistema)}</p></div>
                  <div><p className="text-xs text-gray-500">Diferença</p><p className="font-bold text-amber-700">{brl(dre.conciliacao_receita.diferenca)}</p></div>
                </div>
                <p className="text-xs text-gray-500 mt-2">{dre.conciliacao_receita.nota}</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <h3 className="font-bold text-gray-600 text-sm mb-2">Fora do DRE</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Transferência entre contas próprias</p>
                    <p className="font-bold text-gray-700">{brl(dre.fora_do_dre.transferencia_entre_contas)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Não operacional</p>
                    <p className="font-bold text-gray-700">{brl(dre.fora_do_dre.nao_operacional)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Dinheiro que só mudou de conta. Somar isso como receita infla o faturamento.
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <h3 className="font-bold text-gray-700 text-sm mb-3">Por categoria</h3>
                <div className="space-y-1">
                  {dre.categorias.map(c => (
                    <div key={c.categoria} className="flex items-center gap-2 text-xs border-b border-gray-50 py-1.5">
                      <span className="flex-1 min-w-0 truncate text-gray-700">{c.categoria}</span>
                      <span className="text-gray-400 shrink-0">{c.lancamentos}x</span>
                      {!c.entra_no_dre && <span className="text-gray-400 shrink-0 italic">fora do DRE</span>}
                      <span className={`font-mono shrink-0 ${c.valor < 0 ? 'text-red-600' : 'text-green-700'}`}>{brl(c.valor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------- Itau pela API
// Extrato da conta corrente puxado direto do banco (API Account Statement).
// O cron roda todo dia; aqui o Roger ve o status, testa a conexao e busca
// um periodo na mao. Sem credenciais mostra o passo a passo e nada mais.
function BlocoItau({ onImportou }: { onImportou: (r: ResultadoImportacao) => void }) {
  const [status, setStatus] = useState<StatusItau | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [de, setDe] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [ate, setAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [ocupado, setOcupado] = useState<'testar' | 'importar' | null>(null);
  const [teste, setTeste] = useState<TesteItau | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setStatus(await apiFinanceiro<StatusItau>('/api/financeiro/itau', { cache: 'no-store' })); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao consultar a API do Itaú'); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const rodar = async (acao: 'testar' | 'importar') => {
    setOcupado(acao); setErro(null); setAviso(null); setTeste(null);
    try {
      if (acao === 'testar') {
        setTeste(await apiFinanceiro<TesteItau>('/api/financeiro/itau', { method: 'POST', body: JSON.stringify({ acao, de, ate }) }));
      } else {
        const r = await apiFinanceiro<ResultadoImportacao>('/api/financeiro/itau', { method: 'POST', body: JSON.stringify({ acao, de, ate }) });
        setAviso(r.total === 0 ? 'Sem movimento no período.' : `${r.novos} lançamento(s) novo(s) de ${r.total} (${r.duplicados + r.duplicados_por_conteudo} já estavam).`);
        onImportou(r);
        carregar();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao falar com o Itaú');
    } finally { setOcupado(null); }
  };

  const u = status?.ultima_sincronizacao ?? null;
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-bold text-gray-700 flex items-center gap-2"><Landmark className="w-4 h-4 text-[#F7941D]" /> Itaú · extrato pela API</h2>
          <p className="text-xs text-gray-500 mt-0.5">A conta corrente entra sozinha todo dia de manhã (Pix, boletos, TED, tarifas). O upload do arquivo abaixo vira só reserva.</p>
        </div>
        {carregando ? <span className="text-xs text-gray-400">carregando…</span>
          : status?.configurado
            ? <span className={`text-xs font-semibold px-2 py-1 rounded-full ${u?.ok === false ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {status.ambiente === 'sandbox' ? 'sandbox' : 'ligada'}{u ? ` · ${u.ok ? 'atualizado' : 'erro'} ${quando(u.em)}` : ' · ainda não rodou'}
              </span>
            : <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">não configurada</span>}
      </div>

      {erro && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}

      {status && !status.configurado && (
        <div className="mt-3 text-xs text-gray-600 space-y-1">
          <p>Falta na Vercel: <code className="bg-gray-100 px-1 rounded">{status.falta.join('</code>, <code className="bg-gray-100 px-1 rounded">')}</code>.</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Itaú for Developers › aplicação › gerar credencial (Client ID e Client Secret).</li>
            <li>Solicitar o certificado (Owner aprova no Bankline) e baixar o certificado e a chave.</li>
            <li>Cadastrar <code className="bg-gray-100 px-1 rounded">ITAU_CLIENT_ID</code>, <code className="bg-gray-100 px-1 rounded">ITAU_CLIENT_SECRET</code>, <code className="bg-gray-100 px-1 rounded">ITAU_CERTIFICADO</code> e <code className="bg-gray-100 px-1 rounded">ITAU_CHAVE_PRIVADA</code> na Vercel e fazer o redeploy.</li>
          </ol>
        </div>
      )}

      {status?.configurado && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
            {status.conta && <span>Conta: <strong>{status.conta.nome}</strong>{status.conta.agencia ? ` · ag ${status.conta.agencia} cc ${status.conta.conta}` : ''}</span>}
            {!status.conta?.statement_id && <span className="text-amber-700">Sem agência/conta cadastradas: defina ITAU_STATEMENT_ID.</span>}
            {u && <span>Última: {u.de} a {u.ate} · {u.origem === 'cron' ? 'automática' : 'manual'} · {u.ok ? `${u.novos} novo(s) de ${u.total}` : u.erro}</span>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600">De<br /><input type="date" value={de} onChange={e => setDe(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white" /></label>
            <label className="text-xs text-gray-600">Até<br /><input type="date" value={ate} onChange={e => setAte(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white" /></label>
            <button onClick={() => rodar('testar')} disabled={ocupado !== null}
              className="px-3 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}
            </button>
            <button onClick={() => rodar('importar')} disabled={ocupado !== null || !status.conta?.statement_id}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#F7941D] text-white hover:bg-[#e8860f] disabled:opacity-50 inline-flex items-center gap-1">
              <RefreshCw className={`w-4 h-4 ${ocupado === 'importar' ? 'animate-spin' : ''}`} /> {ocupado === 'importar' ? 'Buscando…' : 'Buscar extrato'}
            </button>
          </div>
          {aviso && <p className="text-xs text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{aviso}</p>}
          {teste && (
            <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-1">
              <p><strong>Conexão OK</strong> ({teste.ambiente}) · conta {teste.statement_id} · {teste.periodo[0]} a {teste.periodo[1]}</p>
              <p>{teste.lancamentos} lançamento(s) ({teste.ja_importados} já no sistema) · {teste.entradas.qtd} entrada(s) {brl(teste.entradas.total)} · {teste.saidas.qtd} saída(s) {brl(teste.saidas.total)}</p>
              {teste.saldos.length > 0 && <p>Saldo: {teste.saldos.map(s => `${dataBR(s.data)} ${brl(s.saldo)}`).join(' · ')}</p>}
              {teste.amostra.length > 0 && (
                <div className="font-mono text-[11px] text-gray-600 pt-1">
                  {teste.amostra.map((a, i) => <p key={i} className="truncate">{dataBR(a.data)} {brl(a.valor).padStart(14)} {a.descricao}{a.contraparte ? ` · ${a.contraparte}` : ''}</p>)}
                </div>
              )}
              <p className="text-gray-500">Nada foi gravado. Use “Buscar extrato” para importar.</p>
            </div>
          )}
          {status.importacoes.length > 0 && (
            <div className="text-xs text-gray-500 space-y-0.5">
              {status.importacoes.slice(0, 4).map(i => <p key={i.id}>{quando(i.criado_em)} · {i.periodo_inicio} a {i.periodo_fim} · +{i.linhas_novas} de {i.linhas_total}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
