'use client';

import { useRouter } from 'next/navigation';
import { Field, Select } from '@/components/ui/primitives';
import { FormShell, TextField, useActionForm } from '@/components/app/form-kit';
import { createForm } from '@/lib/leads/actions';
import { TEMPLATES } from '@/lib/leads/templates';
import { formCreateSchema } from '@/lib/leads/validation';
import { slugifyValue } from './builder-state';

const slug = (s: string) => slugifyValue(s).replace(/_/g, '-').slice(0, 60);

export function FormCreateForm({ origin }: { origin: string }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: formCreateSchema,
    defaultValues: { name: '', slug: '', template: 'b2b' },
    action: createForm,
    onSuccess: (r) => { if (r.id) router.push(`/formularios/${r.id}`); },
  });
  const tpl = TEMPLATES.find((t) => t.id === form.watch('template'));
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Criar formulário">
      <Field label="Começar de" name="template" hint={tpl?.description ?? 'Um formulário só com nome e e-mail.'}>
        <Select id="template" {...form.register('template', { onChange: (e) => {
          const t = TEMPLATES.find((x) => x.id === e.target.value);
          if (t && !form.getValues('name')) { form.setValue('name', t.name); form.setValue('slug', t.slug); }
        } })}>
          <option value="">Em branco (nome e e-mail)</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <TextField form={form} name="name" label="Nome do formulário" maxLength={120} />
      <TextField form={form} name="slug" label="Link público" maxLength={60} hint={`${origin}/f/${form.watch('slug') || 'seu-link'} — letras minúsculas, números e hífens. Não muda depois de publicado.`} />
      <button type="button" className="text-sm underline underline-offset-2" onClick={() => { const n = form.getValues('name'); if (n) form.setValue('slug', slug(n)); }}>Gerar o link a partir do nome</button>
    </FormShell>
  );
}
