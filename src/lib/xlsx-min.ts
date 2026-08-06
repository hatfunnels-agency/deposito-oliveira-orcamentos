import { inflateRawSync } from 'zlib';

/**
 * Leitor minimo de .xlsx — so o necessario pra ler extrato bancario.
 *
 * Por que nao usar uma lib: isto e um parser financeiro num repositorio
 * publico que vai pra producao. Uma dependencia de terceiro aqui e
 * superficie de supply chain por cima de dado bancario. O extrato do Itau
 * usa so `t="s"` (shared string) e `t="n"` (numero), com datas gravadas
 * como TEXTO — nao ha serial de data pra converter. Isso cabe em ~150
 * linhas auditaveis.
 *
 * Regra de ouro deste arquivo: em qualquer duvida, LANCAR ERRO. Extrato
 * mal lido gera DRE errado com cara de certo, que e pior que nao ter DRE.
 */

interface EntradaZip {
  nome: string;
  comprimido: Buffer;
  metodo: number;
}

/** Le o diretorio central do ZIP. .xlsx e um ZIP com XML dentro. */
function lerZip(buf: Buffer): Map<string, Buffer> {
  // Assinatura do End of Central Directory: 0x06054b50, no fim do arquivo.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .xlsx invalido: fim do ZIP nao encontrado');

  const totalEntradas = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  const entradas: EntradaZip[] = [];
  for (let i = 0; i < totalEntradas; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('Arquivo .xlsx invalido: diretorio central corrompido');
    }
    const metodo = buf.readUInt16LE(ptr + 10);
    const tamComprimido = buf.readUInt32LE(ptr + 20);
    const tamNome = buf.readUInt16LE(ptr + 28);
    const tamExtra = buf.readUInt16LE(ptr + 30);
    const tamComentario = buf.readUInt16LE(ptr + 32);
    const offsetLocal = buf.readUInt32LE(ptr + 42);
    const nome = buf.subarray(ptr + 46, ptr + 46 + tamNome).toString('utf8');

    // O cabecalho local repete nome/extra com tamanhos proprios.
    const tamNomeLocal = buf.readUInt16LE(offsetLocal + 26);
    const tamExtraLocal = buf.readUInt16LE(offsetLocal + 28);
    const inicioDados = offsetLocal + 30 + tamNomeLocal + tamExtraLocal;

    entradas.push({
      nome,
      metodo,
      comprimido: buf.subarray(inicioDados, inicioDados + tamComprimido),
    });
    ptr += 46 + tamNome + tamExtra + tamComentario;
  }

  const saida = new Map<string, Buffer>();
  for (const e of entradas) {
    if (e.metodo === 0) {
      saida.set(e.nome, e.comprimido);            // stored
    } else if (e.metodo === 8) {
      saida.set(e.nome, inflateRawSync(e.comprimido)); // deflate
    }
    // Outros metodos (bzip2, lzma) nao aparecem em xlsx real — ignora.
  }
  return saida;
}

function decodificarXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // por ultimo, senao desfaz os de cima
}

/** sharedStrings.xml: cada <si> pode ter varios <t> (texto rico). */
function lerSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const blocos = xml.match(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
  for (const bloco of blocos) {
    const partes = bloco.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(
      partes
        .map(p => decodificarXml(p.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/, '$1')))
        .join('')
    );
  }
  return out;
}

/** Coluna da referencia da celula: "BC12" -> 54 (indice 0). */
function indiceColuna(ref: string): number {
  const letras = ref.replace(/\d+/g, '');
  let n = 0;
  for (let i = 0; i < letras.length; i++) {
    n = n * 26 + (letras.charCodeAt(i) - 64);
  }
  return n - 1;
}

export type CelulaXlsx = string | number | null;

/**
 * Le a primeira planilha e devolve matriz de linhas.
 * Celulas vazias viram null; o comprimento de cada linha respeita a
 * posicao real da coluna (nao compacta buracos).
 */
export function lerXlsx(buffer: Buffer): CelulaXlsx[][] {
  const arquivos = lerZip(buffer);

  const sheet =
    arquivos.get('xl/worksheets/sheet1.xml') ||
    [...arquivos.entries()].find(([k]) => /^xl\/worksheets\/.*\.xml$/.test(k))?.[1];
  if (!sheet) throw new Error('Arquivo .xlsx sem planilha legivel');

  const compartilhadas = arquivos.has('xl/sharedStrings.xml')
    ? lerSharedStrings(arquivos.get('xl/sharedStrings.xml')!.toString('utf8'))
    : [];

  const xml = sheet.toString('utf8');
  const linhas: CelulaXlsx[][] = [];

  const blocosLinha = xml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const blocoLinha of blocosLinha) {
    const linha: CelulaXlsx[] = [];
    const celulas = blocoLinha.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || [];

    for (const celula of celulas) {
      const ref = /\br="([A-Z]+\d+)"/.exec(celula)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(celula)?.[1] || 'n';
      const col = ref ? indiceColuna(ref) : linha.length;
      while (linha.length < col) linha.push(null);

      let valor: CelulaXlsx = null;
      if (tipo === 'inlineStr') {
        const partes = celula.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
        valor = partes
          .map(p => decodificarXml(p.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/, '$1')))
          .join('');
      } else {
        const bruto = /<v>([\s\S]*?)<\/v>/.exec(celula)?.[1];
        if (bruto !== undefined) {
          if (tipo === 's') {
            const idx = Number(bruto);
            // Indice fora da tabela = arquivo inconsistente. Falhar alto.
            if (!Number.isInteger(idx) || idx < 0 || idx >= compartilhadas.length) {
              throw new Error(`Arquivo .xlsx inconsistente: shared string ${bruto} nao existe`);
            }
            valor = compartilhadas[idx];
          } else if (tipo === 'str' || tipo === 'e') {
            valor = decodificarXml(bruto);
          } else if (tipo === 'b') {
            valor = bruto === '1' ? 'VERDADEIRO' : 'FALSO';
          } else {
            const n = Number(bruto);
            valor = Number.isNaN(n) ? decodificarXml(bruto) : n;
          }
        }
      }
      linha[col] = valor;
    }
    linhas.push(linha);
  }

  return linhas;
}
