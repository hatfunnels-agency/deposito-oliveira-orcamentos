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
                  desconto_percentual,
                  desconto_valor,
                  data_entrega,
                  itens,
                  status_pagamento,
    status,
    forma_pagamento,
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
              status: status || 'orcamento',
              observacoes: observacoes || null,
              fonte: fonte || 'interface',
              desconto_percentual: typeof desconto_percentual === 'number' ? desconto_percentual : 0,
              desconto_valor: typeof desconto_valor === 'number' ? desconto_valor : 0,
      };
      if (status_pagamento) insertData.status_pagamento = status_pagamento;
    if (forma_pagamento) insertData.forma_pagamento = forma_pagamento;
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
      // Snapshot do preco_custo no momento da venda (Opcao B):
      // - Se item tem produto_id, faz lookup batch em produtos por id
      // - Senao, fallback por nome
      // - Senao, 0
      const idsParaLookup = itens
        .map((it: { produto_id?: string }) => it.produto_id)
        .filter((v: string | undefined): v is string => !!v);
      const nomesParaLookup = itens
        .map((it: { produto_nome: string }) => it.produto_nome)
        .filter((v: string | undefined): v is string => !!v);

      const custoPorId: Record<string, number> = {};
      const custoPorNome: Record<string, number> = {};

      if (idsParaLookup.length > 0) {
        const { data: prodsById } = await supabaseAdmin
          .from('produtos')
          .select('id, preco_custo')
          .in('id', idsParaLookup);
        ;(prodsById ?? []).forEach((p: { id: string; preco_custo: number | null }) => {
          custoPorId[p.id] = Number(p.preco_custo) || 0;
        });
      }

      if (nomesParaLookup.length > 0) {
        const { data: prodsByName } = await supabaseAdmin
          .from('produtos')
          .select('nome, preco_custo')
          .in('nome', nomesParaLookup);
        ;(prodsByName ?? []).forEach((p: { nome: string; preco_custo: number | null }) => {
          custoPorNome[p.nome] = Number(p.preco_custo) || 0;
        });
      }

      const itensToInsert = itens.map((item: {
              produto_id?: string;
              produto_bling_id?: string | number;
              produto_nome: string;
              quantidade: number;
              unidade?: string;
              preco_unitario: number;
              preco_custo?: number;
      }) => {
              const snapshotCusto =
                (typeof item.preco_custo === 'number' && item.preco_custo > 0
                  ? item.preco_custo
                  : 0) ||
                (item.produto_id ? custoPorId[item.produto_id] : 0) ||
                custoPorNome[item.produto_nome] ||
                0;
              return {
                orcamento_id: orcamento.id,
                produto_id: item.produto_id || null,
                produto_bling_id: item.produto_bling_id ? Number(item.produto_bling_id) : null,
                produto_nome: item.produto_nome,
                quantidade: item.quantidade,
                unidade: item.unidade || 'unidade',
                preco_unitario: item.preco_unitario,
                subtotal: item.quantidade * item.preco_unitario,
                preco_custo: snapshotCusto,
              };
      });

      const { error: itensError } = await supabaseAdmin
            .from('orcamento_itens')
            .insert(itensToInsert);

      if (itensError) {
        console.error('Erro ao criar itens:', itensError);
        return NextResponse.json({ error: 'Erro ao criar itens do orçamento' }, { status: 500 });
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
          const dataDe = searchParams.get('dataDe') || '';
          const dataAte = searchParams.get('dataAte') || '';
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
                forma_pagamento,
                status_pagamento,
                ferragem_status,
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
                  bairro,
                  recebedor
                ),
                motoristas:motorista_id (
                  nome
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

      const ferragemStatus = searchParams.get('ferragem_status');
      if (ferragemStatus === 'pendente') {
              // Pedidos com FERRAGEM nas observacoes que ainda nao foram passados ao ferreiro
              // Excluir pedidos ja completos
              query = query
                .ilike('observacoes', '%FERRAGEM:%')
                .is('ferragem_status', null)
                .neq('status', 'completo');
      } else if (ferragemStatus === 'em_producao') {
              // Excluir pedidos ja completos
              query = query.eq('ferragem_status', 'em_producao').neq('status', 'completo');
      } else if (ferragemStatus === 'pronta') {
              // Ferragens prontas que ainda nao foram entregues/retiradas
              query = query.eq('ferragem_status', 'pronta').neq('status', 'completo');
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

      if (dataDe) {
        query = query.gte('criado_em', dataDe + 'T00:00:00.000Z');
      }
      if (dataAte) {
        query = query.lte('criado_em', dataAte + 'T23:59:59.999Z');
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
        const motoristaNome = (orc.motoristas as Record<string, unknown> | null)?.nome as string | null;
        return { ...orc, resumo_itens: resumo || '', motorista_nome: motoristaNome || null };
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
