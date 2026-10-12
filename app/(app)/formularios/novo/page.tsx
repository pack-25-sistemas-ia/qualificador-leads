import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { FormCreateForm } from '@/components/leads/form-create';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';
import { getPublicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Novo formulário' };

export default async function NewFormPage() {
  await requireContext(MANAGER_ROLES);
  return (
    <>
      <PageHeader title="Novo formulário" description="Escolha um modelo para começar. Você poderá mudar perguntas, etapas e condições antes de publicar." />
      <Card><FormCreateForm origin={getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')} /></Card>
    </>
  );
}
