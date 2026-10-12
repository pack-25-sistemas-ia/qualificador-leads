import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { LeadCreateForm } from '@/components/leads/lead-forms';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES } from '@/lib/leads/access';

export const metadata: Metadata = { title: 'Novo lead' };

export default async function NewLeadPage() {
  await requireContext(WRITER_ROLES);
  return (
    <>
      <PageHeader title="Novo lead" description="Cadastro manual (indicação, evento, telefone). Leads de formulários chegam sozinhos." />
      <Card><LeadCreateForm /></Card>
    </>
  );
}
