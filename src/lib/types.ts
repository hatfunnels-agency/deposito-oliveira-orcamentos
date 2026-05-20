// Tipos compartilhados do CRM (Fase 1A). Usados pelas rotas de API e
// pela UI da Sessao 2.

// Um endereco da tabela enderecos_clientes.
export interface EnderecoCliente {
  id: string;
  apelido: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  is_padrao: boolean;
  criado_em: string;
}

// Uma tag aplicada ao cliente (tabela cliente_tags).
export interface TagCliente {
  tag: string;
  data_aplicacao: string;
  origem: string | null;
}

// Resumo de uma compra (orcamento) do cliente — sem detalhar itens.
export interface CompraResumo {
  id: string;
  codigo: string | null;
  data: string;
  total: number;
  status: string;
  status_pagamento: string | null;
  tipo_entrega: string | null;
}

// Cliente completo retornado por GET /api/clientes/[id]:
// campos do cliente na raiz + agregados de compras + arrays.
export interface ClienteCompleto {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  recebedor: string | null;
  notas_contexto: string | null;
  data_followup: string | null;
  criado_em: string;
  atualizado_em: string;
  // Agregados calculados a partir de `compras`
  total_compras: number;
  qtd_compras: number;
  ultima_compra: string | null;
  // Arrays relacionados
  enderecos: EnderecoCliente[];
  tags: TagCliente[];
  compras: CompraResumo[];
}
