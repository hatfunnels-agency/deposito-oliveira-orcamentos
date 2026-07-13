'use client';

import {
  Package,
  ShoppingCart,
  History,
  Users,
  Wrench,
  Truck,
  Warehouse,
  Wallet,
  BarChart3,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';

// Mesma lista de chaves do union em OrcamentoApp.tsx (linha 388).
export type AbaKey =
  | 'produtos'
  | 'orcamento'
  | 'historico'
  | 'clientes'
  | 'ferragens'
  | 'entregas'
  | 'estoque'
  | 'financeiro'
  | 'ia'
  | 'dashboard';

interface SidebarItem {
  key: AbaKey;
  label: string;
  icon: LucideIcon;
}

// Ordem definitiva dos 10 items. abasVisiveis (no parent) filtra por role.
const SIDEBAR_ITEMS: SidebarItem[] = [
  { key: 'produtos', label: 'Catálogo', icon: Package },
  { key: 'orcamento', label: 'Orçamento', icon: ShoppingCart },
  { key: 'historico', label: 'Histórico', icon: History },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'ferragens', label: 'Ferragens', icon: Wrench },
  { key: 'entregas', label: 'Entregas', icon: Truck },
  { key: 'estoque', label: 'Estoque', icon: Warehouse },
  { key: 'financeiro', label: 'Financeiro', icon: Wallet },
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'ia', label: 'IA', icon: Sparkles },
];

interface SidebarProps {
  abaAtiva: AbaKey;
  setAbaAtiva: (aba: AbaKey) => void;
  abasVisiveis: readonly string[];
  quantidadeItens: number;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function Sidebar({
  abaAtiva,
  setAbaAtiva,
  abasVisiveis,
  quantidadeItens,
  sidebarOpen,
  setSidebarOpen,
}: SidebarProps) {
  const itensFiltrados = SIDEBAR_ITEMS.filter(it => abasVisiveis.includes(it.key));

  const aoClicarItem = (key: AbaKey) => {
    setAbaAtiva(key);
    setSidebarOpen(false);
  };

  return (
    <>
      {/* Backdrop mobile — so renderiza quando aberto. Click fecha. */}
      {sidebarOpen && (
        <button
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-60 flex-col bg-slate-800 py-6 px-3 transition-transform duration-200 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header do sidebar: logo + nome + close (mobile so) */}
        <div className="mb-4 flex items-start gap-3 border-b border-slate-700 pb-4 px-1">
          <img src="/logo.png" alt="Depósito Oliveira" className="h-10 w-auto rounded" />
          <div className="flex-1">
            <p className="text-lg font-bold text-[#F7941D] leading-tight">Depósito</p>
            <p className="text-lg font-bold text-[#F7941D] leading-tight">Oliveira</p>
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
            className="text-slate-300 hover:text-white md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Items */}
        <nav className="flex flex-col gap-1">
          {itensFiltrados.map(item => {
            const Icone = item.icon;
            const ativo = abaAtiva === item.key;
            const mostraBadge = item.key === 'orcamento' && quantidadeItens > 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => aoClicarItem(item.key)}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  ativo
                    ? 'bg-[#F7941D] text-white'
                    : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Icone size={20} />
                <span className="flex-1 text-left">{item.label}</span>
                {mostraBadge && (
                  <span className="ml-auto min-w-[20px] rounded-full bg-red-500 px-2 py-0.5 text-center text-xs font-bold text-white">
                    {quantidadeItens}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
