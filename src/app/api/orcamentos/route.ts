import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, gerarCodigoOrcamento } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
          const body = await request.json();
          const {
                  cliente_nome,
                  cliente_telefone,
                  cliente_cep,
                  cliente_endereco,
                  cliente_numero,
                  cliente_complemento,
                  cliente_recebedor,
                  tipo_entrega,
                  valor_frete = 0,
                  subtotal,
                  total,
                  observacoes,
                  data_retirada,
                  fonte,
                  data_entrega,
                  itens,
          } = body;

      if (!cliente_nome || !cliente_telefone || !subtotal || !itens || itens.length === 0) {
              return NextResponse.json(
                { error: 'Dados obrigatorios: nome, telefone, subtotal e itens' },
                { status: 400 }
                      );
      }

      // Upsert cliente
      const telefoneLimpo = cliente_telefone.replace(/\D/g, '');
          const clienteData: Record<string, unknown> = {
                  nome: cliente_nome,
                  telefone: telefoneLimpo,
                  cep: cliente_cep || null,
                  endereco: cliente_endereco || null,
                  atualizado_em: new Date().toISOString(),
          };
          if (cliente_numero !== undefined) clienteData.numero = cliente_numero;
          if (cliente_complemento !== undefined) clienteData.complemento = cliente_complemento;
          if (cliente_recebedor !== undefined) clienteData.recebedor = cliente_recebedor;

      const { data: cliente, error: clienteError } = await supabaseAdmin
            .from('clientes')
            .upsert(clienteData, { onConflict: 'telefone', ignoreDuplicates: false })
            .select('id')
            .single();

      if (clienteError) {
              console.error('Erro ao criar/atualizar cliente:', clienteError);
              return NextResponse.json({ error: 'Erro ao salvar cliente' }, { status: 500 });
      }

      // Gera codigo unico
      let codigo = gerarCodigoOrcamento();
          for (let i = 0; i < 3; i++) {
                  const { data: existing } = await supabaseAdmin
                    .from('orcamentos')
                    .select('id')
                    .eq('codigo', codigo)
                    .single();
                  if (!existing) break;
                  codigo = gerarCodigoOrcamento();
          }

      // Cria orcamento
      const insertData: Record<string, unknown> = {
              codigo,
              cliente_id: cliente.id,
              tipo_entrega,
              valor_frete,
              subtotal,
              total,
              status: 'orcamento',
              observacoes: observacoes || null,
              fonte: fonte || 'interface',
      };
          if (data_entrega) { insertData.data_entrega = data_entrega; }
          if (data_retirada) { insertData.data_retirada = data_retirada; }

      const { data: orcamento, error: orcError } = await supabaseAdmin
            .from('orcamentos')
            .insert(insertData)
            .select('id, codigo')
            .single();

      if (orcError) {
              console.error('Erro ao criar orcamento:', orcError);
              return NextResponse.json({ error: 'Erro ao salvar orcamento' }, { status: 500 });
      }

      // Cria itens
      const itensToInsert = itens.map((item: {
              produto_id?: string;
              produto_bling_id?: string | number;
              produto_nome: string;
              quantidade: number;
              unidade?: string;
              preco_unitario: number;
      }) => ({
              orcamento_id: orcamento.id,
              produto_id: item.produto_id || null,
              produto_bling_id: item.produto_bling_id ? Number(item.produto_bling_id) : null,
              produto_nome: item.produto_nome,
              quantidade: item.quantidade,
              unidade: item.unidade || 'unidade',
              preco_unitario: item.preco_unitario,
              subtotal: item.quantidade * item.preco_unitario,
      }));

      const { error: itensError } = await supabaseAdmin
            .from('orcamento_itens')
            .insert(itensToInsert);

      if (itensError) {
              console.error('Erro ao criar itens:', itensError);
      }

      // GHL Sync (non-blocking)
      try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
              fetch(`${appUrl}/api/ghl/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orcamento_id: orcamento.id }),
                        cache: 'no-store',
              }).catch(e => console.log('[GHL Sync] Falha (nao bloqueante):', e));
      } catch (e) {
              console.log('[GHL Sync] Falha (nao bloqueante):', e);
      }

      return NextResponse.json({
              success: true,
              codigo: orcamento.codigo,
              id: orcamento.id,
              mensagem: `Orcamento ${orcamento.codigo} salvo com sucesso`,
      });
    } catch (error) {
          console.error('Erro ao salvar orcamento:', error);
          return NextResponse.json({ error: 'Erro interno ao salvar orcamento' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
          const { searchParams } = new URL(request.url);
          const status = searchParams.get('status');
          const busca = searchParams.get('busca');
          const pagina = parseInt(searchParams.get('pagina') || '1');
          const limite = parseInt(searchParams.get('limite') || '20');
          const offset = (pagina - 1) * limite;

      let query = supabaseAdmin
            .from('orcamentos')
.select(`
                id,
                codigo,
                tipo_entrega,
                valor_frete,
                subtotal,
                total,
                status,
                observacoes,
                criado_em,
                data_entrega,
                data_retirada,
                fonte,
                motorista_id,
                reagendamentos,
                bling_pedido_id,
                clientes (
                  id,
                  nome,
                  telefone,
                  cidade,
                  estado,
                  endereco,
                  numero,
                  bairro
                ),
                orcamento_itens (
                  id,
                  produto_nome,
                  quantidade,
                  unidade
                )
              `, { count: 'exact' })
            .order('criado_em', { ascending: false })
            .range(offset, offset + limite - 1);

      if (status) {
              query = query.eq('status', status);
      }

      if (busca) {
              const { data: matchingClients } = await supabaseAdmin
                .from('clientes')
                .select('id')
                .or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%`);
              const clientIds = (matchingClients || []).map((c: { id: string }) => c.id);
              if (clientIds.length > 0) {
                        query = query.or(`codigo.ilike.%${busca}%,cliente_id.in.(${clientIds.join(',')})`);
              } else {
                        query = query.or(`codigo.ilike.%${busca}%`);
              }
      }

      const { data, error, count } = await query;

      if (error) {
              console.error('Erro ao buscar orcamentos:', error);
              return NextResponse.json({ error: 'Erro ao buscar orcamentos' }, { status: 500 });
      }

      // Tarefa 1: Enriquecer com resumo_itens server-side
      const orcamentosEnriquecidos = (data || []).map((orc: Record<string, unknown>) => {
        const itens = (orc.orcamento_itens as Array<{ produto_nome: string; quantidade: number; unidade: string }>) || [];
        const resumo = itens.slice(0, 3).map((it) => {
          const qtd = Number(it.quantidade);
          return qtd > 1 ? `${it.produto_nome} ${qtd}${it.unidade ? it.unidade : ''}` : it.produto_nome;
        }).join(', ');
        return { ...orc, resumo_itens: resumo || '' };
      });
      return NextResponse.json({
              orcamentos: orcamentosEnriquecidos,
              total: count || 0,
              pagina,
              limite,
      });
    } catch (error) {
          console.error('Erro ao listar orcamentos:', error);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}
