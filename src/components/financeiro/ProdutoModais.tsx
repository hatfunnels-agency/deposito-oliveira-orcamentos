'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, dataCurta, numero } from '@/lib/financeiro/formato';
import { Aviso, BotaoPerigo, BotaoPrimario, BotaoSecundario, Campo, CampoMoeda, CampoNumero, INPUT, Modal, Vazio } from './Comuns';

// Cadastro de produtos (novo, editar, historico de custos), usado pela secao
// Estoque da Gestao. Saiu do sistema principal em out/2026.
//
// Usa as rotas /api/produtos (as mesmas do catalogo). Excluir passa pela
// Gestao (/api/financeiro/estoque), que arquiva e confere estoque compartilhado.

export interface ProdutoApi {
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
  foto_url?: string | null;
  medidas?: string | null;
  estoque_compartilhado_com: string | null;
  baixa_estoque_em_produto_id: string | null;
  baixa_estoque_fator: number | null;
  qtd_vendas: number;
  ultima_atualizacao_custo: string | null;
}

interface HistoricoCusto { id: string; custo_anterior: number; custo_novo: number; criado_em: string; usuario_nome: string | null }

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

// ---------------------------------------------------------------- novo / editar

export function ModalProduto({ produto, categorias, onFechar, onSalvo }: {
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
  const [medidas, setMedidas] = useState(produto?.medidas ?? '');
  const [fotoUrl, setFotoUrl] = useState<string | null>(produto?.foto_url ?? null);
  const [subindo, setSubindo] = useState(false);
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
        if (data?.id && (!vendavel || medidas.trim())) await putProduto(String(data.id), { vendavel, medidas: medidas.trim() });
        onSalvo(`${nome.trim()} criado.${sobDemanda ? '' : ' Faça a contagem em Estoque.'}`);
      } else {
        await putProduto(produto.id, {
          nome: nome.trim(), codigo: codigo.trim() || null, categoria: categoria.trim() || 'Geral',
          unidade_venda: unidadeVenda.trim() || 'unidade', preco_venda: preco, estoque_minimo: minimoEstoque, fator_conversao: fator,
          vendavel, medidas: medidas.trim(),
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
      <Campo rotulo="Medidas / tamanho" dica="Aparece no catálogo e o assistente usa. Ex.: 9 x 19 x 19 cm · barra de 12 m · 3 m de comprimento">
        <input value={medidas} onChange={e => setMedidas(e.target.value)} className={INPUT} maxLength={200} />
      </Campo>
      {!novo && (
        <Campo rotulo="Foto" dica="JPG, PNG ou WebP até 5 MB. Fica pública: a atendente abre e manda no WhatsApp.">
          <div className="flex items-center gap-3">
            {fotoUrl ? <img src={fotoUrl} alt="" className="h-16 w-16 rounded-lg object-cover border border-gray-200" /> : <div className="h-16 w-16 rounded-lg bg-gray-100 border border-dashed border-gray-300" />}
            <div className="flex flex-col gap-1">
              <label className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer min-h-[40px]">
                {subindo ? 'Enviando…' : fotoUrl ? 'Trocar foto' : 'Escolher foto'}
                <input type="file" accept="image/*" className="hidden" disabled={subindo} onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f || !produto) return;
                  setSubindo(true); setErro(null);
                  try {
                    const fd = new FormData(); fd.append('imagem', f);
                    const r = await fetch(`/api/produtos/${produto.id}/foto`, { method: 'POST', body: fd });
                    const d = await r.json().catch(() => null);
                    if (!r.ok) throw new Error(d?.error || 'Erro ao subir a foto');
                    setFotoUrl(d.foto_url);
                  } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao subir a foto'); }
                  finally { setSubindo(false); e.target.value = ''; }
                }} />
              </label>
              {fotoUrl && (
                <button type="button" className="text-xs text-red-700 underline" onClick={async () => {
                  if (!produto) return;
                  await fetch(`/api/produtos/${produto.id}/foto`, { method: 'DELETE' });
                  setFotoUrl(null);
                }}>Tirar foto</button>
              )}
            </div>
          </div>
        </Campo>
      )}
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

export function ModalHistorico({ produto, onFechar }: { produto: ProdutoApi; onFechar: () => void }) {
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

/** Lista do cadastro (mesma rota do catalogo, so ativos). */
export async function carregarProdutosApi(): Promise<ProdutoApi[]> {
  const res = await fetch('/api/produtos', { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Erro ao carregar produtos');
  return (data?.produtos ?? []) as ProdutoApi[];
}
