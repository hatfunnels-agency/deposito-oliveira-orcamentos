import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, gerarCodigoOrcamento } from '@/lib/supabase';
import { aplicarTagObraAtiva } from '@/lib/cliente-tags-server';
import { aplicarBaixaItem, ehCommitted } from '@/lib/estoque-baixa';
import { criarEnderecoCliente } from '@/lib/enderecos';

export async function POST(request: NextRequest) {
    try {
          const body = await request.json();
          // Destructuring sem cast pra preservar `any` implicito (estilo
          // do codebase pre-Step 3). O cast `Record<string, unknown>`
          // que estava aqui forcava itens/cliente_telefone/etc. a
          // unknown e quebrava .length/.replace/.map na build de TS.
          // Narrowing pra endereco_id/endereco_novo e feito via
          // typeof/instanceof checks mais abaixo.
          const {
                  cliente_nome,
                  cliente_telefone,
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
                  status,
                  forma_pagamento,
                  condicao_pagamento,
                  vencimento,
                  // { valor, metodo, parcelas? } — venda paga no ato (PDV).
                  // Vira uma linha em `pagamentos`; o trigger deriva o
                  // status_pagamento. Nao existe mais "nascer pago" sem
                  // dinheiro registrado.
                  pagamento_inicial,
                  endereco_id: enderecoIdBody,
                  endereco_novo: enderecoNovoBody,
          } = body;

      if (!cliente_nome || !subtotal || !itens || itens.length === 0) {
              return NextResponse.json(
                { error: 'Dados obrigatorios: nome, subtotal e itens' },
                { status: 400 }
                      );
      }

      // Upsert cliente. Telefone e opcional (PDV/venda balcao). Quando vazio, gera placeholder
      // unico para nao quebrar UNIQUE constraint do banco e nao deduplicar com outros walk-ins.
      //
      // Step 4 Tarefa 4: campos de endereco (cep/endereco/numero/
      // complemento) NAO sao mais escritos no upsert do cliente — eles
      // viviam em clientes.* como legado e o trigger
      // sync_cliente_to_enderecos_padrao espelhava em enderecos_clientes.
      // Agora o endereco vai sempre via body.endereco_id ou endereco_novo
      // direto pra enderecos_clientes; o trigger pode ser dropado em
      // seguranca. Recebedor permanece no clientes.* como atributo per-
      // cliente (nao e endereco). Os campos legacy continuam aceitos no
      // body durante o deploy gap mas sao ignorados aqui.
      const telefoneLimpo = cliente_telefone && String(cliente_telefone).replace(/\D/g, '').length > 0
        ? String(cliente_telefone).replace(/\D/g, '')
        : `pdv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const clienteData: Record<string, unknown> = {
                  nome: cliente_nome,
                  telefone: telefoneLimpo,
                  atualizado_em: new Date().toISOString(),
          };
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

      // Resolve endereco_id do orcamento. Step 4 Tarefa 4: o fallback
      // is_padrao foi removido. Pra tipo_entrega='entrega', endereco_id
      // OU endereco_novo e obrigatorio (400 se nem um nem outro). Pra
      // retirada/PDV, endereco e opcional (enderecoIdFinal pode ficar
      // null sem erro).
      let enderecoIdFinal: string | null = null;
      if (typeof enderecoIdBody === 'string' && enderecoIdBody.length > 0) {
              const { data: end } = await supabaseAdmin
                .from('enderecos_clientes')
                .select('id, cliente_id')
                .eq('id', enderecoIdBody)
                .single();
              if (!end || end.cliente_id !== cliente.id) {
                      return NextResponse.json(
                        { error: 'endereco_id invalido ou nao pertence ao cliente' },
                        { status: 400 },
                      );
              }
              enderecoIdFinal = end.id as string;
      } else if (enderecoNovoBody && typeof enderecoNovoBody === 'object') {
              const r = await criarEnderecoCliente(cliente.id as string, enderecoNovoBody);
              if (!r.ok) {
                      console.error('[POST orcamentos] criar endereco_novo falhou', r);
                      return NextResponse.json(
                        { error: 'Falha ao criar endereco novo' },
                        { status: 500 },
                      );
              }
              enderecoIdFinal = r.endereco.id;
      } else if (tipo_entrega === 'entrega') {
              return NextResponse.json(
                { error: 'endereco_id ou endereco_novo e obrigatorio para tipo_entrega=entrega' },
                { status: 400 },
              );
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
      if (forma_pagamento) insertData.forma_pagamento = forma_pagamento;
    if (condicao_pagamento) insertData.condicao_pagamento = condicao_pagamento;
        if (vencimento) insertData.vencimento = vencimento;
          if (data_entrega) { insertData.data_entrega = data_entrega; }
          if (data_retirada) { insertData.data_retirada = data_retirada; }
          if (enderecoIdFinal) { insertData.endereco_id = enderecoIdFinal; }

      const { data: orcamento, error: orcError } = await supabaseAdmin
            .from('orcamentos')
            .insert(insertData)
            .select('id, codigo')
            .single();

      if (orcError) {
              console.error('Erro ao criar orcamento:', orcError);
              return NextResponse.json({ error: 'Erro ao salvar orcamento' }, { status: 500 });
      }

      // Venda paga no ato (PDV). Falha aqui nao derruba a venda — o pedido
      // fica em aberto e aparece na aba Financeiro pra acerto manual, que e
      // melhor do que perder o pedido inteiro.
      if (pagamento_inicial && Number(pagamento_inicial.valor) > 0) {
              const { error: pagError } = await supabaseAdmin.from('pagamentos').insert({
                      orcamento_id: orcamento.id,
                      valor: Number(pagamento_inicial.valor),
                      metodo: pagamento_inicial.metodo || 'outro',
                      parcelas: Number(pagamento_inicial.parcelas) || 1,
                      origem: pagamento_inicial.origem || 'manual',
                      gateway_id: pagamento_inicial.gateway_id || null,
              });
              if (pagError) console.error('Erro ao registrar pagamento inicial:', pagError);
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

      const { data: itensInseridos, error: itensError } = await supabaseAdmin
            .from('orcamento_itens')
            .insert(itensToInsert)
            .select('id');

      if (itensError) {
        console.error('Erro ao criar itens:', itensError);
        return NextResponse.json({ error: 'Erro ao criar itens do orçamento' }, { status: 500 });
      }

      // Detalhamento de ferragem (Batch B Fase 1): pra cada item que veio
      // com body.detalhamento_ferro = [{tipo_ferro, metros}, ...], insere
      // em ferragem_consumo. Aceita opcional — payloads sem o campo
      // (incluindo todos os fluxos pre-Batch B) seguem inalterados.
      const ferragemRows: Array<{ orcamento_item_id: string; tipo_ferro: string; metros: number }> = [];
      for (let i = 0; i < itens.length; i++) {
        const det = (itens[i] as { detalhamento_ferro?: Array<{ tipo_ferro: string; metros: number }> }).detalhamento_ferro;
        const insertedId = itensInseridos?.[i]?.id as string | undefined;
        if (!insertedId || !det || !Array.isArray(det) || det.length === 0) continue;
        for (const d of det) {
          if (!d.tipo_ferro || typeof d.metros !== 'number' || d.metros <= 0) continue;
          ferragemRows.push({
            orcamento_item_id: insertedId,
            tipo_ferro: String(d.tipo_ferro),
            metros: Number(d.metros),
          });
        }
      }
      if (ferragemRows.length > 0) {
        const { error: fcErr } = await supabaseAdmin.from('ferragem_consumo').insert(ferragemRows);
        if (fcErr) {
          console.error('[ferragem_consumo POST] insert falhou (orcamento ja criado):', fcErr);
        }
      }

      // Dados tecnicos do ambiente (Batch D): pra cada item de kit de laje que
      // veio com body.laje_detalhes, insere em laje_detalhes. Sao esses dados
      // que a fabrica usa pra especificar a laje. Mesmo padrao do bloco acima:
      // opcional, e falha aqui nao derruba o orcamento ja criado.
      const lajeRows: Array<{
        orcamento_item_id: string;
        comprimento: number | null;
        largura: number | null;
        area_m2: number;
        vao_livre: number;
        uso: string;
        tem_viga_intermediaria: boolean;
      }> = [];
      for (let i = 0; i < itens.length; i++) {
        const det = (itens[i] as { laje_detalhes?: {
          comprimento?: number | null;
          largura?: number | null;
          area_m2?: number;
          vao_livre?: number;
          uso?: string;
          tem_viga_intermediaria?: boolean;
        } }).laje_detalhes;
        const insertedId = itensInseridos?.[i]?.id as string | undefined;
        if (!insertedId || !det) continue;
        // vao_livre e uso sao os dois campos sem os quais a fabrica nao
        // consegue especificar — item sem eles nao vira registro tecnico.
        if (!det.uso || typeof det.vao_livre !== 'number' || det.vao_livre <= 0) continue;
        lajeRows.push({
          orcamento_item_id: insertedId,
          comprimento: typeof det.comprimento === 'number' ? det.comprimento : null,
          largura: typeof det.largura === 'number' ? det.largura : null,
          area_m2: Number(det.area_m2) || 0,
          vao_livre: Number(det.vao_livre),
          uso: String(det.uso),
          tem_viga_intermediaria: Boolean(det.tem_viga_intermediaria),
        });
      }
      if (lajeRows.length > 0) {
        const { error: ldErr } = await supabaseAdmin.from('laje_detalhes').insert(lajeRows);
        if (ldErr) {
          console.error('[laje_detalhes POST] insert falhou (orcamento ja criado):', ldErr);
        }
      }

      // Baixa de estoque quando o orcamento nasce ja committed (49pp do
      // gap historico vinha daqui — POST nunca baixava). Awaited de
      // proposito; fire-and-forget morre em delegacao entre lambdas.
      // Falha por item nao bloqueia a criacao do orcamento — so loga.
      if (ehCommitted(String(insertData.status))) {
        for (const it of itensToInsert) {
          try {
            const r = await aplicarBaixaItem(
              { produto_id: it.produto_id, produto_nome: it.produto_nome, quantidade: it.quantidade },
              orcamento.id as string,
            );
            if (!r.ok && !('skipped' in r)) {
              console.error('[POST orcamentos] baixa falhou', it.produto_nome, r);
            }
          } catch (e) {
            console.error('[POST orcamentos] excecao na baixa', it.produto_nome, e);
          }
        }
      }

      // Auto-tag: se o orcamento ja nasce como venda real, marca o cliente
      // com obra_ativa. Nao bloqueia o request (helper trata os erros).
      await aplicarTagObraAtiva(cliente.id as string, String(insertData.status));

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

      // Conversao offline Google Ads (non-blocking) — pedidos que JA NASCEM
      // confirmados (venda de balcao lancada direto como retirada/entrega).
      // Mesmo conjunto de status do PATCH; o gclid/dedupe sao resolvidos na
      // rota /api/google-ads/conversion.
      const STATUS_CONVERSAO_GADS = ['entrega_pendente', 'retirada_pendente', 'entrega_parcial', 'em_rota', 'completo'];
      if (STATUS_CONVERSAO_GADS.includes(String(insertData.status))) {
              try {
                      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://orcamentos.depositooliveira.com';
                      fetch(`${appUrl}/api/google-ads/conversion`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ orcamento_id: orcamento.id }),
                                cache: 'no-store',
                      }).catch(e => console.log('[GAds Conv] Falha (nao bloqueante):', e));
              } catch (e) {
                      console.log('[GAds Conv] Falha (nao bloqueante):', e);
              }
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
                valor_pago,
                condicao_pagamento,
                vencimento,
                ferragem_status,
                motorista_id,
                reagendamentos,
                bling_pedido_id,
                endereco_id,
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
                endereco_completo:enderecos_clientes (
                  id, cep, rua, numero, complemento, bairro, cidade, estado, lat, lng
                ),
                motoristas:motorista_id (
                  nome
                ),
                orcamento_itens (
                  id,
                  produto_id,
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
      // Inclui entrega_parcial: pedido com material entregue mas ferragem
      // ainda pendente (material+ferragem, comum quando a ferragem atrasa)
      // precisa continuar aparecendo na fila/lista de ferragens ate a
      // ferragem sair de fato.
      const FERRAGEM_VALID_STATUSES = ['entrega_pendente', 'entrega_parcial', 'retirada_pendente'];
      if (ferragemStatus === 'pendente') {
        // Pedidos com ferragem (itens de ferro OU FERRAGEM: em observacoes)
        // que ainda nao foram passados ao ferreiro.
        // Apenas pedidos com entrega/retirada pendente.
        query = query
          .is('ferragem_status', null)
          .in('status', FERRAGEM_VALID_STATUSES);
      } else if (ferragemStatus === 'em_producao') {
        // Apenas pedidos com entrega/retirada pendente
        query = query
          .eq('ferragem_status', 'em_producao')
          .in('status', FERRAGEM_VALID_STATUSES);
      } else if (ferragemStatus === 'pronta') {
        // Ferragens prontas em pedidos com entrega/retirada ainda pendente
        query = query
          .eq('ferragem_status', 'pronta')
          .in('status', FERRAGEM_VALID_STATUSES);
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

      // Filtragem server-side para Ferragens "pendente":
      // Mantemos apenas pedidos com pelo menos um item que seja ferragem montada (peca da
      // calculadora) OU com marcador "FERRAGEM:" nas observacoes. Madeira nunca conta.
      const FERRAGEM_EXCLUSOES = ['cambara', 'cambará', 'pinus', 'madeira', 'caibro', 'prancha', 'ripao', 'ripão', 'tabua', 'tábua', 'sarrafo', 'pontalete', 'madeirit'];
      const ehItemFerro = (it: { produto_nome?: string | null; produto_id?: string | number | null }): boolean => {
        const nome = (it.produto_nome || '').toLowerCase();
        if (!nome) return false;
        if (FERRAGEM_EXCLUSOES.some(e => nome.includes(e))) return false;
        if (nome.includes('barras')) return true;
        if (nome.includes('sapata')) return true;
        const isAvulso = it.produto_id == null;
        if (isAvulso && (nome.includes('ferro') || nome.includes('viga') || nome.includes('coluna') || nome.includes('estribo'))) return true;
        return false;
      };
      const dataFiltrada = ferragemStatus === 'pendente'
        ? (data || []).filter((orc: Record<string, unknown>) => {
            const obs = ((orc.observacoes as string) || '').toLowerCase();
            if (obs.includes('ferragem:')) return true;
            const itens = (orc.orcamento_itens as Array<{ produto_nome: string; produto_id: string | number | null }> | null) || [];
            return itens.some(ehItemFerro);
          })
        : (data || []);

      // Tarefa 1: Enriquecer com resumo_itens server-side
      const orcamentosEnriquecidos = dataFiltrada.map((orc: Record<string, unknown>) => {
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
              total: ferragemStatus === 'pendente' ? dataFiltrada.length : (count || 0),
              pagina,
              limite,
      });
    } catch (error) {
          console.error('Erro ao listar orcamentos:', error);
          return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}
