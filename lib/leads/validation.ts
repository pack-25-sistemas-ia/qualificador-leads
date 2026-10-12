// Validação dos formulários do sistema (cliente e servidor usam o MESMO esquema). A saída já vem normalizada para gravar.
import { z } from 'zod';
import { ACTIVITY_TYPES, LEAD_STATUSES, safeTimezone } from './filters';
import { isOperator, parseRuleValue } from './rule-value';
import { normEmail, normPhone } from './formlogic';

export const text = (min: number, max: number) =>
  z.string().trim().min(min, min <= 1 ? 'Campo obrigatório.' : `Informe ao menos ${min} caracteres.`).max(max, `Máximo de ${max} caracteres.`);
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres.`).transform((v) => (v === '' ? null : v));
export const optionalUuid = z.union([z.literal(''), z.uuid('Seleção inválida.')]).transform((v) => (v === '' ? null : v));

const emailField = z.string().trim().toLowerCase().max(254, 'E-mail muito longo.')
  .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido.');
const phoneField = z.string().trim().max(30, 'Telefone muito longo.')
  .refine((v) => v === '' || (/^[0-9+()\-.\s]{8,30}$/.test(v) && normPhone(v) !== null), 'Telefone inválido (use DDD).');

const intInRange = (min: number, max: number, label: string) =>
  z.string().trim().regex(/^-?\d+$/, `${label}: informe um número inteiro.`).transform(Number).refine((n) => n >= min && n <= max, `${label}: de ${min} a ${max}.`);

// ---------------------------------------------------------------- leads
const leadBase = {
  name: text(1, 160),
  email: emailField,
  phone: phoneField,
  company_name: optionalText(160),
  segment: optionalText(120),
  notes: optionalText(4000),
};
const needContact = (v: { email: string; phone: string }) => v.email !== '' || v.phone !== '';
const CONTACT_MSG = { message: 'Informe e-mail ou telefone.', path: ['email'] };

export const leadCreateSchema = z.object({ ...leadBase, source: optionalText(80) }).refine(needContact, CONTACT_MSG);
export const leadEditSchema = z.object(leadBase).refine(needContact, CONTACT_MSG);
export type LeadCreateInput = z.input<typeof leadCreateSchema>;

/** Linha de e-mail/telefone no formato gravado (normalizado como o banco). */
export function normalizedContact(v: { email: string; phone: string }) {
  return { email: normEmail(v.email), phone: v.phone === '' ? null : normPhone(v.phone) };
}

export const statusChangeSchema = z.object({
  status: z.enum(LEAD_STATUSES, 'Status inválido.'),
  reason: z.string().trim().max(200, 'Máximo de 200 caracteres.'),
});

// ---------------------------------------------------------------- atividades
export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES, 'Tipo inválido.'),
  description: optionalText(2000),
  due_at: z.string().trim().refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Data inválida.').transform((v) => (v === '' ? null : new Date(v).toISOString())),
  done: z.boolean(),
});

// ---------------------------------------------------------------- campanhas
export const campaignSchema = z.object({
  name: text(1, 120),
  source: optionalText(80),
  medium: optionalText(80),
  campaign_key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/, 'Use letras minúsculas, números, ponto, hífen e _ (igual ao utm_campaign).'),
});

// ---------------------------------------------------------------- formulários
export const formCreateSchema = z.object({
  name: text(2, 120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.').min(3, 'Mínimo de 3 caracteres.').max(60, 'Máximo de 60 caracteres.'),
  template: z.string().trim().max(40),
});
export const formMetaSchema = z.object({
  name: text(2, 120),
  description: optionalText(600),
  thank_you_message: text(1, 600),
  success_redirect_url: z.string().trim().max(300, 'URL muito longa.')
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'Use um endereço https:// completo.')
    .transform((v) => (v === '' ? null : v)),
});

// ---------------------------------------------------------------- score
export const ruleSchema = z.object({
  label: text(1, 120),
  field_key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Escolha uma pergunta do formulário.'),
  operator: z.string().refine(isOperator, 'Operador inválido.'),
  value: z.string().max(500, 'Valor muito longo.'),
  points: intInRange(-100, 100, 'Pontos'),
  enabled: z.boolean(),
}).superRefine((v, ctx) => {
  const r = parseRuleValue(v.operator, v.value);
  if (!r.ok) ctx.addIssue({ code: 'custom', path: ['value'], message: r.error });
});
export type RuleInput = z.input<typeof ruleSchema>;

export const thresholdsSchema = z.object({
  warm_min: intInRange(1, 99, 'Morno'),
  hot_min: intInRange(2, 100, 'Quente'),
  qualified_min: intInRange(0, 100, 'Qualificado'),
}).refine((v) => v.warm_min < v.hot_min, { message: 'A faixa morna deve começar antes da quente.', path: ['hot_min'] });

// ---------------------------------------------------------------- distribuição
export const distributionRuleSchema = z.object({
  name: text(1, 120),
  priority: intInRange(0, 10000, 'Prioridade'),
  field_key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Informe a chave da pergunta.'),
  operator: z.string().refine(isOperator, 'Operador inválido.'),
  value: z.string().max(500, 'Valor muito longo.'),
  assign_to: z.uuid('Escolha o vendedor.'),
  enabled: z.boolean(),
}).superRefine((v, ctx) => {
  const r = parseRuleValue(v.operator, v.value);
  if (!r.ok) ctx.addIssue({ code: 'custom', path: ['value'], message: r.error });
});

// ---------------------------------------------------------------- configurações
export const DUPLICATE_POLICIES = ['link', 'flag', 'review'] as const;
export const ASSIGNMENT_STRATEGIES = ['manual', 'round_robin', 'criteria'] as const;
export const DUPLICATE_LABELS: Record<(typeof DUPLICATE_POLICIES)[number], string> = {
  link: 'Ligar à pessoa existente (recomendado)', flag: 'Criar novo lead marcado como duplicado', review: 'Criar novo lead e colocar na fila de revisão',
};
export const STRATEGY_LABELS: Record<(typeof ASSIGNMENT_STRATEGIES)[number], string> = {
  manual: 'Manual (a gestão atribui)', round_robin: 'Rodízio entre vendedores ativos', criteria: 'Por critérios (com rodízio como reserva)',
};

export const settingsSchema = z.object({
  timezone: z.string().trim().min(3).max(60).transform((v) => safeTimezone(v)),
  duplicate_policy: z.enum(DUPLICATE_POLICIES),
  assignment_strategy: z.enum(ASSIGNMENT_STRATEGIES),
  criteria_fallback_round_robin: z.boolean(),
  alert_no_contact_hours: intInRange(1, 720, 'Horas sem contato'),
  privacy_policy_url: z.string().trim().max(300, 'URL muito longa.')
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'Use um endereço https:// completo.')
    .transform((v) => (v === '' ? null : v)),
  retention_days: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 30 && Number(v) <= 3650), 'Informe de 30 a 3650 dias ou deixe vazio.')
    .transform((v) => (v === '' ? null : Number(v))),
});

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  daily_limit: intInRange(1, 500, 'Limite diário'),
});

export { LEAD_STATUSES };
