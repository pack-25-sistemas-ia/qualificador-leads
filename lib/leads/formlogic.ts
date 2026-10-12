// Contrato do formulário e seu interpretador no navegador/servidor de aplicação. A VALIDAÇÃO DEFINITIVA acontece no banco
// (public.lead_validate_form_def / lead_validate_answers); este espelho dá feedback imediato no editor e na página pública
// e passa nas mesmas fixtures (tests/fixtures/form-cases.json). Nada aqui executa código vindo do usuário.
import { evalCondition, isAnswered, tryNumeric } from './scoring';

export const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'currency', 'select', 'radio', 'checkbox', 'date', 'multiselect', 'hidden', 'consent'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto curto', textarea: 'Texto longo', email: 'E-mail', phone: 'Telefone', number: 'Número', currency: 'Valor em reais', select: 'Lista de opções',
  radio: 'Escolha única', checkbox: 'Caixa de marcação', date: 'Data', multiselect: 'Múltipla escolha', hidden: 'Campo oculto', consent: 'Consentimento',
};
export const LEAD_FIELDS = ['name', 'email', 'phone', 'company_name', 'segment'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export const LEAD_FIELD_LABELS: Record<LeadField, string> = { name: 'Nome do lead', email: 'E-mail do lead', phone: 'Telefone do lead', company_name: 'Empresa do lead', segment: 'Segmento do lead' };

export type FieldOption = { value: string; label: string };
export type FormField = {
  key: string; type: FieldType; label: string; required?: boolean; options?: FieldOption[]; step?: string; lead_field?: LeadField;
  min?: number; max?: number; max_length?: number; help?: string;
};
export type FormStep = { id: string; title: string };
export type FormSchema = { steps: FormStep[]; fields: FormField[] };
export type Condition = { field: string; op: string; value?: unknown };
export type LogicRule = { target: string; show_if: { all?: Condition[]; any?: Condition[] } };
export type ConsentConfig = { required?: boolean; text: string; policy_url?: string };

export const CONDITION_OPS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_true', 'answered', 'not_answered'] as const;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const STEP_RE = /^[a-z][a-z0-9_]{0,29}$/;

// ---------------------------------------------------------------- normalização (igual ao banco)
export function normEmail(t: string | null | undefined): string | null {
  const v = (t ?? '').trim().toLowerCase();
  return v === '' ? null : v;
}
/** Telefone: só dígitos; 10 ou 11 dígitos assume Brasil (+55); aceita 8 a 15 dígitos; senão nulo. */
export function normPhone(t: string | null | undefined): string | null {
  let d = (t ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

// ---------------------------------------------------------------- validação da definição (publicação)
export function validateDefinition(schema: FormSchema, logic: LogicRule[], consent: ConsentConfig | null | undefined): string[] {
  const errs: string[] = [];
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.fields)) return ['Esquema inválido.'];
  const fields = schema.fields;
  if (fields.length === 0) errs.push('Adicione ao menos uma pergunta.');
  if (fields.length > 60) errs.push('No máximo 60 perguntas.');
  const steps = Array.isArray(schema.steps) ? schema.steps : [];
  const stepIds: string[] = [];
  if (!Array.isArray(schema.steps ?? []) || steps.length > 10) errs.push('No máximo 10 etapas.');
  else {
    for (const s of steps) {
      if (!STEP_RE.test(s?.id ?? '') || !(s.title?.length >= 1 && s.title.length <= 80) || stepIds.includes(s.id)) errs.push('Etapa inválida ou repetida.');
      else stepIds.push(s.id);
    }
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  let hasContact = false;
  fields.forEach((f, idx) => {
    const k = f?.key;
    if (typeof k !== 'string' || !KEY_RE.test(k)) { errs.push(`Pergunta ${idx + 1}: chave inválida (use letras minúsculas, números e _).`); return; }
    if (keys.includes(k)) { errs.push(`Chave repetida: ${k}.`); return; }
    keys.push(k);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) { errs.push(`Pergunta ${k}: tipo inválido.`); return; }
    if (!(typeof f.label === 'string' && f.label.length >= 1 && f.label.length <= 200)) errs.push(`Pergunta ${k}: informe o rótulo (até 200 caracteres).`);
    if (f.step !== undefined && stepIds.length > 0 && !stepIds.includes(f.step)) errs.push(`Pergunta ${k}: etapa inexistente.`);
    if (f.help !== undefined && f.help.length > 400) errs.push(`Pergunta ${k}: ajuda muito longa.`);
    if (f.type === 'select' || f.type === 'radio' || f.type === 'multiselect') {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 50) errs.push(`Pergunta ${k}: informe de 2 a 50 opções.`);
      else {
        const vals: string[] = [];
        for (const o of opts) {
          if (!(o?.value?.length >= 1 && o.value.length <= 80) || !(o?.label?.length >= 1 && o.label.length <= 160) || vals.includes(o.value)) { errs.push(`Pergunta ${k}: opção inválida ou repetida.`); break; }
          vals.push(o.value);
        }
      }
    }
    const lf = f.lead_field;
    if (lf !== undefined) {
      if (!(LEAD_FIELDS as readonly string[]).includes(lf)) errs.push(`Pergunta ${k}: vínculo inválido com o lead.`);
      if (seen.has(lf)) errs.push(`Mais de uma pergunta vinculada a «${lf}».`);
      seen.add(lf);
      if ((lf === 'email' || lf === 'phone') && f.required === true) hasContact = true;
      if (lf === 'email' && f.type !== 'email') errs.push(`Pergunta ${k}: o vínculo «email» exige o tipo e-mail.`);
      if (lf === 'phone' && f.type !== 'phone') errs.push(`Pergunta ${k}: o vínculo «phone» exige o tipo telefone.`);
    }
  });
  if (!hasContact) errs.push('O formulário precisa de uma pergunta OBRIGATÓRIA de e-mail ou telefone vinculada ao lead.');

  if (!Array.isArray(logic) || logic.length > 60) errs.push('Lógica condicional inválida.');
  else {
    for (const rule of logic) {
      const k = rule?.target;
      if (!k || !keys.includes(k)) { errs.push(`Condição para pergunta inexistente: ${k ?? '?'}.`); continue; }
      const earlier = keys.slice(0, keys.indexOf(k));
      const f = fields.find((x) => x.key === k);
      if (f && (f.lead_field === 'email' || f.lead_field === 'phone') && f.required === true) errs.push(`A pergunta ${k} (contato obrigatório) não pode ser condicional.`);
      for (const branch of ['all', 'any'] as const) {
        const list = rule.show_if?.[branch];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.length < 1 || list.length > 10) { errs.push(`Condição de ${k} inválida.`); continue; }
        for (const c of list) {
          if (!(CONDITION_OPS as readonly string[]).includes(c?.op ?? '')) errs.push(`Condição de ${k}: operador inválido.`);
          else if (!earlier.includes(c.field)) errs.push(`Condição de ${k}: só pode depender de perguntas ANTERIORES.`);
        }
      }
      if (rule.show_if?.all === undefined && rule.show_if?.any === undefined) errs.push(`Condição de ${k} sem regras.`);
    }
  }
  if (!consent || typeof consent !== 'object' || !(consent.text?.length >= 1 && consent.text.length <= 600)) errs.push('Informe o texto do consentimento/aviso de privacidade (até 600 caracteres).');
  return errs;
}

// ---------------------------------------------------------------- visibilidade e validação das respostas
type Answers = Record<string, unknown>;

function ruleVisible(rule: LogicRule, clean: Answers): boolean {
  let allOk = true;
  let anyOk = false;
  const test = (c: Condition) => evalCondition(c.op, clean[c.field], c.value) === true;
  if (rule.show_if.all !== undefined) for (const c of rule.show_if.all) if (!test(c)) allOk = false;
  if (rule.show_if.any !== undefined) {
    for (const c of rule.show_if.any) if (test(c)) anyOk = true;
    if (!anyOk) allOk = false;
  }
  return allOk;
}

export type ValidationResult = { clean: Answers; hidden: string[]; errors: Record<string, string> };

/** Valida respostas contra o contrato. Campos ocultos pela lógica são DESCARTADOS (a resposta de um campo que não aparece não é confiada). */
export function validateAnswers(schema: FormSchema, logic: LogicRule[], answers: unknown): ValidationResult {
  const clean: Answers = {};
  const hidden: string[] = [];
  const errors: Record<string, string> = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || JSON.stringify(answers).length > 32768) return { clean, hidden, errors: { _: 'Dados inválidos.' } };
  const input = answers as Answers;
  for (const f of schema.fields) {
    const k = f.key;
    const t = f.type;
    const req = f.required === true || t === 'consent';
    const visible = logic.filter((r) => r.target === k).every((r) => ruleVisible(r, clean));
    if (!visible) { hidden.push(k); continue; }
    const ans = input[k];
    const empty = ans === undefined || ans === null || (typeof ans === 'string' && ans.trim() === '') || (Array.isArray(ans) && ans.length === 0);
    if (empty) {
      if (req) errors[k] = 'Campo obrigatório.';
      continue;
    }
    switch (t) {
      case 'text': case 'textarea': case 'hidden': {
        if (typeof ans !== 'string') { errors[k] = 'Resposta inválida.'; break; }
        const txt = ans.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        const mx = Math.min(f.max_length ?? (t === 'textarea' ? 2000 : 200), 4000);
        if ([...txt].length > mx) { errors[k] = `Máximo de ${mx} caracteres.`; break; }
        clean[k] = txt;
        break;
      }
      case 'email': {
        const txt = typeof ans === 'string' ? ans.trim().toLowerCase() : '';
        if (typeof ans !== 'string' || txt.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(txt)) { errors[k] = 'E-mail inválido.'; break; }
        clean[k] = txt;
        break;
      }
      case 'phone': {
        if (typeof ans !== 'string' || !/^[0-9+()\-.\s]{8,25}$/.test(ans) || normPhone(ans) === null) { errors[k] = 'Telefone inválido.'; break; }
        clean[k] = ans;
        break;
      }
      case 'number': case 'currency': {
        const n = tryNumeric(ans);
        if (n === null || Math.abs(n) > 1e12 || (t === 'currency' && n < 0)) { errors[k] = 'Número inválido.'; break; }
        if (f.min !== undefined && n < f.min) { errors[k] = `Valor mínimo: ${f.min}.`; break; }
        if (f.max !== undefined && n > f.max) { errors[k] = `Valor máximo: ${f.max}.`; break; }
        clean[k] = Math.round(n * 100) / 100;
        break;
      }
      case 'select': case 'radio': {
        if (typeof ans !== 'string' || !(f.options ?? []).some((o) => o.value === ans)) { errors[k] = 'Escolha uma opção válida.'; break; }
        clean[k] = ans;
        break;
      }
      case 'multiselect': {
        if (!Array.isArray(ans) || ans.length > 20) { errors[k] = 'Escolha opções válidas.'; break; }
        const vals: string[] = [];
        let ok = true;
        for (const el of ans) {
          if (typeof el !== 'string' || !(f.options ?? []).some((o) => o.value === el)) { ok = false; break; }
          if (!vals.includes(el)) vals.push(el);
        }
        if (!ok) { errors[k] = 'Escolha opções válidas.'; break; }
        clean[k] = vals;
        break;
      }
      case 'checkbox': case 'consent': {
        if (typeof ans !== 'boolean') { errors[k] = 'Resposta inválida.'; break; }
        if (req && !ans) { errors[k] = 'Marque esta opção para continuar.'; break; }
        clean[k] = ans;
        break;
      }
      case 'date': {
        const ok = typeof ans === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ans) && new Date(`${ans}T00:00:00Z`).toISOString().slice(0, 10) === ans;
        if (!ok) { errors[k] = 'Data inválida.'; break; }
        clean[k] = ans;
        break;
      }
    }
  }
  return { clean, hidden, errors };
}

// ---------------------------------------------------------------- uso na página pública (etapas e visibilidade em tempo real)
/** Campos visíveis AGORA dado o que já foi respondido (ordem do formulário). */
export function visibleFields(schema: FormSchema, logic: LogicRule[], answers: Answers): FormField[] {
  const seenAnswers: Answers = {};
  const out: FormField[] = [];
  for (const f of schema.fields) {
    const visible = logic.filter((r) => r.target === f.key).every((r) => ruleVisible(r, seenAnswers));
    if (!visible) continue;
    out.push(f);
    if (isAnswered(answers[f.key]) || typeof answers[f.key] === 'boolean') seenAnswers[f.key] = answers[f.key];
  }
  return out;
}

/** Etapas do formulário (se não houver etapas definidas, uma única etapa com todas as perguntas). */
export function stepsOf(schema: FormSchema): FormStep[] {
  return schema.steps.length > 0 ? schema.steps : [{ id: '_', title: '' }];
}
export function fieldsOfStep(fields: FormField[], schema: FormSchema, stepId: string): FormField[] {
  if (schema.steps.length === 0) return fields;
  const firstId = schema.steps[0]!.id;
  return fields.filter((f) => (f.step && schema.steps.some((s) => s.id === f.step) ? f.step : firstId) === stepId);
}
