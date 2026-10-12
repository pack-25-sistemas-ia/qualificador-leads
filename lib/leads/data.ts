import 'server-only';
import type { Context } from '@/lib/auth/session';
import { safeTimezone, type LeadStatus } from './filters';
import type { ConsentConfig, FormSchema, LogicRule } from './formlogic';
import type { ScoreRule } from './scoring';

// ------------------------------------------------------------------ tipos das linhas
export type Person = { user_id: string; label: string };
export type SettingsRow = {
  organization_id: string; timezone: string; duplicate_policy: 'link' | 'flag' | 'review'; assignment_strategy: 'manual' | 'round_robin' | 'criteria';
  criteria_fallback_round_robin: boolean; alert_no_contact_hours: number; privacy_policy_url: string | null; retention_days: number | null;
};
export type LeadRow = {
  id: string; name: string; email: string | null; phone: string | null; company_name: string | null; segment: string | null; status: LeadStatus;
  qualification: 'cold' | 'warm' | 'hot' | null; qualified: boolean | null; current_score: number | null; assigned_to: string | null; source: string | null; medium: string | null;
  campaign_id: string | null; first_form_id: string | null; duplicate_of: string | null; needs_review: boolean; disqualify_reason: string | null; notes: string | null;
  converted_at: string | null; first_contact_at: string | null; archived_at: string | null; anonymized_at: string | null; created_at: string; updated_at: string;
};
export const LEAD_COLUMNS = 'id, name, email, phone, company_name, segment, status, qualification, qualified, current_score, assigned_to, source, medium, campaign_id, first_form_id, duplicate_of, needs_review, disqualify_reason, notes, converted_at, first_contact_at, archived_at, anonymized_at, created_at, updated_at';

export type FormRow = {
  id: string; name: string; slug: string; description: string | null; status: 'draft' | 'published' | 'archived'; current_published_version_id: string | null;
  thank_you_message: string; success_redirect_url: string | null; created_at: string; updated_at: string;
};
export type FormVersionRow = {
  id: string; form_id: string; version_number: number; schema_json: FormSchema; ui_schema_json: Record<string, unknown>; conditional_logic_json: LogicRule[];
  consent_config_json: ConsentConfig; published_at: string | null; created_at: string;
};
export type CampaignRow = { id: string; name: string; source: string | null; medium: string | null; campaign_key: string; created_at: string };
export type ModelRow = { id: string; name: string; version: number; status: 'draft' | 'published' | 'archived'; thresholds_json: { warm_min: number; hot_min: number; qualified_min: number }; published_at: string | null; created_at: string };
export type RuleRow = { id: string; model_id: string; label: string; field_key: string; operator: string; condition_json: unknown; points: number; priority: number; enabled: boolean };
export type SellerRow = { user_id: string; active: boolean };
export type DistributionRuleRow = { id: string; name: string; priority: number; enabled: boolean; field_key: string; operator: string; condition_json: unknown; assign_to: string };
export type ActivityRow = { id: string; lead_id: string; user_id: string | null; type: string; description: string | null; due_at: string | null; completed_at: string | null; created_at: string };
export type ScoreEventRow = {
  id: number; score: number; classification: 'cold' | 'warm' | 'hot'; qualified: boolean; evaluated_at: string; scoring_model_id: string | null; submission_id: string | null;
  explanation_json: { raw_total?: number; applied?: Array<{ rule_id?: string; label: string; field_key: string; points: number }>; missing?: string[]; model_version?: number; model_name?: string };
};
export type HistoryRow = { id: number; previous_status: LeadStatus | null; new_status: LeadStatus; reason: string | null; changed_by: string | null; changed_at: string };
export type AssignmentRow = { id: number; assigned_to: string | null; assigned_by: string | null; assignment_method: string; assigned_at: string };
export type SubmissionRow = { id: string; form_id: string; form_version_id: string; answers_json: Record<string, unknown>; consent_given: boolean; is_duplicate: boolean; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; landing_page: string | null; submitted_at: string };
export type AiAnalysisRow = { id: string; provider: string; model: string; analysis_json: Record<string, unknown>; status: 'ok' | 'failed'; error_message: string | null; created_at: string };

export const PAGE_SIZE = 20;

export function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** Termo de busca seguro para filtros PostgREST: só letras, números, espaço e . _ - @. Remove vírgula, parênteses, asteriscos e aspas. */
export function searchToken(q: string | string[] | undefined): string {
  const v = (Array.isArray(q) ? q[0] : q) ?? '';
  return v.normalize('NFC').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60);
}

export const labelMap = (people: Person[]) => new Map(people.map((p) => [p.user_id, p.label]));
export const personOptions = (people: Person[]) => people.map((p) => ({ value: p.user_id, label: p.label }));

const DEFAULT_SETTINGS: Omit<SettingsRow, 'organization_id'> = {
  timezone: 'America/Sao_Paulo', duplicate_policy: 'link', assignment_strategy: 'manual', criteria_fallback_round_robin: true, alert_no_contact_hours: 24, privacy_policy_url: null, retention_days: null,
};

export async function loadSettings(ctx: Context): Promise<SettingsRow> {
  const org = ctx.membership.organization_id;
  const { data } = await ctx.supabase.from('lead_settings')
    .select('organization_id, timezone, duplicate_policy, assignment_strategy, criteria_fallback_round_robin, alert_no_contact_hours, privacy_policy_url, retention_days')
    .eq('organization_id', org).maybeSingle();
  const row = (data ?? { organization_id: org, ...DEFAULT_SETTINGS }) as SettingsRow;
  return { ...row, timezone: safeTimezone(row.timezone) };
}

export async function loadPeople(ctx: Context): Promise<Person[]> {
  const { data } = await ctx.supabase.rpc('lead_user_labels', { p_org: ctx.membership.organization_id });
  return ((data ?? []) as Person[]).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export async function listCampaigns(ctx: Context): Promise<CampaignRow[]> {
  const { data } = await ctx.supabase.from('campaigns').select('id, name, source, medium, campaign_key, created_at').eq('organization_id', ctx.membership.organization_id).order('name');
  return (data ?? []) as CampaignRow[];
}

export async function listForms(ctx: Context): Promise<FormRow[]> {
  const { data } = await ctx.supabase.from('lead_forms')
    .select('id, name, slug, description, status, current_published_version_id, thank_you_message, success_redirect_url, created_at, updated_at')
    .eq('organization_id', ctx.membership.organization_id).order('created_at', { ascending: false });
  return (data ?? []) as FormRow[];
}

export async function loadForm(ctx: Context, id: string): Promise<{ form: FormRow; versions: FormVersionRow[] } | null> {
  const org = ctx.membership.organization_id;
  const { data: form } = await ctx.supabase.from('lead_forms')
    .select('id, name, slug, description, status, current_published_version_id, thank_you_message, success_redirect_url, created_at, updated_at').eq('id', id).eq('organization_id', org).maybeSingle();
  if (!form) return null;
  const { data: versions } = await ctx.supabase.from('lead_form_versions')
    .select('id, form_id, version_number, schema_json, ui_schema_json, conditional_logic_json, consent_config_json, published_at, created_at')
    .eq('form_id', id).order('version_number', { ascending: false });
  return { form: form as FormRow, versions: (versions ?? []) as FormVersionRow[] };
}

/** Respostas por formulário (contagem de envios por form, para a lista). */
export async function submissionCounts(ctx: Context): Promise<Map<string, number>> {
  const { data } = await ctx.supabase.from('form_submissions').select('form_id').eq('organization_id', ctx.membership.organization_id).limit(20000);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ form_id: string }>) m.set(r.form_id, (m.get(r.form_id) ?? 0) + 1);
  return m;
}

export async function loadModels(ctx: Context): Promise<{ published: ModelRow | null; draft: ModelRow | null; rulesByModel: Map<string, RuleRow[]> }> {
  const org = ctx.membership.organization_id;
  const { data: models } = await ctx.supabase.from('scoring_models').select('id, name, version, status, thresholds_json, published_at, created_at').eq('organization_id', org).neq('status', 'archived');
  const list = (models ?? []) as ModelRow[];
  const ids = list.map((m) => m.id);
  const { data: rules } = ids.length
    ? await ctx.supabase.from('scoring_rules').select('id, model_id, label, field_key, operator, condition_json, points, priority, enabled').in('model_id', ids).order('priority').order('created_at')
    : { data: [] };
  const rulesByModel = new Map<string, RuleRow[]>();
  for (const r of (rules ?? []) as RuleRow[]) rulesByModel.set(r.model_id, [...(rulesByModel.get(r.model_id) ?? []), r]);
  return { published: list.find((m) => m.status === 'published') ?? null, draft: list.find((m) => m.status === 'draft') ?? null, rulesByModel };
}

export const toScoreRules = (rules: RuleRow[]): ScoreRule[] => rules.map((r) => ({ id: r.id, label: r.label, field_key: r.field_key, operator: r.operator, condition: r.condition_json, points: r.points, enabled: r.enabled }));

export async function listSellers(ctx: Context): Promise<SellerRow[]> {
  const { data } = await ctx.supabase.from('lead_sellers').select('user_id, active').eq('organization_id', ctx.membership.organization_id);
  return (data ?? []) as SellerRow[];
}

export async function listDistributionRules(ctx: Context): Promise<DistributionRuleRow[]> {
  const { data } = await ctx.supabase.from('distribution_rules').select('id, name, priority, enabled, field_key, operator, condition_json, assign_to').eq('organization_id', ctx.membership.organization_id).order('priority').order('created_at');
  return (data ?? []) as DistributionRuleRow[];
}

export async function listDisqualificationReasons(ctx: Context): Promise<string[]> {
  const { data } = await ctx.supabase.from('disqualification_reasons').select('name').eq('organization_id', ctx.membership.organization_id).eq('active', true).order('name');
  return ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
}

/** Origens já usadas (para o filtro). */
export async function listSources(ctx: Context): Promise<string[]> {
  const { data } = await ctx.supabase.from('leads').select('source').eq('organization_id', ctx.membership.organization_id).is('archived_at', null).limit(5000);
  return [...new Set(((data ?? []) as Array<{ source: string | null }>).map((r) => r.source ?? 'direto'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export type LeadQuery = {
  q: string; status: string; classification: string; source: string; campaign: string; seller: string; unassigned: boolean; review: boolean; archived: boolean; page: number;
};

export async function listLeads(ctx: Context, f: LeadQuery): Promise<{ rows: LeadRow[]; total: number }> {
  let query = ctx.supabase.from('leads').select(LEAD_COLUMNS, { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  query = f.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (f.status) query = query.eq('status', f.status);
  if (f.classification) query = query.eq('qualification', f.classification);
  if (f.source) query = f.source === 'direto' ? query.is('source', null) : query.eq('source', f.source);
  if (f.campaign) query = query.eq('campaign_id', f.campaign);
  if (f.seller) query = query.eq('assigned_to', f.seller);
  if (f.unassigned) query = query.is('assigned_to', null);
  if (f.review) query = query.eq('needs_review', true);
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    const parts = [`name.ilike.%${f.q}%`, `email.ilike.%${f.q}%`, `company_name.ilike.%${f.q}%`];
    if (digits.length >= 4) parts.push(`phone.ilike.%${digits}%`);
    query = query.or(parts.join(','));
  }
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 };
}

export type LeadDetail = {
  lead: LeadRow;
  submission: SubmissionRow | null;
  schema: FormSchema | null;
  scores: ScoreEventRow[];
  activities: ActivityRow[];
  history: HistoryRow[];
  assignments: AssignmentRow[];
  analyses: AiAnalysisRow[];
  campaign: CampaignRow | null;
  form: { id: string; name: string } | null;
  duplicates: Array<{ id: string; name: string; created_at: string }>;
};

export async function loadLead(ctx: Context, id: string): Promise<LeadDetail | null> {
  const db = ctx.supabase;
  const org = ctx.membership.organization_id;
  const { data: lead } = await db.from('leads').select(LEAD_COLUMNS).eq('id', id).eq('organization_id', org).maybeSingle();
  if (!lead) return null;
  const l = lead as LeadRow;
  const [sub, scores, acts, hist, assigns, ai, camp, dups] = await Promise.all([
    db.from('form_submissions').select('id, form_id, form_version_id, answers_json, consent_given, is_duplicate, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, submitted_at').eq('lead_id', id).order('submitted_at', { ascending: false }).limit(1),
    db.from('lead_score_events').select('id, score, classification, qualified, evaluated_at, scoring_model_id, submission_id, explanation_json').eq('lead_id', id).order('id', { ascending: false }).limit(20),
    db.from('lead_activities').select('id, lead_id, user_id, type, description, due_at, completed_at, created_at').eq('lead_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('lead_status_history').select('id, previous_status, new_status, reason, changed_by, changed_at').eq('lead_id', id).order('id', { ascending: false }).limit(100),
    db.from('lead_assignments').select('id, assigned_to, assigned_by, assignment_method, assigned_at').eq('lead_id', id).order('id', { ascending: false }).limit(50),
    db.from('ai_analyses').select('id, provider, model, analysis_json, status, error_message, created_at').eq('lead_id', id).order('created_at', { ascending: false }).limit(5),
    l.campaign_id ? db.from('campaigns').select('id, name, source, medium, campaign_key, created_at').eq('id', l.campaign_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('leads').select('id, name, created_at').eq('duplicate_of', id).limit(10),
  ]);
  const submission = ((sub.data ?? []) as SubmissionRow[])[0] ?? null;
  let schema: FormSchema | null = null;
  let form: { id: string; name: string } | null = null;
  if (submission) {
    const [v, f] = await Promise.all([
      db.from('lead_form_versions').select('schema_json').eq('id', submission.form_version_id).maybeSingle(),
      db.from('lead_forms').select('id, name').eq('id', submission.form_id).maybeSingle(),
    ]);
    schema = (v.data as { schema_json: FormSchema } | null)?.schema_json ?? null;
    form = (f.data as { id: string; name: string } | null) ?? null;
  }
  return {
    lead: l, submission, schema, form,
    scores: (scores.data ?? []) as ScoreEventRow[], activities: (acts.data ?? []) as ActivityRow[], history: (hist.data ?? []) as HistoryRow[],
    assignments: (assigns.data ?? []) as AssignmentRow[], analyses: (ai.data ?? []) as AiAnalysisRow[],
    campaign: (camp.data as CampaignRow | null) ?? null, duplicates: (dups.data ?? []) as Array<{ id: string; name: string; created_at: string }>,
  };
}

/** Leads do quadro (pipeline): os mais recentes, limitados para manter a tela leve. */
export const BOARD_LIMIT = 300;
export async function listBoardLeads(ctx: Context, seller: string | null): Promise<{ rows: LeadRow[]; truncated: boolean }> {
  let q = ctx.supabase.from('leads').select(LEAD_COLUMNS).eq('organization_id', ctx.membership.organization_id).is('archived_at', null);
  if (seller) q = q.eq('assigned_to', seller);
  const { data } = await q.order('created_at', { ascending: false }).limit(BOARD_LIMIT + 1);
  const rows = (data ?? []) as LeadRow[];
  return { rows: rows.slice(0, BOARD_LIMIT), truncated: rows.length > BOARD_LIMIT };
}

export type ActivityListRow = ActivityRow & { lead_name: string };
export async function listOpenActivities(ctx: Context, mine: boolean): Promise<ActivityListRow[]> {
  let q = ctx.supabase.from('lead_activities').select('id, lead_id, user_id, type, description, due_at, completed_at, created_at').eq('organization_id', ctx.membership.organization_id).is('completed_at', null);
  if (mine) q = q.eq('user_id', ctx.user.id);
  const { data } = await q.order('due_at', { ascending: true, nullsFirst: false }).limit(200);
  const acts = (data ?? []) as ActivityRow[];
  const ids = [...new Set(acts.map((a) => a.lead_id))];
  const { data: leads } = ids.length ? await ctx.supabase.from('leads').select('id, name').in('id', ids) : { data: [] };
  const names = new Map(((leads ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
  return acts.map((a) => ({ ...a, lead_name: names.get(a.lead_id) ?? 'Lead' }));
}

export async function aiUsageToday(ctx: Context): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await ctx.supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.membership.organization_id).gte('created_at', since);
  return count ?? 0;
}

export async function loadAiConfig(ctx: Context): Promise<{ enabled: boolean; daily_limit: number }> {
  const { data } = await ctx.supabase.from('integration_configs').select('enabled, config_json').eq('organization_id', ctx.membership.organization_id).eq('provider', 'ai').maybeSingle();
  const cfg = (data?.config_json ?? {}) as { daily_limit?: number };
  return { enabled: Boolean(data?.enabled), daily_limit: Number.isInteger(cfg.daily_limit) && (cfg.daily_limit as number) > 0 ? (cfg.daily_limit as number) : 20 };
}

/** Perguntas dos formulários (para as regras de score) e definições (para o simulador): a versão mais recente de cada formulário não arquivado. */
export async function loadQuestions(ctx: Context): Promise<{ questions: Array<{ key: string; label: string; form: string }>; forms: Array<{ id: string; name: string; schema: FormSchema; logic: LogicRule[] }> }> {
  const forms = (await listForms(ctx)).filter((f) => f.status !== 'archived');
  if (forms.length === 0) return { questions: [], forms: [] };
  const { data } = await ctx.supabase.from('lead_form_versions').select('form_id, version_number, schema_json, conditional_logic_json').in('form_id', forms.map((f) => f.id)).order('version_number', { ascending: false });
  const latest = new Map<string, { schema_json: FormSchema; conditional_logic_json: LogicRule[] }>();
  for (const v of (data ?? []) as Array<{ form_id: string; schema_json: FormSchema; conditional_logic_json: LogicRule[] }>) if (!latest.has(v.form_id)) latest.set(v.form_id, v);
  const questions = new Map<string, { key: string; label: string; form: string }>();
  const defs: Array<{ id: string; name: string; schema: FormSchema; logic: LogicRule[] }> = [];
  for (const f of forms) {
    const v = latest.get(f.id);
    if (!v) continue;
    defs.push({ id: f.id, name: f.name, schema: v.schema_json, logic: v.conditional_logic_json });
    for (const q of v.schema_json.fields) if (q.type !== 'consent' && !questions.has(q.key)) questions.set(q.key, { key: q.key, label: q.label, form: f.name });
  }
  return { questions: [...questions.values()], forms: defs };
}
