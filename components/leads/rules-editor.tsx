'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Select } from '@/components/ui/primitives';
import { ActionButton, FormShell, SelectField, TextField, useActionForm } from '@/components/app/form-kit';
import { applySuggestedRules, deleteRule, publishModel, rescoreAll, saveRule, saveThresholds, simulateScore, startModelDraft } from '@/lib/leads/actions';
import { CLASS_LABELS } from '@/lib/leads/filters';
import { visibleFields, type FormField, type FormSchema, type LogicRule } from '@/lib/leads/formlogic';
import { formatRuleValue } from '@/lib/leads/rule-value';
import { OPERATOR_LABELS, OPERATORS, VALUELESS, type ScoreResult } from '@/lib/leads/scoring';
import { TEMPLATES } from '@/lib/leads/templates';
import { ruleSchema, thresholdsSchema } from '@/lib/leads/validation';
import type { RuleRow } from '@/lib/leads/data';
import { FieldControl } from './form-renderer';

export type QuestionOption = { key: string; label: string; form: string };
export type FormForSimulation = { id: string; name: string; schema: FormSchema; logic: LogicRule[] };

const HINTS: Record<string, string> = {
  eq: 'Texto ou valor da opção (ex.: ate_30).', neq: 'Texto ou valor da opção.', in: 'Lista separada por vírgula (ex.: 20k_50k, mais_50k).', not_in: 'Lista separada por vírgula.',
  gt: 'Número (ex.: 5000).', gte: 'Número.', lt: 'Número.', lte: 'Número.', between: 'Intervalo, por exemplo 10 a 50.', contains: 'Trecho de texto ou opção (sem diferenciar maiúsculas).',
};

export function ModelActions({ hasDraft, canPublish, draftId, hasPublished }: { hasDraft: boolean; canPublish: boolean; draftId: string | null; hasPublished: boolean }) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!hasDraft ? <ActionButton label={hasPublished ? 'Criar rascunho para editar' : 'Criar o primeiro modelo'} variant="primary" action={startModelDraft} /> : null}
        {hasDraft && draftId ? (
          <ActionButton
            label="Publicar este modelo" pendingLabel="Publicando…" variant="primary"
            confirm="Publicar cria uma nova versão do modelo. Novos leads passam a usá-la; os leads existentes só mudam se você pedir para recalcular. Continuar?"
            action={async () => { const r = await publishModel(draftId); setProblems(r.problems ?? []); if (r.ok) router.refresh(); return r; }}
          />
        ) : null}
        {hasPublished && canPublish ? <ActionButton label="Recalcular todos os leads" pendingLabel="Recalculando…" variant="secondary" confirm="Recalcular acrescenta um novo evento de score a cada lead (até 2.000), com o modelo vigente. O histórico é preservado. Continuar?" action={rescoreAll} /> : null}
      </div>
      {problems.length > 0 ? <Alert tone="warning"><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}
    </div>
  );
}

export function ThresholdsForm({ modelId, initial }: { modelId: string; initial: { warm_min: number; hot_min: number; qualified_min: number } }) {
  const { form, state, pending, submit } = useActionForm({
    schema: thresholdsSchema,
    defaultValues: { warm_min: String(initial.warm_min), hot_min: String(initial.hot_min), qualified_min: String(initial.qualified_min) },
    action: (v: { warm_min: string; hot_min: string; qualified_min: string }) => saveThresholds(modelId, v),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar faixas">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField form={form} name="warm_min" label="Morno a partir de" inputMode="numeric" hint="Abaixo disso: frio." />
        <TextField form={form} name="hot_min" label="Quente a partir de" inputMode="numeric" />
        <TextField form={form} name="qualified_min" label="Qualificado a partir de" inputMode="numeric" hint="Critério dos indicadores de qualificação." />
      </div>
    </FormShell>
  );
}

export function RuleForm({ modelId, rule, questions, onDone }: { modelId: string; rule?: RuleRow; questions: QuestionOption[]; onDone?: () => void }) {
  const { form, state, pending, submit } = useActionForm({
    schema: ruleSchema,
    defaultValues: {
      label: rule?.label ?? '', field_key: rule?.field_key ?? questions[0]?.key ?? '', operator: rule?.operator ?? 'eq',
      value: rule ? formatRuleValue(rule.operator, rule.condition_json) : '', points: String(rule?.points ?? 10), enabled: rule?.enabled ?? true,
    },
    action: (v: { label: string; field_key: string; operator: string; value: string; points: string; enabled: boolean }) => saveRule(modelId, rule?.id ?? null, v),
    resetOnSuccess: !rule,
    onSuccess: () => onDone?.(),
  });
  const op = form.watch('operator');
  const valueless = (VALUELESS as readonly string[]).includes(op);
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={rule ? 'Salvar regra' : 'Adicionar regra'} secondary={rule && onDone ? <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button> : undefined}>
      <TextField form={form} name="label" label="Descrição (aparece na justificativa do score)" maxLength={120} placeholder="Ex.: Orçamento acima de R$ 5.000" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="field_key" label="Pergunta" options={questions.map((q) => ({ value: q.key, label: `${q.label} (${q.key})` }))} hint="Perguntas dos seus formulários." />
        <SelectField form={form} name="operator" label="Condição" options={OPERATORS.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
        {valueless ? <p className="flex items-end pb-2 text-xs text-muted">Esta condição não precisa de valor.</p> : <TextField form={form} name="value" label="Valor" maxLength={500} hint={HINTS[op]} />}
        <TextField form={form} name="points" label="Pontos (-100 a 100)" inputMode="numeric" hint="Negativo tira pontos. O score final fica sempre entre 0 e 100." />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...form.register('enabled')} />Regra ativa</label>
    </FormShell>
  );
}

export function RulesList({ modelId, rules, questions, editable }: { modelId: string; rules: RuleRow[]; questions: QuestionOption[]; editable: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const label = (k: string) => questions.find((q) => q.key === k)?.label ?? k;
  if (rules.length === 0) return <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">Nenhuma regra{editable ? ' ainda. Adicione abaixo ou importe as sugeridas de um modelo de formulário.' : '.'}</p>;
  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-3 text-sm">
          {editing === r.id ? <RuleForm modelId={modelId} rule={r} questions={questions} onDone={() => setEditing(null)} /> : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{r.label} {!r.enabled ? <Badge tone="neutral">Inativa</Badge> : null}</p>
                <p className="text-xs text-muted">Se «{label(r.field_key)}» {OPERATOR_LABELS[r.operator as keyof typeof OPERATOR_LABELS] ?? r.operator}{formatRuleValue(r.operator, r.condition_json) ? ` ${formatRuleValue(r.operator, r.condition_json)}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`tabular-nums font-semibold ${r.points < 0 ? 'text-danger' : ''}`}>{r.points > 0 ? '+' : ''}{r.points}</span>
                {editable ? (
                  <>
                    <Button type="button" variant="secondary" onClick={() => setEditing(r.id)}>Editar</Button>
                    <ActionButton label="Remover" variant="secondary" confirm="Remover esta regra do rascunho?" action={() => deleteRule(modelId, r.id)} />
                  </>
                ) : null}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SuggestedRules() {
  const [tpl, setTpl] = useState(TEMPLATES[0]!.id);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1"><label htmlFor="sug" className="mb-1 block text-xs font-medium text-muted">Importar regras sugeridas de</label>
        <Select id="sug" value={tpl} onChange={(e) => setTpl(e.target.value)}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
      <ActionButton label="Adicionar ao rascunho" variant="secondary" action={() => applySuggestedRules(tpl)} />
    </div>
  );
}

/** Simulador: preenche as respostas de um formulário e mostra a nota, a classe e a justificativa — calculadas pelo banco, sem gravar nada. */
export function Simulator({ modelId, forms }: { modelId: string; forms: FormForSimulation[] }) {
  const [formId, setFormId] = useState(forms[0]?.id ?? '');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = forms.find((f) => f.id === formId);
  const fields: FormField[] = useMemo(() => (form ? visibleFields(form.schema, form.logic, answers).filter((f) => f.type !== 'hidden' && f.type !== 'consent') : []), [form, answers]);
  if (forms.length === 0) return <p className="text-sm text-muted">Crie um formulário para poder simular um lead.</p>;
  return (
    <div className="space-y-4">
      <div className="max-w-sm"><label htmlFor="sim-form" className="mb-1 block text-xs font-medium text-muted">Formulário</label>
        <Select id="sim-form" value={formId} onChange={(e) => { setFormId(e.target.value); setAnswers({}); setResult(null); }}>{forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => <div key={f.key}><FieldControl field={f} value={answers[f.key]} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} /></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending} onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await simulateScore(modelId, { answers }, formId);
            if (r.ok) setResult(r.result as ScoreResult); else { setResult(null); setMsg(r.message ?? 'Não foi possível simular.'); }
          });
        }}>{pending ? 'Calculando…' : 'Simular score'}</Button>
        <Button type="button" variant="secondary" onClick={() => { setAnswers({}); setResult(null); }}>Limpar</Button>
      </div>
      {msg ? <Alert tone="error">{msg}</Alert> : null}
      {result ? (
        <div className="space-y-2 rounded-lg border border-border p-4 text-sm" role="status">
          <p><strong className="text-xl tabular-nums">{result.score}</strong> / 100 · {CLASS_LABELS[result.classification]} · {result.qualified ? 'qualificado' : 'não qualificado'}</p>
          {result.applied.length ? <ul className="space-y-1">{result.applied.map((a, i) => <li key={i} className="flex justify-between gap-3 border-b border-border py-1 last:border-0"><span>{a.label}</span><span className="tabular-nums">{a.points > 0 ? '+' : ''}{a.points}</span></li>)}</ul> : <p className="text-muted">Nenhuma regra atendida.</p>}
          {result.missing.length ? <p className="text-xs text-muted">Dados ausentes que influenciariam: {result.missing.join(', ')}.</p> : null}
          {result.raw_total !== result.score ? <p className="text-xs text-muted">Soma bruta {result.raw_total}, limitada a 0–100.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

