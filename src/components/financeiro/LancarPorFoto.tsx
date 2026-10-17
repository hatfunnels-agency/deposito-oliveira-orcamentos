'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImageUp, RotateCcw, CheckCircle2 } from 'lucide-react';
import type {
  CandidatoProduto, ContaPagar, Metodo, NovaContaPagar, NovoMovimentoEstoque, PainelEstoque, RespostaLeitura, TipoDocumentoLido,
} from '@/lib/financeiro/tipos';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, hojeBRT, METODOS, numero } from '@/lib/financeiro/formato';
import { arred3, calcularPesagem, densidadePorNome } from '@/lib/financeiro/pesagem';
import {
  Aviso, BotaoPrimario, BotaoSecundario, Campo, CampoFornecedor, CampoMoeda, CampoNumero, INPUT, Modal, Selo,
  useContextoFinanceiro, type EscolhaFornecedor,
} from './Comuns';
import { contaParaMetodo } from './ContasPagar';

// Lancar por foto: tira a foto do comprovante, boleto, nota ou ticket de
// pesagem; a IA le e o formulario abre preenchido para CONFERIR. Nada e
// gravado sem o toque em "Salvar". Destinos combinaveis: financeiro (conta
// a pagar pendente, conta ja paga, ou so o pagamento do dia) e entrada de
// estoque.

type Fase = 'foto' | 'lendo' | 'conferir' | 'salvo';
type DestinoFinanceiro = 'conta_pendente' | 'conta_paga' | 'pagamento_dia' | 'nenhum';

const ROTULO_TIPO: Record<TipoDocumentoLido, string> = {
  comprovante_pagamento: 'Comprovante de pagamento', boleto: 'Boleto', nota_fiscal: 'Nota fiscal',
  ticket_pesagem: 'Ticket de pesagem', outro: 'Documento',
};

interface Linha {
  incluir: boolean;
  descricao: string;
  produtoId: string;
  quantidade: number | null;     // unidade de estoque (ticket: m3 calculado)
  custo: number | null;          // por unidade de estoque (ticket: R$/m3)
  // so ticket
  pesoKg: number | null;
  densidade: number | null;
  conferirPeso: boolean;
}

interface OpcaoProduto { id: string; nome: string; unidade: string; custo: number; densidade: number | null; sugerido: boolean }

const MAX_LADO = 1600;
const MAX_BYTES = 3.5 * 1024 * 1024;

// A Vercel recusa corpo acima de 4,5 MB: reduz para JPEG ~1600px.
async function reduzirImagem(arquivo: File): Promise<Blob> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error('Não consegui abrir a foto. Tente tirar de novo.'));
      i.src = url;
    });
    const escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador não consegue preparar a foto.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error('Foto grande demais mesmo reduzida.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LancarPorFoto({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const { contexto } = useContextoFinanceiro();
  const hoje = hojeBRT();
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const [fase, setFase] = useState<Fase>('foto');
  const [previa, setPrevia] = useState<string | null>(null);
  const [resp, setResp] = useState<RespostaLeitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // formulario
  const [fornecedor, setFornecedor] = useState<EscolhaFornecedor>({ id: null, nome: '' });
  const [categoriaId, setCategoriaId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number | null>(null);
  const [valorEditado, setValorEditado] = useState(false);
  const [dataDoc, setDataDoc] = useState(hoje);
  const [vencimento, setVencimento] = useState(hoje);
  const [documento, setDocumento] = useState('');
  const [obs, setObs] = useState('');
  const [destino, setDestino] = useState<DestinoFinanceiro>('conta_pendente');
  const [metodo, setMetodo] = useState<Metodo>('pix');
  const [contaId, setContaId] = useState<string | null>(null);
  const [dataPagamento, setDataPagamento] = useState(hoje);
  const [comEstoque, setComEstoque] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [painel, setPainel] = useState<PainelEstoque | null>(null);

  // progresso do salvar (reenviar nao duplica o que ja foi)
  const [salvando, setSalvando] = useState(false);
  const [contaCriada, setContaCriada] = useState<string | null>(null);
  const [linhasSalvas, setLinhasSalvas] = useState<number[]>([]);
  const [resumoSalvo, setResumoSalvo] = useState<string[]>([]);

  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  // Lista completa de produtos estocaveis para o select (as sugestoes vem primeiro).
  useEffect(() => {
    if (fase !== 'conferir' || painel) return;
    apiFinanceiro<PainelEstoque>('/api/financeiro/estoque').then(setPainel).catch(() => {});
  }, [fase, painel]);

  const ehTicket = resp?.leitura.tipo === 'ticket_pesagem';
  const categorias = (contexto?.categorias ?? []).filter(c => c.grupo !== 'receita');
  const contas = (contexto?.contas ?? []).filter(c => c.ativo);

  const opcoesPorLinha = useMemo(() => {
    const todos: OpcaoProduto[] = (painel?.itens ?? []).map(p => ({
      id: p.produto_id, nome: p.nome, unidade: p.unidade, custo: p.custo_unitario, densidade: densidadePorNome(p.nome), sugerido: false,
    }));
    return (resp?.itens ?? []).map(s => {
      const sugeridos: OpcaoProduto[] = s.produtos.map((c: CandidatoProduto) => ({
        id: c.produto_id, nome: c.nome, unidade: c.unidade, custo: c.preco_custo / (c.fator_conversao || 1),
        densidade: c.densidade_t_m3, sugerido: true,
      }));
      const ids = new Set(sugeridos.map(o => o.id));
      return [...sugeridos, ...todos.filter(o => !ids.has(o.id))];
    });
  }, [painel, resp]);

  const opcao = (indice: number, id: string): OpcaoProduto | undefined => opcoesPorLinha[indice]?.find(o => o.id === id);

  // Ticket: quantidade e valor vem do calculo peso / densidade x R$/m3.
  const calculos = linhas.map(l => (ehTicket ? calcularPesagem(l.pesoKg, l.densidade, l.custo) : null));
  const valorCalculado = ehTicket
    ? linhas.reduce((s, l, i) => s + (l.incluir ? calculos[i]?.valor ?? 0 : 0), 0)
    : null;
  const valorFinal = ehTicket && !valorEditado ? (valorCalculado ? Math.round(valorCalculado * 100) / 100 : null) : valor;

  // ---------------------------------------------------------------- leitura

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErro(null);
    setFase('lendo');
    try {
      const blob = await reduzirImagem(arquivo);
      setPrevia(URL.createObjectURL(blob));
      const form = new FormData();
      form.append('imagem', blob, 'foto.jpg');
      const r = await apiFinanceiro<RespostaLeitura>('/api/financeiro/leitura', { method: 'POST', body: form });
      preencher(r);
      setResp(r);
      setFase('conferir');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao ler a foto');
      setFase('foto');
    } finally {
      if (inputCamera.current) inputCamera.current.value = '';
      if (inputGaleria.current) inputGaleria.current.value = '';
    }
  };

  const preencher = (r: RespostaLeitura) => {
    const l = r.leitura;
    const melhorForn = r.fornecedores[0];
    const fornAlto = melhorForn && melhorForn.pontuacao >= 0.6 ? melhorForn : null;
    const fCtx = fornAlto ? contexto?.fornecedores.find(f => f.id === fornAlto.fornecedor_id) ?? null : null;
    setFornecedor(fornAlto ? { id: fornAlto.fornecedor_id, nome: fornAlto.nome } : { id: null, nome: l.fornecedor_nome ?? '' });
    setCategoriaId(fornAlto?.categoria_padrao_id ?? '');
    const data = l.data && l.data <= hoje ? l.data : hoje;
    setDataDoc(l.data ?? hoje);
    setVencimento(l.vencimento ?? l.data ?? hoje);
    setDataPagamento(data);
    setDocumento(l.numero_documento ?? '');
    setObs(l.observacoes ?? '');
    const nomeForn = fornAlto?.nome ?? l.fornecedor_nome ?? '';
    const primeiro = l.itens[0]?.descricao;
    setDescricao([
      l.tipo === 'ticket_pesagem' ? primeiro ?? 'Carga' : l.tipo === 'nota_fiscal' ? 'NF' : ROTULO_TIPO[l.tipo],
      l.tipo === 'ticket_pesagem' ? (l.numero_documento ? `ticket ${l.numero_documento}` : 'ticket') : l.numero_documento ?? '',
      nomeForn ? `— ${nomeForn}` : '',
    ].filter(Boolean).join(' ').trim());
    setValor(l.valor_total);
    setValorEditado(l.tipo !== 'ticket_pesagem' || r.valor_calculado === null ? true : false);

    const metodoLido = l.metodo ?? fCtx?.metodo_padrao ?? fornAlto?.metodo_padrao ?? 'pix';
    setMetodo(metodoLido);
    setContaId(contaParaMetodo(metodoLido, null, contexto, fornAlto?.conta_padrao_id ?? null));

    setDestino(l.tipo === 'comprovante_pagamento' ? 'pagamento_dia' : 'conta_pendente');

    const novas: Linha[] = l.itens.map((it, i) => {
      const s = r.itens[i];
      const melhor = s?.produtos[0] && s.produtos[0].pontuacao >= 0.5 ? s.produtos[0] : null;
      const custoProd = melhor ? melhor.preco_custo / (melhor.fator_conversao || 1) : null;
      if (l.tipo === 'ticket_pesagem') {
        return {
          incluir: true, descricao: it.descricao, produtoId: melhor?.produto_id ?? '',
          quantidade: s?.pesagem?.m3 ?? null, custo: s?.pesagem?.custo_m3 ?? custoProd,
          pesoKg: s?.pesagem?.peso_liquido_kg ?? null,
          densidade: s?.pesagem?.densidade_t_m3 ?? melhor?.densidade_t_m3 ?? densidadePorNome(it.descricao),
          conferirPeso: s?.pesagem?.conferir ?? true,
        };
      }
      return {
        incluir: !!melhor, descricao: it.descricao, produtoId: melhor?.produto_id ?? '',
        quantidade: it.quantidade, custo: it.valor_unitario ?? custoProd,
        pesoKg: null, densidade: null, conferirPeso: false,
      };
    });
    setLinhas(novas);
    setComEstoque((l.tipo === 'ticket_pesagem' || l.tipo === 'nota_fiscal') && novas.some(x => x.produtoId));
    setContaCriada(null);
    setLinhasSalvas([]);
  };

  const mudarLinha = (i: number, mudanca: Partial<Linha>) => setLinhas(ls => ls.map((l, k) => (k === i ? { ...l, ...mudanca } : l)));

  const escolherProduto = (i: number, id: string) => {
    const o = opcao(i, id);
    if (ehTicket) {
      mudarLinha(i, { produtoId: id, incluir: !!id, ...(o ? { custo: Math.round(o.custo * 100) / 100, densidade: o.densidade ?? linhas[i].densidade } : {}) });
    } else {
      mudarLinha(i, { produtoId: id, incluir: !!id, ...(o && linhas[i].custo === null ? { custo: Math.round(o.custo * 100) / 100 } : {}) });
    }
  };

  const mudarMetodo = (m: Metodo) => {
    setMetodo(m);
    const f = contexto?.fornecedores.find(x => x.id === fornecedor.id);
    setContaId(contaParaMetodo(m, contaId, contexto, f?.conta_padrao_id ?? null));
  };

  const recomecar = () => {
    setResp(null); setLinhas([]); setErro(null); setFase('foto');
    setContaCriada(null); setLinhasSalvas([]); setValorEditado(false);
    if (previa) URL.revokeObjectURL(previa);
    setPrevia(null);
  };

  // ---------------------------------------------------------------- salvar

  const linhasEstoque = comEstoque ? linhas.map((l, i) => ({ l, i })).filter(x => x.l.incluir) : [];

  const salvar = async () => {
    setErro(null);
    if (destino === 'nenhum' && !comEstoque) { setErro('Escolha pelo menos um destino.'); return; }
    if (destino !== 'nenhum') {
      if (!descricao.trim()) { setErro('Descreva a conta.'); return; }
      if (!valorFinal || valorFinal <= 0) { setErro('Informe o valor.'); return; }
      if (destino === 'conta_pendente' && !vencimento) { setErro('Informe o vencimento.'); return; }
      if (destino !== 'conta_pendente' && dataPagamento > hoje) { setErro('Pagamento não pode ter data futura.'); return; }
    }
    for (const { l, i } of linhasEstoque) {
      const quantidade = ehTicket ? calculos[i]?.m3 ?? null : l.quantidade;
      if (!l.produtoId) { setErro(`Escolha o produto de "${l.descricao}" (ou desmarque a linha).`); return; }
      if (!quantidade || quantidade <= 0) { setErro(`Quantidade inválida em "${l.descricao}".`); return; }
    }
    if (comEstoque && linhasEstoque.length === 0) { setErro('Marque pelo menos um item para a entrada de estoque.'); return; }

    setSalvando(true);
    const feitos: string[] = [];
    try {
      const anexo = resp?.foto_path ? `Foto: financeiro-comprovantes/${resp.foto_path}` : '';
      const observacoes = [obs.trim(), anexo].filter(Boolean).join(' · ') || null;

      let contaId_ = contaCriada;
      if (destino !== 'nenhum' && !contaId_) {
        const pago = destino !== 'conta_pendente';
        const venc = destino === 'pagamento_dia' ? dataPagamento : vencimento;
        const corpo: NovaContaPagar = {
          descricao: descricao.trim(),
          valor: valorFinal!,
          vencimento: venc,
          competencia: (dataDoc && dataDoc <= venc ? dataDoc : venc).slice(0, 7),
          categoria_id: categoriaId || null,
          ...(fornecedor.id ? { fornecedor_id: fornecedor.id } : fornecedor.nome.trim() ? { fornecedor_nome: fornecedor.nome.trim() } : {}),
          documento: documento.trim() || null,
          observacoes,
          ...(pago ? { pagamento: { data_pagamento: dataPagamento, metodo_pagamento: metodo, conta_id: contaId } } : {}),
        };
        const r = await apiFinanceiro<{ contas: ContaPagar[] }>('/api/financeiro/contas-pagar', { method: 'POST', body: JSON.stringify(corpo) });
        contaId_ = r.contas[0]?.id ?? null;
        setContaCriada(contaId_);
        feitos.push(pago ? `Pagamento de ${brl(valorFinal)} lançado.` : `Conta a pagar de ${brl(valorFinal)} criada (vence ${venc.split('-').reverse().join('/')}).`);
      }

      const salvas = [...linhasSalvas];
      for (const { l, i } of linhasEstoque) {
        if (salvas.includes(i)) continue;
        const quantidade = ehTicket ? calculos[i]!.m3! : l.quantidade!;
        const o = opcao(i, l.produtoId);
        const corpo: NovoMovimentoEstoque = {
          produto_id: l.produtoId,
          tipo: 'entrada',
          quantidade: arred3(quantidade),
          custo_unitario: l.custo,
          motivo: [
            ROTULO_TIPO[resp?.leitura.tipo ?? 'outro'], documento.trim() ? `nº ${documento.trim()}` : '',
            fornecedor.nome.trim() ? `— ${fornecedor.nome.trim()}` : '',
            ehTicket && l.pesoKg ? `(${numero(l.pesoKg, 0)} kg ÷ ${numero(l.densidade ?? 0, 2)} t/m³)` : '',
            anexo,
          ].filter(Boolean).join(' '),
          ...(contaId_ ? { referencia_tipo: 'conta_pagar', referencia_id: contaId_ } : { referencia_tipo: 'leitura_foto' }),
        };
        await apiFinanceiro('/api/financeiro/estoque', { method: 'POST', body: JSON.stringify(corpo) });
        salvas.push(i);
        setLinhasSalvas([...salvas]);
        feitos.push(`Entrada: ${numero(quantidade, quantidade < 10 ? 3 : 1)} ${o?.unidade ?? ''} de ${o?.nome ?? l.descricao}.`);
      }
      setResumoSalvo(feitos);
      setFase('salvo');
      onSalvo();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar';
      setErro(feitos.length ? `${feitos.join(' ')} Mas parou aqui: ${msg} Corrija e toque em Salvar de novo (o que já foi não se repete).` : msg);
    } finally {
      setSalvando(false);
    }
  };

  // ---------------------------------------------------------------- telas

  if (fase === 'salvo') {
    return (
      <Modal titulo="Lançado" onFechar={onFechar} largura="md"
        rodape={<>
          <BotaoSecundario onClick={recomecar}><Camera className="w-4 h-4" /> Outra foto</BotaoSecundario>
          <BotaoPrimario onClick={onFechar}>Fechar</BotaoPrimario>
        </>}>
        <div className="flex items-start gap-2 text-emerald-800">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <ul className="text-sm space-y-1">{resumoSalvo.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </Modal>
    );
  }

  if (fase !== 'conferir' || !resp) {
    return (
      <Modal titulo="Lançar por foto" onFechar={onFechar} largura="md">
        <p className="text-sm text-gray-600">Fotografe o comprovante, boleto, nota fiscal ou ticket de pesagem. A leitura preenche o formulário; você confere antes de salvar.</p>
        <input ref={inputCamera} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => enviar(e.target.files?.[0])} />
        <input ref={inputGaleria} type="file" accept="image/*" className="hidden"
          onChange={e => enviar(e.target.files?.[0])} />
        {fase === 'lendo' ? (
          <div className="flex flex-col items-center gap-3 py-6">
            {previa && <img src={previa} alt="Foto enviada" className="max-h-48 rounded-lg border border-gray-200" />}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#F7941D]" /> Lendo a foto… (pode levar até um minuto)
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BotaoPrimario onClick={() => inputCamera.current?.click()} className="min-h-[56px]"><Camera className="w-5 h-5" /> Tirar foto</BotaoPrimario>
            <BotaoSecundario onClick={() => inputGaleria.current?.click()} className="min-h-[56px]"><ImageUp className="w-5 h-5" /> Escolher da galeria</BotaoSecundario>
          </div>
        )}
        <p className="text-[11px] text-gray-500">Dica: documento inteiro na foto, sem reflexo, bem de frente.</p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </Modal>
    );
  }

  const l = resp.leitura;
  const contaSel = contas.find(c => c.id === contaId);

  return (
    <Modal titulo="Conferir e lançar" onFechar={onFechar} largura="lg"
      rodape={<>
        <BotaoSecundario onClick={recomecar} disabled={salvando}><RotateCcw className="w-4 h-4" /> Outra foto</BotaoSecundario>
        <BotaoPrimario onClick={salvar} carregando={salvando}>Salvar</BotaoPrimario>
      </>}>
      <div className="flex items-start gap-3">
        {previa && (
          <a href={previa} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={previa} alt="Foto lida" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
          </a>
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-1">
            <Selo tom="azul">{ROTULO_TIPO[l.tipo]}</Selo>
            <Selo tom={l.confianca === 'alta' ? 'verde' : l.confianca === 'media' ? 'amarelo' : 'vermelho'}>leitura {l.confianca}</Selo>
          </div>
          {l.campos_duvidosos.length > 0 && <p className="text-xs text-amber-800">Conferir com atenção: {l.campos_duvidosos.join(', ')}.</p>}
          {resp.aviso_foto && <p className="text-[11px] text-gray-500">{resp.aviso_foto}</p>}
        </div>
      </div>

      <Campo rotulo="Fornecedor">
        <CampoFornecedor fornecedores={contexto?.fornecedores ?? []} value={fornecedor}
          onChange={(f, forn) => {
            setFornecedor(f);
            if (forn) {
              if (!categoriaId && forn.categoria_padrao_id) setCategoriaId(forn.categoria_padrao_id);
              if (forn.metodo_padrao) { setMetodo(forn.metodo_padrao); setContaId(contaParaMetodo(forn.metodo_padrao, forn.conta_padrao_id, contexto, forn.conta_padrao_id)); }
            }
          }} />
      </Campo>
      {resp.fornecedores.length > 0 && (
        <div className="flex flex-wrap gap-2 -mt-1">
          {resp.fornecedores.filter(c => c.fornecedor_id !== fornecedor.id).map(c => (
            <button key={c.fornecedor_id} type="button"
              onClick={() => { setFornecedor({ id: c.fornecedor_id, nome: c.nome }); if (!categoriaId && c.categoria_padrao_id) setCategoriaId(c.categoria_padrao_id); }}
              className="text-xs min-h-[36px] px-3 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
              {c.nome}{c.motivo === 'documento' ? ' (CNPJ)' : ''}
            </button>
          ))}
          {l.fornecedor_nome && fornecedor.nome !== l.fornecedor_nome && (
            <button type="button" onClick={() => setFornecedor({ id: null, nome: l.fornecedor_nome! })}
              className="text-xs min-h-[36px] px-3 rounded-full border border-dashed border-gray-300 text-gray-600">
              Usar “{l.fornecedor_nome}”
            </button>
          )}
        </div>
      )}

      {/* ---------------- ticket de pesagem */}
      {ehTicket && (
        <div className="space-y-3">
          {linhas.map((ln, i) => {
            const c = calculos[i];
            const ops = opcoesPorLinha[i] ?? [];
            return (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800 break-words">{ln.descricao}</p>
                  {linhas.length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-gray-600 min-h-[40px]">
                      <input type="checkbox" checked={ln.incluir} onChange={e => mudarLinha(i, { incluir: e.target.checked })} className="w-4 h-4 accent-[#F7941D]" /> incluir
                    </label>
                  )}
                </div>
                <Campo rotulo="Produto">
                  <SeletorProduto opcoes={ops} value={ln.produtoId} onChange={id => escolherProduto(i, id)} />
                </Campo>
                <div className="grid grid-cols-3 gap-2">
                  <Campo rotulo="Peso líquido" dica={ln.conferirPeso ? 'Confira: o ticket não trouxe bruto e tara completos.' : undefined}>
                    <CampoNumero value={ln.pesoKg} onChange={v => mudarLinha(i, { pesoKg: v, conferirPeso: false })} min={0} sufixo="kg" />
                  </Campo>
                  <Campo rotulo="Densidade">
                    <CampoNumero value={ln.densidade} onChange={v => mudarLinha(i, { densidade: v })} min={0} sufixo="t/m³" />
                  </Campo>
                  <Campo rotulo="R$ por m³">
                    <CampoMoeda value={ln.custo} onChange={v => mudarLinha(i, { custo: v })} />
                  </Campo>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm tabular-nums text-gray-700">
                  {c && c.peso_liquido_kg !== null && c.densidade_t_m3 !== null ? (
                    <>
                      {numero(c.peso_liquido_kg, 0)} kg ÷ {numero(c.densidade_t_m3, 2)} t/m³ = <b>{numero(c.m3 ?? 0, 3)} m³</b>
                      {c.custo_m3 !== null && <> × {brl(c.custo_m3)} = <b>{brl(c.valor)}</b></>}
                    </>
                  ) : <span className="text-amber-800">Informe peso e densidade para calcular.</span>}
                </div>
              </div>
            );
          })}
          {linhas.length === 0 && <Aviso tom="alerta">A leitura não achou o material no ticket. Lance à mão ou tente outra foto.</Aviso>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Valor total" dica={ehTicket && !valorEditado ? 'Calculado pelo ticket.' : ehTicket ? <button type="button" className="text-[#C96F00] underline" onClick={() => setValorEditado(false)}>usar o calculado</button> : undefined}>
          <CampoMoeda value={valorFinal} onChange={v => { setValor(v); setValorEditado(true); }} />
        </Campo>
        <Campo rotulo="Categoria">
          <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} className={INPUT}>
            <option value="">— sem categoria —</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Descrição">
        <input value={descricao} onChange={e => setDescricao(e.target.value)} className={INPUT} />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data do documento">
          <input type="date" value={dataDoc} onChange={e => e.target.value && setDataDoc(e.target.value)} className={INPUT} />
        </Campo>
        <Campo rotulo="Nº documento (NF/ticket/boleto)">
          <input value={documento} onChange={e => setDocumento(e.target.value)} className={INPUT} />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <input value={obs} onChange={e => setObs(e.target.value)} className={INPUT} />
      </Campo>

      {/* ---------------- destinos */}
      <div className="border-t border-gray-100 pt-3 space-y-3">
        <p className="text-xs font-semibold text-gray-600">Para onde vai</p>
        <Campo rotulo="Financeiro">
          <select value={destino} onChange={e => setDestino(e.target.value as DestinoFinanceiro)} className={INPUT} disabled={!!contaCriada}>
            <option value="conta_pendente">Conta a pagar (pendente, com vencimento)</option>
            <option value="conta_paga">Conta já paga</option>
            <option value="pagamento_dia">Só lançar o pagamento do dia</option>
            <option value="nenhum">Nada no financeiro</option>
          </select>
        </Campo>
        {contaCriada && <Aviso tom="ok">Conta já criada nesta foto; salvar de novo só completa o estoque.</Aviso>}

        {destino === 'conta_pendente' && (
          <Campo rotulo="Vencimento">
            <input type="date" value={vencimento} onChange={e => e.target.value && setVencimento(e.target.value)} className={INPUT} />
          </Campo>
        )}
        {(destino === 'conta_paga' || destino === 'pagamento_dia') && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Pago em">
                <input type="date" value={dataPagamento} max={hoje} onChange={e => e.target.value && setDataPagamento(e.target.value)} className={INPUT} />
              </Campo>
              <Campo rotulo="Como">
                <select value={metodo} onChange={e => mudarMetodo(e.target.value as Metodo)} className={INPUT}>
                  {METODOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </Campo>
            </div>
            {destino === 'conta_paga' && (
              <Campo rotulo="Vencimento original">
                <input type="date" value={vencimento} onChange={e => e.target.value && setVencimento(e.target.value)} className={INPUT} />
              </Campo>
            )}
            <Campo rotulo="De qual conta" dica={contaSel?.tipo === 'caixa' ? 'Sai do caixa em espécie.' : contaSel?.tipo === 'carteira' ? 'Sai do saldo Vloz.' : contaSel?.tipo === 'cartao_credito' ? 'Vai pra fatura do cartão.' : undefined}>
              <select value={contaId ?? ''} onChange={e => setContaId(e.target.value || null)} className={INPUT}>
                <option value="">— sem conta —</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px] cursor-pointer select-none">
          <input type="checkbox" checked={comEstoque} onChange={e => setComEstoque(e.target.checked)} className="w-4 h-4 accent-[#F7941D]" />
          Dar entrada no estoque
        </label>

        {comEstoque && !ehTicket && (
          <div className="space-y-2">
            {linhas.length === 0 && <Aviso tom="info">A leitura não trouxe itens. Use a aba Estoque para dar a entrada à mão.</Aviso>}
            {linhas.map((ln, i) => {
              const o = opcao(i, ln.produtoId);
              return (
                <div key={i} className={`border rounded-lg p-3 space-y-2 ${ln.incluir ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-70'}`}>
                  <label className="flex items-start gap-2 text-sm text-gray-800 min-h-[40px]">
                    <input type="checkbox" checked={ln.incluir} onChange={e => mudarLinha(i, { incluir: e.target.checked })} className="w-4 h-4 mt-0.5 accent-[#F7941D]" />
                    <span className="break-words">{ln.descricao}
                      {resp.leitura.itens[i]?.quantidade !== null && <span className="text-gray-500"> · {numero(resp.leitura.itens[i].quantidade ?? 0, 2)} {resp.leitura.itens[i].unidade ?? ''} na nota</span>}
                    </span>
                  </label>
                  {ln.incluir && (
                    <>
                      <SeletorProduto opcoes={opcoesPorLinha[i] ?? []} value={ln.produtoId} onChange={id => escolherProduto(i, id)} />
                      <div className="grid grid-cols-2 gap-2">
                        <Campo rotulo={`Quantidade${o ? ` (${o.unidade})` : ''}`}>
                          <CampoNumero value={ln.quantidade} onChange={v => mudarLinha(i, { quantidade: v })} min={0} sufixo={o?.unidade} />
                        </Campo>
                        <Campo rotulo={`Custo por ${o?.unidade ?? 'unidade'}`} dica={o && ln.custo !== null && Math.abs(ln.custo - o.custo) >= 0.005 ? `Atualiza o custo (hoje ${brl(o.custo)}).` : undefined}>
                          <CampoMoeda value={ln.custo} onChange={v => mudarLinha(i, { custo: v })} />
                        </Campo>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {comEstoque && ehTicket && (
          <p className="text-xs text-gray-500">Entrada em m³ conforme o cálculo acima; o R$/m³ diferente do cadastro atualiza o custo do produto.</p>
        )}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

function SeletorProduto({ opcoes, value, onChange }: { opcoes: OpcaoProduto[]; value: string; onChange: (id: string) => void }) {
  const sugeridos = opcoes.filter(o => o.sugerido);
  const outros = opcoes.filter(o => !o.sugerido);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${INPUT} min-h-[44px]`} aria-label="Produto">
      <option value="">— escolha o produto —</option>
      {sugeridos.length > 0 && (
        <optgroup label="Sugeridos pela leitura">
          {sugeridos.map(o => <option key={o.id} value={o.id}>{o.nome} ({o.unidade})</option>)}
        </optgroup>
      )}
      {outros.length > 0 && (
        <optgroup label="Todos os produtos estocáveis">
          {outros.map(o => <option key={o.id} value={o.id}>{o.nome} ({o.unidade})</option>)}
        </optgroup>
      )}
    </select>
  );
}
