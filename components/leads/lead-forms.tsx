'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Select, Textarea } from '@/components/ui/primitives';
import { ActionButton, FormShell, SelectField, TextAreaField, TextField, useActionForm, type Opt } from '@/components/app/form-kit';
import { addActivity, analyzeLead, assignLead, changeStatus, completeActivity, createLead, updateLead } from '@/lib/leads/actions';
import { ACTIVITY_LABELS, ACTIVITY_TYPES, STATUS_LABELS, TRANSITIONS, type LeadStatus } from '@/lib/leads/filters';
import { activitySchema, leadCreateSchema, leadEditSchema } from '@/lib/leads/validation';
import type { ActionState } from '@/lib/actions/result';

type LeadInput = { name: string; email: string; phone: string; company_name: string; segment: string; notes: string };

export function LeadCreateForm() {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: leadCreateSchema,
    defaultValues: { name: '', email: '', phone: '', company_name: '', segment: '', notes: '', source: '' },
    action: createLead,
    onSuccess: (r) => { if (r.id) router.push(`/leads/${r.id}`); },
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Cadastrar lead">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" maxLength={160} />
        <TextField form={form} name="company_name" label="Empresa" maxLength={160} />
        <TextField form={form} name="email" label="E-mail" type="email" inputMode="email" maxLength={254} />
        <TextField form={form} name="phone" label="Telefone / WhatsApp" type="tel" inputMode="tel" maxLength={30} hint="Com DDD." />
        <TextField form={form} name="segment" label="Segmento" maxLength={120} />
        <TextField form={form} name="source" label="Origem" maxLength={80} hint="Ex.: indicação, evento. Padrão: manual." />
      </div>
      <TextAreaField form={form} name="notes" label="Observações" maxLength={4000} />
      <p className="text-xs text-muted">Informe e-mail ou telefone. Se o contato já existir, você será avisado em vez de criar duplicado.</p>
    </FormShell>
  );
}

export function LeadEditForm({ id, initial }: { id: string; initial: LeadInput }) {
  const { form, state, pending, submit } = useActionForm({
    schema: leadEditSchema,
    defaultValues: initial,
    action: (v: LeadInput) => updateLead(id, v),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar alterações">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" maxLength={160} />
        <TextField form={form} name="company_name" label="Empresa" maxLength={160} />
        <TextField form={form} name="email" label="E-mail" type="email" inputMode="email" maxLength={254} />
        <TextField form={form} name="phone" label="Telefone / WhatsApp" type="tel" inputMode="tel" maxLength={30} />
        <TextField form={form} name="segment" label="Segmento" maxLength={120} />
      </div>
      <TextAreaField form={form} name="notes" label="Observações" maxLength={4000} />
    </FormShell>
  );
}

/** Mudança de status: só mostra as transições válidas; desqualificar exige um motivo. */
export function StatusControl({ id, status, reasons }: { id: string; status: LeadStatus; reasons: string[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<LeadStatus | ''>('');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const options = TRANSITIONS[status];
  if (options.length === 0) return <p className="text-sm text-muted">Lead convertido: o status é final.</p>;
  const needsReason = target === 'disqualified';
  const finalReason = reason === '__other' ? other.trim() : reason;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        start(async () => {
          const r = await changeStatus(id, { status: target, reason: needsReason ? finalReason : '' });
          setMsg(r);
          if (r.ok) { setTarget(''); setReason(''); setOther(''); router.refresh(); }
        });
      }}
    >
      <Field label="Mover para" name={`status-${id}`}>
        <Select id={`status-${id}`} value={target} onChange={(e) => setTarget(e.target.value as LeadStatus | '')}>
          <option value="">Selecione…</option>
          {options.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
      </Field>
      {needsReason ? (
        <>
          <Field label="Motivo da desqualificação" name={`reason-${id}`}>
            <Select id={`reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Selecione…</option>
              {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="__other">Outro (descrever)</option>
            </Select>
          </Field>
          {reason === '__other' ? <Field label="Descreva o motivo" name={`other-${id}`}><Textarea id={`other-${id}`} maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} className="min-h-16" /></Field> : null}
        </>
      ) : null}
      {msg.message ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert> : null}
      <Button type="submit" disabled={pending || !target || (needsReason && !finalReason)}>{pending ? 'Salvando…' : 'Atualizar status'}</Button>
    </form>
  );
}

export function AssignControl({ id, current, people }: { id: string; current: string | null; people: Opt[] }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignLead(id, value || null);
          setMsg(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <Field label="Responsável" name={`assign-${id}`}>
        <Select id={`assign-${id}`} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Sem responsável (fila)</option>
          {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </Field>
      {msg.message ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending || value === (current ?? '')}>{pending ? 'Salvando…' : 'Atribuir'}</Button>
    </form>
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const { form, state, pending, submit } = useActionForm({
    schema: activitySchema,
    defaultValues: { type: 'call' as const, description: '', due_at: '', done: false },
    action: (v: { type: (typeof ACTIVITY_TYPES)[number]; description: string; due_at: string; done: boolean }) => addActivity(leadId, v),
    resetOnSuccess: true,
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Registrar atividade">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="type" label="Tipo" options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_LABELS[t] }))} />
        <TextField form={form} name="due_at" label="Data e hora (follow-up)" type="datetime-local" hint="Deixe vazio se já foi feita." />
      </div>
      <TextAreaField form={form} name="description" label="O que foi feito / combinado" maxLength={2000} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...form.register('done')} />
        <span>Já foi concluída (conta como primeiro contato)</span>
      </label>
    </FormShell>
  );
}

export function ActivityToggle({ id, leadId, done }: { id: string; leadId: string; done: boolean }) {
  return <ActionButton label={done ? 'Reabrir' : 'Concluir'} pendingLabel="…" variant="secondary" action={() => completeActivity(id, leadId, !done)} />;
}

export function AnalyzeButton({ leadId }: { leadId: string }) {
  return <ActionButton label="Gerar análise por IA" pendingLabel="Analisando…" variant="secondary" action={() => analyzeLead(leadId)} />;
}
