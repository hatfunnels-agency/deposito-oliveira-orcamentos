// Gestao financeira (/financeiro). Server component: a casca cliente le a
// sessao e a secao em ?secao=, por isso o Suspense (useSearchParams).
import { Suspense } from 'react';
import FinanceiroApp from '@/components/financeiro/FinanceiroApp';
import { Carregando } from '@/components/financeiro/Comuns';

export const dynamic = 'force-dynamic';

export default function FinanceiroPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <FinanceiroApp />
    </Suspense>
  );
}
