'use client';

import { useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { CONDITION_OPS, FIELD_TYPE_LABELS, FIELD_TYPES, LEAD_FIELD_LABELS, type Condition, type FieldType, type FormField, type LogicRule } from '@/lib/leads/formlogic';
import { formatRuleValue, parseRuleValue } from '@/lib/leads/rule-value';
import { OPERATOR_LABELS, VALUELESS, type Operator } from '@/lib/leads/scoring';
import { cn } from '@/lib/utils';
import { availableLeadFields, formatOptions, hasOptions, parseOptions, uniqueKey, type Draft } from './builder-state';

// ---------------------------------------------------------------- lista ordenável de perguntas
function SortableItem({ field, index, total, selected, rule, onSelect, onMove, onRemove }: {
  field: FormField; index: number; total: number; selected: boolean; rule: boolean; onSelect: () => void; onMove: (to: number) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('rounded-md border bg-card p-2 text-sm', selected ? 'border-primary ring-1 ring-primary' : 'border-border', isDragging && 'z-10 opacity-80 shadow-lg')}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Reordenar «${field.label}». Use espaço e as setas.`} className="min-h-9 min-w-9 cursor-grab rounded border border-border text-muted active:cursor-grabbing" {...attributes} {...listeners}>⠿</button>
        <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium">{index + 1}. {field.label || '(sem rótulo)'}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {FIELD_TYPE_LABELS[field.type] ?? field.type}
            {field.required ? <Badge tone="warning">Obrigatória</Badge> : null}
            {rule ? <Badge tone="neutral">Condicional</Badge> : null}
            {field.lead_field ? <Badge tone="success">→ {LEAD_FIELD_LABELS[field.lead_field]}</Badge> : null}
          </span>
        </button>
        <div className="flex gap-1">
          <button type="button" className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Subir «${field.label}»`}>↑</button>
          <button type="button" className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Descer «${field.label}»`}>↓</button>
          <button type="button" className="min-h-9 min-w-9 rounded border border-border text-danger" onClick={onRemove} aria-label={`Remover «${field.label}»`}>✕</button>
        </div>
      </div>
    </li>
  );
}

export function QuestionList({ draft, selected, onSelect, onReorder, onRemove }: {
  draft: Draft; selected: string | null; onSelect: (key: string) => void; onReorder: (from: number, to: number) => void; onRemove: (key: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const keys = draft.schema.fields.map((f) => f.key);
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(keys.indexOf(String(e.active.id)), keys.indexOf(String(e.over.id)));
  }
  if (keys.length === 0) return <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">Nenhuma pergunta ainda. Adicione a primeira abaixo.</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2" aria-label="Perguntas do formulário">
          {draft.schema.fields.map((f, i) => (
            <SortableItem key={f.key} field={f} index={i} total={keys.length} selected={selected === f.key} rule={draft.logic.some((r) => r.target === f.key)}
              onSelect={() => onSelect(f.key)} onMove={(to) => onReorder(i, to)} onRemove={() => onRemove(f.key)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

// ---------------------------------------------------------------- editor de uma pergunta
export function QuestionEditor({ draft, field, onChange, onRename, onRule }: { draft: Draft; field: FormField; onChange: (patch: Partial<FormField>, remove?: Array<keyof FormField>) => void; onRename: (newKey: string) => void; onRule: (rule: LogicRule | null) => void }) {
  const [keyText, setKeyText] = useState(field.key);
  const [optText, setOptText] = useState(formatOptions(field.options));
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState(field.key);
  if (lastKey !== field.key) { setLastKey(field.key); setKeyText(field.key); setOptText(formatOptions(field.options)); setKeyErr(null); }
  const leadOpts = availableLeadFields(draft.schema.fields, field);
  const numeric = field.type === 'number' || field.type === 'currency';
  const textual = field.type === 'text' || field.type === 'textarea' || field.type === 'hidden';

  function applyKey() {
    const v = keyText.trim();
    if (v === field.key) { setKeyErr(null); return; }
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(v)) { setKeyErr('Use letras minúsculas, números e _ (começa com letra).'); return; }
    if (draft.schema.fields.some((f) => f.key === v)) { setKeyErr('Já existe uma pergunta com esta chave.'); return; }
    setKeyErr(null);
    onRename(v);
  }

  return (
    <div className="space-y-4">
      <Field label="Pergunta (rótulo)" name="q-label"><Input id="q-label" value={field.label} maxLength={200} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" name="q-type">
          <Select id="q-type" value={field.type} onChange={(e) => {
            const t = e.target.value as FieldType;
            const patch: Partial<FormField> = { type: t };
            if (hasOptions(t) && !field.options?.length) patch.options = [{ value: 'opcao_1', label: 'Opção 1' }, { value: 'opcao_2', label: 'Opção 2' }];
            if (t === 'consent') patch.required = true;
            const drop: Array<keyof FormField> = [];
            if (!hasOptions(t)) drop.push('options');
            if (!(t === 'number' || t === 'currency')) drop.push('min', 'max');
            if (!(t === 'text' || t === 'textarea' || t === 'hidden')) drop.push('max_length');
            if (field.lead_field && !availableLeadFields(draft.schema.fields, { ...field, type: t }).includes(field.lead_field)) drop.push('lead_field');
            onChange(patch, drop);
            if (hasOptions(t)) setOptText(formatOptions(patch.options ?? field.options));
          }}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Chave técnica" name="q-key" errors={keyErr ? [keyErr] : undefined} hint="Identifica a resposta nas regras de score e nos relatórios. Evite mudar depois de publicar.">
          <Input id="q-key" value={keyText} maxLength={40} onChange={(e) => setKeyText(e.target.value)} onBlur={applyKey} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyKey(); } }} aria-invalid={Boolean(keyErr)} />
        </Field>
      </div>
      <Field label="Texto de ajuda (opcional)" name="q-help"><Input id="q-help" value={field.help ?? ''} maxLength={400} onChange={(e) => onChange({ help: e.target.value }, e.target.value === '' ? ['help'] : [])} /></Field>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={field.required === true} disabled={field.type === 'consent'} onChange={(e) => onChange({ required: e.target.checked })} />Resposta obrigatória</label>
        {draft.schema.steps.length > 0 ? (
          <div className="min-w-48"><label htmlFor="q-step" className="sr-only">Etapa</label>
            <Select id="q-step" value={field.step ?? ''} onChange={(e) => onChange(e.target.value ? { step: e.target.value } : {}, e.target.value ? [] : ['step'])}>
              <option value="">Primeira etapa</option>
              {draft.schema.steps.map((s) => <option key={s.id} value={s.id}>Etapa: {s.title || s.id}</option>)}
            </Select>
          </div>
        ) : null}
      </div>
      <Field label="Preenche qual dado do lead?" name="q-lead" hint="O e-mail ou o telefone do lead vem daqui. Pelo menos um deles deve ser obrigatório para publicar.">
        <Select id="q-lead" value={field.lead_field ?? ''} onChange={(e) => onChange(e.target.value ? { lead_field: e.target.value as FormField['lead_field'] } : {}, e.target.value ? [] : ['lead_field'])}>
          <option value="">Nenhum (só resposta do formulário)</option>
          {field.lead_field && !leadOpts.includes(field.lead_field) ? <option value={field.lead_field}>{LEAD_FIELD_LABELS[field.lead_field]}</option> : null}
          {leadOpts.map((lf) => <option key={lf} value={lf}>{LEAD_FIELD_LABELS[lf]}</option>)}
        </Select>
      </Field>

      {hasOptions(field.type) ? (
        <Field label="Opções (uma por linha)" name="q-options" hint="Formato «valor | rótulo» ou só o rótulo. O valor é o que as regras de score comparam.">
          <Textarea id="q-options" value={optText} className="min-h-28 font-mono text-xs" onChange={(e) => setOptText(e.target.value)} onBlur={() => { const parsed = parseOptions(optText); onChange({ options: parsed }); setOptText(formatOptions(parsed)); }} />
        </Field>
      ) : null}
      {numeric ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor mínimo" name="q-min"><Input id="q-min" inputMode="decimal" value={field.min ?? ''} onChange={(e) => { const n = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.')); onChange(n !== null && Number.isFinite(n) ? { min: n } : {}, n === null ? ['min'] : []); }} /></Field>
          <Field label="Valor máximo" name="q-max"><Input id="q-max" inputMode="decimal" value={field.max ?? ''} onChange={(e) => { const n = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.')); onChange(n !== null && Number.isFinite(n) ? { max: n } : {}, n === null ? ['max'] : []); }} /></Field>
        </div>
      ) : null}
      {textual ? (
        <Field label="Máximo de caracteres" name="q-maxlen" hint={field.type === 'textarea' ? 'Padrão 2.000.' : 'Padrão 200.'}>
          <Input id="q-maxlen" inputMode="numeric" value={field.max_length ?? ''} onChange={(e) => { const n = Number(e.target.value); onChange(Number.isInteger(n) && n > 0 && n <= 4000 ? { max_length: n } : {}, e.target.value === '' ? ['max_length'] : []); }} />
        </Field>
      ) : null}

      <ConditionEditor draft={draft} field={field} onChange={onRule} />
    </div>
  );
}

// ---------------------------------------------------------------- «mostrar só se…»
function ConditionEditor({ draft, field, onChange }: { draft: Draft; field: FormField; onChange: (rule: LogicRule | null) => void }) {
  const idx = draft.schema.fields.findIndex((f) => f.key === field.key);
  const earlier = draft.schema.fields.slice(0, idx);
  const rule = draft.logic.find((r) => r.target === field.key) ?? null;
  const mode: 'all' | 'any' = rule?.show_if.any ? 'any' : 'all';
  const conds: Condition[] = (mode === 'any' ? rule?.show_if.any : rule?.show_if.all) ?? [];
  const locked = (field.lead_field === 'email' || field.lead_field === 'phone') && field.required === true;
  const write = (m: 'all' | 'any', list: Condition[]) => onChange(list.length === 0 ? null : { target: field.key, show_if: { [m]: list } });

  if (locked) return <p className="rounded-md border border-border p-3 text-xs text-muted">Esta pergunta é o contato obrigatório do lead e por isso não pode ser condicional.</p>;
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Lógica condicional</legend>
      {idx === 0 ? <p className="text-xs text-muted">A primeira pergunta sempre aparece.</p> : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={rule !== null} onChange={(e) => (e.target.checked ? write('all', [{ field: earlier[earlier.length - 1]!.key, op: 'answered' }]) : onChange(null))} />
            Mostrar esta pergunta só se…
          </label>
          {rule ? (
            <div className="space-y-3">
              <div className="max-w-xs"><label htmlFor="c-mode" className="sr-only">Quando valer</label>
                <Select id="c-mode" value={mode} onChange={(e) => write(e.target.value as 'all' | 'any', conds)}>
                  <option value="all">todas as condições forem verdadeiras</option>
                  <option value="any">qualquer uma das condições for verdadeira</option>
                </Select>
              </div>
              {conds.map((c, i) => {
                const ref = earlier.find((f) => f.key === c.field);
                const op = c.op as Operator;
                const valueless = (VALUELESS as readonly string[]).includes(op);
                const useChoice = (op === 'eq' || op === 'neq') && ref?.options?.length;
                return (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <div><label className="sr-only" htmlFor={`c-f-${i}`}>Pergunta</label>
                      <Select id={`c-f-${i}`} value={c.field} onChange={(e) => write(mode, conds.map((x, j) => (j === i ? { ...x, field: e.target.value, value: undefined } : x)))}>
                        {earlier.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                        {!ref ? <option value={c.field}>{c.field} (inexistente)</option> : null}
                      </Select></div>
                    <div><label className="sr-only" htmlFor={`c-o-${i}`}>Operador</label>
                      <Select id={`c-o-${i}`} value={c.op} onChange={(e) => write(mode, conds.map((x, j) => (j === i ? { field: x.field, op: e.target.value } : x)))}>
                        {CONDITION_OPS.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                      </Select></div>
                    <div>
                      {valueless ? <span className="flex min-h-10 items-center text-xs text-muted">sem valor</span> : useChoice ? (
                        <><label className="sr-only" htmlFor={`c-v-${i}`}>Valor</label>
                          <Select id={`c-v-${i}`} value={String(c.value ?? '')} onChange={(e) => write(mode, conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                            <option value="">Escolha…</option>
                            {ref!.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </Select></>
                      ) : (
                        <><label className="sr-only" htmlFor={`c-v-${i}`}>Valor</label>
                          <Input id={`c-v-${i}`} defaultValue={formatRuleValue(op, c.value)} placeholder={op === 'in' || op === 'not_in' ? 'a, b, c' : 'valor'}
                            onBlur={(e) => { const r = parseRuleValue(op, e.target.value); write(mode, conds.map((x, j) => (j === i ? { ...x, value: r.ok ? r.value : undefined } : x))); }} /></>
                      )}
                    </div>
                    <Button type="button" variant="secondary" onClick={() => write(mode, conds.filter((_, j) => j !== i))} aria-label="Remover condição">✕</Button>
                  </div>
                );
              })}
              <Button type="button" variant="secondary" onClick={() => write(mode, [...conds, { field: earlier[earlier.length - 1]!.key, op: 'answered' }])} disabled={conds.length >= 10}>+ Condição</Button>
              <p className="text-xs text-muted">Só é possível usar perguntas que vêm ANTES desta. Se a condição não for atendida, a pergunta some e a resposta é descartada.</p>
            </div>
          ) : null}
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- etapas
export function StepsEditor({ draft, onChange }: { draft: Draft; onChange: (steps: Draft['schema']['steps']) => void; }) {
  const steps = draft.schema.steps;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Sem etapas, o formulário é uma página só. Com etapas, o visitante avança uma de cada vez. Perguntas sem etapa ficam na primeira.</p>
      <ul className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-sm text-muted">{i + 1}.</span>
            <label className="sr-only" htmlFor={`step-${s.id}`}>Título da etapa {i + 1}</label>
            <Input id={`step-${s.id}`} className="min-w-48 flex-1" value={s.title} maxLength={80} onChange={(e) => onChange(steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))} />
            <button type="button" className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40" disabled={i === 0} onClick={() => onChange(arrayMove(steps, i, i - 1))} aria-label={`Subir etapa ${i + 1}`}>↑</button>
            <button type="button" className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40" disabled={i === steps.length - 1} onClick={() => onChange(arrayMove(steps, i, i + 1))} aria-label={`Descer etapa ${i + 1}`}>↓</button>
            <button type="button" className="min-h-9 min-w-9 rounded border border-border text-danger" onClick={() => onChange(steps.filter((x) => x.id !== s.id))} aria-label={`Remover etapa ${i + 1}`}>✕</button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" disabled={steps.length >= 10} onClick={() => onChange([...steps, { id: uniqueKey('etapa', steps.map((x) => x.id)), title: `Etapa ${steps.length + 1}` }])}>+ Etapa</Button>
    </div>
  );
}
