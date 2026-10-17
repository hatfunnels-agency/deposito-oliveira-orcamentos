'use client';

import { useEffect, useState } from 'react';
import { Camera, HandCoins, Package, Receipt, Truck } from 'lucide-react';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { brl, hojeBRT } from '@/lib/financeiro/formato';
import { Aviso, BotaoPrimario, Campo, CampoMoeda, Cartao, INPUT, LinkSecao } from './Comuns';

// Gestao > Rapido: a tela do gerente no celular. Tres coisas que ele faz
// todo dia, cada uma em um toque: lancar vale, dar entrada em mercadoria
// (com o boleto) e mandar as entregas pra rota. E a secao inicial no celular.

interface Func { id: string; nome: string; ativo: boolean }

export default function Rapido({ onLancar }: { onLancar: () => void }) {
  const [funcs, setFuncs] = useState<Func[]>([]);
  const [funcionarioId, setFuncionarioId] = useState('');
  const [valor, setValor] = useState<number | null>(null);
  const [descricao, setDescricao] = useState('');
  const [metodo, setMetodo] = useState<'dinheiro' | 'pix'>('dinheiro');
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiFinanceiro<{ funcionarios: Func[] }>('/api/funcionarios')
      .then(d => { const ativos = (d.funcionarios ?? []).filter(f => f.ativo); setFuncs(ativos); if (ativos[0]) setFuncionarioId(ativos[0].id); })
      .catch(() => {});
  }, []);

  const lancarVale = async () => {
    setErro(null); setOk(null);
    if (!funcionarioId) { setErro('Escolha o funcionário.'); return; }
    if (!valor || valor <= 0) { setErro('Informe o valor.'); return; }
    setSalvando(true);
    try {
      await apiFinanceiro('/api/funcionarios/vales', {
        method: 'POST', body: JSON.stringify({ funcionario_id: funcionarioId, valor, data: hojeBRT(), descricao: descricao.trim() || null, metodo }),
      });
      const nome = funcs.find(f => f.id === funcionarioId)?.nome ?? 'funcionário';
      setOk(`Vale de ${brl(valor)} lançado para ${nome}. Desconta no próximo pagamento.`);
      setValor(null); setDescricao('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao lançar o vale');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Cartao titulo="Lançar vale" descricao="Sai do caixa (dinheiro) ou do banco (Pix) e desconta no próximo pagamento.">
        <div className="space-y-3">
          <Campo rotulo="Funcionário">
            <select value={funcionarioId} onChange={e => setFuncionarioId(e.target.value)} className={`${INPUT} min-h-[48px] text-base`}>
              {funcs.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Valor"><CampoMoeda value={valor} onChange={setValor} className="min-h-[48px] text-base" /></Campo>
            <Campo rotulo="Como">
              <select value={metodo} onChange={e => setMetodo(e.target.value as 'dinheiro' | 'pix')} className={`${INPUT} min-h-[48px] text-base`}>
                <option value="dinheiro">Dinheiro (caixa)</option>
                <option value="pix">Pix (banco)</option>
              </select>
            </Campo>
          </div>
          <Campo rotulo="Motivo (opcional)"><input value={descricao} onChange={e => setDescricao(e.target.value)} className={`${INPUT} min-h-[48px] text-base`} placeholder="ex.: adiantamento, remédio" /></Campo>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {ok && <Aviso tom="ok">{ok}</Aviso>}
          <BotaoPrimario onClick={lancarVale} carregando={salvando} className="w-full min-h-[52px] text-base"><HandCoins className="w-5 h-5" /> Lançar vale</BotaoPrimario>
        </div>
      </Cartao>

      <Cartao titulo="Chegou mercadoria" descricao="Foto da nota, do boleto ou do ticket de pesagem — ou à mão. Cria a conta a pagar e dá entrada no estoque.">
        <BotaoPrimario onClick={onLancar} className="w-full min-h-[52px] text-base"><Camera className="w-5 h-5" /> Lançar nota / boleto / entrada</BotaoPrimario>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <LinkSecao secao="estoque" className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-center text-gray-700 min-h-[48px] inline-flex items-center justify-center gap-1"><Package className="w-4 h-4" /> Estoque</LinkSecao>
          <LinkSecao secao="pagar" className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-center text-gray-700 min-h-[48px] inline-flex items-center justify-center gap-1"><Receipt className="w-4 h-4" /> Contas a pagar</LinkSecao>
        </div>
      </Cartao>

      <Cartao titulo="Entregas de hoje" descricao="Marque as entregas, escolha o motorista e mande pra rota. O aviso de WhatsApp sai pelo sistema.">
        <a href="/?aba=entregas" className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-base font-semibold text-white hover:bg-slate-700 min-h-[52px]">
          <Truck className="w-5 h-5" /> Abrir entregas
        </a>
      </Cartao>
    </div>
  );
}
