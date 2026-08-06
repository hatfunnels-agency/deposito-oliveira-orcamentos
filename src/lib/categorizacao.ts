import { supabaseAdmin } from '@/lib/supabase';

/**
 * Categorizacao de lancamento bancario em duas camadas:
 *
 *   1. REGRAS  — deterministicas, auditaveis, gratis. Cobrem o recorrente
 *                (fornecedor, folha, aluguel, imposto, transferencia).
 *   2. IA      — so no que sobrou. Sugere, nao decide: entra com confianca
 *                baixa e cai na fila de revisao.
 *
 * Toda correcao humana vira REGRA (origem='aprendizado'), entao o mesmo
 * fornecedor nunca e perguntado duas vezes.
 */

export interface Categoria {
  id: string;
  nome: string;
  grupo: string;
  entra_no_dre: boolean;
}

export interface Regra {
  id: string;
  campo: 'documento' | 'contraparte' | 'descricao';
  padrao: string;
  categoria_id: string;
  prioridade: number;
}

export interface LancamentoParaCategorizar {
  descricao: string;
  contraparte: string | null;
  documento: string | null;
  valor: number;
}

export interface Classificacao {
  categoria_id: string | null;
  origem: 'regra' | 'ia' | null;
  confianca: number | null;
}

/** Maiuscula, sem acento, espaco normalizado — pra casar "Ceramica" com "CERÂMICA". */
export function normalizar(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // "&" vira "E": banco e adquirente escrevem a MESMA razao social das
    // duas formas. Na Stone de julho/2026 aparecem "L & J DEPOSITO
    // OLIVEIRA LTDA" e "L E J DEPOSITO OLIVEIRA LTDA" pro mesmo CNPJ —
    // sem isso, R$66k de transferencia entre contas proprias escapava da
    // regra e caia na fila de revisao como se fosse despesa.
    .replace(/&/g, 'E')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aplica as regras. A primeira que casar (menor prioridade) vence.
 *
 * Guarda de sinal: uma regra de receita nunca classifica uma saida, e uma
 * de despesa nunca classifica uma entrada. Sem isso, "PIX RECEBIDO" numa
 * devolucao ao fornecedor viraria faturamento. Transferencia e as demais
 * neutras valem pros dois lados.
 */
export function classificarPorRegras(
  lanc: LancamentoParaCategorizar,
  regras: Regra[],
  categoriasPorId: Map<string, Categoria>
): Classificacao {
  const alvo = {
    documento: (lanc.documento ?? '').replace(/\D/g, ''),
    contraparte: normalizar(lanc.contraparte),
    descricao: normalizar(lanc.descricao),
  };
  const ehEntrada = lanc.valor > 0;

  const ordenadas = [...regras].sort((a, b) => a.prioridade - b.prioridade);
  for (const regra of ordenadas) {
    const valorCampo = alvo[regra.campo];
    if (!valorCampo) continue;

    const padrao = regra.campo === 'documento'
      ? regra.padrao.replace(/\D/g, '')
      : normalizar(regra.padrao);
    if (!padrao) continue;

    const casou = regra.campo === 'documento'
      ? valorCampo === padrao
      : valorCampo.includes(padrao);
    if (!casou) continue;

    const cat = categoriasPorId.get(regra.categoria_id);
    if (!cat) continue;

    if (cat.grupo === 'receita' && !ehEntrada) continue;
    if (['cmv', 'custo_variavel', 'custo_fixo', 'imposto', 'servico_divida', 'socio'].includes(cat.grupo) && ehEntrada) continue;

    // Documento e identidade; texto e semelhanca.
    const confianca = regra.campo === 'documento' ? 1 : regra.campo === 'contraparte' ? 0.9 : 0.75;
    return { categoria_id: regra.categoria_id, origem: 'regra', confianca };
  }

  return { categoria_id: null, origem: null, confianca: null };
}

/**
 * Sugere categoria via Claude pro que as regras nao pegaram.
 * Devolve Map<indice, categoria_id>. Falha de rede nunca derruba a
 * importacao — sem IA o lancamento so fica sem categoria pra revisao.
 */
export async function classificarPorIA(
  lancamentos: LancamentoParaCategorizar[],
  categorias: Categoria[]
): Promise<Map<number, string>> {
  const resultado = new Map<number, string>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || lancamentos.length === 0) return resultado;

  const listaCategorias = categorias
    .map(c => `${c.nome} [${c.grupo}]`)
    .join('\n');

  // Lote de 60 pra caber com folga na resposta e nao estourar timeout.
  const LOTE = 60;
  for (let inicio = 0; inicio < lancamentos.length; inicio += LOTE) {
    const fatia = lancamentos.slice(inicio, inicio + LOTE);
    const linhas = fatia.map((l, i) => {
      const sinal = l.valor > 0 ? 'ENTRADA' : 'SAIDA';
      return `${i}|${sinal}|R$${Math.abs(l.valor).toFixed(2)}|${l.contraparte || '-'}|${l.descricao}`;
    }).join('\n');

    const prompt = `Voce classifica lancamentos bancarios de um deposito de materiais de construcao em Carapicuiba/SP.

CATEGORIAS DISPONIVEIS (use o nome exato):
${listaCategorias}

REGRAS IMPORTANTES:
- ENTRADA de cliente pagando material = "Venda - PIX" ou "Venda - Dinheiro/Deposito".
- Movimento entre contas da propria empresa (mesmo titular, ex: "L & J DEPOSITO OLIVEIRA") = "Transferencia entre contas", NUNCA receita.
- Compra de material para revenda (cimento, areia, tijolo, bloco, ferro, madeira, telha) = a categoria CMV correspondente.
- Parcela de emprestimo ou de compra da empresa = "Emprestimo - parcela" ou "Aquisicao - parcela", NUNCA custo fixo.
- Pagamento a pessoa fisica pode ser salario (Folha - Salario) ou fornecedor autonomo (CMV). Na duvida, NAO CHUTE.
- Se nao tiver confianca razoavel, responda a categoria como "?" para ir a revisao humana.

LANCAMENTOS (indice|tipo|valor|contraparte|descricao):
${linhas}

Responda SOMENTE linhas no formato "indice=Nome exato da categoria", uma por linha, sem nenhum outro texto.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        console.error('[categorizacao] IA respondeu', res.status);
        continue;
      }
      const data = await res.json();
      const texto: string = data?.content?.[0]?.text ?? '';

      const porNome = new Map(categorias.map(c => [normalizar(c.nome), c.id]));
      for (const linha of texto.split('\n')) {
        const m = /^\s*(\d+)\s*=\s*(.+?)\s*$/.exec(linha);
        if (!m) continue;
        const idxLocal = Number(m[1]);
        const nome = m[2].trim();
        if (nome === '?' || Number.isNaN(idxLocal) || idxLocal >= fatia.length) continue;
        const catId = porNome.get(normalizar(nome));
        if (catId) resultado.set(inicio + idxLocal, catId);
      }
    } catch (e) {
      console.error('[categorizacao] falha na IA (segue sem ela):', e);
    }
  }

  return resultado;
}

/** Carrega categorias e regras ativas de uma vez. */
export async function carregarContexto(): Promise<{
  categorias: Categoria[];
  categoriasPorId: Map<string, Categoria>;
  regras: Regra[];
}> {
  const [{ data: cats }, { data: regs }] = await Promise.all([
    supabaseAdmin.from('categorias_financeiras').select('id, nome, grupo, entra_no_dre').order('ordem'),
    supabaseAdmin.from('regras_categorizacao').select('id, campo, padrao, categoria_id, prioridade').eq('ativo', true),
  ]);
  const categorias = (cats || []) as Categoria[];
  return {
    categorias,
    categoriasPorId: new Map(categorias.map(c => [c.id, c])),
    regras: (regs || []) as Regra[],
  };
}

/**
 * Cria a regra que nasce de uma correcao humana.
 * Prefere documento (identidade) a contraparte (nome), e so cria regra de
 * descricao se nao houver nem um nem outro — descricao de PIX costuma ter
 * data e nome embutidos, entao vira regra ruim.
 */
export async function aprenderComCorrecao(
  lanc: { documento: string | null; contraparte: string | null },
  categoriaId: string
): Promise<void> {
  let campo: Regra['campo'] | null = null;
  let padrao = '';

  if (lanc.documento && lanc.documento.replace(/\D/g, '').length >= 11) {
    campo = 'documento';
    padrao = lanc.documento.replace(/\D/g, '');
  } else if (lanc.contraparte && normalizar(lanc.contraparte).length >= 5) {
    campo = 'contraparte';
    padrao = normalizar(lanc.contraparte);
  }
  if (!campo) return;

  await supabaseAdmin
    .from('regras_categorizacao')
    .upsert(
      {
        campo,
        padrao,
        categoria_id: categoriaId,
        prioridade: campo === 'documento' ? 5 : 15,
        origem: 'aprendizado',
        ativo: true,
      },
      { onConflict: 'campo,padrao' }
    );
}
