'use client';

import { useEffect, useRef, useState } from 'react';

// Resultado normalizado da busca — mesmo shape pra CEP (ViaCEP) e pra
// sugestao do Google Places (/api/endereco?type=details).
export interface EnderecoEncontrado {
  cep: string;
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
}

// Campo de busca por CEP ou nome de rua. Usado nos forms de "novo
// endereco" (picker do pedido e perfil do cliente). O form principal de
// cliente sem endereco tem a sua propria busca inline no OrcamentoApp.
export default function BuscaEndereco({
  onSelecionar,
  className = '',
}: {
  onSelecionar: (e: EnderecoEncontrado) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState('');
  const [sugestoes, setSugestoes] = useState<Array<{ place_id: string; descricao: string }>>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  async function buscarCep(cep: string) {
    setBuscando(true);
    setErro('');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) {
        setErro('CEP não encontrado.');
      } else {
        onSelecionar({
          cep,
          rua: data.logradouro || '',
          numero: '',
          bairro: data.bairro || '',
          cidade: data.localidade || '',
          estado: data.uf || '',
        });
      }
    } catch {
      setErro('Erro ao buscar CEP.');
    }
    setBuscando(false);
  }

  function aoDigitar(val: string) {
    setTexto(val);
    setErro('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const digitos = val.replace(/\D/g, '');
    if (/^\d{5}-?\d{3}$/.test(val.trim()) && digitos.length === 8) {
      setSugestoes([]);
      void buscarCep(digitos);
      return;
    }
    if (val.trim().length < 3) {
      setSugestoes([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/endereco?type=autocomplete&q=${encodeURIComponent(val)}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.error) setErro(data.error);
        setSugestoes(data.suggestions || []);
      } catch {
        setSugestoes([]);
      }
    }, 300);
  }

  async function escolher(s: { place_id: string; descricao: string }) {
    setSugestoes([]);
    setTexto(s.descricao);
    setBuscando(true);
    setErro('');
    try {
      const res = await fetch(`/api/endereco?type=details&place_id=${encodeURIComponent(s.place_id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) {
        setErro(data.error);
      } else {
        onSelecionar({
          cep: data.cep || '',
          rua: data.logradouro || '',
          numero: data.numero || '',
          bairro: data.bairro || '',
          cidade: data.cidade || '',
          estado: data.estado || '',
        });
      }
    } catch {
      setErro('Erro ao buscar detalhes do endereço.');
    }
    setBuscando(false);
  }

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        placeholder="🔍 Buscar por CEP ou rua"
        value={texto}
        onChange={e => aoDigitar(e.target.value)}
        onBlur={() => setTimeout(() => setSugestoes([]), 200)}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F7941D]"
      />
      {buscando && <span className="absolute right-3 top-2.5 text-xs text-gray-400">buscando...</span>}
      {sugestoes.length > 0 && (
        <ul className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
          {sugestoes.map(s => (
            <li
              key={s.place_id}
              onMouseDown={e => { e.preventDefault(); void escolher(s); }}
              className="px-3 py-2 text-sm hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0"
            >
              📍 {s.descricao}
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="mt-1 text-xs text-red-500">{erro}</p>}
    </div>
  );
}
