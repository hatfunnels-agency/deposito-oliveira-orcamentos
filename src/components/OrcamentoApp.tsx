'use client';

import { useState, useEffect, useCallback } from 'react';

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
  endereco: {
    logradouro: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
  distanciaAproximadaKm: number;
  valorFrete: number;
  observacao: string;
}

const PESO_MEDIO_KG: Record<string, number> = {
  'saco': 50,
  'unidade': 5,
  'barra': 15,
  'metro': 10,
  'rolo': 20,
};

export default function OrcamentoApp() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [fonteProdutos, setFonteProdutos] = useState('');
  const [mensagemAPI, setMensagemAPI] = useState('');
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Todas');
  const [abaAtiva, setAbaAtiva] = useState<'produtos' | 'orcamento'>('produtos');
  const [tipoEntrega, setTipoEntrega] = useState<'retirada' | 'entrega'>('retirada');
  const [cepDestino, setCepDestino] = useState('');
  const [dadosFrete, setDadosFrete] = useState<DadosFrete | null>(null);
  const [calculandoFrete, setCalculandoFrete] = useState(false);
  const [nomeCliente, setNomeCliente] = useState('');
  const [whatsappCliente, setWhatsappCliente] = useState('');
  const [mostrarModal, setMostrarModal] = useState(false);
  const [erroFrete, setErroFrete] = useState('');
  const [enderecoViaCEP, setEnderecoViaCEP] = useState('');

  useEffect(() => {
    fetch('/api/produtos')
      .then(r => r.json())
      .then(data => {
        setProdutos(data.produtos || []);
        setFonteProdutos(data.fonte || 'demo');
        setMensagemAPI(data.mensagem || '');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setMensagemAPI('Erro ao carregar produtos.');
      });
  }, []);

  const categorias = ['Todas', ...Array.from(new Set(produtos.map(p => p.categoria)))];

  const produtosFiltrados = produtos.filter(p => {
    const matchBusca = p.nome.toLowerCase().includes(busca.toLowerCase());
    const matchCategoria = categoriaSelecionada === 'Todas' || p.categoria === categoriaSelecionada;
    return matchBusca && matchCategoria;
  });

  const adicionarItem = (produto: Produto) => {
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === produto.id);
      if (existing) {
        return prev.map(i => i.produto.id === produto.id
          ? { ...i, quantidade: i.quantidade + 1 }
          : i
        );
      }
      return [...prev, { produto, quantidade: 1 }];
    });
  };

  const removerItem = (produtoId: string) => {
    setItens(prev => {
      const existing = prev.find(i => i.produto.id === produtoId);
      if (existing && existing.quantidade > 1) {
        return prev.map(i => i.produto.id === produtoId
          ? { ...i, quantidade: i.quantidade - 1 }
          : i
        );
      }
      return prev.filter(i => i.produto.id !== produtoId);
    });
  };

  const getQuantidade = (produtoId: string) => {
    return itens.find(i => i.produto.id === produtoId)?.quantidade || 0;
  };

  const subtotal = itens.reduce((acc, item) => acc + (item.produto.preco * item.quantidade), 0);
  const totalFrete = tipoEntrega === 'entrega' && dadosFrete ? dadosFrete.valorFrete : 0;
  const total = subtotal + totalFrete;

  const pesoTotal = itens.reduce((acc, item) => {
    const pesoUnit = PESO_MEDIO_KG[item.produto.unidade] || 5;
    return acc + (pesoUnit * item.quantidade);
  }, 0);

  const buscarEnderecoCEP = useCallback(async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setEnderecoViaCEP(`${data.logradouro}, ${data.bairro}, ${data.localidade}-${data.uf}`);
      }
    } catch {}
  }, []);

  const calcularFrete = async () => {
    if (!cepDestino || cepDestino.replace(/\D/g, '').length !== 8) {
      setErroFrete('Digite um CEP valido com 8 digitos.');
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
      if (data.erro) {
        setErroFrete(data.erro);
      } else {
        setDadosFrete(data);
      }
    } catch {
      setErroFrete('Erro ao calcular frete. Tente novamente.');
    }
    setCalculandoFrete(false);
  };

  const gerarTextoWhatsApp = () => {
    const linhas = [
      '*ORCAMENTO - Deposito Oliveira*',
      '----------------------------',
      nomeCliente ? `*Cliente:* ${nomeCliente}` : '',
      '',
      '*Produtos:*',
      ...itens.map(i => `- ${i.produto.nome} x${i.quantidade} = R$ ${(i.produto.preco * i.quantidade).toFixed(2)}`),
      '',
      `*Subtotal:* R$ ${subtotal.toFixed(2)}`,
      tipoEntrega === 'entrega' && dadosFrete
        ? `*Frete (${dadosFrete.endereco.cidade}-${dadosFrete.endereco.estado}):* R$ ${dadosFrete.valorFrete.toFixed(2)}`
        : '*Retirada na loja*',
      `*TOTAL: R$ ${total.toFixed(2)}`,
      '',
      '_Orcamento valido por 7 dias_',
      '_Sujeito a disponibilidade de estoque_',
    ].filter(l => l !== undefined);
    return linhas.join('\n');
  };

  const compartilharWhatsApp = () => {
    const texto = gerarTextoWhatsApp();
    const numLimpo = whatsappCliente.replace(/\D/g, '');
    if (numLimpo) {
      window.open(`https://wa.me/55${numLimpo}?text=${encodeURIComponent(texto)}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
    }
  };

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
      {/* Header */}
      <header className="bg-blue-700 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Deposito Oliveira</h1>
            <p className="text-blue-200 text-sm">Sistema de Orcamentos</p>
          </div>
          <div className="flex items-center gap-4">
            {fonteProdutos === 'demo' && (
              <span className="bg-yellow-500 text-yellow-900 text-xs px-2 py-1 rounded-full font-medium">
                DEMO
              </span>
            )}
            {fonteProdutos === 'bling' && (
              <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full font-medium">
                BLING
              </span>
            )}
            <button
              onClick={() => setAbaAtiva('orcamento')}
              className="relative bg-white text-blue-700 font-bold px-4 py-2 rounded-lg hover:bg-blue-50 transition"
            >
              Orcamento
              {itens.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {itens.reduce((a, i) => a + i.quantidade, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* API Status Banner */}
      {mensagemAPI && (
        <div className={`px-4 py-2 text-sm text-center ${fonteProdutos === 'bling' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          {mensagemAPI}
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setAbaAtiva('produtos')}
            className={`px-6 py-3 font-medium text-sm ${abaAtiva === 'produtos' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Catalogo de Produtos
          </button>
          <button
            onClick={() => setAbaAtiva('orcamento')}
            className={`px-6 py-3 font-medium text-sm ${abaAtiva === 'orcamento' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Meu Orcamento ({itens.reduce((a, i) => a + i.quantidade, 0)} itens)
          </button>
        </div>

        {/* ABA: PRODUTOS */}
        {abaAtiva === 'produtos' && (
          <div>
            {/* Filtros */}
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input
                type="text"
                placeholder="Buscar produto..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <select
                value={categoriaSelecionada}
                onChange={e => setCategoriaSelecionada(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {categorias.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Grid de Produtos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-8">
              {produtosFiltrados.map(produto => {
                const qtd = getQuantidade(produto.id);
                return (
                  <div key={produto.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition">
                    <div className="mb-2">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {produto.categoria}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-800 text-sm mb-1 min-h-[40px]">{produto.nome}</h3>
                    <p className="text-blue-700 font-bold text-lg mb-1">
                      R$ {produto.preco.toFixed(2)}
                      <span className="text-xs text-gray-400 font-normal">/{produto.unidade}</span>
                    </p>
                    <p className="text-xs text-gray-500 mb-3">
                      Estoque: {produto.estoque} {produto.unidade}s
                    </p>
                    {qtd === 0 ? (
                      <button
                        onClick={() => adicionarItem(produto)}
                        className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
                      >
                        + Adicionar
                      </button>
                    ) : (
                      <div className="flex items-center justify-between bg-blue-50 rounded-lg p-1">
                        <button
                          onClick={() => removerItem(produto.id)}
                          className="w-8 h-8 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition"
                        >
                          -
                        </button>
                        <span className="font-bold text-blue-700 text-lg">{qtd}</span>
                        <button
                          onClick={() => adicionarItem(produto)}
                          className="w-8 h-8 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {produtosFiltrados.length === 0 && (
                <div className="col-span-4 text-center py-12 text-gray-400">
                  Nenhum produto encontrado.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA: ORCAMENTO */}
        {abaAtiva === 'orcamento' && (
          <div className="max-w-2xl mx-auto pb-8">
            {itens.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-5xl mb-4">🛒</p>
                <p className="text-lg">Seu orcamento esta vazio</p>
                <button
                  onClick={() => setAbaAtiva('produtos')}
                  className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  Ver Produtos
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Lista de itens */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <h2 className="font-bold text-gray-700">Itens do Orcamento</h2>
                  </div>
                  {itens.map(item => (
                    <div key={item.produto.id} className="flex items-center gap-3 p-4 border-b border-gray-50 last:border-0">
                      <div className="flex-1">
                        <p className="font-medium text-gray-800 text-sm">{item.produto.nome}</p>
                        <p className="text-xs text-gray-500">R$ {item.produto.preco.toFixed(2)}/{item.produto.unidade}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => removerItem(item.produto.id)}
                          className="w-7 h-7 bg-red-100 text-red-600 rounded font-bold hover:bg-red-200 transition text-sm"
                        >
                          -
                        </button>
                        <span className="w-8 text-center font-bold">{item.quantidade}</span>
                        <button
                          onClick={() => adicionarItem(item.produto)}
                          className="w-7 h-7 bg-green-100 text-green-600 rounded font-bold hover:bg-green-200 transition text-sm"
                        >
                          +
                        </button>
                      </div>
                      <p className="w-24 text-right font-bold text-blue-700 text-sm">
                        R$ {(item.produto.preco * item.quantidade).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Dados do Cliente */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Dados do Cliente</h2>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Nome do cliente"
                      value={nomeCliente}
                      onChange={e => setNomeCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <input
                      type="tel"
                      placeholder="WhatsApp (ex: 11999998888)"
                      value={whatsappCliente}
                      onChange={e => setWhatsappCliente(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {/* Entrega ou Retirada */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <h2 className="font-bold text-gray-700 mb-3">Forma de Entrega</h2>
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={() => setTipoEntrega('retirada')}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${tipoEntrega === 'retirada' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      Retirar na Loja
                    </button>
                    <button
                      onClick={() => setTipoEntrega('entrega')}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition ${tipoEntrega === 'entrega' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      Entrega no Endereco
                    </button>
                  </div>

                  {tipoEntrega === 'entrega' && (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="CEP de entrega"
                          value={cepDestino}
                          onChange={e => {
                            setCepDestino(e.target.value);
                            setDadosFrete(null);
                            setEnderecoViaCEP('');
                            if (e.target.value.replace(/\D/g, '').length === 8) {
                              buscarEnderecoCEP(e.target.value);
                            }
                          }}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          maxLength={9}
                        />
                        <button
                          onClick={calcularFrete}
                          disabled={calculandoFrete}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
                        >
                          {calculandoFrete ? '...' : 'Calcular'}
                        </button>
                      </div>
                      {enderecoViaCEP && !dadosFrete && (
                        <p className="text-xs text-gray-500">{enderecoViaCEP}</p>
                      )}
                      {erroFrete && (
                        <p className="text-xs text-red-500">{erroFrete}</p>
                      )}
                      {dadosFrete && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-sm font-medium text-green-800">
                            {dadosFrete.endereco.logradouro}, {dadosFrete.endereco.bairro}
                          </p>
                          <p className="text-xs text-green-600">{dadosFrete.endereco.cidade}-{dadosFrete.endereco.estado}</p>
                          <p className="text-sm font-bold text-green-700 mt-1">
                            Frete estimado: R$ {dadosFrete.valorFrete.toFixed(2)}
                          </p>
                          <p className="text-xs text-green-500">{dadosFrete.observacao}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Resumo Total */}
                <div className="bg-blue-700 text-white rounded-xl p-4">
                  <div className="flex justify-between mb-1">
                    <span className="text-blue-200 text-sm">Subtotal:</span>
                    <span className="font-medium">R$ {subtotal.toFixed(2)}</span>
                  </div>
                  {tipoEntrega === 'entrega' && dadosFrete && (
                    <div className="flex justify-between mb-1">
                      <span className="text-blue-200 text-sm">Frete:</span>
                      <span className="font-medium">R$ {dadosFrete.valorFrete.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between mt-2 pt-2 border-t border-blue-600">
                    <span className="font-bold text-lg">TOTAL:</span>
                    <span className="font-bold text-xl">R$ {total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Botao Gerar Orcamento */}
                <button
                  onClick={() => setMostrarModal(true)}
                  className="w-full bg-green-600 text-white py-4 rounded-xl text-lg font-bold hover:bg-green-700 transition shadow-lg"
                >
                  Gerar Orcamento
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Orcamento */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 text-center">Orcamento Gerado!</h2>
            
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm font-mono whitespace-pre-wrap text-gray-700 max-h-64 overflow-y-auto">
              {gerarTextoWhatsApp()}
            </div>

            <div className="space-y-3">
              <button
                onClick={compartilharWhatsApp}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-600 transition flex items-center justify-center gap-2"
              >
                Enviar por WhatsApp
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(gerarTextoWhatsApp());
                  alert('Texto copiado!');
                }}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition"
              >
                Copiar Texto
              </button>
              <button
                onClick={() => setMostrarModal(false)}
                className="w-full text-gray-500 py-2 hover:text-gray-700 transition text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}