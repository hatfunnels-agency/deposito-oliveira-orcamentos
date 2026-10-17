'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Gauge, CalendarDays, Receipt, Repeat, ArrowLeftRight, CreditCard, Scale, Calculator, Users, FileText, IdCard, BarChart3, Package, Camera, BookOpen,
  Menu, LogOut, ArrowLeft, X, type LucideIcon,
} from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-client';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import type { ContextoFinanceiro, Papel } from '@/lib/financeiro/tipos';
import ExtratosTab from '@/components/ExtratosTab';
import { Carregando, ContextoFinanceiroProvider, Erro } from './Comuns';
import Panorama from './Panorama';
import Dia from './Dia';
import ContasPagar from './ContasPagar';
import DespesasFixas from './DespesasFixas';
import Conciliacao from './Conciliacao';
import Maquininha from './Maquininha';
import Fechamento from './Fechamento';
import Simulador from './Simulador';
import ClientesAReceber from './ClientesAReceber';
import DashboardTab from '@/components/DashboardTab';
import FuncionariosTab from '@/components/FuncionariosTab';
import Estoque from './Estoque';
import BaseConhecimento from './BaseConhecimento';
import LancarPorFoto from './LancarPorFoto';

// Casca da /financeiro: sessao, papel, menu lateral e a secao ativa em
// ?secao=. Admin ve tudo; atendente so "Clientes a receber"; motorista
// volta pro sistema.

export type Secao =
  | 'panorama' | 'dia' | 'pagar' | 'despesas' | 'conciliacao' | 'maquininha'
  | 'fechamento' | 'simulador' | 'receber' | 'extratos' | 'funcionarios' | 'vendas' | 'estoque' | 'conhecimento';

const SECOES: Array<{ key: Secao; rotulo: string; icone: LucideIcon; titulo: string }> = [
  { key: 'panorama', rotulo: 'Panorama', icone: Gauge, titulo: 'Panorama' },
  { key: 'dia', rotulo: 'Dia', icone: CalendarDays, titulo: 'Dia' },
  { key: 'pagar', rotulo: 'A pagar', icone: Receipt, titulo: 'Contas a pagar' },
  { key: 'estoque', rotulo: 'Estoque', icone: Package, titulo: 'Estoque' },
  { key: 'despesas', rotulo: 'Despesas fixas', icone: Repeat, titulo: 'Despesas fixas' },
  { key: 'conciliacao', rotulo: 'Conciliação', icone: ArrowLeftRight, titulo: 'Conciliação bancária' },
  { key: 'maquininha', rotulo: 'Maquininha', icone: CreditCard, titulo: 'Maquininha' },
  { key: 'fechamento', rotulo: 'Fechamento', icone: Scale, titulo: 'Fechamento do mês' },
  { key: 'simulador', rotulo: 'Simulador', icone: Calculator, titulo: 'Simulador de cenários' },
  { key: 'vendas', rotulo: 'Vendas', icone: BarChart3, titulo: 'Vendas (dashboard)' },
  { key: 'funcionarios', rotulo: 'Funcionários', icone: IdCard, titulo: 'Funcionários' },
  { key: 'conhecimento', rotulo: 'Base de conhecimento', icone: BookOpen, titulo: 'Base de conhecimento' },
  { key: 'receber', rotulo: 'Clientes a receber', icone: Users, titulo: 'Clientes a receber' },
  { key: 'extratos', rotulo: 'Extratos', icone: FileText, titulo: 'Extratos' },
];

const ehSecao = (s: string | null): s is Secao => SECOES.some(x => x.key === s);

interface Usuario { id: string; nome: string; papel: Papel }

export default function FinanceiroApp() {
  const router = useRouter();
  const params = useSearchParams();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [sessaoPronta, setSessaoPronta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  // Lancar por foto abre por cima de qualquer secao; ao salvar, a secao
  // atual remonta (key) pra mostrar a conta/estoque novos.
  const [fotoAberta, setFotoAberta] = useState(false);
  const [versaoSecao, setVersaoSecao] = useState(0);

  const [contexto, setContexto] = useState<ContextoFinanceiro | null>(null);
  const [carregandoCtx, setCarregandoCtx] = useState(false);
  const [erroCtx, setErroCtx] = useState<string | null>(null);

  // Sessao e papel. Sem sessao -> login; o proxy ja barra sem cookie, mas o
  // token pode ter expirado no cliente.
  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!ativo) return;
      if (!session?.user) { window.location.href = '/login'; return; }
      const { data } = await supabaseBrowser.from('usuarios').select('nome, papel').eq('id', session.user.id).single();
      if (!ativo) return;
      const papel = (data?.papel ?? 'atendente') as Papel;
      setUsuario({ id: session.user.id, nome: data?.nome ?? session.user.email ?? '', papel });
      setSessaoPronta(true);
    })();
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    if (usuario?.papel === 'motorista') router.replace('/');
  }, [usuario, router]);

  const papel = usuario?.papel ?? null;
  const secaoUrl = params.get('secao');
  const secao: Secao = papel === 'atendente' ? 'receber' : ehSecao(secaoUrl) ? secaoUrl : 'panorama';

  const irPara = useCallback((s: Secao) => {
    router.replace(`/financeiro?secao=${s}`);
    setMenuAberto(false);
  }, [router]);

  // Atendente so tem uma secao: a URL acompanha pra o link compartilhado
  // abrir no lugar certo.
  useEffect(() => {
    if (papel === 'atendente' && secaoUrl !== 'receber') router.replace('/financeiro?secao=receber');
  }, [papel, secaoUrl, router]);

  const carregarContexto = useCallback(async () => {
    setCarregandoCtx(true);
    setErroCtx(null);
    try {
      setContexto(await apiFinanceiro<ContextoFinanceiro>('/api/financeiro/contexto'));
    } catch (e) {
      setErroCtx(e instanceof Error ? e.message : 'Erro ao carregar o contexto financeiro');
    } finally {
      setCarregandoCtx(false);
    }
  }, []);

  // Contexto (categorias, contas, fornecedores, taxas) so pra admin: a rota
  // e exclusiva dele e a atendente nao precisa de nada disso.
  useEffect(() => {
    if (papel === 'admin') carregarContexto();
  }, [papel, carregarContexto]);

  const valorContexto = useMemo(() => ({
    contexto, carregando: carregandoCtx, erro: erroCtx, recarregar: carregarContexto,
  }), [contexto, carregandoCtx, erroCtx, carregarContexto]);

  const sair = async () => {
    await supabaseBrowser.auth.signOut();
    window.location.href = '/login';
  };

  if (!sessaoPronta || !usuario || usuario.papel === 'motorista') {
    return <div className="min-h-screen bg-gray-50"><Carregando texto="Abrindo a gestão financeira…" /></div>;
  }

  const secoesVisiveis = usuario.papel === 'admin' ? SECOES : SECOES.filter(s => s.key === 'receber');
  const atual = SECOES.find(s => s.key === secao) ?? SECOES[0];

  let conteudo: ReactNode;
  switch (secao) {
    case 'panorama': conteudo = <Panorama />; break;
    case 'dia': conteudo = <Dia />; break;
    case 'pagar': conteudo = <ContasPagar />; break;
    case 'despesas': conteudo = <DespesasFixas />; break;
    case 'conciliacao': conteudo = <Conciliacao />; break;
    case 'maquininha': conteudo = <Maquininha />; break;
    case 'fechamento': conteudo = <Fechamento />; break;
    case 'simulador': conteudo = <Simulador />; break;
    case 'estoque': conteudo = <Estoque />; break;
    case 'vendas': conteudo = <DashboardTab />; break;
    case 'funcionarios': conteudo = <FuncionariosTab />; break;
    case 'conhecimento': conteudo = <BaseConhecimento />; break;
    case 'extratos': conteudo = <ExtratosTab vistas={['importar', 'revisar']} />; break;
    case 'receber':
    default:
      conteudo = <ClientesAReceber papel={usuario.papel === 'admin' ? 'admin' : 'atendente'} />;
  }

  return (
    <ContextoFinanceiroProvider value={valorContexto}>
      <div className="min-h-screen bg-gray-50">
        {menuAberto && (
          <button type="button" aria-label="Fechar menu" onClick={() => setMenuAberto(false)}
            className="fixed inset-0 z-40 bg-black/50 md:hidden" />
        )}

        <aside className={`fixed left-0 top-0 z-50 flex h-screen w-60 flex-col bg-slate-800 py-6 px-3 transition-transform duration-200 md:translate-x-0 ${menuAberto ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="mb-4 flex items-start gap-3 border-b border-slate-700 pb-4 px-1">
            <img src="/logo.png" alt="Depósito Oliveira" className="h-10 w-auto rounded" />
            <div className="flex-1">
              <p className="text-lg font-bold text-[#F7941D] leading-tight">Depósito</p>
              <p className="text-lg font-bold text-[#F7941D] leading-tight">Oliveira</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Gestão</p>
            </div>
            <button type="button" aria-label="Fechar menu" onClick={() => setMenuAberto(false)} className="text-slate-300 hover:text-white md:hidden">
              <X size={20} />
            </button>
          </div>

          <nav className="flex flex-col gap-1 overflow-y-auto">
            {secoesVisiveis.map(s => {
              const Icone = s.icone;
              const ativo = s.key === secao;
              return (
                <button key={s.key} type="button" onClick={() => irPara(s.key)}
                  className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${ativo ? 'bg-[#F7941D] text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                  <Icone size={20} />
                  <span className="flex-1 text-left">{s.rotulo}</span>
                </button>
              );
            })}
          </nav>

          <Link href="/" className="mt-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-700 border-t border-slate-700 pt-4">
            <ArrowLeft size={18} />
            Voltar ao sistema
          </Link>
        </aside>

        <div className="md:ml-60 min-h-screen flex flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sticky top-0 z-30">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" aria-label="Abrir menu" onClick={() => setMenuAberto(true)}
                className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
                <Menu size={22} />
              </button>
              <Link href="/" className="hidden sm:inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 min-h-[44px] px-2">
                <ArrowLeft size={16} /> Voltar ao sistema
              </Link>
              <h1 className="text-base font-bold text-gray-800 truncate sm:hidden">{atual.titulo}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {usuario.papel === 'admin' && (
                <button type="button" onClick={() => setFotoAberta(true)} title="Lançar por foto ou à mão (nota, boleto, ticket de pesagem, pagamento)"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#F7941D] px-3 text-sm font-medium text-white hover:bg-[#E8850A] min-h-[44px]">
                  <Camera size={18} /> <span className="hidden sm:inline">Lançar</span>
                </button>
              )}
              <span className="text-sm text-slate-600 truncate max-w-[40vw]">
                {usuario.nome}
                <span className="text-slate-400"> • </span>
                <span className="capitalize">{usuario.papel}</span>
              </span>
              <button type="button" aria-label="Sair" title="Sair" onClick={sair}
                className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
                <LogOut size={20} />
              </button>
            </div>
          </header>

          <main className="max-w-6xl mx-auto w-full px-4 pt-4 pb-10 flex-1">
            {usuario.papel === 'admin' && erroCtx && (
              <Erro className="mb-4" mensagem={`Contexto financeiro: ${erroCtx}`} onTentar={carregarContexto} />
            )}
            <div key={`${secao}-${versaoSecao}`}>{conteudo}</div>
          </main>
        </div>
      </div>
      {fotoAberta && (
        <LancarPorFoto onFechar={() => setFotoAberta(false)} onSalvo={() => setVersaoSecao(v => v + 1)} />
      )}
    </ContextoFinanceiroProvider>
  );
}
