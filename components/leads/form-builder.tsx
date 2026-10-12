'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ActionButton } from '@/components/app/form-kit';
import { Modal } from '@/components/app/modal';
import { archiveForm, duplicateForm, publishForm, saveFormDraft } from '@/lib/leads/actions';
import { FIELD_TYPE_LABELS, FIELD_TYPES, validateDefinition, type FieldType, type FormField } from '@/lib/leads/formlogic';
import { formatDateTime } from '@/lib/leads/format';
import { canonical, moveItem, newField, removeField, renameKey, setRule, type Draft } from './builder-state';
import { QuestionEditor, QuestionList, StepsEditor } from './builder-parts';
import { FormRenderer } from './form-renderer';

export type VersionInfo = { version: number; published_at: string | null };

export function FormBuilder({ formId, slug, status, versions, initial, origin, timezone }: {
  formId: string; slug: string; status: 'draft' | 'published' | 'archived'; versions: VersionInfo[]; initial: Draft; origin: string; timezone: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState(() => canonical(initial));
  const [selected, setSelected] = useState<string | null>(initial.schema.fields[0]?.key ?? null);
  const [addType, setAddType] = useState<FieldType>('text');
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [dupOpen, setDupOpen] = useState(false);
  const [dup, setDup] = useState({ name: `${initial.meta.name} (cópia)`, slug: `${slug}-copia`.slice(0, 60) });
  const [dupErr, setDupErr] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const archived = status === 'archived';
  const dirty = canonical(draft) !== saved;
  const problems = useMemo(() => validateDefinition(draft.schema, draft.logic, draft.consent), [draft]);
  const field = draft.schema.fields.find((f) => f.key === selected) ?? null;
  const publicUrl = `${origin}/f/${slug}`;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));
  const patchField = (key: string, patch: Partial<FormField>, remove: Array<keyof FormField> = []) =>
    update((d) => ({ ...d, schema: { ...d.schema, fields: d.schema.fields.map((f) => { if (f.key !== key) return f; const n = { ...f, ...patch }; for (const r of remove) delete n[r]; return n; }) } }));

  function payload(d: Draft) {
    return { schema: d.schema, logic: d.logic, consent: { required: d.consent.required !== false, text: d.consent.text, ...(d.consent.policy_url ? { policy_url: d.consent.policy_url } : {}) }, meta: d.meta };
  }

  async function save(): Promise<boolean> {
    const r = await saveFormDraft(formId, payload(draft));
    setMessage({ ok: Boolean(r.ok), text: r.message ?? '' });
    if (r.fieldErrors) setMessage({ ok: false, text: Object.values(r.fieldErrors).flat()[0] ?? r.message ?? 'Verifique os campos.' });
    setServerProblems(r.problems ?? []);
    if (r.ok) { setSaved(canonical(draft)); router.refresh(); }
    return Boolean(r.ok);
  }

  function onSave() {
    setMessage(null);
    start(async () => { await save(); });
  }

  function onPublish() {
    setMessage(null);
    if (problems.length > 0) { setMessage({ ok: false, text: 'Corrija os pontos listados antes de publicar.' }); return; }
    start(async () => {
      if (dirty && !(await save())) return;
      const r = await publishForm(formId);
      setServerProblems(r.problems ?? []);
      setMessage({ ok: Boolean(r.ok), text: r.message ?? '' });
      if (r.ok) router.refresh();
    });
  }

  function add() {
    const keys = draft.schema.fields.map((f) => f.key);
    const f = newField(addType, keys, draft.schema.steps[draft.schema.steps.length - 1]?.id);
    update((d) => ({ ...d, schema: { ...d.schema, fields: [...d.schema.fields, f] } }));
    setSelected(f.key);
  }

  function remove(key: string) {
    const f = draft.schema.fields.find((x) => x.key === key);
    if (!window.confirm(`Remover a pergunta «${f?.label ?? key}»? Condições que dependem dela também serão ajustadas.`)) return;
    update((d) => removeField(d, key));
    setSelected((s) => (s === key ? null : s));
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(publicUrl); setMessage({ ok: true, text: 'Link copiado.' }); } catch { setMessage({ ok: false, text: `Copie manualmente: ${publicUrl}` }); }
  }

  const allProblems = [...new Set([...problems, ...serverProblems])];
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <Badge tone={status === 'published' ? 'success' : status === 'archived' ? 'neutral' : 'warning'}>{status === 'published' ? 'Publicado' : status === 'archived' ? 'Arquivado' : 'Rascunho'}</Badge>
        {dirty ? <Badge tone="warning">Alterações não salvas</Badge> : <span className="text-xs text-muted">Tudo salvo</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onSave} disabled={pending || archived || !dirty}>{pending ? 'Salvando…' : 'Salvar rascunho'}</Button>
          <Button type="button" onClick={onPublish} disabled={pending || archived}>{status === 'published' && !dirty && versions.every((v) => v.published_at) ? 'Nada novo para publicar' : 'Publicar'}</Button>
          <Button type="button" variant="secondary" onClick={() => setDupOpen(true)}>Duplicar</Button>
          <ActionButton label={archived ? 'Restaurar' : 'Arquivar'} variant="secondary" confirm={archived ? undefined : 'Arquivar tira o link público do ar. Continuar?'} action={() => archiveForm(formId, !archived)} />
        </div>
      </div>

      {message ? <Alert tone={message.ok ? 'success' : 'error'}>{message.text}</Alert> : null}
      {archived ? <Alert tone="warning">Formulário arquivado: o link público está fora do ar. Restaure para editar.</Alert> : null}
      {allProblems.length > 0 ? (
        <Alert tone="warning">
          <p className="font-medium">Para publicar, ajuste:</p>
          <ul className="mt-1 list-disc pl-5">{allProblems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Perguntas" description="Arraste pelo ⠿ (ou use espaço e as setas) para reordenar.">
          <QuestionList
            draft={draft} selected={selected} onSelect={setSelected} onRemove={remove}
            onReorder={(from, to) => update((d) => ({ ...d, schema: { ...d.schema, fields: moveItem(d.schema.fields, from, to) } }))}
          />
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1"><label htmlFor="add-type" className="mb-1 block text-xs font-medium text-muted">Tipo da nova pergunta</label>
              <Select id="add-type" value={addType} onChange={(e) => setAddType(e.target.value as FieldType)}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </Select></div>
            <Button type="button" onClick={add} disabled={archived || draft.schema.fields.length >= 60}>+ Adicionar pergunta</Button>
          </div>
        </Card>

        <Card title={field ? 'Propriedades da pergunta' : 'Propriedades'} description={field ? undefined : 'Selecione uma pergunta na lista.'}>
          {field && !archived ? (
            <QuestionEditor
              draft={draft} field={field}
              onChange={(patch, remove) => patchField(field.key, patch, remove)}
              onRename={(newKey) => { update((d) => renameKey(d, field.key, newKey)); setSelected(newKey); }}
              onRule={(rule) => update((d) => setRule(d, field.key, rule))}
            />
          ) : <p className="text-sm text-muted">Nada selecionado.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Etapas"><StepsEditor draft={draft} onChange={(steps) => update((d) => ({ ...d, schema: { steps, fields: d.schema.fields.map((f) => (f.step && !steps.some((s) => s.id === f.step) ? { ...f, step: undefined } : f)) } }))} /></Card>
        <Card title="Mensagens e consentimento (LGPD)">
          <div className="space-y-4">
            <Field label="Nome do formulário" name="m-name"><Input id="m-name" value={draft.meta.name} maxLength={120} onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, name: e.target.value } }))} /></Field>
            <Field label="Descrição (aparece acima das perguntas)" name="m-desc"><Textarea id="m-desc" className="min-h-16" value={draft.meta.description} maxLength={600} onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, description: e.target.value } }))} /></Field>
            <Field label="Mensagem de agradecimento" name="m-thanks"><Input id="m-thanks" value={draft.meta.thank_you_message} maxLength={600} onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, thank_you_message: e.target.value } }))} /></Field>
            <Field label="Redirecionar depois do envio (opcional)" name="m-redirect" hint="Endereço https:// completo, por exemplo a página de obrigado do seu site."><Input id="m-redirect" value={draft.meta.success_redirect_url} maxLength={300} inputMode="url" onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, success_redirect_url: e.target.value } }))} /></Field>
            <Field label="Texto do consentimento" name="m-consent" hint="Mostrado com a caixa de aceite. Explique a finalidade do contato; o link da política de privacidade vem das Configurações."><Textarea id="m-consent" className="min-h-20" value={draft.consent.text} maxLength={600} onChange={(e) => update((d) => ({ ...d, consent: { ...d.consent, text: e.target.value } }))} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={draft.consent.required !== false} onChange={(e) => update((d) => ({ ...d, consent: { ...d.consent, required: e.target.checked } }))} />Exigir o aceite para enviar</label>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prévia" description="É o mesmo formulário que o visitante verá. O envio não é feito.">
          <div className="mb-3 flex justify-end"><Button type="button" variant="secondary" onClick={() => setPreviewKey((k) => k + 1)}>Reiniciar prévia</Button></div>
          <FormRenderer key={previewKey} schema={draft.schema} logic={draft.logic} consent={draft.consent} preview />
        </Card>
        <div className="space-y-4">
          <Card title="Link público e campanhas">
            {status === 'published' ? (
              <div className="space-y-2 text-sm">
                <p className="break-all"><code>{publicUrl}</code></p>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={copyLink}>Copiar link</Button><a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/f/${slug}`} target="_blank" rel="noopener noreferrer">Abrir página pública</a></div>
              </div>
            ) : <p className="text-sm text-muted">O link só funciona depois de publicar: <code>{publicUrl}</code></p>}
            <p className="mt-3 text-xs text-muted">Para medir campanhas, divulgue o link com UTM: <code className="break-all">{publicUrl}?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=nome-da-campanha</code>. O link (slug) não muda depois de publicado.</p>
          </Card>
          <Card title="Versões" description="Cada publicação cria uma versão que nunca muda. As respostas guardam a versão em que foram enviadas.">
            <ul className="space-y-1 text-sm">
              {versions.map((v) => (
                <li key={v.version} className="flex justify-between gap-2"><span>Versão {v.version}</span><span className="text-muted">{v.published_at ? `publicada em ${formatDateTime(v.published_at, timezone)}` : 'rascunho'}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={dupOpen} onClose={() => setDupOpen(false)} title="Duplicar formulário">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          setDupErr(null);
          start(async () => {
            const r = await duplicateForm(formId, { name: dup.name, slug: dup.slug, template: '' });
            if (r.ok && r.id) { setDupOpen(false); router.push(`/formularios/${r.id}`); }
            else setDupErr(r.fieldErrors?.slug?.[0] ?? r.message ?? 'Não foi possível duplicar.');
          });
        }}>
          <Field label="Nome da cópia" name="d-name"><Input id="d-name" value={dup.name} maxLength={120} onChange={(e) => setDup({ ...dup, name: e.target.value })} /></Field>
          <Field label="Link da cópia" name="d-slug" hint="Letras minúsculas, números e hífens."><Input id="d-slug" value={dup.slug} maxLength={60} onChange={(e) => setDup({ ...dup, slug: e.target.value.toLowerCase() })} /></Field>
          {dupErr ? <Alert tone="error">{dupErr}</Alert> : null}
          <div className="flex gap-2"><Button type="submit" disabled={pending}>Duplicar</Button><Button type="button" variant="secondary" onClick={() => setDupOpen(false)}>Cancelar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
