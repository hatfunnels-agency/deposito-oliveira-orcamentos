'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataCurta, numero } from '@/lib/financeiro/formato';
import {
  Abas, Aviso, BotaoPerigo, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Carregando, Cartao, Erro,
  INPUT, Modal, Selo, Vazio,
} from './Comuns';

// Cadastro de produtos na Gestao (saiu do sistema principal em out/2026):
// preco, custo, margem, novo produto, editar e historico de custos. Saldo,
// contagem, sob demanda e prazo de entrega ficam na secao Estoque.
//
// Usa as rotas /api/produtos (as mesmas do catalogo). Excluir passa pela
// Gestao (/api/financeiro/estoque), que arquiva e confere estoque compartilhado.

interface ProdutoApi {
  id: string;
  nome: string;
  codigo: string | null;
  categoria: string | null;
  preco: number;
  preco_custo: number;
  unidade: string;                    // unidade de venda
  unidade_armazenamento: string;
  fator_conversao: number;
  estoque_minimo: number;             // em unidade de venda
  tipo_estoque: 'estocavel' | 'sob_demanda';
  vendavel?: boolean;
  estoque_compartilhado_com: string | null;
  baixa_estoque_em_produto_id: string | null;
  baixa_estoque_fator: number | null;
  qtd_vendas: number;
  ultima_atualizacao_custo: string | null;
}

interface HistoricoCusto { id: string; custo_anterior: number; custo_novo: number; criado_em: string; usuario_nome: string | null }

type Filtro = 'todos' | 'estocavel' | 'sob_demanda' | 'so_estoque' | 'sem_custo';

const margemPct = (p: { preco: number; preco_custo: number }) =>
  p.preco > 0 && p.preco_custo > 0 ? ((p.preco - p.preco_custo) / p.preco) * 100 : null;

async function usuarioId(): Promise<string | null> {
  const { data } = await supabaseBrowser.auth.getSession();
  return data.session?.user.id ?? null;
}

async function putProduto(id: string, corpo: Record<string, unknown>) {
  const res = await fetch(`/api/produtos/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ ...corpo, usuario_id: await usuarioId() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) throw new Error(data?.error || 'Falha ao salvar');
}

export default function Produtos() {
  const [lista, setLista] = useState<ProdutoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editando, setEditando] = useState<ProdutoApi | 'novo' | null>(null);
  const [historico, setHistorico] = useState<ProdutoApi | null>(null);
  const [custoId, setCustoId] = useState<string | null>(null);
  const [custoValor, setCustoValor] = useState<number | null>(null);
  const [salvandoCusto, setSalvandoCusto] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const res = await fetch('/api/produtos', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar produtos');
      setLista((data.produtos ?? []) as ProdutoApi[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar produtos');
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3000);
    return () => clearTimeout(t);
  }, [aviso]);

  const todos = useMemo(() => lista ?? [], [lista]);
  const categorias = useMemo(() => [...new Set(todos.map(p => p.categoria || 'Geral'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [todos]);
  const contagem = useMemo(() => ({
    estocavel: todos.filter(p => p.tipo_estoque !== 'sob_demanda' && p.vendavel !== false).length,
    sob_demanda: todos.filter(p => p.tipo_estoque === 'sob_demanda').length,
    so_estoque: todos.filter(p => p.vendavel === false).length,
    sem_custo: todos.filter(p => !(p.preco_custo > 0)).length,
  }), [todos]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todos
      .filter(p => {
        if (categoria && (p.categoria || 'Geral') !== categoria) return false;
        if (termo && !p.nome.toLowerCase().includes(termo) && !(p.codigo ?? '').toLowerCase().includes(termo)) return false;
        if (filtro === 'estocavel') return p.tipo_estoque !== 'sob_demanda' && p.vendavel !== false;
        if (filtro === 'sob_demanda') return p.tipo_estoque === 'sob_demanda';
        if (filtro === 'so_estoque') return p.vendavel === false;
        if (filtro === 'sem_custo') return !(p.preco_custo > 0);
        return true;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [todos, busca, categoria, filtro]);

  const salvarCusto = async (p: ProdutoApi) => {
    if (custoValor === null || custoValor < 0) { setAviso('Custo inválido.'); return; }
    if (Math.abs(custoValor - (p.preco_custo || 0)) < 0.005) { setCustoId(null); return; }
    setSalvandoCusto(true);
    try {
      await putProduto(p.id, { preco_custo: custoValor });
      setAviso(`Custo de ${p.nome} atualizado.`);
      setCustoId(null);
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Erro ao salvar o custo');
    } finally {
      setSalvandoCusto(false);
    }
  };

  if (!lista && !erro) return <Carregando texto="Carregando produtos…" />;
  if (!lista) return <Erro mensagem={erro!} onTentar={carregar} />;

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou código" aria-label="Buscar produto"
              className={`${INPUT} pl-9 min-h-[44px]`} />
          </div>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoria" className={`${INPUT} sm:w-56 min-h-[44px]`}>
            <option value="">Todas as categorias</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <BotaoPrimario onClick={() => setEditando('novo')} className="min-h-[44px]"><Plus className="w-4 h-4" /> Novo produto</BotaoPrimario>
        </div>
        <Abas className="mt-3" valor={filtro} onChange={setFiltro} opcoes={[
          { key: 'todos', rotulo: 'Todos', contagem: todos.length },
          { key: 'estocavel', rotulo: 'Estocados', contagem: contagem.estocavel },
          { key: 'sob_demanda', rotulo: 'Sob demanda', contagem: contagem.sob_demanda },
          { key: 'so_estoque', rotulo: 'Só estoque', contagem: contagem.so_estoque },
          { key: 'sem_custo', rotulo: 'Sem custo', contagem: contagem.sem_custo },
        ]} />
      </Cartao>

      {aviso && <Aviso tom="info">{aviso}</Aviso>}
      {erro && <Erro mensagem={erro} onTentar={carregar} />}

      {filtrados.length === 0 ? <Vazio>Nenhum produto com esse filtro.</Vazio> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
          {filtrados.map(p => {
            const m = margemPct(p);
            return (
              <div key={p.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 text-sm break-words">{p.nome}</p>
                  <p className="text-[11px] text-gray-500">
                    {p.categoria || 'Geral'} · {p.codigo || 'sem código'} · por {p.unidade}
                    {p.qtd_vendas > 0 && <> · {p.qtd_vendas} vendas</>}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.vendavel === false && <Selo tom="amarelo" titulo="Fora do catálogo: só controla estoque">só estoque</Selo>}
                    {p.tipo_estoque === 'sob_demanda' && <Selo tom="azul">sob demanda</Selo>}
                    {p.estoque_compartilhado_com && <Selo tom="cinza">estoque compartilhado</Selo>}
                    {p.baixa_estoque_em_produto_id && (
                      <Selo tom="cinza">baixa {numero(p.baixa_estoque_fator ?? 1, (p.baixa_estoque_fator ?? 1) % 1 ? 2 : 0)} de {todos.find(x => x.id === p.baixa_estoque_em_produto_id)?.nome ?? 'outro produto'}</Selo>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:w-[340px] shrink-0 text-right text-sm tabular-nums">
                  <div>
                    <p className="text-[10px] text-gray-500">Venda</p>
                    <p className="font-semibold text-gray-900">{brl(p.preco)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Custo</p>
                    {custoId === p.id ? (
                      <div onKeyDown={e => { if (e.key === 'Enter') salvarCusto(p); if (e.key === 'Escape') setCustoId(null); }}>
                        <CampoMoeda value={custoValor} onChange={setCustoValor} autoFocus disabled={salvandoCusto} />
                        <div className="flex justify-end gap-1 mt-1">
                          <button type="button" onClick={() => setCustoId(null)} className="text-[11px] text-gray-500 px-1 min-h-[32px]">cancelar</button>
                          <button type="button" onClick={() => salvarCusto(p)} disabled={salvandoCusto} className="text-[11px] font-semibold text-[#C96F00] px-1 min-h-[32px]">salvar</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setCustoId(p.id); setCustoValor(p.preco_custo || null); }} title="Toque para editar o custo"
                        className={`font-medium hover:text-[#C96F00] min-h-[32px] ${p.preco_custo > 0 ? 'text-gray-700' : 'text-red-700'}`}>
                        {p.preco_custo > 0 ? brl(p.preco_custo) : 'sem custo'}
                      </button>
                    )}
                    {p.ultima_atualizacao_custo && custoId !== p.id && <p className="text-[10px] text-gray-400">em {dataCurta(p.ultima_atualizacao_custo)}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Margem</p>
                    <p className={`font-bold ${m === null ? 'text-gray-400' : m >= 30 ? 'text-emerald-700' : m >= 15 ? 'text-amber-700' : 'text-red-700'}`}>
                      {m === null ? '—' : `${numero(m, 0)}%`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 sm:flex-col shrink-0">
                  <BotaoSecundario onClick={() => setEditando(p)} aria-label={`Editar ${p.nome}`}><Pencil className="w-4 h-4" /> <span className="sm:hidden">Editar</span></BotaoSecundario>
                  <BotaoSecundario onClick={() => setHistorico(p)} aria-label={`Histórico de custos de ${p.nome}`}><History className="w-4 h-4" /> <span className="sm:hidden">Custos</span></BotaoSecundario>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-500">Saldo, contagem, sob demanda e prazo de entrega ficam na seção Estoque. Produto excluído fica em Estoque › Excluídos e pode ser restaurado.</p>

      {editando && (
        <ModalProduto produto={editando === 'novo' ? null : editando} categorias={categorias}
          onFechar={() => setEditando(null)}
          onSalvo={msg => { setEditando(null); setAviso(msg); carregar(); }} />
      )}
      {historico && <ModalHistorico produto={historico} onFechar={() => setHistorico(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- novo / editar

function ModalProduto({ produto, categorias, onFechar, onSalvo }: {
  produto: ProdutoApi | null; categorias: string[]; onFechar: () => void; onSalvo: (msg: string) => void;
}) {
  const novo = produto === null;
  const fator0 = produto?.fator_conversao || 1;
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [codigo, setCodigo] = useState(produto?.codigo ?? '');
  const [categoria, setCategoria] = useState(produto?.categoria ?? '');
  const [unidadeVenda, setUnidadeVenda] = useState(produto?.unidade ?? 'unidade');
  const [unidadeEstoque, setUnidadeEstoque] = useState(produto?.unidade_armazenamento ?? 'unidade');
  const [fator, setFator] = useState<number | null>(fator0);
  const [preco, setPreco] = useState<number | null>(produto?.preco ?? null);
  const [custo, setCusto] = useState<number | null>(produto?.preco_custo || null);
  // A API devolve o minimo em unidade de venda; grava em unidade de estoque.
  const [minimo, setMinimo] = useState<number | null>(produto ? produto.estoque_minimo : null);
  const [sobDemanda, setSobDemanda] = useState(produto?.tipo_estoque === 'sob_demanda');
  const [vendavel, setVendavel] = useState(produto?.vendavel !== false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const m = preco && custo ? ((preco - custo) / preco) * 100 : null;

  const salvar = async () => {
    setErro(null);
    if (!nome.trim()) { setErro('Informe o nome.'); return; }
    if (!preco || preco <= 0) { setErro('Informe o preço de venda.'); return; }
    if (!fator || fator <= 0) { setErro('Fator de conversão inválido.'); return; }
    setSalvando(true);
    try {
      const minimoEstoque = (minimo ?? 0) * fator;
      if (novo) {
        const res = await fetch('/api/produtos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({
            nome: nome.trim(), codigo: codigo.trim() || null, categoria: categoria.trim() || 'Geral',
            unidade: unidadeEstoque.trim() || 'unidade', unidade_venda: unidadeVenda.trim() || 'unidade',
            preco_venda: preco, preco_custo: custo ?? 0, estoque_minimo: minimoEstoque, fator_conversao: fator,
            tipo_estoque: sobDemanda ? 'sob_demanda' : 'estocavel',
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.error) throw new Error(data?.error || 'Falha ao criar');
        if (!vendavel && data?.id) await putProduto(String(data.id), { vendavel: false });
        onSalvo(`${nome.trim()} criado.${sobDemanda ? '' : ' Faça a contagem em Estoque.'}`);
      } else {
        await putProduto(produto.id, {
          nome: nome.trim(), codigo: codigo.trim() || null, categoria: categoria.trim() || 'Geral',
          unidade_venda: unidadeVenda.trim() || 'unidade', preco_venda: preco, estoque_minimo: minimoEstoque, fator_conversao: fator,
          vendavel,
          ...(Math.abs((custo ?? 0) - (produto.preco_custo || 0)) >= 0.005 ? { preco_custo: custo ?? 0 } : {}),
        });
        onSalvo(`${nome.trim()} salvo.`);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    if (!produto) return;
    if (!window.confirm(`Excluir "${produto.nome}"? Ele some do catálogo, do orçamento e do estoque. Os pedidos antigos continuam com ele, e dá para restaurar em Estoque › Excluídos.`)) return;
    setExcluindo(true);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/estoque', { method: 'PATCH', body: JSON.stringify({ produto_id: produto.id, ativo: false }) });
      onSalvo(`${produto.nome} excluído.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <Modal titulo={novo ? 'Novo produto' : 'Editar produto'} onFechar={onFechar} largura="md"
      rodape={<>
        {!novo && <BotaoPerigo onClick={excluir} carregando={excluindo} className="mr-auto"><Trash2 className="w-4 h-4" /> Excluir</BotaoPerigo>}
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>{novo ? 'Criar' : 'Salvar'}</BotaoPrimario>
      </>}>
      <Campo rotulo="Nome"><input value={nome} onChange={e => setNome(e.target.value)} className={INPUT} autoFocus={novo} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Código"><input value={codigo} onChange={e => setCodigo(e.target.value)} className={INPUT} /></Campo>
        <Campo rotulo="Categoria">
          <input value={categoria} onChange={e => setCategoria(e.target.value)} className={INPUT} list="categorias-produto" />
        </Campo>
      </div>
      <datalist id="categorias-produto">{categorias.map(c => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Preço de venda"><CampoMoeda value={preco} onChange={setPreco} /></Campo>
        <Campo rotulo="Custo"><CampoMoeda value={custo} onChange={setCusto} /></Campo>
        <Campo rotulo="Margem"><p className={`min-h-[40px] flex items-center font-bold tabular-nums ${m === null ? 'text-gray-400' : m >= 30 ? 'text-emerald-700' : m >= 15 ? 'text-amber-700' : 'text-red-700'}`}>{m === null ? '—' : `${numero(m, 1)}%`}</p></Campo>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Vende por"><input value={unidadeVenda} onChange={e => setUnidadeVenda(e.target.value)} className={INPUT} placeholder="saco, m³, peça…" /></Campo>
        <Campo rotulo="Estoque em" dica={novo ? undefined : 'Não muda depois de criado.'}>
          <input value={unidadeEstoque} onChange={e => setUnidadeEstoque(e.target.value)} className={INPUT} disabled={!novo} />
        </Campo>
        <Campo rotulo="Fator" dica="1 de venda = X de estoque"><CampoNumero value={fator} onChange={setFator} min={0} /></Campo>
      </div>
      <Campo rotulo={`Estoque mínimo (${unidadeVenda || 'unidade'})`}><CampoNumero value={minimo} onChange={setMinimo} min={0} /></Campo>
      {novo && (
        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
          <input type="checkbox" checked={sobDemanda} onChange={e => setSobDemanda(e.target.checked)} className="w-5 h-5 accent-[#F7941D]" />
          Sob demanda <span className="text-xs text-gray-500">(vem do fornecedor quando vende)</span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
        <input type="checkbox" checked={vendavel} onChange={e => setVendavel(e.target.checked)} className="w-5 h-5 accent-[#F7941D]" />
        Aparece no catálogo <span className="text-xs text-gray-500">(desmarque se é só para controlar estoque)</span>
      </label>
      {!novo && <p className="text-[11px] text-gray-500">Sob demanda e prazo de entrega mudam na seção Estoque.</p>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------------------------------------------------------- historico de custos

function ModalHistorico({ produto, onFechar }: { produto: ProdutoApi; onFechar: () => void }) {
  const [itens, setItens] = useState<HistoricoCusto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/produtos/${produto.id}/historico-custos`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (vivo) setItens((d?.historico ?? []) as HistoricoCusto[]); })
      .catch(() => { if (vivo) setErro('Erro ao carregar o histórico'); });
    return () => { vivo = false; };
  }, [produto.id]);
  return (
    <Modal titulo={`Custos · ${produto.nome}`} onFechar={onFechar} largura="md"
      rodape={<BotaoSecundario onClick={onFechar}>Fechar</BotaoSecundario>}>
      {erro ? <Aviso tom="erro">{erro}</Aviso>
        : itens === null ? <p className="text-sm text-gray-400">Carregando…</p>
        : itens.length === 0 ? <Vazio>Nenhuma mudança de custo registrada.</Vazio>
        : (
          <ul className="divide-y divide-gray-100">
            {itens.map(h => {
              const dif = h.custo_novo - h.custo_anterior;
              return (
                <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="text-gray-800 tabular-nums">{brl(h.custo_anterior)} → <b>{brl(h.custo_novo)}</b></p>
                    <p className="text-[11px] text-gray-500">{dataCurta(h.criado_em)}{h.usuario_nome ? ` · ${h.usuario_nome}` : ''}</p>
                  </div>
                  <span className={`text-xs font-semibold tabular-nums ${dif > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {dif > 0 ? '+' : ''}{h.custo_anterior > 0 ? `${numero((dif / h.custo_anterior) * 100, 1)}%` : brl(dif)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
    </Modal>
  );
}
