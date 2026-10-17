// Lancar por foto: le comprovante, boleto, nota ou ticket de pesagem com a
// IA e sugere fornecedor e produto. SERVER-ONLY.
//
// A IA so LE; quem decide e o usuario, que confere o formulario
// pre-preenchido antes de salvar. Saida estruturada (output_config.format
// com JSON Schema) garante JSON valido; mesmo assim tudo e saneado aqui
// (data invalida vira null, numero negativo vira null).
//
// Chamada pelo SDK oficial (@anthropic-ai/sdk).

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizar } from '@/lib/categorizacao';
import type {
  CandidatoFornecedor, CandidatoProduto, ConfiancaLeitura, ItemDocumentoLido, LeituraDocumento, Metodo,
  RespostaLeitura, SugestaoItemLido, TipoDocumentoLido,
} from './tipos';
import { arred2, ehData } from './datas';
import { ErroFinanceiro } from './eventos';
import { calcularPesagem, densidadePorNome, pesoLiquido } from './pesagem';

const MODELO = 'claude-opus-5-5';
export const MIMES_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
type MimeImagem = (typeof MIMES_IMAGEM)[number];

const TIPOS: TipoDocumentoLido[] = ['comprovante_pagamento', 'boleto', 'nota_fiscal', 'ticket_pesagem', 'outro'];
const METODOS: Metodo[] = ['pix', 'boleto', 'dinheiro', 'credito', 'debito', 'transferencia', 'outro'];
const CONFIANCAS: ConfiancaLeitura[] = ['alta', 'media', 'baixa'];

const texto = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const numero = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'data', 'valor_total', 'fornecedor_nome', 'fornecedor_documento', 'numero_documento', 'vencimento', 'metodo', 'itens', 'observacoes', 'confianca', 'campos_duvidosos'],
  properties: {
    tipo: { type: 'string', enum: TIPOS },
    data: { ...texto, description: 'Data do documento/pagamento/pesagem, AAAA-MM-DD.' },
    valor_total: { ...numero, description: 'Valor total em reais. Null se o documento nao tiver valor (ticket de pesagem costuma nao ter).' },
    fornecedor_nome: { ...texto, description: 'Quem recebe o dinheiro / emitente / pedreira ou areial. Nunca o Deposito Oliveira (L & J Deposito Oliveira), que e o comprador.' },
    fornecedor_documento: { ...texto, description: 'CPF ou CNPJ de quem recebe, so digitos.' },
    numero_documento: { ...texto, description: 'Numero da NF, do ticket, do boleto (nosso numero) ou ID da transacao.' },
    vencimento: { ...texto, description: 'Vencimento do boleto/duplicata, AAAA-MM-DD.' },
    metodo: { anyOf: [{ type: 'string', enum: METODOS }, { type: 'null' }] },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descricao', 'quantidade', 'unidade', 'valor_unitario', 'valor_total', 'peso_bruto_kg', 'tara_kg', 'peso_liquido_kg'],
        properties: {
          descricao: { type: 'string', description: 'Material como escrito (ex.: AREIA MEDIA LAVADA, PEDRA 1).' },
          quantidade: numero,
          unidade: texto,
          valor_unitario: numero,
          valor_total: numero,
          peso_bruto_kg: { ...numero, description: 'Em kg. Converta toneladas (x1000).' },
          tara_kg: { ...numero, description: 'Em kg.' },
          peso_liquido_kg: { ...numero, description: 'Em kg. So se estiver impresso; nao calcule.' },
        },
      },
    },
    observacoes: { ...texto, description: 'Placa, motorista, obra, parcelas, linha digitavel ou o que mais ajudar a conferir.' },
    confianca: { type: 'string', enum: CONFIANCAS },
    campos_duvidosos: { type: 'array', items: { type: 'string' }, description: 'Nomes dos campos acima que estao ilegiveis ou incertos.' },
  },
} as const;

const SISTEMA = `Voce le fotos de documentos financeiros de um deposito de materiais de construcao (Deposito Oliveira, Carapicuiba/SP), que e sempre o COMPRADOR/PAGADOR.

Tipos:
- comprovante_pagamento: comprovante de PIX, TED, transferencia, cartao.
- boleto: boleto bancario ou duplicata a pagar.
- nota_fiscal: NF-e/DANFE ou cupom de compra com itens.
- ticket_pesagem: ticket de balanca de pedreira/areial com peso da carga (bruto, tara, liquido).
- outro: qualquer outra coisa.

Regras:
- Transcreva so o que esta escrito. Nao invente nem estime valores; campo ausente ou ilegivel = null e entra em campos_duvidosos.
- Datas no formato AAAA-MM-DD (documentos brasileiros usam DD/MM/AAAA).
- Valores em reais como numero (1.234,56 -> 1234.56).
- Pesos sempre em kg (12,34 t -> 12340). Em ticket de pesagem, peso_liquido_kg so se estiver impresso.
- Em ticket de pesagem, um item por material pesado.
- confianca: alta se tudo que importa esta nitido; media se algo precisou de interpretacao; baixa se a foto esta ruim.`;

// ------------------------------------------------------------ chamada

let cliente: Anthropic | null = null;
function clienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErroFinanceiro(503, 'Leitura por foto indisponível: falta ANTHROPIC_API_KEY.');
  if (!cliente) cliente = new Anthropic({ maxRetries: 2 });
  return cliente;
}

// Se o classificador recusar, a propria API refaz no modelo de reserva
// (fallbacks 'default', beta server-side-fallback).
async function chamarModelo(imagemBase64: string, mimeType: MimeImagem) {
  return clienteAnthropic().beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SISTEMA,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imagemBase64 } },
        { type: 'text', text: 'Leia este documento e preencha os campos.' },
      ],
    }],
  });
}

export async function lerDocumento(imagemBase64: string, mimeType: string): Promise<LeituraDocumento> {
  if (!(MIMES_IMAGEM as readonly string[]).includes(mimeType)) throw new ErroFinanceiro(400, 'Envie a foto em JPG, PNG ou WebP.');
  if (!imagemBase64) throw new ErroFinanceiro(400, 'Foto vazia.');

  let data: Awaited<ReturnType<typeof chamarModelo>>;
  try {
    data = await chamarModelo(imagemBase64, mimeType as MimeImagem);
  } catch (e) {
    if (e instanceof ErroFinanceiro) throw e;
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.error('[leitura-foto] IA respondeu', status, e instanceof Error ? e.message : e);
    if (status === 429 || (status ?? 500) >= 500) throw new ErroFinanceiro(503, 'A leitura está sobrecarregada agora. Tente de novo em instantes.');
    throw new ErroFinanceiro(502, 'Não consegui ler a foto. Tente outra foto ou lance à mão.');
  }
  if (data.stop_reason === 'refusal') throw new ErroFinanceiro(422, 'A leitura recusou esta imagem. Lance à mão.');
  if (data.stop_reason === 'max_tokens') throw new ErroFinanceiro(502, 'A leitura ficou incompleta. Tente uma foto só do documento.');
  let texto = '';
  for (const b of data.content) if (b.type === 'text') texto = b.text;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroFinanceiro(502, 'A leitura voltou num formato inesperado. Tente de novo.');
  }
  return sanear(bruto);
}

// ------------------------------------------------------------ saneamento

const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};
const nPos = (v: unknown): number | null => {
  // O schema pede numero; string so por garantia ("1.234,56" ou "12.5").
  const n = typeof v === 'number' ? v
    : typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v)
    : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const data = (v: unknown): string | null => {
  const s = txt(v);
  if (!s) return null;
  if (ehData(s)) return s;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m && ehData(`${m[3]}-${m[2]}-${m[1]}`) ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function sanear(bruto: unknown): LeituraDocumento {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const itensBrutos = Array.isArray(o.itens) ? o.itens : [];
  const itens: ItemDocumentoLido[] = itensBrutos.slice(0, 50).map(i => {
    const r = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
    return {
      descricao: txt(r.descricao) ?? 'Item sem descrição',
      quantidade: nPos(r.quantidade),
      unidade: txt(r.unidade),
      valor_unitario: nPos(r.valor_unitario),
      valor_total: nPos(r.valor_total),
      peso_bruto_kg: nPos(r.peso_bruto_kg),
      tara_kg: nPos(r.tara_kg),
      peso_liquido_kg: nPos(r.peso_liquido_kg),
    };
  });
  const doc = (txt(o.fornecedor_documento) ?? '').replace(/\D/g, '');
  const valor = nPos(o.valor_total);
  return {
    tipo: TIPOS.includes(o.tipo as TipoDocumentoLido) ? (o.tipo as TipoDocumentoLido) : 'outro',
    data: data(o.data),
    valor_total: valor === null ? null : arred2(valor),
    fornecedor_nome: txt(o.fornecedor_nome),
    fornecedor_documento: doc.length === 11 || doc.length === 14 ? doc : null,
    numero_documento: txt(o.numero_documento),
    vencimento: data(o.vencimento),
    metodo: METODOS.includes(o.metodo as Metodo) ? (o.metodo as Metodo) : null,
    itens,
    observacoes: txt(o.observacoes),
    confianca: CONFIANCAS.includes(o.confianca as ConfiancaLeitura) ? (o.confianca as ConfiancaLeitura) : 'baixa',
    campos_duvidosos: Array.isArray(o.campos_duvidosos) ? o.campos_duvidosos.filter((c): c is string => typeof c === 'string').slice(0, 20) : [],
  };
}

// ------------------------------------------------------------ sugestoes

// Palavras que nao identificam nada (razao social e descricao de nota).
const VAZIAS = new Set([
  'LTDA', 'EIRELI', 'EPP', 'MEI', 'SA', 'S/A', 'ME', 'CIA', 'COMERCIO', 'COM', 'IND', 'INDUSTRIA', 'DE', 'DA', 'DO', 'DAS', 'DOS',
  'E', 'EM', 'PARA', 'MATERIAIS', 'MATERIAL', 'CONSTRUCAO', 'CONSTRUCOES', 'SERVICOS', 'TRANSPORTES', 'MINERACAO', 'MINERADORA',
  'KG', 'UN', 'UND', 'M3', 'M³', 'SC', 'SACO', 'LAVADA', 'LAVADO',
]);

function tokens(s: string | null | undefined): string[] {
  return normalizar(s)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(t => t.length >= 3 && !VAZIAS.has(t));
}

interface ProdutoCandidatoRow {
  id: string; nome: string; unidade: string; fator_conversao: number | string | null; preco_custo: number | string | null;
  tipo_estoque: string | null; estoque_compartilhado_com: string | null; ativo: boolean | null; densidade_t_m3?: number | string | null;
}

async function carregarProdutos(): Promise<ProdutoCandidatoRow[]> {
  const base = 'id, nome, unidade, fator_conversao, preco_custo, tipo_estoque, estoque_compartilhado_com, ativo';
  // densidade_t_m3 so existe depois da migration 20261017_estoque_gestao_e_densidade.
  // Barra/estribo pronto baixam do ferro em metro: a entrada vai no produto em metro.
  const comDensidade = await supabaseAdmin.from('produtos').select(`${base}, densidade_t_m3`).eq('ativo', true).is('baixa_estoque_em_produto_id', null).limit(1000);
  if (!comDensidade.error) return (comDensidade.data || []) as ProdutoCandidatoRow[];
  const sem = await supabaseAdmin.from('produtos').select(base).eq('ativo', true).is('baixa_estoque_em_produto_id', null).limit(1000);
  if (sem.error) throw new Error(sem.error.message);
  return (sem.data || []) as ProdutoCandidatoRow[];
}

function pontuarProduto(descricao: string, p: ProdutoCandidatoRow, ehTicket: boolean): number {
  const td = tokens(descricao);
  const tp = tokens(p.nome);
  if (!td.length || !tp.length) return 0;
  const setD = new Set(td);
  // Prefixo de 4 letras casa "MEDIA"/"MEDIO", "PEDRISCO"/"PEDRISCAO".
  const casa = (t: string) => setD.has(t) || td.some(d => d.length >= 4 && t.length >= 4 && d.slice(0, 4) === t.slice(0, 4));
  const acertos = tp.filter(casa).length;
  if (!acertos) return 0;
  let s = acertos / tp.length * 0.7 + acertos / td.length * 0.3;
  const ensacado = /ENSACAD|20 ?KG/.test(normalizar(p.nome));
  const descEnsacado = /ENSACAD|SACO|20 ?KG/.test(normalizar(descricao));
  // Ticket de balanca e carga a granel: prefere o produto em m3, nao o saco.
  if (ehTicket) {
    if (ensacado && !descEnsacado) s *= 0.5;
    if (/M3|M³/.test(normalizar(p.unidade))) s += 0.1;
  } else if (ensacado !== descEnsacado) {
    s *= 0.8;
  }
  return Math.min(1, Math.round(s * 100) / 100);
}

export async function sugerirProdutos(itens: ItemDocumentoLido[], ehTicket: boolean): Promise<CandidatoProduto[][]> {
  if (!itens.length) return [];
  const produtos = await carregarProdutos();
  return itens.map(it => produtos
    .map(p => ({ p, s: pontuarProduto(it.descricao, p, ehTicket) }))
    .filter(x => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(({ p, s }) => {
      const dens = Number(p.densidade_t_m3);
      return {
        produto_id: p.id,
        nome: p.nome,
        unidade: p.unidade,
        fator_conversao: Number(p.fator_conversao) || 1,
        preco_custo: Number(p.preco_custo) || 0,
        densidade_t_m3: Number.isFinite(dens) && dens > 0 ? dens : densidadePorNome(p.nome),
        tipo_estoque: p.tipo_estoque === 'sob_demanda' ? 'sob_demanda' : 'estocavel',
        principal_id: p.estoque_compartilhado_com || p.id,
        pontuacao: s,
      } satisfies CandidatoProduto;
    }));
}

export async function sugerirFornecedores(nome: string | null, documento: string | null): Promise<CandidatoFornecedor[]> {
  if (!nome && !documento) return [];
  const { data, error } = await supabaseAdmin
    .from('fornecedores')
    .select('id, nome, documentos, ativo, categoria_padrao_id, metodo_padrao, conta_padrao_id')
    .limit(2000);
  if (error) throw new Error(error.message);
  const doc = (documento ?? '').replace(/\D/g, '');
  const raizCnpj = doc.length === 14 ? doc.slice(0, 8) : null;   // outra filial
  const tn = tokens(nome).filter(t => t.length >= 4);
  const out: CandidatoFornecedor[] = [];
  for (const f of (data || []) as Array<{ id: string; nome: string; documentos: string[] | null; ativo: boolean | null; categoria_padrao_id: string | null; metodo_padrao: Metodo | null; conta_padrao_id: string | null }>) {
    const docs = (f.documentos ?? []).map(d => String(d).replace(/\D/g, ''));
    let s = 0;
    let motivo: CandidatoFornecedor['motivo'] = 'nome';
    if (doc && docs.includes(doc)) { s = 1; motivo = 'documento'; }
    else if (raizCnpj && docs.some(d => d.length === 14 && d.slice(0, 8) === raizCnpj)) { s = 0.9; motivo = 'documento'; }
    else if (tn.length) {
      const tf = tokens(f.nome).filter(t => t.length >= 4);
      const acertos = tf.filter(t => tn.includes(t)).length;
      if (acertos) s = Math.round(Math.min(0.85, acertos / Math.max(tf.length, tn.length) * 0.85 + 0.1) * 100) / 100;
    }
    if (s < 0.3) continue;
    if (f.ativo === false) s = Math.round(s * 0.8 * 100) / 100;
    out.push({
      fornecedor_id: f.id, nome: f.nome, motivo, pontuacao: s,
      categoria_padrao_id: f.categoria_padrao_id, metodo_padrao: f.metodo_padrao, conta_padrao_id: f.conta_padrao_id,
    });
  }
  return out.sort((a, b) => b.pontuacao - a.pontuacao).slice(0, 4);
}

/** Leitura + sugestoes de fornecedor e produto + calculo do ticket. */
export async function lerComSugestoes(imagemBase64: string, mimeType: string): Promise<Omit<RespostaLeitura, 'foto_path' | 'aviso_foto'>> {
  const leitura = await lerDocumento(imagemBase64, mimeType);
  const ehTicket = leitura.tipo === 'ticket_pesagem';
  const [fornecedores, produtosPorItem] = await Promise.all([
    sugerirFornecedores(leitura.fornecedor_nome, leitura.fornecedor_documento).catch(e => { console.error('[leitura-foto] fornecedores', e); return []; }),
    sugerirProdutos(leitura.itens, ehTicket).catch(e => { console.error('[leitura-foto] produtos', e); return [] as CandidatoProduto[][]; }),
  ]);

  const itens: SugestaoItemLido[] = leitura.itens.map((it, indice) => {
    const produtos = produtosPorItem[indice] ?? [];
    if (!ehTicket) return { indice, produtos, pesagem: null };
    const melhor = produtos[0];
    const peso = pesoLiquido(it);
    const densidade = melhor?.densidade_t_m3 ?? densidadePorNome(it.descricao);
    const custoM3 = melhor ? melhor.preco_custo / (melhor.fator_conversao || 1) : null;
    return { indice, produtos, pesagem: calcularPesagem(peso.kg, densidade, custoM3, { origem_peso: peso.origem, conferir: peso.conferir }) };
  });

  let valorCalculado: number | null = null;
  if (ehTicket && itens.length && itens.every(i => i.pesagem?.valor !== null && i.pesagem?.valor !== undefined)) {
    valorCalculado = arred2(itens.reduce((s, i) => s + (i.pesagem?.valor ?? 0), 0));
  }
  return { leitura, fornecedores, itens, valor_calculado: valorCalculado };
}
