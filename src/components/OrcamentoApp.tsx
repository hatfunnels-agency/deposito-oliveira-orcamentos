'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Produto {
  id: string;
  nome: string;
  preco: number;
  estoque: number;
  unidade: string;
  categoria: string;
}

interface ItemOrcamento {
  produto: Produto;
  quantidade: number;
}

interface DadosFrete {
  cepDestino: string;
  endereco: { logradouro: string; bairro: string; cidade: string; estado: string };
  distanciaAproximadaKm: number;
  valorFrete: number;
  observacao: string;
}

interface OrcamentoItem {
  id: string;
  produto_id: number | null;
  produto_nome: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number;
  subtotal: number;
}

interface OrcamentoDetalhe {
  id: string;
  codigo: string;
  tipo_entrega: string;
  valor_frete: number;
  subtotal: number;
  total: number;
  status: string;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
  data_entrega: string | null;
  clientes: {
    id: string;
    nome: string;
    telefone: string;
    cep: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
  } | null;
  orcamento_itens: OrcamentoItem[];
}

interface OrcamentoSalvo {
  id: string;
  codigo: string;
  tipo_entrega: string;
  valor_frete: number;
  subtotal: number;
  total: number;
  status: string;
  observacoes: string | null;
  criado_em: string;
  data_entrega: string | null;
  clientes: { id: string; nome: string; telefone: string; cidade: string | null; estado: string | null } | null;
}

const UNIT_MAP: Record<string, string> = {
  'arame': 'KG',
  'areia': 'meio metro',
  'areia ensacada': 'meio metro',
  'ferro': 'metro',
  'pedra brita': 'meio metro',
  'pedra': 'meio metro',
  'brita': 'meio metro',
  'prego': 'KG',
  'pregos': 'KG',
  'pedrisco': 'meio metro',
  'po de pedra': 'meio metro',
  'pó de pedra': 'meio metro',
  'cimento': 'saco',
  'telha': 'unidade',
  'parafuso': 'unidade',
  'tijolo': 'milheiro',
  'barra de ferro': 'barra',
  'vergalhao': 'barra',
  'vergalhão': 'barra',
};

function mapUnit(productName: string, originalUnit: string): string {
  const nameLower = productName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [key, unit] of Object.entries(UNIT_MAP)) {
    const keyNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nameLower.includes(keyNorm)) {
      return unit;
    }
  }
  return originalUnit;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PESO_MEDIO_KG: Record<string, number> = {
  saco: 50,
  unidade: 5,
  barra: 15,
  metro: 10,
  rolo: 20,
  'meio metro': 800,
  kg: 1,
  milheiro: 2500,
};

const STATUS_LABELS: Record<string, string> = {
  orcamento: 'Orçamento',
  pagamento_pendente: 'Pgto. Pendente',
  pagamento_ok: 'Pgto. OK',
  separacao: 'Em Separação',
  entrega_pendente: 'Entrega Pendente',
  em_rota: 'Em Rota',
  completo: 'Completo',
  ocorrencia: 'Ocorrência',
  cancelado: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  orcamento: 'bg-gray-100 text-gray-700',
  pagamento_pendente: 'bg-yellow-100 text-yellow-800',
  pagamento_ok: 'bg-green-100 text-green-800',
  separacao: 'bg-blue-100 text-blue-800',
  entrega_pendente: 'bg-orange-100 text-orange-800',
  em_rota: 'bg-purple-100 text-purple-800',
  completo: 'bg-green-200 text-green-900',
  ocorrencia: 'bg-red-100 text-red-800',
  cancelado: 'bg-gray-200 text-gray-600',
};

export default function OrcamentoApp() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [fonteProdutos, setFonteProdutos] = useState('');
  const [mensagemAPI, setMensagemAPI] = useState('');
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Todas');
  const [abaAtiva, setAbaAtiva] = useState<'produtos' | 'orcamento' | 'historico'>('produtos');
  const [tipoEntrega, setTipoEntrega] = useState<'retirada' | 'entrega'>('retirada');
  const [cepDestino, setCepDestino] = useState('');
  const [dadosFrete, setDadosFrete] = useState<DadosFrete | null>(null);
  const [calculandoFrete, setCalculandoFrete] = useState(false);
  const [nomeCliente, setNomeCliente] = useState('');
  const [whatsappCliente, setWhatsappCliente] = useState('');
  const [mostrarModal, setMostrarModal] = useState(false);
  const [erroFrete, setErroFrete] = useState('');
  const [enderecoViaCEP, setEnderecoViaCEP] = useState('');
  const [salvandoOrcamento, setSalvandoOrcamento] = useState(false);
  const [orcamentoSalvo, setOrcamentoSalvo] = useState<{ codigo: string } | null>(null);
  const [orcamentos, setOrcamentos] = useState<OrcamentoSalvo[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [buscaHistorico, setBuscaHistorico] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [totalOrcamentos, setTotalOrcamentos] = useState(0);
  const [dataEntrega, setDataEntrega] = useState('');
  const [orcamentoDetalhe, setOrcamentoDetalhe] = useState<OrcamentoDetalhe | null>(null);
  const [mostrarDetalhe, setMostrarDetalhe] = useState(false);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/produtos')
      .then(r => r.json())
      .then(data => {
        const prods = (data.produtos || []).map((p: Produto) => ({
          ...p,
          unidade: mapUnit(p.nome, p.unidade),
        }));
        setProdutos(prods);
        setFonteProdutos(data.fonte || 'demo');
        setMensagemAPI(data.mensagem || '');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setMensagemAPI('Erro ao carregar produtos.');
      });
  }, []);

  const carregarHistorico = useCallback(async () => {
    setLoadingHistorico(true);
    try {
      const params = new URLSearchParams({ limite: '20', pagina: '1' });
      if (buscaHistorico) params.set('busca', buscaHistorico);
      if (filtroStatus) params.set('status', filtroStatus);
      const res = await fetch(`/api/orcamentos?${params}`);
      const data = await res.json();
      setOrcamentos(data.orcamentos || []);
      setTotalOrcamentos(data.total || 0);
    } catch (e) {
      console.error('Erro ao carregar historico', e);
    }
    setLoadingHistorico(false);
  }, [buscaHistorico, filtroStatus]);

  useEffect(() => {
    if (abaAtiva === 'historico') carregarHistorico();
  }, [abaAtiva, carregarHistorico]);

  const categorias = ['Todas', ...Array.from(new Set(produtos.map(p => p.categoria)))];

  const produtosFiltrados = produtos.filter(p => {
    const matchBusca = p.nome.toLowerCase().includes(busca.toLowerCase());
    const matchCategoria = categoriaSelecionada === 'Todas' || p.categoria === categoriaSelecionada;
    return matchBusca && matchCategoria;
  });

  const adicionarItem = (produto: Produto) => {
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === produto.id);
      if (existing) return prev.map(i => i.produto.id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      return [...prev, { produto, quantidade: 1 }];
    });
  };

  const removerItem = (produtoId: string) => {
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === produtoId);
      if (existing && existing.quantidade > 1) return prev.map(i => i.produto.id === produtoId ? { ...i, quantidade: i.quantidade - 1 } : i);
      return prev.filter(i => i.produto.id !== produtoId);
    });
  };

  const getQuantidade = (produtoId: string) => itens.find(i => i.produto.id === produtoId)?.quantidade || 0;

  const subtotal = itens.reduce((acc, item) => acc + (item.produto.preco * item.quantidade), 0);
  const totalFrete = tipoEntrega === 'entrega' && dadosFrete ? dadosFrete.valorFrete : 0;
  const total = subtotal + totalFrete;

  const pesoTotal = itens.reduce((acc, item) => {
    const unitLower = item.produto.unidade.toLowerCase();
    return acc + ((PESO_MEDIO_KG[unitLower] || 5) * item.quantidade);
  }, 0);

  const buscarEnderecoCEP = useCallback(async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (!data.erro) setEnderecoViaCEP(`${data.logradouro}, ${data.bairro}, ${data.localidade}-${data.uf}`);
    } catch {}
  }, []);

  const calcularFrete = async () => {
    if (!cepDestino || cepDestino.replace(/\D/g, '').length !== 8) {
      setErroFrete('Digite um CEP válido.');
      return;
    }
    setCalculandoFrete(true);
    setErroFrete('');
    try {
      const res = await fetch('/api/frete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cepDestino, pesoTotalKg: pesoTotal }),
      });
      const data = await res.json();
      if (data.erro) setErroFrete(data.erro);
      else setDadosFrete(data);
    } catch {
      setErroFrete('Erro ao calcular frete.');
    }
    setCalculandoFrete(false);
  };

  const salvarEGerarOrcamento = async () => {
    setSalvandoOrcamento(true);
    setOrcamentoSalvo(null);
    try {
      const payload: Record<string, unknown> = {
        cliente_nome: nomeCliente || 'Cliente',
        cliente_telefone: whatsappCliente || '00000000000',
        cliente_cep: dadosFrete?.cepDestino || cepDestino || null,
        cliente_endereco: enderecoViaCEP || null,
        tipo_entrega: tipoEntrega,
        valor_frete: totalFrete,
        subtotal,
        total,
        data_entrega: tipoEntrega === 'entrega' && dataEntrega ? dataEntrega : null,
        itens: itens.map(i => ({
          produto_id: i.produto.id,
          produto_nome: i.produto.nome,
          quantidade: i.quantidade,
          unidade: i.produto.unidade,
          preco_unitario: i.produto.preco,
        })),
      };

      if (editandoId) {
        // Update existing
        const res = await fetch(`/api/orcamentos/${editandoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo });
        setEditandoId(null);
      } else {
        // Create new
        const res = await fetch('/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo });
      }
    } catch (e) {
      console.error('Erro ao salvar orcamento', e);
    }
    setSalvandoOrcamento(false);
    setMostrarModal(true);
  };

  const gerarTextoWhatsApp = (detalhe?: OrcamentoDetalhe | null) => {
    if (detalhe) {
      const linhas = [
        '*ORÇAMENTO - Depósito Oliveira*',
        `Código: ${detalhe.codigo}`,
        '',
        '-----------------------------',
        '',
        `*Cliente:* ${detalhe.clientes?.nome || 'Cliente'}`,
        detalhe.clientes?.telefone ? `*Telefone:* ${detalhe.clientes.telefone}` : '',
        '',
        '*Produtos:*',
        ...detalhe.orcamento_itens.map(i => `· ${i.produto_nome} x${i.quantidade} = R$ ${formatBRL(i.subtotal)}`),
        '',
        `*Subtotal:* R$ ${formatBRL(detalhe.subtotal)}`,
        detalhe.tipo_entrega === 'entrega' && detalhe.valor_frete > 0
          ? `*Frete:* R$ ${formatBRL(detalhe.valor_frete)}`
          : '*Retirada na loja*',
        detalhe.data_entrega ? `*Data de entrega:* ${new Date(detalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
        '',
        `*TOTAL: R$ ${formatBRL(detalhe.total)}*`,
        '',
        '_Orçamento válido por 7 dias_',
        '_Sujeito a disponibilidade de estoque_',
      ].filter((l): l is string => typeof l === 'string' && l.length > 0);
      return linhas.join('\n');
    }

    const codigo = orcamentoSalvo?.codigo;
    const linhas = [
      '*ORÇAMENTO - Depósito Oliveira*',
      codigo ? `Código: ${codigo}` : '',
      '',
      '-----------------------------',
      '',
      nomeCliente ? `*Cliente:* ${nomeCliente}` : '',
      whatsappCliente ? `*Telefone:* ${whatsappCliente}` : '',
      '',
      '*Produtos:*',
      ...itens.map(i => `· ${i.produto.nome} x${i.quantidade} = R$ ${formatBRL(i.produto.preco * i.quantidade)}`),
      '',
      `*Subtotal:* R$ ${formatBRL(subtotal)}`,
      tipoEntrega === 'entrega' && dadosFrete
        ? `*Frete (${dadosFrete.endereco.cidade}-${dadosFrete.endereco.estado}):* R$ ${formatBRL(dadosFrete.valorFrete)}`
        : '*Retirada na loja*',
      tipoEntrega === 'entrega' && dataEntrega ? `*Data de entrega:* ${new Date(dataEntrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
      '',
      `*TOTAL: R$ ${formatBRL(total)}*`,
      '',
      '_Orçamento válido por 7 dias_',
      '_Sujeito a disponibilidade de estoque_',
    ].filter((l): l is string => !!l);
    return linhas.join('\n');
  };

  const compartilharWhatsApp = (texto?: string) => {
    const msg = texto || gerarTextoWhatsApp();
    const numLimpo = whatsappCliente.replace(/\D/g, '');
    if (numLimpo) window.open(`https://wa.me/55${numLimpo}?text=${encodeURIComponent(msg)}`, '_blank');
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const compartilharWhatsAppDetalhe = (detalhe: OrcamentoDetalhe) => {
    const msg = gerarTextoWhatsApp(detalhe);
    const numLimpo = (detalhe.clientes?.telefone || '').replace(/\D/g, '');
    if (numLimpo) window.open(`https://wa.me/55${numLimpo}?text=${encodeURIComponent(msg)}`, '_blank');
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const imprimirOrcamento = (detalhe?: OrcamentoDetalhe | null) => {
    const d = detalhe || null;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const itensHtml = d
      ? d.orcamento_itens.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.produto_nome}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantidade}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.unidade}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.preco_unitario)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.subtotal)}</td></tr>`).join('')
      : itens.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.produto.nome}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantidade}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.produto.unidade}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.produto.preco)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.produto.preco * i.quantidade)}</td></tr>`).join('');

    const nome = d ? (d.clientes?.nome || 'Cliente') : (nomeCliente || 'Cliente');
    const tel = d ? (d.clientes?.telefone || '') : whatsappCliente;
    const cod = d ? d.codigo : (orcamentoSalvo?.codigo || '');
    const sub = d ? d.subtotal : subtotal;
    const tot = d ? d.total : total;
    const tipo = d ? d.tipo_entrega : tipoEntrega;
    const frete = d ? d.valor_frete : totalFrete;
    const end = d ? (d.clientes?.endereco ? `${d.clientes.endereco}, ${d.clientes.bairro || ''}, ${d.clientes.cidade || ''}-${d.clientes.estado || ''}` : '') : enderecoViaCEP;
    const dataEnt = d ? d.data_entrega : (tipoEntrega === 'entrega' ? dataEntrega : '');
    const dataCriacao = d ? new Date(d.criado_em).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Orçamento ${cod}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333}h1{color:#1d4ed8;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin:16px 0}th{background:#1d4ed8;color:white;padding:10px 8px;text-align:left}td{padding:8px}tfoot td{font-weight:bold;border-top:2px solid #1d4ed8}.info{margin:12px 0}.info span{font-weight:bold}.footer{margin-top:24px;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:13px}</style></head><body>`);
    printWindow.document.write(`<h1>Depósito Oliveira</h1><p style="color:#666;margin-top:0">Sistema de Orçamentos</p>`);
    printWindow.document.write(`<hr style="border:1px solid #1d4ed8;margin:16px 0">`);
    if (cod) printWindow.document.write(`<div class="info"><span>Código:</span> ${cod}</div>`);
    printWindow.document.write(`<div class="info"><span>Data:</span> ${dataCriacao}</div>`);
    printWindow.document.write(`<div class="info"><span>Cliente:</span> ${nome}</div>`);
    if (tel) printWindow.document.write(`<div class="info"><span>Telefone:</span> ${tel}</div>`);
    printWindow.document.write(`<div class="info"><span>Entrega:</span> ${tipo === 'entrega' ? 'Entrega no endereço' : 'Retirada na loja'}</div>`);
    if (tipo === 'entrega' && end) printWindow.document.write(`<div class="info"><span>Endereço:</span> ${end}</div>`);
    if (dataEnt) printWindow.document.write(`<div class="info"><span>Data de entrega:</span> ${new Date(dataEnt + 'T12:00:00').toLocaleDateString('pt-BR')}</div>`);
    printWindow.document.write(`<table><thead><tr><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:center">Unidade</th><th style="text-align:right">Preço Unit.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${itensHtml}</tbody><tfoot><tr><td colspan="4" style="text-align:right;padding:10px 8px">Subtotal:</td><td style="text-align:right;padding:10px 8px">R$ ${formatBRL(sub)}</td></tr>`);
    if (tipo === 'entrega' && frete > 0) printWindow.document.write(`<tr><td colspan="4" style="text-align:right;padding:4px 8px">Frete:</td><td style="text-align:right;padding:4px 8px">R$ ${formatBRL(frete)}</td></tr>`);
    printWindow.document.write(`<tr><td colspan="4" style="text-align:right;padding:10px 8px;font-size:18px;color:#1d4ed8">TOTAL:</td><td style="text-align:right;padding:10px 8px;font-size:18px;color:#1d4ed8">R$ ${formatBRL(tot)}</td></tr></tfoot></table>`);
    printWindow.document.write(`<div class="footer"><p>Orçamento válido por 7 dias</p><p>Sujeito a disponibilidade de estoque</p></div>`);
    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  const atualizarStatusOrcamento = async (id: string, novoStatus: string) => {
    try {
      await fetch(`/api/orcamentos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      carregarHistorico();
      if (orcamentoDetalhe && orcamentoDetalhe.id === id) {
        setOrcamentoDetalhe({ ...orcamentoDetalhe, status: novoStatus });
      }
    } catch (e) {
      console.error('Erro ao atualizar status', e);
    }
  };

  const abrirDetalhe = async (id: string) => {
    setLoadingDetalhe(true);
    setMostrarDetalhe(true);
    try {
      const res = await fetch(`/api/orcamentos/${id}`);
      const data = await res.json();
      setOrcamentoDetalhe(data);
    } catch (e) {
      console.error('Erro ao carregar detalhe', e);
    }
    setLoadingDetalhe(false);
  };

  const editarOrcamento = (detalhe: OrcamentoDetalhe) => {
    // Load data back into the creation form
    setEditandoId(detalhe.id);
    setNomeCliente(detalhe.clientes?.nome || '');
    setWhatsappCliente(detalhe.clientes?.telefone || '');
    setTipoEntrega(detalhe.tipo_entrega as 'retirada' | 'entrega');
    setDataEntrega(detalhe.data_entrega || '');
    if (detalhe.clientes?.endereco) setEnderecoViaCEP(detalhe.clientes.endereco);
    if (detalhe.clientes?.cep) setCepDestino(detalhe.clientes.cep);

    // Map items back to cart
    const cartItems: ItemOrcamento[] = detalhe.orcamento_itens.map(oi => ({
      produto: {
        id: String(oi.produto_id || oi.id),
        nome: oi.produto_nome,
        preco: oi.preco_unitario,
        estoque: 999,
        unidade: oi.unidade,
        categoria: 'Geral',
      },
      quantidade: oi.quantidade,
    }));
    setItens(cartItems);

    // Switch to orcamento tab and close detail modal
    setMostrarDetalhe(false);
    setOrcamentoDetalhe(null);
    setAbaAtiva('orcamento');
  };

  const todayStr = new Date().toISOString().split('T')[0];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando produtos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Depósito Oliveira</h1>
            <p className="text-blue-200 text-sm">Sistema de Orçamentos</p>
          </div>
          <div className="flex items-center gap-3">
            {fonteProdutos === 'demo' && <span className="bg-yellow-500 text-yellow-900 text-xs px-2 py-1 rounded-full font-medium">DEMO</span>}
            {fonteProdutos === 'bling' && <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full font-medium">BLING</span>}
            <button onClick={() => setAbaAtiva('historico')} className="bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-500 transition">Histórico</button>
            <button onClick={() => setAbaAtiva('orcamento')} className="relative bg-white text-blue-700 font-bold px-4 py-2 rounded-lg hover:bg-blue-50 transition">
              Orçamento
              {itens.length > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{itens.reduce((a, i) => a + i.quantidade, 0)}</span>}
            </button>
          </div>
        </div>
      </header>

      {mensagemAPI && (
        <div className={`px-4 py-2 text-sm text-center print:hidden ${fonteProdutos === 'bling' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          {mensagemAPI}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 pt-4 print:hidden">
        <div className="flex border-b border-gray-200 mb-6">
          {(['produtos', 'orcamento', 'historico'] as const).map(aba => (
            <button
              key={aba}
              onClick={() => setAbaAtiva(aba)}
              className={`px-6 py-3 font-medium text-sm capitalize ${abaAtiva === aba ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {aba === 'produtos' ? 'Catálogo de Produtos' : aba === 'orcamento' ? `Meu Orçamento (${itens.reduce((a, i) => a + i.quantidade, 0)} itens)` : 'Histórico'}
            </button>
          ))}
        </div>

        {abaAtiva === 'produtos' && (
          <div>
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input type="text" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <select value={categoriaSelecionada} onChange={e => setCategoriaSelecionada(e.target.value)} className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-8">
              {produtosFiltrados.map(produto => {
                const qtd = getQuantidade(produto.id);
                return (
                  <div key={produto.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition">
                    <div className="mb-2"><span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{produto.categoria}</span></div>
                    <h3 className="font-semibold text-gray-800 text-sm mb-1 min-h-[40px]">{produto.nome}</h3>
                    <p className="text-blue-700 font-bold text-lg mb-1">R$ {formatBRL(produto.preco)}<span className="text-xs text-gray-400 font-normal">/{produto.unidade}</span></p>
                    <p className="text-xs text-gray-500 mb-3">Estoque: {produto.estoque} {produto.unidade}{produto.estoque !== 1 ? 's' : ''}</p>
                    {qtd === 0 ? (
                      <button onClick={() => adicionarItem(produto)} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">+ Adicionar</button>
                    ) : (
                      <div className="flex items-center justify-between bg-blue-50 rounded-lg p-1">
                        <button onClick={() => removerItem(produto.id)} className="w-8 h-8 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">-</button>
                        <span className="font-bold text-blue-700 text-lg">{qtd}</span>
                        <button onClick={() => adicionarItem(produto)} className="w-8 h-8 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {produtosFiltrados.length === 0 && <div className="col-span-4 text-center py-12 text-gray-400">Nenhum produto encontrado.</div>}
            </div>
          </div>
        )}

        {abaAtiva === 'orcamento' && (
          <div className="max-w-2xl mx-auto pb-8">
            {itens.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-5xl mb-4">🛒</p>
                <p className="text-lg">Seu orçamento está vazio</p>
                <button onClick={() => setAbaAtiva('produtos')} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">Ver Produtos</button>
              </div>
            ) : (
              <div className="space-y-4">
                {editandoId && (
                  <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-3 flex items-center justify-between">
                    <p className="text-sm text-yellow-800 font-medium">✏️ Editando orçamento existente</p>
                    <button onClick={() => { setEditandoId(null); setItens([]); setNomeCliente(''); setWhatsappCliente(''); setCepDestino(''); setDadosFrete(null); setDataEntrega(''); }} className="text-xs text-yellow-700 underline">Cancelar edição</button>
                  </div>
                )}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50"><h2 className="font-bold text-gray-700">Itens do Orçamento</h2></div>
                  {itens.map(item => (
                    <div key={item.produto.id} className="flex items-center gap-3 p-4 border-b border-gray-50 last:border-0">
                      <div className="flex-1">
                        <p className="font-medium text-gray-800 text-sm">{item.produto.nome}</p>
                        <p className="text-xs text-gray-500">R$ {formatBRL(item.produto.preco)}/{item.produto.unidade}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => removerItem(item.produto.id)} className="w-7 h-7 bg-red-100 text-red-600 rounded font-bold hover:bg-red-200 transition text-sm">-</button>
                        <span className="w-8 text-center font-bold">{item.quantidade}</span>
                        <button onClick={() => adicionarItem(item.produto)} className="w-7 h-7 bg-green-100 text-green-600 rounded font-bold hover:bg-green-200 transition text-sm">+</button>
                      </div>
                      <p className="w-24 text-right font-bold text-blue-700 text-sm">R$ {formatBRL(item.produto.preco * item.quantidade)}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Dados do Cliente</h2>
                  <div className="space-y-3">
                    <input type="text" placeholder="Nome do cliente" value={nomeCliente} onChange={e => setNomeCliente(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input type="tel" placeholder="WhatsApp (ex: 11999998888)" value={whatsappCliente} onChange={e => setWhatsappCliente(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Forma de Entrega</h2>
                  <div className="flex gap-3 mb-4">
                    {(['retirada', 'entrega'] as const).map(tipo => (
                      <button key={tipo} onClick={() => setTipoEntrega(tipo)} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${tipoEntrega === tipo ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        {tipo === 'retirada' ? 'Retirar na Loja' : 'Entrega no Endereço'}
                      </button>
                    ))}
                  </div>
                  {tipoEntrega === 'entrega' && (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input type="text" placeholder="CEP de entrega" value={cepDestino} onChange={e => { setCepDestino(e.target.value); setDadosFrete(null); setEnderecoViaCEP(''); if (e.target.value.replace(/\D/g,'').length === 8) buscarEnderecoCEP(e.target.value); }} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" maxLength={9} />
                        <button onClick={calcularFrete} disabled={calculandoFrete} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50">
                          {calculandoFrete ? '...' : 'Calcular'}
                        </button>
                      </div>
                      {enderecoViaCEP && !dadosFrete && <p className="text-xs text-gray-500">{enderecoViaCEP}</p>}
                      {erroFrete && <p className="text-xs text-red-500">{erroFrete}</p>}
                      {dadosFrete && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-sm font-medium text-green-800">{dadosFrete.endereco.logradouro}, {dadosFrete.endereco.bairro}</p>
                          <p className="text-xs text-green-600">{dadosFrete.endereco.cidade}-{dadosFrete.endereco.estado}</p>
                          <p className="text-sm font-bold text-green-700 mt-1">Frete estimado: R$ {formatBRL(dadosFrete.valorFrete)}</p>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Data de entrega</label>
                        <input type="date" value={dataEntrega} min={todayStr} onChange={e => setDataEntrega(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-blue-700 text-white rounded-xl p-4">
                  <div className="flex justify-between mb-1"><span className="text-blue-200 text-sm">Subtotal:</span><span className="font-medium">R$ {formatBRL(subtotal)}</span></div>
                  {tipoEntrega === 'entrega' && dadosFrete && <div className="flex justify-between mb-1"><span className="text-blue-200 text-sm">Frete:</span><span className="font-medium">R$ {formatBRL(dadosFrete.valorFrete)}</span></div>}
                  <div className="flex justify-between mt-2 pt-2 border-t border-blue-600"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-xl">R$ {formatBRL(total)}</span></div>
                </div>

                <button onClick={salvarEGerarOrcamento} disabled={salvandoOrcamento} className="w-full bg-green-600 text-white py-4 rounded-xl text-lg font-bold hover:bg-green-700 transition shadow-lg disabled:opacity-60">
                  {salvandoOrcamento ? 'Salvando...' : editandoId ? 'Atualizar Orçamento' : 'Gerar Orçamento'}
                </button>
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'historico' && (
          <div className="pb-8">
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input type="text" placeholder="Buscar por código, nome ou telefone..." value={buscaHistorico} onChange={e => setBuscaHistorico(e.target.value)} onKeyDown={e => e.key === 'Enter' && carregarHistorico()} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <select value={filtroStatus} onChange={e => { setFiltroStatus(e.target.value); }} className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Todos os status</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={carregarHistorico} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">Buscar</button>
            </div>
            {loadingHistorico ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
            ) : orcamentos.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-4">📋</p>
                <p>Nenhum orçamento encontrado</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 mb-4">{totalOrcamentos} orçamento(s) encontrado(s)</p>
                <div className="space-y-3">
                  {orcamentos.map(orc => (
                    <div key={orc.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 cursor-pointer hover:shadow-md transition" onClick={() => abrirDetalhe(orc.id)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-blue-700">{orc.codigo}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[orc.status] || 'bg-gray-100 text-gray-600'}`}>
                              {STATUS_LABELS[orc.status] || orc.status}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-800">{orc.clientes?.nome || 'Cliente'}</p>
                          <p className="text-xs text-gray-500">{orc.clientes?.telefone || ''} {orc.clientes?.cidade ? `• ${orc.clientes.cidade}-${orc.clientes.estado}` : ''}</p>
                          <p className="text-xs text-gray-400 mt-1">{new Date(orc.criado_em).toLocaleDateString('pt-BR')} {new Date(orc.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-800">R$ {formatBRL(orc.total)}</p>
                          <p className="text-xs text-gray-500 mb-2">{orc.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}</p>
                          <select value={orc.status} onClick={e => e.stopPropagation()} onChange={e => atualizarStatusOrcamento(orc.id, e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Orcamento Gerado */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-2 text-center">Orçamento {editandoId ? 'Atualizado' : 'Gerado'}!</h2>
            {orcamentoSalvo && <p className="text-center text-green-600 font-bold mb-4">Código: {orcamentoSalvo.codigo}</p>}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm font-mono whitespace-pre-wrap text-gray-700 max-h-64 overflow-y-auto">{gerarTextoWhatsApp()}</div>
            <div className="space-y-3">
              <button onClick={() => compartilharWhatsApp()} className="w-full bg-green-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-600 transition">📱 Enviar por WhatsApp</button>
              <button onClick={() => imprimirOrcamento()} className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-blue-600 transition">🖨️ Imprimir</button>
              <button onClick={() => { navigator.clipboard.writeText(gerarTextoWhatsApp()); alert('Texto copiado!'); }} className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition">📋 Copiar Texto</button>
              <button onClick={() => { setMostrarModal(false); setItens([]); setNomeCliente(''); setWhatsappCliente(''); setCepDestino(''); setDadosFrete(null); setOrcamentoSalvo(null); setDataEntrega(''); setEditandoId(null); }} className="w-full text-gray-500 py-2 hover:text-gray-700 transition text-sm">Fechar e Limpar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhe do Orcamento */}
      {mostrarDetalhe && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => { setMostrarDetalhe(false); setOrcamentoDetalhe(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {loadingDetalhe ? (
              <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
            ) : orcamentoDetalhe ? (
              <div>
                <div className="p-6 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-700 text-lg">{orcamentoDetalhe.codigo}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[orcamentoDetalhe.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[orcamentoDetalhe.status] || orcamentoDetalhe.status}
                      </span>
                    </div>
                    <button onClick={() => { setMostrarDetalhe(false); setOrcamentoDetalhe(null); }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                  </div>
                  <p className="text-sm text-gray-500">Criado em: {new Date(orcamentoDetalhe.criado_em).toLocaleDateString('pt-BR')} {new Date(orcamentoDetalhe.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>

                <div className="p-6 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-2">Cliente</h3>
                  <p className="text-sm text-gray-800 font-medium">{orcamentoDetalhe.clientes?.nome || 'Cliente'}</p>
                  {orcamentoDetalhe.clientes?.telefone && <p className="text-sm text-gray-600">📞 {orcamentoDetalhe.clientes.telefone}</p>}
                </div>

                <div className="p-6 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-2">Entrega</h3>
                  <p className="text-sm text-gray-800">{orcamentoDetalhe.tipo_entrega === 'entrega' ? '🚚 Entrega no endereço' : '🏪 Retirada na loja'}</p>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && orcamentoDetalhe.clientes?.endereco && (
                    <p className="text-sm text-gray-600 mt-1">{orcamentoDetalhe.clientes.endereco}{orcamentoDetalhe.clientes.bairro ? `, ${orcamentoDetalhe.clientes.bairro}` : ''}{orcamentoDetalhe.clientes.cidade ? `, ${orcamentoDetalhe.clientes.cidade}-${orcamentoDetalhe.clientes.estado}` : ''}</p>
                  )}
                  {orcamentoDetalhe.data_entrega && <p className="text-sm text-gray-600 mt-1">📅 Data de entrega: {new Date(orcamentoDetalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                </div>

                <div className="p-6 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-3">Produtos</h3>
                  <div className="space-y-2">
                    {orcamentoDetalhe.orcamento_itens.map(item => (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">{item.produto_nome}</p>
                          <p className="text-xs text-gray-500">{item.quantidade} {item.unidade} × R$ {formatBRL(item.preco_unitario)}</p>
                        </div>
                        <p className="font-bold text-blue-700 text-sm">R$ {formatBRL(item.subtotal)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 border-b border-gray-100">
                  <div className="flex justify-between mb-1"><span className="text-sm text-gray-600">Subtotal:</span><span className="font-medium">R$ {formatBRL(orcamentoDetalhe.subtotal)}</span></div>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && orcamentoDetalhe.valor_frete > 0 && <div className="flex justify-between mb-1"><span className="text-sm text-gray-600">Frete:</span><span className="font-medium">R$ {formatBRL(orcamentoDetalhe.valor_frete)}</span></div>}
                  <div className="flex justify-between mt-2 pt-2 border-t border-gray-200"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-xl text-blue-700">R$ {formatBRL(orcamentoDetalhe.total)}</span></div>
                </div>

                {orcamentoDetalhe.observacoes && (
                  <div className="p-6 border-b border-gray-100">
                    <h3 className="font-bold text-gray-700 mb-2">Observações</h3>
                    <p className="text-sm text-gray-600">{orcamentoDetalhe.observacoes}</p>
                  </div>
                )}

                <div className="p-6 space-y-2">
                  <button onClick={() => compartilharWhatsAppDetalhe(orcamentoDetalhe)} className="w-full bg-green-500 text-white py-2.5 rounded-xl font-bold hover:bg-green-600 transition text-sm">📱 Enviar por WhatsApp</button>
                  <button onClick={() => imprimirOrcamento(orcamentoDetalhe)} className="w-full bg-blue-500 text-white py-2.5 rounded-xl font-bold hover:bg-blue-600 transition text-sm">🖨️ Imprimir</button>
                  {orcamentoDetalhe.status === 'orcamento' && (
                    <button onClick={() => editarOrcamento(orcamentoDetalhe)} className="w-full bg-yellow-500 text-white py-2.5 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">✏️ Editar Orçamento</button>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-sm text-gray-600">Status:</span>
                    <select value={orcamentoDetalhe.status} onChange={e => atualizarStatusOrcamento(orcamentoDetalhe.id, e.target.value)} className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400">Erro ao carregar detalhes</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
