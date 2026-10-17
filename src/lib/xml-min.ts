// Parser XML minimo, sem dependencia, pro arquivo de conciliacao da Stone
// (e qualquer XML "de dados": elementos, atributos, texto, CDATA,
// comentarios, declaracao <?xml?>, DOCTYPE e prefixos de namespace).
//
// Nao valida o documento: um XML mal formado vira a melhor arvore
// possivel (tag sem fechamento fecha no fim do pai). Prefixos de
// namespace sao descartados do nome ('xsd:Transaction' -> 'Transaction'),
// porque o layout da Stone os usa de forma inconsistente.

export interface NoXml {
  tag: string;
  attrs: Record<string, string>;
  filhos: NoXml[];
  texto: string;          // texto direto do elemento (sem o dos filhos), trim
}

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodificarEntidades(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (tudo, ent: string) => {
    if (ent[0] === '#') {
      const cod = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(cod) ? String.fromCodePoint(cod) : tudo;
    }
    return ENTIDADES[ent] ?? tudo;
  });
}

const semPrefixo = (nome: string) => {
  const i = nome.indexOf(':');
  return i >= 0 ? nome.slice(i + 1) : nome;
};

function lerAtributos(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) attrs[semPrefixo(m[1])] = decodificarEntidades(m[2] ?? m[3] ?? '');
  return attrs;
}

/**
 * Converte o XML numa arvore. Devolve o elemento raiz (o primeiro
 * elemento do documento). Lanca Error se nao houver elemento nenhum.
 */
export function parseXml(fonte: string): NoXml {
  let src = fonte;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const raiz: NoXml = { tag: '#documento', attrs: {}, filhos: [], texto: '' };
  const pilha: NoXml[] = [raiz];
  const topo = () => pilha[pilha.length - 1];
  const textoAcumulado: string[][] = [[]];

  const fecharTexto = () => {
    const partes = textoAcumulado[textoAcumulado.length - 1];
    if (partes.length > 0) {
      const t = partes.join('').trim();
      const no = topo();
      no.texto = no.texto ? `${no.texto} ${t}`.trim() : t;
      partes.length = 0;
    }
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      textoAcumulado[textoAcumulado.length - 1].push(decodificarEntidades(src.slice(i)));
      break;
    }
    if (lt > i) textoAcumulado[textoAcumulado.length - 1].push(decodificarEntidades(src.slice(i, lt)));

    // Comentario
    if (src.startsWith('<!--', lt)) {
      const fim = src.indexOf('-->', lt + 4);
      i = fim < 0 ? n : fim + 3;
      continue;
    }
    // CDATA: texto literal
    if (src.startsWith('<![CDATA[', lt)) {
      const fim = src.indexOf(']]>', lt + 9);
      textoAcumulado[textoAcumulado.length - 1].push(src.slice(lt + 9, fim < 0 ? n : fim));
      i = fim < 0 ? n : fim + 3;
      continue;
    }
    // Declaracao / instrucao de processamento
    if (src.startsWith('<?', lt)) {
      const fim = src.indexOf('?>', lt + 2);
      i = fim < 0 ? n : fim + 2;
      continue;
    }
    // DOCTYPE (sem subset interno complexo: vai ate o primeiro '>')
    if (src.startsWith('<!', lt)) {
      const fim = src.indexOf('>', lt + 2);
      i = fim < 0 ? n : fim + 1;
      continue;
    }

    const gt = acharFimDaTag(src, lt + 1);
    if (gt < 0) break;
    const conteudo = src.slice(lt + 1, gt);
    i = gt + 1;

    if (conteudo[0] === '/') {
      // Fechamento: fecha ate o elemento com esse nome (tolerante a tag perdida).
      fecharTexto();
      const nome = semPrefixo(conteudo.slice(1).trim());
      let k = pilha.length - 1;
      while (k > 0 && pilha[k].tag !== nome) k--;
      if (k > 0) {
        while (pilha.length - 1 >= k) { pilha.pop(); textoAcumulado.pop(); }
      }
      continue;
    }

    const autoFecha = conteudo.endsWith('/');
    const corpo = autoFecha ? conteudo.slice(0, -1) : conteudo;
    const esp = corpo.search(/\s/);
    const nome = semPrefixo(esp < 0 ? corpo : corpo.slice(0, esp));
    const attrs = esp < 0 ? {} : lerAtributos(corpo.slice(esp + 1));
    fecharTexto();
    const no: NoXml = { tag: nome, attrs, filhos: [], texto: '' };
    topo().filhos.push(no);
    if (!autoFecha) {
      pilha.push(no);
      textoAcumulado.push([]);
    }
  }

  const primeiro = raiz.filhos[0];
  if (!primeiro) throw new Error('XML sem elemento raiz');
  return primeiro;
}

// '>' dentro de valor de atributo entre aspas nao fecha a tag.
function acharFimDaTag(src: string, de: number): number {
  let aspas: string | null = null;
  for (let j = de; j < src.length; j++) {
    const c = src[j];
    if (aspas) { if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") { aspas = c; continue; }
    if (c === '>') return j;
  }
  return -1;
}

/** Filhos diretos com essa tag (sem prefixo). */
export function todos(no: NoXml | null | undefined, tag: string): NoXml[] {
  if (!no) return [];
  const t = semPrefixo(tag);
  return no.filhos.filter(f => f.tag === t);
}

/** Primeiro filho direto com essa tag. */
export function filho(no: NoXml | null | undefined, tag: string): NoXml | null {
  if (!no) return null;
  const t = semPrefixo(tag);
  return no.filhos.find(f => f.tag === t) ?? null;
}

/** Desce por um caminho 'A/B/C' (primeiro filho em cada nivel). */
export function achar(no: NoXml | null | undefined, caminho: string): NoXml | null {
  let atual: NoXml | null = no ?? null;
  for (const parte of caminho.split('/').filter(Boolean)) {
    atual = filho(atual, parte);
    if (!atual) return null;
  }
  return atual;
}

/** Texto do filho direto `tag` (ou do proprio no, se `tag` omitida). null se nao existe/vazio. */
export function texto(no: NoXml | null | undefined, tag?: string): string | null {
  const alvo = tag ? filho(no, tag) : no;
  if (!alvo) return null;
  const t = alvo.texto;
  return t === '' ? null : t;
}

/** Todos os descendentes (qualquer profundidade) com essa tag. */
export function descendentes(no: NoXml | null | undefined, tag: string): NoXml[] {
  const saida: NoXml[] = [];
  if (!no) return saida;
  const t = semPrefixo(tag);
  const visitar = (x: NoXml) => {
    for (const f of x.filhos) {
      if (f.tag === t) saida.push(f);
      visitar(f);
    }
  };
  visitar(no);
  return saida;
}

/**
 * Arvore -> objeto simples (pra guardar em jsonb). Folhas viram string;
 * tags repetidas viram array; atributos entram como '@nome'.
 */
export function paraObjeto(no: NoXml): unknown {
  if (no.filhos.length === 0 && Object.keys(no.attrs).length === 0) return no.texto;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(no.attrs)) obj[`@${k}`] = v;
  if (no.texto) obj['#texto'] = no.texto;
  for (const f of no.filhos) {
    const valor = paraObjeto(f);
    const atual = obj[f.tag];
    if (atual === undefined) obj[f.tag] = valor;
    else if (Array.isArray(atual)) atual.push(valor);
    else obj[f.tag] = [atual, valor];
  }
  return obj;
}
