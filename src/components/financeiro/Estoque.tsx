'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ClipboardCheck, PackageMinus, Search, SlidersHorizontal, ChevronDown, ChevronUp, Trash2, ShoppingCart, Pencil, History, Plus } from 'lucide-react';
import type {
  ItemPainelEstoque, MovimentoEstoque, NovoMovimentoEstoque, PainelEstoque, ResultadoMovimentoEstoque, TipoMovimentoEstoque,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataCurta, diaSemanaCurto, horaBRT, numero } from '@/lib/financeiro/formato';
import {
  Abas, Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, Carregando, Cartao, Erro, Estatistica,
  INPUT, Modal, Selo, Vazio,
} from './Comuns';
import { carregarProdutosApi, ModalHistorico, ModalProduto, type ProdutoApi } from './ProdutoModais';

// Estoque na gestao: quanto dinheiro esta parado na prateleira, o que gira
// e o que acaba quando. O saldo de um produto so vale depois da primeira
// contagem — antes disso quase tudo esta em zero porque o deposito nunca
// contou; a venda so dava baixa.

type Filtro = 'todos' | 'comprar' | 'nao_contados' | 'zerados' | 'abaixo_minimo' | 'sem_venda' | 'sob_demanda' | 'excluidos';

// Horizonte do "comprar em breve": pedidos que vencem nos proximos 6 dias de
// funcionamento (uma semana de seg a sab).
const HORIZONTE_COMPRA = 6;
const comprarEmBreve = (i: ItemPainelEstoque) => !!i.reposicao && i.reposicao.dias_ate_pedido <= HORIZONTE_COMPRA;

const ROTULO_TIPO: Record<string, string> = {
  entrada: 'Entrada', saida: 'Venda', cancelamento: 'Cancelamento', ajuste: 'Ajuste', perda: 'Perda', contagem: 'Contagem',
};

const qtd = (n: number, unidade: string) => `${numero(n, Number.isInteger(n) ? 0 : n < 10 ? 3 : 1)} ${unidade}`;

export default function Estoque() {
  const [dados, setDados] = useState<PainelEstoque | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [aberto, setAberto] = useState<string | null>(null);
  const [acao, setAcao] = useState<{ item: ItemPainelEstoque; tipo: TipoMovimentoEstoque } | null>(null);
  const [versaoHistorico, setVersaoHistorico] = useState(0);
  const [mudandoTipo, setMudandoTipo] = useState<string | null>(null);
  // Cadastro (novo/editar/historico de custos) usa /api/produtos, carregado so quando abre.
  const [cadastro, setCadastro] = useState<ProdutoApi[] | null>(null);
  const [editando, setEditando] = useState<ProdutoApi | 'novo' | null>(null);
  const [vendoCustos, setVendoCustos] = useState<ProdutoApi | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const abrirCadastro = async (produtoId: string | null, acao: 'editar' | 'custos') => {
    setErro(null);
    try {
      const lista = cadastro ?? await carregarProdutosApi();
      setCadastro(lista);
      if (produtoId === null) { setEditando('novo'); return; }
      const p = lista.find(x => x.id === produtoId);
      if (!p) { setErro('Produto não encontrado no cadastro.'); return; }
      if (acao === 'editar') setEditando(p); else setVendoCustos(p);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir o cadastro');
    }
  };
  const categoriasCadastro = useMemo(() => [...new Set((cadastro ?? []).map(p => p.categoria || 'Geral'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [cadastro]);

  // Sob demanda = pedido ao fornecedor so quando vende: sai do painel de
  // saldo e a venda nao baixa estoque.
  const patch = async (produtoId: string, corpo: Record<string, unknown>) => {
    setMudandoTipo(produtoId);
    setErro(null);
    try {
      await apiFinanceiro('/api/financeiro/estoque', { method: 'PATCH', body: JSON.stringify({ produto_id: produtoId, ...corpo }) });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao alterar o produto');
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setMudandoTipo(null);
    }
  };
  const alternarTipo = (produtoId: string, sobDemanda: boolean) => patch(produtoId, { tipo_estoque: sobDemanda ? 'sob_demanda' : 'estocavel' });
  const excluir = (produtoId: string, nome: string) => {
    if (!window.confirm(`Excluir "${nome}"? Ele some do catálogo, do orçamento e do estoque. Os pedidos antigos continuam com ele, e dá para restaurar em "Excluídos".`)) return;
    patch(produtoId, { ativo: false });
  };
  const restaurar = (produtoId: string) => patch(produtoId, { ativo: true });
  const salvarPrazo = (produtoId: string, dias: number | null) => patch(produtoId, { prazo_entrega_dias: dias });

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFinanceiro<PainelEstoque>('/api/financeiro/estoque'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o estoque');
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const itens = useMemo(() => dados?.itens ?? [], [dados]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter(i => {
      if (categoria && (i.categoria || 'Geral') !== categoria) return false;
      if (termo && !i.nome.toLowerCase().includes(termo) && !i.secundarios.some(s => s.toLowerCase().includes(termo))) return false;
      if (filtro === 'comprar') return comprarEmBreve(i);
      if (filtro === 'nao_contados') return !i.ultima_contagem;
      if (filtro === 'zerados') return i.zerado;
      if (filtro === 'abaixo_minimo') return i.abaixo_minimo;
      if (filtro === 'sem_venda') return i.sem_venda_90d;
      return true;
    });
  }, [itens, busca, categoria, filtro]);
  const aComprar = useMemo(() => itens.filter(comprarEmBreve)
    .sort((a, b) => (a.reposicao!.pedir_em.localeCompare(b.reposicao!.pedir_em)) || a.nome.localeCompare(b.nome, 'pt-BR')), [itens]);
  const excluidosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados?.excluidos ?? []).filter(i =>
      (!categoria || (i.categoria || 'Geral') === categoria) && (!termo || i.nome.toLowerCase().includes(termo)));
  }, [dados, busca, categoria]);
  const sobDemanda = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados?.sob_demanda ?? []).filter(i =>
      (!categoria || (i.categoria || 'Geral') === categoria) && (!termo || i.nome.toLowerCase().includes(termo)));
  }, [dados, busca, categoria]);

  if (carregando && !dados) return <Carregando texto="Carregando estoque…" />;
  if (erro && !dados) return <Erro mensagem={erro} onTentar={carregar} />;
  if (!dados) return null;
  const t = dados.totais;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Estatistica rotulo="Valor em estoque (custo)" valor={brl(t.valor_estoque)} detalhe={`${t.itens} produtos estocáveis`} tom="azul" />
        <Estatistica rotulo="Zerados" valor={t.zerados} detalhe="saldo 0 ou negativo" tom={t.zerados ? 'vermelho' : 'neutro'} />
        <Estatistica rotulo="Abaixo do mínimo" valor={t.abaixo_minimo} detalhe="com estoque mínimo cadastrado" tom={t.abaixo_minimo ? 'laranja' : 'neutro'} />
        <Estatistica rotulo="Já contados" valor={`${t.contados} de ${t.itens}`} detalhe={`${t.sem_venda_90d} sem venda em 90 dias`} tom={t.nunca_contados ? 'amarelo' : 'verde'} />
      </div>

      <ComprarEmBreve itens={aComprar} hoje={dados.hoje} contados={t.contados} onVerTodos={() => setFiltro('comprar')} />

      {t.nunca_contados > 0 && (
        <Cartao titulo="Contagem inicial" selo={<Selo tom="amarelo">{t.nunca_contados} sem contagem</Selo>}
          acao={filtro !== 'nao_contados' ? <BotaoSecundario onClick={() => setFiltro('nao_contados')}>Ver os não contados</BotaoSecundario> : undefined}>
          <div className="text-sm text-gray-700 space-y-2">
            <p>O depósito nunca contou o estoque: a venda só dava baixa, por isso quase tudo aparece zerado. <b>O saldo de um produto passa a valer depois da primeira contagem.</b></p>
            <p className="text-gray-600">Como fazer: vá produto por produto, conte o que tem no pátio e toque em <b>Contagem</b>. O sistema grava o número contado e a diferença. Daí em diante, cada compra entra por <b>Entrada</b> (ou pelo lançamento por foto), cada venda baixa sozinha, e quebra ou sumiço entra em <b>Perda</b>.</p>
            <p className="text-gray-600">Valor em estoque, giro e cobertura dos produtos ainda não contados não refletem o pátio.</p>
          </div>
        </Cartao>
      )}

      <Cartao>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto"
              className={`${INPUT} pl-9 min-h-[44px]`} />
          </div>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoria" className={`${INPUT} sm:w-56 min-h-[44px]`}>
            <option value="">Todas as categorias</option>
            {dados.categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <BotaoPrimario onClick={() => abrirCadastro(null, 'editar')} className="min-h-[44px]"><Plus className="w-4 h-4" /> Novo produto</BotaoPrimario>
        </div>
        <Abas className="mt-3" valor={filtro} onChange={setFiltro} opcoes={[
          { key: 'todos', rotulo: 'Todos', contagem: itens.length },
          { key: 'comprar', rotulo: 'Comprar em breve', contagem: aComprar.length },
          { key: 'nao_contados', rotulo: 'Não contados', contagem: t.nunca_contados },
          { key: 'zerados', rotulo: 'Zerados', contagem: t.zerados },
          { key: 'abaixo_minimo', rotulo: 'Abaixo do mínimo', contagem: t.abaixo_minimo },
          { key: 'sem_venda', rotulo: 'Sem venda 90d', contagem: t.sem_venda_90d },
          { key: 'sob_demanda', rotulo: 'Sob demanda', contagem: dados.sob_demanda.length },
          { key: 'excluidos', rotulo: 'Excluídos', contagem: dados.excluidos.length },
        ]} />
      </Cartao>

      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}

      {filtro === 'excluidos' ? (
        <Cartao titulo="Excluídos" selo={<Selo tom="cinza">{excluidosFiltrados.length}</Selo>}>
          <p className="text-xs text-gray-600 mb-3">Produtos arquivados: não aparecem no catálogo, no orçamento nem no estoque. Os pedidos antigos continuam com eles.</p>
          {excluidosFiltrados.length === 0 ? <Vazio>Nenhum produto excluído.</Vazio> : (
            <ul className="divide-y divide-gray-100">
              {excluidosFiltrados.map(i => (
                <li key={i.produto_id} className="py-2 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 break-words">{i.nome}</span>
                    <span className="block text-[11px] text-gray-500">{i.categoria || 'Geral'}</span>
                  </span>
                  <BotaoSecundario onClick={() => restaurar(i.produto_id)} carregando={mudandoTipo === i.produto_id}>Restaurar</BotaoSecundario>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      ) : filtro === 'sob_demanda' ? (
        <Cartao titulo="Sob demanda" selo={<Selo tom="azul">{sobDemanda.length}</Selo>}>
          <p className="text-xs text-gray-600 mb-3">Produtos que vêm direto do fornecedor quando vendem: não têm saldo nem contagem, e a venda não baixa estoque. Desmarque para voltar a controlar o estoque.</p>
          {sobDemanda.length === 0 ? <Vazio>Nenhum produto sob demanda com esse filtro.</Vazio> : (
            <ul className="divide-y divide-gray-100">
              {sobDemanda.map(i => (
                <li key={i.produto_id} className="py-2 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-3 min-h-[44px] min-w-0 cursor-pointer">
                    <input type="checkbox" checked disabled={mudandoTipo === i.produto_id}
                      onChange={() => alternarTipo(i.produto_id, false)} className="w-5 h-5 accent-[#F7941D] shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800 break-words">{i.nome}</span>
                      <span className="block text-[11px] text-gray-500">{i.categoria || 'Geral'}</span>
                    </span>
                  </label>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500 tabular-nums">{numero(i.vendido_90d, 1)} {i.unidade} em 90d</span>
                    <button type="button" onClick={() => abrirCadastro(i.produto_id, 'editar')} aria-label={`Editar ${i.nome}`} title="Editar produto"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-[#C96F00] hover:bg-orange-50"><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={() => excluir(i.produto_id, i.nome)} disabled={mudandoTipo === i.produto_id}
                      aria-label={`Excluir ${i.nome}`} title="Excluir produto"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-700 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      ) : filtrados.length === 0 ? (
        <Vazio>Nenhum produto com esse filtro.</Vazio>
      ) : (
        <div className="space-y-3">
          {filtrados.map(i => (
            <CartaoProduto key={i.produto_id} item={i} aberto={aberto === i.produto_id} versaoHistorico={versaoHistorico}
              onAlternar={() => setAberto(a => (a === i.produto_id ? null : i.produto_id))}
              onAcao={tipo => setAcao({ item: i, tipo })}
              mudandoTipo={mudandoTipo === i.produto_id} onSobDemanda={() => alternarTipo(i.produto_id, true)}
              onExcluir={() => excluir(i.produto_id, i.nome)} onPrazo={d => salvarPrazo(i.produto_id, d)}
              onEditar={() => abrirCadastro(i.produto_id, 'editar')} onCustos={() => abrirCadastro(i.produto_id, 'custos')}
              onEditarVinculado={id => abrirCadastro(id, 'editar')} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        Vendido = pedidos confirmados (fora orçamento e cancelado) dos últimos 30/90 dias, convertidos para a unidade de estoque e somando os produtos que compartilham o estoque.
        Giro 90d ≈ vendido em 90 dias ÷ estoque atual (o estoque médio ainda não existe: só passa a haver histórico de saldo depois da primeira contagem).
        Cobertura = estoque ÷ venda média diária dos últimos 30 dias.
        Reposição (só produtos já contados): pedir quando o saldo cobrir 2× o prazo de entrega no ritmo atual (ferro: 1 semana de prazo → pedir com 2 semanas de estoque), ou 3 dias de venda se a entrega é rápida; o estoque mínimo cadastrado vale se for maior. A sugestão cobre o que vende até chegar mais 2 semanas (seg a sáb), no ritmo dos últimos 30 dias. Ferro conta a barra (12 m) e a calculadora de ferragem.
      </p>

      {editando && (
        <ModalProduto produto={editando === 'novo' ? null : editando} categorias={categoriasCadastro}
          onFechar={() => setEditando(null)}
          onSalvo={msg => { setEditando(null); setCadastro(null); setAviso(msg); carregar(); }} />
      )}
      {vendoCustos && <ModalHistorico produto={vendoCustos} onFechar={() => setVendoCustos(null)} />}

      {acao && (
        <ModalMovimento item={acao.item} tipoInicial={acao.tipo} onFechar={() => setAcao(null)}
          onSalvo={() => { setAcao(null); setAberto(acao.item.produto_id); setVersaoHistorico(v => v + 1); carregar(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- cartao

function CartaoProduto({ item: i, aberto, versaoHistorico, onAlternar, onAcao, mudandoTipo, onSobDemanda, onExcluir, onPrazo, onEditar, onCustos, onEditarVinculado }: {
  item: ItemPainelEstoque; aberto: boolean; versaoHistorico: number;
  onAlternar: () => void; onAcao: (t: TipoMovimentoEstoque) => void;
  mudandoTipo: boolean; onSobDemanda: () => void; onExcluir: () => void; onPrazo: (dias: number | null) => void;
  onEditar: () => void; onCustos: () => void; onEditarVinculado: (produtoId: string) => void;
}) {
  const cobertura = i.cobertura_dias === null ? (i.zerado ? '—' : 'sem venda') : `${numero(i.cobertura_dias, i.cobertura_dias < 10 ? 1 : 0)} dias`;
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100">
      <button type="button" onClick={onAlternar} aria-expanded={aberto}
        className="w-full text-left p-4 flex items-start justify-between gap-3 min-h-[44px]">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 text-sm break-words">{i.nome}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {i.categoria || 'Geral'}
          </p>
          <div className="flex flex-wrap gap-1 mt-2">
            {!i.ultima_contagem && <Selo tom="amarelo">nunca contado</Selo>}
            {i.reposicao && i.reposicao.dias_ate_pedido <= HORIZONTE_COMPRA && (
              <Selo tom={i.reposicao.dias_ate_pedido <= 0 ? 'vermelho' : 'laranja'}>
                {i.reposicao.dias_ate_pedido <= 0 ? 'pedir já' : `pedir ${diaSemanaCurto(i.reposicao.pedir_em)} ${dataCurta(i.reposicao.pedir_em)}`}
              </Selo>
            )}
            {i.zerado && <Selo tom="vermelho">zerado</Selo>}
            {i.abaixo_minimo && <Selo tom="laranja">abaixo do mínimo ({qtd(i.estoque_minimo, i.unidade)})</Selo>}
            {i.sem_venda_90d && <Selo tom="cinza">sem venda 90d</Selo>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-base font-bold tabular-nums ${i.zerado ? 'text-red-700' : 'text-gray-900'}`}>{qtd(i.estoque_atual, i.unidade)}</p>
          <p className="text-xs text-gray-500 tabular-nums">{brl(i.valor_estoque)}</p>
          {aberto ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto mt-1" />}
        </div>
      </button>

      {i.vinculados.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          <span>Vendidos como:</span>
          {i.vinculados.map(v => (
            <button key={v.produto_id} type="button" onClick={() => onEditarVinculado(v.produto_id)} title={`Editar ${v.nome}`}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 min-h-[32px] text-gray-700 hover:border-[#F7941D] hover:text-[#C96F00]">
              <Pencil className="w-3 h-3" /> {v.nome}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Dado rotulo="Cobertura" valor={cobertura} />
        <Dado rotulo="Giro 90d" valor={i.giro_90d === null ? '—' : `${numero(i.giro_90d, 1)}x`} />
        <Dado rotulo="Vendido 30d / 90d" valor={`${numero(i.vendido_30d, 1)} / ${numero(i.vendido_90d, 1)}`} />
        <Dado rotulo="Custo / última entrada" valor={`${brl(i.custo_unitario)} · ${i.ultima_entrada ? dataCurta(i.ultima_entrada) : '—'}`} />
        <Dado rotulo={`Venda por ${i.unidade_venda}`} valor={brl(i.preco_venda)} />
        <Dado rotulo="Margem" valor={i.preco_venda > 0 && i.preco_custo > 0 ? `${numero(((i.preco_venda - i.preco_custo) / i.preco_venda) * 100, 0)}%` : '—'} />
      </div>

      <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <BotaoSecundario onClick={() => onAcao('entrada')}><ArrowDownToLine className="w-4 h-4" /> Entrada</BotaoSecundario>
        <BotaoSecundario onClick={() => onAcao('perda')}><PackageMinus className="w-4 h-4" /> Perda</BotaoSecundario>
        <BotaoSecundario onClick={() => onAcao('ajuste')}><SlidersHorizontal className="w-4 h-4" /> Ajuste</BotaoSecundario>
        <BotaoSecundario onClick={() => onAcao('contagem')}><ClipboardCheck className="w-4 h-4" /> Contagem</BotaoSecundario>
      </div>

      <div className="px-4 pb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        <label className="flex items-center gap-2 min-h-[44px]">
          Prazo de entrega
          <input type="number" inputMode="numeric" min={0} max={120} defaultValue={i.prazo_entrega_dias ?? ''} placeholder="rápida"
            key={`${i.produto_id}-${i.prazo_entrega_dias ?? ''}`} disabled={mudandoTipo}
            onBlur={e => {
              const v = e.target.value.trim() === '' ? null : Number(e.target.value);
              if ((v ?? null) !== (i.prazo_entrega_dias ?? null)) onPrazo(v && v > 0 ? v : null);
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" aria-label={`Prazo de entrega de ${i.nome} em dias`} />
          dias
        </label>
        {i.reposicao && (
          <span className="text-gray-500">
            pedir com {qtd(i.reposicao.ponto_pedido, i.unidade)}
            {i.reposicao.ponto_pedido > i.estoque_minimo && i.reposicao.minimo_sugerido > i.estoque_minimo
              ? ` (${i.reposicao.cobertura_pedido_dias} dias de venda${i.prazo_entrega_dias ? `: 2× o prazo` : ''})` : ' (mínimo cadastrado)'}
          </span>
        )}
      </div>
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-600 min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={false} disabled={mudandoTipo} onChange={onSobDemanda} className="w-5 h-5 accent-[#F7941D]" />
          Sob demanda <span className="text-gray-400 hidden sm:inline">(vem do fornecedor quando vende)</span>
        </label>
        <div className="flex items-center">
          <button type="button" onClick={onEditar}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#C96F00] hover:bg-orange-50 rounded-lg px-2 min-h-[44px]">
            <Pencil className="w-4 h-4" /> Editar
          </button>
          <button type="button" onClick={onCustos}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#C96F00] hover:bg-orange-50 rounded-lg px-2 min-h-[44px]">
            <History className="w-4 h-4" /> Custos
          </button>
          <button type="button" onClick={onExcluir} disabled={mudandoTipo}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-lg px-2 min-h-[44px]">
            <Trash2 className="w-4 h-4" /> Excluir
          </button>
        </div>
      </div>

      {aberto && <Historico produtoId={i.produto_id} unidade={i.unidade} versao={versaoHistorico} />}
    </section>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 min-w-0">
      <p className="text-[10px] text-gray-500 truncate">{rotulo}</p>
      <p className="font-medium text-gray-800 tabular-nums truncate">{valor}</p>
    </div>
  );
}

// ---------------------------------------------------------------- historico

function Historico({ produtoId, unidade, versao, limite = 15 }: { produtoId: string; unidade: string; versao: number; limite?: number }) {
  const [movs, setMovs] = useState<MovimentoEstoque[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    apiFinanceiro<{ movimentacoes: MovimentoEstoque[] }>(`/api/financeiro/estoque?produto_id=${encodeURIComponent(produtoId)}&limite=${limite}`)
      .then(r => { if (vivo) setMovs(r.movimentacoes); })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Erro ao carregar o histórico'); });
    return () => { vivo = false; };
  }, [produtoId, versao, limite]);

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-600 mb-2">Últimas movimentações</p>
      {erro ? <p className="text-xs text-red-700">{erro}</p>
        : movs === null ? <p className="text-xs text-gray-400">Carregando…</p>
        : movs.length === 0 ? <p className="text-xs text-gray-400">Nenhuma movimentação ainda.</p>
        : (
          <ul className="divide-y divide-gray-100">
            {movs.map(m => {
              const dif = m.estoque_novo - m.estoque_anterior;
              return (
                <li key={m.id} className="py-1.5 flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-800">{ROTULO_TIPO[m.tipo] ?? m.tipo}</span>
                    <span className="text-gray-500"> · {dataCurta(m.criado_em)} {horaBRT(m.criado_em)}</span>
                    {m.observacoes && <p className="text-gray-500 break-words">{m.observacoes}</p>}
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <span className={dif > 0 ? 'text-emerald-700' : dif < 0 ? 'text-red-700' : 'text-gray-500'}>
                      {dif > 0 ? '+' : ''}{numero(dif, Number.isInteger(dif) ? 0 : 3)}
                    </span>
                    <p className="text-gray-400">{numero(m.estoque_anterior, 0)} → {qtd(m.estoque_novo, unidade)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

// ---------------------------------------------------------------- modal

function ModalMovimento({ item, tipoInicial, onFechar, onSalvo }: {
  item: ItemPainelEstoque; tipoInicial: TipoMovimentoEstoque; onFechar: () => void; onSalvo: (r: ResultadoMovimentoEstoque) => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimentoEstoque>(tipoInicial);
  const [quantidade, setQuantidade] = useState<number | null>(null);
  const [sinal, setSinal] = useState<1 | -1>(1);
  const [custo, setCusto] = useState<number | null>(item.custo_unitario || null);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const motivoObrigatorio = tipo === 'perda' || tipo === 'ajuste';
  const atual = item.estoque_atual;
  const novo = quantidade === null ? null
    : tipo === 'entrada' ? atual + quantidade
    : tipo === 'perda' ? atual - quantidade
    : tipo === 'ajuste' ? atual + sinal * quantidade
    : quantidade;

  const salvar = async () => {
    setErro(null);
    if (quantidade === null || !Number.isFinite(quantidade)) { setErro(tipo === 'contagem' ? 'Informe quanto foi contado.' : 'Informe a quantidade.'); return; }
    if (tipo !== 'contagem' && quantidade <= 0) { setErro('A quantidade tem que ser maior que zero.'); return; }
    if (tipo === 'contagem' && quantidade < 0) { setErro('Contagem não pode ser negativa.'); return; }
    if (motivoObrigatorio && !motivo.trim()) { setErro('Informe o motivo.'); return; }
    if (novo !== null && novo < 0) { setErro('O estoque ficaria negativo. Faça uma contagem.'); return; }
    setSalvando(true);
    try {
      const corpo: NovoMovimentoEstoque = {
        produto_id: item.produto_id,
        tipo,
        quantidade: tipo === 'ajuste' ? sinal * quantidade : quantidade,
        ...(tipo === 'entrada' && custo !== null ? { custo_unitario: custo } : {}),
        motivo: motivo.trim() || null,
      };
      const r = await apiFinanceiro<ResultadoMovimentoEstoque>('/api/financeiro/estoque', { method: 'POST', body: JSON.stringify(corpo) });
      onSalvo(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const custoMudou = tipo === 'entrada' && custo !== null && Math.abs(custo - item.custo_unitario) >= 0.005;

  return (
    <Modal titulo={item.nome} onFechar={onFechar} largura="md"
      rodape={<>
        <BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar {ROTULO_TIPO[tipo].toLowerCase()}</BotaoPrimario>
      </>}>
      <Abas valor={tipo} onChange={t => { setTipo(t); setErro(null); }} opcoes={[
        { key: 'entrada', rotulo: 'Entrada' }, { key: 'perda', rotulo: 'Perda' },
        { key: 'ajuste', rotulo: 'Ajuste' }, { key: 'contagem', rotulo: 'Contagem' },
      ]} />
      <p className="text-xs text-gray-500">
        {tipo === 'entrada' && 'Mercadoria que chegou (compra). Soma no estoque.'}
        {tipo === 'perda' && 'Quebra, avaria, vencimento, sumiço. Tira do estoque.'}
        {tipo === 'ajuste' && 'Correção pontual para mais ou para menos. Para acertar o saldo inteiro, prefira Contagem.'}
        {tipo === 'contagem' && 'Digite o que você contou no pátio. O saldo passa a ser esse número e a diferença fica registrada.'}
      </p>

      {tipo === 'ajuste' && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setSinal(1)}
            className={`min-h-[44px] rounded-lg border text-sm font-medium ${sinal === 1 ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-300 text-gray-600'}`}>+ Somar</button>
          <button type="button" onClick={() => setSinal(-1)}
            className={`min-h-[44px] rounded-lg border text-sm font-medium ${sinal === -1 ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 text-gray-600'}`}>− Tirar</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo={tipo === 'contagem' ? 'Quantidade contada' : 'Quantidade'}>
          <CampoNumero value={quantidade} onChange={setQuantidade} min={0} sufixo={item.unidade} />
        </Campo>
        {tipo === 'entrada' && (
          <Campo rotulo={`Custo por ${item.unidade}`} dica={custoMudou ? `Atualiza o custo do produto (hoje ${brl(item.custo_unitario)}).` : 'Opcional.'}>
            <CampoMoeda value={custo} onChange={setCusto} />
          </Campo>
        )}
      </div>

      <Campo rotulo={motivoObrigatorio ? 'Motivo (obrigatório)' : 'Observação'}>
        <input value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT}
          placeholder={tipo === 'perda' ? 'ex.: saco rasgado na descarga' : tipo === 'ajuste' ? 'ex.: entrega devolvida sem nota' : tipo === 'entrada' ? 'ex.: NF 1234' : 'ex.: contagem de segunda'} />
      </Campo>

      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-3">
        <span className="text-gray-600">Estoque</span>
        <span className="tabular-nums font-medium">
          {qtd(atual, item.unidade)} → <span className={novo !== null && novo < 0 ? 'text-red-700' : 'text-gray-900'}>{novo === null ? '—' : qtd(Math.round(novo * 1000) / 1000, item.unidade)}</span>
        </span>
      </div>
      {tipo === 'contagem' && !item.ultima_contagem && (
        <Aviso tom="info">Primeira contagem deste produto: a partir dela o saldo passa a valer.</Aviso>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Historico produtoId={item.produto_id} unidade={item.unidade} versao={0} limite={5} />
    </Modal>
  );
}

// ---------------------------------------------------------------- comprar em breve

function ComprarEmBreve({ itens, hoje, contados, onVerTodos }: {
  itens: ItemPainelEstoque[]; hoje: string; contados: number; onVerTodos: () => void;
}) {
  if (contados === 0) {
    return (
      <Cartao titulo="Comprar em breve" selo={<Selo tom="cinza">aguardando contagem</Selo>}>
        <p className="text-sm text-gray-600">A previsão de compra aparece aqui assim que os produtos forem contados: o sistema usa o saldo contado e o ritmo de venda dos últimos 30 dias para dizer o que pedir e em que dia.</p>
      </Cartao>
    );
  }
  if (itens.length === 0) {
    return (
      <Cartao titulo="Comprar em breve" selo={<Selo tom="verde">nada esta semana</Selo>}>
        <p className="text-sm text-gray-600">Nenhum produto contado chega ao ponto de pedido nos próximos {HORIZONTE_COMPRA} dias de funcionamento.</p>
      </Cartao>
    );
  }
  const grupos = new Map<string, ItemPainelEstoque[]>();
  for (const i of itens) {
    const chave = i.reposicao!.pedir_em <= hoje ? hoje : i.reposicao!.pedir_em;
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  }
  return (
    <Cartao titulo="Comprar em breve" selo={<Selo tom="laranja">{itens.length}</Selo>}
      acao={<BotaoSecundario onClick={onVerTodos}><ShoppingCart className="w-4 h-4" /> Ver no filtro</BotaoSecundario>}>
      <div className="space-y-3">
        {[...grupos.entries()].map(([dia, lista]) => (
          <div key={dia}>
            <p className="text-xs font-semibold text-gray-600 mb-1">
              {dia === hoje ? 'Pedir hoje' : `Pedir ${diaSemanaCurto(dia)} ${dataCurta(dia)}`}
            </p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {lista.map(i => (
                <li key={i.produto_id} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 break-words">{i.nome}</p>
                    <p className="text-[11px] text-gray-500">
                      tem {qtd(i.estoque_atual, i.unidade)} · vende {numero(i.reposicao!.consumo_dia, i.reposicao!.consumo_dia < 10 ? 1 : 0)}/dia · acaba {diaSemanaCurto(i.reposicao!.acaba_em)} {dataCurta(i.reposicao!.acaba_em)}
                      {i.reposicao!.chega_em && <> · chega {diaSemanaCurto(i.reposicao!.chega_em)} {dataCurta(i.reposicao!.chega_em)} ({i.prazo_entrega_dias} dias)</>}
                    </p>
                    {i.reposicao!.falta_antes_de_chegar && <p className="text-[11px] font-medium text-red-700">Vai faltar antes do pedido chegar.</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-500">sugerido</p>
                    <p className="font-bold tabular-nums text-gray-900">{qtd(i.reposicao!.sugerido, i.unidade)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Cartao>
  );
}
