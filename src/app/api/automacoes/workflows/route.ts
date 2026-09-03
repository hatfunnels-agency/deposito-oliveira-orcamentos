import { NextRequest, NextResponse } from 'next/server';
import { listarWorkflows } from '@/lib/ghl';
import { TEMPLATES, resolverWorkflow } from '@/lib/automacoes';

export const dynamic = 'force-dynamic';

// GET /api/automacoes/workflows
// Lista os workflows do GHL e mostra qual deles cada template da regua
// resolveu. Serve pra conferir o mapeamento sem abrir o GHL e sem caçar id.
// Auth: header x-admin-key === ADMIN_API_KEY.
// ?forcar=1 ignora o cache de 10 minutos da listagem.
export async function GET(request: NextRequest) {
  const chave = process.env.ADMIN_API_KEY;
  if (!chave || request.headers.get('x-admin-key') !== chave) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const forcar = new URL(request.url).searchParams.get('forcar') === '1';
  const workflows = await listarWorkflows(forcar);

  const nomesTemplate = Array.from(new Set(Object.values(TEMPLATES)));
  const mapeamento = await Promise.all(
    nomesTemplate.map(async nome => {
      const wf = await resolverWorkflow(nome);
      return {
        template: nome,
        workflow: wf?.nome ?? null,
        workflowId: wf?.id ?? null,
        situacao: !wf
          ? 'FALTA CRIAR o workflow no GHL'
          : wf.nome.toLowerCase().includes(nome.toLowerCase())
            ? 'ok'
            : `resolvido por fallback para "${wf.nome}"`,
      };
    }),
  );

  return NextResponse.json({
    workflowsNoGhl: workflows.length,
    workflows: workflows.map(w => ({ id: w.id, nome: w.name })),
    mapeamento,
    pendentes: mapeamento.filter(m => !m.workflowId).map(m => m.template),
  });
}
