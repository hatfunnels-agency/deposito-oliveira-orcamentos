'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFinanceiro } from '@/lib/financeiro/cliente-api';
import { Aviso, BotaoPerigo, BotaoPrimario, BotaoSecundario, Campo, Carregando, Cartao, Erro, INPUT, Modal, Selo, Vazio } from './Comuns';

// Gestao > Base de conhecimento: perguntas e respostas que o assistente
// tecnico das atendentes usa. O que a loja escreve aqui manda sobre as regras
// gerais do assistente.

interface Item { id: string; pergunta: string; resposta: string; tags: string[]; origem: 'sistema' | 'manual'; ativo: boolean; atualizado_em: string }

export default function BaseConhecimento() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<Item | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setItens((await apiFinanceiro<{ itens: Item[] }>('/api/base-conhecimento')).itens); }
    catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar'); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (itens ?? []).filter(i => !t || i.pergunta.toLowerCase().includes(t) || i.resposta.toLowerCase().includes(t) || i.tags.some(x => x.includes(t)));
  }, [itens, busca]);

  const alternar = async (i: Item) => {
    try {
      await apiFinanceiro('/api/base-conhecimento', { method: 'PATCH', body: JSON.stringify({ id: i.id, ativo: !i.ativo }) });
      carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro'); }
  };
  const apagar = async (i: Item) => {
    if (!window.confirm(`Apagar "${i.pergunta}"?`)) return;
    try {
      await apiFinanceiro(`/api/base-conhecimento?id=${i.id}`, { method: 'DELETE' });
      setAviso('Apagado.');
      carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro'); }
  };

  if (!itens && !erro) return <Carregando texto="Carregando base de conhecimento…" />;

  return (
    <div className="space-y-4">
      <Cartao titulo="Base de conhecimento" descricao="O que o assistente técnico das atendentes sabe sobre produtos, contas de obra e o sistema. O que está aqui manda sobre as regras gerais dele."
        acao={<BotaoPrimario onClick={() => setEditando('novo')}><Plus className="w-4 h-4" /> Nova pergunta</BotaoPrimario>}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar pergunta, resposta ou tag" aria-label="Buscar" className={`${INPUT} min-h-[44px]`} />
        <p className="text-[11px] text-gray-500 mt-2">Escreva a resposta como você falaria para a atendente: a medida, a conta e o que ela pode dizer ao cliente. Itens "sistema" vieram das calculadoras e podem ser editados.</p>
      </Cartao>
      {erro && <Erro mensagem={erro} onTentar={carregar} />}
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}

      {filtrados.length === 0 ? <Vazio>Nada encontrado.</Vazio> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
          {filtrados.map(i => (
            <div key={i.id} className={`p-4 ${i.ativo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 text-sm">{i.pergunta}</p>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{i.resposta}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {!i.ativo && <Selo tom="cinza">desligado</Selo>}
                    {i.origem === 'sistema' && <Selo tom="azul">sistema</Selo>}
                    {i.tags.map(t => <Selo key={t} tom="amarelo">{t}</Selo>)}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <BotaoSecundario onClick={() => setEditando(i)} aria-label="Editar"><Pencil className="w-4 h-4" /></BotaoSecundario>
                  <BotaoSecundario onClick={() => alternar(i)}>{i.ativo ? 'Desligar' : 'Ligar'}</BotaoSecundario>
                  <BotaoPerigo onClick={() => apagar(i)} aria-label="Apagar"><Trash2 className="w-4 h-4" /></BotaoPerigo>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <ModalItem item={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); setAviso('Salvo. O assistente já usa a versão nova.'); carregar(); }} />
      )}
    </div>
  );
}

function ModalItem({ item, onFechar, onSalvo }: { item: Item | null; onFechar: () => void; onSalvo: () => void }) {
  const [pergunta, setPergunta] = useState(item?.pergunta ?? '');
  const [resposta, setResposta] = useState(item?.resposta ?? '');
  const [tags, setTags] = useState((item?.tags ?? []).join(', '));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    setErro(null);
    if (!pergunta.trim() || !resposta.trim()) { setErro('Informe a pergunta e a resposta.'); return; }
    setSalvando(true);
    try {
      const corpo = { pergunta: pergunta.trim(), resposta: resposta.trim(), tags };
      if (item) await apiFinanceiro('/api/base-conhecimento', { method: 'PATCH', body: JSON.stringify({ id: item.id, ...corpo }) });
      else await apiFinanceiro('/api/base-conhecimento', { method: 'POST', body: JSON.stringify(corpo) });
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar'); }
    finally { setSalvando(false); }
  };
  return (
    <Modal titulo={item ? 'Editar pergunta' : 'Nova pergunta'} onFechar={onFechar} largura="md"
      rodape={<><BotaoSecundario onClick={onFechar}>Cancelar</BotaoSecundario><BotaoPrimario onClick={salvar} carregando={salvando}>Salvar</BotaoPrimario></>}>
      <Campo rotulo="Pergunta (como a atendente perguntaria)"><input value={pergunta} onChange={e => setPergunta(e.target.value)} className={INPUT} autoFocus /></Campo>
      <Campo rotulo="Resposta"><textarea value={resposta} onChange={e => setResposta(e.target.value)} rows={7} className={INPUT} /></Campo>
      <Campo rotulo="Tags (separadas por vírgula)" dica="ex.: telhado, calculo"><input value={tags} onChange={e => setTags(e.target.value)} className={INPUT} /></Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
