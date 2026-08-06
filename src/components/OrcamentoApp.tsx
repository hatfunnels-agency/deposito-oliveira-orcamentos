'use client'; // v3 - auth + redesign

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabaseBrowser } from '@/lib/supabase-client';
import CalculadoraFerroModal from './CalculadoraFerroModal';
import CalculadoraMadeiraModal from './CalculadoraMadeiraModal';
import CalculadoraLajeModal, { AVISO_LAJE, type DetalhesLaje, type LinhaLaje } from './CalculadoraLajeModal';
import DashboardTab from './DashboardTab';
import FinanceiroTab from './FinanceiroTab';
import ClienteProfile from './ClienteProfile';
import MapaEntregas from './MapaEntregas';
import Sidebar, { type AbaKey } from './Sidebar';
import { Menu, LogOut } from 'lucide-react';
import { TAGS_VALIDAS } from '@/lib/tags';

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
  tipo_estoque?: 'estocavel' | 'sob_demanda';
  total_vendido?: number;
  ultima_atualizacao_custo?: string | null;
  // Batch C — controle de estoque de ferro
  tipo_ferro?: string | null;
  baixa_estoque_em_produto_id?: string | null;
  baixa_estoque_fator?: number | null;
  metros_reservados?: number;
}

interface ItemOrcamento {
  produto: Produto;
  quantidade: number;
  avulso?: boolean;
  preco_custom?: number;
  obs?: string;
  // Identidade do item quando ele veio de um pedido existente aberto para
  // edicao (orcamento_itens.id no banco). Faz o PATCH casar item-a-item e
  // ATUALIZAR no lugar em vez de apagar+reinserir — sem isso o DELETE quebra
  // a FK de entregas_parciais_itens (NO ACTION) e zera quantidade_entregue.
  // Ausente em itens novos adicionados durante a edicao.
  orcamento_item_id?: string;
  // Quanto ja foi entregue deste item (entrega parcial). Carregado na edicao
  // pra UI/validacao; a checagem autoritativa acontece no backend.
  quantidade_entregue?: number;
  // Detalhamento por tipo de ferro pra item gerado pela calculadora de
  // ferragem. Persiste em ferragem_consumo (Batch B). Opcional — itens
  // normais e avulsos manuais nao tem.
  detalhamento_ferro?: Array<{ tipo_ferro: string; metros: number }>;
  // Batch D — laje. A linha tem id sintetico (pra dois ambientes com o mesmo
  // kit nao se fundirem numa linha so), mas guarda o produto_id real aqui pra
  // nao perder preco/CMV e a baixa de estoque dos casados.
  produto_id_real?: string;
  laje_detalhes?: DetalhesLaje;
}

interface OrcamentoItem {
  id: string;
  produto_id: number | null;
  produto_nome: string;
  quantidade: number;
  quantidade_entregue?: number;
  unidade: string;
  preco_unitario: number;
  preco_custo?: number;
  subtotal: number;
  // Batch D — dados tecnicos do ambiente (so em itens de kit de laje). Vem do
  // GET como array (relacao 1-N no Postgrest), na pratica 0 ou 1 registro.
  laje_detalhes?: DetalhesLaje[] | null;
  // Batch B — detalhamento por tipo de ferro (so em itens da calculadora de
  // ferragem). Vem do GET como array (relacao 1-N). Sem isto, reabrir o pedido
  // pra editar perderia o consumo de ferro ao salvar.
  ferragem_consumo?: Array<{ tipo_ferro: string; metros: number }> | null;
}

interface EntregaParcial {
  id: string;
  numero_entrega: number;
  data_entrega: string | null;
  observacoes: string | null;
  criado_em: string;
  entregas_parciais_itens: Array<{
    id: string;
    orcamento_item_id: string;
    quantidade: number;
    orcamento_itens?: { produto_nome: string; unidade: string } | null;
  }>;
}

interface OrcamentoDetalhe {
  id: string;
  codigo: string;
  tipo_entrega: string;
  valor_frete: number;
  subtotal: number;
  total: number;
  desconto_percentual?: number | null;
  desconto_valor?: number | null;
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
  valor_pago?: number | null;
  condicao_pagamento?: string | null;
  vencimento?: string | null;
  entregue_sem_pagamento?: boolean | null;
  endereco_id: string | null;
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
  endereco_completo: {
    id: string;
    cep: string | null;
    rua: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  orcamento_itens: OrcamentoItem[];
    fonte?: string | null;
}

interface EnderecoClienteUI {
  id: string;
  apelido: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  is_padrao: boolean;
}

interface EnderecoNovoForm {
  apelido: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

const ENDERECO_NOVO_VAZIO: EnderecoNovoForm = {
  apelido: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  estado: '',
};

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
  valor_pago?: number | null;
  condicao_pagamento?: string | null;
  vencimento?: string | null;
  entregue_sem_pagamento?: boolean | null;
  clientes: { id: string; nome: string; telefone: string; cidade: string | null; estado: string | null; endereco?: string | null; numero?: string | null; bairro?: string | null; recebedor?: string | null } | null;
  endereco_completo?: {
    id: string;
    cep: string | null;
    rua: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
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
  a_cobrar?: number;
  forma_pagamento?: string;
  itens_resumo: string;
  falta_resumo?: string;
  data_entrega: string | null;
  observacoes: string;
  motorista_id?: string | null;
  leva_id?: string | null;
  leva_numero?: number | null;
  distancia_km?: number | null;
  lat?: number | null;
  lng?: number | null;
}

interface LevaOrcamento {
  id: string;
  codigo: string;
  total: number;
  status: string;
  data_entrega: string | null;
  motorista_id?: string | null;
  volume_m3?: number;
  clientes?: { nome?: string; endereco?: string; numero?: string; bairro?: string; cidade?: string } | null;
}

interface Leva {
  id: string;
  numero_leva: number;
  data: string;
  volume_total?: number;
  volume_calculado?: number;
  status?: string;
  motorista_id?: string | null;
  motoristas?: { id: string; nome: string; veiculo?: string } | null;
  orcamentos?: LevaOrcamento[];
}

interface Motorista {
  id: string;
  nome: string;
  telefone?: string | null;
  veiculo?: string | null;
  ativo: boolean;
}

interface ClienteListaItem {
  id: string;
  nome: string;
  telefone: string;
  qtd_compras: number;
  ultima_compra: string | null;
  total_gasto: number;
  tags: string[];
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



// Label resumido pra o picker e o display read-only do endereco
// selecionado. Apelido > rua, fallback "Sem rua".
function formatarEnderecoUI(e: {
  apelido?: string | null;
  rua?: string | null;
  numero?: string | null;
  bairro?: string | null;
  is_padrao?: boolean;
}): string {
  const label = e.apelido || e.rua || 'Sem rua';
  const parts = [label, e.numero, e.bairro].filter(Boolean);
  const base = parts.join(' · ');
  return e.is_padrao ? `${base} (padrão)` : base;
}

// Tabela de parcelas no cartao. 2x e 3x dividem o valor a vista (sem
// acrescimo, "3x sem juros"). 4x-6x dividem o valor com acrescimo. 1x
// no cartao some — PIX/dinheiro ja cobre "a vista". Helper usado pelo
// PDF de impressao, preview do form, e modal de detalhe do pedido.
function montarParcelasCartao(valorAVista: number, acrescimo: number) {
  const valorComAcrescimo = valorAVista * (1 + acrescimo);
  return {
    valorAVista,
    valorComAcrescimo,
    semJuros: [2, 3].map(n => ({ n, valor: valorAVista / n })),
    comAcrescimo: [4, 5, 6].map(n => ({ n, valor: valorComAcrescimo / n })),
  };
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarTelefoneBR(tel: string | null | undefined): string {
  if (!tel) return '—';
  const d = String(tel).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(tel);
}

function formatarDataBR(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR');
}

const PESO_MEDIO_KG: Record<string, number> = {
  saco: 50, unidade: 5, barra: 15, metro: 10, rolo: 20, 'm³': 800, kg: 1, milheiro: 2500,
};

const STATUS_LABELS: Record<string, string> = {
  orcamento: 'Orçamento',
  entrega_pendente: 'Entrega Pendente',
  entrega_parcial: 'Entrega Parcial',
  retirada_pendente: 'Retirada Pendente',
  em_rota: 'Em Rota',
  completo: 'Completo',
  ocorrencia: 'Ocorrência',
  cancelado: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  orcamento: 'bg-gray-100 text-gray-700',
  entrega_pendente: 'bg-orange-100 text-orange-800',
  entrega_parcial: 'bg-indigo-100 text-indigo-800',
  retirada_pendente: 'bg-purple-100 text-purple-800',
  em_rota: 'bg-blue-100 text-blue-800',
  completo: 'bg-green-200 text-green-900',
  ocorrencia: 'bg-red-100 text-red-800',
  cancelado: 'bg-gray-200 text-gray-600',
};

// Estado do pagamento. Derivado da tabela `pagamentos` pelo trigger no
// Postgres — nao se escreve isso na mao. Pra mudar, registre o dinheiro
// em POST /api/pagamentos.
const STATUS_PAGAMENTO_LABELS: Record<string, string> = {
  pendente: '⏳ Pgto Pendente',
  parcial: '⚠️ Pgto Parcial',
  completo: '✅ Pago',
};
const STATUS_PAGAMENTO_COLORS: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800',
  parcial: 'bg-orange-100 text-orange-800',
  completo: 'bg-green-100 text-green-800',
};

// Combinado comercial — isso sim e escolhido pelo atendente.
const CONDICAO_PAGAMENTO_LABELS: Record<string, string> = {
  a_vista: '💰 À vista',
  na_entrega: '🚚 Na entrega',
  prazo: '📅 A prazo',
};
const ACRESCIMO_CARTAO = 0.08;
const CAPACIDADE_CAMINHAO_M3 = 10;

// Detecta itens de ferragem montados (que precisam ir para o ferreiro).
// Madeira nunca conta, mesmo quando o nome inclui "viga"/"caibro".
const FERRAGEM_EXCLUSOES = ['cambara', 'cambará', 'pinus', 'madeira', 'caibro', 'prancha', 'ripao', 'ripão', 'tabua', 'tábua', 'sarrafo', 'pontalete', 'madeirit'];
function ehItemFerro(item: { produto_nome?: string | null; produto_id?: string | number | null }): boolean {
  const nome = (item.produto_nome || '').toLowerCase();
  if (!nome) return false;
  if (FERRAGEM_EXCLUSOES.some(e => nome.includes(e))) return false;
  // Sinal forte: peca montada pela calculadora sempre tem "barras" (4/6/8 barras)
  if (nome.includes('barras')) return true;
  // Sapata: tipico de ferragem (madeira ja foi filtrada acima)
  if (nome.includes('sapata')) return true;
  // Item avulso (produto_id null) com palavra-chave de ferro montado
  const isAvulso = item.produto_id == null;
  if (isAvulso && (nome.includes('ferro') || nome.includes('viga') || nome.includes('coluna') || nome.includes('estribo'))) return true;
  return false;
}

// === Impressao da ordem de producao de ferragem (folha do ferreiro) ===
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

// A calculadora embute espacamento e observacao no nome do item, separados
// por " • ". Aqui separamos pra destacar cada parte na folha do ferreiro.
function parseNomeFerro(nome: string): { main: string; estribo: string | null; obs: string | null } {
  const parts = (nome || '').split(' • ');
  let estribo: string | null = null;
  let obs: string | null = null;
  const mainParts: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (/^estribo/i.test(t)) estribo = t.replace(/^estribo\s*/i, '').trim();
    else if (/^obs:/i.test(t)) obs = t.replace(/^obs:\s*/i, '').trim();
    else if (t) mainParts.push(t);
  }
  return { main: mainParts.join(' • '), estribo, obs };
}

function imprimirOrdensFerragem(pedidos: Array<Record<string, unknown>>): void {
  if (!pedidos || pedidos.length === 0) return;
  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para imprimir a ordem de produção.'); return; }

  const ordens = pedidos.map(f => {
    const cliente = (f.clientes as Record<string, unknown>) || {};
    const itens = (f.orcamento_itens as Array<Record<string, unknown>>) || [];
    const itensFerro = itens.filter(it => ehItemFerro({
      produto_nome: it.produto_nome as string | null,
      produto_id: it.produto_id as string | number | null | undefined,
    }));
    const lista = itensFerro.length > 0 ? itensFerro : itens;
    const totalPecas = lista.reduce((acc, it) => acc + (Number(it.quantidade) || 0), 0);
    const prazoRaw = (f.data_entrega || f.data_retirada) as string | null;
    let prazo = '—';
    if (prazoRaw) {
      const d = new Date(prazoRaw + 'T00:00:00');
      const curta = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const dow = d.toLocaleDateString('pt-BR', { weekday: 'long' });
      prazo = curta + ' - ' + dow.charAt(0).toUpperCase() + dow.slice(1);
    }
    const tipoPrazo = (f.tipo_entrega as string) === 'retirada' ? 'Retirada' : 'Entrega';

    const linhas = lista.map(it => {
      const { main, estribo, obs } = parseNomeFerro((it.produto_nome as string) || '');
      const qtd = Number(it.quantidade) || 0;
      const unidade = (it.unidade as string) || '';
      return `<tr>
        <td class="chk"></td>
        <td class="desc">
          <div class="main">${escapeHtml(main)}</div>
          ${estribo ? `<span class="tag estribo">Estribo ${escapeHtml(estribo)}</span>` : '<span class="tag alerta">SEM ESPAÇAMENTO — CONFERIR</span>'}
          ${obs ? `<span class="tag obs">Obs: ${escapeHtml(obs)}</span>` : ''}
        </td>
        <td class="qtd">${qtd % 1 === 0 ? qtd : qtd.toFixed(2)} ${escapeHtml(unidade)}</td>
      </tr>`;
    }).join('');

    return `<section class="ordem">
      <div class="cab">
        <div class="cab-cli">
          <div class="codigo">${escapeHtml((f.codigo as string) || '')}</div>
          <div class="cliente">${escapeHtml((cliente.nome as string) || 'Cliente')}</div>
          <div class="tel">${escapeHtml((cliente.telefone as string) || '')}</div>
        </div>
        <div class="prazo">
          <div class="prazo-label">${tipoPrazo}</div>
          <div class="prazo-data">${prazo}</div>
        </div>
      </div>
      <table>
        <thead><tr><th class="chk">Feito</th><th>Peça a produzir</th><th class="qtd">Metros</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="rodape">${lista.length} tipo(s) de peça • ${totalPecas % 1 === 0 ? totalPecas : totalPecas.toFixed(2)}m no total</div>
    </section>`;
  }).join('');

  const geradoEm = new Date().toLocaleString('pt-BR');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Ordem de Produção — Ferragem</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color:#000; margin:0; padding:16px; }
      .top { display:flex; justify-content:space-between; align-items:baseline; border-bottom:3px solid #000; padding-bottom:8px; margin-bottom:16px; }
      .top h1 { font-size:20px; margin:0; }
      .top .data { font-size:12px; }
      .ordem { border:2px solid #000; border-radius:8px; padding:12px 14px; margin-bottom:14px; page-break-inside:avoid; }
      .cab { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:10px; }
      .codigo { font-family:monospace; font-size:13px; font-weight:bold; }
      .cliente { font-size:19px; font-weight:bold; line-height:1.1; }
      .tel { font-size:12px; }
      .prazo { text-align:center; border:2px solid #000; border-radius:6px; padding:4px 12px; min-width:140px; }
      .prazo-label { font-size:10px; text-transform:uppercase; letter-spacing:.5px; }
      .prazo-data { font-size:15px; font-weight:bold; }
      table { width:100%; border-collapse:collapse; }
      th, td { border-bottom:1px solid #999; text-align:left; padding:8px 6px; vertical-align:top; }
      th { font-size:11px; text-transform:uppercase; border-bottom:2px solid #000; }
      th.chk, td.chk { width:44px; text-align:center; }
      td.chk::before { content:''; display:inline-block; width:22px; height:22px; border:2px solid #000; border-radius:3px; margin-top:2px; }
      th.qtd, td.qtd { width:96px; text-align:right; font-weight:bold; white-space:nowrap; }
      .main { font-size:15px; font-weight:600; }
      .tag { display:inline-block; font-size:13px; font-weight:bold; margin-top:4px; margin-right:6px; padding:2px 8px; border-radius:4px; }
      .tag.estribo { background:#000; color:#fff; }
      .tag.obs { border:2px solid #000; }
      .tag.alerta { background:#000; color:#fff; }
      .rodape { margin-top:8px; font-size:12px; text-align:right; color:#333; }
      @media print { body { padding:0; } }
    </style></head><body>
    <div class="top"><h1>🔨 Ordem de Produção — Ferragem</h1><div class="data">Gerado em ${geradoEm}<br>${pedidos.length} pedido(s)</div></div>
    ${ordens}
    <script>window.onload=function(){window.focus();window.print();};</script>
  </body></html>`;

  win.document.write(html);
  win.document.close();
}


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
  const abasVisiveis: readonly AbaKey[] =
    papelUsuario === 'motorista'
      ? ['entregas']
      : papelUsuario === 'atendente'
      ? ['produtos', 'orcamento', 'historico', 'clientes', 'ferragens', 'entregas', 'financeiro']
      : ['produtos', 'orcamento', 'historico', 'clientes', 'ferragens', 'entregas', 'estoque', 'financeiro', 'dashboard', 'ia'];
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  
  
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  // === CALCULADORA DE FERRO STATES ===
  const [showCalculadoraFerro, setShowCalculadoraFerro] = useState(false);
  const [showCalculadoraMadeira, setShowCalculadoraMadeira] = useState(false);
  const [showCalculadoraLaje, setShowCalculadoraLaje] = useState(false);
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Todas');
  const [abaAtiva, setAbaAtiva] = useState<AbaKey>('produtos');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mensagensIA, setMensagensIA] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [inputIA, setInputIA] = useState('');
  const [carregandoIA, setCarregandoIA] = useState(false);
  const [tipoEntrega, setTipoEntrega] = useState<'retirada' | 'entrega'>('retirada');
  const [cepDestino, setCepDestino] = useState('');
  const [nomeCliente, setNomeCliente] = useState('');
  const [whatsappCliente, setWhatsappCliente] = useState('');
  const [erroFrete, setErroFrete] = useState('');
  const [enderecoViaCEP, setEnderecoViaCEP] = useState('');
  const [salvandoOrcamento, setSalvandoOrcamento] = useState(false);
  const [descontoCustom, setDescontoCustom] = useState<number>(0); // sempre em %; valor efetivo aplicado
  const [descontoModo, setDescontoModo] = useState<'pct' | 'valor'>('pct');
  const [descontoValorInput, setDescontoValorInput] = useState<number>(0); // valor em R$ quando modo=valor
  const [mostrarSimulador, setMostrarSimulador] = useState(false);
  const [orcamentoSalvo, setOrcamentoSalvo] = useState<{ codigo: string; id?: string } | null>(null);
  const [orcamentos, setOrcamentos] = useState<OrcamentoSalvo[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [buscaHistorico, setBuscaHistorico] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroDataDe, setFiltroDataDe] = useState<string>('');
  const [filtroDataAte, setFiltroDataAte] = useState<string>('');
  const [paginaHistorico, setPaginaHistorico] = useState(1);
  const [totalOrcamentos, setTotalOrcamentos] = useState(0);
  const [dataEntrega, setDataEntrega] = useState('');
  const [dataRetirada, setDataRetirada] = useState('');
  const [fonteVenda, setFonteVenda] = useState('');
  const [statusPedidoForm, setStatusPedidoForm] = useState('orcamento');
  const [condicaoPagamentoForm, setCondicaoPagamentoForm] = useState('a_vista');
  const [vencimentoForm, setVencimentoForm] = useState('');
  // Registro de recebimento no detalhe do pedido.
  const [pgtoValor, setPgtoValor] = useState('');
  const [pgtoMetodo, setPgtoMetodo] = useState('pix');
  const [formaPagamentoForm, setFormaPagamentoForm] = useState('');
  const [orcamentoDetalhe, setOrcamentoDetalhe] = useState<OrcamentoDetalhe | null>(null);
  const [mostrarDetalhe, setMostrarDetalhe] = useState(false);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);
  // Perfil de cliente (modal). Quando setado, renderiza <ClienteProfile>.
  const [clienteProfileId, setClienteProfileId] = useState<string | null>(null);
  // Aba Clientes
  const [clientesLista, setClientesLista] = useState<ClienteListaItem[]>([]);
  const [clientesBusca, setClientesBusca] = useState('');
  const [clientesPagina, setClientesPagina] = useState(1);
  const [clientesTotal, setClientesTotal] = useState(0);
  const [clientesTotalPages, setClientesTotalPages] = useState(1);
  const [clientesLoading, setClientesLoading] = useState(false);
  // Feature 2: filtros da aba Clientes
  const [clientesTagsFiltro, setClientesTagsFiltro] = useState<Set<string>>(new Set());
  const [clientesMinValor, setClientesMinValor] = useState('');
  const [clientesMaxValor, setClientesMaxValor] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  // Feature 8 - Address detail fields
  const [numeroEndereco, setNumeroEndereco] = useState('');
  const [complementoEndereco, setComplementoEndereco] = useState('');
  const [recebedor, setRecebedor] = useState('');
  // Picker de enderecos (Step 3). enderecosDoCliente carrega via lookup
  // do telefone (modal de criacao) ou ao abrir editar. enderecoIdSelecionado
  // null = caller cai no fallback do backend (is_padrao) ou em endereco_novo
  // quando modoEndereco='novo'.
  const [enderecosDoCliente, setEnderecosDoCliente] = useState<EnderecoClienteUI[]>([]);
  const [enderecoIdSelecionado, setEnderecoIdSelecionado] = useState<string | null>(null);
  const [modoEndereco, setModoEndereco] = useState<'existente' | 'novo'>('existente');
  const [enderecoNovoForm, setEnderecoNovoForm] = useState<EnderecoNovoForm>(ENDERECO_NOVO_VAZIO);
  // enderecoResolvido espelha a logica de salvarEGerarOrcamento — true
  // quando algum dos 4 caminhos consegue resolver um endereco pro PATCH/
  // POST (Fix 3 do bug ORD-4Z9EPS8/ORD-CCDQAIB).
  // Campos separados pra o form de cliente novo / sem enderecos cadastrados.
  // Substituem o enderecoViaCEP concatenado da UI legacy (Step 4 Tarefa 2).
  const [ruaDestino, setRuaDestino] = useState('');
  const [bairroDestino, setBairroDestino] = useState('');
  const [cidadeDestino, setCidadeDestino] = useState('');
  const [estadoDestino, setEstadoDestino] = useState('');
  const [apelidoEndereco, setApelidoEndereco] = useState('');

  // Espelha a logica de salvarEGerarOrcamento: true quando o submit
  // vai conseguir resolver um endereco. Pra tipo_entrega='entrega'
  // bloqueia o botao Salvar quando nao resolveria — evita criar pedido
  // com endereco_id NULL (Fix 3 do bug ORD-4Z9EPS8/ORD-CCDQAIB).
  // Retirada nao precisa de endereco — sempre true.
  const enderecoResolvido = useMemo(() => {
    if (tipoEntrega !== 'entrega') return true;
    if (enderecoIdSelecionado && modoEndereco === 'existente') return true;
    if (
      enderecosDoCliente.length > 0 &&
      modoEndereco === 'novo' &&
      enderecoNovoForm.rua.trim() &&
      enderecoNovoForm.numero.trim()
    ) return true;
    if (ruaDestino.trim() && numeroEndereco.trim()) return true;
    return false;
  }, [
    tipoEntrega, enderecoIdSelecionado, modoEndereco, enderecosDoCliente,
    enderecoNovoForm, ruaDestino, numeroEndereco,
  ]);

  // Sub-picker pra trocar endereco no modal de detalhe (Tarefa 6).
  // State separado do picker do form pra nao colidir quando ambos abertos.
  const [mostrarTrocaEndereco, setMostrarTrocaEndereco] = useState(false);
  const [enderecosDetalhe, setEnderecosDetalhe] = useState<EnderecoClienteUI[]>([]);
  const [trocandoEndereco, setTrocandoEndereco] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  // Feature 7 - Address search
  const [buscaEndereco, setBuscaEndereco] = useState('');
  const [sugestoesEndereco, setSugestoesEndereco] = useState<Array<{place_id: string; description: string}>>([]);
  const [mostrandoSugestoes, setMostrandoSugestoes] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Levas state
  const [levas, setLevas] = useState<Leva[]>([]);
  const [levaAtualId, setLevaAtualId] = useState<string | null>(null);
  const [carregandoLevas, setCarregandoLevas] = useState(false);
  const [erroLevas, setErroLevas] = useState<string | null>(null);
  // Motorista escolhido na barra de "montar leva" com as entregas selecionadas.
  const [motoristaNovaLeva, setMotoristaNovaLeva] = useState('');
  const [acaoLeva, setAcaoLeva] = useState<string | null>(null);
  const [entregasSelecionadas, setEntregasSelecionadas] = useState<string[]>([]);
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
  // Set memoizado para o MapaEntregas (state nativo continua array — refatorar
  // pra Set quebraria JSON.stringify do fetch e ~10 callsites internas).
  const selecionadasSet = useMemo(() => new Set(selecionadas), [selecionadas]);
  const [rotaGerada, setRotaGerada] = useState<RotaResponse | null>(null);
  const [loadingDia, setLoadingDia] = useState(false);
  const [loadingRota, setLoadingRota] = useState(false);
  const [expandedDia, setExpandedDia] = useState<string[]>([]);
  const [dataEntregas, setDataEntregas] = useState('');
  // Visualizacao da aba Entregas: lista (padrao) ou mapa. Persistida em localStorage.
  const [vistaEntregas, setVistaEntregas] = useState<'lista' | 'mapa'>('lista');
  const [marcandoRota, setMarcandoRota] = useState(false);
  const [entregasEmRota, setEntregasEmRota] = useState<EntregaRota[]>([]);
  const [entregasCompletas, setEntregasCompletas] = useState<EntregaRota[]>([]);
  // Uniao das 3 listas do dia (pendentes inclui parcial) — fonte do mapa,
  // que precisa exibir entregas de todos os status, nao so pendentes.
  const entregasMapa = useMemo(
    () => [...entregasDia, ...entregasEmRota, ...entregasCompletas],
    [entregasDia, entregasEmRota, entregasCompletas],
  );
  const [loadingCompleto, setLoadingCompleto] = useState<string | null>(null);
  // Ao concluir uma entrega com saldo em aberto, a atendente precisa registrar
  // a cobranca (ou marcar que foi entregue sem pagamento) antes de fechar.
  const [cobrancaEntrega, setCobrancaEntrega] = useState<EntregaRota | null>(null);
  const [cobrancaValor, setCobrancaValor] = useState('');
  const [cobrancaMetodo, setCobrancaMetodo] = useState('pix');
  const [cobrancaSalvando, setCobrancaSalvando] = useState(false);
  // Pagamentos do pedido aberto no detalhe (pro admin poder estornar).
  const [pagamentosDetalhe, setPagamentosDetalhe] = useState<{ id: string; valor: number; metodo: string; data_pagamento: string; origem: string }[]>([]);
  const [retiradas, setRetiradas] = useState<OrcamentoSalvo[]>([]);
  const [loadingRetiradas, setLoadingRetiradas] = useState(false);
  // === FERRAGENS STATES ===
  const [ferragens, setFerragens] = useState<Record<string, unknown>[]>([]);
  const [loadingFerragens, setLoadingFerragens] = useState(false);
  // Fila de amarracao: previsao de quando cada pedido de ferragem fica pronto.
  type FerragemFila = {
    capacidade_m_dia: number;
    fila: { id: string; codigo: string; cliente_nome: string; metros: number; data_pronta: string; dias_uteis: number }[];
    resumo: { metros_total: number; pedidos: number; dias_uteis: number; zera_em: string | null };
  };
  const [ferragemFila, setFerragemFila] = useState<FerragemFila | null>(null);
  const [editandoCapacidade, setEditandoCapacidade] = useState(false);
  const [capacidadeInput, setCapacidadeInput] = useState('');
  // Previsao de "se fechar agora, ferragem pronta ~DD/MM" na tela do orcamento.
  const [previsaoFechar, setPrevisaoFechar] = useState<{ data_pronta: string; metros: number; dias_uteis: number } | null>(null);
  const [ferragensProducao, setFerragensProducao] = useState<Record<string, unknown>[]>([]);
  const [loadingFerragensProducao, setLoadingFerragensProducao] = useState(false);
  const [ferragensProntas, setFerragensProntas] = useState<Record<string, unknown>[]>([]);
  const [loadingFerragensProntas, setLoadingFerragensProntas] = useState(false);
  const [marcandoPronta, setMarcandoPronta] = useState<string | null>(null);
  const [voltandoProducao, setVoltandoProducao] = useState<string | null>(null);
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
  // Batch B Fase 3: edicao inline de preco_custo + modal historico
  const [editandoCustoId, setEditandoCustoId] = useState<string | null>(null);
  const [editandoCustoValor, setEditandoCustoValor] = useState('');
  const [salvandoCustoId, setSalvandoCustoId] = useState<string | null>(null);
  const [toastEstoque, setToastEstoque] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);
  const [historicoCustosOpenId, setHistoricoCustosOpenId] = useState<string | null>(null);
  const [historicoCustosLista, setHistoricoCustosLista] = useState<Array<{ id: string; custo_anterior: number; custo_novo: number; criado_em: string; usuario_nome: string | null }>>([]);
  const [historicoCustosLoading, setHistoricoCustosLoading] = useState(false);
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

  // PDV (Venda Rapida) - fluxo simplificado de balcao
  const [mostrarPDV, setMostrarPDV] = useState(false);
  const [pdvNome, setPdvNome] = useState('');
  const [pdvTelefone, setPdvTelefone] = useState('');
  const [pdvItens, setPdvItens] = useState<Array<{ produto: Produto; quantidade: number; preco_custom?: number }>>([]);
  const [pdvStatusPagamento, setPdvStatusPagamento] = useState<'pago' | 'pendente'>('pago');
  const [pdvFormaPagamento, setPdvFormaPagamento] = useState<'pix' | 'dinheiro' | 'debito' | 'credito'>('pix');
  const [pdvBusca, setPdvBusca] = useState('');
  const [salvandoPDV, setSalvandoPDV] = useState(false);

  // Entregas parciais
  const [entregasParciais, setEntregasParciais] = useState<EntregaParcial[]>([]);
  const [mostrarRegistrarParcial, setMostrarRegistrarParcial] = useState(false);
  const [parcialQtds, setParcialQtds] = useState<Record<string, string>>({});
  const [parcialObs, setParcialObs] = useState('');
  const [salvandoParcial, setSalvandoParcial] = useState(false);
  const [marcandoTudoEntregue, setMarcandoTudoEntregue] = useState(false);
  const [entregaParaCancelar, setEntregaParaCancelar] = useState<EntregaParcial | null>(null);
  const [cancelandoParcial, setCancelandoParcial] = useState(false);

  const carregarProdutos = useCallback(() => {
    fetch('/api/produtos')
      .then(r => r.json())
      .then(data => {
        const prods = (data.produtos || []).map((p: Produto) => ({
          ...p,
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
      if (filtroDataDe) params.set('dataDe', filtroDataDe);
      if (filtroDataAte) params.set('dataAte', filtroDataAte);
      const res = await fetch(`/api/orcamentos?${params}`);
      const data = await res.json();
      // Defesa contra duplicacao por id (caso JOIN/agregacao crie linhas repetidas)
      const lista = (data.orcamentos || []) as OrcamentoSalvo[];
      const seenIds = new Set<string>();
      const unicos = lista.filter(o => { if (seenIds.has(o.id)) return false; seenIds.add(o.id); return true; });
      setOrcamentos(unicos);
      setTotalOrcamentos(data.total || 0);
    } catch (e) { console.error('Erro ao carregar historico', e); }
    setLoadingHistorico(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaHistorico, filtroStatus, filtroDataDe, filtroDataAte, paginaHistorico]);

  useEffect(() => {
    if (abaAtiva === 'historico') carregarHistorico();
  }, [abaAtiva, carregarHistorico]);

  // Restaura/persiste a preferencia de vista da aba Entregas
  useEffect(() => {
    const v = localStorage.getItem('do_vista_entregas');
    if (v === 'mapa' || v === 'lista') setVistaEntregas(v);
  }, []);
  useEffect(() => {
    localStorage.setItem('do_vista_entregas', vistaEntregas);
  }, [vistaEntregas]);

  // ===== Aba Clientes =====
  const carregarClientes = useCallback(async () => {
    setClientesLoading(true);
    try {
      const params = new URLSearchParams({ page: String(clientesPagina), limit: '50' });
      if (clientesBusca.trim()) params.set('search', clientesBusca.trim());
      if (clientesTagsFiltro.size > 0) params.set('tags', Array.from(clientesTagsFiltro).join(','));
      if (clientesMinValor.trim()) params.set('minValor', clientesMinValor.trim());
      if (clientesMaxValor.trim()) params.set('maxValor', clientesMaxValor.trim());
      const res = await fetch(`/api/clientes?${params}`, { cache: 'no-store' });
      const data = await res.json();
      setClientesLista((data.clientes || []) as ClienteListaItem[]);
      setClientesTotal(data.total || 0);
      setClientesTotalPages(data.total_pages || 1);
    } catch {
      setClientesLista([]);
      setClientesTotal(0);
      setClientesTotalPages(1);
    }
    setClientesLoading(false);
  }, [clientesPagina, clientesBusca, clientesTagsFiltro, clientesMinValor, clientesMaxValor]);

  // Busca com debounce de 300ms (tambem dispara ao abrir a aba / trocar pagina)
  useEffect(() => {
    if (abaAtiva !== 'clientes') return;
    const t = setTimeout(() => { carregarClientes(); }, 300);
    return () => clearTimeout(t);
  }, [abaAtiva, carregarClientes]);

  // Reset pagina pra 1 quando filtros mudam (evita ficar em pagina vazia)
  useEffect(() => {
    setClientesPagina(1);
  }, [clientesTagsFiltro, clientesMinValor, clientesMaxValor]);

  // Reset page to 1 when search/filter changes
  useEffect(() => {
    setPaginaHistorico(1);
  }, [buscaHistorico, filtroStatus, filtroDataDe, filtroDataAte]);

  // Produtos vendidos por metro (exceto ferro) entram no orcamento pela
  // Calculadora de Madeira — ficam fora do catalogo direto pra evitar
  // confusao, mas seguem visiveis/editaveis na aba Estoque.
  // Produtos vendidos por metro que sao da calculadora de madeira. Laje fica
  // de fora: "Mt. Linear Viga H8/H12" tambem sao vendidas por metro, mas
  // pertencem ao segmento de laje e tem seu proprio lugar (Batch D).
  const ehProdutoCalculadoraMadeira = (p: Produto) =>
    p.unidade === 'metro' && p.categoria !== 'Ferro' && p.categoria !== 'Laje';

  const categorias = ['Todas', ...Array.from(new Set(produtos.filter(p => !ehProdutoCalculadoraMadeira(p)).map(p => p.categoria)))];

  const produtosFiltrados = produtos.filter(p => {
    if (ehProdutoCalculadoraMadeira(p)) return false;
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

  // Carrega enderecos do cliente pra alimentar o picker. Falha silenciosa
  // (sem alerta) — o picker cai pro modo 'novo' / fallback automaticamente
  // quando enderecosDoCliente.length === 0.
  const carregarEnderecosDoCliente = useCallback(async (clienteId: string) => {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/enderecos`, { cache: 'no-store' });
      const data = await res.json();
      const enderecos = (data?.enderecos || []) as EnderecoClienteUI[];
      setEnderecosDoCliente(enderecos);
      return enderecos;
    } catch (e) {
      console.error('Erro ao carregar enderecos do cliente', e);
      setEnderecosDoCliente([]);
      return [] as EnderecoClienteUI[];
    }
  }, []);

  // Abre o sub-picker de troca de endereco no modal de detalhe. Carrega
  // os enderecos do cliente do orcamento atual (se houver).
  const abrirTrocaEndereco = async () => {
    if (!orcamentoDetalhe?.clientes?.id) return;
    setMostrarTrocaEndereco(true);
    try {
      const res = await fetch(`/api/clientes/${orcamentoDetalhe.clientes.id}/enderecos`, { cache: 'no-store' });
      const data = await res.json();
      setEnderecosDetalhe((data?.enderecos || []) as EnderecoClienteUI[]);
    } catch (e) {
      console.error('Erro ao carregar enderecos pra troca', e);
      setEnderecosDetalhe([]);
    }
  };

  // PATCH /api/orcamentos/[id] com endereco_id e recarrega o detalhe.
  const trocarEnderecoDetalhe = async (novoEnderecoId: string) => {
    if (!orcamentoDetalhe) return;
    setTrocandoEndereco(true);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endereco_id: novoEnderecoId }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        alert(data?.error || 'Erro ao trocar endereco');
      } else {
        setMostrarTrocaEndereco(false);
        await abrirDetalhe(orcamentoDetalhe.id);
      }
    } catch (e) {
      console.error('Erro ao trocar endereco', e);
      alert('Erro ao trocar endereco');
    }
    setTrocandoEndereco(false);
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

  const adicionarItensAvulsos = (itens: Array<{nome: string; quantidade: number; preco: number; preco_custo?: number; especificacoes?: string; detalhamento_ferro?: Array<{ tipo_ferro: string; metros: number }>}>) => {
    itens.forEach(item => {
      const produtoAvulso: Produto = {
        id: 'ferro-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
        nome: item.nome,
        preco: item.preco,
        preco_custo: item.preco_custo || 0,
        estoque: 0,
        estoque_minimo: 0,
        abaixo_minimo: false,
        unidade: 'm',
        categoria: 'Ferro',
        codigo: '',
      };
      const novoItem: ItemOrcamento = {
        produto: produtoAvulso,
        quantidade: item.quantidade,
        avulso: true,
        preco_custom: item.preco,
        obs: item.especificacoes,
        detalhamento_ferro: item.detalhamento_ferro,
      };
      setItens(prev => [...prev, novoItem]);
    });
  };

  // Calculadora de Madeira: adiciona um item AVULSO (igual as ferragens) com
  // o detalhe do corte embutido no nome — "3x Viga Cambara 5x11 de 7m" — pra
  // o deposito saber as medidas a cortar. O detalhe sobrevive a persistencia
  // (orcamento_itens nao tem coluna propria) e aparece no pedido e nas
  // impressoes. Cada corte vira uma linha propria (id sintetico unico), entao
  // dois cortes do mesmo produto nao se fundem. Custo = snapshot do catalogo
  // (CMV via "Opcao B"); madeira e sob_demanda, logo nao mexe em estoque.
  const adicionarMadeiraCalculada = (produtoId: string, qtdPecas: number, metrosPorPeca: number, metrosTotal: number) => {
    const produto = produtos.find(p => p.id === produtoId);
    if (!produto || metrosTotal <= 0) return;
    const comprimentoLabel = String(metrosPorPeca).replace('.', ',');
    const nome = `${qtdPecas}× ${produto.nome} de ${comprimentoLabel}m`;
    const itemMadeira: Produto = {
      id: 'madeira-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      nome,
      preco: produto.preco,
      preco_custo: produto.preco_custo || 0,
      estoque: 0,
      estoque_minimo: 0,
      abaixo_minimo: false,
      unidade: produto.unidade,
      categoria: produto.categoria,
      codigo: '',
    };
    setItens(prev => [...prev, {
      produto: itemMadeira,
      quantidade: metrosTotal,
      avulso: true,
      preco_custom: produto.preco,
    }]);
  };

  // Calculadora de Laje (Batch D): a calculadora ja resolveu os produtos do
  // catalogo, entao cada linha vira um item com id sintetico (dois ambientes
  // com o mesmo kit nao se fundem) mas com produto_id_real preservado — assim
  // preco, CMV e baixa de estoque seguem o fluxo normal. O kit e sob_demanda
  // (nao baixa estoque); cimento/areia/pedra sao estocaveis e baixam certo.
  const adicionarLajeCalculada = (linhas: LinhaLaje[]) => {
    const novos: ItemOrcamento[] = linhas.map((l, idx) => ({
      produto: {
        id: 'laje-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).slice(2, 7),
        nome: l.nome,
        preco: l.preco,
        preco_custo: l.preco_custo,
        estoque: 0,
        estoque_minimo: 0,
        abaixo_minimo: false,
        unidade: l.unidade,
        categoria: 'Laje',
        codigo: '',
      },
      quantidade: l.quantidade,
      preco_custom: l.preco,
      produto_id_real: l.produto_id,
      laje_detalhes: l.laje_detalhes,
    }));
    setItens(prev => [...prev, ...novos]);
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

  // Preco unitario editavel por item. Grava em preco_custom (ja respeitado
  // em subtotal, envio e mensagem via `preco_custom ?? produto.preco`).
  // Passar null/valor igual ao preco do catalogo limpa o override.
  const setPrecoCustom = (produtoId: string, preco: number | null) => {
    setItens(prev => prev.map(i => {
      if (i.produto.id !== produtoId) return i;
      const limpo: ItemOrcamento = { ...i };
      if (preco === null || preco === i.produto.preco) {
        delete limpo.preco_custom;
        return limpo;
      }
      limpo.preco_custom = preco;
      return limpo;
    }));
  };

  const getQuantidade = (produtoId: string) => itens.find(i => i.produto.id === produtoId)?.quantidade || 0;

  const subtotal = itens.reduce((acc, item) => acc + ((item.preco_custom ?? item.produto.preco) * item.quantidade), 0);
  // Frete removido do orcamento (deposito nao cobra mais frete).
  const totalFrete = 0;
  const total = subtotal;
  const totalFinal = descontoCustom > 0 ? total * (1 - descontoCustom / 100) : total;

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
      if (!data.erro) {
        // Popula campos separados (source-of-truth do Step 4) E mantem
        // enderecoViaCEP concatenado em paralelo durante o deploy gap
        // (Tarefa 3 ainda envia cliente_endereco legacy ate Tarefa 4
        // ignorar). Pode ser removido junto com cliente_endereco quando
        // o legacy sair do payload.
        setRuaDestino(data.logradouro || '');
        setBairroDestino(data.bairro || '');
        setCidadeDestino(data.localidade || '');
        setEstadoDestino(data.uf || '');
        setEnderecoViaCEP(`${data.logradouro}, ${data.bairro}, ${data.localidade}-${data.uf}`);
      }
    } catch {}
  }, []);

  // Metros de ferragem no pedido em construcao = metro linear das pecas
  // montadas (mesma metrica da fila: quantidade dos itens que sao ferragem).
  // Itens da calculadora carregam detalhamento_ferro e tem quantidade em
  // metros; nao somar o detalhamento (isso e o ferro total, nao a peca).
  const metrosFerragemCarrinho = itens.reduce((s, it) => {
    const ehFerragem = Boolean((it as { detalhamento_ferro?: unknown[] }).detalhamento_ferro);
    return s + (ehFerragem ? (Number(it.quantidade) || 0) : 0);
  }, 0);

  // Projeta quando a ferragem deste pedido ficaria pronta, se entrasse na
  // fila agora. Recalcula quando muda o total de metros no carrinho.
  useEffect(() => {
    if (metrosFerragemCarrinho <= 0) { setPrevisaoFechar(null); return; }
    let cancelado = false;
    fetch(`/api/ferragem/fila?novo_metros=${metrosFerragemCarrinho}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelado && d.projecao_novo_pedido) setPrevisaoFechar(d.projecao_novo_pedido); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [metrosFerragemCarrinho]);

  // Fetch levas
  useEffect(() => {
    if (abaAtiva === 'ferragens') {
      carregarFerragens();
      carregarFerragensProducao();
      carregarFerragensProntas();
      carregarFerragemFila();
    }
    if (abaAtiva === 'entregas') {
      carregarLevas();
      // Load retiradas pendentes
      carregarRetiradas();
    }  }, [abaAtiva]);

  // Levas seguem a data escolhida no filtro de entregas. Antes buscava
  // sem filtro e o retorno vinha misturado com levas de qualquer dia.
  useEffect(() => {
    if (abaAtiva === 'entregas') carregarLevas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataEntregas]);

  // Smart address search - CEP only (street names must be picked from dropdown).
  // Frete desabilitado: apenas resolve o endereco via ViaCEP.
  const buscarEnderecoSmart = async (input: string) => {
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.length !== 8 || !/^\d{8}$/.test(cleaned)) {
      setErroFrete('Para endereço por nome de rua, selecione uma sugestão do menu. O botão Buscar funciona apenas com CEP (8 dígitos).');
      return;
    }
    setCepDestino(cleaned);
    setBuscaEndereco(input);
    setErroFrete('');
    setBuscandoEndereco(true);
    try {
      const viaRes = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
      const viaData = await viaRes.json();
      if (viaData.erro) {
        setErroFrete('CEP não encontrado.');
      } else {
        setRuaDestino(viaData.logradouro || '');
        setBairroDestino(viaData.bairro || '');
        setCidadeDestino(viaData.localidade || '');
        setEstadoDestino(viaData.uf || '');
        setEnderecoViaCEP(`${viaData.logradouro}, ${viaData.bairro}, ${viaData.localidade}-${viaData.uf}`);
      }
    } catch {
      setErroFrete('Erro ao buscar CEP.');
    }
    setBuscandoEndereco(false);
  };

  const resetarFormulario = () => {
    setItens([]);
    setNomeCliente('');
    setWhatsappCliente('');
    setCepDestino('');
    setDataEntrega('');
    setDataRetirada('');
    setNumeroEndereco('');
    setComplementoEndereco('');
    setRecebedor('');
    setObservacoes('');
    setBuscaEndereco('');
    setEnderecoViaCEP('');
    setTipoEntrega('retirada');
    setStatusPedidoForm('orcamento');
    setCondicaoPagamentoForm('a_vista');
    setVencimentoForm('');
    setFormaPagamentoForm('');
    setFonteVenda('');
    setDescontoCustom(0);
    setDescontoValorInput(0);
    setDescontoModo('pct');
    setSugestoesEndereco([]);
    setMostrandoSugestoes(false);
    setErroFrete('');
    setEditandoId(null);
    setClienteEncontrado(null);
    setMostrarSimulador(false);
    setEtapaOrcamento('catalogo');
    setEnderecosDoCliente([]);
    setEnderecoIdSelecionado(null);
    setModoEndereco('existente');
    setEnderecoNovoForm(ENDERECO_NOVO_VAZIO);
    setRuaDestino('');
    setBairroDestino('');
    setCidadeDestino('');
    setEstadoDestino('');
    setApelidoEndereco('');
  };

  // Cancelar edicao: limpa form + volta pra aba Historico (mesmo destino
  // do "salvar em edicao" pra o user nao ficar olhando form em branco).
  const cancelarEdicao = () => {
    resetarFormulario();
    setAbaAtiva('historico');
  };

  const salvarEGerarOrcamento = async () => {
    setSalvandoOrcamento(true);
    setOrcamentoSalvo(null);
    try {
      // Endereco agora vive exclusivamente em enderecos_clientes via
      // endereco_id ou endereco_novo (resolvidos logo abaixo). Os campos
      // cliente_cep/endereco/numero/complemento legacy nao sao mais
      // enviados — backend ja parou de usa-los no Step 4. States internos
      // (cepDestino, enderecoViaCEP, etc.) ficam, alimentam o form e o
      // payload endereco_novo.
      const payload: Record<string, unknown> = {
        cliente_nome: nomeCliente || 'Cliente',
        cliente_telefone: whatsappCliente || '00000000000',
        cliente_recebedor: recebedor || null,
        observacoes: observacoes || null,
        tipo_entrega: tipoEntrega,
        valor_frete: totalFrete,
        subtotal,
        total: totalFinal,
        desconto_percentual: descontoCustom > 0 ? descontoCustom : 0,
        desconto_valor: descontoCustom > 0 ? (total - totalFinal) : 0,
        data_entrega: tipoEntrega === 'entrega' && dataEntrega ? dataEntrega : null,
            observacoes_entrega: tipoEntrega === 'retirada' && dataRetirada ? `*Retirada na loja:* ${new Date(dataRetirada + 'T12:00:00').toLocaleDateString('pt-BR')}` : '',
            data_retirada: tipoEntrega === 'retirada' && dataRetirada ? dataRetirada : null,
            fonte: fonteVenda || null,
        status: statusPedidoForm || 'orcamento',
        condicao_pagamento: condicaoPagamentoForm || 'a_vista',
        vencimento: condicaoPagamentoForm === 'prazo' && vencimentoForm ? vencimentoForm : null,
        forma_pagamento: formaPagamentoForm || null,
        criado_por: user?.id ?? null,
        itens: itens.map(i => ({
          // Identidade do item existente (edicao): faz o backend ATUALIZAR no
          // lugar em vez de apagar+reinserir, preservando quantidade_entregue e
          // a FK de entregas_parciais_itens. Itens novos nao tem — viram INSERT.
          ...(i.orcamento_item_id ? { orcamento_item_id: i.orcamento_item_id } : {}),
          // Laje usa id sintetico na UI mas persiste o produto_id real
          // (produto_id_real) — ver adicionarLajeCalculada.
          produto_id: i.produto_id_real ?? (i.avulso ? null : i.produto.id),
          produto_nome: i.produto.nome,
          quantidade: i.quantidade,
          unidade: i.produto.unidade,
          preco_unitario: i.preco_custom ?? i.produto.preco,
          preco_custo: i.produto.preco_custo || 0,
          // Detalhamento por tipo de ferro (Batch B Fase 2): so vai pra
          // itens gerados pela calculadora de ferragem. Backend persiste
          // em ferragem_consumo; payloads sem o campo seguem inalterados.
          ...(i.detalhamento_ferro ? { detalhamento_ferro: i.detalhamento_ferro } : {}),
          // Dados tecnicos do ambiente (Batch D): so vao nos itens de kit de
          // laje. Backend persiste em laje_detalhes e imprime pra fabrica.
          ...(i.laje_detalhes ? { laje_detalhes: i.laje_detalhes } : {}),
        })),
      };

      // Resolve endereco do orcamento (Step 4 Tarefa 3):
      // 1. enderecoIdSelecionado set + modo='existente' -> body.endereco_id
      //    (picker, cliente escolheu existente).
      // 2. modo='novo' COM enderecoNovoForm preenchido -> body.endereco_novo
      //    a partir do sub-form do picker (cliente existente clicou
      //    "+ Novo endereço").
      // 3. Cliente novo / sem enderecos cadastrados -> body.endereco_novo
      //    a partir dos campos separados do form principal
      //    (ruaDestino/numeroEndereco/etc., Step 4 Tarefa 2).
      //
      // Campos cliente_* legacy continuam no payload em paralelo durante
      // o deploy gap entre essa Tarefa 3 e a Tarefa 4 (backend ignorar).
      // Limpeza fica pra sessao futura junto com o drop de clientes.endereco.
      if (tipoEntrega === 'entrega') {
        if (enderecoIdSelecionado && modoEndereco === 'existente') {
          payload.endereco_id = enderecoIdSelecionado;
        } else if (
          enderecosDoCliente.length > 0 &&
          modoEndereco === 'novo' &&
          enderecoNovoForm.rua.trim() &&
          enderecoNovoForm.numero.trim()
        ) {
          payload.endereco_novo = {
            apelido: enderecoNovoForm.apelido || null,
            cep: enderecoNovoForm.cep || null,
            rua: enderecoNovoForm.rua,
            numero: enderecoNovoForm.numero,
            complemento: enderecoNovoForm.complemento || null,
            bairro: enderecoNovoForm.bairro || null,
            cidade: enderecoNovoForm.cidade || null,
            estado: enderecoNovoForm.estado || null,
          };
        } else if (ruaDestino.trim() && numeroEndereco.trim()) {
          payload.endereco_novo = {
            apelido: apelidoEndereco || null,
            cep: cepDestino || null,
            rua: ruaDestino,
            numero: numeroEndereco,
            complemento: complementoEndereco || null,
            bairro: bairroDestino || null,
            cidade: cidadeDestino || null,
            estado: estadoDestino || null,
          };
        }
      }

      let savedId: string | null = null;
      if (editandoId) {
        const res = await fetch(`/api/orcamentos/${editandoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        // Antes o sucesso era decidido so por `data.codigo`; num 500/400 o
        // corpo traz `{ error }` sem codigo e o salvamento falhava em silencio
        // (nenhum alerta). Agora surfa o erro do backend pro usuario.
        if (!res.ok || data?.error) {
          setSalvandoOrcamento(false);
          alert(data?.error || 'Erro ao salvar o pedido.');
          return;
        }
        if (data.codigo || data.id) {
          savedId = data.id || editandoId;
          resetarFormulario();
        }
      } else {
        const res = await fetch('/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.error) {
          setSalvandoOrcamento(false);
          alert(data?.error || 'Erro ao salvar o pedido.');
          return;
        }
        if (data.codigo) {
          savedId = data.id;
          resetarFormulario();
        }
      }
      setSalvandoOrcamento(false);
      if (savedId) {
        // Criacao OU edicao: abre o modal de detalhe pra os atalhos de
        // gestao (WhatsApp, imprimir, status). Fluxo unificado pedido
        // pelo Roger — o atalho de WhatsApp pos-edicao economiza um
        // clique vs ir pra aba Historico e buscar o pedido manualmente.
        carregarHistorico();
        abrirDetalhe(savedId);
      }
    } catch (e) {
      console.error('Erro ao salvar orcamento', e);
      setSalvandoOrcamento(false);
    }
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
    // Itens da calculadora ja contem metragem total no nome (ex.: "... | 15.2m");
    // nao concatenar quantidade/unidade. Heuristica: nome contem "barras".
    const formatarItem = (nome: string, qtd: number, unidade: string | null | undefined, valor: number) => {
      const ehFerroMontado = (nome || '').toLowerCase().includes('barras');
      if (ehFerroMontado) return `· ${nome} = R$ ${formatBRL(valor)}`;
      const unidadeStr = unidade === 'm³' ? 'm³' : (unidade ? ' ' + unidade : '');
      return `· ${nome} ${qtd}${unidadeStr} = R$ ${formatBRL(valor)}`;
    };
    const fmtData = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
    const SEP = '------------------------------';

    if (detalhe) {
      const c = detalhe.clientes;
      const endCompleto = [
        c?.endereco,
        c?.numero ? `nº ${c.numero}` : '',
        c?.complemento,
        c?.bairro,
        c?.cidade ? `${c.cidade}-${c.estado}` : '',
      ].filter(Boolean).join(', ');
      const linhas = [
        '*ORÇAMENTO - Depósito Oliveira*',
        `Código: ${detalhe.codigo}`,
        SEP,
        `*Cliente:* ${c?.nome || 'Cliente'}`,
        c?.telefone ? `*Telefone:* ${c.telefone}` : '',
        c?.recebedor ? `*Recebedor:* ${c.recebedor}` : '',
        detalhe.tipo_entrega === 'entrega' && endCompleto ? `*Endereço:* ${endCompleto}` : '',
        detalhe.tipo_entrega === 'entrega' && detalhe.data_entrega
          ? `*Data de entrega:* ${fmtData(detalhe.data_entrega)}`
          : detalhe.tipo_entrega === 'retirada' && detalhe.data_retirada
            ? `*Data de retirada:* ${fmtData(detalhe.data_retirada)}`
            : '',
        SEP,
        '*Produtos:*',
        ...detalhe.orcamento_itens.map(i => formatarItem(i.produto_nome, Number(i.quantidade), i.unidade, Number(i.subtotal))),
        '',
        `*TOTAL: R$ ${formatBRL(detalhe.total)}*`,
        'Em até 3x sem juros',
      ].filter((l): l is string => typeof l === 'string' && l.length > 0);
      return linhas.join('\n');
    }

    const codigo = orcamentoSalvo?.codigo;
    const enderecoFmt = [
      enderecoViaCEP,
      numeroEndereco ? `nº ${numeroEndereco}` : '',
      complementoEndereco,
    ].filter(Boolean).join(', ');
    const linhas = [
      '*ORÇAMENTO - Depósito Oliveira*',
      codigo ? `Código: ${codigo}` : '',
      SEP,
      nomeCliente ? `*Cliente:* ${nomeCliente}` : '',
      whatsappCliente ? `*Telefone:* ${whatsappCliente}` : '',
      recebedor ? `*Recebedor:* ${recebedor}` : '',
      tipoEntrega === 'entrega' && enderecoFmt ? `*Endereço:* ${enderecoFmt}` : '',
      tipoEntrega === 'entrega' && dataEntrega
        ? `*Data de entrega:* ${fmtData(dataEntrega)}`
        : tipoEntrega === 'retirada' && dataRetirada
          ? `*Data de retirada:* ${fmtData(dataRetirada)}`
          : '',
      SEP,
      '*Produtos:*',
      ...itens.map(i => formatarItem(
        i.produto.nome,
        i.quantidade,
        i.produto.unidade,
        (i.preco_custom ?? i.produto.preco) * i.quantidade,
      )),
      '',
      `*TOTAL: R$ ${formatBRL(totalFinal)}*`,
      'Em até 3x sem juros',
    ].filter((l): l is string => typeof l === 'string' && l.length > 0);
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
    // Bloco DADOS PARA A FABRICA (Batch D): so aparece se o pedido tem kit de
    // laje. Funciona tanto pro orcamento salvo (laje_detalhes vem do GET) como
    // pro carrinho ainda nao salvo (laje_detalhes esta no proprio item).
    const lajesImp: Array<{ nome: string; det: DetalhesLaje }> = d
      ? d.orcamento_itens.flatMap(i => {
          const det = i.laje_detalhes?.[0];
          return det ? [{ nome: i.produto_nome, det }] : [];
        })
      : itens.flatMap(i => (i.laje_detalhes ? [{ nome: i.produto.nome, det: i.laje_detalhes }] : []));
    const num = (v: number) => String(v).replace('.', ',');
    const blocoFabrica = lajesImp.length === 0 ? '' :
      `<div class="fabrica"><div class="fabrica-t">&#127981; DADOS PARA A FÁBRICA</div>` +
      lajesImp.map(({ nome, det }) => {
        const medidas = det.comprimento && det.largura
          ? `${num(det.comprimento)}m × ${num(det.largura)}m`
          : '—';
        const alerta = det.vao_livre > 5
          ? `<div class="fabrica-alerta">&#9888; VÃO GRANDE (acima de 5m) — especificação obrigatória da fábrica.</div>`
          : '';
        return `<div class="fabrica-item"><b>${nome}</b><div class="fabrica-g">` +
          `<span><b>Ambiente:</b> ${medidas}</span>` +
          `<span><b>Área:</b> ${formatBRL(det.area_m2)} m²</span>` +
          `<span><b>Vão livre:</b> ${num(det.vao_livre)} m</span>` +
          `<span><b>Uso:</b> ${det.uso === 'piso' ? 'Piso' : 'Forro'}</span>` +
          `<span><b>Viga intermediária:</b> ${det.tem_viga_intermediaria ? 'Sim' : 'Não'}</span>` +
          `</div>${alerta}</div>`;
      }).join('') +
      `<div class="fabrica-aviso">${AVISO_LAJE}</div></div>`;

    const nome = d ? (d.clientes?.nome || 'Cliente') : (nomeCliente || 'Cliente');
    const tel = d ? (d.clientes?.telefone || '') : whatsappCliente;
    const cod = d ? d.codigo : (orcamentoSalvo?.codigo || '');
    const sub = d ? d.subtotal : subtotal;
    const tot = d ? d.total : total;
    const tipo = d ? d.tipo_entrega : tipoEntrega;
    // Prefere endereco_completo (REAL do pedido, Step 2). Fallback pro
    // legacy clientes.endereco em orfaos (endereco_completo NULL).
    const end = d
      ? (d.endereco_completo
          ? [d.endereco_completo.rua, d.endereco_completo.numero ? `nº ${d.endereco_completo.numero}` : '', d.endereco_completo.complemento, d.endereco_completo.bairro, d.endereco_completo.cidade ? `${d.endereco_completo.cidade}-${d.endereco_completo.estado || ''}` : ''].filter(Boolean).join(', ')
          : [d.clientes?.endereco, d.clientes?.numero ? `nº ${d.clientes.numero}` : '', d.clientes?.complemento, d.clientes?.bairro, d.clientes?.cidade ? `${d.clientes.cidade}-${d.clientes.estado}` : ''].filter(Boolean).join(', '))
      : enderecoViaCEP;
    const dataEnt = d ? d.data_entrega : (tipoEntrega === 'entrega' ? dataEntrega : '');
    const dataRet = d ? (d as any).data_retirada : (tipoEntrega === 'retirada' ? dataRetirada : '');
    const dataCriacao = d ? new Date(d.criado_em).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
    const obsImp = d ? d.observacoes : (observacoes || null);
    // Documento do cliente: mostra a CONDICAO combinada (À vista / Na entrega /
    // A prazo), nao o status_pagamento cru — "Pendente" numa folha de orcamento
    // assusta o cliente sem necessidade. O "Status pag." so aparece quando ja
    // houve pagamento de verdade (valor_pago), nunca como "Pendente".
    const condicaoPagImp = d ? ((d as any).condicao_pagamento as string | null) : (condicaoPagamentoForm || null);
    const vencImp = d ? ((d as any).vencimento as string | null) : (condicaoPagamentoForm === 'prazo' ? (vencimentoForm || null) : null);
    const valorPagoImp = d ? (Number((d as any).valor_pago) || 0) : 0;
    const parcelasImp = montarParcelasCartao(tot, ACRESCIMO_CARTAO);
    const semJurosImp = parcelasImp.semJuros.map(p => p.n + 'x R$ ' + formatBRL(p.valor)).join('  |  ');
    const comAcrescimoImp = parcelasImp.comAcrescimo.map(p => p.n + 'x R$ ' + formatBRL(p.valor)).join('  |  ');
    // Obs sem o bloco FERRAGEM (que vai pro romaneio da fabrica, nao aqui).
    const rawObsImp = obsImp || '';
    const fiFerrImp = rawObsImp.indexOf('FERRAGEM:');
    const obsLimpaImp = (fiFerrImp >= 0 ? rawObsImp.substring(0, fiFerrImp) : rawObsImp).trim();
    const obsBoxImp = obsLimpaImp
      ? '<div class="callout obs-box"><span class="clabel">Obs:</span> ' + obsLimpaImp + '</div>'
      : '';
    // Situacao de pagamento. Tres casos, porque a prazo NAO se cobra na
    // entrega — nao pode cair no mesmo balde do "a pagar".
    const saldoImp = tot - valorPagoImp;
    let payBoxImp = '';
    if (valorPagoImp > 0 && saldoImp <= 0.01) {
      payBoxImp = '<div class="callout pay-ok"><span class="clabel">Pagamento:</span> ✓ Pago</div>';
    } else if (condicaoPagImp === 'prazo') {
      payBoxImp = '<div class="callout pay-prazo"><span class="clabel">Pagamento:</span> A prazo'
        + (vencImp ? ' · vence ' + new Date(vencImp + 'T12:00:00').toLocaleDateString('pt-BR') : '')
        + '</div>';
    } else {
      const rotuloImp = tipo === 'entrega' ? 'A pagar na entrega' : 'A pagar';
      payBoxImp = '<div class="callout pay-cobrar"><span class="clabel">' + rotuloImp + ':</span> R$ ' + formatBRL(saldoImp)
        + (valorPagoImp > 0 ? ' (já pago R$ ' + formatBRL(valorPagoImp) + ' de R$ ' + formatBRL(tot) + ')' : '')
        + '</div>';
    }
    const htmlImp = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orçamento ${cod}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:15px;color:#333;margin:0;padding:0}.hdr{display:flex;align-items:center;gap:16px;margin-bottom:12px}.hdr img{height:64px;width:auto}.hdr h1{margin:0;font-size:22px;color:#F7941D}.hdr p{margin:3px 0;color:#666;font-size:13px}hr{border:none;border-top:2px solid #F7941D;margin:10px 0}.ig{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:8px 0}.ir{font-size:14px;line-height:1.8}.full{grid-column:1/-1}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}th{background:#F7941D;color:white;padding:8px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #eee}.tr{text-align:right}.tc{text-align:center}tfoot td{font-weight:bold;border-top:2px solid #F7941D;border-bottom:none}.totrow td{font-size:20px;color:#F7941D;padding:8px 10px}.pagto{margin:10px 0;padding:10px 14px;border:1px solid #ddd;border-radius:6px;background:#fffbf0;font-size:14px}.pagto-row{margin:4px 0;font-size:13px}.pagto-row b{color:#333}.ftr{margin-top:10px;padding-top:8px;border-top:1px solid #ddd;font-size:12px;color:#999;text-align:center}.fabrica{margin:12px 0;border:2px solid #333;border-radius:6px;padding:10px 14px;background:#f7f7f7;page-break-inside:avoid}.fabrica-t{font-weight:bold;font-size:14px;letter-spacing:.5px;margin-bottom:8px;color:#111}.fabrica-item{margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #ccc;font-size:13px}.fabrica-item:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}.fabrica-g{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:4px;font-size:12px;color:#444}.fabrica-alerta{margin-top:6px;padding:5px 8px;background:#ffe5e5;border:1px solid #d33;border-radius:4px;color:#a00;font-weight:bold;font-size:12px}.fabrica-aviso{margin-top:8px;padding-top:6px;border-top:1px solid #ccc;font-size:11px;color:#666;font-style:italic}.callout{margin:7px 0;padding:7px 12px;border:1px solid #eee;border-left-width:3px;border-radius:5px;font-size:13.5px;line-height:1.4;background:#fafafa;color:#374151}.callout .clabel{font-weight:700}.obs-box{border-left-color:#F7941D}.pay-ok{border-left-color:#16a34a;color:#15803d}.pay-cobrar{border-left-color:#d97706;color:#92400e}.pay-prazo{border-left-color:#ca8a04;color:#a16207}</style></head><body><div class="hdr"><img src="${logoBase64||'/logo.png'}" alt="Logo"/><div><h1>Depósito Oliveira</h1><p>Materiais de Construção</p><p>Av. Inocêncio Seráfico, 4020 - Centro | Carapicuíba - SP, 06380-021</p><p>Tel: (11) 4187-1801</p></div></div><hr/><div class="ig">${cod?'<div class="ir"><b>Código:</b> '+cod+'</div>':''}<div class="ir"><b>Data:</b> ${dataCriacao}</div><div class="ir"><b>Cliente:</b> ${nome}</div>${tel?'<div class="ir"><b>Telefone:</b> '+tel+'</div>':''}<div class="ir"><b>Entrega:</b> ${tipo==='entrega'?'Entrega no endereço':'Retirada na loja'}</div>${tipo==='entrega'&&end?'<div class="ir full"><b>Endereço:</b> '+end+'</div>':''}${dataEnt?'<div class="ir"><b>Data entrega:</b> '+new Date(dataEnt+'T12:00:00').toLocaleDateString('pt-BR')+'</div>':''}${dataRet?'<div class="ir"><b>Data retirada:</b> '+new Date(dataRet+'T12:00:00').toLocaleDateString('pt-BR')+'</div>':''}</div>${obsBoxImp}${payBoxImp}<table><thead><tr><th>Produto</th><th class="tc">Qtd</th><th class="tc">Un</th><th class="tr">Unit.</th><th class="tr">Total</th></tr></thead><tbody>${itensHtml}</tbody><tfoot><tr><td colspan="4" class="tr">Subtotal:</td><td class="tr">R$ ${formatBRL(sub)}</td></tr><tr class="totrow"><td colspan="4" class="tr">TOTAL:</td><td class="tr">R$ ${formatBRL(tot)}</td></tr></tfoot></table><div class="pagto"><div class="pagto-row"><b>&#128181; À vista (PIX/dinheiro):</b> R$ ${formatBRL(tot)}</div><div class="pagto-row"><b>&#128179; Cartão até 3x sem juros:</b> ${semJurosImp}</div><div class="pagto-row"><b>&#128179; Cartão 4x-6x (+8%):</b> ${comAcrescimoImp}</div></div>${blocoFabrica}<div class="ftr">Orçamento válido por 7 dias &middot; Sujeito à disponibilidade de estoque</div></body></html>`;
    printWindow.document.write(htmlImp);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  // Comprovante por leva: apenas itens dessa entrega + assinatura. Sem progresso cumulativo nem precos.
  const imprimirEntregaParcial = (ep: EntregaParcial) => {
    if (!orcamentoDetalhe) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const d = orcamentoDetalhe;
    const nome = d.clientes?.nome || 'Cliente';
    const tel = d.clientes?.telefone || '';
    const cod = d.codigo;
    const tipo = d.tipo_entrega;
    const end = d.endereco_completo
      ? [d.endereco_completo.rua, d.endereco_completo.numero ? `nº ${d.endereco_completo.numero}` : '', d.endereco_completo.complemento, d.endereco_completo.bairro, d.endereco_completo.cidade ? `${d.endereco_completo.cidade}-${d.endereco_completo.estado || ''}` : ''].filter(Boolean).join(', ')
      : [d.clientes?.endereco, d.clientes?.numero ? `nº ${d.clientes.numero}` : '', d.clientes?.complemento, d.clientes?.bairro, d.clientes?.cidade ? `${d.clientes.cidade}-${d.clientes.estado}` : ''].filter(Boolean).join(', ');
    const dataFmt = ep.data_entrega
      ? new Date(ep.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')
      : new Date(ep.criado_em).toLocaleDateString('pt-BR');
    const itensHtml = ep.entregas_parciais_itens.map(epi => `<tr><td style="padding:9px 12px;border-bottom:1px solid #eee">${epi.orcamento_itens?.produto_nome || '—'}</td><td style="padding:9px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold">${epi.quantidade}</td><td style="padding:9px 12px;border-bottom:1px solid #eee;text-align:center">${epi.orcamento_itens?.unidade || ''}</td></tr>`).join('');
    const obs = ep.observacoes ? `<p style="margin:10px 0;padding:8px 10px;background:#f9fafb;border-left:3px solid #4338ca;font-size:13px;color:#555"><b>Observações:</b> ${ep.observacoes}</p>` : '';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Entrega ${cod} #${ep.numero_entrega}</title><style>@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:15px;color:#333;margin:0;padding:0}.hdr{display:flex;align-items:center;gap:16px;margin-bottom:12px}.hdr img{height:64px;width:auto}.hdr h1{margin:0;font-size:22px;color:#F7941D}.hdr p{margin:3px 0;color:#666;font-size:13px}hr{border:none;border-top:2px solid #F7941D;margin:10px 0}.title{font-size:18px;font-weight:bold;color:#4338ca;margin:14px 0 4px}.subtitle{font-size:12px;color:#666;margin-bottom:10px}.ig{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:8px 0}.ir{font-size:14px;line-height:1.8}.full{grid-column:1/-1}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}th{background:#4338ca;color:white;padding:10px 12px;text-align:left}.tc{text-align:center}.sign{margin-top:50px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.sign-box{border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;color:#666}.ftr{margin-top:30px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#999;text-align:center}</style></head><body><div class="hdr"><img src="${logoBase64||'/logo.png'}" alt="Logo"/><div><h1>Depósito Oliveira</h1><p>Materiais de Construção</p><p>Av. Inocêncio Seráfico, 4020 - Centro | Carapicuíba - SP, 06380-021</p><p>Tel: (11) 4187-1801</p></div></div><hr/><p class="title">Comprovante de Entrega #${ep.numero_entrega}</p><p class="subtitle">Itens desta entrega — pedido ${cod}</p><div class="ig"><div class="ir"><b>Pedido:</b> ${cod}</div><div class="ir"><b>Data:</b> ${dataFmt}</div><div class="ir"><b>Cliente:</b> ${nome}</div>${tel?'<div class="ir"><b>Telefone:</b> '+tel+'</div>':''}<div class="ir"><b>Tipo:</b> ${tipo==='entrega'?'Entrega no endereço':'Retirada na loja'}</div>${tipo==='entrega'&&end?'<div class="ir full"><b>Endereço:</b> '+end+'</div>':''}</div><table><thead><tr><th>Produto</th><th class="tc">Quantidade</th><th class="tc">Unidade</th></tr></thead><tbody>${itensHtml}</tbody></table>${obs}<div class="sign"><div class="sign-box">Entregue por</div><div class="sign-box">Recebido por (assinatura)</div></div><div class="ftr">Depósito Oliveira · Comprovante da entrega #${ep.numero_entrega} do pedido ${cod}</div></body></html>`;
    printWindow.document.write(html);
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

  const carregarEntregasParciais = async (orcamentoId: string) => {
    try {
      const res = await fetch(`/api/entregas-parciais?orcamento_id=${orcamentoId}`, { cache: 'no-store' });
      const data = await res.json();
      setEntregasParciais(data.entregas || []);
    } catch (e) {
      console.error('Erro ao carregar entregas parciais', e);
      setEntregasParciais([]);
    }
  };

  const abrirDetalhe = async (id: string) => {
    setLoadingDetalhe(true);
    setMostrarDetalhe(true);
    setEntregasParciais([]);
    setMostrarTrocaEndereco(false);
    setEnderecosDetalhe([]);
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
        carregarEntregasParciais(id);
        carregarPagamentosDetalhe(id);
      }
    } catch (e) { console.error('Erro ao carregar detalhe', e); }
    setLoadingDetalhe(false);
  };

  const carregarPagamentosDetalhe = async (id: string) => {
    try {
      const res = await fetch(`/api/pagamentos?orcamento_id=${id}`, { cache: 'no-store' });
      const data = await res.json();
      setPagamentosDetalhe(Array.isArray(data) ? data : []);
    } catch { setPagamentosDetalhe([]); }
  };

  // Admin: remove um pagamento lancado errado. O trigger recalcula o saldo e
  // o status_pagamento volta sozinho (pago -> parcial/pendente).
  const estornarPagamento = async (pagamentoId: string) => {
    if (!orcamentoDetalhe) return;
    if (!window.confirm('Remover este pagamento? O pedido volta a ficar em aberto.')) return;
    try {
      const res = await fetch(`/api/pagamentos?id=${pagamentoId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { alert(json.error || 'Erro ao remover pagamento'); return; }
      setOrcamentoDetalhe({
        ...orcamentoDetalhe,
        valor_pago: Number(json.orcamento?.valor_pago) || 0,
        status_pagamento: json.orcamento?.status_pagamento ?? orcamentoDetalhe.status_pagamento,
      });
      carregarPagamentosDetalhe(orcamentoDetalhe.id);
      carregarHistorico();
    } catch { alert('Erro de conexao'); }
  };

  const finalizarVendaPDV = async () => {
    if (!pdvNome.trim()) { alert('Informe o nome do cliente'); return; }
    if (pdvItens.length === 0) { alert('Adicione pelo menos um produto'); return; }
    setSalvandoPDV(true);
    try {
      const subtotal = pdvItens.reduce((s, i) => s + (i.preco_custom ?? i.produto.preco) * i.quantidade, 0);
      const payload = {
        cliente_nome: pdvNome.trim(),
        cliente_telefone: pdvTelefone.replace(/\D/g, '') || '',
        tipo_entrega: 'retirada',
        valor_frete: 0,
        subtotal,
        total: subtotal,
        status: 'retirada_pendente',
        // Venda no balcao paga na hora: o dinheiro vira uma linha em
        // `pagamentos`, e o status_pagamento sai disso. Nao existe mais
        // pedido "nascer pago" sem pagamento registrado.
        pagamento_inicial:
          pdvStatusPagamento === 'pago'
            ? { valor: subtotal, metodo: pdvFormaPagamento || 'outro' }
            : undefined,
        forma_pagamento: pdvFormaPagamento,
        fonte: 'pdv',
        criado_por: user?.id ?? null,
        itens: pdvItens.map(i => ({
          produto_id: i.produto.id,
          produto_nome: i.produto.nome,
          quantidade: i.quantidade,
          unidade: i.produto.unidade,
          preco_unitario: i.preco_custom ?? i.produto.preco,
          preco_custo: i.produto.preco_custo || 0,
        })),
      };
      const res = await fetch('/api/orcamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || 'Erro ao finalizar venda');
      } else {
        setMostrarPDV(false);
        setPdvNome(''); setPdvTelefone(''); setPdvItens([]); setPdvBusca('');
        carregarHistorico();
        // Abre detalhe completo da venda recem-criada
        if (data.id) abrirDetalhe(data.id);
      }
    } catch (e) {
      console.error('Erro PDV', e);
      alert('Erro ao finalizar venda.');
    }
    setSalvandoPDV(false);
  };

  const abrirRegistrarParcial = () => {
    if (!orcamentoDetalhe) return;
    const init: Record<string, string> = {};
    for (const it of orcamentoDetalhe.orcamento_itens) {
      const restante = Number(it.quantidade) - (Number(it.quantidade_entregue) || 0);
      if (restante > 1e-9) init[it.id] = '';
    }
    setParcialQtds(init);
    setParcialObs('');
    setMostrarRegistrarParcial(true);
  };

  const confirmarEntregaParcial = async () => {
    if (!orcamentoDetalhe) return;
    if (salvandoParcial) return; // evita double-submit que criaria entradas duplicadas
    const itensPayload: Array<{ orcamento_item_id: string; quantidade: number }> = [];
    for (const [itemId, valor] of Object.entries(parcialQtds)) {
      const q = parseFloat((valor || '').replace(',', '.'));
      if (!isNaN(q) && q > 0) itensPayload.push({ orcamento_item_id: itemId, quantidade: q });
    }
    if (itensPayload.length === 0) {
      alert('Informe pelo menos uma quantidade.');
      return;
    }
    setSalvandoParcial(true);
    try {
      const res = await fetch('/api/entregas-parciais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orcamento_id: orcamentoDetalhe.id,
          itens: itensPayload,
          observacoes: parcialObs || null,
        }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || 'Erro ao registrar entrega parcial');
      } else {
        setMostrarRegistrarParcial(false);
        setParcialQtds({});
        setParcialObs('');
        // Recarrega detalhe e historico
        const orcRes = await fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, { cache: 'no-store' });
        const orc = await orcRes.json();
        if (orc && !orc.error) {
          setOrcamentoDetalhe({
            ...orc,
            reagendamentos: orc.reagendamentos ?? 0,
            orcamento_itens: orc.orcamento_itens || [],
            observacoes: orc.observacoes || null,
            clientes: orc.clientes || null,
          });
        }
        carregarEntregasParciais(orcamentoDetalhe.id);
        carregarHistorico();
        if (data.tudo_entregue) {
          alert('✅ Tudo entregue! Pedido marcado como completo.');
        }
      }
    } catch (e) {
      console.error('Erro ao registrar entrega parcial', e);
      alert('Erro ao registrar entrega parcial.');
    }
    setSalvandoParcial(false);
  };

  const cancelarEntregaParcial = async (id: string) => {
    if (!orcamentoDetalhe) return;
    if (cancelandoParcial) return; // evita double-submit
    setCancelandoParcial(true);
    try {
      const res = await fetch(`/api/entregas-parciais/${id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || 'Erro ao cancelar entrega parcial');
      } else {
        setEntregaParaCancelar(null);
        // Recarrega detalhe e historico
        const orcRes = await fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, { cache: 'no-store' });
        const orc = await orcRes.json();
        if (orc && !orc.error) {
          setOrcamentoDetalhe({
            ...orc,
            reagendamentos: orc.reagendamentos ?? 0,
            orcamento_itens: orc.orcamento_itens || [],
            observacoes: orc.observacoes || null,
            clientes: orc.clientes || null,
          });
        }
        carregarEntregasParciais(orcamentoDetalhe.id);
        carregarHistorico();
      }
    } catch (e) {
      console.error('Erro ao cancelar entrega parcial', e);
      alert('Erro ao cancelar entrega parcial.');
    }
    setCancelandoParcial(false);
  };

  const marcarTudoEntregue = async () => {
    if (!orcamentoDetalhe) return;
    const pendentes = orcamentoDetalhe.orcamento_itens
      .map(it => ({
        orcamento_item_id: it.id,
        quantidade: Number(it.quantidade) - (Number(it.quantidade_entregue) || 0),
      }))
      .filter(p => p.quantidade > 1e-9);
    if (pendentes.length === 0) {
      alert('Não há itens pendentes.');
      return;
    }
    if (!confirm('Marcar TODO o restante como entregue nesta viagem?')) return;
    setMarcandoTudoEntregue(true);
    try {
      const res = await fetch('/api/entregas-parciais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orcamento_id: orcamentoDetalhe.id,
          itens: pendentes,
          observacoes: 'Última viagem — restante entregue',
        }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || 'Erro ao marcar tudo entregue');
      } else {
        const orcRes = await fetch(`/api/orcamentos/${orcamentoDetalhe.id}`, { cache: 'no-store' });
        const orc = await orcRes.json();
        if (orc && !orc.error) {
          setOrcamentoDetalhe({
            ...orc,
            reagendamentos: orc.reagendamentos ?? 0,
            orcamento_itens: orc.orcamento_itens || [],
            observacoes: orc.observacoes || null,
            clientes: orc.clientes || null,
          });
        }
        carregarEntregasParciais(orcamentoDetalhe.id);
        carregarHistorico();
      }
    } catch (e) {
      console.error('Erro ao marcar tudo entregue', e);
      alert('Erro ao marcar tudo entregue.');
    }
    setMarcandoTudoEntregue(false);
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
    // Prefere endereco_completo do orcamento (endereco REAL gravado nele,
    // Step 2). Fallback pro clientes.endereco legacy quando endereco_completo
    // for null — orcamentos antigos (~74 orfaos do backfill) e PDV sem
    // endereco caem aqui sem regressao.
    const ec = detalhe.endereco_completo;
    if (ec) {
      setRuaDestino(ec.rua || '');
      setBairroDestino(ec.bairro || '');
      setCidadeDestino(ec.cidade || '');
      setEstadoDestino(ec.estado || '');
      if (ec.rua) setEnderecoViaCEP([ec.rua, ec.bairro, ec.cidade ? `${ec.cidade}-${ec.estado || ''}` : null].filter(Boolean).join(', '));
      if (ec.cep) { setCepDestino(ec.cep); setBuscaEndereco(ec.cep); }
      setNumeroEndereco(ec.numero || '');
      setComplementoEndereco(ec.complemento || '');
    } else {
      // Orfaos (endereco_completo NULL): fallback best-effort no legacy.
      // Campos separados ficam preenchidos so com o que clientes tem
      // estruturado (bairro/cidade/estado). rua = clientes.endereco
      // inteiro (best-effort, pode conter "rua, bairro, cidade"
      // concatenado). User edita manualmente antes de salvar.
      setRuaDestino(detalhe.clientes?.endereco || '');
      setBairroDestino(detalhe.clientes?.bairro || '');
      setCidadeDestino(detalhe.clientes?.cidade || '');
      setEstadoDestino(detalhe.clientes?.estado || '');
      if (detalhe.clientes?.endereco) setEnderecoViaCEP(detalhe.clientes.endereco);
      if (detalhe.clientes?.cep) { setCepDestino(detalhe.clientes.cep); setBuscaEndereco(detalhe.clientes.cep); }
      setNumeroEndereco(detalhe.clientes?.numero || '');
      setComplementoEndereco(detalhe.clientes?.complemento || '');
    }
    setRecebedor(detalhe.clientes?.recebedor || '');
    // Carrega enderecos do cliente pra alimentar o picker e pre-seleciona
    // o endereco_id atual do pedido (quando existir).
    if (detalhe.clientes?.id) {
      void carregarEnderecosDoCliente(detalhe.clientes.id);
    } else {
      setEnderecosDoCliente([]);
    }
    setEnderecoIdSelecionado(detalhe.endereco_id || null);
    setModoEndereco('existente');
    setEnderecoNovoForm(ENDERECO_NOVO_VAZIO);
    setObservacoes(detalhe.observacoes || '');
    // Restaura o ajuste (desconto) do pedido. Sem isto o form reabria com
    // desconto zerado (ou herdava o do pedido editado antes), e ao salvar o
    // desconto se perdia no total. descontoCustom e sempre em %; descontoValorInput
    // guarda o R$ pro modo=valor.
    const pctSalvo = Number(detalhe.desconto_percentual) || 0;
    setDescontoCustom(pctSalvo);
    setDescontoValorInput(Number(detalhe.desconto_valor) || 0);
    setDescontoModo('pct');
    setStatusPedidoForm(detalhe.status || 'orcamento');
    setCondicaoPagamentoForm(detalhe.condicao_pagamento || 'a_vista');
    setVencimentoForm(detalhe.vencimento || '');
    setFormaPagamentoForm(detalhe.forma_pagamento || '');
    const cartItems: ItemOrcamento[] = detalhe.orcamento_itens.map((oi, idx) => {
      // Detalhamento de ferro persistido (ferragem_consumo). Restaurado pra que
      // salvar a edicao nao apague o consumo de ferro do item. So vira campo se
      // houver linhas.
      const detFerro = (oi.ferragem_consumo && oi.ferragem_consumo.length > 0)
        ? oi.ferragem_consumo.map(f => ({ tipo_ferro: f.tipo_ferro, metros: Number(f.metros) }))
        : undefined;
      // Itens avulsos (ferro) têm produto_id null — restaurar como avulso.
      // preco_custo vem do snapshot gravado na criacao (CLAUDE.md "Opcao B").
      if (oi.produto_id === null) {
        return {
          produto: {
            id: 'avulso-' + idx,
            nome: oi.produto_nome,
            preco: oi.preco_unitario,
            estoque: 999,
            unidade: oi.unidade || 'm',
            categoria: 'Ferro',
            preco_custo: oi.preco_custo ?? 0,
            estoque_minimo: 0,
            abaixo_minimo: false,
          },
          quantidade: oi.quantidade,
          avulso: true,
          preco_custom: oi.preco_unitario,
          orcamento_item_id: oi.id,
          quantidade_entregue: Number(oi.quantidade_entregue) || 0,
          ...(detFerro ? { detalhamento_ferro: detFerro } : {}),
        };
      }
      // Produto normal: prefere snapshot do orcamento (preco real no
      // momento da venda); fallback pro custo atual do produto pra
      // pedidos antigos pre-snapshot. Alinha com CLAUDE.md Opcao B.
      const matchProduto = produtos.find(p => p.nome === oi.produto_nome);
      const precoCatalogo = matchProduto?.preco ?? oi.preco_unitario;
      // Kit de laje (Batch D): restaura com id sintetico + produto_id_real pra
      // dois ambientes com o mesmo kit nao se fundirem numa linha, e carrega os
      // dados tecnicos de volta pro carrinho — sem isso o PATCH recriaria os
      // itens sem laje_detalhes e a fabrica perderia as medidas.
      const detLaje = oi.laje_detalhes?.[0];
      return {
        produto: {
          id: detLaje
            ? 'laje-' + (oi.id || idx)
            : (matchProduto?.id || String(oi.produto_id || ('item-' + idx))),
          nome: oi.produto_nome,
          preco: precoCatalogo,
          estoque: matchProduto?.estoque ?? 999,
          unidade: oi.unidade || matchProduto?.unidade || 'un',
          categoria: matchProduto?.categoria || 'Geral',
          preco_custo: oi.preco_custo ?? matchProduto?.preco_custo ?? 0,
          estoque_minimo: matchProduto?.estoque_minimo ?? 0,
          abaixo_minimo: matchProduto?.abaixo_minimo ?? false,
        },
        quantidade: oi.quantidade,
        orcamento_item_id: oi.id,
        quantidade_entregue: Number(oi.quantidade_entregue) || 0,
        // Preserva preco editado manualmente na venda: se o preco salvo
        // difere do catalogo atual, restaura como override pra nao reverter
        // silenciosamente ao reabrir o pedido pra edicao.
        ...(oi.preco_unitario !== precoCatalogo ? { preco_custom: oi.preco_unitario } : {}),
        ...(detLaje && oi.produto_id
          ? { produto_id_real: String(oi.produto_id), laje_detalhes: detLaje }
          : {}),
        ...(detFerro ? { detalhamento_ferro: detFerro } : {}),
      };
    });
    setItens(cartItems);
    setMostrarDetalhe(false);
    setOrcamentoDetalhe(detalhe);
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
      // carregarMotoristas() so recarrega o cadastro de motoristas e nao
      // atualiza a entrega na tela. O que precisa voltar do servidor sao as
      // entregas, que agora trazem motorista_id.
      await carregarEntregasDia();
      await carregarEntregas();
    } catch (e) {
      console.error('Erro ao atribuir motorista', e);
      alert(e instanceof Error ? e.message : 'Erro ao atribuir motorista');
    }
    setAtribuindoMotorista(null);
    setMostrarAtribuirMotorista(false);
    setEntregaSelecionadaId(null);
  };

  const atribuirTodosMotorista = async (motoristaId: string) => {
    if (!entregasRota || !Array.isArray(entregasRota.rota_otimizada)) return;
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
  // Data alvo da aba de entregas. Default = amanha, igual ao valor exibido no
  // input de data. Centralizado porque levas e entregas tem que usar a mesma.
  const dataEntregasAlvo = () => {
    if (dataEntregas) return dataEntregas;
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    return amanha.toISOString().slice(0, 10);
  };

  const carregarLevas = async () => {
    setCarregandoLevas(true);
    setErroLevas(null);
    try {
      const res = await fetch('/api/levas?data=' + dataEntregasAlvo(), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar levas');
      setLevas(data.levas || []);
    } catch (e) {
      // Silenciar erro aqui foi o que escondeu o PGRST200 do embed por meses.
      console.error('Erro ao carregar levas', e);
      setErroLevas(e instanceof Error ? e.message : 'Erro ao carregar levas');
      setLevas([]);
    }
    setCarregandoLevas(false);
  };

  const criarLevaComSelecionadas = async () => {
    if (selecionadas.length === 0) return;
    setAcaoLeva('criando');
    try {
      const res = await fetch('/api/levas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: dataEntregasAlvo(),
          motorista_id: motoristaNovaLeva || null,
          orcamento_ids: selecionadas,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar leva');
      setSelecionadas([]);
      setMotoristaNovaLeva('');
      await Promise.all([carregarLevas(), carregarEntregasDia()]);
    } catch (e) {
      console.error('Erro ao criar leva', e);
      alert(e instanceof Error ? e.message : 'Erro ao criar leva');
    }
    setAcaoLeva(null);
  };

  const patchLeva = async (levaId: string, body: Record<string, unknown>, marcador: string) => {
    setAcaoLeva(marcador);
    try {
      const res = await fetch('/api/levas/' + levaId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao atualizar leva');
      await Promise.all([carregarLevas(), carregarEntregasDia()]);
    } catch (e) {
      console.error('Erro ao atualizar leva', e);
      alert(e instanceof Error ? e.message : 'Erro ao atualizar leva');
    }
    setAcaoLeva(null);
  };

  const adicionarSelecionadasNaLeva = (levaId: string) =>
    patchLeva(levaId, { action: 'add_entregas', orcamento_ids: selecionadas }, 'add-' + levaId)
      .then(() => setSelecionadas([]));

  const removerDaLeva = (levaId: string, orcamentoId: string) =>
    patchLeva(levaId, { action: 'remove_entrega', orcamento_id: orcamentoId }, 'rm-' + orcamentoId);

  const marcarLevaEmRota = (levaId: string) =>
    patchLeva(levaId, { action: 'marcar_em_rota' }, 'rota-' + levaId);

  const trocarMotoristaLeva = (levaId: string, motoristaId: string) =>
    patchLeva(levaId, { motorista_id: motoristaId || null }, 'mot-' + levaId);

  const excluirLeva = async (levaId: string) => {
    if (!confirm('Excluir esta leva? As entregas voltam para a lista de pendentes.')) return;
    setAcaoLeva('del-' + levaId);
    try {
      const res = await fetch('/api/levas/' + levaId, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir leva');
      if (levaAtualId === levaId) setLevaAtualId(null);
      await Promise.all([carregarLevas(), carregarEntregasDia()]);
    } catch (e) {
      console.error('Erro ao excluir leva', e);
      alert(e instanceof Error ? e.message : 'Erro ao excluir leva');
    }
    setAcaoLeva(null);
  };

  const carregarEntregasDia = async () => {
    setLoadingDia(true);
    setSelecionadas([]);
    setRotaGerada(null);
    try {
      const dataAlvo = dataEntregasAlvo();
      const res = await fetch('/api/entregas/rota?data=' + dataAlvo, { cache: 'no-store' });
      const data = await res.json();
      const todasRaw: EntregaRota[] = data.entregas || [];
      // Defesa: dedup por id (em caso de JOIN multiplicar) e separa por status. entrega_parcial
      // cai junto com pendentes para o motorista terminar a entrega.
      const seen = new Set<string>();
      const todas = todasRaw.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente' || e.status === 'entrega_parcial'));
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

  // Lookup id -> previsao, pros cards da aba ferragens.
  const previsaoFerragem = (id: string) => ferragemFila?.fila.find(f => f.id === id) ?? null;

  const carregarFerragemFila = async () => {
    try {
      const res = await fetch('/api/ferragem/fila', { cache: 'no-store' });
      const data = await res.json();
      if (!data.error) setFerragemFila(data);
    } catch (e) { console.error('Erro ao carregar fila de ferragem', e); }
  };

  const salvarCapacidade = async () => {
    const n = Number(capacidadeInput.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { alert('Informe metros/dia validos'); return; }
    try {
      await fetch('/api/ferragem/fila', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacidade_m_dia: n }),
      });
      setEditandoCapacidade(false);
      await carregarFerragemFila();
    } catch (e) { console.error('Erro ao salvar capacidade', e); }
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

  const carregarFerragensProntas = async () => {
    setLoadingFerragensProntas(true);
    try {
      const res = await fetch('/api/orcamentos?ferragem_status=pronta&limite=200', { cache: 'no-store' });
      const data = await res.json();
      setFerragensProntas(data.orcamentos || []);
    } catch (e) { console.error('Erro ao carregar ferragens prontas', e); }
    setLoadingFerragensProntas(false);
  };

  const passarAoFerreiro = async (id: string) => {
    setPassandoAoFerreiro(id);
    try {
      await fetch('/api/orcamentos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ferragem_status: 'em_producao' }),
        cache: 'no-store',
      });
      await carregarFerragens();
      await carregarFerragensProducao();
    } catch (e) { console.error('Erro ao passar ao ferreiro', e); }
    setPassandoAoFerreiro(null);
  };

  const marcarFerragemPronta = async (id: string) => {
    setMarcandoPronta(id);
    try {
      await fetch('/api/orcamentos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ferragem_status: 'pronta' }),
        cache: 'no-store',
      });
      await carregarFerragensProducao();
      await carregarFerragensProntas();
    } catch (e) { console.error('Erro ao marcar ferragem pronta', e); }
    setMarcandoPronta(null);
  };

  const voltarParaProducao = async (id: string) => {
    setVoltandoProducao(id);
    try {
      await fetch('/api/orcamentos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ferragem_status: 'em_producao' }),
        cache: 'no-store',
      });
      await carregarFerragensProntas();
      await carregarFerragensProducao();
    } catch (e) { console.error('Erro ao voltar para producao', e); }
    setVoltandoProducao(null);
  };

  const voltarFerragemPendente = async (id: string) => {
    setVoltandoFerragemPendente(id);
    try {
      await fetch('/api/orcamentos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ferragem_status: null }),
        cache: 'no-store',
      });
      await carregarFerragens();
      await carregarFerragensProducao();
    } catch (e) { console.error('Erro ao voltar ferragem para pendente', e); }
    setVoltandoFerragemPendente(null);
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
      const todasRaw: EntregaRota[] = reloadData.entregas || [];
      const seen = new Set<string>();
      const todas = todasRaw.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente' || e.status === 'entrega_parcial'));
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
      const todasRaw: EntregaRota[] = reloadData.entregas || [];
      const seen = new Set<string>();
      const todas = todasRaw.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
      setEntregasDia(todas.filter(e => e.status === 'aguardando' || e.status === 'confirmado' || e.status === 'entrega_pendente' || e.status === 'entrega_parcial'));
      setEntregasEmRota(todas.filter(e => e.status === 'em_rota'));
      setEntregasCompletas(todas.filter(e => e.status === 'completo'));
    } catch (e) { console.error('Erro ao marcar entregue', e); }
    setLoadingCompleto(null);
  };

  // Clique em "Entregue": se ainda ha saldo em aberto, abre o modal de
  // cobranca antes de concluir; se ja esta pago, conclui direto.
  const iniciarConclusaoEntrega = (e: EntregaRota) => {
    if ((e.a_cobrar ?? 0) > 0.01) {
      setCobrancaValor((e.a_cobrar ?? 0).toFixed(2));
      setCobrancaMetodo(e.forma_pagamento && e.forma_pagamento !== 'pagamento_na_entrega' ? e.forma_pagamento : 'pix');
      setCobrancaEntrega(e);
    } else {
      marcarEntregue(e.id);
    }
  };

  // Recebeu na entrega: registra o pagamento e conclui.
  const confirmarCobrancaEntrega = async () => {
    if (!cobrancaEntrega) return;
    const valorNum = Number((cobrancaValor || '0').replace(',', '.'));
    if (!Number.isFinite(valorNum) || valorNum <= 0) { alert('Informe um valor valido'); return; }
    setCobrancaSalvando(true);
    try {
      const res = await fetch('/api/pagamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orcamento_id: cobrancaEntrega.id, valor: valorNum, metodo: cobrancaMetodo }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || 'Erro ao registrar pagamento'); setCobrancaSalvando(false); return; }
      const id = cobrancaEntrega.id;
      setCobrancaEntrega(null);
      await marcarEntregue(id);
    } catch { alert('Erro de conexao'); }
    setCobrancaSalvando(false);
  };

  // Entregue sem pagamento: deixa o saldo em aberto (aparece no Financeiro) e
  // marca o pedido no campo proprio, pra ficar registrado que foi decisao,
  // nao esquecimento — e permitir filtrar/relatar depois.
  const marcarEntregueSemPagamento = async () => {
    if (!cobrancaEntrega) return;
    setCobrancaSalvando(true);
    try {
      await fetch(`/api/orcamentos/${cobrancaEntrega.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entregue_sem_pagamento: true }),
        cache: 'no-store',
      });
      const id = cobrancaEntrega.id;
      setCobrancaEntrega(null);
      await marcarEntregue(id);
    } catch { alert('Erro ao marcar pedido'); }
    setCobrancaSalvando(false);
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
      // O motorista sai com esta folha na mao — o que cobrar tem que estar nela.
      html += (e.a_cobrar ?? 0) > 0.01
        ? `<div style="margin-top:4px;padding:4px 8px;border:2px solid #b91c1c;border-radius:4px;color:#b91c1c;font-weight:bold">💰 COBRAR R$ ${(e.a_cobrar || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}${e.forma_pagamento ? ' — ' + e.forma_pagamento : ''}</div>`
        : `<div style="margin-top:4px;color:#15803d;font-weight:bold;font-size:12px">✅ JÁ PAGO — só entregar</div>`;
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
      const qs = dataEntregas ? `?data=${encodeURIComponent(dataEntregas)}` : '';
      const res = await fetch(`/api/entregas/rota${qs}`, { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.rota_otimizada)) {
        setEntregasRota(data);
      } else {
        // Resposta nao usavel; mantem estado previo, mas sem quebrar render
        setEntregasRota(null);
      }
    } catch (e) { console.error('Erro ao carregar entregas', e); }
    setLoadingEntregas(false);
  };

  const marcarEmRota = async () => {
    if (!entregasRota || !Array.isArray(entregasRota.rota_otimizada) || entregasRota.rota_otimizada.length === 0) return;
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

  const entregasFiltradas = entregasRota && Array.isArray(entregasRota.rota_otimizada) ? {
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
      html += (e.a_cobrar ?? 0) > 0.01
        ? `<div style="margin-top:4px;padding:4px 8px;border:2px solid #b91c1c;border-radius:4px;color:#b91c1c;font-weight:bold">💰 COBRAR R$ ${formatBRL(e.a_cobrar || 0)}${e.forma_pagamento ? ' — ' + e.forma_pagamento : ''}</div>`
        : `<div style="margin-top:4px;color:#15803d;font-weight:bold;font-size:12px">✅ JÁ PAGO — só entregar</div>`;
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

  // === Edicao inline de preco_custo (Batch B Fase 3) ===
  const iniciarEdicaoCusto = (p: Produto) => {
    setEditandoCustoId(p.id);
    // Formato brasileiro: virgula decimal
    setEditandoCustoValor(String(p.preco_custo ?? 0).replace('.', ','));
  };
  const cancelarEdicaoCusto = () => {
    setEditandoCustoId(null);
    setEditandoCustoValor('');
  };
  const salvarCusto = async (p: Produto) => {
    // Parse BR (aceita "11,92" e "11.92"). Valida >= 0.
    const normalizado = editandoCustoValor.replace(',', '.').trim();
    const novo = parseFloat(normalizado);
    if (!Number.isFinite(novo) || novo < 0) {
      setToastEstoque({ tipo: 'erro', msg: 'Custo invalido (informe valor >= 0)' });
      return;
    }
    // No-op se o valor nao mudou
    if (novo === Number(p.preco_custo || 0)) {
      cancelarEdicaoCusto();
      return;
    }
    setSalvandoCustoId(p.id);
    try {
      const res = await fetch(`/api/produtos/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preco_custo: novo, usuario_id: user?.id ?? null }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setToastEstoque({ tipo: 'erro', msg: data?.error || 'Falha ao salvar' });
      } else {
        setToastEstoque({ tipo: 'sucesso', msg: 'Custo atualizado' });
        cancelarEdicaoCusto();
        carregarProdutos();
      }
    } catch (e) {
      console.error(e);
      setToastEstoque({ tipo: 'erro', msg: 'Erro de rede ao salvar' });
    }
    setSalvandoCustoId(null);
  };

  // Toast auto-some em 2.5s
  useEffect(() => {
    if (!toastEstoque) return;
    const t = setTimeout(() => setToastEstoque(null), 2500);
    return () => clearTimeout(t);
  }, [toastEstoque]);

  // === Modal historico de custos (Batch B Fase 3) ===
  const abrirHistoricoCustos = async (p: Produto) => {
    setHistoricoCustosOpenId(p.id);
    setHistoricoCustosLista([]);
    setHistoricoCustosLoading(true);
    try {
      const res = await fetch(`/api/produtos/${p.id}/historico-custos`, { cache: 'no-store' });
      const data = await res.json();
      setHistoricoCustosLista(data?.historico || []);
    } catch (e) {
      console.error('Erro ao carregar historico de custos', e);
    }
    setHistoricoCustosLoading(false);
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

  const quantidadeItens = itens.reduce((a, i) => a + i.quantidade, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        abaAtiva={abaAtiva}
        setAbaAtiva={setAbaAtiva}
        abasVisiveis={abasVisiveis}
        quantidadeItens={quantidadeItens}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <div className="md:ml-60 min-h-screen flex flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white p-4 print:hidden">
          {/* Esquerda: hamburger so em mobile (logo ja esta no sidebar) */}
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden"
          >
            <Menu size={22} />
          </button>
          <div className="hidden md:block" />

          {/* Direita: badge nome+role + logout */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">
              {nomeUsuario}
              {papelUsuario && (
                <>
                  <span className="text-slate-400"> • </span>
                  <span className="capitalize">{papelUsuario}</span>
                </>
              )}
            </span>
            <button
              type="button"
              aria-label="Sair"
              title="Sair"
              onClick={handleSignOut}
              className="rounded-lg p-2 text-slate-700 hover:bg-slate-100"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div className="max-w-6xl mx-auto w-full px-4 pt-4 print:hidden">

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
                              setNomeCliente(cli.nome);
                              setWhatsappCliente(cli.telefone);
                              if (cli.cep) { setCepDestino(cli.cep); setBuscaEndereco(cli.cep); }
                              if (cli.endereco) setEnderecoViaCEP(cli.endereco);
                              if (cli.numero) setNumeroEndereco(cli.numero);
                              if (cli.complemento) setComplementoEndereco(cli.complemento);
                              if (cli.recebedor) setRecebedor(cli.recebedor);
                              // Pre-fetch enderecos pro picker (Step 3 — UI mostra
                              // dropdown se >0). Pre-seleciona is_padrao quando existe.
                              const ends = await carregarEnderecosDoCliente(cli.id);
                              const padrao = ends.find(e => e.is_padrao);
                              if (padrao) {
                                setEnderecoIdSelecionado(padrao.id);
                                setModoEndereco('existente');
                              } else if (ends.length > 0) {
                                setEnderecoIdSelecionado(ends[0].id);
                                setModoEndereco('existente');
                              } else {
                                setEnderecoIdSelecionado(null);
                                setModoEndereco('novo');
                              }
                            } else {
                              setClienteEncontrado(null);
                              setEnderecosDoCliente([]);
                              setEnderecoIdSelecionado(null);
                              setModoEndereco('novo');
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
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                onClick={() => setShowCalculadoraFerro(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm"
              >
                <span>&#x1F527;</span> Calculadora de Ferro
              </button>
              <button
                onClick={() => setShowCalculadoraMadeira(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800 transition-colors font-medium text-sm"
              >
                <span>&#x1FAB5;</span> Calculadora de Madeira
              </button>
              <button
                onClick={() => setShowCalculadoraLaje(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium text-sm"
              >
                <span>&#x1F9F1;</span> Laje
              </button>
              <button
                onClick={() => { setPdvNome(''); setPdvTelefone(''); setPdvItens([]); setPdvStatusPagamento('pago'); setPdvFormaPagamento('pix'); setPdvBusca(''); setMostrarPDV(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-[#F7941D] text-white rounded-lg hover:bg-[#E8850A] transition-colors font-medium text-sm"
              >
                <span>&#x1F3EA;</span> Venda Rápida
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
                    {produto.tipo_estoque === 'sob_demanda' ? (
                      <p className="text-xs mb-3 text-blue-600">📦 Sob demanda{(produto.total_vendido ?? 0) > 0 ? ` · ${produto.total_vendido} vendidos` : ''}</p>
                    ) : (
                      <p className={`text-xs mb-3 ${produto.estoque <= 0 ? 'text-red-600 font-bold' : produto.abaixo_minimo ? 'text-red-500 font-medium' : produto.estoque <= produto.estoque_minimo * 2 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {produto.estoque <= 0 ? '⛔ Sem estoque' : `${produto.abaixo_minimo ? '⚠️ ' : produto.estoque <= produto.estoque_minimo * 2 ? '🟡 ' : '🟢 '}Estoque: ${produto.estoque} ${produto.unidade === 'm³' ? 'm³' : (produto.estoque !== 1 ? produto.unidade + 's' : produto.unidade)}`}
                      </p>
                    )}
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
                    <button onClick={cancelarEdicao}
                      className="text-xs text-yellow-700 underline">Cancelar edição</button>
                  </div>
                )}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-0">
                  <h2 className="font-bold text-gray-700 mb-3">📋 Dados do Cliente</h2>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">📱 Número do cliente</label>
                      <div className="relative">
                        <input
                          type="tel"
                          placeholder="Digite o número para buscar cadastro..."
                          value={clienteNumeroNovo}
                          onChange={e => {
                            const v = e.target.value;
                            setClienteNumeroNovo(v);
                            const digits = v.replace(/\D/g, '');
                            if (digits.length >= 8) {
                              setClienteBuscandoNum(true);
                              setClienteEncontrado(null);
                              clearTimeout((window as typeof window & {_clienteTimer?: ReturnType<typeof setTimeout>})._clienteTimer);
                              (window as typeof window & {_clienteTimer?: ReturnType<typeof setTimeout>})._clienteTimer = setTimeout(async () => {
                                try {
                                  const r = await fetch(`/api/clientes?telefone=${encodeURIComponent(digits)}`);
                                  const data = await r.json();
                                  if (data.clientes && data.clientes.length > 0) {
                                    const cli = data.clientes[0];
                                    setClienteEncontrado(cli);
                                    setClienteNomeNovo(cli.nome);
                                    setClienteTelefoneNovo(cli.telefone);
                                    setNomeCliente(cli.nome);
                                    setWhatsappCliente(cli.telefone);
                                    if (cli.cep) { setCepDestino(cli.cep); setBuscaEndereco(cli.cep); }
                                    if (cli.endereco) setEnderecoViaCEP(cli.endereco);
                                    if (cli.numero) setNumeroEndereco(cli.numero);
                                    if (cli.complemento) setComplementoEndereco(cli.complemento);
                                    if (cli.recebedor) setRecebedor(cli.recebedor);
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
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                        />
                        {clienteBuscandoNum && <span className="absolute right-3 top-2.5 text-xs text-gray-400">🔍</span>}
                      </div>
                      {clienteEncontrado && (
                        <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                          ✅ Cliente encontrado: <strong>{clienteEncontrado.nome}</strong>
                          {clienteEncontrado.endereco && <span> — {clienteEncontrado.endereco}{clienteEncontrado.numero ? `, ${clienteEncontrado.numero}` : ''}</span>}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nome do cliente *</label>
                      <input type="text" placeholder="Nome completo" value={nomeCliente} onChange={e => { setNomeCliente(e.target.value); setClienteNomeNovo(e.target.value); }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Telefone *</label>
                      <input type="tel" placeholder="(11) 99999-9999" value={whatsappCliente} onChange={e => {
                        const v = e.target.value;
                        setWhatsappCliente(v);
                        setClienteTelefoneNovo(v);
                        setClienteEncontrado(null);
                        const digits = v.replace(/\D/g, '');
                        if (digits.length >= 8) {
                          clearTimeout((window as typeof window & {_wTimer?: ReturnType<typeof setTimeout>})._wTimer);
                          (window as typeof window & {_wTimer?: ReturnType<typeof setTimeout>})._wTimer = setTimeout(async () => {
                            try {
                              setClienteBuscandoNum(true);
                              const r = await fetch(`/api/clientes?busca=${encodeURIComponent(digits)}`, { cache: 'no-store' });
                              const data = await r.json();
                              if (data.clientes && data.clientes.length > 0) {
                                const cli = data.clientes[0];
                                setClienteEncontrado(cli);
                                setClienteNomeNovo(cli.nome);
                                setClienteTelefoneNovo(cli.telefone);
                                setNomeCliente(cli.nome);
                                if (cli.cep) { setCepDestino(cli.cep); setBuscaEndereco(cli.cep); }
                                if (cli.endereco) setEnderecoViaCEP(cli.endereco);
                                if (cli.numero) setNumeroEndereco(cli.numero);
                                if (cli.complemento) setComplementoEndereco(cli.complemento);
                                if (cli.recebedor) setRecebedor(cli.recebedor);
                              } else { setClienteEncontrado(null); }
                            } catch {} finally { setClienteBuscandoNum(false); }
                          }, 400);
                        }
                      }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50"><h2 className="font-bold text-gray-700">Itens do Orçamento</h2></div>
                  {itens.map(item => {
                    const stepVal = item.produto.unidade === 'm³' ? 0.5 : 1;
                    return (
                      <div key={item.produto.id} className="flex items-center gap-3 p-4 border-b border-gray-50 last:border-0">
                        <div className="flex-1">
                          <p className="font-medium text-gray-800 text-sm">{item.produto.nome}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-gray-500">R$</span>
                            <input
                              type="number" min={0} step={0.01}
                              value={item.preco_custom ?? item.produto.preco}
                              onChange={e => { const v = parseFloat(e.target.value); setPrecoCustom(item.produto.id, isNaN(v) ? null : v); }}
                              className="w-20 text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#F7941D] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <span className="text-xs text-gray-500">/{item.produto.unidade}</span>
                            {item.preco_custom != null && item.preco_custom !== item.produto.preco && (
                              <span className="text-[10px] text-[#F7941D] font-semibold whitespace-nowrap">✎ alterado</span>
                            )}
                          </div>
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
                  <h2 className="font-bold text-gray-700 mb-3">📝 Notas / Especificações</h2>
                  <textarea
                    placeholder="Anote os detalhes do pedido (ex: 2 sapatas 20x20, 3 vigas de 4m, ferro 3/8 para coluna...)"
                    value={observacoes}
                    onChange={e => setObservacoes(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] resize-none"
                  />
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
                      {/* Picker de enderecos do cliente — so aparece quando ja existem */}
                      {enderecosDoCliente.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Endereço da entrega</label>
                          <select
                            value={modoEndereco === 'novo' ? '__novo__' : (enderecoIdSelecionado || '')}
                            onChange={ev => {
                              const val = ev.target.value;
                              if (val === '__novo__') {
                                setModoEndereco('novo');
                                setEnderecoIdSelecionado(null);
                                setEnderecoNovoForm(ENDERECO_NOVO_VAZIO);
                              } else {
                                const end = enderecosDoCliente.find(x => x.id === val);
                                if (end) {
                                  setEnderecoIdSelecionado(end.id);
                                  setModoEndereco('existente');
                                  // Espelha nos campos legacy pra preview, frete e payload de fallback
                                  if (end.cep) { setCepDestino(end.cep.replace(/\D/g,'')); setBuscaEndereco(end.cep); }
                                  setEnderecoViaCEP([end.rua, end.bairro, end.cidade ? `${end.cidade}-${end.estado || ''}` : null].filter(Boolean).join(', '));
                                  setNumeroEndereco(end.numero || '');
                                  setComplementoEndereco(end.complemento || '');
                                }
                              }
                            }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                          >
                            {enderecosDoCliente.map(e => (
                              <option key={e.id} value={e.id}>{formatarEnderecoUI(e)}</option>
                            ))}
                            <option value="__novo__">+ Novo endereço</option>
                          </select>
                        </div>
                      )}

                      {/* Sub-form de "+ Novo endereço" — campos separados,
                          submit envia body.endereco_novo. */}
                      {enderecosDoCliente.length > 0 && modoEndereco === 'novo' && (
                        <div className="space-y-2 rounded-lg border border-dashed border-[#F7941D] bg-[#FFF3E0]/40 p-3">
                          <p className="text-xs font-medium text-[#E8850A]">Novo endereço para {clienteEncontrado?.nome || nomeCliente || 'este cliente'}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder="Apelido (ex: Obra, Casa)" value={enderecoNovoForm.apelido}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, apelido: ev.target.value }))}
                              autoComplete="off" data-lpignore="true" data-1p-ignore="true"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                            <input type="text" placeholder="CEP" value={enderecoNovoForm.cep}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, cep: ev.target.value }))}
                              autoComplete="postal-code"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          </div>
                          <input type="text" placeholder="Rua *" value={enderecoNovoForm.rua}
                            onChange={ev => setEnderecoNovoForm(f => ({ ...f, rua: ev.target.value }))}
                            autoComplete="address-line1"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder="Número *" value={enderecoNovoForm.numero}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, numero: ev.target.value }))}
                              autoComplete="address-line2"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                            <input type="text" placeholder="Complemento" value={enderecoNovoForm.complemento}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, complemento: ev.target.value }))}
                              autoComplete="off"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          </div>
                          <input type="text" placeholder="Bairro" value={enderecoNovoForm.bairro}
                            onChange={ev => setEnderecoNovoForm(f => ({ ...f, bairro: ev.target.value }))}
                            autoComplete="address-level3"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          <div className="grid grid-cols-3 gap-2">
                            <input type="text" placeholder="Cidade" value={enderecoNovoForm.cidade}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, cidade: ev.target.value }))}
                              autoComplete="address-level2"
                              className="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                            <input type="text" placeholder="UF" maxLength={2} value={enderecoNovoForm.estado}
                              onChange={ev => setEnderecoNovoForm(f => ({ ...f, estado: ev.target.value.toUpperCase() }))}
                              autoComplete="address-level1"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          </div>
                        </div>
                      )}

                      {/* Form de cliente novo / sem enderecos cadastrados —
                          campos separados (Step 4 Tarefa 2) que alimentam
                          body.endereco_novo no submit (Step 4 Tarefa 3).
                          Mantem busca smart como helper de autocomplete
                          (CEP/Google Places populam os separados). */}
                      {enderecosDoCliente.length === 0 && (
                        <>
                          {/* Apelido opcional */}
                          <input type="text" placeholder="Apelido (ex: Obra, Casa) — opcional" value={apelidoEndereco}
                            onChange={e => setApelidoEndereco(e.target.value)}
                            autoComplete="off" data-lpignore="true" data-1p-ignore="true"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />

                          {/* Busca smart — preenche os separados via CEP ou Google Places */}
                          <div className="relative flex gap-2">
                            <input
                              type="text"
                              placeholder="🔍 Buscar por CEP ou rua (opcional)"
                              value={buscaEndereco || cepDestino}
                              onChange={e => {
                                const val = e.target.value;
                                setBuscaEndereco(val);
                                // Bug 2: sempre sincroniza cepDestino com o input
                                // (incluindo apagar pra ''). Sem isso, apagar o input
                                // mantinha cepDestino antigo e o value caia no
                                // fallback cepDestino, mostrando o CEP de volta.
                                const cleaned = val.replace(/\D/g, '');
                                setCepDestino(cleaned);
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
                              autoComplete="postal-code"
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
                            />
                            {mostrandoSugestoes && sugestoesEndereco.length > 0 && (
                              <ul className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                                {sugestoesEndereco.map(s => (
                                  <li key={s.place_id}
                                    className="px-3 py-2 text-sm hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0"
                                    onClick={async () => {
                                      setMostrandoSugestoes(false);
                                      setSugestoesEndereco([]);
                                      setErroFrete('');
                                      try {
                                        const res = await fetch(`/api/endereco?type=details&place_id=${s.place_id}`, { cache: 'no-store' });
                                        const data = await res.json();
                                        if (data.error) {
                                          setErroFrete(data.error);
                                          return;
                                        }
                                        // Popula campos separados a partir da resposta do Google Places.
                                        if (data.logradouro) setRuaDestino(data.logradouro);
                                        if (data.bairro) setBairroDestino(data.bairro);
                                        if (data.cidade) setCidadeDestino(data.cidade);
                                        if (data.estado) setEstadoDestino(data.estado);
                                        if (data.cep) setCepDestino(data.cep);
                                        // enderecoViaCEP mantido em paralelo durante o deploy gap.
                                        if (data.logradouro) setEnderecoViaCEP(data.logradouro + (data.bairro ? ', ' + data.bairro : '') + (data.cidade ? ', ' + data.cidade + '-' + data.estado : ''));
                                        setBuscaEndereco(s.description);
                                      } catch {
                                        setErroFrete('Erro ao buscar detalhes do endereço.');
                                      }
                                    }}
                                  >📍 {s.description}</li>
                                ))}
                              </ul>
                            )}
                            <button
                              onClick={() => buscarEnderecoSmart(buscaEndereco || cepDestino)}
                              disabled={buscandoEndereco}
                              className="bg-[#F7941D] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#E8850A] transition disabled:opacity-50"
                            >
                              {buscandoEndereco ? '...' : 'Buscar'}
                            </button>
                          </div>
                          {erroFrete && <p className="text-xs text-red-500">{erroFrete}</p>}

                          {/* Campos separados — editaveis manualmente. CEP fica
                              espelhado em cepDestino (state ja usado pela busca). */}
                          <input type="text" placeholder="Rua *" value={ruaDestino}
                            onChange={e => setRuaDestino(e.target.value)}
                            autoComplete="address-line1"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder="Número *" value={numeroEndereco}
                              onChange={e => setNumeroEndereco(e.target.value)}
                              autoComplete="address-line2"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                            <input type="text" placeholder="Complemento (opcional)" value={complementoEndereco}
                              onChange={e => setComplementoEndereco(e.target.value)}
                              autoComplete="off"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          </div>
                          <input type="text" placeholder="Bairro" value={bairroDestino}
                            onChange={e => setBairroDestino(e.target.value)}
                            autoComplete="address-level3"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          <div className="grid grid-cols-3 gap-2">
                            <input type="text" placeholder="Cidade" value={cidadeDestino}
                              onChange={e => setCidadeDestino(e.target.value)}
                              autoComplete="address-level2"
                              className="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                            <input type="text" placeholder="UF" maxLength={2} value={estadoDestino}
                              onChange={e => setEstadoDestino(e.target.value.toUpperCase())}
                              autoComplete="address-level1"
                              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                          </div>
                        </>
                      )}
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

                {previsaoFechar && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                    <p className="font-semibold text-amber-900">
                      🗓️ Ferragem pronta ~ {new Date(previsaoFechar.data_pronta + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      {previsaoFechar.metros.toLocaleString('pt-BR')} m neste pedido · {previsaoFechar.dias_uteis} dia(s) útil(eis) contando a fila atual. Use como base pra combinar a data de entrega.
                    </p>
                  </div>
                )}

                <div className="bg-[#E8850A] text-white rounded-xl p-4">
                  <div className="flex justify-between mb-1"><span className="text-white/80 text-sm">Subtotal:</span><span className="font-medium">R$ {formatBRL(subtotal)}</span></div>
                  <div className="flex justify-between mt-2 pt-2 border-t border-[#F7941D]"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-xl">R$ {formatBRL(totalFinal)}</span></div>
                </div>
              {/* Card pricing */}
              {(() => {
                const p = montarParcelasCartao(totalFinal, ACRESCIMO_CARTAO);
                return (
                  <div className="mt-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <div className="flex justify-between text-gray-600 mb-1"><span>💵 À vista (PIX/dinheiro):</span><span className="font-bold text-gray-800">R$ {formatBRL(p.valorAVista)}</span></div>
                    <div className="text-gray-600 mb-1"><span className="block font-medium">💳 Cartão até 3x sem juros:</span>
                      <div className="flex flex-wrap gap-1 mt-1">{p.semJuros.map(par => (<span key={par.n} className="text-xs bg-green-50 border border-green-200 rounded px-2 py-0.5 text-green-700">{par.n}x R$ {formatBRL(par.valor)}</span>))}</div>
                    </div>
                    <div className="text-gray-600"><span className="block font-medium">💳 Cartão 4x-6x (+8%):</span>
                      <div className="flex flex-wrap gap-1 mt-1">{p.comAcrescimo.map(par => (<span key={par.n} className="text-xs bg-orange-50 border border-orange-200 rounded px-2 py-0.5 text-orange-700">{par.n}x R$ {formatBRL(par.valor)}</span>))}</div>
                    </div>
                  </div>
                );
              })()}
              {editandoId && (
                <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded-xl mb-2 text-sm font-medium flex justify-between items-center">
                  <span>✏️ Editando orçamento {orcamentos.find(o => o.id === editandoId)?.codigo || editandoId}</span>
                  <button type="button" onClick={cancelarEdicao} className="text-yellow-700 hover:text-yellow-900 font-bold ml-2">✕ Cancelar</button>
                </div>
              )}
                            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
                <h3 className="font-bold text-[#F7941D] text-sm mb-3">⚙️ Gestão do Pedido</h3>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Status do Pedido</label>
                    <select value={statusPedidoForm} onChange={e => { const v = e.target.value; setStatusPedidoForm(v); if (editandoId) { atualizarStatusOrcamento(editandoId, v, statusPedidoForm); } }} className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300">
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Condição</label>
                    <select value={condicaoPagamentoForm} onChange={e => { const v = e.target.value; setCondicaoPagamentoForm(v); if (editandoId) { fetch(`/api/orcamentos/${editandoId}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ condicao_pagamento: v }) }); } }} className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300">
                      {Object.entries(CONDICAO_PAGAMENTO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {condicaoPagamentoForm === 'prazo' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Vence em</label>
                      <input type="date" value={vencimentoForm} onChange={e => { const v = e.target.value; setVencimentoForm(v); if (editandoId) { fetch(`/api/orcamentos/${editandoId}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ vencimento: v || null }) }); } }} className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Forma de Pagamento</label>
                    <select value={formaPagamentoForm} onChange={e => { const v = e.target.value; setFormaPagamentoForm(v); if (editandoId) { fetch(`/api/orcamentos/${editandoId}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ forma_pagamento: v }) }); } }} className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300">
                      <option value="">Forma de pagamento...</option>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="pix">PIX</option>
                      <option value="debito">Débito</option>
                      <option value="credito">Crédito</option>
                      <option value="boleto">Boleto</option>
                    </select>
                  </div>
                </div>
              </div>
              {/* === SIMULADOR DE DESCONTO === */}
              {itens.length > 0 && (() => {
                const MARGEM_MINIMA = 0.20;
                const custoTotal = itens.reduce((sum, item) => sum + ((item.produto.preco_custo || 0) * item.quantidade), 0);
                const margemAtual = total > 0 ? (total - custoTotal) / total : 0;
                const totalMinimo = custoTotal > 0 ? custoTotal / (1 - MARGEM_MINIMA) : 0;
                const descontoMaxReais = Math.max(0, total - totalMinimo);
                const descontoMaxPct = total > 0 ? (descontoMaxReais / total) * 100 : 0;
                const totalComDesconto = descontoCustom > 0 ? total * (1 - descontoCustom / 100) : total;
                const margemComDesconto = totalComDesconto > 0 ? (totalComDesconto - custoTotal) / totalComDesconto : 0;
                const simulacoes = [5, 10, 15, 20].map(pct => {
                  const novoTotal = total * (1 - pct / 100);
                  const novaMargem = novoTotal > 0 ? (novoTotal - custoTotal) / novoTotal : 0;
                  return { pct, novoTotal, novaMargem, ok: novaMargem >= MARGEM_MINIMA };
                });
                const getMargemColor = (m: number) => m >= 0.30 ? 'text-green-600' : m >= 0.20 ? 'text-yellow-600' : 'text-red-600';
                const getMargemIcon = (m: number, ok?: boolean) => ok !== undefined ? (ok ? '✅' : '❌') : (m >= 0.30 ? '✅' : m >= 0.20 ? '⚠️' : '❌');

                return custoTotal > 0 ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                    <button onClick={() => setMostrarSimulador(!mostrarSimulador)} className="w-full flex items-center justify-between text-sm font-bold text-blue-800 mb-2">
                      <span>💰 Simulador de Desconto</span>
                      <span className="text-xs font-normal text-blue-600">Margem atual: <span className={getMargemColor(margemAtual)}>{(margemAtual * 100).toFixed(1)}%</span> | Máx: {descontoMaxPct.toFixed(1)}%</span>
                    </button>
                    {mostrarSimulador && (
                      <div className="space-y-3">
                        <div className="text-xs text-blue-600">
                          <span>Custo total: R$ {custoTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                          <span className="mx-2">•</span>
                          <span>Desconto máx (margem ≥ 20%): {descontoMaxPct.toFixed(1)}% = R$ {descontoMaxReais.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {simulacoes.map(s => {
                            const isSelected = descontoCustom === s.pct;
                            const baseClasses = 'text-center p-2 rounded-lg border text-xs transition-all';
                            const colorClasses = s.ok
                              ? (isSelected ? 'border-green-600 bg-green-100 ring-2 ring-green-500 shadow-md' : 'border-green-300 bg-green-50 hover:border-green-500 hover:bg-green-100 cursor-pointer')
                              : 'border-red-200 bg-red-50 opacity-60 cursor-not-allowed';
                            return (
                              <button
                                type="button"
                                key={s.pct}
                                disabled={!s.ok}
                                onClick={() => {
                                  if (!s.ok) return;
                                  const novoPct = isSelected ? 0 : s.pct;
                                  setDescontoCustom(novoPct);
                                  setDescontoValorInput(total > 0 ? (total * novoPct) / 100 : 0);
                                }}
                                className={`${baseClasses} ${colorClasses}`}
                                title={s.ok ? (isSelected ? 'Clique para remover este desconto' : `Aplicar ${s.pct}% de desconto`) : 'Margem ficaria abaixo de 20%'}
                              >
                                <div className="font-bold">{s.pct}%</div>
                                <div className="text-gray-600">R$ {s.novoTotal.toLocaleString('pt-BR', {minimumFractionDigits:0})}</div>
                                <div className={getMargemColor(s.novaMargem)}>{(s.novaMargem * 100).toFixed(1)}%</div>
                                <div>{getMargemIcon(s.novaMargem, s.ok)}</div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="space-y-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setDescontoModo('pct')}
                              className={`flex-1 text-xs font-medium py-1.5 rounded ${descontoModo === 'pct' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300'}`}
                            >Porcentagem %</button>
                            <button
                              type="button"
                              onClick={() => setDescontoModo('valor')}
                              className={`flex-1 text-xs font-medium py-1.5 rounded ${descontoModo === 'valor' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300'}`}
                            >Valor R$</button>
                          </div>
                          {descontoModo === 'pct' ? (
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-blue-700 font-medium whitespace-nowrap">Desconto:</label>
                              <input type="number" min="0" max={descontoMaxPct.toFixed(1)} step="0.5"
                                value={descontoCustom || ''}
                                onChange={e => {
                                  const pct = parseFloat(e.target.value) || 0;
                                  setDescontoCustom(pct);
                                  setDescontoValorInput(total > 0 ? (total * pct) / 100 : 0);
                                }}
                                className="w-24 border border-blue-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                                placeholder="0"
                              />
                              <span className="text-xs text-blue-600">%</span>
                              <span className="text-xs text-gray-500">= R$ {(total > 0 ? (total * descontoCustom) / 100 : 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-blue-700 font-medium whitespace-nowrap">Desconto R$:</label>
                              <input type="number" min="0" max={total} step="1"
                                value={descontoValorInput || ''}
                                onChange={e => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setDescontoValorInput(v);
                                  setDescontoCustom(total > 0 ? Math.min(100, (v / total) * 100) : 0);
                                }}
                                className="w-28 border border-blue-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                                placeholder="0"
                              />
                              <span className="text-xs text-gray-500">= {(total > 0 ? (descontoValorInput / total) * 100 : 0).toFixed(1)}%</span>
                            </div>
                          )}
                          {descontoCustom > 0 && (
                            <p className={`text-xs font-medium ${getMargemColor(margemComDesconto)}`}>
                              Novo total: R$ {totalComDesconto.toLocaleString('pt-BR', {minimumFractionDigits:2})} | Margem: {(margemComDesconto * 100).toFixed(1)}% {getMargemIcon(margemComDesconto)}
                            </p>
                          )}
                        </div>
                        {margemComDesconto < MARGEM_MINIMA && descontoCustom > 0 && (
                          <div className="text-xs text-red-600 font-medium">⚠️ Margem ficaria abaixo de 20%! Reduza o desconto.</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null;
              })()}
                            {!enderecoResolvido && tipoEntrega === 'entrega' && (
                              <div className="text-sm text-red-600 mb-2">
                                Informe o endereço de entrega antes de salvar.
                              </div>
                            )}
                            <button onClick={salvarEGerarOrcamento} disabled={salvandoOrcamento || !enderecoResolvido}
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
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500 whitespace-nowrap">De:</label>
                <input type="date" value={filtroDataDe} onChange={e => setFiltroDataDe(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                <label className="text-sm text-gray-500 whitespace-nowrap">Até:</label>
                <input type="date" value={filtroDataAte} onChange={e => setFiltroDataAte(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
              </div>
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
                          {(orc.tipo_entrega === 'entrega' && orc.data_entrega) && (() => {
                            // Prefere endereco_completo (REAL do pedido). Fallback
                            // pro clientes.endereco legacy em orfaos.
                            const ec = orc.endereco_completo;
                            const enderecoExibido = ec
                              ? ec.rua + (ec.numero ? ', ' + ec.numero : '') + (ec.bairro ? ' — ' + ec.bairro : '')
                              : orc.clientes?.endereco
                                ? orc.clientes.endereco + (orc.clientes.numero ? ', ' + orc.clientes.numero : '') + (orc.clientes.bairro ? ' — ' + orc.clientes.bairro : '')
                                : '';
                            return (
                              <p className="text-xs text-blue-600 mt-1">🚛 Entrega: {new Date(orc.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}{enderecoExibido ? ' · ' + enderecoExibido : ''}</p>
                            );
                          })()}
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

        {/* ===== FERRAGENS TAB ===== */}
        {abaAtiva === 'ferragens' && (
          <div className="pb-8 space-y-6">

            {/* === FILA DE AMARRACAO: capacidade + previsao === */}
            {ferragemFila && (
              <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                    <div>
                      <p className="text-xs text-gray-500">Na fila</p>
                      <p className="font-bold text-gray-800">
                        {ferragemFila.resumo.metros_total.toLocaleString('pt-BR')} m · {ferragemFila.resumo.pedidos} pedido(s)
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Fila zera em</p>
                      <p className="font-bold text-gray-800">
                        {ferragemFila.resumo.zera_em
                          ? `${new Date(ferragemFila.resumo.zera_em + 'T12:00:00').toLocaleDateString('pt-BR')} · ${ferragemFila.resumo.dias_uteis} dia(s) útil(eis)`
                          : 'Sem fila 🎉'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Capacidade</p>
                      {editandoCapacidade ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={capacidadeInput}
                            onChange={e => setCapacidadeInput(e.target.value)}
                            className="w-16 text-sm border border-orange-200 rounded px-2 py-1"
                          />
                          <span className="text-xs text-gray-500">m/dia</span>
                          <button onClick={salvarCapacidade} className="text-xs bg-[#F7941D] text-white px-2 py-1 rounded">OK</button>
                          <button onClick={() => setEditandoCapacidade(false)} className="text-xs text-gray-400 px-1">×</button>
                        </div>
                      ) : (
                        <p className="font-bold text-gray-800">
                          {ferragemFila.capacidade_m_dia} m/dia
                          {papelUsuario === 'admin' && (
                            <button
                              onClick={() => { setCapacidadeInput(String(ferragemFila.capacidade_m_dia)); setEditandoCapacidade(true); }}
                              className="ml-2 text-xs text-orange-600 hover:text-orange-800 font-normal"
                            >
                              editar
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  Previsão por ordem de chegada, {ferragemFila.capacidade_m_dia} m amarrados por dia útil (seg–sáb). Conta o metro linear das peças (vigas/colunas) de cada pedido.
                </p>
              </div>
            )}

            {/* === SECTION 1: PEDIDOS COM FERRAGEM (PENDENTE) === */}
            <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-orange-700">{'\ud83d\udce6'} Pedidos com Ferragem ({ferragens.length})</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => imprimirOrdensFerragem(ferragens)} disabled={ferragens.length === 0} className="text-xs text-white bg-orange-500 hover:bg-orange-600 px-2 py-1 rounded disabled:opacity-40 font-semibold">
                    🖨️ Imprimir todas
                  </button>
                  <button onClick={carregarFerragens} disabled={loadingFerragens} className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1 rounded hover:bg-orange-50 border border-orange-200">
                    {loadingFerragens ? 'Carregando...' : 'Atualizar'}
                  </button>
                </div>
              </div>
              {loadingFerragens && <p className="text-sm text-gray-400 text-center py-4">Carregando...</p>}
              {!loadingFerragens && ferragens.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum pedido com ferragem pendente</p>
              )}
              {!loadingFerragens && ferragens.length > 0 && (
                <div className="space-y-3">
                  {ferragens.map(f => {
                    const cliente = (f.clientes as Record<string, unknown>) || {};
                    const itens = (f.orcamento_itens as Array<Record<string, unknown>>) || [];
                    const itensFerro = itens.filter(it => ehItemFerro({
                      produto_nome: it.produto_nome as string | null,
                      produto_id: it.produto_id as string | number | null | undefined,
                    }));
                    const itensExibir = itensFerro.length > 0 ? itensFerro : itens;
                    return (
                      <div key={f.id as string} className="border border-orange-100 rounded-lg bg-orange-50 p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{cliente.nome as string}</p>
                            <p className="text-xs text-gray-500">{cliente.telefone as string}</p>
                            <p className="text-xs text-orange-600 font-mono">{f.codigo as string}</p>
                          </div>
                          <p className="font-bold text-gray-800 text-sm shrink-0">R$ {(Number(f.total) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                        </div>
                        {Boolean(f.data_entrega || f.data_retirada) && (
                          <p className="text-xs text-gray-600 mb-1">
                            {(f.tipo_entrega as string) === 'retirada' ? 'Retirada: ' : 'Entrega: '}
                            {new Date(((f.data_entrega || f.data_retirada) as string) + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </p>
                        )}
                        {(() => {
                          const prev = previsaoFerragem(f.id as string);
                          if (!prev) return null;
                          return (
                            <p className="text-xs mb-1 inline-block bg-amber-100 border border-amber-200 text-amber-800 rounded px-2 py-0.5">
                              🗓️ Ferragem pronta ~ {new Date(prev.data_pronta + 'T12:00:00').toLocaleDateString('pt-BR')} · {prev.metros.toLocaleString('pt-BR')} m
                            </p>
                          );
                        })()}
                        {itensExibir.length > 0 && (
                          <div className="text-xs text-gray-600 mb-2 space-y-0.5">
                            {itensExibir.slice(0, 5).map((it, i) => (
                              <p key={i}>{Number(it.quantidade) || 0} {(it.unidade as string) || ''} {(it.produto_nome as string) || ''}</p>
                            ))}
                            {itensExibir.length > 5 && <p className="text-gray-400">+{itensExibir.length - 5} item(s)</p>}
                          </div>
                        )}
                        <button
                          onClick={() => passarAoFerreiro(f.id as string)}
                          disabled={passandoAoFerreiro === f.id}
                          className="w-full bg-orange-500 text-white text-xs font-bold py-1.5 rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
                        >
                          {passandoAoFerreiro === f.id ? 'Passando...' : 'Passar ao Ferreiro'}
                        </button>
                        <button
                          onClick={() => imprimirOrdensFerragem([f])}
                          className="w-full mt-1 bg-white border border-orange-300 text-orange-700 text-xs font-bold py-1.5 rounded-lg hover:bg-orange-100 transition"
                        >
                          🖨️ Imprimir ordem
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* === SECTION 2: FERRAGEM EM PRODUCAO === */}
            <div className="bg-white rounded-xl shadow-sm border border-yellow-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-yellow-700">{'\ud83d\udd28'} Ferragem em Produção ({ferragensProducao.length})</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => imprimirOrdensFerragem(ferragensProducao)} disabled={ferragensProducao.length === 0} className="text-xs text-white bg-yellow-600 hover:bg-yellow-700 px-2 py-1 rounded disabled:opacity-40 font-semibold">
                    🖨️ Imprimir todas
                  </button>
                  <button onClick={carregarFerragensProducao} disabled={loadingFerragensProducao} className="text-xs text-yellow-700 hover:text-yellow-900 px-2 py-1 rounded hover:bg-yellow-50 border border-yellow-200">
                    {loadingFerragensProducao ? 'Carregando...' : 'Atualizar'}
                  </button>
                </div>
              </div>
              {loadingFerragensProducao && <p className="text-sm text-gray-400 text-center py-4">Carregando...</p>}
              {!loadingFerragensProducao && ferragensProducao.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma ferragem em produção</p>
              )}
              {!loadingFerragensProducao && ferragensProducao.length > 0 && (
                <div className="space-y-3">
                  {ferragensProducao.map(f => {
                    const cliente = (f.clientes as Record<string, unknown>) || {};
                    const itens = (f.orcamento_itens as Array<Record<string, unknown>>) || [];
                    const itensFerro = itens.filter(it => ehItemFerro({
                      produto_nome: it.produto_nome as string | null,
                      produto_id: it.produto_id as string | number | null | undefined,
                    }));
                    const itensExibir = itensFerro.length > 0 ? itensFerro : itens;
                    return (
                      <div key={f.id as string} className="border border-yellow-100 rounded-lg bg-yellow-50 p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{cliente.nome as string}</p>
                            <p className="text-xs text-gray-500">{cliente.telefone as string}</p>
                            <p className="text-xs text-yellow-700 font-mono">{f.codigo as string}</p>
                          </div>
                          <p className="font-bold text-gray-800 text-sm shrink-0">R$ {(Number(f.total) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                        </div>
                        {Boolean(f.data_entrega || f.data_retirada) && (
                          <p className="text-xs text-gray-600 mb-1">
                            {(f.tipo_entrega as string) === 'retirada' ? 'Retirada: ' : 'Entrega: '}
                            {new Date(((f.data_entrega || f.data_retirada) as string) + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </p>
                        )}
                        {(() => {
                          const prev = previsaoFerragem(f.id as string);
                          if (!prev) return null;
                          return (
                            <p className="text-xs mb-1 inline-block bg-amber-100 border border-amber-200 text-amber-800 rounded px-2 py-0.5">
                              🗓️ Ferragem pronta ~ {new Date(prev.data_pronta + 'T12:00:00').toLocaleDateString('pt-BR')} · {prev.metros.toLocaleString('pt-BR')} m
                            </p>
                          );
                        })()}
                        {itensExibir.length > 0 && (
                          <div className="text-xs text-gray-600 mb-2 space-y-0.5">
                            {itensExibir.slice(0, 5).map((it, i) => (
                              <p key={i}>{Number(it.quantidade) || 0} {(it.unidade as string) || ''} {(it.produto_nome as string) || ''}</p>
                            ))}
                            {itensExibir.length > 5 && <p className="text-gray-400">+{itensExibir.length - 5} item(s)</p>}
                          </div>
                        )}
                        <button
                          onClick={() => marcarFerragemPronta(f.id as string)}
                          disabled={marcandoPronta === f.id}
                          className="w-full bg-green-600 text-white text-xs font-bold py-1.5 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                        >
                          {marcandoPronta === f.id ? 'Marcando...' : '✅ Marcar como Pronta'}
                        </button>
                        <button
                          onClick={() => imprimirOrdensFerragem([f])}
                          className="w-full mt-1 bg-white border border-yellow-400 text-yellow-800 text-xs font-bold py-1.5 rounded-lg hover:bg-yellow-100 transition"
                        >
                          🖨️ Imprimir ordem
                        </button>
                        <button
                          onClick={() => voltarFerragemPendente(f.id as string)}
                          disabled={voltandoFerragemPendente === f.id}
                          className="w-full mt-1 bg-gray-200 text-gray-700 text-xs font-bold py-1.5 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
                        >
                          {voltandoFerragemPendente === f.id ? 'Voltando...' : '↩️ Voltar para Pendente'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* === SECTION 3: FERRAGENS PRONTAS === */}
            <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-green-700">{'\u2705'} Ferragens Prontas ({ferragensProntas.length})</h2>
                <button onClick={carregarFerragensProntas} disabled={loadingFerragensProntas} className="text-xs text-green-600 hover:text-green-800 px-2 py-1 rounded hover:bg-green-50 border border-green-200">
                  {loadingFerragensProntas ? 'Carregando...' : 'Atualizar'}
                </button>
              </div>
              {loadingFerragensProntas && <p className="text-sm text-gray-400 text-center py-4">Carregando...</p>}
              {!loadingFerragensProntas && ferragensProntas.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma ferragem pronta</p>
              )}
              {!loadingFerragensProntas && ferragensProntas.length > 0 && (
                <div className="space-y-3">
                  {ferragensProntas.map(f => {
                    const cliente = (f.clientes as Record<string, unknown>) || {};
                    const itens = (f.orcamento_itens as Array<Record<string, unknown>>) || [];
                    const itensFerro = itens.filter(it => ehItemFerro({
                      produto_nome: it.produto_nome as string | null,
                      produto_id: it.produto_id as string | number | null | undefined,
                    }));
                    const itensExibir = itensFerro.length > 0 ? itensFerro : itens;
                    return (
                      <div key={f.id as string} className="border border-green-100 rounded-lg bg-green-50 p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{cliente.nome as string}</p>
                            <p className="text-xs text-gray-500">{cliente.telefone as string}</p>
                            <p className="text-xs text-green-700 font-mono">{f.codigo as string}</p>
                          </div>
                          <p className="font-bold text-gray-800 text-sm shrink-0">R$ {(Number(f.total) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                        </div>
                        {Boolean(f.data_entrega || f.data_retirada) && (
                          <p className="text-xs text-gray-600 mb-1">
                            {(f.tipo_entrega as string) === 'retirada' ? 'Retirada: ' : 'Entrega: '}
                            {new Date(((f.data_entrega || f.data_retirada) as string) + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </p>
                        )}
                        {(() => {
                          const prev = previsaoFerragem(f.id as string);
                          if (!prev) return null;
                          return (
                            <p className="text-xs mb-1 inline-block bg-amber-100 border border-amber-200 text-amber-800 rounded px-2 py-0.5">
                              🗓️ Ferragem pronta ~ {new Date(prev.data_pronta + 'T12:00:00').toLocaleDateString('pt-BR')} · {prev.metros.toLocaleString('pt-BR')} m
                            </p>
                          );
                        })()}
                        {itensExibir.length > 0 && (
                          <div className="text-xs text-gray-600 mb-2 space-y-0.5">
                            {itensExibir.slice(0, 5).map((it, i) => (
                              <p key={i}>{Number(it.quantidade) || 0} {(it.unidade as string) || ''} {(it.produto_nome as string) || ''}</p>
                            ))}
                            {itensExibir.length > 5 && <p className="text-gray-400">+{itensExibir.length - 5} item(s)</p>}
                          </div>
                        )}
                        <button
                          onClick={() => voltarParaProducao(f.id as string)}
                          disabled={voltandoProducao === f.id}
                          className="w-full bg-yellow-600 text-white text-xs font-bold py-1.5 rounded-lg hover:bg-yellow-700 transition disabled:opacity-50"
                        >
                          {voltandoProducao === f.id ? 'Voltando...' : '↩️ Voltar para Produção'}
                        </button>
                        <button
                          onClick={() => abrirDetalhe(f.id as string)}
                          className="w-full mt-1 bg-white border border-gray-300 text-gray-700 text-xs font-bold py-1.5 rounded-lg hover:bg-gray-50 transition"
                        >
                          📋 Ver Pedido Completo
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ===== ENTREGAS TAB ===== */}
        {abaAtiva === 'entregas' && (
          <div className="pb-8 space-y-6">

            {/* Toggle Lista | Mapa */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              <button
                onClick={() => setVistaEntregas('lista')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${vistaEntregas === 'lista' ? 'bg-white text-[#F7941D] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >📋 Lista</button>
              <button
                onClick={() => setVistaEntregas('mapa')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${vistaEntregas === 'mapa' ? 'bg-white text-[#F7941D] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >🗺️ Mapa</button>
            </div>

            {vistaEntregas === 'mapa' ? (
              <>
                <MapaEntregas
                  entregas={entregasMapa}
                  selecionadas={selecionadasSet}
                  onToggleSelecionada={toggleSelecionada}
                  onAbrirPedido={abrirDetalhe}
                  ordemRotaGerada={rotaGerada?.entregas?.map(e => e.id)}
                />
                {selecionadas.length > 0 && (
                  <button
                    onClick={gerarRota}
                    disabled={loadingRota}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-full shadow-lg flex items-center gap-2"
                  >
                    🚚 {loadingRota ? 'Gerando rota...' : `Gerar Rota (${selecionadas.length} ${selecionadas.length === 1 ? 'entrega' : 'entregas'})`}
                  </button>
                )}
              </>
            ) : (
            <>

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

              {/* Montar leva com o que esta selecionado. A leva e a viagem:
                  quem levou e o que foi junto. Sem cota de peso — o limite
                  de carga e decisao de quem carrega, nao do sistema. */}
              {selecionadas.length > 0 && (
                <div className="mb-4 border border-blue-200 bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-bold text-blue-800 mb-2">
                    🚚 Montar leva com {selecionadas.length} {selecionadas.length === 1 ? 'entrega' : 'entregas'}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={motoristaNovaLeva}
                      onChange={ev => setMotoristaNovaLeva(ev.target.value)}
                      className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">Sem motorista definido</option>
                      {motoristas.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.nome}{m.veiculo ? ' — ' + m.veiculo : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={criarLevaComSelecionadas}
                      disabled={acaoLeva === 'criando'}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      {acaoLeva === 'criando' ? 'Criando...' : '+ Nova leva'}
                    </button>
                  </div>
                  {levas.filter(l => l.status !== 'em_rota').length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 items-center">
                      <span className="text-xs text-blue-700">ou adicionar em:</span>
                      {levas.filter(l => l.status !== 'em_rota').map(l => (
                        <button
                          key={l.id}
                          onClick={() => adicionarSelecionadasNaLeva(l.id)}
                          disabled={acaoLeva === 'add-' + l.id}
                          className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-100 disabled:opacity-50"
                        >
                          {acaoLeva === 'add-' + l.id ? '...' : 'Leva ' + l.numero_leva}
                          {l.motoristas?.nome ? ' (' + l.motoristas.nome + ')' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {entregasDia.length > 0 && (
                <div className="space-y-2 mb-4">
                  {entregasDia.map((e, idx) => (
                    <div
                      key={e.id}
                      className={`rounded-lg text-sm overflow-hidden ${
                        selecionadas.includes(e.id)
                          ? 'border-2 border-orange-500 bg-orange-50'
                          : 'border border-gray-200'
                      }`}
                    >
                      <div
                        className={`p-3 flex items-start gap-3 cursor-pointer ${
                          selecionadas.includes(e.id) ? 'hover:bg-orange-100' : 'hover:bg-gray-50'
                        }`}
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
                          {e.status === 'entrega_parcial' && e.falta_resumo && (
                            <p className="text-xs text-indigo-700 font-medium mt-0.5">⚠️ PARCIAL — Falta: {e.falta_resumo}</p>
                          )}
                          {e.leva_id && (
                            <p className="inline-block text-xs font-semibold text-blue-800 bg-blue-100 border border-blue-300 rounded px-2 py-0.5 mt-1">
                              🚚 Leva {e.leva_numero ?? '?'}
                              {(() => {
                                const m = motoristas.find(x => x.id === e.motorista_id);
                                return m ? ' · ' + m.nome + (m.veiculo ? ' (' + m.veiculo + ')' : '') : '';
                              })()}
                            </p>
                          )}
                          {/* O que o motorista tem que cobrar na porta. Vem do saldo
                              real (total - valor_pago), nao de um rotulo digitado. */}
                          {(e.a_cobrar ?? 0) > 0.01 ? (
                            <p className="inline-block text-xs font-bold text-red-800 bg-red-100 border border-red-300 rounded px-2 py-0.5 mt-1">
                              💰 COBRAR {(e.a_cobrar ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              {e.forma_pagamento ? ` · ${e.forma_pagamento}` : ''}
                            </p>
                          ) : (
                            <p className="text-xs text-green-700 font-medium mt-0.5">✅ Já pago — só entregar</p>
                          )}
                        </div>
                        <button
                          onClick={ev => { ev.stopPropagation(); setExpandedDia(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id]); }}
                          className="shrink-0 text-xs text-orange-500 hover:text-orange-700 px-2 py-1 rounded hover:bg-orange-50 whitespace-nowrap"
                        >
                          {expandedDia.includes(e.id) ? '▲ Fechar' : '📦 Ver pedido'}
                        </button>
                          {/* Motorista avulso, para entrega que nao entra em leva.
                              O modal ja existia no arquivo mas nada o abria. */}
                          <button
                            onClick={ev => { ev.stopPropagation(); setEntregaSelecionadaId(e.id); setMostrarAtribuirMotorista(true); }}
                            className="shrink-0 text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 whitespace-nowrap"
                            title="Atribuir motorista"
                          >🚗</button>
                          <button onClick={() => abrirDetalhe(e.id)} className="shrink-0 text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 whitespace-nowrap">📋 Ver Pedido</button>
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

            {/* === SECTION 1.5: LEVAS DO DIA ===
                A leva e o registro da viagem: motorista, veiculo e o que foi
                junto. E daqui que sai o dado de entregas por viagem, que hoje
                nao existe em lugar nenhum. */}
            <div className="bg-white rounded-xl shadow-sm border border-blue-100 p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🚚</span>
                <h2 className="font-bold text-blue-700">Levas do Dia</h2>
                {levas.length > 0 && (
                  <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full">{levas.length}</span>
                )}
                <button
                  onClick={carregarLevas}
                  disabled={carregandoLevas}
                  className="ml-auto text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 border border-blue-200"
                >
                  {carregandoLevas ? 'Carregando...' : '↻ Atualizar'}
                </button>
              </div>

              {erroLevas && (
                <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  Erro ao carregar levas: {erroLevas}
                </div>
              )}

              {!carregandoLevas && levas.length === 0 && !erroLevas && (
                <p className="text-center py-6 text-gray-400 text-sm">
                  Nenhuma leva montada para esta data.<br />
                  <span className="text-xs">Selecione entregas acima e clique em &quot;Nova leva&quot;.</span>
                </p>
              )}

              {levas.length > 0 && (
                <div className="space-y-3">
                  {levas.map(l => {
                    const qtd = l.orcamentos?.length || 0;
                    const volume = l.volume_calculado ?? l.volume_total ?? 0;
                    const emRota = l.status === 'em_rota';
                    return (
                      <div key={l.id} className={`border rounded-lg overflow-hidden ${emRota ? 'border-purple-200 bg-purple-50' : 'border-blue-200 bg-blue-50'}`}>
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <p className="font-bold text-gray-800 text-sm">
                                Leva {l.numero_leva}
                                {emRota && <span className="ml-2 text-xs font-bold text-purple-700 bg-purple-100 border border-purple-300 rounded px-2 py-0.5">EM ROTA</span>}
                              </p>
                              <p className="text-xs text-gray-600 mt-0.5">
                                {qtd} {qtd === 1 ? 'entrega' : 'entregas'}
                                {volume > 0 && <span> · {volume.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³</span>}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <select
                                value={l.motorista_id || ''}
                                onChange={ev => trocarMotoristaLeva(l.id, ev.target.value)}
                                disabled={acaoLeva === 'mot-' + l.id}
                                className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                              >
                                <option value="">Sem motorista</option>
                                {motoristas.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.nome}{m.veiculo ? ' — ' + m.veiculo : ''}
                                  </option>
                                ))}
                              </select>
                              {!emRota && qtd > 0 && (
                                <button
                                  onClick={() => marcarLevaEmRota(l.id)}
                                  disabled={acaoLeva === 'rota-' + l.id}
                                  className="bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                                >
                                  {acaoLeva === 'rota-' + l.id ? '...' : '▶ Sair para rota'}
                                </button>
                              )}
                              <button
                                onClick={() => excluirLeva(l.id)}
                                disabled={acaoLeva === 'del-' + l.id}
                                className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 border border-red-200 disabled:opacity-50"
                              >
                                {acaoLeva === 'del-' + l.id ? '...' : '🗑'}
                              </button>
                            </div>
                          </div>

                          {qtd === 0 && (
                            <p className="text-xs text-gray-400 italic mt-2">Leva vazia — selecione entregas acima para adicionar.</p>
                          )}

                          {qtd > 0 && (
                            <div className="mt-2 space-y-1">
                              {(l.orcamentos || []).map((o, i) => (
                                <div key={o.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1.5 text-xs">
                                  <span className="text-gray-400 w-4 text-center shrink-0">{i + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium text-gray-800">{o.clientes?.nome || 'Cliente'}</span>
                                    {o.clientes?.bairro && <span className="text-gray-500"> — {o.clientes.bairro}</span>}
                                    <span className="text-gray-400 font-mono ml-1">{o.codigo}</span>
                                  </div>
                                  {(o.volume_m3 ?? 0) > 0 && (
                                    <span className="text-gray-500 shrink-0">{o.volume_m3!.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³</span>
                                  )}
                                  <button
                                    onClick={() => abrirDetalhe(o.id)}
                                    className="text-blue-500 hover:text-blue-700 shrink-0 px-1"
                                  >📋</button>
                                  {!emRota && (
                                    <button
                                      onClick={() => removerDaLeva(l.id, o.id)}
                                      disabled={acaoLeva === 'rm-' + o.id}
                                      className="text-red-500 hover:text-red-700 shrink-0 px-1 disabled:opacity-50"
                                      title="Remover da leva"
                                    >✕</button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                          {e.status === 'entrega_parcial' && e.falta_resumo && (
                            <p className="text-xs text-indigo-700 font-medium mt-0.5">⚠️ PARCIAL — Falta: {e.falta_resumo}</p>
                          )}
                          {/* O que o motorista tem que cobrar na porta. Vem do saldo
                              real (total - valor_pago), nao de um rotulo digitado. */}
                          {(e.a_cobrar ?? 0) > 0.01 ? (
                            <p className="inline-block text-xs font-bold text-red-800 bg-red-100 border border-red-300 rounded px-2 py-0.5 mt-1">
                              💰 COBRAR {(e.a_cobrar ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              {e.forma_pagamento ? ` · ${e.forma_pagamento}` : ''}
                            </p>
                          ) : (
                            <p className="text-xs text-green-700 font-medium mt-0.5">✅ Já pago — só entregar</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => setExpandedEmRota(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                            className="text-xs text-purple-500 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-50 whitespace-nowrap"
                          >
                            {expandedEmRota.includes(e.id) ? '▲ Fechar' : '📦 Ver'}
                          </button>
                          <button
                            onClick={() => iniciarConclusaoEntrega(e)}
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

            </>
            )}
          </div>
        )}
      </div>


            {/* ===== CLIENTES TAB ===== */}
        {abaAtiva === 'clientes' && (
          <div className="max-w-4xl mx-auto py-6">
            <input
              type="text"
              value={clientesBusca}
              onChange={e => { setClientesBusca(e.target.value); setClientesPagina(1); }}
              placeholder="Buscar cliente por nome ou telefone..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
            />
            {/* Feature 2: chips de tags + min/max valor */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500 mr-1">Tags:</span>
              {TAGS_VALIDAS.map(tag => {
                const ativa = clientesTagsFiltro.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setClientesTagsFiltro(prev => {
                        const novo = new Set(prev);
                        if (novo.has(tag)) novo.delete(tag); else novo.add(tag);
                        return novo;
                      });
                    }}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                      ativa
                        ? 'border-[#F7941D] bg-[#FFF3E0] text-[#E8850A]'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {tag.replace(/_/g, ' ')}
                  </button>
                );
              })}
              {clientesTagsFiltro.size > 0 && (
                <button
                  type="button"
                  onClick={() => setClientesTagsFiltro(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
                >limpar</button>
              )}
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Valor gasto:</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={clientesMinValor}
                onChange={e => setClientesMinValor(e.target.value)}
                placeholder="mín"
                className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={clientesMaxValor}
                onChange={e => setClientesMaxValor(e.target.value)}
                placeholder="máx"
                className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
              />
              {(clientesMinValor || clientesMaxValor) && (
                <button
                  type="button"
                  onClick={() => { setClientesMinValor(''); setClientesMaxValor(''); }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >limpar</button>
              )}
            </div>
            {clientesLoading ? (
              <p className="text-center text-gray-400 text-sm py-10">Carregando...</p>
            ) : clientesLista.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">Nenhum cliente encontrado.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {clientesLista.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setClienteProfileId(c.id)}
                      className="w-full text-left cursor-pointer bg-white border border-gray-200 rounded-lg p-4 hover:border-orange-300 hover:shadow-sm transition flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{c.nome || 'Cliente'}</p>
                        <p className="text-xs text-gray-500">{formatarTelefoneBR(c.telefone)}</p>
                        {c.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.tags.slice(0, 3).map(t => (
                              <span key={t} className="text-[10px] bg-orange-100 text-orange-800 rounded-full px-1.5 py-0.5">{t.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-700">{c.qtd_compras} compra{c.qtd_compras === 1 ? '' : 's'}</p>
                        <p className="text-xs font-medium text-green-700">R$ {formatBRL(c.total_gasto || 0)}</p>
                        <p className="text-xs text-gray-500">{c.ultima_compra ? formatarDataBR(c.ultima_compra) : 'sem compras'}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4 text-sm">
                  <button
                    onClick={() => setClientesPagina(p => Math.max(1, p - 1))}
                    disabled={clientesPagina <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
                  >Anterior</button>
                  <span className="text-gray-500">Página {clientesPagina} de {clientesTotalPages} · {clientesTotal} clientes</span>
                  <button
                    onClick={() => setClientesPagina(p => Math.min(clientesTotalPages, p + 1))}
                    disabled={clientesPagina >= clientesTotalPages}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
                  >Próxima</button>
                </div>
              </>
            )}
          </div>
        )}

            {/* ===== DASHBOARD TAB ===== */}
        {abaAtiva === 'dashboard' && (
          <div className="px-4 pt-4 pb-8">
            <DashboardTab />
          </div>
        )}

        {/* ===== FINANCEIRO TAB ===== */}
        {abaAtiva === 'financeiro' && <FinanceiroTab simples={papelUsuario === 'atendente'} onAbrirPedido={abrirDetalhe} />}

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
                        <td className="px-4 py-3"><p className="font-medium text-gray-800">{p.nome}</p><p className="text-xs text-gray-400">{p.categoria} · {p.codigo || '-'}{p.estoque_compartilhado_com ? ' · 🔗 estoque compartilhado' : ''}{p.baixa_estoque_em_produto_id ? (() => {
                          const proxy = produtos.find(x => x.id === p.baixa_estoque_em_produto_id);
                          const fator = p.baixa_estoque_fator;
                          return ` · ↓ Baixa estoque de ${proxy?.nome || p.baixa_estoque_em_produto_id}${fator && fator !== 1 ? ` (fator ${fator})` : ''}`;
                        })() : ''}</p></td>
                        <td className="px-2 py-3 text-center">{p.tipo_ferro ? (() => {
                          // Batch C: produtos de ferro mostram disponivel/reservado
                          // e alertam estouro (estoque - reservados < 0).
                          const reservados = p.metros_reservados ?? 0;
                          const disponivel = p.estoque - reservados;
                          const insuficiente = disponivel < 0;
                          const atencao = !insuficiente && disponivel < p.estoque_minimo;
                          const corFerro = insuficiente
                            ? 'text-red-700 bg-red-50'
                            : atencao
                              ? 'text-yellow-700 bg-yellow-50'
                              : 'text-green-700 bg-green-50';
                          return (
                            <div>
                              <span
                                className={`text-xs font-bold px-2 py-1 rounded-full ${corFerro}`}
                                title={insuficiente ? 'Estoque insuficiente pros orçamentos rascunho' : ''}
                              >
                                {insuficiente && '⚠️ '}{p.estoque}{p.unidade} disponíveis
                              </span>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {reservados}{p.unidade} reservados{p.estoque_minimo > 0 ? ` · min: ${p.estoque_minimo}${p.unidade}` : ''}
                              </p>
                            </div>
                          );
                        })() : p.tipo_estoque === 'sob_demanda' ? (<><span className="text-xs font-bold px-2 py-1 rounded-full text-blue-700 bg-blue-50">Sob demanda</span>{(p.total_vendido ?? 0) > 0 && <p className="text-xs text-gray-400 mt-0.5">{p.total_vendido} vendidos</p>}</>) : (<><span className={`text-xs font-bold px-2 py-1 rounded-full ${estoqueColor}`}>{p.estoque} {p.unidade}</span><p className="text-xs text-gray-400 mt-0.5">min: {p.estoque_minimo}</p></>)}</td>
                        <td className="px-2 py-3 text-right font-medium">R$ {formatBRL(p.preco)}</td>
                        <td className="px-2 py-3 text-right">
                          {editandoCustoId === p.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-gray-400">R$</span>
                              <input
                                type="text"
                                autoFocus
                                inputMode="decimal"
                                value={editandoCustoValor}
                                onChange={ev => setEditandoCustoValor(ev.target.value)}
                                onBlur={() => salvarCusto(p)}
                                onKeyDown={ev => {
                                  if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); }
                                  else if (ev.key === 'Escape') { ev.preventDefault(); cancelarEdicaoCusto(); }
                                }}
                                disabled={salvandoCustoId === p.id}
                                className="w-24 border border-[#F7941D] rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-[#F7941D] disabled:opacity-50"
                              />
                              {salvandoCustoId === p.id && <span className="text-xs text-gray-400">…</span>}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => iniciarEdicaoCusto(p)}
                              title="Clique pra editar"
                              className="text-gray-500 hover:text-[#F7941D] hover:bg-orange-50 px-2 py-0.5 rounded"
                            >R$ {formatBRL(p.preco_custo || 0)}</button>
                          )}
                          {p.ultima_atualizacao_custo && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              atualizado em {new Date(p.ultima_atualizacao_custo).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right"><span className={`text-xs font-bold ${Number(margem) >= 30 ? 'text-green-600' : Number(margem) >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>{margem}%</span></td>
                        <td className="px-2 py-3 text-center"><div className="flex gap-1 justify-center flex-wrap">
                          <button onClick={() => abrirEditProduto(p)} title="Editar produto" className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200">✏️</button>
                          <button onClick={() => { setProdutoSelecionado(p); setEntradaQtd(''); setEntradaObs(''); setMostrarEntrada(true); }} title="Registrar entrada" className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">📥</button>
                          <button onClick={() => abrirHistoricoCustos(p)} title="Histórico de custos" className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100">📜</button>
                          <button onClick={() => abrirHistoricoProduto(p)} title="Histórico de movimentações" className="text-xs bg-[#FFF3E0] text-[#F7941D] px-2 py-1 rounded hover:bg-[#FFF3E0]">📊</button>
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

      {/* Batch B Fase 3: Modal Historico de Custos */}
      {historicoCustosOpenId && (() => {
        const produto = produtos.find(p => p.id === historicoCustosOpenId);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => { setHistoricoCustosOpenId(null); setHistoricoCustosLista([]); }}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                <div>
                  <h3 className="font-bold text-gray-800">📜 Histórico de Custos</h3>
                  {produto && <p className="text-xs text-gray-500">{produto.nome}</p>}
                </div>
                <button onClick={() => { setHistoricoCustosOpenId(null); setHistoricoCustosLista([]); }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-4">
                {historicoCustosLoading ? (
                  <p className="text-center text-sm text-gray-400 py-8">Carregando…</p>
                ) : historicoCustosLista.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-8">Nenhuma alteração de custo registrada ainda.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100 text-gray-500">
                      <th className="text-left py-2 pr-2 font-medium">Data</th>
                      <th className="text-right py-2 pr-2 font-medium">De</th>
                      <th className="text-right py-2 pr-2 font-medium">Pra</th>
                      <th className="text-left py-2 font-medium">Por</th>
                    </tr></thead>
                    <tbody>
                      {historicoCustosLista.map(h => {
                        const delta = h.custo_novo - h.custo_anterior;
                        const cor = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500';
                        return (
                          <tr key={h.id} className="border-b border-gray-50">
                            <td className="py-2 pr-2 text-gray-700">{new Date(h.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="py-2 pr-2 text-right text-gray-500">R$ {formatBRL(h.custo_anterior)}</td>
                            <td className={`py-2 pr-2 text-right font-semibold ${cor}`}>R$ {formatBRL(h.custo_novo)}</td>
                            <td className="py-2 text-gray-600">{h.usuario_nome || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast da aba Estoque (edicao inline de custo) */}
      {toastEstoque && (
        <div className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${toastEstoque.tipo === 'sucesso' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toastEstoque.msg}
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
                  {orcamentoDetalhe.clientes?.id && (
                    <button
                      onClick={() => {
                        const cid = orcamentoDetalhe.clientes?.id;
                        if (!cid) return;
                        setMostrarDetalhe(false);
                        setOrcamentoDetalhe(null);
                        setClienteProfileId(cid);
                      }}
                      className="mt-2 text-xs font-semibold text-[#F7941D] hover:underline"
                    >👤 Ver perfil do cliente</button>
                  )}
                </div>
                <div className="px-4 py-2 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 mb-1 text-sm">Entrega</h3>
                  <p className="text-sm text-gray-800">{orcamentoDetalhe.tipo_entrega === 'entrega' ? '🚚 Entrega no endereço' : '🏪 Retirada na loja'}</p>
                  {orcamentoDetalhe.tipo_entrega === 'entrega' && (() => {
                    // Prefere endereco_completo (REAL gravado no pedido,
                    // Step 2). Fallback pro clientes.endereco legacy quando
                    // endereco_completo for null — orfaos do backfill.
                    const ec = orcamentoDetalhe.endereco_completo;
                    const cl = orcamentoDetalhe.clientes;
                    const partes = ec
                      ? [ec.rua, ec.numero ? `nº ${ec.numero}` : '', ec.complemento, ec.bairro, ec.cidade ? `${ec.cidade}-${ec.estado || ''}` : '']
                      : cl?.endereco
                        ? [cl.endereco, cl.numero ? `nº ${cl.numero}` : '', cl.complemento, cl.bairro, cl.cidade ? `${cl.cidade}-${cl.estado}` : '']
                        : [];
                    const enderecoStr = partes.filter(Boolean).join(', ');
                    return (
                      <>
                        {enderecoStr && <p className="text-sm text-gray-600 mt-1">{enderecoStr}</p>}
                        {orcamentoDetalhe.clientes?.id && (
                          <div className="mt-2">
                            {!mostrarTrocaEndereco ? (
                              <button
                                onClick={abrirTrocaEndereco}
                                className="text-xs font-semibold text-[#F7941D] hover:underline"
                              >🔄 Trocar endereço</button>
                            ) : (
                              <div className="rounded-lg border border-[#F7941D] bg-[#FFF8F0] p-2 space-y-1">
                                <p className="text-xs font-semibold text-[#E8850A] mb-1">Escolha um endereço do cliente</p>
                                {enderecosDetalhe.length === 0 ? (
                                  <p className="text-xs text-gray-500">Carregando ou nenhum endereço cadastrado…</p>
                                ) : (
                                  enderecosDetalhe.map(e => {
                                    const ehAtual = e.id === orcamentoDetalhe.endereco_id;
                                    return (
                                      <button
                                        key={e.id}
                                        onClick={() => trocarEnderecoDetalhe(e.id)}
                                        disabled={trocandoEndereco || ehAtual}
                                        className={`w-full text-left text-xs px-2 py-1.5 rounded border transition ${ehAtual ? 'border-green-300 bg-green-50 text-green-700 cursor-default' : 'border-gray-200 bg-white hover:bg-orange-50 text-gray-700'}`}
                                      >
                                        {ehAtual ? '✓ ' : ''}{formatarEnderecoUI(e)}
                                      </button>
                                    );
                                  })
                                )}
                                <div className="flex gap-2 pt-1">
                                  <button
                                    onClick={() => setMostrarTrocaEndereco(false)}
                                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                                  >Cancelar</button>
                                  <span className="text-xs text-gray-400 self-center">Pra criar novo, abra o perfil do cliente.</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
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
                      {/* Pagamento nao e mais um select: e o saldo real, vindo da
                          soma dos registros em `pagamentos`. Marcar como pago exige
                          registrar o dinheiro que entrou. */}
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Pagamento</label>
                        {(() => {
                          const totalOrc = Number(orcamentoDetalhe.total) || 0;
                          const pago = Number(orcamentoDetalhe.valor_pago) || 0;
                          const saldo = totalOrc - pago;
                          const quitado = saldo <= 0.01;
                          return (
                            <div className={`rounded-lg border px-3 py-2 ${quitado ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                              <div className="flex items-center justify-between text-sm">
                                <span className={quitado ? 'text-green-800 font-medium' : 'text-orange-900 font-medium'}>
                                  {quitado ? '✅ Pago' : `Em aberto: ${saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                                </span>
                                {pago > 0 && !quitado && (
                                  <span className="text-xs text-gray-600">
                                    pago {pago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                )}
                              </div>
                              {!quitado && (
                                <div className="flex gap-2 mt-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={pgtoValor}
                                    onChange={e => setPgtoValor(e.target.value)}
                                    placeholder={saldo.toFixed(2)}
                                    className="flex-1 min-w-0 text-sm border border-orange-200 rounded-lg px-2 py-1.5"
                                  />
                                  <select
                                    value={pgtoMetodo}
                                    onChange={e => setPgtoMetodo(e.target.value)}
                                    className="text-sm border border-orange-200 rounded-lg px-2 py-1.5 bg-white"
                                  >
                                    <option value="pix">Pix</option>
                                    <option value="debito">Débito</option>
                                    <option value="credito">Crédito</option>
                                    <option value="dinheiro">Dinheiro</option>
                                    <option value="transferencia">Transf.</option>
                                    <option value="boleto">Boleto</option>
                                  </select>
                                  <button
                                    onClick={async () => {
                                      const valorNum = Number((pgtoValor || String(saldo)).replace(',', '.'));
                                      if (!Number.isFinite(valorNum) || valorNum <= 0) { alert('Valor invalido'); return; }
                                      const res = await fetch('/api/pagamentos', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ orcamento_id: orcamentoDetalhe.id, valor: valorNum, metodo: pgtoMetodo }),
                                      });
                                      const json = await res.json();
                                      if (!res.ok) { alert(json.error || 'Erro ao registrar pagamento'); return; }
                                      setPgtoValor('');
                                      setOrcamentoDetalhe({
                                        ...orcamentoDetalhe,
                                        valor_pago: Number(json.orcamento?.valor_pago) || 0,
                                        status_pagamento: json.orcamento?.status_pagamento ?? orcamentoDetalhe.status_pagamento,
                                      });
                                      carregarPagamentosDetalhe(orcamentoDetalhe.id);
                                      carregarHistorico();
                                    }}
                                    className="text-sm bg-[#F7941D] text-white px-3 py-1.5 rounded-lg hover:bg-[#E8850A] transition whitespace-nowrap"
                                  >
                                    Receber
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {orcamentoDetalhe.entregue_sem_pagamento && (
                          <p className="mt-1 inline-block text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            ⚠️ Entregue sem pagamento
                          </p>
                        )}
                      </div>
                      {/* Admin: pagamentos registrados, com estorno. Corrige pedido
                          marcado como pago por engano — remover o lancamento faz o
                          trigger recalcular e o status volta a pendente/parcial. */}
                      {papelUsuario === 'admin' && pagamentosDetalhe.length > 0 && (
                        <div>
                          <label className="text-xs font-medium text-gray-600 block mb-1">Pagamentos registrados</label>
                          <div className="space-y-1">
                            {pagamentosDetalhe.map(p => (
                              <div key={p.id} className="flex items-center justify-between text-sm border border-gray-200 rounded-lg px-3 py-1.5">
                                <span className="text-gray-700">
                                  {Number(p.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  <span className="text-gray-400"> · {p.metodo} · {new Date(p.data_pagamento).toLocaleDateString('pt-BR')}</span>
                                  {p.origem === 'legado' && <span className="text-gray-400"> · migrado</span>}
                                </span>
                                <button
                                  onClick={() => estornarPagamento(p.id)}
                                  className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 rounded px-2 py-0.5 whitespace-nowrap"
                                >
                                  Estornar
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
                  <div className="flex justify-between mt-2 pt-2 border-t border-gray-200"><span className="font-bold text-lg">TOTAL:</span><span className="font-bold text-lg text-[#F7941D]">R$ {formatBRL(orcamentoDetalhe.total)}</span></div>
                </div>
                {/* Progresso de entrega (parciais) */}
                {(() => {
                  const itens = orcamentoDetalhe.orcamento_itens || [];
                  const algumEntregue = itens.some(it => Number(it.quantidade_entregue) > 0);
                  if (!algumEntregue && entregasParciais.length === 0) return null;
                  const tudoEntregue = itens.length > 0 && itens.every(it => (Number(it.quantidade_entregue) || 0) + 1e-9 >= Number(it.quantidade));
                  const faltando = itens
                    .map(it => ({ nome: it.produto_nome, unidade: it.unidade, falta: Number(it.quantidade) - (Number(it.quantidade_entregue) || 0) }))
                    .filter(x => x.falta > 1e-9);
                  return (
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h3 className="font-bold text-gray-700 mb-2 text-sm">📦 Progresso de Entrega</h3>
                      <div className="space-y-2">
                        {itens.map(it => {
                          const total = Number(it.quantidade);
                          const entregue = Math.min(total, Number(it.quantidade_entregue) || 0);
                          const pct = total > 0 ? Math.round((entregue / total) * 100) : 0;
                          const completo = entregue + 1e-9 >= total;
                          return (
                            <div key={it.id}>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-700">{it.produto_nome}</span>
                                <span className={completo ? 'text-green-700 font-medium' : 'text-gray-600'}>
                                  {completo ? `${total} de ${total} ${it.unidade} ✅` : `${entregue} de ${total} ${it.unidade} entregues`}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded h-1.5 mt-1 overflow-hidden">
                                <div className={`h-full ${completo ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {tudoEntregue ? (
                        <p className="mt-3 text-sm font-bold text-green-700">✅ Tudo entregue</p>
                      ) : faltando.length > 0 ? (
                        <p className="mt-3 text-xs text-orange-700">⚠️ Falta entregar: {faltando.map(f => `${f.falta} ${f.unidade} de ${f.nome}`).join(' · ')}</p>
                      ) : null}
                    </div>
                  );
                })()}
                {/* Histórico de entregas parciais */}
                {entregasParciais.length > 0 && (
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-bold text-gray-700 mb-2 text-sm">📋 Histórico de Entregas</h3>
                    <div className="space-y-3">
                      {entregasParciais.map(ep => {
                        const dataFmt = ep.data_entrega
                          ? new Date(ep.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')
                          : new Date(ep.criado_em).toLocaleDateString('pt-BR');
                        return (
                          <div key={ep.id} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-700">Entrega #{ep.numero_entrega} — {dataFmt}</p>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => imprimirEntregaParcial(ep)}
                                  className="text-xs bg-[#F7941D] text-white px-2 py-1 rounded hover:bg-[#E8850A] whitespace-nowrap"
                                  title="Imprimir comprovante apenas desta entrega"
                                >🖨️ Imprimir</button>
                                <button
                                  onClick={() => setEntregaParaCancelar(ep)}
                                  className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 whitespace-nowrap"
                                  title="Cancelar esta entrega parcial"
                                >Cancelar</button>
                              </div>
                            </div>
                            <ul className="mt-1 ml-3 text-xs text-gray-600 list-disc">
                              {ep.entregas_parciais_itens.map(epi => (
                                <li key={epi.id}>
                                  {epi.orcamento_itens?.produto_nome || '—'}: {epi.quantidade} {epi.orcamento_itens?.unidade || ''}
                                </li>
                              ))}
                            </ul>
                            {ep.observacoes && <p className="mt-1 text-xs text-gray-500 italic">Obs: {ep.observacoes}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Card pricing - details modal */}
                {(() => {
                  const p = montarParcelasCartao(orcamentoDetalhe.total, ACRESCIMO_CARTAO);
                  return (
                    <div className="mt-1 bg-orange-50 border border-orange-200 rounded-xl px-3 py-1.5 text-sm">
                      <div className="flex justify-between mb-1"><span className="text-gray-600">💵 À vista (PIX/dinheiro):</span><span className="font-bold">R$ {formatBRL(p.valorAVista)}</span></div>
                      <div className="mb-1"><span className="text-gray-600 block font-medium">💳 Cartão até 3x sem juros:</span>
                        <div className="flex flex-wrap gap-1 mt-1">{p.semJuros.map(par => (<span key={par.n} className="text-xs bg-green-50 border border-green-300 rounded px-2 py-0.5 text-green-700">{par.n}x R$ {formatBRL(par.valor)}</span>))}</div>
                      </div>
                      <div><span className="text-gray-600 block font-medium">💳 Cartão 4x-6x (+8%):</span>
                        <div className="flex flex-wrap gap-1 mt-1">{p.comAcrescimo.map(par => (<span key={par.n} className="text-xs bg-white border border-orange-300 rounded px-2 py-0.5 text-orange-700">{par.n}x R$ {formatBRL(par.valor)}</span>))}</div>
                      </div>
                    </div>
                  );
                })()}
              {orcamentoDetalhe.observacoes && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium mb-1">Observações</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{orcamentoDetalhe.observacoes}</p>
            </div>
          )}
                <div className="px-4 py-3 space-y-1.5">
                  <button onClick={() => compartilharWhatsAppDetalhe(orcamentoDetalhe)} className="w-full bg-green-500 text-white py-2 rounded-xl font-bold hover:bg-green-600 transition text-sm">📱 Enviar por WhatsApp</button>
                  <button onClick={() => imprimirOrcamento(orcamentoDetalhe)} className="w-full bg-[#F7941D] text-white py-2 rounded-xl font-bold hover:bg-[#F7941D] transition text-sm">🖨️ Imprimir</button>
                  <button onClick={() => editarOrcamento(orcamentoDetalhe)} className="w-full bg-yellow-500 text-white py-2 rounded-xl font-bold hover:bg-yellow-600 transition text-sm">✏️ Editar Orçamento</button>
                  {(orcamentoDetalhe.status === 'entrega_pendente' || orcamentoDetalhe.status === 'entrega_parcial') && (
                    <>
                      <button onClick={abrirRegistrarParcial} className="w-full bg-indigo-500 text-white py-2 rounded-xl font-bold hover:bg-indigo-600 transition text-sm">📦 Registrar Entrega Parcial</button>
                      <button onClick={marcarTudoEntregue} disabled={marcandoTudoEntregue} className="w-full bg-green-600 text-white py-2 rounded-xl font-bold hover:bg-green-700 transition text-sm disabled:opacity-50">{marcandoTudoEntregue ? 'Salvando...' : '✅ Marcar Tudo Entregue'}</button>
                    </>
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

      {/* Modal PDV — Venda Rápida (balcão) */}
      {mostrarPDV && (() => {
        const pdvSubtotal = pdvItens.reduce((s, i) => s + (i.preco_custom ?? i.produto.preco) * i.quantidade, 0);
        const pdvFiltrados = produtos.filter(p => p.nome.toLowerCase().includes(pdvBusca.toLowerCase()));
        const ajustarQtd = (produtoId: string, delta: number) => {
          setPdvItens(prev => {
            const ex = prev.find(i => i.produto.id === produtoId);
            if (!ex) return prev;
            const nova = ex.quantidade + delta;
            if (nova <= 0) return prev.filter(i => i.produto.id !== produtoId);
            return prev.map(i => i.produto.id === produtoId ? { ...i, quantidade: nova } : i);
          });
        };
        // Preco unitario editavel (ex: saco de agregado a R$5 na retirada).
        // Grava em preco_custom; valor igual ao catalogo limpa o override.
        const ajustarPreco = (produtoId: string, preco: number | null) => {
          setPdvItens(prev => prev.map(i => {
            if (i.produto.id !== produtoId) return i;
            const limpo: { produto: Produto; quantidade: number; preco_custom?: number } = { ...i };
            if (preco === null || preco === i.produto.preco) delete limpo.preco_custom;
            else limpo.preco_custom = preco;
            return limpo;
          }));
        };
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !salvandoPDV && setMostrarPDV(false)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800">🏪 Venda Rápida (PDV)</h2>
                <button onClick={() => setMostrarPDV(false)} disabled={salvandoPDV} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Cliente *</label>
                  <input type="text" value={pdvNome} onChange={e => setPdvNome(e.target.value)} placeholder="Cliente balcão"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Telefone (opcional)</label>
                  <input type="tel" value={pdvTelefone} onChange={e => setPdvTelefone(e.target.value)} placeholder="—"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                </div>
              </div>
              <div className="mb-3">
                <input type="text" value={pdvBusca} onChange={e => setPdvBusca(e.target.value)} placeholder="Buscar produto para adicionar..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]" />
                {pdvBusca && (
                  <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                    {pdvFiltrados.slice(0, 20).map(p => (
                      <button key={p.id} type="button" onClick={() => {
                        setPdvItens(prev => {
                          const ex = prev.find(i => i.produto.id === p.id);
                          if (ex) return prev.map(i => i.produto.id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i);
                          return [...prev, { produto: p, quantidade: 1 }];
                        });
                      }} className="w-full flex justify-between items-center text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-gray-100 last:border-0">
                        <span className="truncate">{p.nome}</span>
                        <span className="text-xs font-semibold text-[#F7941D]">R$ {formatBRL(p.preco)}/{p.unidade}</span>
                      </button>
                    ))}
                    {pdvFiltrados.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Nenhum produto</p>}
                  </div>
                )}
              </div>
              {pdvItens.length > 0 && (
                <div className="mb-4 border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {pdvItens.map(item => (
                    <div key={item.produto.id} className="flex items-center justify-between p-2">
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.produto.nome}</p>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-500">R$</span>
                          <input
                            type="number" min={0} step={0.01}
                            value={item.preco_custom ?? item.produto.preco}
                            onChange={e => { const v = parseFloat(e.target.value); ajustarPreco(item.produto.id, isNaN(v) ? null : v); }}
                            className="w-20 text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#F7941D] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <span className="text-xs text-gray-500 whitespace-nowrap">× {item.quantidade} = R$ {formatBRL((item.preco_custom ?? item.produto.preco) * item.quantidade)}</span>
                          {item.preco_custom != null && item.preco_custom !== item.produto.preco && (
                            <span className="text-[10px] text-[#F7941D] font-semibold whitespace-nowrap">✎ alterado</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => ajustarQtd(item.produto.id, -1)} className="bg-gray-200 text-gray-700 w-7 h-7 rounded font-bold">−</button>
                        <span className="w-10 text-center text-sm font-semibold">{item.quantidade}</span>
                        <button type="button" onClick={() => ajustarQtd(item.produto.id, 1)} className="bg-gray-200 text-gray-700 w-7 h-7 rounded font-bold">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status pagamento</label>
                  <select value={pdvStatusPagamento} onChange={e => setPdvStatusPagamento(e.target.value as 'pago' | 'pendente')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white">
                    <option value="pago">✅ Pago</option>
                    <option value="pendente">⏳ Pendente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Forma de pagamento</label>
                  <select value={pdvFormaPagamento} onChange={e => setPdvFormaPagamento(e.target.value as 'pix' | 'dinheiro' | 'debito' | 'credito')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D] bg-white">
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="debito">Débito</option>
                    <option value="credito">Crédito</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-between items-center mb-3 px-1">
                <span className="text-sm text-gray-600">Total:</span>
                <span className="text-xl font-bold text-[#F7941D]">R$ {formatBRL(pdvSubtotal)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setMostrarPDV(false)} disabled={salvandoPDV}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50">Cancelar</button>
                <button onClick={finalizarVendaPDV} disabled={salvandoPDV || pdvItens.length === 0 || !pdvNome.trim()}
                  className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold hover:bg-green-700 transition disabled:opacity-50">
                  {salvandoPDV ? 'Salvando...' : 'Finalizar Venda'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Registrar Entrega Parcial */}
      {mostrarRegistrarParcial && orcamentoDetalhe && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !salvandoParcial && setMostrarRegistrarParcial(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-3">📦 Registrar Entrega Parcial</h2>
            <p className="text-xs text-gray-500 mb-3">Pedido {orcamentoDetalhe.codigo}. Informe a quantidade de cada item nesta viagem.</p>
            <div className="space-y-2 mb-4">
              {orcamentoDetalhe.orcamento_itens.map(it => {
                const total = Number(it.quantidade);
                const entregue = Number(it.quantidade_entregue) || 0;
                const restante = total - entregue;
                if (restante <= 1e-9) return null;
                return (
                  <div key={it.id} className="border border-gray-200 rounded-lg p-2">
                    <p className="text-sm font-medium text-gray-800">{it.produto_nome}</p>
                    <p className="text-xs text-gray-500 mb-1">Restante: {restante} {it.unidade}</p>
                    <input
                      type="number"
                      min="0"
                      max={restante}
                      step="any"
                      placeholder="Quantidade nesta viagem"
                      value={parcialQtds[it.id] ?? ''}
                      onChange={e => setParcialQtds(prev => ({ ...prev, [it.id]: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#F7941D]"
                    />
                  </div>
                );
              })}
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Observações (opcional)</label>
              <textarea
                value={parcialObs}
                onChange={e => setParcialObs(e.target.value)}
                rows={2}
                placeholder="Ex: Primeira viagem - só areia e cimento"
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#F7941D]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMostrarRegistrarParcial(false)}
                disabled={salvandoParcial}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
              >Cancelar</button>
              <button
                onClick={confirmarEntregaParcial}
                disabled={salvandoParcial}
                className="flex-1 bg-indigo-500 text-white py-2 rounded-lg font-bold hover:bg-indigo-600 transition disabled:opacity-50"
              >{salvandoParcial ? 'Salvando...' : 'Confirmar Entrega Parcial'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Cancelamento de Entrega Parcial */}
      {entregaParaCancelar && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !cancelandoParcial && setEntregaParaCancelar(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Cancelar entrega parcial</h2>
            <p className="text-sm text-gray-600 mb-4">
              Deseja cancelar a Entrega #{entregaParaCancelar.numero_entrega}? As quantidades voltarão a aparecer como pendentes.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setEntregaParaCancelar(null)}
                disabled={cancelandoParcial}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition disabled:opacity-50"
              >Voltar</button>
              <button
                onClick={() => cancelarEntregaParcial(entregaParaCancelar.id)}
                disabled={cancelandoParcial}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold hover:bg-red-700 transition disabled:opacity-50"
              >{cancelandoParcial ? 'Cancelando...' : 'Cancelar entrega'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Perfil do Cliente */}
      {clienteProfileId && (
        <ClienteProfile
          clienteId={clienteProfileId}
          onClose={() => setClienteProfileId(null)}
          onAbrirPedido={abrirDetalhe}
        />
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
      {/* Cobranca ao concluir entrega com saldo em aberto */}
      {cobrancaEntrega && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">Concluir entrega</h3>
              <button onClick={() => setCobrancaEntrega(null)} disabled={cobrancaSalvando} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-sm text-gray-600">{cobrancaEntrega.cliente_nome} · {cobrancaEntrega.codigo}</p>
            <p className="text-xs text-gray-500 mb-4">
              Em aberto: <strong>{(cobrancaEntrega.a_cobrar ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong> de {cobrancaEntrega.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>

            <label className="block text-xs font-medium text-gray-600 mb-1">Valor recebido</label>
            <input
              type="text"
              inputMode="decimal"
              value={cobrancaValor}
              onChange={e => setCobrancaValor(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-3 text-sm"
            />
            <label className="block text-xs font-medium text-gray-600 mb-1">Forma</label>
            <select
              value={cobrancaMetodo}
              onChange={e => setCobrancaMetodo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-4 text-sm bg-white"
            >
              <option value="pix">Pix</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
            </select>

            <button
              onClick={confirmarCobrancaEntrega}
              disabled={cobrancaSalvando}
              className="w-full bg-[#F7941D] text-white rounded-lg py-2.5 font-medium hover:bg-[#E8850A] transition disabled:opacity-50 mb-2"
            >
              {cobrancaSalvando ? 'Salvando…' : 'Receber e concluir'}
            </button>
            <button
              onClick={marcarEntregueSemPagamento}
              disabled={cobrancaSalvando}
              className="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
            >
              Entregar sem pagamento
            </button>
            <p className="text-[11px] text-gray-400 mt-2 text-center">
              Sem pagamento, o pedido fica marcado e continua no financeiro como a receber.
            </p>
          </div>
        </div>
      )}

      {showCalculadoraFerro && (
        <CalculadoraFerroModal
          onAdicionarItens={adicionarItensAvulsos}
          onClose={() => setShowCalculadoraFerro(false)}
        />
      )}
      {showCalculadoraMadeira && (
        <CalculadoraMadeiraModal
          produtos={produtos.filter(ehProdutoCalculadoraMadeira)}
          onAdicionar={adicionarMadeiraCalculada}
          onClose={() => setShowCalculadoraMadeira(false)}
        />
      )}
      {showCalculadoraLaje && (
        <CalculadoraLajeModal
          produtos={produtos}
          onAdicionar={adicionarLajeCalculada}
          onClose={() => setShowCalculadoraLaje(false)}
        />
      )}
      </div>
    </div>
  );
}


