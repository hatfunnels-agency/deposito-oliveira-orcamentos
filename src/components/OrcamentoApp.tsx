'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Produto {
  id: string;
  nome: string;
  preco: number;
  preco_custo: number;
  estoque: number;
  estoque_minimo: number;
  abaixo_minimo: boolean;
  unidade: string;
  categoria: string;
  codigo?: string;
  fator_conversao?: number;
  unidade_armazenamento?: string;
  estoque_armazenamento?: number;
}

interface ItemOrcamento {
  produto: Produto;
  quantidade: number;
}

interface DadosFrete {
  frete: number | null;
  distancia_km: number;
  duracao_min: number;
  endereco_completo: string;
  dentro_area: boolean;
  mensagem: string;
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
  data_entrega_original: string | null;
  reagendamentos: number;
  clientes: {
    id: string;
    nome: string;
    telefone: string;
    cep: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    numero: string | null;
    complemento: string | null;
    recebedor: string | null;
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

interface EntregaRota {
  parada?: number;
  id: string;
  codigo: string;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  cep: string;
  numero: string;
  complemento: string;
  recebedor: string;
  bairro: string;
  cidade: string;
  status: string;
  total: number;
  itens_resumo: string;
  data_entrega: string | null;
  observacoes: string;
}

interface RotaResponse {
  data: string;
  total_entregas: number;
  distancia_total_km: number;
  duracao_total_min: number;
  rota_otimizada: EntregaRota[];
  maps_url: string | null;
  mensagem?: string;
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
  saco: 50, unidade: 5, barra: 15, metro: 10, rolo: 20, 'meio metro': 800, kg: 1, milheiro: 2500,
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
  
  
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Todas');
  const [abaAtiva, setAbaAtiva] = useState<'produtos' | 'orcamento' | 'historico' | 'entregas' | 'estoque'>('produtos');
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
  // Feature 8 - Address detail fields
  const [numeroEndereco, setNumeroEndereco] = useState('');
  const [complementoEndereco, setComplementoEndereco] = useState('');
  const [recebedor, setRecebedor] = useState('');
  const [observacoes, setObservacoes] = useState('');
  // Feature 7 - Address search
  const [buscaEndereco, setBuscaEndereco] = useState('');
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  // Feature 9 - Reschedule
  const [mostrarReagendar, setMostrarReagendar] = useState(false);
  const [novaDataEntrega, setNovaDataEntrega] = useState('');
  const [reagendandoId, setReagendandoId] = useState<string | null>(null);
  // Entregas state
  const [entregasRota, setEntregasRota] = useState<RotaResponse | null>(null);
  const [loadingEntregas, setLoadingEntregas] = useState(false);
  const [dataEntregas, setDataEntregas] = useState('');
  const [marcandoRota, setMarcandoRota] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // Estoque management state
  const [mostrarEntrada, setMostrarEntrada] = useState(false);
  const [mostrarAjuste, setMostrarAjuste] = useState(false);
  const [mostrarEditProduto, setMostrarEditProduto] = useState(false);
  const [mostrarNovoProduto, setMostrarNovoProduto] = useState(false);
  const [mostrarHistoricoProduto, setMostrarHistoricoProduto] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [entradaQtd, setEntradaQtd] = useState('');
  const [entradaObs, setEntradaObs] = useState('');
  const [ajusteQtd, setAjusteQtd] = useState('');
  const [ajusteObs, setAjusteObs] = useState('');
  const [editNome, setEditNome] = useState('');
  const [editCodigo, setEditCodigo] = useState('');
  const [editCategoria, setEditCategoria] = useState('');
  const [editPrecoVenda, setEditPrecoVenda] = useState('');
  const [editPrecoCusto, setEditPrecoCusto] = useState('');
  const [editEstoqueMinimo, setEditEstoqueMinimo] = useState('');
  const [editUnidadeVenda, setEditUnidadeVenda] = useState('');
  const [editFatorConversao, setEditFatorConversao] = useState('');
  const [editAtivo, setEditAtivo] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novoCodigo, setNovoCodigo] = useState('');
  const [novoCategoria, setNovoCategoria] = useState('Geral');
  const [novoPrecoVenda, setNovoPrecoVenda] = useState('');
  const [novoPrecoCusto, setNovoPrecoCusto] = useState('');
  const [novoEstoqueInicial, setNovoEstoqueInicial] = useState('');
  const [novoEstoqueMinimo, setNovoEstoqueMinimo] = useState('');
  const [novoUnidade, setNovoUnidade] = useState('unidade');
  const [novoUnidadeVenda, setNovoUnidadeVenda] = useState('unidade');
  const [novoFatorConversao, setNovoFatorConversao] = useState('1');
  const [movimentacoes, setMovimentacoes] = useState<Array<{id:string;tipo:string;quantidade:number;estoque_anterior:number;estoque_novo:number;observacoes:string;criado_em:string}>>([]);
  const [salvandoEstoque, setSalvandoEstoque] = useState(false);
  const [filtroEstoqueBaixo, setFiltroEstoqueBaixo] = useState(false);

  const carregarProdutos = useCallback(() => {
    fetch('/api/produtos')
      .then(r => r.json())
      .then(data => {
        const prods = (data.produtos || []).map((p: Produto) => ({
          ...p,
          unidade: mapUnit(p.nome, p.unidade),
          estoque: p.estoque,
        }));
        setProdutos(prods);
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    carregarProdutos();
  }, [carregarProdutos]);

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
    } catch (e) { console.error('Erro ao carregar historico', e); }
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
      if (existing && existing.quantidade > 1)
        return prev.map(i => i.produto.id === produtoId ? { ...i, quantidade: i.quantidade - 1 } : i);
      return prev.filter(i => i.produto.id !== produtoId);
    });
  };

  // Feature 11 - Set exact quantity
  const setQuantidade = (produtoId: string, qty: number) => {
    if (qty <= 0) {
      setItens(prev => prev.filter(i => i.produto.id !== produtoId));
      return;
    }
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === produtoId);
      if (existing) return prev.map(i => i.produto.id === produtoId ? { ...i, quantidade: qty } : i);
      return prev;
    });
  };

  const getQuantidade = (produtoId: string) => itens.find(i => i.produto.id === produtoId)?.quantidade || 0;

  const subtotal = itens.reduce((acc, item) => acc + (item.produto.preco * item.quantidade), 0);
  const totalFrete = tipoEntrega === 'entrega' && dadosFrete && dadosFrete.frete ? dadosFrete.frete : 0;
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

  // Feature 7 - Search address by street name
  const buscarEnderecoPorRua = async () => {
    if (!buscaEndereco || buscaEndereco.trim().length < 5) return;
    setBuscandoEndereco(true);
    setErroFrete('');
    try {
      const res = await fetch(`/api/endereco?q=${encodeURIComponent(buscaEndereco)}`);
      const data = await res.json();
      if (data.error) {
        setErroFrete(data.error);
      } else {
        if (data.cep) setCepDestino(data.cep);
        if (data.endereco_completo) setEnderecoViaCEP(data.endereco_completo);
        if (data.bairro) setBuscaEndereco('');
      }
    } catch {
      setErroFrete('Erro ao buscar endereço.');
    }
    setBuscandoEndereco(false);
  };


  // Smart address search - detects CEP vs street name
  const buscarEnderecoSmart = async (input: string) => {
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.length === 8 && /^\d{8}$/.test(cleaned)) {
      // It's a CEP - fetch via ViaCEP and calculate freight
      setCepDestino(cleaned);
      setBuscaEndereco(input);
      try {
        const viaRes = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
        const viaData = await viaRes.json();
        if (!viaData.erro) {
          setEnderecoViaCEP(`${viaData.logradouro}, ${viaData.bairro}, ${viaData.localidade}-${viaData.uf}`);
        }
      } catch {}
      // Auto-calculate freight
      setCalculandoFrete(true);
      setErroFrete('');
      setDadosFrete(null);
      try {
        const res = await fetch('/api/frete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cep: cleaned }),
        });
        const data = await res.json();
        if (data.error) {
          setErroFrete(data.error);
        } else if (!data.dentro_area) {
          setErroFrete(data.mensagem || 'Endereço fora da área de entrega');
        } else {
          setDadosFrete(data);
          if (data.endereco_completo) setEnderecoViaCEP(data.endereco_completo);
        }
      } catch {
        setErroFrete('Erro ao calcular frete.');
      }
      setCalculandoFrete(false);
    } else {
      // It's a street name - geocoding search
      if (input.trim().length < 5) return;
      setBuscandoEndereco(true);
      setErroFrete('');
      try {
        const res = await fetch(`/api/endereco?q=${encodeURIComponent(input)}`);
        const data = await res.json();
        if (data.error) {
          setErroFrete(data.error);
        } else {
          if (data.cep) {
            setCepDestino(data.cep);
            // Auto-calculate freight with the found CEP
            setCalculandoFrete(true);
            try {
              const freteRes = await fetch('/api/frete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cep: data.cep }),
              });
              const freteData = await freteRes.json();
              if (freteData.error) {
                setErroFrete(freteData.error);
              } else if (!freteData.dentro_area) {
                setErroFrete(freteData.mensagem || 'Endereço fora da área de entrega');
              } else {
                setDadosFrete(freteData);
                if (freteData.endereco_completo) setEnderecoViaCEP(freteData.endereco_completo);
              }
            } catch {
              setErroFrete('Erro ao calcular frete.');
            }
            setCalculandoFrete(false);
          }
          if (data.endereco_completo) setEnderecoViaCEP(data.endereco_completo);
        }
      } catch {
        setErroFrete('Erro ao buscar endereço.');
      }
      setBuscandoEndereco(false);
    }
  };

  const calcularFrete = async () => {
    if (!cepDestino || cepDestino.replace(/\D/g, '').length !== 8) {
      setErroFrete('Digite um CEP válido.');
      return;
    }
    setCalculandoFrete(true);
    setErroFrete('');
    setDadosFrete(null);
    try {
      const res = await fetch('/api/frete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep: cepDestino }),
      });
      const data = await res.json();
      if (data.error) {
        setErroFrete(data.error);
      } else if (!data.dentro_area) {
        setErroFrete(data.mensagem || 'Endereço fora da área de entrega');
      } else {
        setDadosFrete(data);
        if (data.endereco_completo) setEnderecoViaCEP(data.endereco_completo);
      }
    } catch { setErroFrete('Erro ao calcular frete.'); }
    setCalculandoFrete(false);
  };

  const salvarEGerarOrcamento = async () => {
    setSalvandoOrcamento(true);
    setOrcamentoSalvo(null);
    try {
      const payload: Record<string, unknown> = {
        cliente_nome: nomeCliente || 'Cliente',
        cliente_telefone: whatsappCliente || '00000000000',
        cliente_cep: cepDestino || null,
        cliente_endereco: enderecoViaCEP || null,
        cliente_numero: numeroEndereco || null,
        cliente_complemento: complementoEndereco || null,
        cliente_recebedor: recebedor || null,
        observacoes: observacoes || null,
        tipo_entrega: tipoEntrega,
        valor_frete: totalFrete,
        subtotal,
        total,
        data_entrega: tipoEntrega === 'entrega' && dataEntrega ? dataEntrega : null,
        itens: itens.map(i => ({
          produto_id: i.produto.id,
          produto_supabase_id: i.produto.id,
          produto_nome: i.produto.nome,
          quantidade: i.quantidade,
          unidade: i.produto.unidade,
          preco_unitario: i.produto.preco,
        })),
      };

      if (editandoId) {
        const res = await fetch(`/api/orcamentos/${editandoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo });
        setEditandoId(null);
      } else {
        const res = await fetch('/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo });
      }
    } catch (e) { console.error('Erro ao salvar orcamento', e); }
    setSalvandoOrcamento(false);
    setMostrarModal(true);
  };

;

  // Feature 9 - Reschedule delivery
  const reagendarEntrega = async (id: string, novaData: string) => {
    try {
      const res = await fetch(`/api/orcamentos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_entrega: novaData, reagendar: true }),
      });
      if (res.ok) {
        setMostrarReagendar(false);
        setReagendandoId(null);
        setNovaDataEntrega('');
        if (orcamentoDetalhe && orcamentoDetalhe.id === id) {
          setOrcamentoDetalhe({ ...orcamentoDetalhe, data_entrega: novaData, reagendamentos: (orcamentoDetalhe.reagendamentos || 0) + 1 });
        }
        carregarHistorico();
        if (abaAtiva === 'entregas') carregarEntregas();
        alert('Entrega reagendada com sucesso!');
      }
    } catch (e) { console.error('Erro ao reagendar', e); alert('Erro ao reagendar entrega.'); }
  };

  const gerarTextoWhatsApp = (detalhe?: OrcamentoDetalhe | null) => {
    if (detalhe) {
      const endCompleto = [
        detalhe.clientes?.endereco,
        detalhe.clientes?.numero ? `nº ${detalhe.clientes.numero}` : '',
        detalhe.clientes?.complemento,
        detalhe.clientes?.bairro,
        detalhe.clientes?.cidade ? `${detalhe.clientes.cidade}-${detalhe.clientes.estado}` : '',
      ].filter(Boolean).join(', ');
      const linhas = [
        '*ORÇAMENTO - Depósito Oliveira*',
        `Código: ${detalhe.codigo}`,
        '',
        '-----------------------------',
        '',
        `*Cliente:* ${detalhe.clientes?.nome || 'Cliente'}`,
        detalhe.clientes?.telefone ? `*Telefone:* ${detalhe.clientes.telefone}` : '',
        detalhe.clientes?.recebedor ? `*Recebedor:* ${detalhe.clientes.recebedor}` : '',
        '',
        '*Produtos:*',
        ...detalhe.orcamento_itens.map(i => `· ${i.produto_nome} x${i.quantidade} = R$ ${formatBRL(i.subtotal)}`),
        '',
        `*Subtotal:* R$ ${formatBRL(detalhe.subtotal)}`,
        detalhe.tipo_entrega === 'entrega' && detalhe.valor_frete > 0 ? `*Frete:* R$ ${formatBRL(detalhe.valor_frete)}` : '*Retirada na loja*',
        detalhe.tipo_entrega === 'entrega' && endCompleto ? `*Endereço:* ${endCompleto}` : '',
        detalhe.data_entrega ? `*Data de entrega:* ${new Date(detalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
        '',
        `*TOTAL: R$ ${formatBRL(detalhe.total)}*`,
        '',
        detalhe.observacoes ? `_Obs: ${detalhe.observacoes}_` : '',
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
      recebedor ? `*Recebedor:* ${recebedor}` : '',
      '',
      '*Produtos:*',
      ...itens.map(i => `· ${i.produto.nome} x${i.quantidade} = R$ ${formatBRL(i.produto.preco * i.quantidade)}`),
      '',
      `*Subtotal:* R$ ${formatBRL(subtotal)}`,
      tipoEntrega === 'entrega' && dadosFrete ? `*Frete:* R$ ${formatBRL(dadosFrete.frete || 0)}` : '*Retirada na loja*',
      tipoEntrega === 'entrega' && dataEntrega ? `*Data de entrega:* ${new Date(dataEntrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
      '',
      `*TOTAL: R$ ${formatBRL(total)}*`,
      '',
      observacoes ? `_Obs: ${observacoes}_` : '',
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
    const end = d ? [d.clientes?.endereco, d.clientes?.numero ? `nº ${d.clientes.numero}` : '', d.clientes?.complemento, d.clientes?.bairro, d.clientes?.cidade ? `${d.clientes.cidade}-${d.clientes.estado}` : ''].filter(Boolean).join(', ') : enderecoViaCEP;
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
    const obs = d ? d.observacoes : observacoes;
    if (obs) printWindow.document.write(`<div class="info"><span>Observações:</span> ${obs}</div>`);
    printWindow.document.write(`<table><thead><tr><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:center">Unidade</th><th style="text-align:right">Preço Unit.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${itensHtml}</tbody><tfoot><tr><td colspan="4" style="text-align:right;padding:10px 8px">Subtotal:</td><td style="text-align:right;padding:10px 8px">R$ ${formatBRL(sub)}</td></tr>`);
    if (tipo === 'entrega' && frete > 0) printWindow.document.write(`<tr><td colspan="4" style="text-align:right;padding:4px 8px">Frete:</td><td style="text-align:right;padding:4px 8px">R$ ${formatBRL(frete)}</td></tr>`);
    printWindow.document.write(`<tr><td colspan="4" style="text-align:right;padding:10px 8px;font-size:18px;color:#1d4ed8">TOTAL:</td><td style="text-align:right;padding:10px 8px;font-size:18px;color:#1d4ed8">R$ ${formatBRL(tot)}</td></tr></tfoot></table>`);
    printWindow.document.write(`<div class="footer"><p>Orçamento válido por 7 dias</p><p>Sujeito a disponibilidade de estoque</p></div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  const atualizarStatusOrcamento = async (id: string, novoStatus: string, statusAnterior?: string) => {
    try {
      await fetch(`/api/orcamentos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus, _previous_status: statusAnterior }),
      });
      carregarHistorico();
      if (novoStatus === 'pagamento_ok' || novoStatus === 'cancelado') carregarProdutos();
      if (orcamentoDetalhe && orcamentoDetalhe.id === id) {
        setOrcamentoDetalhe({ ...orcamentoDetalhe, status: novoStatus });
      }
    } catch (e) { console.error('Erro ao atualizar status', e); }
  };

  const abrirDetalhe = async (id: string) => {
    setLoadingDetalhe(true);
    setMostrarDetalhe(true);
    try {
      const res = await fetch(`/api/orcamentos/${id}`);
      const data = await res.json();
      setOrcamentoDetalhe(data);
    } catch (e) { console.error('Erro ao carregar detalhe', e); }
    setLoadingDetalhe(false);
  };

  // Bug 6 - Restore edit button functionality
  const editarOrcamento = (detalhe: OrcamentoDetalhe) => {
    setEditandoId(detalhe.id);
    setNomeCliente(detalhe.clientes?.nome || '');
    setWhatsappCliente(detalhe.clientes?.telefone || '');
    setTipoEntrega(detalhe.tipo_entrega as 'retirada' | 'entrega');
    setDataEntrega(detalhe.data_entrega || '');
    if (detalhe.clientes?.endereco) setEnderecoViaCEP(detalhe.clientes.endereco);
    if (detalhe.clientes?.cep) { setCepDestino(detalhe.clientes.cep); setBuscaEndereco(detalhe.clientes.cep); }
    setNumeroEndereco(detalhe.clientes?.numero || '');
    setComplementoEndereco(detalhe.clientes?.complemento || '');
    setRecebedor(detalhe.clientes?.recebedor || '');
    setObservacoes(detalhe.observacoes || '');
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
    setMostrarDetalhe(false);
    setOrcamentoDetalhe(null);
    setAbaAtiva('orcamento');
  };

  // Bug 1 fix - Entregas now includes em_rota status
  const carregarEntregas = async () => {
    setLoadingEntregas(true);
    try {
      const res = await fetch('/api/entregas/rota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataEntregas || undefined }),
      });
      const data = await res.json();
      setEntregasRota(data);
    } catch (e) { console.error('Erro ao carregar entregas', e); }
    setLoadingEntregas(false);
  };

  const marcarEmRota = async () => {
    if (!entregasRota || entregasRota.rota_otimizada.length === 0) return;
    setMarcandoRota(true);
    try {
      const ids = entregasRota.rota_otimizada.filter(e => e.status !== 'em_rota' && e.status !== 'completo').map(e => e.id);
      if (ids.length > 0) {
        await fetch('/api/entregas/rota', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
      }
      await carregarEntregas();
    } catch (e) { console.error('Erro ao marcar em rota', e); }
    setMarcandoRota(false);
  };

  // Bug 1 fix - Mark individual delivery as complete
  const marcarEntregaCompleta = async (id: string) => {
    try {
      await fetch(`/api/orcamentos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completo' }),
      });
      await carregarEntregas();
    } catch (e) { console.error('Erro ao marcar entrega completa', e); }
  };

  // Feature 5 - Print routes for driver
  const imprimirRotas = () => {
    if (!entregasRota || entregasRota.rota_otimizada.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const dataStr = entregasRota.data ? new Date(entregasRota.data + 'T12:00:00').toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
    let html = `<!DOCTYPE html><html><head><title>Rotas ${dataStr}</title><style>
      body{font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:15px;color:#333;font-size:13px}
      h1{font-size:18px;margin-bottom:2px}
      .header{border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}
      .stats{display:flex;gap:20px;margin:8px 0}
      .stats div{font-weight:bold}
      .entrega{border:1px solid #ccc;border-radius:4px;padding:10px;margin-bottom:10px;page-break-inside:avoid}
      .parada-num{display:inline-block;background:#333;color:white;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:bold;font-size:12px;margin-right:8px}
      .check-area{float:right;border:1px solid #999;width:100px;height:40px;border-radius:4px;text-align:center;line-height:40px;color:#999;font-size:11px}
      .itens{margin:4px 0;padding:4px 0;border-top:1px dashed #ddd}
      @media print{body{padding:5px}.entrega{margin-bottom:6px;padding:6px}}
    </style></head><body>`;
    html += `<div class="header"><h1>🚚 Rotas de Entrega - Depósito Oliveira</h1><p style="margin:2px 0;color:#666">${dataStr}</p><div class="stats"><div>${entregasRota.total_entregas} paradas</div><div>${entregasRota.distancia_total_km} km</div><div>~${entregasRota.duracao_total_min} min</div></div></div>`;
    entregasRota.rota_otimizada.forEach((e, idx) => {
      const endCompleto = [e.endereco, e.numero ? `nº ${e.numero}` : '', e.complemento, e.bairro, e.cidade, e.cep].filter(Boolean).join(', ');
      html += `<div class="entrega"><div class="check-area">☐ Entregue</div><span class="parada-num">${e.parada || idx + 1}</span><strong>${e.cliente_nome}</strong>`;
      if (e.cliente_telefone) html += ` - ${e.cliente_telefone}`;
      html += `<br/><span style="color:#555">${endCompleto}</span>`;
      if (e.recebedor) html += `<br/><em>Recebedor: ${e.recebedor}</em>`;
      html += `<div class="itens">${e.itens_resumo}</div>`;
      html += `<div style="display:flex;justify-content:space-between"><span>Valor: <strong>R$ ${formatBRL(e.total)}</strong></span><span>${e.codigo}</span></div>`;
      if (e.observacoes) html += `<div style="color:#666;font-style:italic;margin-top:2px">Obs: ${e.observacoes}</div>`;
      html += `</div>`;
    });
    html += `</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };


  // ===== Estoque Management Functions =====
  const registrarEntrada = async () => {
    if (!produtoSelecionado || !entradaQtd) return;
    setSalvandoEstoque(true);
    try {
      await fetch('/api/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produto_id: produtoSelecionado.id,
          tipo: 'entrada',
          quantidade: parseFloat(entradaQtd),
          observacoes: entradaObs || null,
        }),
      });
      setMostrarEntrada(false);
      setProdutoSelecionado(null);
      setEntradaQtd('');
      setEntradaObs('');
      carregarProdutos();
    } catch (e) { console.error(e); }
    setSalvandoEstoque(false);
  };

  const registrarAjuste = async () => {
    if (!produtoSelecionado || !ajusteQtd) return;
    setSalvandoEstoque(true);
    try {
      await fetch('/api/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produto_id: produtoSelecionado.id,
          tipo: 'ajuste',
          quantidade: parseFloat(ajusteQtd),
          observacoes: ajusteObs || 'Ajuste de inventário',
        }),
      });
      setMostrarAjuste(false);
      setProdutoSelecionado(null);
      setAjusteQtd('');
      setAjusteObs('');
      carregarProdutos();
    } catch (e) { console.error(e); }
    setSalvandoEstoque(false);
  };

  const salvarEdicaoProduto = async () => {
    if (!produtoSelecionado) return;
    setSalvandoEstoque(true);
    try {
      await fetch(`/api/produtos/${produtoSelecionado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: editNome,
          codigo: editCodigo,
          categoria: editCategoria,
          unidade_venda: editUnidadeVenda,
          preco_venda: parseFloat(editPrecoVenda),
          preco_custo: parseFloat(editPrecoCusto),
          estoque_minimo: parseFloat(editEstoqueMinimo),
          fator_conversao: parseFloat(editFatorConversao),
          ativo: editAtivo,
        }),
      });
      setMostrarEditProduto(false);
      setProdutoSelecionado(null);
      carregarProdutos();
    } catch (e) { console.error(e); }
    setSalvandoEstoque(false);
  };

  const criarNovoProduto = async () => {
    if (!novoNome || !novoPrecoVenda) return;
    setSalvandoEstoque(true);
    try {
      await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novoNome,
          codigo: novoCodigo || null,
          categoria: novoCategoria,
          unidade: novoUnidade,
          unidade_venda: novoUnidadeVenda,
          preco_venda: parseFloat(novoPrecoVenda),
          preco_custo: parseFloat(novoPrecoCusto) || 0,
          estoque_inicial: parseFloat(novoEstoqueInicial) || 0,
          estoque_minimo: parseFloat(novoEstoqueMinimo) || 0,
          fator_conversao: parseFloat(novoFatorConversao) || 1,
        }),
      });
      setMostrarNovoProduto(false);
      setNovoNome(''); setNovoCodigo(''); setNovoPrecoVenda(''); setNovoPrecoCusto('');
      setNovoEstoqueInicial(''); setNovoEstoqueMinimo('');
      carregarProdutos();
    } catch (e) { console.error(e); }
    setSalvandoEstoque(false);
  };

  const abrirEditProduto = (p: Produto) => {
    setProdutoSelecionado(p);
    setEditNome(p.nome);
    setEditCodigo(p.codigo || '');
    setEditCategoria(p.categoria);
    setEditPrecoVenda(String(p.preco));
    setEditPrecoCusto(String(p.preco_custo || 0));
    setEditEstoqueMinimo(String(p.estoque_minimo || 0));
    setEditUnidadeVenda(p.unidade);
    setEditFatorConversao(String(p.fator_conversao || 1));
    setEditAtivo(true);
    setMostrarEditProduto(true);
  };

  const abrirHistoricoProduto = async (p: Produto) => {
    setProdutoSelecionado(p);
    setMostrarHistoricoProduto(true);
    try {
      const res = await fetch(`/api/estoque?produto_id=${p.id}`, { cache: 'no-store' });
      const data = await res.json();
      setMovimentacoes(data.movimentacoes || []);
    } catch { setMovimentacoes([]); }
  };

  const produtosAbaixoMinimo = produtos.filter(p => p.abaixo_minimo);
  const produtosEstoque = filtroEstoqueBaixo ? produtosAbaixoMinimo : produtos;

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
            <button onClick={() => setAbaAtiva('estoque')} className="bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-500 transition">📦 Estoque</button>
            <button onClick={() => setAbaAtiva('entregas')} className="bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-500 transition">🚚 Entregas</button>
            <button onClick={() => setAbaAtiva('historico')} className="bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-500 transition">Histórico</button>
            <button onClick={() => setAbaAtiva('orcamento')} className="relative bg-white text-blue-700 font-bold px-4 py-2 rounded-lg hover:bg-blue-50 transition">
              Orçamento
              {itens.length > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{itens.reduce((a, i) => a + i.quantidade, 0)}</span>}
            </button>
          </div>
        </div>
      </header>

      

      <div className="max-w-6xl mx-auto px-4 pt-4 print:hidden">
        <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
          {(['produtos', 'orcamento', 'historico', 'entregas', 'estoque'] as const).map(aba => (
            <button key={aba} onClick={() => setAbaAtiva(aba)}
              className={`px-4 py-3 font-medium text-sm whitespace-nowrap capitalize ${abaAtiva === aba ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {aba === 'produtos' ? 'Catálogo' : aba === 'orcamento' ? `Orçamento (${itens.reduce((a, i) => a + i.quantidade, 0)})` : aba === 'historico' ? 'Histórico' : aba === 'entregas' ? '🚚 Entregas' : '📦 Estoque'}
            </button>
          ))}
        </div>

        {/* ===== CATALOGO TAB ===== */}
        {abaAtiva === 'produtos' && (
          <div>
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input type="text" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <select value={categoriaSelecionada} onChange={e => setCategoriaSelecionada(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-8">
              {produtosFiltrados.map(produto => {
                const qtd = getQuantidade(produto.id);
                const stepVal = produto.unidade === 'meio metro' ? 0.5 : 1;
                return (
                  <div key={produto.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition">
                    <div className="mb-2"><span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{produto.categoria}</span></div>
                    <h3 className="font-semibold text-gray-800 text-sm mb-1 min-h-[40px]">{produto.nome}</h3>
                    <p className="text-blue-700 font-bold text-lg mb-1">R$ {formatBRL(produto.preco)}<span className="text-xs text-gray-400 font-normal">/{produto.unidade}</span></p>
                    <p className={`text-xs mb-3 ${produto.estoque <= 0 ? 'text-red-600 font-bold' : produto.abaixo_minimo ? 'text-red-500 font-medium' : produto.estoque <= produto.estoque_minimo * 2 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {produto.estoque <= 0 ? '⛔ Sem estoque' : `${produto.abaixo_minimo ? '⚠️ ' : produto.estoque <= produto.estoque_minimo * 2 ? '🟡 ' : '🟢 '}Estoque: ${produto.estoque} ${produto.unidade}${produto.estoque !== 1 ? 's' : ''}`}
                  </p>
                    {qtd === 0 ? (
                      <button onClick={() => adicionarItem(produto)} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">+ Adicionar</button>
                    ) : (
                      <div className="flex items-center justify-between bg-blue-50 rounded-lg p-1">
                        <button onClick={() => removerItem(produto.id)} className="w-8 h-8 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition">-</button>
                        <input type="number" value={qtd} min={0} step={stepVal}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setQuantidade(produto.id, v); }}
                          className="w-16 text-center font-bold text-blue-700 text-lg bg-transparent border-none focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
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

        {/* ===== ORCAMENTO TAB ===== */}
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
                    <button onClick={() => { setEditandoId(null); setItens([]); setNomeCliente(''); setWhatsappCliente(''); setCepDestino(''); setDadosFrete(null); setDataEntrega(''); setNumeroEndereco(''); setComplementoEndereco(''); setRecebedor(''); setObservacoes(''); setBuscaEndereco(''); }}
                      className="text-xs text-yellow-700 underline">Cancelar edição</button>
                  </div>
                )}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50"><h2 className="font-bold text-gray-700">Itens do Orçamento</h2></div>
                  {itens.map(item => {
                    const stepVal = item.produto.unidade === 'meio metro' ? 0.5 : 1;
                    return (
                      <div key={item.produto.id} className="flex items-center gap-3 p-4 border-b border-gray-50 last:border-0">
                        <div className="flex-1">
                          <p className="font-medium text-gray-800 text-sm">{item.produto.nome}</p>
                          <p className="text-xs text-gray-500">R$ {formatBRL(item.produto.preco)}/{item.produto.unidade}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => removerItem(item.produto.id)} className="w-7 h-7 bg-red-100 text-red-600 rounded font-bold hover:bg-red-200 transition text-sm">-</button>
                          <input type="number" value={item.quantidade} min={0} step={stepVal}
                            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setQuantidade(item.produto.id, v); }}
                            className="w-16 text-center font-bold border border-gray-200 rounded px-1 py-1 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => adicionarItem(item.produto)} className="w-7 h-7 bg-green-100 text-green-600 rounded font-bold hover:bg-green-200 transition text-sm">+</button>
                        </div>
                        <p className="w-24 text-right font-bold text-blue-700 text-sm">R$ {formatBRL(item.produto.preco * item.quantidade)}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Dados do Cliente</h2>
                  <div className="space-y-3">
                    <input type="text" placeholder="Nome do cliente" value={nomeCliente} onChange={e => setNomeCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input type="tel" placeholder="WhatsApp (ex: 11999998888)" value={whatsappCliente} onChange={e => setWhatsappCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Forma de Entrega</h2>
                  <div className="flex gap-3 mb-4">
                    {(['retirada', 'entrega'] as const).map(tipo => (
                      <button key={tipo} onClick={() => setTipoEntrega(tipo)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${tipoEntrega === tipo ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        {tipo === 'retirada' ? 'Retirar na Loja' : 'Entrega no Endereço'}
                      </button>
                    ))}
                  </div>
                  {tipoEntrega === 'entrega' && (
                    <div className="space-y-3">
                      {/* Unified smart address field - detects CEP vs street */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="CEP ou endereço (rua, bairro, cidade...)"
                        value={buscaEndereco || cepDestino}
                        onChange={e => {
                          const val = e.target.value;
                          setBuscaEndereco(val);
                          const cleaned = val.replace(/\D/g, '');
                          if (cleaned.length === 8) setCepDestino(cleaned);
                          setDadosFrete(null);
                          setEnderecoViaCEP('');
                        }}
                        onKeyDown={e => e.key === 'Enter' && buscarEnderecoSmart(buscaEndereco || cepDestino)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => buscarEnderecoSmart(buscaEndereco || cepDestino)}
                        disabled={calculandoFrete || buscandoEndereco}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        {calculandoFrete || buscandoEndereco ? '...' : 'Buscar'}
                      </button>
                    </div>
                      {enderecoViaCEP && !dadosFrete && <p className="text-xs text-gray-500">{enderecoViaCEP}</p>}
                      {erroFrete && <p className="text-xs text-red-500">{erroFrete}</p>}
                      {dadosFrete && dadosFrete.dentro_area && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-sm font-medium text-green-800">{dadosFrete.endereco_completo}</p>
                          <p className="text-xs text-green-600 mt-1">{dadosFrete.distancia_km} km — ~{dadosFrete.duracao_min} min</p>
                          <p className="text-sm font-bold text-green-700 mt-1">
                            {dadosFrete.frete === 0 ? '✅ Frete grátis!' : `Frete: R$ ${formatBRL(dadosFrete.frete || 0)}`}
                          </p>
                        </div>
                      )}
                      {/* Feature 8 - Numero, complemento, recebedor */}
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="Número *" value={numeroEndereco} onChange={e => setNumeroEndereco(e.target.value)}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        <input type="text" placeholder="Complemento (opcional)" value={complementoEndereco} onChange={e => setComplementoEndereco(e.target.value)}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                      <input type="text" placeholder="Quem vai receber? (opcional)" value={recebedor} onChange={e => setRecebedor(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Data de entrega</label>
                        <input type="date" value={dataEntrega} min={todayStr} onChange={e => setDataEntrega(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-blue-700 text-white rounded-xl p-4">
                  <div className="flex justify-between mb-1"><span className="text-blue-200 text-sm">Subtotal:</span><span className="font-medium">R$ {formatBRL(subtotal)}</span></div>
                  {tipoEntrega === 'entrega' && dadosFrete && dadosFrete.frete && dadosFrete.frete > 0 && <div className="flex justify-between mb-1"><span className="text-blue-200 text-sm">Frete ({dadosFrete.distancia_km}km):</span><span className="font-medium">R$ {formatBRL(dadosFrete.frete)}</span></div>}
                  {tipoEntrega === 'entrega' && dadosFrete && dadosFrete.frete === 0 && <div className="flex justify-between mb-1"><span className="text-blue-200 text-sm">Frete:</span><span className="font-medium text-green-300">Grátis!</span></div>}
                  <div className="flex justify-between mt-2 pt-2 border-t border-blue-600"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-xl">R$ {formatBRL(total)}</span></div>
                </div>
                {/* Observações field */}
              <textarea
                placeholder="Observações (ex: ligar antes de entregar, horário preferido...)"
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
              <button onClick={salvarEGerarOrcamento} disabled={salvandoOrcamento}
                  className="w-full bg-green-600 text-white py-4 rounded-xl text-lg font-bold hover:bg-green-700 transition shadow-lg disabled:opacity-60">
                  {salvandoOrcamento ? 'Salvando...' : editandoId ? 'Atualizar Orçamento' : 'Gerar Orçamento'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== HISTORICO TAB ===== */}
        {abaAtiva === 'historico' && (
          <div className="pb-8">
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input type="text" placeholder="Buscar por código, nome ou telefone..." value={buscaHistorico}
                onChange={e => setBuscaHistorico(e.target.value)} onKeyDown={e => e.key === 'Enter' && carregarHistorico()}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
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
                          <select value={orc.status} onClick={e => e.stopPropagation()} onChange={e => atualizarStatusOrcamento(orc.id, e.target.value, orc.status)}
                            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
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

        {/* ===== ENTREGAS TAB (Bug 1 fix - shows em_rota items too) ===== */}
        {abaAtiva === 'entregas' && (
          <div className="pb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
              <h2 className="font-bold text-gray-700 mb-3">🚚 Painel de Rotas de Entrega</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="date" value={dataEntregas} onChange={e => setDataEntregas(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <button onClick={carregarEntregas} disabled={loadingEntregas}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50">
                  {loadingEntregas ? 'Calculando...' : 'Calcular Rota'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Deixe a data vazia para ver todas as entregas pendentes</p>
            </div>

            {loadingEntregas && (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
            )}

            {entregasRota && !loadingEntregas && (
              <div>
                {entregasRota.mensagem && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm text-yellow-800">{entregasRota.mensagem}</div>
                )}

                {entregasRota.total_entregas > 0 && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div><p className="text-2xl font-bold text-blue-700">{entregasRota.total_entregas}</p><p className="text-xs text-blue-600">Entregas</p></div>
                        <div><p className="text-2xl font-bold text-blue-700">{entregasRota.distancia_total_km} km</p><p className="text-xs text-blue-600">Distância total</p></div>
                        <div><p className="text-2xl font-bold text-blue-700">~{entregasRota.duracao_total_min} min</p><p className="text-xs text-blue-600">Tempo estimado</p></div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      {entregasRota.rota_otimizada.map((entrega, idx) => (
                        <div key={entrega.id} onClick={() => abrirDetalhe(entrega.id)} className={`bg-white rounded-xl shadow-sm border p-4 cursor-pointer hover:shadow-md transition ${entrega.status === 'em_rota' ? 'border-purple-300 bg-purple-50' : entrega.status === 'completo' ? 'border-green-300 bg-green-50 opacity-60' : 'border-gray-100'}`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${entrega.status === 'em_rota' ? 'bg-purple-600 text-white' : entrega.status === 'completo' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                              {entrega.parada || idx + 1}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-gray-800">{entrega.cliente_nome}</p>
                                {entrega.cliente_telefone && (
                                  <a href={`tel:${entrega.cliente_telefone}`} className="text-xs text-blue-600 underline">{entrega.cliente_telefone}</a>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mb-1">
                                {[entrega.endereco, entrega.numero ? `nº ${entrega.numero}` : '', entrega.complemento, entrega.bairro, entrega.cep].filter(Boolean).join(', ') || entrega.cep}
                              </p>
                              {entrega.recebedor && <p className="text-xs text-gray-500">Recebedor: {entrega.recebedor}</p>}
                              <p className="text-xs text-gray-400">{entrega.itens_resumo}</p>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <span className="text-xs font-medium text-blue-700">{entrega.codigo}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[entrega.status] || 'bg-gray-100 text-gray-600'}`}>
                                  {STATUS_LABELS[entrega.status] || entrega.status}
                                </span>
                                <span className="text-xs font-bold text-gray-700">R$ {formatBRL(entrega.total)}</span>
                              </div>
                              {/* Bug 1 fix - action buttons per delivery */}
                              <div className="flex gap-2 mt-2">
                                {entrega.status === 'em_rota' && (
                                  <button onClick={(e) => { e.stopPropagation(); marcarEntregaCompleta(entrega.id); }}
                                    className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition">
                                    ✅ Marcar Entregue
                                  </button>
                                )}
                                {['entrega_pendente', 'em_rota', 'ocorrencia'].includes(entrega.status) && (
                                  <button onClick={(e) => { e.stopPropagation(); setReagendandoId(entrega.id); setMostrarReagendar(true); }}
                                    className="text-xs bg-yellow-500 text-white px-3 py-1 rounded-lg hover:bg-yellow-600 transition">
                                    📅 Reagendar
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      {entregasRota.maps_url && (
                        <a href={entregasRota.maps_url} target="_blank" rel="noopener noreferrer"
                          className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold text-center hover:bg-green-700 transition">
                          🗺️ Abrir no Google Maps
                        </a>
                      )}
                      <button onClick={imprimirRotas}
                        className="flex-1 bg-gray-600 text-white py-3 rounded-xl font-bold hover:bg-gray-700 transition">
                        🖨️ Imprimir Rotas
                      </button>
                      <button onClick={marcarEmRota} disabled={marcandoRota}
                        className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-bold hover:bg-purple-700 transition disabled:opacity-50">
                        {marcandoRota ? 'Atualizando...' : '🚚 Marcar Todos Em Rota'}
                      </button>
                    </div>
                  </>
                )}
                {entregasRota.total_entregas === 0 && (
                  <div className="text-center py-16 text-gray-400">
                    <p className="text-4xl mb-4">✅</p>
                    <p>Nenhuma entrega pendente para esta data</p>
                  </div>
                )}
              </div>
            )}

            {!entregasRota && !loadingEntregas && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-4">🚚</p>
                <p>Clique em "Calcular Rota" para ver as entregas do dia</p>
              </div>
            )}
          </div>
        )}
      </div>


      {/* ===== ESTOQUE TAB ===== */}
      {abaAtiva === 'estoque' && (
        <div className="pb-8">
          {produtosAbaixoMinimo.length > 0 && (
            <button onClick={() => setFiltroEstoqueBaixo(!filtroEstoqueBaixo)} className={`w-full mb-4 p-3 rounded-xl text-sm font-medium transition ${filtroEstoqueBaixo ? 'bg-red-100 border-2 border-red-400 text-red-800' : 'bg-yellow-50 border border-yellow-200 text-yellow-800 hover:bg-yellow-100'}`}>
              ⚠️ {produtosAbaixoMinimo.length} produto(s) abaixo do estoque mínimo {filtroEstoqueBaixo ? '(ver todos)' : '(filtrar)'}
            </button>
          )}
          <div className="flex flex-wrap gap-3 mb-6">
            <button onClick={() => setMostrarNovoProduto(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">➕ Novo Produto</button>
            <button onClick={() => { setProdutoSelecionado(null); setMostrarEntrada(true); }} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition">📥 Registrar Entrada</button>
            <button onClick={() => { setProdutoSelecionado(null); setMostrarAjuste(true); }} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition">📋 Ajuste Inventário</button>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Produto</th>
                  <th className="text-center px-2 py-3 font-medium text-gray-600">Estoque</th>
                  <th className="text-right px-2 py-3 font-medium text-gray-600">Venda</th>
                  <th className="text-right px-2 py-3 font-medium text-gray-600">Custo</th>
                  <th className="text-right px-2 py-3 font-medium text-gray-600">Margem</th>
                  <th className="text-center px-2 py-3 font-medium text-gray-600">Ações</th>
                </tr></thead>
                <tbody>
                  {produtosEstoque.map(p => {
                    const margem = p.preco > 0 && p.preco_custo > 0 ? ((p.preco - p.preco_custo) / p.preco * 100).toFixed(0) : '-';
                    const estoqueColor = p.estoque <= 0 ? 'text-red-700 bg-red-50' : p.abaixo_minimo ? 'text-red-600 bg-red-50' : p.estoque <= p.estoque_minimo * 2 ? 'text-yellow-700 bg-yellow-50' : 'text-green-700 bg-green-50';
                    return (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3"><p className="font-medium text-gray-800">{p.nome}</p><p className="text-xs text-gray-400">{p.categoria} · {p.codigo || '-'}</p></td>
                        <td className="px-2 py-3 text-center"><span className={`text-xs font-bold px-2 py-1 rounded-full ${estoqueColor}`}>{p.estoque} {p.unidade}</span><p className="text-xs text-gray-400 mt-0.5">min: {p.estoque_minimo}</p></td>
                        <td className="px-2 py-3 text-right font-medium">R$ {formatBRL(p.preco)}</td>
                        <td className="px-2 py-3 text-right text-gray-500">R$ {formatBRL(p.preco_custo || 0)}</td>
                        <td className="px-2 py-3 text-right"><span className={`text-xs font-bold ${Number(margem) >= 30 ? 'text-green-600' : Number(margem) >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>{margem}%</span></td>
                        <td className="px-2 py-3 text-center"><div className="flex gap-1 justify-center flex-wrap">
                          <button onClick={() => abrirEditProduto(p)} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200">✏️</button>
                          <button onClick={() => { setProdutoSelecionado(p); setEntradaQtd(''); setEntradaObs(''); setMostrarEntrada(true); }} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">📥</button>
                          <button onClick={() => abrirHistoricoProduto(p)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">📊</button>
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* Modal Orcamento Gerado */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-2 text-center">Orçamento {editandoId ? 'Atualizado' : 'Gerado'}!</h2>
            {orcamentoSalvo && <p className="text-center text-green-600 font-bold mb-2">Código: {orcamentoSalvo.codigo}</p>}
            
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm font-mono whitespace-pre-wrap text-gray-700 max-h-64 overflow-y-auto">{gerarTextoWhatsApp()}</div>
            <div className="space-y-3">
              <button onClick={() => compartilharWhatsApp()} className="w-full bg-green-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-600 transition">📱 Enviar por WhatsApp</button>
              <button onClick={() => imprimirOrcamento()} className="w-full bg-blue-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-blue-600 transition">🖨️ Imprimir</button>
              <button onClick={() => { navigator.clipboard.writeText(gerarTextoWhatsApp()); alert('Texto copiado!'); }} className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition">📋 Copiar Texto</button>
              <button onClick={() => { setMostrarModal(false); setItens([]); setNomeCliente(''); setWhatsappCliente(''); setCepDestino(''); setDadosFrete(null); setOrcamentoSalvo(null); setDataEntrega(''); setEditandoId(null); setNumeroEndereco(''); setComplementoEndereco(''); setRecebedor(''); setObservacoes(''); setBuscaEndereco(''); }}
                className="w-full text-gray-500 py-2 hover:text-gray-700 transition text-sm">Fechar e Limpar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhe do Orcamento (Bug 6 fix - edit button restored) */}
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
                  {orcamentoDetalhe.clientes?.recebedor && <p className="text-sm text-gray-600">👤 Recebedor: {orcamentoDetalhe.clientes.recebedor}</p>}
                </div>
                <div className="p-6 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-2">Entrega</h3>
                  <p className="text-sm text-gray-800">{orcamentoDetalhe.tipo_entrega === 'entrega' ? '🚚 Entrega no endereço' : '🏪 Retirada na loja'}</p>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && orcamentoDetalhe.clientes?.endereco && (
                    <p className="text-sm text-gray-600 mt-1">
                      {[orcamentoDetalhe.clientes.endereco, orcamentoDetalhe.clientes.numero ? `nº ${orcamentoDetalhe.clientes.numero}` : '', orcamentoDetalhe.clientes.complemento, orcamentoDetalhe.clientes.bairro, orcamentoDetalhe.clientes.cidade ? `${orcamentoDetalhe.clientes.cidade}-${orcamentoDetalhe.clientes.estado}` : ''].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {orcamentoDetalhe.data_entrega && <p className="text-sm text-gray-600 mt-1">📅 Data de entrega: {new Date(orcamentoDetalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                  {orcamentoDetalhe.reagendamentos > 0 && <p className="text-xs text-orange-600 mt-1">⚠️ Reagendado {orcamentoDetalhe.reagendamentos}x</p>}
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
                  {/* Bug 6 fix - Edit button restored for orcamento status */}
                  {orcamentoDetalhe.status === 'orcamento' && (
                    <button onClick={() => editarOrcamento(orcamentoDetalhe)} className="w-full bg-yellow-500 text-white py-2.5 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">✏️ Editar Orçamento</button>
                  )}
                  {/* Feature 9 - Reschedule button */}
                  {['entrega_pendente', 'em_rota', 'ocorrencia'].includes(orcamentoDetalhe.status) && (
                    <button onClick={() => { setReagendandoId(orcamentoDetalhe.id); setMostrarReagendar(true); }}
                      className="w-full bg-yellow-500 text-white py-2.5 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">📅 Reagendar Entrega</button>
                  )}
                  
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-sm text-gray-600">Status:</span>
                    <select value={orcamentoDetalhe.status} onChange={e => atualizarStatusOrcamento(orcamentoDetalhe.id, e.target.value, orcamentoDetalhe.status)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
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

      {/* Feature 9 - Reschedule Modal */}
      {mostrarReagendar && reagendandoId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => { setMostrarReagendar(false); setReagendandoId(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">📅 Reagendar Entrega</h2>
            <input type="date" value={novaDataEntrega} min={todayStr} onChange={e => setNovaDataEntrega(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4" />
            <div className="flex gap-3">
              <button onClick={() => { setMostrarReagendar(false); setReagendandoId(null); }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition">Cancelar</button>
              <button onClick={() => { if (novaDataEntrega && reagendandoId) reagendarEntrega(reagendandoId, novaDataEntrega); }}
                disabled={!novaDataEntrega}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700 transition disabled:opacity-50">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Entrada */}
      {mostrarEntrada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarEntrada(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">📥 Registrar Entrada</h2>
            <div className="space-y-3">
              <select value={produtoSelecionado?.id || ''} onChange={e => setProdutoSelecionado(produtos.find(p => p.id === e.target.value) || null)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione o produto</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome} (atual: {p.estoque_armazenamento || p.estoque} {p.unidade_armazenamento || p.unidade})</option>)}
              </select>
              <input type="number" placeholder={`Quantidade (${produtoSelecionado?.unidade_armazenamento || 'unidades'})`} value={entradaQtd} onChange={e => setEntradaQtd(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" step="0.5" />
              <input type="text" placeholder="Observações (ex: Fornecedor Luan - NF 12345)" value={entradaObs} onChange={e => setEntradaObs(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setMostrarEntrada(false)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Cancelar</button>
              <button onClick={registrarEntrada} disabled={!produtoSelecionado || !entradaQtd || salvandoEstoque} className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Salvando...' : 'Registrar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajuste Inventário */}
      {mostrarAjuste && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarAjuste(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">📋 Ajuste de Inventário</h2>
            <div className="space-y-3">
              <select value={produtoSelecionado?.id || ''} onChange={e => { const p = produtos.find(pp => pp.id === e.target.value); setProdutoSelecionado(p || null); if (p) setAjusteQtd(String(p.estoque_armazenamento || p.estoque)); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione o produto</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              {produtoSelecionado && <p className="text-xs text-gray-500">Estoque atual: {produtoSelecionado.estoque_armazenamento || produtoSelecionado.estoque} {produtoSelecionado.unidade_armazenamento || produtoSelecionado.unidade}</p>}
              <input type="number" placeholder="Novo estoque (contagem física)" value={ajusteQtd} onChange={e => setAjusteQtd(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" step="0.5" />
              <input type="text" placeholder="Observações (ex: Inventário mensal)" value={ajusteObs} onChange={e => setAjusteObs(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setMostrarAjuste(false)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Cancelar</button>
              <button onClick={registrarAjuste} disabled={!produtoSelecionado || !ajusteQtd || salvandoEstoque} className="flex-1 bg-orange-600 text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Salvando...' : 'Ajustar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Produto */}
      {mostrarEditProduto && produtoSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarEditProduto(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">✏️ Editar Produto</h2>
            <div className="space-y-3">
              <input type="text" placeholder="Nome" value={editNome} onChange={e => setEditNome(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Código" value={editCodigo} onChange={e => setEditCodigo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input type="text" placeholder="Categoria" value={editCategoria} onChange={e => setEditCategoria(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Preço Venda</label><input type="number" value={editPrecoVenda} onChange={e => setEditPrecoVenda(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.01" /></div>
                <div><label className="text-xs text-gray-500">Preço Custo</label><input type="number" value={editPrecoCusto} onChange={e => setEditPrecoCusto(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.01" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Estoque Mínimo</label><input type="number" value={editEstoqueMinimo} onChange={e => setEditEstoqueMinimo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.5" /></div>
                <div><label className="text-xs text-gray-500">Unidade Venda</label><input type="text" value={editUnidadeVenda} onChange={e => setEditUnidadeVenda(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setMostrarEditProduto(false)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Cancelar</button>
              <button onClick={salvarEdicaoProduto} disabled={salvandoEstoque} className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Produto */}
      {mostrarNovoProduto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarNovoProduto(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">➕ Novo Produto</h2>
            <div className="space-y-3">
              <input type="text" placeholder="Nome do produto *" value={novoNome} onChange={e => setNovoNome(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Código" value={novoCodigo} onChange={e => setNovoCodigo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input type="text" placeholder="Categoria" value={novoCategoria} onChange={e => setNovoCategoria(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Preço Venda *</label><input type="number" value={novoPrecoVenda} onChange={e => setNovoPrecoVenda(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.01" /></div>
                <div><label className="text-xs text-gray-500">Preço Custo</label><input type="number" value={novoPrecoCusto} onChange={e => setNovoPrecoCusto(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.01" /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-xs text-gray-500">Unidade</label><input type="text" value={novoUnidade} onChange={e => setNovoUnidade(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="text-xs text-gray-500">Un. Venda</label><input type="text" value={novoUnidadeVenda} onChange={e => setNovoUnidadeVenda(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="text-xs text-gray-500">Fator Conv.</label><input type="number" value={novoFatorConversao} onChange={e => setNovoFatorConversao(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Estoque Inicial</label><input type="number" value={novoEstoqueInicial} onChange={e => setNovoEstoqueInicial(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.5" /></div>
                <div><label className="text-xs text-gray-500">Estoque Mínimo</label><input type="number" value={novoEstoqueMinimo} onChange={e => setNovoEstoqueMinimo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" step="0.5" /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setMostrarNovoProduto(false)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Cancelar</button>
              <button onClick={criarNovoProduto} disabled={!novoNome || !novoPrecoVenda || salvandoEstoque} className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Criando...' : 'Criar Produto'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Histórico Movimentações */}
      {mostrarHistoricoProduto && produtoSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarHistoricoProduto(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-2">📊 Histórico - {produtoSelecionado.nome}</h2>
            <p className="text-sm text-gray-500 mb-4">Estoque atual: {produtoSelecionado.estoque} {produtoSelecionado.unidade}</p>
            {movimentacoes.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Nenhuma movimentação registrada</p>
            ) : (
              <div className="space-y-2">
                {movimentacoes.map(m => (
                  <div key={m.id} className={`p-3 rounded-lg border text-sm ${m.tipo === 'entrada' ? 'bg-green-50 border-green-200' : m.tipo === 'saida' ? 'bg-red-50 border-red-200' : m.tipo === 'cancelamento' ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{m.tipo === 'entrada' ? '📥 Entrada' : m.tipo === 'saida' ? '📤 Saída' : m.tipo === 'cancelamento' ? '↩️ Cancelamento' : '📋 Ajuste'}</span>
                      <span className="text-xs text-gray-500">{new Date(m.criado_em).toLocaleDateString('pt-BR')} {new Date(m.criado_em).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <p className="text-xs mt-1">{m.estoque_anterior} → {m.estoque_novo} ({m.tipo === 'saida' ? '-' : '+'}{m.quantidade})</p>
                    {m.observacoes && <p className="text-xs text-gray-600 mt-1">{m.observacoes}</p>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setMostrarHistoricoProduto(false)} className="w-full mt-4 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Fechar</button>
          </div>
        </div>
      )}

    </div>
  );
}
