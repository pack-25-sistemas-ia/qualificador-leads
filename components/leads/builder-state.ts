// Funções PURAS do editor de formulários (testáveis sem navegador): criar/renomear/remover/mover perguntas e manter a lógica condicional coerente.
import { LEAD_FIELDS, type ConsentConfig, type FieldOption, type FieldType, type FormField, type FormSchema, type FormStep, type LogicRule } from '@/lib/leads/formlogic';

export type Meta = { name: string; description: string; thank_you_message: string; success_redirect_url: string };
export type Draft = { meta: Meta; schema: FormSchema; logic: LogicRule[]; consent: ConsentConfig };

export const DEFAULT_CONSENT = 'Concordo em compartilhar meus dados para que a empresa entre em contato comigo, conforme a política de privacidade.';

/** Valor técnico de uma opção a partir do rótulo: minúsculas, sem acento, `_` no lugar de símbolos. */
export function slugifyValue(label: string): string {
  const s = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'opcao';
}

export function uniqueKey(base: string, taken: readonly string[]): string {
  const root = base.replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'campo_').slice(0, 34) || 'campo';
  if (!taken.includes(root)) return root;
  for (let i = 2; i < 1000; i += 1) if (!taken.includes(`${root}_${i}`)) return `${root}_${i}`;
  return `${root}_${Date.now() % 10000}`;
}

export const hasOptions = (t: FieldType) => t === 'select' || t === 'radio' || t === 'multiselect';

export function newField(type: FieldType, taken: readonly string[], step?: string): FormField {
  const f: FormField = { key: uniqueKey('campo', taken), type, label: 'Nova pergunta', required: false };
  if (hasOptions(type)) f.options = [{ value: 'opcao_1', label: 'Opção 1' }, { value: 'opcao_2', label: 'Opção 2' }];
  if (step) f.step = step;
  if (type === 'consent') f.required = true;
  return f;
}

/** Uma opção por linha: «valor | rótulo» ou só o rótulo (o valor é gerado). Repetidos são descartados. */
export function parseOptions(text: string): FieldOption[] {
  const out: FieldOption[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [a, ...rest] = line.split('|');
    const hasValue = rest.length > 0;
    const label = (hasValue ? rest.join('|') : a!).trim().slice(0, 160);
    const value = (hasValue ? slugifyValue(a!.trim()) : slugifyValue(label));
    if (!label || out.some((o) => o.value === value)) continue;
    out.push({ value, label });
  }
  return out;
}
export const formatOptions = (options: FieldOption[] | undefined) => (options ?? []).map((o) => `${o.value} | ${o.label}`).join('\n');

export function renameKey(d: Draft, oldKey: string, newKey: string): Draft {
  if (oldKey === newKey) return d;
  const ren = (k: string) => (k === oldKey ? newKey : k);
  return {
    ...d,
    schema: { ...d.schema, fields: d.schema.fields.map((f) => (f.key === oldKey ? { ...f, key: newKey } : f)) },
    logic: d.logic.map((r) => ({
      target: ren(r.target),
      show_if: {
        ...(r.show_if.all ? { all: r.show_if.all.map((c) => ({ ...c, field: ren(c.field) })) } : {}),
        ...(r.show_if.any ? { any: r.show_if.any.map((c) => ({ ...c, field: ren(c.field) })) } : {}),
      },
    })),
  };
}

export function removeField(d: Draft, key: string): Draft {
  const strip = (list: LogicRule['show_if']['all']) => list?.filter((c) => c.field !== key);
  const logic = d.logic
    .filter((r) => r.target !== key)
    .map((r) => ({ target: r.target, show_if: { ...(r.show_if.all ? { all: strip(r.show_if.all) } : {}), ...(r.show_if.any ? { any: strip(r.show_if.any) } : {}) } }))
    .filter((r) => (r.show_if.all?.length ?? 0) + (r.show_if.any?.length ?? 0) > 0);
  return { ...d, schema: { ...d.schema, fields: d.schema.fields.filter((f) => f.key !== key) }, logic };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

export function setRule(d: Draft, target: string, rule: LogicRule | null): Draft {
  const others = d.logic.filter((r) => r.target !== target);
  return { ...d, logic: rule ? [...others, rule] : others };
}

export function removeStep(d: Draft, id: string): Draft {
  const steps = d.schema.steps.filter((s: FormStep) => s.id !== id);
  return { ...d, schema: { steps, fields: d.schema.fields.map((f) => (f.step === id ? { ...f, step: undefined } : f)) } };
}

/** Forma canônica (sem `undefined`, vazios ou espaços sobrando) para comparar «mudou?» sem falsos positivos. */
export function canonical(d: Draft): string {
  const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined || x === '' ? undefined : x))) as T;
  return JSON.stringify(clean({
    meta: { name: d.meta.name.trim(), description: d.meta.description.trim(), thank_you_message: d.meta.thank_you_message.trim(), success_redirect_url: d.meta.success_redirect_url.trim() },
    schema: d.schema, logic: d.logic, consent: { required: d.consent.required !== false, text: d.consent.text.trim() },
  }));
}

/** Vínculos com o lead ainda disponíveis para uma pergunta (cada um só pode ser usado uma vez; e-mail/telefone exigem o tipo certo). */
export function availableLeadFields(fields: FormField[], current: FormField) {
  const used = new Set(fields.filter((f) => f.key !== current.key && f.lead_field).map((f) => f.lead_field));
  return LEAD_FIELDS.filter((lf) => !used.has(lf) && (lf !== 'email' || current.type === 'email') && (lf !== 'phone' || current.type === 'phone') && (!['name', 'company_name', 'segment'].includes(lf) || ['text', 'select', 'radio', 'textarea'].includes(current.type)));
}
