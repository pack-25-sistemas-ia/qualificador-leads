import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { FormBuilder } from '@/components/leads/form-builder';
import { DEFAULT_CONSENT, type Draft } from '@/components/leads/builder-state';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';
import { loadForm, loadSettings } from '@/lib/leads/data';
import { getPublicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Editar formulário' };

export default async function FormEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext(MANAGER_ROLES);
  const loaded = await loadForm(ctx, id);
  if (!loaded) notFound();
  const { form, versions } = loaded;
  const settings = await loadSettings(ctx);
  // edita o rascunho, se houver; senão parte da última versão publicada (a próxima alteração cria um novo rascunho)
  const base = versions.find((v) => v.published_at === null) ?? versions[0];
  if (!base) notFound();
  const initial: Draft = {
    meta: { name: form.name, description: form.description ?? '', thank_you_message: form.thank_you_message, success_redirect_url: form.success_redirect_url ?? '' },
    schema: { steps: base.schema_json.steps ?? [], fields: base.schema_json.fields ?? [] },
    logic: base.conditional_logic_json ?? [],
    consent: { required: base.consent_config_json?.required !== false, text: base.consent_config_json?.text || DEFAULT_CONSENT },
  };
  return (
    <>
      <PageHeader title={form.name} description="Monte as perguntas, defina condições e etapas, veja a prévia e publique." />
      <FormBuilder
        key={`${form.id}-${base.id}-${form.updated_at}`}
        formId={form.id} slug={form.slug} status={form.status} initial={initial}
        versions={versions.map((v) => ({ version: v.version_number, published_at: v.published_at }))}
        origin={getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')} timezone={settings.timezone}
      />
    </>
  );
}
