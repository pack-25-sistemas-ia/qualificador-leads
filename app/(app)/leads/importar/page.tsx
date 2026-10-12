import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { ImportLeadsForm } from '@/components/leads/import-form';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';

export const metadata: Metadata = { title: 'Importar leads' };

export default async function ImportLeadsPage() {
  await requireContext(MANAGER_ROLES);
  return (
    <>
      <PageHeader title="Importar leads" description="Envie uma planilha CSV. Primeiro confira o relatório (nada é gravado); depois importe de verdade. Contatos já cadastrados (mesmo e-mail ou telefone) são ignorados. Importe apenas contatos que você tem base legal para tratar (LGPD).">
        <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href="/export/leads-template">Baixar modelo</Link>
      </PageHeader>
      <Card><ImportLeadsForm /></Card>
    </>
  );
}
