'use client'; // v3 - auth + redesign

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase-client';
import CalculadoraFerroModal from './CalculadoraFerroModal';
import DashboardTab from './DashboardTab';

interface Produto {
  id: string;
  nome: string;
  preco: number;
  preco_custo: number;
  estoque: number;
  estoque_minimo: number
  abaixo_minimo: boolean;
  unidade: string;
  categoria: string;
  codigo?: string;
  fator_conversao?: number;
  unidade_armazenamento?: string;
  estoque_armazenamento?: number;
  estoque_compartilhado_com?: string | null;
}

interface ItemOrcamento {
  produto: Produto;
  quantidade: number;
  avulso?: boolean;
  preco_custom?: number;
  obs?: string;
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
  data_retirada?: string | null;
  data_entrega_original: string | null;
  reagendamentos: number;
  motorista_id?: string | null;
  forma_pagamento?: string | null;
  status_pagamento?: string | null;
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
    fonte?: string | null;
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
  data_retirada?: string | null;
  fonte?: string | null;
  motorista_id?: string | null;
  motorista_nome?: string | null;
  reagendamentos?: number;
  resumo_itens?: string;
  bling_pedido_id?: string | null;
  forma_pagamento?: string | null;
  status_pagamento?: string | null;
  clientes: { id: string; nome: string; telefone: string; cidade: string | null; estado: string | null; endereco?: string | null; numero?: string | null; bairro?: string | null; recebedor?: string | null } | null;
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
  motorista_id?: string | null;
  leva_id?: string | null;
  distancia_km?: number | null;
}

interface Motorista {
  id: string;
  nome: string;
  telefone?: string | null;
  veiculo?: string | null;
  ativo: boolean;
}

interface RotaResponse {
  data?: string;
  total_entregas?: number;
  total?: number;
  distancia_total_km?: number;
  duracao_total_min?: number;
  tempo_estimado_min?: number;
  rota_otimizada: EntregaRota[];
  maps_url: string | null;
  entregas?: EntregaRota[];
  mensagem?: string;
}

const UNIT_MAP: Record<string, string> = {
  'arame': 'KG',
  'areia': 'm³',
  'areia ensacada': 'm³',
  'ferro': 'metro',
  'pedra brita': 'm³',
  'pedra': 'm³',
  'brita': 'm³',
  'prego': 'KG',
  'pregos': 'KG',
  'pedrisco': 'm³',
  'po de pedra': 'm³',
  'pó de pedra': 'm³',
  'cimento': 'saco',
  'telha': 'unidade',
  'parafuso': 'unidade',
  'tijolo': 'unidade',
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
  saco: 50, unidade: 5, barra: 15, metro: 10, rolo: 20, 'm³': 800, kg: 1, milheiro: 2500,
};

const STATUS_LABELS: Record<string, string> = {
  orcamento: 'Orçamento',
  entrega_pendente: 'Entrega Pendente',
  retirada_pendente: 'Retirada Pendente',
  em_rota: 'Em Rota',
  completo: 'Completo',
  ocorrencia: 'Ocorrência',
  cancelado: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  orcamento: 'bg-gray-100 text-gray-700',
  entrega_pendente: 'bg-orange-100 text-orange-800',
  retirada_pendente: 'bg-purple-100 text-purple-800',
  em_rota: 'bg-blue-100 text-blue-800',
  completo: 'bg-green-200 text-green-900',
  ocorrencia: 'bg-red-100 text-red-800',
  cancelado: 'bg-gray-200 text-gray-600',
};

const STATUS_PAGAMENTO_LABELS: Record<string, string> = {
  pendente: '⏳ Pgto Pendente',
  parcial: '⚠️ Pgto Parcial',
  completo: '✅ Pago',
  pagamento_na_entrega: '🚚 Pgto na Entrega',
};
const STATUS_PAGAMENTO_COLORS: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800',
  parcial: 'bg-orange-100 text-orange-800',
  completo: 'bg-green-100 text-green-800',
  pagamento_na_entrega: 'bg-blue-100 text-blue-800',
};
const ACRESCIMO_CARTAO = 0.08;
const MAX_PARCELAS = 6;
const CAPACIDADE_CAMINHAO_M3 = 10;


export default function OrcamentoApp() {  // Auth state
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<{nome: string, papel: string} | null>(null);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        supabaseBrowser
          .from('usuarios')
          .select('nome, papel')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => { if (data) setUserProfile(data); });
      }
    });
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabaseBrowser.auth.signOut();
    window.location.href = '/login';
  };

  const papelUsuario = userProfile?.papel ?? 'atendente';
  const nomeUsuario = userProfile?.nome ?? user?.email ?? '';
  const abasVisiveis = papelUsuario === 'motorista'
    ? ['entregas']
    : papelUsuario === 'atendente'
    ? ['produtos', 'orcamento', 'historico', 'entregas', 'ferragens', 'dashboard']
    : ['produtos', 'orcamento', 'historico', 'entregas', 'estoque', 'ferragens', 'dashboard'];
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  
  
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  // === CALCULADORA DE FERRO STATES ===
  const [showCalculadoraFerro, setShowCalculadoraFerro] = useState(false);
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Todas');
  const [abaAtiva, setAbaAtiva] = useState<'produtos' | 'orcamento' | 'historico' | 'entregas' | 'estoque' | 'ia' | 'ferragens' | 'dashboard'>('produtos');
  const [mensagensIA, setMensagensIA] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [inputIA, setInputIA] = useState('');
  const [carregandoIA, setCarregandoIA] = useState(false);
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
  const [orcamentoSalvo, setOrcamentoSalvo] = useState<{ codigo: string; id?: string } | null>(null);
  const [orcamentos, setOrcamentos] = useState<OrcamentoSalvo[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [buscaHistorico, setBuscaHistorico] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [paginaHistorico, setPaginaHistorico] = useState(1);
  const [totalOrcamentos, setTotalOrcamentos] = useState(0);
  const [dataEntrega, setDataEntrega] = useState('');
  const [dataRetirada, setDataRetirada] = useState('');
  const [fonteVenda, setFonteVenda] = useState('');
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
  const [sugestoesEndereco, setSugestoesEndereco] = useState<Array<{place_id: string; description: string}>>([]);
  const [mostrandoSugestoes, setMostrandoSugestoes] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Levas state
  const [levas, setLevas] = useState<Array<{id: string; numero_leva: number; data: string; volume_total?: number; status?: string; motorista_id?: string | null; motoristas?: {id: string; nome: string; veiculo?: string} | null; orcamentos?: Record<string, unknown>[]}>>([]); 
  const [levaAtualId, setLevaAtualId] = useState<string | null>(null);
  const [carregandoLevas, setCarregandoLevas] = useState(false);
  const [entregasSelecionadas, setEntregasSelecionadas] = useState<string[]>([]);
  const [mostrarModalNovaLeva, setMostrarModalNovaLeva] = useState(false);
  const [novaLevaData, setNovaLevaData] = useState('');
  const [novaLevaMotorista, setNovaLevaMotorista] = useState('');
  const [salvandoLeva, setSalvandoLeva] = useState(false);
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  // Feature 9 - Reschedule
  const [mostrarReagendar, setMostrarReagendar] = useState(false);
  const [novaDataEntrega, setNovaDataEntrega] = useState('');
  const [reagendandoId, setReagendandoId] = useState<string | null>(null);
  // Entregas state
  const [entregasRota, setEntregasRota] = useState<RotaResponse | null>(null);
  const [loadingEntregas, setLoadingEntregas] = useState(false);
  const [entregasDia, setEntregasDia] = useState<EntregaRota[]>([]);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [rotaGerada, setRotaGerada] = useState<RotaResponse | null>(null);
  const [loadingDia, setLoadingDia] = useState(false);
  const [loadingRota, setLoadingRota] = useState(false);
  const [expandedDia, setExpandedDia] = useState<string[]>([]);
  const [dataEntregas, setDataEntregas] = useState('');
  const [marcandoRota, setMarcandoRota] = useState(false);
  const [entregasEmRota, setEntregasEmRota] = useState<EntregaRota[]>([]);
  const [entregasCompletas, setEntregasCompletas] = useState<EntregaRota[]>([]);
  const [loadingCompleto, setLoadingCompleto] = useState<string | null>(null);
  const [retiradas, setRetiradas] = useState<OrcamentoSalvo[]>([]);
  const [loadingRetiradas, setLoadingRetiradas] = useState(false);
  // === FERRAGENS STATES ===
  const [ferragens, setFerragens] = useState<Record<string, unknown>[]>([]);
  const [loadingFerragens, setLoadingFerragens] = useState(false);
  const [ferragensProducao, setFerragensProducao] = useState<Record<string, unknown>[]>([]);
  const [loadingFerragensProducao, setLoadingFerragensProducao] = useState(false);
  const [passandoAoFerreiro, setPassandoAoFerreiro] = useState<string | null>(null);
  const [voltandoFerragemPendente, setVoltandoFerragemPendente] = useState<string | null>(null);
  const [marcandoRetirado, setMarcandoRetirado] = useState<string | null>(null);
  const [expandedEmRota, setExpandedEmRota] = useState<string[]>([]);
  const [expandedCompleto, setExpandedCompleto] = useState<string[]>([]);

  const printRef = useRef<HTMLDivElement>(null);
  // Motoristas state
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [filtroMotorista, setFiltroMotorista] = useState<string>('todos');
  const [mostrarGestaoMotoristas, setMostrarGestaoMotoristas] = useState(false);
  const [novoMotoristaNome, setNovoMotoristaNome] = useState('');
  const [novoMotoristaVeiculo, setNovoMotoristaVeiculo] = useState('');
  const [atribuindoMotorista, setAtribuindoMotorista] = useState<string | null>(null);
  const [mostrarAtribuirMotorista, setMostrarAtribuirMotorista] = useState(false);
  const [entregaSelecionadaId, setEntregaSelecionadaId] = useState<string | null>(null);

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
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoProdutoId, setExcluindoProdutoId] = useState<string | null>(null);
  // Feature 3 - Logo base64 for print
  const [logoBase64, setLogoBase64] = useState<string>('');
  // Feature 6 - New quote flow
  const [etapaOrcamento, setEtapaOrcamento] = useState<'catalogo' | 'cliente' | 'produtos' | 'revisao'>('catalogo');
  const [modalClienteAberto, setModalClienteAberto] = useState(false);
  const [clienteNomeNovo, setClienteNomeNovo] = useState('');
  const [clienteTelefoneNovo, setClienteTelefoneNovo] = useState('');
  const [clienteNotasNovo, setClienteNotasNovo] = useState('');
  const [clienteNumeroNovo, setClienteNumeroNovo] = useState('');
  const [clienteBuscandoNum, setClienteBuscandoNum] = useState(false);
  const [clienteEncontrado, setClienteEncontrado] = useState<{id:string;nome:string;telefone:string;endereco:string|null;bairro:string|null;cidade:string|null;estado:string|null;cep:string|null;numero:string|null;complemento:string|null;recebedor:string|null}|null>(null);
  const [mostrarNotasColapsado, setMostrarNotasColapsado] = useState(false);
  // Feature 5 - Edit motorista
  const [editandoMotoristaId, setEditandoMotoristaId] = useState<string | null>(null);
  const [editandoMotoristaNome, setEditandoMotoristaNome] = useState('');
  const [editandoMotoristaVeiculo, setEditandoMotoristaVeiculo] = useState('');
  const [editandoMotoristaTelefone, setEditandoMotoristaTelefone] = useState('');

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

  const carregarMotoristas = useCallback(async () => {
    try {
      const res = await fetch('/api/motoristas', { cache: 'no-store' });
      const data = await res.json();
      setMotoristas(data.motoristas || []);
    } catch (e) {
      console.error('Erro ao carregar motoristas', e);
    }
  }, []);

  useEffect(() => {
    carregarMotoristas();
  }, [carregarMotoristas]);

  // Feature 3 - Load logo as base64 for print
  useEffect(() => {
    fetch('/logo.png')
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => setLogoBase64(reader.result as string);
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
  }, []);

  const carregarHistorico = useCallback(async () => {
    setLoadingHistorico(true);
    try {
      const params = new URLSearchParams({ limite: '20', pagina: String(paginaHistorico) });
      if (buscaHistorico) params.set('busca', buscaHistorico);
      if (filtroStatus) params.set('status', filtroStatus);
      const res = await fetch(`/api/orcamentos?${params}`);
      const data = await res.json();
      setOrcamentos(data.orcamentos || []);
      setTotalOrcamentos(data.total || 0);
    } catch (e) { console.error('Erro ao carregar historico', e); }
    setLoadingHistorico(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaHistorico, filtroStatus, paginaHistorico]);

  useEffect(() => {
    if (abaAtiva === 'historico') carregarHistorico();
  }, [abaAtiva, carregarHistorico]);

  // Reset page to 1 when search/filter changes
  useEffect(() => {
    setPaginaHistorico(1);
  }, [buscaHistorico, filtroStatus]);

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

  const PRECO_MEIO_M3 = 120;
  const PRODUTOS_MEIO_M3 = ['areia', 'pedrisco', 'po de pedra', 'pó de pedra', 'pedra brita', 'brita'];
  const isMeioM3Produto = (produto: Produto) => {
    const nome = produto.nome.toLowerCase();
    return produto.unidade === 'm³' &&
      PRODUTOS_MEIO_M3.some(n => nome.includes(n)) &&
      !nome.includes('ensacada');
  };

  const adicionarMeioMetro = (produto: Produto) => {
    const idMeio = produto.id + '-meio';
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === idMeio);
      if (existing) return prev.map(i => i.produto.id === idMeio ? { ...i, quantidade: parseFloat((i.quantidade + 0.5).toFixed(1)) } : i);
      const prodMeio: Produto = { ...produto, id: idMeio, nome: produto.nome + ' (½ m³)' };
      return [...prev, { produto: prodMeio, quantidade: 0.5, preco_custom: PRECO_MEIO_M3 / 0.5, avulso: true }];
    });
  };

  const adicionarItensAvulsos = (itens: Array<{nome: string; quantidade: number; preco: number; especificacoes?: string}>) => {
    itens.forEach(item => {
      const produtoAvulso: Produto = {
        id: 'ferro-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
        nome: item.nome,
        preco: item.preco,
        preco_custo: 0,
        estoque: 0,
        estoque_minimo: 0,
        abaixo_minimo: false,
        unidade: 'm',
        categoria: 'Ferro',
        codigo: '',
      };
      const novoItem: ItemOrcamento = { produto: produtoAvulso, quantidade: item.quantidade, avulso: true, preco_custom: item.preco, obs: item.especificacoes };
      setItens(prev => [...prev, novoItem]);
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

  const subtotal = itens.reduce((acc, item) => acc + ((item.preco_custom ?? item.produto.preco) * item.quantidade), 0);
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

  // Fetch levas
  useEffect(() => {
    if (abaAtiva === 'entregas') {
      setCarregandoLevas(true);
      fetch('/api/levas', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => setLevas(data.levas || []))
        .catch(() => {})
        .finally(() => setCarregandoLevas(false));
      // Load retiradas pendentes
      carregarRetiradas();
    }
    if (abaAtiva === 'ferragens') {
      carregarFerragens();
      carregarFerragensProducao();
    }
  }, [abaAtiva]);

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
        observacoes: (() => {
          const ferroItens = itens.filter(i => i.avulso);
          const ferroStr = ferroItens.length > 0
            ? '\nFERRAGEM:\n' + ferroItens.map(i => {
                const preco = (i.preco_custom !== undefined ? i.preco_custom : i.produto.preco);
                const total = preco * i.quantidade;
                const obsLabel = i.obs ? ' — ' + i.obs : '';
                return '• ' + i.produto.nome + ' — ' + i.quantidade + 'm — R$ ' + total.toLocaleString('pt-BR', {minimumFractionDigits:2}) + obsLabel;
              }).join('\n')
            : '';
          return (observacoes || '') + ferroStr || null;
        })(),
        tipo_entrega: tipoEntrega,
        valor_frete: totalFrete,
        subtotal,
        total,
        data_entrega: tipoEntrega === 'entrega' && dataEntrega ? dataEntrega : null,
            observacoes_entrega: tipoEntrega === 'retirada' && dataRetirada ? `*Retirada na loja:* ${new Date(dataRetirada + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
            data_retirada: tipoEntrega === 'retirada' && dataRetirada ? dataRetirada : null,
            fonte: fonteVenda || null,
        criado_por: user?.id ?? null,
        itens: itens.map(i => ({
          produto_id: i.avulso ? null : i.produto.id,
          produto_nome: i.produto.nome,
          quantidade: i.quantidade,
          unidade: i.produto.unidade,
          preco_unitario: i.preco_custom ?? i.produto.preco,
        })),
      };

      if (editandoId) {
        const res = await fetch(`/api/orcamentos/${editandoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo, id: data.id });
        setEditandoId(null);
      } else {
        const res = await fetch('/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.codigo) setOrcamentoSalvo({ codigo: data.codigo, id: data.id });
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
        ...detalhe.orcamento_itens.map(i => `· ${i.produto_nome} ${i.quantidade}${i.unidade === 'm³' ? 'm³' : (i.unidade ? ' ' + i.unidade : '')} = R$ ${formatBRL(i.subtotal)}`),
        '',
        `*Subtotal:* R$ ${formatBRL(detalhe.subtotal)}`,
        detalhe.tipo_entrega === 'entrega' && detalhe.valor_frete > 0 ? `*Frete:* R$ ${formatBRL(detalhe.valor_frete)}` : '*Retirada na loja*',
        detalhe.tipo_entrega === 'entrega' && endCompleto ? `*Endereço:* ${endCompleto}` : '',
        detalhe.data_entrega ? `*Data de entrega:* ${new Date(detalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
        '',
        `*TOTAL: R$ ${formatBRL(detalhe.total)}*`,
        '',
        (detalhe as any).status_pagamento === 'completo' ? '*✅ Pagamento: Pago*' : (detalhe as any).status_pagamento === 'parcial' ? '*⚠️ Pagamento: Parcial*' : '',
        ...(() => {
          const rawObs = detalhe.observacoes || '';
          const ferrIdx = rawObs.indexOf('FERRAGEM:');
          const obsTexto = ferrIdx >= 0 ? rawObs.substring(0, ferrIdx).trim() : rawObs.trim();
          const ferrTexto = ferrIdx >= 0 ? rawObs.substring(ferrIdx).trim() : '';
          const linhas: string[] = [];
          if (obsTexto) linhas.push(`_Obs: ${obsTexto}_`);
          if (ferrTexto) {
            linhas.push('');
            linhas.push('*🔩 FERRAGEM:*');
            ferrTexto.replace('FERRAGEM:', '').trim().split('\n').filter(Boolean).forEach(l => linhas.push(l));
          }
          return linhas;
        })(),
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
      ...itens.map(i => `· ${i.produto.nome} ${i.quantidade}${i.produto.unidade === 'm³' ? 'm³' : (i.produto.unidade ? ' ' + i.produto.unidade : '')} = R$ ${formatBRL(i.produto.preco * i.quantidade)}`),
      '',
      `*Subtotal:* R$ ${formatBRL(subtotal)}`,
      tipoEntrega === 'entrega' && dadosFrete ? `*Frete:* R$ ${formatBRL(dadosFrete.frete || 0)}` : '*Retirada na loja*',
      tipoEntrega === 'entrega' && dataEntrega ? `*Data de entrega:* ${new Date(dataEntrega + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
      '',
      `*TOTAL: R$ ${formatBRL(total)}*`,
      `💳 Cartão (+8%): R$ ${formatBRL(total * (1 + ACRESCIMO_CARTAO))} | 2x R$ ${formatBRL(total * (1 + ACRESCIMO_CARTAO) / 2)} | 6x R$ ${formatBRL(total * (1 + ACRESCIMO_CARTAO) / 6)}`,
      '',
      observacoes ? `_Obs: ${observacoes}_` : '',
      '_Orçamento válido por 7 dias_',
      '_Sujeito a disponibilidade de estoque_',
      '',
      '_Depósito Oliveira — (11) 4187-1801_',
      '_Av. Inocêncio Seráfico, 4020 — Carapicuíba/SP_',
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
      ? d.orcamento_itens.map(i => `<tr><td style="padding:5px 7px;border-bottom:1px solid #eee">${i.produto_nome}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:center">${i.quantidade}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:center">${i.unidade}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.preco_unitario)}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.subtotal)}</td></tr>`).join('')
      : itens.map(i => `<tr><td style="padding:5px 7px;border-bottom:1px solid #eee">${i.produto.nome}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:center">${i.quantidade}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:center">${i.produto.unidade}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.produto.preco)}</td><td style="padding:5px 7px;border-bottom:1px solid #eee;text-align:right">R$ ${formatBRL(i.produto.preco * i.quantidade)}</td></tr>`).join('');
    const nome = d ? (d.clientes?.nome || 'Cliente') : (nomeCliente || 'Cliente');
    const tel = d ? (d.clientes?.telefone || '') : whatsappCliente;
    const cod = d ? d.codigo : (orcamentoSalvo?.codigo || '');
    const sub = d ? d.subtotal : subtotal;
    const tot = d ? d.total : total;
    const tipo = d ? d.tipo_entrega : tipoEntrega;
    const frete = d ? d.valor_frete : totalFrete;
    const end = d ? [d.clientes?.endereco, d.clientes?.numero ? `nº ${d.clientes.numero}` : '', d.clientes?.complemento, d.clientes?.bairro, d.clientes?.cidade ? `${d.clientes.cidade}-${d.clientes.estado}` : ''].filter(Boolean).join(', ') : enderecoViaCEP;
    const dataEnt = d ? d.data_entrega : (tipoEntrega === 'entrega' ? dataEntrega : '');
    const dataRet = d ? (d as any).data_retirada : (tipoEntrega === 'retirada' ? dataRetirada : '');
    const dataCriacao = d ? new Date(d.criado_em).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
    const ferroItensImp = !d ? itens.filter(i => i.avulso) : [];
    const ferroStrImp = ferroItensImp.length > 0
      ? '\nFERRAGEM:\n' + ferroItensImp.map(i => {
          const preco = (i.preco_custom !== undefined ? i.preco_custom : i.produto.preco);
          const total = preco * i.quantidade;
          const obsLabel = i.obs ? ' — ' + i.obs : '';
          return '• ' + i.produto.nome + ' — ' + i.quantidade + 'm — R$ ' + total.toLocaleString('pt-BR', {minimumFractionDigits:2}) + obsLabel;
        }).join('\n')
      : '';
    const obsImp = d ? d.observacoes : ((observacoes || '') + ferroStrImp || null);
    const formaPagImp = d ? (d as any).forma_pagamento as string | null : null;
    const statusPagImp = d ? (d as any).status_pagamento as string | null : null;
    const formaPagLabelImp: Record<string,string> = {dinheiro:'Dinheiro',pix:'PIX',debito:'Débito',credito:'Crédito',boleto:'Boleto',pagamento_na_entrega:'Pagamento na Entrega'};
    const valorCartaoImp = tot * (1 + ACRESCIMO_CARTAO);
    const htmlImp = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orçamento ${cod}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:15px;color:#333;margin:0;padding:0}.hdr{display:flex;align-items:center;gap:16px;margin-bottom:12px}.hdr img{height:64px;width:auto}.hdr h1{margin:0;font-size:22px;color:#F7941D}.hdr p{margin:3px 0;color:#666;font-size:13px}hr{border:none;border-top:2px solid #F7941D;margin:10px 0}.ig{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:8px 0}.ir{font-size:14px;line-height:1.8}.full{grid-column:1/-1}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}th{background:#F7941D;color:white;padding:8px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #eee}.tr{text-align:right}.tc{text-align:center}tfoot td{font-weight:bold;border-top:2px solid #F7941D;border-bottom:none}.totrow td{font-size:20px;color:#F7941D;padding:8px 10px}.pagto{margin:10px 0;padding:10px 14px;border:1px solid #ddd;border-radius:6px;background:#fffbf0;font-size:14px}.parc{color:#666;font-size:12px;margin-top:6px}.ftr{margin-top:10px;padding-top:8px;border-top:1px solid #ddd;font-size:12px;color:#999;text-align:center}</style></head><body><div class="hdr"><img src="${logoBase64||'/logo.png'}" alt="Logo"/><div><h1>Depósito Oliveira</h1><p>Materiais de Construção</p><p>Av. Inocêncio Seráfico, 4020 - Centro | Carapicuíba - SP, 06380-021</p><p>Tel: (11) 4187-1801</p></div></div><hr/><div class="ig">${cod?'<div class="ir"><b>Código:</b> '+cod+'</div>':''}<div class="ir"><b>Data:</b> ${dataCriacao}</div><div class="ir"><b>Cliente:</b> ${nome}</div>${tel?'<div class="ir"><b>Telefone:</b> '+tel+'</div>':''}<div class="ir"><b>Entrega:</b> ${tipo==='entrega'?'Entrega no endereço':'Retirada na loja'}</div>${tipo==='entrega'&&end?'<div class="ir full"><b>Endereço:</b> '+end+'</div>':''}${dataEnt?'<div class="ir"><b>Data entrega:</b> '+new Date(dataEnt+'T12:00:00').toLocaleDateString('pt-BR')+'</div>':''}${dataRet?'<div class="ir"><b>Data retirada:</b> '+new Date(dataRet+'T12:00:00').toLocaleDateString('pt-BR')+'</div>':''}${(() => { const rawO = obsImp || ''; const fi = rawO.indexOf('FERRAGEM:'); const obs2 = fi >= 0 ? rawO.substring(0, fi).trim() : rawO.trim(); const ferr = fi >= 0 ? rawO.substring(fi).trim() : ''; const ferrLinhas = ferr ? ferr.replace('FERRAGEM:','').trim().split('\n').filter(Boolean) : []; let html = ''; if (obs2) html += '<div class="ir full"><b>Obs:</b> '+obs2+'</div>'; if (ferrLinhas.length > 0) html += '<div class="ir full"><b>🔩 Ferragem:</b><br>'+ferrLinhas.join('<br>')+'</div>'; return html; })()}${formaPagImp?'<div class="ir"><b>Pagamento:</b> '+(formaPagLabelImp[formaPagImp]||formaPagImp)+'</div>':''}${statusPagImp?'<div class="ir"><b>Status pag.:</b> '+(statusPagImp==='completo'?'✅ Pago':statusPagImp==='parcial'?'⚠️ Parcial':statusPagImp==='pagamento_na_entrega'?'🚚 Pgto na Entrega':statusPagImp==='pendente'?'⏳ Pendente':'')+'</div>':''}</div><table><thead><tr><th>Produto</th><th class="tc">Qtd</th><th class="tc">Un</th><th class="tr">Unit.</th><th class="tr">Total</th></tr></thead><tbody>${itensHtml}</tbody><tfoot><tr><td colspan="4" class="tr">Subtotal:</td><td class="tr">R$ ${formatBRL(sub)}</td></tr>${tipo==='entrega'&&frete>0?'<tr><td colspan="4" class="tr">Frete:</td><td class="tr">R$ '+formatBRL(frete)+'</td></tr>':''}<tr class="totrow"><td colspan="4" class="tr">TOTAL:</td><td class="tr">R$ ${formatBRL(tot)}</td></tr></tfoot></table><div class="pagto"><strong>&#128181; À vista: R$ ${formatBRL(tot)}</strong> &nbsp;|&nbsp; <strong>&#128179; Cartão (+8%): R$ ${formatBRL(valorCartaoImp)}</strong><div class="parc">${Array.from({length:MAX_PARCELAS},(_,i)=>i+1).map(n=>n+'x R$ '+formatBRL(valorCartaoImp/n)).join(' | ')}</div></div><div class="ftr">Orçamento válido por 7 dias &middot; Sujeito à disponibilidade de estoque</div></body></html>`;
    printWindow.document.write(htmlImp);
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
      if (novoStatus === 'entrega_pendente' || novoStatus === 'retirada_pendente' || novoStatus === 'cancelado') carregarProdutos();
      if (orcamentoDetalhe && orcamentoDetalhe.id === id) {
        setOrcamentoDetalhe({ ...orcamentoDetalhe, status: novoStatus });
      }
    } catch (e) { console.error('Erro ao atualizar status', e); }
  };

  const abrirDetalhe = async (id: string) => {
    setLoadingDetalhe(true);
    setMostrarDetalhe(true);
    try {
      const res = await fetch(`/api/orcamentos/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (data && !data.error) {
        setOrcamentoDetalhe({
          ...data,
          reagendamentos: data.reagendamentos ?? 0,
          orcamento_itens: data.orcamento_itens || [],
          observacoes: data.observacoes || null,
          clientes: data.clientes || null,
        });
      }
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
    setDataRetirada(detalhe.data_retirada || '');
    setFonteVenda(detalhe.fonte || '');
    if (detalhe.clientes?.endereco) setEnderecoViaCEP(detalhe.clientes.endereco);
    if (detalhe.clientes?.cep) { setCepDestino(detalhe.clientes.cep); setBuscaEndereco(detalhe.clientes.cep); }
    setNumeroEndereco(detalhe.clientes?.numero || '');
    setComplementoEndereco(detalhe.clientes?.complemento || '');
    setRecebedor(detalhe.clientes?.recebedor || '');
    setObservacoes(detalhe.observacoes || '');
    const cartItems: ItemOrcamento[] = detalhe.orcamento_itens.map((oi, idx) => {
      // Itens avulsos (ferro) têm produto_id null — restaurar como avulso
      if (oi.produto_id === null) {
        return {
          produto: {
            id: 'avulso-' + idx,
            nome: oi.produto_nome,
            preco: oi.preco_unitario,
            estoque: 999,
            unidade: oi.unidade || 'm',
            categoria: 'Ferro',
            preco_custo: 0,
            estoque_minimo: 0,
            abaixo_minimo: false,
          },
          quantidade: oi.quantidade,
          avulso: true,
          preco_custom: oi.preco_unitario,
        };
      }
      // Produto normal: busca por nome para dados atualizados
      const matchProduto = produtos.find(p => p.nome === oi.produto_nome);
      return {
        produto: {
          id: matchProduto?.id || String(oi.produto_id || ('item-' + idx)),
          nome: oi.produto_nome,
          preco: matchProduto?.preco ?? oi.preco_unitario,
          estoque: matchProduto?.estoque ?? 999,
          unidade: oi.unidade || matchProduto?.unidade || 'un',
          categoria: matchProduto?.categoria || 'Geral',
          preco_custo: matchProduto?.preco_custo ?? 0,
          estoque_minimo: matchProduto?.estoque_minimo ?? 0,
          abaixo_minimo: matchProduto?.abaixo_minimo ?? false,
        },
        quantidade: oi.quantidade,
      };
    });
    setItens(cartItems);
    setMostrarDetalhe(false);
    setOrcamentoDetalhe(null);
    setAbaAtiva('orcamento');
  };

  const excluirOrcamento = async (id: string) => {
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;
    setExcluindoId(id);
    try {
      const res = await fetch(`/api/orcamentos/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) {
        alert('Erro: ' + data.error);
      } else {
        setMostrarDetalhe(false);
        setOrcamentoDetalhe(null);
        carregarHistorico();
        if (abaAtiva === 'entregas') carregarEntregas();
      }
    } catch (e) {
      console.error('Erro ao excluir orçamento', e);
      alert('Erro ao excluir orçamento.');
    }
    setExcluindoId(null);
  };

  const excluirProduto = async (id: string) => {
    if (!confirm('Tem certeza? O produto será desativado e não aparecerá mais no catálogo.')) return;
    setExcluindoProdutoId(id);
    try {
      await fetch(`/api/produtos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: false }),
      });
      setMostrarEditProduto(false);
      setProdutoSelecionado(null);
      carregarProdutos();
    } catch (e) {
      console.error('Erro ao excluir produto', e);
    }
    setExcluindoProdutoId(null);
  };

  const atribuirMotorista = async (orcamentoId: string, motoristaId: string | null) => {
    setAtribuindoMotorista(orcamentoId);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motorista_id: motoristaId }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar motorista');
      }
      await carregarMotoristas();
      await carregarEntregas();
    } catch (e) {
      console.error('Erro ao atribuir motorista', e);
    }
    setAtribuindoMotorista(null);
    setMostrarAtribuirMotorista(false);
    setEntregaSelecionadaId(null);
  };

  const atribuirTodosMotorista = async (motoristaId: string) => {
    if (!entregasRota) return;
    const entregasSemMotorista = entregasRota.rota_otimizada.filter((e: EntregaRota & { motorista_id?: string | null }) => !e.motorista_id);
    for (const e of entregasSemMotorista) {
      await atribuirMotorista(e.id, motoristaId);
    }
  };

  const criarMotorista = async () => {
    if (!novoMotoristaNome.trim()) return;
    try {
      await fetch('/api/motoristas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoMotoristaNome, veiculo: novoMotoristaVeiculo }),
      });
      setNovoMotoristaNome('');
      setNovoMotoristaVeiculo('');
      carregarMotoristas();
    } catch (e) {
      console.error('Erro ao criar motorista', e);
    }
  };

  // Bug 1 fix - Entregas now includes em_rota status
  // ===== New Entregas UI Functions =====
  const carregarEntregasDia = async () => {
    setLoadingDia(true);
    setSelecionadas([]);
    setRotaGerada(null);
    try {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataAlvo = dataEntregas || amanha.toISOString().slice(0, 10);
      const res = await fetch('/api/entregas/rota?data=' + dataAlvo, { cache: 'no-store' });
      const data = await res.json();
      const todas: EntregaRota[] = data.entregas || [];
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente'));
      setEntregasEmRota(todas.filter(e => e.status === 'em_rota'));
      setEntregasCompletas(todas.filter(e => e.status === 'completo'));
    } catch (e) { console.error('Erro ao carregar entregas do dia', e); }
    setLoadingDia(false);
  };

  const carregarRetiradas = async () => {
    setLoadingRetiradas(true);
    try {
      const res = await fetch('/api/orcamentos?status=retirada_pendente&limite=100', { cache: 'no-store' });
      const data = await res.json();
      setRetiradas(data.orcamentos || []);
    } catch (e) { console.error('Erro ao carregar retiradas', e); }
    setLoadingRetiradas(false);
  };

  const carregarFerragens = async () => {
    setLoadingFerragens(true);
    try {
      const res = await fetch('/api/orcamentos?ferragem_status=pendente&limite=200', { cache: 'no-store' });
      const data = await res.json();
      setFerragens(data.orcamentos || []);
    } catch (e) { console.error('Erro ao carregar ferragens', e); }
    setLoadingFerragens(false);
  };

  const carregarFerragensProducao = async () => {
    setLoadingFerragensProducao(true);
    try {
      const res = await fetch('/api/orcamentos?ferragem_status=em_producao&limite=200', { cache: 'no-store' });
      const data = await res.json();
      setFerragensProducao(data.orcamentos || []);
    } catch (e) { console.error('Erro ao carregar ferragens em produção', e); }
    setLoadingFerragensProducao(false);
  };

  const gerarRota = async () => {
    if (selecionadas.length === 0) return;
    setLoadingRota(true);
    try {
      const distancias: Record<string, number | null> = {};
      for (const e of entregasDia) {
        if (selecionadas.includes(e.id)) {
          distancias[e.id] = e.distancia_km ?? null;
        }
      }
      const res = await fetch('/api/entregas/rota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selecionadas, distancias }),
        cache: 'no-store',
      });
      const data = await res.json();
      setRotaGerada(data);
      // Mark selected orders as em_rota
      await fetch('/api/entregas/rota', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selecionadas, novoStatus: 'em_rota' }),
        cache: 'no-store',
      });
      // Reload all sections
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataAlvo = dataEntregas || amanha.toISOString().slice(0, 10);
      const reloadRes = await fetch('/api/entregas/rota?data=' + dataAlvo, { cache: 'no-store' });
      const reloadData = await reloadRes.json();
      const todas: EntregaRota[] = reloadData.entregas || [];
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente'));
      setEntregasEmRota(todas.filter(e => e.status === 'em_rota'));
      setEntregasCompletas(todas.filter(e => e.status === 'completo'));
      setSelecionadas([]);
    } catch (e) { console.error('Erro ao gerar rota', e); }
    setLoadingRota(false);
  };

  const toggleSelecionada = (id: string) => {
    setSelecionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selecionarTodas = () => {
    setSelecionadas(entregasDia.map(e => e.id));
  };

  const marcarEntregue = async (id: string) => {
    setLoadingCompleto(id);
    try {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataAlvo = dataEntregas || amanha.toISOString().slice(0, 10);
      await fetch('/api/entregas/rota', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], novoStatus: 'completo' }),
        cache: 'no-store',
      });
      const reloadRes = await fetch('/api/entregas/rota?data=' + dataAlvo, { cache: 'no-store' });
      const reloadData = await reloadRes.json();
      const todas: EntregaRota[] = reloadData.entregas || [];
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente'));
      setEntregasEmRota(todas.filter(e => e.status === 'em_rota'));
      setEntregasCompletas(todas.filter(e => e.status === 'completo'));
    } catch (e) { console.error('Erro ao marcar entregue', e); }
    setLoadingCompleto(null);
  };

    const imprimirRotaDia = () => {
    if (!rotaGerada || !rotaGerada.entregas || rotaGerada.entregas.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const dataStr = (() => {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const d = dataEntregas || amanha.toISOString().slice(0, 10);
      const dt = new Date(d + 'T12:00:00');
      const diasSemana = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];
      return dt.toLocaleDateString('pt-BR') + ' - ' + diasSemana[dt.getDay()];
    })();
    const kmTotal = rotaGerada.distancia_total_km;
    const tempoMin = rotaGerada.tempo_estimado_min || rotaGerada.duracao_total_min;
    const tempoStr = tempoMin ? (tempoMin >= 60 ? Math.floor(tempoMin / 60) + 'h ' + (tempoMin % 60) + 'min' : tempoMin + ' min') : '';
    let html = `<!DOCTYPE html><html><head><title>Rota ${dataStr}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:15px;color:#333;font-size:13px}h1{font-size:18px;margin-bottom:2px}.header{border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}.stats{display:flex;gap:16px;margin:8px 0;flex-wrap:wrap}.stat{background:#f5f5f5;border-radius:6px;padding:6px 12px;text-align:center}.stat-label{font-size:11px;color:#666}.stat-value{font-weight:bold;font-size:15px}.entrega{border:1px solid #ccc;border-radius:4px;padding:10px;margin-bottom:10px;page-break-inside:avoid}.parada-num{display:inline-block;background:#333;color:white;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:bold;font-size:12px;margin-right:8px}.check-area{float:right;border:1px solid #999;width:100px;height:40px;border-radius:4px;text-align:center;line-height:40px;color:#999;font-size:11px}.itens{margin:6px 0;padding:6px 8px;border-top:2px solid #f0a04b;border-bottom:1px solid #ddd;font-size:12px;color:#222;background:#fffbf5;border-radius:3px}.itens-label{font-weight:bold;color:#c45e00;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}@media print{body{padding:5px}.entrega{margin-bottom:6px;padding:6px}}</style></head><body>`;
    html += `<div class="header"><h1>🚚 Rota de Entregas - Depósito Oliveira</h1><p style="margin:2px 0;color:#555;font-size:12px">Av. Inocêncio Seráfico, 4020 - Carapicuíba/SP | Tel: (11) 4187-1801</p><p style="margin:4px 0;font-size:13px"><strong>${dataStr}</strong></p><div class="stats"><div class="stat"><div class="stat-label">Paradas</div><div class="stat-value">${rotaGerada.entregas.length}</div></div>${kmTotal ? '<div class="stat"><div class="stat-label">Distância total</div><div class="stat-value">' + kmTotal.toFixed(1) + ' km</div></div>' : ''}${tempoStr ? '<div class="stat"><div class="stat-label">Tempo estimado</div><div class="stat-value">' + tempoStr + '</div></div>' : ''}</div></div>`;
    (rotaGerada.entregas || []).forEach((e, idx) => {
            const endCompleto = (e.endereco + (e.numero ? ', nº ' + e.numero : '')).trim();
      html += `<div class="entrega"><div class="check-area">☐ Entregue</div><span class="parada-num">${idx + 1}</span><strong>${e.cliente_nome}</strong>`;
      if (e.cliente_telefone) html += ` — ${e.cliente_telefone}`;
      html += `<br/><span style="color:#555">${endCompleto}</span>`;
      if (e.recebedor) html += `<br/><em style="font-size:12px">Recebedor: ${e.recebedor}</em>`;
      html += `<div class="itens"><div class="itens-label">📦 Itens para carregar:</div>${e.itens_resumo || '<em style="color:#aaa">Nenhum item registrado</em>'}</div>`;
      html += `<div style="display:flex;justify-content:space-between;margin-top:4px"><span>Valor: <strong>R$ ${(e.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></span><span style="color:#888;font-size:12px">${e.codigo}</span></div>`;
      if (e.observacoes) html += `<div style="color:#666;font-style:italic;font-size:12px;margin-top:2px">Obs: ${e.observacoes}</div>`;
      html += `</div>`;
    });
    html += `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:12px;text-align:center"><strong>Depósito Oliveira</strong> — Materiais de Construção<br>Av. Inocêncio Seráfico, 4020 - Centro, Carapicuíba - SP, 06380-021 — Tel: (11) 4187-1801</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

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

  const entregasFiltradas = entregasRota ? {
    ...entregasRota,
    rota_otimizada: entregasRota.rota_otimizada.filter((e: EntregaRota & { motorista_id?: string | null }) => {
      if (filtroMotorista === 'todos') return true;
      if (filtroMotorista === 'nenhum') return !e.motorista_id;
      return e.motorista_id === filtroMotorista;
    }),
  } : null;

  // Feature 5 - Print routes for driver
  const imprimirRotas = () => {
    const rotaParaImprimir = entregasFiltradas || entregasRota;
    if (!rotaParaImprimir || rotaParaImprimir.rota_otimizada.length === 0) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const dataStr = rotaParaImprimir.data ? new Date(rotaParaImprimir.data + 'T12:00:00').toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
    const motoristaAtual = motoristas.find(m => m.id === filtroMotorista);
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
    html += `<div class="header"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><img src="` + (logoBase64 || '/logo.png') + `" alt="Logo" style="height:50px;width:auto;border-radius:4px" /><div><h1 style="margin:0;font-size:18px">🚚 Rotas de Entrega - Depósito Oliveira</h1><p style="margin:2px 0;font-size:11px;color:#555">Av. Inocêncio Seráfico, 4020 - Carapicuíba/SP | Tel: (11) 4187-1801</p></div></div><p style="margin:2px 0;color:#666">${dataStr}${motoristaAtual ? ' — ' + motoristaAtual.nome + (motoristaAtual.veiculo ? ' (' + motoristaAtual.veiculo + ')' : '') : ''}</p><div class="stats"><div>${rotaParaImprimir.total_entregas} paradas</div><div>${rotaParaImprimir.distancia_total_km} km</div><div>~${rotaParaImprimir.duracao_total_min} min</div></div></div>`;
    rotaParaImprimir.rota_otimizada.forEach((e, idx) => {
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
    html += `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:12px;text-align:center"><strong>Depósito Oliveira</strong> — Materiais de Construção<br>Av. Inocêncio Seráfico, 4020 - Centro, Carapicuíba - SP, 06380-021 — Tel: (11) 4187-1801</div></body></html>`;
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

  async function enviarPerguntaIA(pergunta?: string, tipo?: string) {
    const textoEnviar = pergunta || inputIA;
    if (!textoEnviar && !tipo) return;
    setCarregandoIA(true);
    const labels = {
      resumo_dia: '📊 Resumo do Dia',
      relatorio_semanal: '📈 Relatório Semanal',
      analise_clientes: '👥 Análise de Clientes',
      previsao_estoque: '📦 Previsão de Estoque',
    };
    const msgUsuario = textoEnviar || (tipo ? (labels[tipo as keyof typeof labels] || tipo) : '');
    setMensagensIA(prev => [...prev, { role: 'user', content: msgUsuario }]);
    setInputIA('');
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: msgUsuario, tipo }),
      });
      const json = await res.json();
      const conteudo = json.resposta || (json.error ? 'Erro: ' + json.error : 'Sem resposta.');
      setMensagensIA(prev => [...prev, { role: 'assistant', content: conteudo }]);
    } catch {
      setMensagensIA(prev => [...prev, { role: 'assistant', content: 'Erro ao conectar com a IA.' }]);
    } finally {
      setCarregandoIA(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#F7941D] mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando produtos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#E8850A] text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Depósito Oliveira" className="h-10 w-auto" style={{borderRadius:'4px'}} />
            <div>
              <h1 className="text-2xl font-bold">Depósito Oliveira</h1>
              <p className="text-white/80 text-sm">Sistema de Orçamentos</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setAbaAtiva('estoque')} className="bg-[#F7941D] text-white text-sm px-3 py-2 rounded-lg hover:bg-[#F7941D] transition">📦 Estoque</button>
            <button onClick={() => setAbaAtiva('entregas')} className="bg-[#F7941D] text-white text-sm px-3 py-2 rounded-lg hover:bg-[#F7941D] transition">🚚 Entregas</button>
            <button onClick={() => setAbaAtiva('historico')} className="bg-[#F7941D] text-white text-sm px-3 py-2 rounded-lg hover:bg-[#F7941D] transition">Histórico</button>
            <button onClick={() => setAbaAtiva('ia')} className="bg-[#F7941D] text-white text-sm px-3 py-2 rounded-lg hover:bg-[#F7941D] transition">🤖 IA</button>
            <button onClick={() => setAbaAtiva('orcamento')} className="relative bg-white text-[#F7941D] font-bold px-4 py-2 rounded-lg hover:bg-[#FFF3E0] transition">
              Orçamento
              {itens.length > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{itens.reduce((a, i) => a + i.quantidade, 0)}</span>}
            </button>
          <button onClick={() => {
            if (itens.length > 0) {
              if (!confirm('Você tem um orçamento em andamento. Descartar e começar novo?')) return;
              setItens([]);
            }
            setClienteNomeNovo('');
            setClienteTelefoneNovo('');
            setClienteNotasNovo('');
            setClienteNumeroNovo('');
            setClienteEncontrado(null);
            setModalClienteAberto(true);
            setAbaAtiva('produtos');
          }}
            className="bg-green-500 text-white text-sm px-3 py-2 rounded-lg font-semibold hover:bg-green-600 transition whitespace-nowrap"
          >
            ➕ Novo Orçamento
          </button>
          </div>
          <div className="flex items-center gap-2 ml-4 pl-4 border-l border-white/30">
            {papelUsuario && <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full capitalize">{papelUsuario}</span>}
            <button onClick={handleSignOut} className="text-xs bg-white text-[#F7941D] font-semibold px-3 py-1.5 rounded-lg hover:bg-orange-50 transition">Sair</button>
          </div>
        </div>
      </header>

      

      <div className="max-w-6xl mx-auto px-4 pt-4 print:hidden">
        <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
          {(abasVisiveis as Array<'produtos' | 'orcamento' | 'historico' | 'entregas' | 'estoque' | 'ferragens' | 'dashboard'>).map(aba => (
            <button key={aba} onClick={() => setAbaAtiva(aba)}
              className={`px-4 py-3 font-medium text-sm whitespace-nowrap capitalize ${abaAtiva === aba ? 'border-b-2 border-[#F7941D] text-[#F7941D]' : 'text-gray-500 hover:text-gray-700'}`}>
              {aba === 'produtos' ? 'Catálogo' : aba === 'orcamento' ? `Orçamento (${itens.reduce((a, i) => a + i.quantidade, 0)})` : aba === 'historico' ? 'Histórico' : aba === 'entregas' ? '🚚 Entregas' : aba === 'ferragens' ? '🔧 Ferragens' : aba === 'dashboard' ? '📊 Dashboard' : '📦 Estoque'}
            </button>
          ))}
        </div>

        {/* ===== CATALOGO TAB ===== */}
        {abaAtiva === 'produtos' && (
    <>
      {modalClienteAberto && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'16px',overflowY:'auto'}}>
          <div style={{background:'white',borderRadius:'12px',width:'100%',maxWidth:'500px',marginTop:'20px'}}>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-2">➕ Novo Orçamento</h2>
            <p className="text-sm text-gray-500 mb-6">Preencha os dados do cliente antes de selecionar os produtos</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">📱 Número do cliente</label>
                <div className="relative">
                  <input
                    type="tel"
                    placeholder="Digite o número para buscar cadastro..."
                    value={clienteNumeroNovo}
                    onChange={e => {
                      const v = e.target.value;
                      setClienteNumeroNovo(v);
                      const digits = v.replace(/D/g,'');
                      if (digits.length >= 8) {
                        setClienteBuscandoNum(true);
                        setClienteEncontrado(null);
                        clearTimeout((window as typeof window & {_clienteTimer?: ReturnType<typeof setTimeout>})._clienteTimer);
                        (window as typeof window & {_clienteTimer?: ReturnType<typeof setTimeout>})._clienteTimer = setTimeout(async () => {
                          try {
                            const res = await fetch(`/api/clientes?busca=${encodeURIComponent(digits)}&limite=1`);
                            const data = await res.json();
                            if (data.clientes && data.clientes.length > 0) {
                              const cli = data.clientes[0];
                              setClienteEncontrado(cli);
                              setClienteNomeNovo(cli.nome);
                              setClienteTelefoneNovo(cli.telefone);
                            } else {
                              setClienteEncontrado(null);
                            }
                          } catch {}
                          setClienteBuscandoNum(false);
                        }, 400);
                      } else {
                        setClienteEncontrado(null);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F7941D] text-sm"
                  />
                  {clienteBuscandoNum && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Buscando...</span>}
                </div>
                {clienteEncontrado && (
                  <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                    ✅ Cliente encontrado: <strong>{clienteEncontrado.nome}</strong>
                    {clienteEncontrado.endereco && <span> — {clienteEncontrado.endereco}{clienteEncontrado.numero ? `, ${clienteEncontrado.numero}` : ''}</span>}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do cliente *</label>
                <input
                  type="text"
                  placeholder="Nome completo"
                  value={clienteNomeNovo}
                  onChange={e => setClienteNomeNovo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F7941D] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone *</label>
                <input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={clienteTelefoneNovo}
                  onChange={e => setClienteTelefoneNovo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F7941D] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas / Especificações do pedido</label>
                <textarea
                  placeholder="Anote os detalhes do pedido (ex: 2 sapatas 20x20, 3 vigas de 4m, ferro 3/8 para coluna...)"
                  value={clienteNotasNovo}
                  onChange={e => setClienteNotasNovo(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F7941D] text-sm resize-none"
                />
              </div>
              <button
                onClick={async () => {
                  if (!clienteNomeNovo.trim() || !clienteTelefoneNovo.trim()) {
                    alert('Nome e telefone são obrigatórios');
                    return;
                  }
                  setNomeCliente(clienteNomeNovo);
                  setWhatsappCliente(clienteTelefoneNovo);
                  if (clienteNotasNovo.trim()) setObservacoes(clienteNotasNovo);
                  // Preencher endereço do cliente encontrado
                  if (clienteEncontrado) {
                    if (clienteEncontrado.endereco) {
                      const endCompleto = [
                        clienteEncontrado.endereco,
                        clienteEncontrado.bairro,
                        clienteEncontrado.cidade,
                        clienteEncontrado.estado
                      ].filter(Boolean).join(', ');
                      setBuscaEndereco(endCompleto);
                      setTipoEntrega('entrega');
                    }
                    if (clienteEncontrado.numero) setNumeroEndereco(clienteEncontrado.numero);
                    if (clienteEncontrado.complemento) setComplementoEndereco(clienteEncontrado.complemento);
                    if (clienteEncontrado.recebedor) setRecebedor(clienteEncontrado.recebedor);
                    if (clienteEncontrado.cep) {
                      const cepLimpo = clienteEncontrado.cep.replace(/D/g,'');
                      setCepDestino(cepLimpo);
                      setTipoEntrega('entrega');
                      // Calcular frete automaticamente
                      setCalculandoFrete(true);
                      setErroFrete('');
                      setDadosFrete(null);
                      try {
                        const freteRes = await fetch('/api/frete', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ cep: cepLimpo }),
                        });
                        const freteData = await freteRes.json();
                        if (!freteData.error && freteData.dentro_area) {
                          setDadosFrete(freteData);
                          if (freteData.endereco_completo) setEnderecoViaCEP(freteData.endereco_completo);
                        } else if (freteData.error) {
                          setErroFrete(freteData.error);
                        }
                      } catch {}
                      setCalculandoFrete(false);
                    }
                  }
                  setModalClienteAberto(false);
                }}
                disabled={!clienteNomeNovo.trim() || !clienteTelefoneNovo.trim()}
                className="w-full bg-[#F7941D] text-white py-3 rounded-xl font-bold hover:bg-[#E8850A] transition disabled:opacity-50 text-base"
              >
                Continuar para Produtos ?
              </button>
              <button
                onClick={() => setModalClienteAberto(false)}
                className="w-full bg-gray-200 text-gray-700 py-2 rounded-xl hover:bg-gray-300 transition text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>)}
          <div>
            {etapaOrcamento === 'produtos' && clienteNomeNovo && (
            <div className="bg-[#FFF3E0] border border-[#F7941D] rounded-xl p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="text-sm font-bold text-[#F7941D]">📋 Orçamento para: {clienteNomeNovo}</span>
                <span className="text-xs text-gray-600 ml-3">{clienteTelefoneNovo}</span>
              </div>
              {clienteNotasNovo && (
                <button onClick={() => setMostrarNotasColapsado(!mostrarNotasColapsado)}
                  className="text-xs text-[#F7941D] underline">
                  {mostrarNotasColapsado ? '? Ver notas' : '? Ocultar notas'}
                </button>
              )}
              {clienteNotasNovo && !mostrarNotasColapsado && (
                <div className="w-full bg-yellow-50 rounded p-2 text-xs text-gray-700 whitespace-pre-wrap">{clienteNotasNovo}</div>
              )}
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input type="text" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              <select value={categoriaSelecionada} onChange={e => setCategoriaSelecionada(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <button
                onClick={() => setShowCalculadoraFerro(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm"
              >
                <span>&#x1F527;</span> Calculadora de Ferro
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-8">
              {produtosFiltrados.map(produto => {
                const qtd = getQuantidade(produto.id);
                const stepVal = produto.unidade === 'm³' ? 0.5 : 1;
                return (
                  <div key={produto.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition">
                    <div className="mb-2"><span className="text-xs bg-[#FFF3E0] text-[#F7941D] px-2 py-0.5 rounded-full">{produto.categoria}</span></div>
                    <h3 className="font-semibold text-gray-800 text-sm mb-1 min-h-[40px]">{produto.nome}</h3>
                    <p className="text-[#F7941D] font-bold text-lg mb-1">R$ {formatBRL(produto.preco)}<span className="text-xs text-gray-400 font-normal">/{produto.unidade}</span></p>
                    <p className={`text-xs mb-3 ${produto.estoque <= 0 ? 'text-red-600 font-bold' : produto.abaixo_minimo ? 'text-red-500 font-medium' : produto.estoque <= produto.estoque_minimo * 2 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {produto.estoque >= 999 ? '📦 Sob demanda' : produto.estoque <= 0 ? '⛔ Sem estoque' : `${produto.abaixo_minimo ? '⚠️ ' : produto.estoque <= produto.estoque_minimo * 2 ? '🟡 ' : '🟢 '}Estoque: ${produto.estoque} ${produto.unidade === 'm³' ? 'm³' : (produto.estoque !== 1 ? produto.unidade + 's' : produto.unidade)}`}
                  </p>
                    {qtd === 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <button onClick={() => adicionarItem(produto)} className="w-full bg-[#F7941D] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#E8850A] transition">+ Adicionar</button>
                        {isMeioM3Produto(produto) && (
                          <button onClick={() => adicionarMeioMetro(produto)} className="w-full bg-amber-100 text-amber-800 border border-amber-300 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-200 transition">½ m³ · R$120</button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-[#FFF3E0] rounded-lg p-1">
                        <button onClick={() => removerItem(produto.id)} className="w-8 h-8 bg-[#F7941D] text-white rounded-md font-bold hover:bg-[#E8850A] transition">-</button>
                        <input type="number" value={qtd} min={0} step={stepVal}
                          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setQuantidade(produto.id, v); }}
                          className="w-16 text-center font-bold text-[#F7941D] text-lg bg-transparent border-none focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <button onClick={() => adicionarItem(produto)} className="w-8 h-8 bg-[#F7941D] text-white rounded-md font-bold hover:bg-[#E8850A] transition">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {produtosFiltrados.length === 0 && <div className="col-span-4 text-center py-12 text-gray-400">Nenhum produto encontrado.</div>}
            </div>
          </div>
    </>
)}

        {/* ===== ORCAMENTO TAB ===== */}
        {abaAtiva === 'orcamento' && (
          <div className="max-w-2xl mx-auto pb-8">
            {itens.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-5xl mb-4">🛒</p>
                <p className="text-lg">Seu orçamento está vazio</p>
                <button onClick={() => setAbaAtiva('produtos')} className="mt-4 bg-[#F7941D] text-white px-6 py-2 rounded-lg hover:bg-[#E8850A] transition">Ver Produtos</button>
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
                    const stepVal = item.produto.unidade === 'm³' ? 0.5 : 1;
                    return (
                      <div key={item.produto.id} className="flex items-center gap-3 p-4 border-b border-gray-50 last:border-0">
                        <div className="flex-1">
                          <p className="font-medium text-gray-800 text-sm">{item.produto.nome}</p>
                          <p className="text-xs text-gray-500">R$ {formatBRL(item.preco_custom ?? item.produto.preco)}/{item.produto.unidade}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => removerItem(item.produto.id)} className="w-7 h-7 bg-red-100 text-red-600 rounded font-bold hover:bg-red-200 transition text-sm">-</button>
                          <input type="number" value={item.quantidade} min={0} step={stepVal}
                            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setQuantidade(item.produto.id, v); }}
                            className="w-16 text-center font-bold border border-gray-200 rounded px-1 py-1 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => adicionarItem(item.produto)} className="w-7 h-7 bg-green-100 text-green-600 rounded font-bold hover:bg-green-200 transition text-sm">+</button>
                        </div>
                        <p className="w-24 text-right font-bold text-[#F7941D] text-sm">R$ {formatBRL((item.preco_custom ?? item.produto.preco) * item.quantidade)}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Dados do Cliente</h2>
                  <div className="space-y-3">
                    <input type="text" placeholder="Nome do cliente" value={nomeCliente} onChange={e => setNomeCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                    <input type="tel" placeholder="WhatsApp (ex: 11999998888)" value={whatsappCliente} onChange={e => setWhatsappCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Forma de Entrega</h2>
                  <div className="flex gap-3 mb-4">
                    {(['retirada', 'entrega'] as const).map(tipo => (
                      <button key={tipo} onClick={() => setTipoEntrega(tipo)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${tipoEntrega === tipo ? 'border-[#F7941D] bg-[#FFF3E0] text-[#F7941D]' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        {tipo === 'retirada' ? 'Retirar na Loja' : 'Entrega no Endereço'}
                      </button>
                    ))}
                  </div>
                  {tipoEntrega === 'entrega' && (
                    <div className="space-y-3">
                      {/* Unified smart address field - detects CEP vs street */}
                    <div className="relative flex gap-2">
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
                        // Debounce autocomplete
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        if (val.length >= 3 && !/^\d{8}$/.test(val.replace(/\D/g, ''))) {
                          debounceRef.current = setTimeout(async () => {
                            try {
                              const res = await fetch(`/api/endereco?type=autocomplete&q=${encodeURIComponent(val)}`, { cache: 'no-store' });
                              const data = await res.json();
                              const mapped = (data.suggestions || []).map((s: {place_id: string; descricao: string}) => ({ place_id: s.place_id, description: s.descricao }));
                              setSugestoesEndereco(mapped);
                              setMostrandoSugestoes(mapped.length > 0);
                            } catch {}
                          }, 300);
                        } else {
                          setSugestoesEndereco([]);
                          setMostrandoSugestoes(false);
                        }
                        }}
                        onKeyDown={e => e.key === 'Enter' && buscarEnderecoSmart(buscaEndereco || cepDestino)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                      />
                    {mostrandoSugestoes && sugestoesEndereco.length > 0 && (
                      <ul className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {sugestoesEndereco.map(s => (
                          <li key={s.place_id}
                            className="px-3 py-2 text-sm hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0"
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/endereco?type=details&place_id=${s.place_id}`, { cache: 'no-store' });
                                const data = await res.json();
                                if (data.logradouro) setEnderecoViaCEP(data.logradouro + (data.bairro ? ', ' + data.bairro : '') + (data.cidade ? ', ' + data.cidade + '-' + data.estado : ''));
                                if (data.cep) setCepDestino(data.cep);
                                setBuscaEndereco(s.description);
                                if (data.cep) {
                                  setCalculandoFrete(true);
                                  fetch('/api/frete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cep: data.cep }), cache: 'no-store' })
                                    .then(r => r.json()).then(fd => { if (!fd.error && fd.dentro_area) { setDadosFrete(fd); if (fd.endereco_completo) setEnderecoViaCEP(fd.endereco_completo); } }).catch(() => {}).finally(() => setCalculandoFrete(false));
                                }
                              } catch {}
                              setMostrandoSugestoes(false);
                              setSugestoesEndereco([]);
                            }}
                          >📍 {s.description}</li>
                        ))}
                      </ul>
                    )}
                      <button
                        onClick={() => buscarEnderecoSmart(buscaEndereco || cepDestino)}
                        disabled={calculandoFrete || buscandoEndereco}
                        className="bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#E8850A] transition disabled:opacity-50"
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
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                        <input type="text" placeholder="Complemento (opcional)" value={complementoEndereco} onChange={e => setComplementoEndereco(e.target.value)}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                      </div>
                      <input type="text" placeholder="Quem vai receber? (opcional)" value={recebedor} onChange={e => setRecebedor(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Data de entrega</label>
                        <input type="date" value={dataEntrega} min={todayStr} onChange={e => setDataEntrega(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                      </div>
                    </div>
                  )}
          {tipoEntrega === 'retirada' && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">📅 Data de retirada</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                value={dataRetirada}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setDataRetirada(e.target.value)}
              />
            </div>
          )}
                </div>

                <div className="bg-[#E8850A] text-white rounded-xl p-4">
                  <div className="flex justify-between mb-1"><span className="text-white/80 text-sm">Subtotal:</span><span className="font-medium">R$ {formatBRL(subtotal)}</span></div>
                  {tipoEntrega === 'entrega' && dadosFrete && dadosFrete.frete && dadosFrete.frete > 0 && <div className="flex justify-between mb-1"><span className="text-white/80 text-sm">Frete ({dadosFrete.distancia_km}km):</span><span className="font-medium">R$ {formatBRL(dadosFrete.frete)}</span></div>}
                  {tipoEntrega === 'entrega' && dadosFrete && dadosFrete.frete === 0 && <div className="flex justify-between mb-1"><span className="text-white/80 text-sm">Frete:</span><span className="font-medium text-green-300">Grátis!</span></div>}
                  <div className="flex justify-between mt-2 pt-2 border-t border-[#F7941D]"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-xl">R$ {formatBRL(total)}</span></div>
                </div>
              {/* Card pricing */}
              {(() => {
                const valorCartao = total * (1 + ACRESCIMO_CARTAO);
                return (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <div className="flex justify-between text-gray-600 mb-1"><span>💵 À vista:</span><span className="font-bold text-gray-800">R$ {formatBRL(total)}</span></div>
                    <div className="flex justify-between text-gray-600 mb-1"><span>💳 No cartão (+8%):</span><span className="font-bold text-orange-600">R$ {formatBRL(valorCartao)}</span></div>
                    <div className="flex flex-wrap gap-1 mt-1">{Array.from({length: MAX_PARCELAS}, (_, i) => i + 1).map(n => (<span key={n} className="text-xs bg-orange-50 border border-orange-200 rounded px-2 py-0.5 text-orange-700">{n}x R$ {formatBRL(valorCartao / n)}</span>))}</div>
                  </div>
                );
              })()}
                {/* Observações field */}
              <textarea
                placeholder="Observações (ex: ligar antes de entregar, horário preferido...)"
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] resize-none"
              />
              {editandoId && (
                <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded-xl mb-2 text-sm font-medium flex justify-between items-center">
                  <span>✏️ Editando orçamento {orcamentos.find(o => o.id === editandoId)?.codigo || editandoId}</span>
                  <button type="button" onClick={() => { setEditandoId(null); setItens([]); setNomeCliente(''); setWhatsappCliente(''); setObservacoes(''); }} className="text-yellow-700 hover:text-yellow-900 font-bold ml-2">✕ Cancelar</button>
                </div>
              )}
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
              <input type="text" placeholder="Buscar por código, nome, telefone ou número..." value={buscaHistorico}
                onChange={e => setBuscaHistorico(e.target.value)} onKeyDown={e => e.key === 'Enter' && carregarHistorico()}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]">
                <option value="">Todos os status</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={carregarHistorico} className="bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#E8850A] transition">Buscar</button>
            </div>
            {loadingHistorico ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F7941D]"></div></div>
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
                            <span className="font-bold text-[#F7941D]">{orc.codigo}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[orc.status] || 'bg-gray-100 text-gray-600'}`}>
                              {STATUS_LABELS[orc.status] || orc.status}
                            </span>
                            {orc.status_pagamento && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PAGAMENTO_COLORS[orc.status_pagamento] || 'bg-gray-100 text-gray-600'}`}>
                                {STATUS_PAGAMENTO_LABELS[orc.status_pagamento] || orc.status_pagamento}
                              </span>
                            )}
                            {orc.forma_pagamento && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                                {orc.forma_pagamento === 'cartao' ? '💳 Cartão' : orc.forma_pagamento === 'credito' ? '💳 Crédito' : orc.forma_pagamento === 'debito' ? '💳 Débito' : orc.forma_pagamento === 'pix' ? '📱 Pix' : orc.forma_pagamento === 'dinheiro' ? '💵 Dinheiro' : orc.forma_pagamento === 'boleto' ? '📄 Boleto' : orc.forma_pagamento === 'pagamento_na_entrega' ? '🚚 Pgto Entrega' : orc.forma_pagamento}
                              </span>
                            )}
                            
                          </div>
                          <p className="text-sm font-medium text-gray-800">{orc.clientes?.nome || 'Cliente'}</p>
                          <p className="text-xs text-gray-500">{orc.clientes?.telefone || ''} {orc.clientes?.cidade ? `• ${orc.clientes.cidade}-${orc.clientes.estado}` : ''}</p>
                          <p className="text-xs text-gray-400 mt-1">{new Date(orc.criado_em).toLocaleDateString('pt-BR')} {new Date(orc.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                          {(orc.tipo_entrega === 'entrega' && orc.data_entrega) && (
                            <p className="text-xs text-blue-600 mt-1">🚛 Entrega: {new Date(orc.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}{orc.clientes?.endereco ? ' · ' + orc.clientes.endereco + (orc.clientes.numero ? ', ' + orc.clientes.numero : '') + (orc.clientes.bairro ? ' — ' + orc.clientes.bairro : '') : ''}</p>
                          )}
                          {(orc.tipo_entrega === 'retirada' && orc.data_retirada) && (
                            <p className="text-xs text-green-600 mt-1">🏪 Retirada: {new Date(orc.data_retirada + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                          )}
                          {orc.resumo_itens && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">📦 {orc.resumo_itens}</p>
                          )}
                          {orc.clientes?.recebedor && (
                            <p className="text-xs text-gray-500 mt-0.5">👤 Recebedor: {orc.clientes.recebedor}</p>
                          )}
                          {orc.motorista_nome && (
                            <p className="text-xs text-gray-500 mt-0.5">🚗 {orc.motorista_nome}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-800">R$ {formatBRL(orc.total)}</p>
                          <p className="text-xs text-gray-500 mb-2">{orc.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}</p>
                          <select value={orc.status} onClick={e => e.stopPropagation()} onChange={e => atualizarStatusOrcamento(orc.id, e.target.value, orc.status)}
                            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#F7941D] bg-white">
                            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Paginacao */}
                {totalOrcamentos > 20 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => setPaginaHistorico(p => Math.max(1, p - 1))}
                      disabled={paginaHistorico <= 1 || loadingHistorico}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                    >
                      ← Anterior
                    </button>
                    <span className="text-sm text-gray-500">
                      Página {paginaHistorico} de {Math.ceil(totalOrcamentos / 20)}
                    </span>
                    <button
                      onClick={() => setPaginaHistorico(p => p + 1)}
                      disabled={paginaHistorico >= Math.ceil(totalOrcamentos / 20) || loadingHistorico}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                    >
                      Próxima →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== ENTREGAS TAB ===== */}
        {abaAtiva === 'entregas' && (
          <div className="pb-8 space-y-6">

            {/* === SECTION 0: RETIRADAS PENDENTES === */}
            <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-purple-700">🏪 Retiradas Pendentes {!loadingRetiradas && retiradas.length > 0 && <span className="ml-1 text-sm font-normal text-purple-500">({retiradas.length})</span>}</h2>
                <button onClick={carregarRetiradas} disabled={loadingRetiradas} className="text-xs text-purple-600 hover:text-purple-800 px-2 py-1 rounded hover:bg-purple-50 border border-purple-200">
                  {loadingRetiradas ? 'Carregando...' : '↻ Atualizar'}
                </button>
              </div>
              {loadingRetiradas && <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div></div>}
              {!loadingRetiradas && retiradas.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma retirada pendente</p>
              )}
              {!loadingRetiradas && retiradas.length > 0 && (
                <div className="space-y-3">
                  {retiradas.map(r => (
                    <div key={r.id} className="border border-purple-100 rounded-lg bg-purple-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 text-sm">{r.clientes?.nome || 'Cliente'} {r.clientes?.telefone && <span className="text-gray-500 font-normal text-xs">— {r.clientes.telefone}</span>}</p>
                          <p className="text-xs text-purple-600 font-mono">{r.codigo}</p>
                        </div>
                        <p className="font-bold text-gray-800 text-sm shrink-0">R$ {(r.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                      </div>
                      {r.resumo_itens && <p className="text-xs text-gray-600 mb-1">📦 {r.resumo_itens}</p>}
                      {(r as any).data_retirada && <p className="text-xs text-gray-500 mb-1">📅 Retirada: {new Date((r as any).data_retirada + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                      {(r.forma_pagamento || r.status_pagamento) && (
                        <p className="text-xs text-gray-500 mb-2">
                          {r.forma_pagamento && <span>💳 {r.forma_pagamento.charAt(0).toUpperCase() + r.forma_pagamento.slice(1).replace('_', ' ')}</span>}
                          {r.status_pagamento === 'completo' && <span className="ml-1 text-green-600 font-medium">— ✅ Pago</span>}
                          {r.status_pagamento === 'parcial' && <span className="ml-1 text-orange-600 font-medium">— ⚠️ Parcial</span>}
                        </p>
                      )}
                      <button
                        onClick={async () => {
                          setMarcandoRetirado(r.id);
                          try {
                            await fetch(`/api/orcamentos/${r.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'completo', _previous_status: 'retirada_pendente' }),
                              cache: 'no-store',
                            });
                            await carregarRetiradas();
                          } catch (e) { console.error('Erro ao marcar retirado', e); }
                          setMarcandoRetirado(null);
                        }}
                        disabled={marcandoRetirado === r.id}
                        className="w-full bg-purple-600 text-white text-xs font-bold py-1.5 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                      >
                        {marcandoRetirado === r.id ? 'Marcando...' : '✅ Marcar Retirado'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* === SECTION 1: PENDENTES === */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h2 className="font-bold text-gray-700 mb-4">Entregas Pendentes do Dia</h2>

              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <input
                  type="date"
                  value={dataEntregas || (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()}
                  onChange={e => setDataEntregas(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                />
                <button
                  onClick={carregarEntregasDia}
                  disabled={loadingDia}
                  className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 whitespace-nowrap"
                >
                  {loadingDia ? 'Carregando...' : 'Carregar Entregas'}
                </button>
              </div>

              {entregasDia.length > 0 && (
                <div className="mb-3 flex gap-3 items-center">
                  <button onClick={selecionarTodas} className="text-xs text-orange-600 hover:underline">
                    Selecionar todas ({entregasDia.length})
                  </button>
                  {selecionadas.length > 0 && (
                    <span className="text-xs text-gray-500">{selecionadas.length} selecionada(s)</span>
                  )}
                </div>
              )}

              {entregasDia.length > 0 && (
                <div className="space-y-2 mb-4">
                  {entregasDia.map((e, idx) => (
                    <div key={e.id} className="border border-gray-200 rounded-lg text-sm overflow-hidden">
                      <div
                        className="p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleSelecionada(e.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selecionadas.includes(e.id)}
                          onChange={() => toggleSelecionada(e.id)}
                          className="mt-0.5 w-4 h-4 accent-orange-500"
                          onClick={ev => ev.stopPropagation()}
                        />
                        <span className="text-gray-400 text-xs mt-0.5 w-5 text-center shrink-0">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{e.cliente_nome}</p>
                          <p className="text-gray-600 text-xs truncate">{e.endereco}{e.numero ? ', ' + e.numero : ''}{e.bairro ? ' - ' + e.bairro : ''}</p>
                          {e.distancia_km != null && <p className="text-gray-400 text-xs">{e.distancia_km.toFixed(1)} km do depósito</p>}
                        </div>
                        <button
                          onClick={ev => { ev.stopPropagation(); setExpandedDia(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id]); }}
                          className="shrink-0 text-xs text-orange-500 hover:text-orange-700 px-2 py-1 rounded hover:bg-orange-50 whitespace-nowrap"
                        >
                          {expandedDia.includes(e.id) ? '▲ Fechar' : '📦 Ver pedido'}
                        </button>
                      </div>
                      {expandedDia.includes(e.id) && (
                        <div className="border-t border-gray-100 bg-orange-50 px-4 py-3 text-xs space-y-1">
                          {e.itens_resumo && (
                            <div>
                              <span className="font-semibold text-gray-700">📦 Itens: </span>
                              <span className="text-gray-700">{e.itens_resumo}</span>
                            </div>
                          )}
                          <div className="flex gap-4 flex-wrap mt-1">
                            <span><span className="font-semibold text-gray-600">Código:</span> <span className="text-orange-700 font-mono">{e.codigo}</span></span>
                            <span><span className="font-semibold text-gray-600">Total:</span> <span className="font-bold text-gray-800">R$ {(e.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span></span>
                            {e.cliente_telefone && <span><span className="font-semibold text-gray-600">Tel:</span> <a href={'tel:' + e.cliente_telefone} className="text-blue-600" onClick={ev => ev.stopPropagation()}>{e.cliente_telefone}</a></span>}
                            {e.recebedor && <span><span className="font-semibold text-gray-600">Recebedor:</span> {e.recebedor}</span>}
                          </div>
                          {e.observacoes && <p className="text-gray-500 italic mt-1">Obs: {e.observacoes}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {entregasDia.length === 0 && !loadingDia && (
                <div className="text-center py-8 text-gray-400">
                  <p className="mb-1">Nenhuma entrega pendente para a data selecionada</p>
                  <p className="text-xs">Selecione uma data e clique em Carregar Entregas</p>
                </div>
              )}

              {selecionadas.length > 0 && (
                <button
                  onClick={gerarRota}
                  disabled={loadingRota}
                  className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 mb-3"
                >
                  {loadingRota ? 'Gerando rota...' : 'Gerar Rota (' + selecionadas.length + ' entregas)'}
                </button>
              )}

              {rotaGerada && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-4 mb-2">
                  <p className="text-sm font-bold text-green-800 mb-3">✅ Rota gerada!</p>
                  <div className="flex gap-3 mb-3 flex-wrap">
                    {(rotaGerada.distancia_total_km ?? 0) > 0 && (
                      <div className="bg-white border border-green-200 rounded-lg px-3 py-2 text-center">
                        <p className="text-xs text-gray-500">Distância total</p>
                        <p className="font-bold text-gray-800 text-sm">{rotaGerada.distancia_total_km!.toFixed(1)} km</p>
                      </div>
                    )}
                    {(rotaGerada.tempo_estimado_min ?? rotaGerada.duracao_total_min ?? 0) > 0 && (
                      <div className="bg-white border border-green-200 rounded-lg px-3 py-2 text-center">
                        <p className="text-xs text-gray-500">Tempo estimado</p>
                        <p className="font-bold text-gray-800 text-sm">
                          {(() => { const m = rotaGerada.tempo_estimado_min || rotaGerada.duracao_total_min || 0; return m >= 60 ? Math.floor(m/60)+'h '+(m%60)+'min' : m+' min'; })()}
                        </p>
                      </div>
                    )}
                    <div className="bg-white border border-green-200 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-gray-500">Paradas</p>
                      <p className="font-bold text-gray-800 text-sm">{rotaGerada.total || rotaGerada.total_entregas || selecionadas.length}</p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    {rotaGerada.maps_url && (
                      <a
                        href={rotaGerada.maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 block text-center bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
                      >
                        🗺️ Abrir Rota no Google Maps
                      </a>
                    )}
                    <button
                      onClick={imprimirRotaDia}
                      className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                    >
                      🖨️ Imprimir Rota
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* === SECTION 2: EM ROTA === */}
            <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🚚</span>
                <h2 className="font-bold text-purple-700">Em Rota</h2>
                {entregasEmRota.length > 0 && (
                  <span className="ml-auto bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full">{entregasEmRota.length}</span>
                )}
              </div>

              {entregasEmRota.length === 0 && (
                <p className="text-center py-6 text-gray-400 text-sm">Nenhuma entrega em rota no momento</p>
              )}

              {entregasEmRota.length > 0 && (
                <div className="space-y-2">
                  {entregasEmRota.map((e, idx) => (
                    <div key={e.id} className="border border-purple-200 rounded-lg text-sm overflow-hidden">
                      <div className="p-3 flex items-start gap-3">
                        <span className="text-purple-400 text-xs mt-0.5 w-5 text-center shrink-0">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{e.cliente_nome}</p>
                          <p className="text-gray-600 text-xs truncate">{e.endereco}{e.numero ? ', ' + e.numero : ''}{e.bairro ? ' - ' + e.bairro : ''}</p>
                          {e.distancia_km != null && <p className="text-gray-400 text-xs">{e.distancia_km.toFixed(1)} km do depósito</p>}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => setExpandedEmRota(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                            className="text-xs text-purple-500 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-50 whitespace-nowrap"
                          >
                            {expandedEmRota.includes(e.id) ? '▲ Fechar' : '📦 Ver'}
                          </button>
                          <button
                            onClick={() => marcarEntregue(e.id)}
                            disabled={loadingCompleto === e.id}
                            className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 disabled:opacity-50 whitespace-nowrap font-medium"
                          >
                            {loadingCompleto === e.id ? '...' : '✔ Entregue'}
                          </button>
                        </div>
                      </div>
                      {expandedEmRota.includes(e.id) && (
                        <div className="border-t border-purple-100 bg-purple-50 px-4 py-3 text-xs space-y-1">
                          {e.itens_resumo && (
                            <div>
                              <span className="font-semibold text-gray-700">📦 Itens: </span>
                              <span className="text-gray-700">{e.itens_resumo}</span>
                            </div>
                          )}
                          <div className="flex gap-4 flex-wrap mt-1">
                            <span><span className="font-semibold text-gray-600">Código:</span> <span className="text-purple-700 font-mono">{e.codigo}</span></span>
                            <span><span className="font-semibold text-gray-600">Total:</span> <span className="font-bold text-gray-800">R$ {(e.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span></span>
                            {e.cliente_telefone && <span><span className="font-semibold text-gray-600">Tel:</span> <a href={'tel:' + e.cliente_telefone} className="text-blue-600">{e.cliente_telefone}</a></span>}
                            {e.recebedor && <span><span className="font-semibold text-gray-600">Recebedor:</span> {e.recebedor}</span>}
                          </div>
                          {e.observacoes && <p className="text-gray-500 italic mt-1">Obs: {e.observacoes}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* === SECTION 3: COMPLETOS === */}
            <div className="bg-white rounded-xl shadow-sm border border-green-100 p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">✅</span>
                <h2 className="font-bold text-green-700">Entregas Completas</h2>
                {entregasCompletas.length > 0 && (
                  <span className="ml-auto bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">{entregasCompletas.length}</span>
                )}
              </div>

              {entregasCompletas.length === 0 && (
                <p className="text-center py-6 text-gray-400 text-sm">Nenhuma entrega completa ainda hoje</p>
              )}

              {entregasCompletas.length > 0 && (
                <div className="space-y-2">
                  {entregasCompletas.map((e, idx) => (
                    <div key={e.id} className="border border-green-200 rounded-lg text-sm overflow-hidden opacity-80">
                      <div className="p-3 flex items-start gap-3">
                        <span className="text-green-500 text-sm mt-0.5 w-5 text-center shrink-0">✓</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-600">{e.cliente_nome}</p>
                          <p className="text-gray-500 text-xs truncate">{e.endereco}{e.numero ? ', ' + e.numero : ''}{e.bairro ? ' - ' + e.bairro : ''}</p>
                        </div>
                        <div className="flex gap-2 shrink-0 items-center">
                          <span className="text-xs text-green-600 font-medium">R$ {(e.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                          <button
                            onClick={() => setExpandedCompleto(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                            className="text-xs text-green-500 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 whitespace-nowrap"
                          >
                            {expandedCompleto.includes(e.id) ? '▲' : '▼'}
                          </button>
                        </div>
                      </div>
                      {expandedCompleto.includes(e.id) && (
                        <div className="border-t border-green-100 bg-green-50 px-4 py-3 text-xs space-y-1">
                          {e.itens_resumo && (
                            <div>
                              <span className="font-semibold text-gray-700">📦 Itens: </span>
                              <span className="text-gray-700">{e.itens_resumo}</span>
                            </div>
                          )}
                          <div className="flex gap-4 flex-wrap mt-1">
                            <span><span className="font-semibold text-gray-600">Código:</span> <span className="text-green-700 font-mono">{e.codigo}</span></span>
                            {e.cliente_telefone && <span><span className="font-semibold text-gray-600">Tel:</span> {e.cliente_telefone}</span>}
                            {e.recebedor && <span><span className="font-semibold text-gray-600">Recebedor:</span> {e.recebedor}</span>}
                          </div>
                          {e.observacoes && <p className="text-gray-500 italic mt-1">Obs: {e.observacoes}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>


            {/* ===== DASHBOARD TAB ===== */}
        {abaAtiva === 'dashboard' && <DashboardTab />}

        {/* ===== ESTOQUE TAB ===== */}
      {abaAtiva === 'estoque' && (
        <div className="pb-8">
          {produtosAbaixoMinimo.length > 0 && (
            <button onClick={() => setFiltroEstoqueBaixo(!filtroEstoqueBaixo)} className={`w-full mb-4 p-3 rounded-xl text-sm font-medium transition ${filtroEstoqueBaixo ? 'bg-red-100 border-2 border-red-400 text-red-800' : 'bg-yellow-50 border border-yellow-200 text-yellow-800 hover:bg-yellow-100'}`}>
              ⚠️ {produtosAbaixoMinimo.length} produto(s) abaixo do estoque mínimo {filtroEstoqueBaixo ? '(ver todos)' : '(filtrar)'}
            </button>
          )}
          <div className="flex flex-wrap gap-3 mb-6">
            <button onClick={() => setMostrarNovoProduto(true)} className="bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#E8850A] transition">➕ Novo Produto</button>
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
                        <td className="px-4 py-3"><p className="font-medium text-gray-800">{p.nome}</p><p className="text-xs text-gray-400">{p.categoria} · {p.codigo || '-'}{p.estoque_compartilhado_com ? ' · 🔗 estoque compartilhado' : ''}</p></td>
                        <td className="px-2 py-3 text-center"><span className={`text-xs font-bold px-2 py-1 rounded-full ${estoqueColor}`}>{p.estoque >= 999 ? 'Sob demanda' : `${p.estoque} ${p.unidade}`}</span>{p.estoque < 999 && <p className="text-xs text-gray-400 mt-0.5">min: {p.estoque_minimo}</p>}</td>
                        <td className="px-2 py-3 text-right font-medium">R$ {formatBRL(p.preco)}</td>
                        <td className="px-2 py-3 text-right text-gray-500">R$ {formatBRL(p.preco_custo || 0)}</td>
                        <td className="px-2 py-3 text-right"><span className={`text-xs font-bold ${Number(margem) >= 30 ? 'text-green-600' : Number(margem) >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>{margem}%</span></td>
                        <td className="px-2 py-3 text-center"><div className="flex gap-1 justify-center flex-wrap">
                          <button onClick={() => abrirEditProduto(p)} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200">✏️</button>
                          <button onClick={() => { setProdutoSelecionado(p); setEntradaQtd(''); setEntradaObs(''); setMostrarEntrada(true); }} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">📥</button>
                          <button onClick={() => abrirHistoricoProduto(p)} className="text-xs bg-[#FFF3E0] text-[#F7941D] px-2 py-1 rounded hover:bg-[#FFF3E0]">📊</button>
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
              {orcamentoSalvo?.id && (
                <button onClick={async () => {
                  setMostrarModal(false);
                  const res = await fetch(`/api/orcamentos/${orcamentoSalvo.id}`, { cache: 'no-store' });
                  const det = await res.json();
                  if (det && !det.error) { setOrcamentoDetalhe(det); setMostrarDetalhe(true); }
                }} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-blue-700 transition">📋 Gestão do Pedido</button>
              )}
              <button onClick={async () => {
                if (orcamentoSalvo?.id) {
                  try {
                    const res = await fetch(`/api/orcamentos/${orcamentoSalvo.id}`, { cache: 'no-store' });
                    const det = await res.json();
                    if (det && !det.error) { imprimirOrcamento({ ...det, reagendamentos: det.reagendamentos ?? 0, orcamento_itens: det.orcamento_itens || [] }); return; }
                  } catch (e) { /* fallback */ }
                }
                imprimirOrcamento();
              }} className="w-full bg-[#F7941D] text-white py-3 rounded-xl font-bold text-lg hover:bg-[#F7941D] transition">🖨️ Imprimir</button>
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
              <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F7941D]"></div></div>
            ) : orcamentoDetalhe ? (
              <div>
                <div className="px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#F7941D] text-base">{orcamentoDetalhe.codigo}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[orcamentoDetalhe.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[orcamentoDetalhe.status] || orcamentoDetalhe.status}
                      </span>
                    </div>
                    <button onClick={() => { setMostrarDetalhe(false); setOrcamentoDetalhe(null); }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                  </div>
                  <p className="text-xs text-gray-400">Criado em: {new Date(orcamentoDetalhe.criado_em).toLocaleDateString('pt-BR')} {new Date(orcamentoDetalhe.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="px-4 py-2 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-1 text-sm">Cliente</h3>
                  <p className="text-sm text-gray-800 font-medium">{orcamentoDetalhe.clientes?.nome || 'Cliente'}</p>
                  {orcamentoDetalhe.clientes?.telefone && <p className="text-sm text-gray-600">📞 {orcamentoDetalhe.clientes.telefone}</p>}
                  {orcamentoDetalhe.clientes?.recebedor && <p className="text-sm text-gray-600">👤 Recebedor: {orcamentoDetalhe.clientes.recebedor}</p>}
                </div>
                <div className="px-4 py-2 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-1 text-sm">Entrega</h3>
                  <p className="text-sm text-gray-800">{orcamentoDetalhe.tipo_entrega === 'entrega' ? '🚚 Entrega no endereço' : '🏪 Retirada na loja'}</p>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && orcamentoDetalhe.clientes?.endereco && (
                    <p className="text-sm text-gray-600 mt-1">
                      {[orcamentoDetalhe.clientes.endereco, orcamentoDetalhe.clientes.numero ? `nº ${orcamentoDetalhe.clientes.numero}` : '', orcamentoDetalhe.clientes.complemento, orcamentoDetalhe.clientes.bairro, orcamentoDetalhe.clientes.cidade ? `${orcamentoDetalhe.clientes.cidade}-${orcamentoDetalhe.clientes.estado}` : ''].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {orcamentoDetalhe.data_entrega && <p className="text-sm text-gray-600 mt-1">📅 Data de entrega: {new Date(orcamentoDetalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                  {(orcamentoDetalhe as any).data_retirada && <p className="text-sm text-gray-600 mt-1">📅 Data de retirada: {new Date((orcamentoDetalhe as any).data_retirada + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
                  {orcamentoDetalhe.reagendamentos > 0 && <p className="text-xs text-orange-600 mt-1">⚠️ Reagendado {orcamentoDetalhe.reagendamentos}x</p>}
                </div>
                {/* Gestão do Pedido */}
                <div className="px-4 pt-3 pb-1">
                  <div className="border border-[#F7941D] rounded-xl bg-[#FFF8F0] p-3">
                    <h3 className="font-bold text-[#F7941D] text-sm mb-2">⚙️ Gestão do Pedido</h3>
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Status do pedido</label>
                        <select value={orcamentoDetalhe.status} onChange={e => atualizarStatusOrcamento(orcamentoDetalhe.id, e.target.value, orcamentoDetalhe.status)}
                          className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#F7941D] bg-white">
                          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Status do pagamento</label>
                        <select
                          value={orcamentoDetalhe.status_pagamento || 'pendente'}
                          onChange={e => {
                            const val = e.target.value;
                            fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status_pagamento: val }),
                              cache: 'no-store',
                            }).then(() => setOrcamentoDetalhe({ ...orcamentoDetalhe, status_pagamento: val }));
                          }}
                          className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#F7941D] bg-white"
                        >
                          <option value="pendente">⏳ Pendente</option>
                          <option value="parcial">⚠️ Parcial</option>
                          <option value="completo">✅ Completo</option>
                          <option value="pagamento_na_entrega">🚚 Pgto na Entrega</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Forma de pagamento</label>
                        <select
                          value={orcamentoDetalhe.forma_pagamento || ''}
                          onChange={e => {
                            const val = e.target.value || null;
                            fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ forma_pagamento: val }),
                              cache: 'no-store',
                            }).then(() => setOrcamentoDetalhe({ ...orcamentoDetalhe, forma_pagamento: val }));
                          }}
                          className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#F7941D] bg-white"
                        >
                          <option value="">Forma de pagamento...</option>
                          <option value="dinheiro">Dinheiro</option>
                          <option value="pix">PIX</option>
                          <option value="debito">Débito</option>
                          <option value="credito">Crédito</option>
                          <option value="boleto">Boleto</option>
                          <option value="pagamento_na_entrega">Pagamento na Entrega</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-2 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-2 text-sm">Produtos</h3>
                  <div className="space-y-2">
                    {orcamentoDetalhe.orcamento_itens.length === 0 ? (
                      <p className="text-sm text-gray-500 italic py-2">Nenhum produto registrado. Edite o orçamento para adicionar os produtos.</p>
                    ) : orcamentoDetalhe.orcamento_itens.map(item => (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">{item.produto_nome}</p>
                          <p className="text-xs text-gray-500">{item.quantidade} {item.unidade} × R$ {formatBRL(item.preco_unitario)}</p>
                        </div>
                        <p className="font-bold text-[#F7941D] text-sm">R$ {formatBRL(item.subtotal)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="flex justify-between mb-1"><span className="text-sm text-gray-600">Subtotal:</span><span className="font-medium">R$ {formatBRL(orcamentoDetalhe.subtotal)}</span></div>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && orcamentoDetalhe.valor_frete > 0 && <div className="flex justify-between mb-1"><span className="text-sm text-gray-600">Frete:</span><span className="font-medium">R$ {formatBRL(orcamentoDetalhe.valor_frete)}</span></div>}
                  <div className="flex justify-between mt-2 pt-2 border-t border-gray-200"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-lg text-[#F7941D]">R$ {formatBRL(orcamentoDetalhe.total)}</span></div>
                </div>
                {/* Card pricing - details modal */}
                {(() => {
                  const totalDetalhe = orcamentoDetalhe.total;
                  const valorCartao = totalDetalhe * (1 + ACRESCIMO_CARTAO);
                  return (
                    <div className="mt-1 bg-orange-50 border border-orange-200 rounded-xl px-3 py-1.5 text-sm">
                      <div className="flex justify-between mb-1"><span className="text-gray-600">💵 À vista:</span><span className="font-bold">R$ {formatBRL(totalDetalhe)}</span></div>
                      <div className="flex justify-between mb-1"><span className="text-gray-600">💳 Cartão (+8%):</span><span className="font-bold text-orange-600">R$ {formatBRL(valorCartao)}</span></div>
                      <div className="flex flex-wrap gap-1 mt-1">{Array.from({length: MAX_PARCELAS}, (_, i) => i + 1).map(n => (<span key={n} className="text-xs bg-white border border-orange-300 rounded px-2 py-0.5 text-orange-700">{n}x R$ {formatBRL(valorCartao / n)}</span>))}</div>
                    </div>
                  );
                })()}
                {orcamentoDetalhe.observacoes && (() => {
                  const rawObs = orcamentoDetalhe.observacoes || '';
                  const ferrIdx = rawObs.indexOf('FERRAGEM:');
                  const obsTexto = ferrIdx >= 0 ? rawObs.substring(0, ferrIdx).trim() : rawObs.trim();
                  const ferrTexto = ferrIdx >= 0 ? rawObs.substring(ferrIdx) : '';
                  const ferrLinhas = ferrTexto ? ferrTexto.replace('FERRAGEM:', '').trim().split('\n').filter(Boolean) : [];
                  return (
                    <>
                      {obsTexto && (
                        <div className="px-4 py-2 border-b border-gray-100">
                          <h3 className="font-bold text-gray-700 mb-1 text-sm">Observações</h3>
                          <p className="text-sm text-gray-600 whitespace-pre-line">{obsTexto}</p>
                        </div>
                      )}
                      {ferrLinhas.length > 0 && (
                        <div className="px-4 py-2 border-b border-gray-100">
                          <h3 className="font-bold text-gray-700 mb-1 text-sm">🔩 Ferragem</h3>
                          <div className="space-y-0.5">
                            {ferrLinhas.map((linha, i) => (
                              <p key={i} className="text-xs text-gray-600">{linha}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="px-4 py-3 space-y-1.5">
                  <button onClick={() => compartilharWhatsAppDetalhe(orcamentoDetalhe)} className="w-full bg-green-500 text-white py-2 rounded-xl font-bold hover:bg-green-600 transition text-sm">📱 Enviar por WhatsApp</button>
                  <button onClick={() => imprimirOrcamento(orcamentoDetalhe)} className="w-full bg-[#F7941D] text-white py-2 rounded-xl font-bold hover:bg-[#F7941D] transition text-sm">🖨️ Imprimir</button>
                  {/* Bug 6 fix - Edit button restored for orcamento status */}
                  {orcamentoDetalhe.status === 'orcamento' && (
                    <button onClick={() => editarOrcamento(orcamentoDetalhe)} className="w-full bg-yellow-500 text-white py-2 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">✏️ Editar Orçamento</button>
                  )}
                  {/* Feature 9 - Reschedule button */}
                  {!['completo', 'cancelado', 'ocorrencia'].includes(orcamentoDetalhe.status) && orcamentoDetalhe.tipo_entrega === 'entrega' && (
                    <button onClick={() => { setReagendandoId(orcamentoDetalhe.id); setMostrarReagendar(true); }}
                      className="w-full bg-yellow-500 text-white py-2 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">📅 Reagendar Entrega</button>
                  )}
                  {['orcamento', 'cancelado'].includes(orcamentoDetalhe.status) && (
                    <button
                      onClick={() => excluirOrcamento(orcamentoDetalhe.id)}
                      disabled={excluindoId === orcamentoDetalhe.id}
                      className="w-full bg-red-500 text-white py-2 rounded-xl font-bold hover:bg-red-600 transition text-sm disabled:opacity-50"
                    >
                      {excluindoId === orcamentoDetalhe.id ? 'Excluindo...' : '🗑️ Excluir Orçamento'}
                    </button>
                  )}
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] mb-4" />
            <div className="flex gap-3">
              <button onClick={() => { setMostrarReagendar(false); setReagendandoId(null); }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition">Cancelar</button>
              <button onClick={() => { if (novaDataEntrega && reagendandoId) reagendarEntrega(reagendandoId, novaDataEntrega); }}
                disabled={!novaDataEntrega}
                className="flex-1 bg-[#F7941D] text-white py-2 rounded-lg font-bold hover:bg-[#E8850A] transition disabled:opacity-50">Confirmar</button>
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
              <button onClick={() => produtoSelecionado && excluirProduto(produtoSelecionado.id)} disabled={!!excluindoProdutoId} className="px-4 bg-red-100 text-red-700 py-2 rounded-lg font-medium hover:bg-red-200 disabled:opacity-50">{excluindoProdutoId ? '...' : '🗑️'}</button>
              <button onClick={salvarEdicaoProduto} disabled={salvandoEstoque} className="flex-1 bg-[#F7941D] text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Salvando...' : 'Salvar'}</button>
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
              <button onClick={criarNovoProduto} disabled={!novoNome || !novoPrecoVenda || salvandoEstoque} className="flex-1 bg-[#F7941D] text-white py-2 rounded-lg font-bold disabled:opacity-50">{salvandoEstoque ? 'Criando...' : 'Criar Produto'}</button>
            </div>
          </div>
        </div>
      )}

      
      {/* Feature 2 - Floating Cart Button */}
      {itens.length > 0 && abaAtiva === 'produtos' && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3">
          <button
            onClick={() => { setAbaAtiva('orcamento'); setEtapaOrcamento('revisao'); }}
            className="w-full bg-[#F7941D] text-white py-4 rounded-xl font-bold text-base shadow-lg hover:bg-[#E8850A] transition flex items-center justify-between px-5"
          >
            <span>🛒 {itens.reduce((a, i) => a + i.quantidade, 0)} itens</span>
            <span>R$ {itens.reduce((a, i) => a + i.quantidade * i.produto.preco, 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
            <span>Ver Orçamento →</span>
          </button>
        </div>
      )}

{/* Modal Atribuir Motorista */}
      {mostrarAtribuirMotorista && entregaSelecionadaId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => { setMostrarAtribuirMotorista(false); setEntregaSelecionadaId(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">🚗 Atribuir Motorista</h2>
            <div className="space-y-2 mb-4">
              <button onClick={() => atribuirMotorista(entregaSelecionadaId, null)} disabled={atribuindoMotorista === entregaSelecionadaId} className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-600">
                ✕ Remover atribuição
              </button>
              {motoristas.map(m => (
                <button key={m.id} onClick={() => atribuirMotorista(entregaSelecionadaId, m.id)} disabled={atribuindoMotorista === entregaSelecionadaId} className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-[#FFF3E0] hover:border-[#F7941D] text-sm">
                  <span className="font-medium">{m.nome}</span>{m.veiculo && <span className="text-gray-500 ml-2">({m.veiculo})</span>}
                </button>
              ))}
            </div>
            <button onClick={() => { setMostrarAtribuirMotorista(false); setEntregaSelecionadaId(null); }} className="w-full bg-gray-200 text-gray-700 py-2 rounded-lg font-medium">Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal Gestão de Motoristas */}
      {mostrarGestaoMotoristas && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setMostrarGestaoMotoristas(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">⚙️ Gestão de Motoristas</h2>
            <div className="space-y-2 mb-6">
              {motoristas.map(m => (
                <div key={m.id} className="p-3 rounded-lg border border-gray-200">
                  {editandoMotoristaId === m.id ? (
                    <div className="space-y-2">
                      <input type="text" value={editandoMotoristaNome} onChange={e => setEditandoMotoristaNome(e.target.value)}
                        placeholder="Nome" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      <input type="text" value={editandoMotoristaVeiculo} onChange={e => setEditandoMotoristaVeiculo(e.target.value)}
                        placeholder="Veículo" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      <input type="text" value={editandoMotoristaTelefone} onChange={e => setEditandoMotoristaTelefone(e.target.value)}
                        placeholder="Telefone" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      <div className="flex gap-2">
                        <button onClick={() => {
                          fetch('/api/motoristas', { method: 'PATCH', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ id: m.id, nome: editandoMotoristaNome, veiculo: editandoMotoristaVeiculo, telefone: editandoMotoristaTelefone })
                          }).then(() => { carregarMotoristas(); setEditandoMotoristaId(null); });
                        }} className="flex-1 text-xs bg-[#F7941D] text-white px-2 py-1 rounded">Salvar</button>
                        <button onClick={() => setEditandoMotoristaId(null)}
                          className="flex-1 text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{m.nome}</p>
                        {m.veiculo && <p className="text-xs text-gray-500">{m.veiculo}</p>}
                        {m.telefone && <p className="text-xs text-gray-400">{m.telefone}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => {
                          setEditandoMotoristaId(m.id);
                          setEditandoMotoristaNome(m.nome);
                          setEditandoMotoristaVeiculo(m.veiculo || '');
                          setEditandoMotoristaTelefone(m.telefone || '');
                        }} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1">✏️ Editar</button>
                        <button onClick={() => {
                          fetch('/api/motoristas', { method: 'PATCH', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ id: m.id, ativo: false }) })
                            .then(() => carregarMotoristas());
                        }} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Desativar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t pt-4">
              <h3 className="font-medium text-gray-700 mb-3">Adicionar Motorista</h3>
              <div className="space-y-2">
                <input type="text" placeholder="Nome *" value={novoMotoristaNome} onChange={e => setNovoMotoristaNome(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input type="text" placeholder="Veículo (ex: Caminhão 3)" value={novoMotoristaVeiculo} onChange={e => setNovoMotoristaVeiculo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setMostrarGestaoMotoristas(false)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm">Fechar</button>
                <button onClick={criarMotorista} disabled={!novoMotoristaNome.trim()} className="flex-1 bg-[#F7941D] text-white py-2 rounded-lg text-sm font-bold disabled:opacity-50">Adicionar</button>
              </div>
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
                  <div key={m.id} className={`p-3 rounded-lg border text-sm ${m.tipo === 'entrada' ? 'bg-green-50 border-green-200' : m.tipo === 'saida' ? 'bg-red-50 border-red-200' : m.tipo === 'cancelamento' ? 'bg-[#FFF3E0] border-[#F7941D]' : 'bg-yellow-50 border-yellow-200'}`}>
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

      {/* ===== FERRAGENS TAB ===== */}
      {abaAtiva === 'ferragens' && (
        <div className="pb-8 space-y-6">
          {/* === SECAO PENDENTES === */}
          <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-orange-700">🔧 Ferragem Pendente {!loadingFerragens && ferragens.length > 0 && <span className="ml-1 text-sm font-normal text-orange-500">({ferragens.length})</span>}</h2>
              <button onClick={carregarFerragens} disabled={loadingFerragens} className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1 rounded hover:bg-orange-50 border border-orange-200">
                {loadingFerragens ? 'Carregando...' : '↻ Atualizar'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Orçamentos com ferragem que ainda não foram passados ao ferreiro.</p>
            {loadingFerragens && <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500"></div></div>}
            {!loadingFerragens && ferragens.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Nenhuma ferragem pendente</p>
            )}
            {!loadingFerragens && ferragens.length > 0 && (
              <div className="space-y-3">
                {ferragens.map((f: Record<string, unknown>) => {
                  const obs = (f.observacoes as string) || '';
                  const ferragemIdx = obs.indexOf('FERRAGEM:');
                  const ferragemBlock = ferragemIdx >= 0 ? obs.slice(ferragemIdx) : '';
                  const ferragemLinhas = ferragemBlock ? ferragemBlock.split('\n').filter((l: string) => l.trim()) : [];
                  return (
                    <div key={f.id as string} className="border border-orange-100 rounded-lg bg-orange-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 text-sm">{(f.clientes as Record<string, unknown>)?.nome as string || 'Cliente'} <span className="text-gray-500 font-normal text-xs">— {(f.clientes as Record<string, unknown>)?.telefone as string}</span></p>
                          <p className="text-xs text-orange-600 font-mono">{f.codigo as string}</p>
                        </div>
                        <p className="text-xs text-gray-500 shrink-0">{f.status as string}</p>
                      </div>
                      {ferragemLinhas.length > 0 && (
                        <div className="mb-2">
                          {ferragemLinhas.map((linha: string, i: number) => (
                            <p key={i} className="text-xs text-gray-700 font-mono">{linha}</p>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={async () => {
                          setPassandoAoFerreiro(f.id as string);
                          try {
                            await fetch('/api/orcamentos/' + (f.id as string), {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ferragem_status: 'em_producao' }),
                              cache: 'no-store',
                            });
                            await Promise.all([carregarFerragens(), carregarFerragensProducao()]);
                          } catch (e) { console.error('Erro ao passar ao ferreiro', e); }
                          setPassandoAoFerreiro(null);
                        }}
                        disabled={passandoAoFerreiro === (f.id as string)}
                        className="w-full mt-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
                      >
                        {passandoAoFerreiro === (f.id as string) ? 'Passando...' : '📤 Passar ao Ferreiro'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* === SECAO EM PRODUCAO === */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-700">🔨 Em Produção {!loadingFerragensProducao && ferragensProducao.length > 0 && <span className="ml-1 text-sm font-normal text-gray-500">({ferragensProducao.length})</span>}</h2>
              <button onClick={carregarFerragensProducao} disabled={loadingFerragensProducao} className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 border border-gray-200">
                {loadingFerragensProducao ? 'Carregando...' : '↻ Atualizar'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Orçamentos já passados ao ferreiro.</p>
            {loadingFerragensProducao && <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div></div>}
            {!loadingFerragensProducao && ferragensProducao.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Nenhuma ferragem em produção</p>
            )}
            {!loadingFerragensProducao && ferragensProducao.length > 0 && (
              <div className="space-y-3">
                {ferragensProducao.map((f: Record<string, unknown>) => {
                  const obs = (f.observacoes as string) || '';
                  const ferragemIdx = obs.indexOf('FERRAGEM:');
                  const ferragemBlock = ferragemIdx >= 0 ? obs.slice(ferragemIdx) : '';
                  const ferragemLinhas = ferragemBlock ? ferragemBlock.split('\n').filter((l: string) => l.trim()) : [];
                  return (
                    <div key={f.id as string} className="border border-gray-200 rounded-lg bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 text-sm">{(f.clientes as Record<string, unknown>)?.nome as string || 'Cliente'} <span className="text-gray-500 font-normal text-xs">— {(f.clientes as Record<string, unknown>)?.telefone as string}</span></p>
                          <p className="text-xs text-gray-600 font-mono">{f.codigo as string}</p>
                        </div>
                        <p className="text-xs text-gray-500 shrink-0">{f.status as string}</p>
                      </div>
                      {ferragemLinhas.length > 0 && (
                        <div className="mb-2">
                          {ferragemLinhas.map((linha: string, i: number) => (
                            <p key={i} className="text-xs text-gray-700 font-mono">{linha}</p>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={async () => {
                          setVoltandoFerragemPendente(f.id as string);
                          try {
                            await fetch('/api/orcamentos/' + (f.id as string), {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ferragem_status: null }),
                              cache: 'no-store',
                            });
                            await Promise.all([carregarFerragens(), carregarFerragensProducao()]);
                          } catch (e) { console.error('Erro ao voltar ferragem para pendente', e); }
                          setVoltandoFerragemPendente(null);
                        }}
                        disabled={voltandoFerragemPendente === (f.id as string)}
                        className="w-full mt-1 px-3 py-2 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 rounded-lg text-sm font-medium"
                      >
                        {voltandoFerragemPendente === (f.id as string) ? 'Voltando...' : '↩ Voltar para Pendente'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === ABA IA === */}
      {abaAtiva === 'ia' && (
        <div className="pb-8">
          <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
            <h2 className="text-lg font-bold text-gray-800 mb-1">🤖 Assistente IA</h2>
            <p className="text-sm text-gray-500">Pergunte qualquer coisa sobre o negócio</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button onClick={() => enviarPerguntaIA(undefined, 'resumo_dia')} disabled={carregandoIA} className="bg-white border border-orange-200 rounded-xl p-3 text-left hover:bg-orange-50 transition disabled:opacity-50">
              <div className="text-xl mb-1">📊</div>
              <div className="font-semibold text-gray-800 text-sm">Resumo do Dia</div>
              <div className="text-xs text-gray-500">Faturamento e pedidos hoje</div>
            </button>
            <button onClick={() => enviarPerguntaIA(undefined, 'relatorio_semanal')} disabled={carregandoIA} className="bg-white border border-orange-200 rounded-xl p-3 text-left hover:bg-orange-50 transition disabled:opacity-50">
              <div className="text-xl mb-1">📈</div>
              <div className="font-semibold text-gray-800 text-sm">Relatório Semanal</div>
              <div className="text-xs text-gray-500">Performance da semana</div>
            </button>
            <button onClick={() => enviarPerguntaIA(undefined, 'analise_clientes')} disabled={carregandoIA} className="bg-white border border-orange-200 rounded-xl p-3 text-left hover:bg-orange-50 transition disabled:opacity-50">
              <div className="text-xl mb-1">👥</div>
              <div className="font-semibold text-gray-800 text-sm">Análise de Clientes</div>
              <div className="text-xs text-gray-500">Perfil e comportamento</div>
            </button>
            <button onClick={() => enviarPerguntaIA(undefined, 'previsao_estoque')} disabled={carregandoIA} className="bg-white border border-orange-200 rounded-xl p-3 text-left hover:bg-orange-50 transition disabled:opacity-50">
              <div className="text-xl mb-1">📦</div>
              <div className="font-semibold text-gray-800 text-sm">Previsão de Estoque</div>
              <div className="text-xs text-gray-500">Reposição necessária</div>
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="h-80 overflow-y-auto mb-4 space-y-3">
              {mensagensIA.length === 0 && (
                <p className="text-gray-400 text-sm text-center pt-8">Use os botões acima ou digite uma pergunta</p>
              )}
              {mensagensIA.map((msg, idx) => (
                <div key={idx} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={msg.role === 'user'
                    ? 'bg-orange-100 text-gray-800 rounded-2xl rounded-tr-sm px-4 py-2 max-w-xs text-sm'
                    : 'bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2 max-w-sm text-sm'}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {carregandoIA && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2 text-sm text-gray-500">Pensando...</div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputIA}
                onChange={e => setInputIA(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !carregandoIA) enviarPerguntaIA(inputIA, undefined); }}
                placeholder="Pergunte sobre vendas, estoque, clientes..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                disabled={carregandoIA}
              />
              <button
                onClick={() => enviarPerguntaIA(inputIA, undefined)}
                disabled={carregandoIA || !inputIA.trim()}
                className="bg-[#F7941D] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#E8850A] transition disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL CALCULADORA DE FERRO === */}
      {showCalculadoraFerro && (
        <CalculadoraFerroModal
          onAdicionarItens={adicionarItensAvulsos}
          onClose={() => setShowCalculadoraFerro(false)}
        />
      )}
    </div>
  );
}
