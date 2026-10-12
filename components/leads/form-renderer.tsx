'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import {
  fieldsOfStep, stepsOf, validateAnswers, visibleFields,
  type ConsentConfig, type FormField, type FormSchema, type LogicRule,
} from '@/lib/leads/formlogic';

export type SubmitResult = { ok: true } | { ok: false; message: string; errors?: Record<string, string> };
type Answers = Record<string, unknown>;

/**
 * Renderizador do formulário: o MESMO na página pública e na prévia do editor. Mostra/oculta perguntas pela lógica condicional,
 * valida por etapa com o espelho do contrato do banco (a validação definitiva é do banco) e inclui honeypot e consentimento.
 */
export function FormRenderer({
  schema, logic, consent, privacyUrl, onSubmit, preview = false, submitLabel = 'Enviar', prefill = {}, thankYou, redirectUrl,
}: {
  schema: FormSchema; logic: LogicRule[]; consent: ConsentConfig; privacyUrl?: string | null; onSubmit?: (input: { answers: Answers; consent: boolean; website: string; key: string }) => Promise<SubmitResult>;
  preview?: boolean; submitLabel?: string; prefill?: Record<string, string>; thankYou?: string; redirectUrl?: string | null;
}) {
  const steps = useMemo(() => stepsOf(schema), [schema]);
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => {
    const init: Answers = {};
    for (const f of schema.fields) if (f.type === 'hidden' && prefill[f.key]) init[f.key] = prefill[f.key]!.slice(0, 200);
    return init;
  });
  const [consentOk, setConsentOk] = useState(false);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const keyRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const visible = useMemo(() => visibleFields(schema, logic, answers), [schema, logic, answers]);
  const step = steps[Math.min(stepIdx, steps.length - 1)]!;
  const stepFields = fieldsOfStep(visible, schema, step.id).filter((f) => f.type !== 'hidden');
  const last = stepIdx >= steps.length - 1;
  const consentRequired = consent.required !== false;

  function set(key: string, value: unknown) {
    setAnswers((a) => ({ ...a, [key]: value }));
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  function focusTop() {
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function validateStep(): boolean {
    const r = validateAnswers(schema, logic, answers);
    const keys = new Set(stepFields.map((f) => f.key));
    const own = Object.fromEntries(Object.entries(r.errors).filter(([k]) => keys.has(k)));
    setErrors(own);
    return Object.keys(own).length === 0;
  }

  function next() {
    setMessage(null);
    if (!validateStep()) return;
    setStepIdx((i) => i + 1);
    focusTop();
  }

  async function submit() {
    setMessage(null);
    const r = validateAnswers(schema, logic, answers);
    if (Object.keys(r.errors).length > 0) {
      setErrors(r.errors);
      const firstBad = schema.fields.find((f) => r.errors[f.key]);
      const idx = firstBad ? steps.findIndex((s) => fieldsOfStep(schema.fields, schema, s.id).some((f) => f.key === firstBad.key)) : -1;
      if (idx >= 0) setStepIdx(idx);
      setMessage('Revise os campos destacados.');
      return;
    }
    if (consentRequired && !consentOk) {
      setErrors({ _consent: 'É necessário concordar para enviar.' });
      return;
    }
    if (preview || !onSubmit) {
      setDone(true);
      return;
    }
    keyRef.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const res = await onSubmit({ answers: r.clean, consent: consentOk, website, key: keyRef.current });
      if (res.ok) setDone(true);
      else {
        setMessage(res.message);
        if (res.errors) {
          setErrors(res.errors);
          const firstBad = schema.fields.find((f) => res.errors![f.key]);
          const idx = firstBad ? steps.findIndex((s) => fieldsOfStep(schema.fields, schema, s.id).some((f) => f.key === firstBad.key)) : -1;
          if (idx >= 0) setStepIdx(idx);
        }
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!done || preview || !redirectUrl || !redirectUrl.startsWith('https://')) return;
    const t = setTimeout(() => window.location.assign(redirectUrl), 1500);
    return () => clearTimeout(t);
  }, [done, preview, redirectUrl]);

  if (done) {
    return (
      <div role="status" className="rounded-lg border border-success bg-card p-6 text-center">
        <p className="text-lg font-semibold">{preview ? 'Prévia: o envio não foi feito.' : 'Recebemos suas informações.'}</p>
        <p className="mt-1 text-sm text-muted">{preview ? 'Na página pública, o visitante veria a mensagem de agradecimento configurada.' : (thankYou ?? 'Obrigado! Entraremos em contato em breve.')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (last) void submit(); else next(); }} noValidate className="space-y-5" aria-label="Formulário">
      <div aria-label="Progresso" className={steps.length > 1 ? undefined : 'sr-only'}>
        <p ref={headingRef} tabIndex={-1} className="text-sm font-medium outline-none">{steps.length > 1 ? `Etapa ${stepIdx + 1} de ${steps.length}: ${step.title}` : 'Formulário'}</p>
        {steps.length > 1 ? <progress className="mt-2 h-2 w-full" max={steps.length} value={stepIdx + 1} aria-label={`Etapa ${stepIdx + 1} de ${steps.length}`} /> : null}
      </div>

      {stepFields.map((f) => <FieldControl key={f.key} field={f} value={answers[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)} />)}

      {last ? (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={consentOk} onChange={(e) => { setConsentOk(e.target.checked); if (errors._consent) setErrors((x) => { const n = { ...x }; delete n._consent; return n; }); }} aria-invalid={Boolean(errors._consent)} aria-describedby={errors._consent ? 'consent-error' : undefined} />
            <span>
              {consent.text}{' '}
              {privacyUrl ? <a className="underline underline-offset-2" href={privacyUrl} target="_blank" rel="noopener noreferrer">Política de privacidade</a> : null}
            </span>
          </label>
          {errors._consent ? <p id="consent-error" role="alert" className="text-xs text-danger">{errors._consent}</p> : null}
        </div>
      ) : null}

      {/* Honeypot: invisível para pessoas e leitores de tela; robôs costumam preenchê-lo. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Não preencha este campo<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>

      {message ? <Alert tone="error">{message}</Alert> : null}
      {errors._contact ? <Alert tone="error">{errors._contact}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {stepIdx > 0 ? <Button type="button" variant="secondary" onClick={() => { setStepIdx((i) => i - 1); setMessage(null); focusTop(); }}>Voltar</Button> : null}
        <Button type="submit" disabled={pending} aria-busy={pending}>{last ? (pending ? 'Enviando…' : submitLabel) : 'Continuar'}</Button>
      </div>
    </form>
  );
}

export function FieldControl({ field, value, error, onChange }: { field: FormField; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const id = useId();
  const errs = error ? [error] : undefined;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  const common = { id, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : field.help ? `${id}-hint` : undefined } as const;
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

  switch (field.type) {
    case 'textarea':
      return <Field label={label} name={id} errors={errs} hint={field.help}><Textarea {...common} value={str} maxLength={field.max_length ?? 2000} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'select':
      return (
        <Field label={label} name={id} errors={errs} hint={field.help}>
          <Select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Selecione…</option>
            {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      );
    case 'radio':
      return (
        <fieldset aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="mb-1.5 text-sm font-medium">{label}</legend>
          <div className="space-y-1">
            {(field.options ?? []).map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={id} className="size-4" checked={value === o.value} onChange={() => onChange(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          {field.help && !error ? <p className="mt-1 text-xs text-muted">{field.help}</p> : null}
          {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
        </fieldset>
      );
    case 'multiselect': {
      const sel = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="mb-1.5 text-sm font-medium">{label}</legend>
          <div className="space-y-1">
            {(field.options ?? []).map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={sel.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...sel, o.value] : sel.filter((x) => x !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
          {field.help && !error ? <p className="mt-1 text-xs text-muted">{field.help}</p> : null}
          {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
        </fieldset>
      );
    }
    case 'checkbox':
    case 'consent':
      return (
        <div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={value === true} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.checked)} />
            <span>{label}</span>
          </label>
          {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
      );
    case 'date':
      return <Field label={label} name={id} errors={errs} hint={field.help}><Input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'email':
      return <Field label={label} name={id} errors={errs} hint={field.help}><Input {...common} type="email" inputMode="email" autoComplete="email" maxLength={254} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'phone':
      return <Field label={label} name={id} errors={errs} hint={field.help ?? 'Com DDD.'}><Input {...common} type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'number':
    case 'currency':
      return <Field label={label} name={id} errors={errs} hint={field.help ?? (field.type === 'currency' ? 'Valor em reais, por exemplo 1500,00.' : undefined)}><Input {...common} type="text" inputMode="decimal" maxLength={20} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    default:
      return <Field label={label} name={id} errors={errs} hint={field.help}><Input {...common} type="text" maxLength={field.max_length ?? 200} autoComplete={field.lead_field === 'name' ? 'name' : field.lead_field === 'company_name' ? 'organization' : 'off'} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
  }
}
