'use client';

import { useState } from 'react';

// Corrige nome/recebedor do cliente e um endereco dele (numero errado, rua
// incompleta). Usado no formulario de orcamento e no detalhe do pedido.
// Endereco editado vale para todos os pedidos que usam esse endereco — e o
// que se quer quando o numero estava errado.

export interface EnderecoEditavel {
  id: string;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

export interface ResultadoEdicaoCliente {
  nome: string;
  recebedor: string;
  endereco: EnderecoEditavel | null;
}

const INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]';

export default function EditarClienteEndereco({ clienteId, nome, recebedor, endereco, onFechar, onSalvo }: {
  clienteId: string;
  nome: string;
  recebedor?: string | null;
  endereco?: EnderecoEditavel | null;
  onFechar: () => void;
  onSalvo: (r: ResultadoEdicaoCliente) => void;
}) {
  const [nomeF, setNomeF] = useState(nome);
  const [recebedorF, setRecebedorF] = useState(recebedor ?? '');
  const [end, setEnd] = useState<EnderecoEditavel | null>(endereco ?? null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const campo = (k: keyof Omit<EnderecoEditavel, 'id'>, v: string) => setEnd(e => (e ? { ...e, [k]: v } : e));

  const salvar = async () => {
    setErro(null);
    if (!nomeF.trim()) { setErro('Informe o nome do cliente.'); return; }
    setSalvando(true);
    try {
      const r1 = await fetch(`/api/clientes/${clienteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ nome: nomeF.trim(), recebedor: recebedorF.trim() }),
      });
      const d1 = await r1.json().catch(() => null);
      if (!r1.ok || d1?.error) throw new Error(d1?.error || 'Erro ao salvar o cliente');

      let endSalvo = end;
      if (end && endereco) {
        const mudou = (['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado'] as const)
          .some(k => (end[k] ?? '') !== (endereco[k] ?? ''));
        if (mudou) {
          const r2 = await fetch(`/api/clientes/${clienteId}/enderecos/${end.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({
              cep: end.cep?.trim() || null, rua: end.rua?.trim() || null, numero: end.numero?.trim() || null,
              complemento: end.complemento?.trim() || null, bairro: end.bairro?.trim() || null,
              cidade: end.cidade?.trim() || null, estado: end.estado?.trim() || null,
            }),
          });
          const d2 = await r2.json().catch(() => null);
          if (!r2.ok || d2?.error) throw new Error(d2?.error || 'Erro ao salvar o endereço');
          endSalvo = { ...end, ...(d2 && typeof d2 === 'object' ? d2 : {}) };
        }
      }
      onSalvo({ nome: nomeF.trim(), recebedor: recebedorF.trim(), endereco: endSalvo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800">✏️ Editar cliente</h3>
          <button onClick={onFechar} disabled={salvando} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Fechar">×</button>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Nome</span>
          <input value={nomeF} onChange={e => setNomeF(e.target.value)} className={INPUT} autoFocus />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Recebedor (opcional)</span>
          <input value={recebedorF} onChange={e => setRecebedorF(e.target.value)} className={INPUT} placeholder="Quem recebe na obra" />
        </label>

        {end ? (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Endereço</p>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <label className="block"><span className="text-xs text-gray-600">Rua</span>
                <input value={end.rua ?? ''} onChange={e => campo('rua', e.target.value)} className={INPUT} /></label>
              <label className="block"><span className="text-xs text-gray-600">Número</span>
                <input value={end.numero ?? ''} onChange={e => campo('numero', e.target.value)} className={INPUT} /></label>
            </div>
            <label className="block"><span className="text-xs text-gray-600">Complemento</span>
              <input value={end.complemento ?? ''} onChange={e => campo('complemento', e.target.value)} className={INPUT} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-gray-600">Bairro</span>
                <input value={end.bairro ?? ''} onChange={e => campo('bairro', e.target.value)} className={INPUT} /></label>
              <label className="block"><span className="text-xs text-gray-600">Cidade</span>
                <input value={end.cidade ?? ''} onChange={e => campo('cidade', e.target.value)} className={INPUT} /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-gray-600">CEP</span>
                <input value={end.cep ?? ''} onChange={e => campo('cep', e.target.value)} className={INPUT} inputMode="numeric" /></label>
              <label className="block"><span className="text-xs text-gray-600">UF</span>
                <input value={end.estado ?? ''} onChange={e => campo('estado', e.target.value.toUpperCase().slice(0, 2))} className={INPUT} /></label>
            </div>
            <p className="text-[11px] text-gray-500">Vale para todos os pedidos com este endereço. A localização no mapa é refeita sozinha.</p>
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 border-t border-gray-100 pt-3">Sem endereço escolhido: aqui só muda o nome. Para outro endereço, use "Cadastrar novo endereço".</p>
        )}

        {erro && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onFechar} disabled={salvando} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="flex-1 bg-[#F7941D] text-white py-2.5 rounded-xl text-sm font-bold hover:bg-[#E8850A] disabled:opacity-60">{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
