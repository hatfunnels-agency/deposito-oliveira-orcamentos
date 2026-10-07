import { supabaseAdmin } from '@/lib/supabase';

// Achar cliente pelo telefone, olhando o principal E os outros telefones.
//
// Cliente que troca de numero ficava com dois cadastros: a Aline fez pedido
// pelo numero novo e a reativacao foi pro antigo, como se nao tivesse
// comprado (06/10). Agora o numero antigo vai pra `telefones_extras` e
// continua reconhecendo a mesma pessoa. Mensagem sai sempre pro principal.

// Formas possiveis do numero (com e sem DDI 55). Casamento EXATO, nunca
// "contem": ha cadastro com digito a mais e o ilike pegava o cliente errado.
export function candidatosTelefone(raw: string): string[] {
  const d = (raw || '').replace(/\D/g, '');
  const set = new Set<string>();
  if (d) set.add(d);
  if (d.startsWith('55') && d.length >= 12) set.add(d.slice(2));
  if (d.length <= 11 && d) set.add('55' + d);
  return Array.from(set);
}

// Filtro pro .or() do Supabase: principal OU qualquer um dos extras.
// So digitos entram, entao nao ha como injetar nada no filtro.
export function filtroTelefoneCliente(raw: string): string {
  const c = candidatosTelefone(raw);
  if (c.length === 0) return 'id.is.null';
  return `telefone.in.(${c.join(',')}),telefones_extras.ov.{${c.join(',')}}`;
}

// Normaliza a lista que vem do formulario: so digitos, sem repetidos, sem o
// proprio principal, sem lixo curto demais pra ser telefone.
export function limparTelefonesExtras(lista: unknown, principal: string): string[] {
  if (!Array.isArray(lista)) return [];
  const principais = new Set(candidatosTelefone(principal));
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of lista) {
    const d = String(item ?? '').replace(/\D/g, '');
    if (d.length < 10 || principais.has(d)) continue;
    const chave = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(d);
  }
  return saida;
}

// Cliente cujo numero esta nos OUTROS telefones (nao no principal). O upsert
// dos pedidos casa so pelo principal (onConflict: 'telefone'): sem isto, um
// pedido digitado com o numero antigo criava um cadastro novo, duplicado.
export async function clienteIdPorTelefoneExtra(raw: string): Promise<string | null> {
  const c = candidatosTelefone(raw);
  if (c.length === 0) return null;
  const { data } = await supabaseAdmin
    .from('clientes')
    .select('id')
    .overlaps('telefones_extras', c)
    .not('telefone', 'in', `(${c.join(',')})`)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// Pedaco de .or() pra BUSCA digitada (aba Clientes, busca de pedidos): o
// principal continua por "contem"; os extras so por numero completo, porque
// array nao tem ilike.
export function buscaTelefoneExtras(digitos: string): string | null {
  if (digitos.length < 10) return null;
  return `telefones_extras.ov.{${candidatosTelefone(digitos).join(',')}}`;
}
