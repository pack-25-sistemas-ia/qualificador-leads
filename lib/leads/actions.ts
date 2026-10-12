'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionContext, type Context } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, succeed, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { analyzeWithAi, minimizeLead, readAiEnv } from './ai';
import { MAX_IMPORT_BYTES, parseLeadsCsv } from './csv';
import { loadAiConfig, loadLead } from './data';
import { validateDefinition, type ConsentConfig, type FormSchema, type LogicRule } from './formlogic';
import { parseRuleValue } from './rule-value';
import { templateById } from './templates';
import {
  activitySchema, aiConfigSchema, campaignSchema, distributionRuleSchema, formCreateSchema, formMetaSchema, leadCreateSchema, leadEditSchema, normalizedContact,
  ruleSchema, settingsSchema, statusChangeSchema, thresholdsSchema,
} from './validation';

export type SaveResult = ActionState & { id?: string; problems?: string[]; version?: number };

const WRITERS = ['owner', 'admin', 'manager', 'member'] as const;
const MANAGERS = ['owner', 'admin', 'manager'] as const;
const ADMINS = ['owner', 'admin'] as const;
const idSchema = z.uuid();

/**
 * Mensagens escritas por nós no banco (funções lead_*) são seguras e úteis; erros nativos do Postgres (violação de
 * restrição etc.) viram mensagem genérica, sem vazar nomes de tabela ou coluna.
 */
function dbMessage(error: { code?: string; message?: string }, duplicate?: string): string {
  if (error.code === '23505' && duplicate) return duplicate;
  if (error.code === '23503') return 'Este registro está em uso ou referencia algo inexistente.';
  const own = ['23514', '22023', 'P0002', '42501'];
  const msg = error.message ?? '';
  if (own.includes(error.code ?? '') && msg && msg.length <= 200 && !/violat|constraint|relation|column|violação|restrição/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith('.') ? '' : '.');
  }
  return messageForDbError(error);
}

async function withContext(roles: readonly ('owner' | 'admin' | 'manager' | 'member')[]): Promise<{ ctx: Context } | { error: ActionState }> {
  return actionContext(roles);
}
function bust(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}
const org = (ctx: Context) => ctx.membership.organization_id;

// ===================================================================== leads
export async function createLead(input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = leadCreateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.rpc('lead_create', { p_org: org(ctx), p_payload: { ...parsed.data, source: parsed.data.source ?? 'manual' } });
  if (error) return fail(dbMessage(error));
  const r = data as { ok?: boolean; error?: string; lead_id?: string };
  if (!r?.ok) return { ...fail('Já existe um lead com este e-mail ou telefone.'), id: r?.lead_id };
  bust('/leads', '/pipeline', '/dashboard');
  return { ...succeed('Lead cadastrado.'), id: r.lead_id };
}

export async function updateLead(id: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = leadEditSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { email, phone } = normalizedContact(parsed.data);
  const clash = await ctx.supabase.rpc('lead_find_duplicate', { p_org: org(ctx), p_email: email, p_phone: phone, p_except: id });
  if (!clash.error && clash.data) return fail('Já existe outro lead com este e-mail ou telefone.');
  const { name, company_name, segment, notes } = parsed.data;
  const { data, error } = await ctx.supabase.from('leads').update({ name, email, phone, company_name, segment, notes }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para alterar este lead.');
  bust('/leads', `/leads/${id}`, '/pipeline');
  return { ...succeed('Lead atualizado.'), id };
}

export async function archiveLead(id: string, archive: boolean): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('leads').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/leads', `/leads/${id}`, '/pipeline', '/dashboard');
  return succeed(archive ? 'Lead arquivado.' : 'Lead restaurado.');
}

export async function changeStatus(id: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return fail('Status inválido.', fieldErrorsFrom(parsed.error));
  if (parsed.data.status === 'disqualified' && parsed.data.reason === '') return fail('Informe o motivo da desqualificação.', { reason: ['Informe o motivo.'] });
  const { error } = await ctx.supabase.rpc('lead_change_status', { p_lead: id, p_status: parsed.data.status, p_reason: parsed.data.reason || null });
  if (error) return fail(dbMessage(error));
  bust('/leads', `/leads/${id}`, '/pipeline', '/dashboard');
  return succeed('Status atualizado.');
}

export async function assignLead(id: string, userId: string | null): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success || (userId !== null && !idSchema.safeParse(userId).success)) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('lead_assign', { p_lead: id, p_to: userId });
  if (error) return fail(dbMessage(error));
  bust('/leads', `/leads/${id}`, '/pipeline', '/distribuicao', '/dashboard');
  return succeed(userId ? 'Responsável atribuído.' : 'Lead devolvido à fila.');
}

export async function distributePending(): Promise<ActionState & { count?: number }> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase.rpc('lead_distribute_pending', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  const count = Number(data ?? 0);
  bust('/leads', '/pipeline', '/distribuicao', '/dashboard');
  return { ...succeed(count === 0 ? 'Não há leads aguardando distribuição.' : `${count} lead(s) distribuído(s).`), count };
}

export async function rescoreLead(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('lead_rescore', { p_lead: id });
  if (error) return fail(dbMessage(error));
  bust(`/leads/${id}`, '/leads', '/dashboard');
  return succeed('Score recalculado com o modelo vigente. O histórico anterior foi preservado.');
}

export async function rescoreAll(): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase.rpc('lead_rescore_all', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  bust('/leads', '/dashboard', '/qualificacao');
  return succeed(`${Number(data ?? 0)} lead(s) recalculado(s). Os eventos anteriores foram preservados.`);
}

export async function anonymizeLead(id: string): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('lead_anonymize', { p_lead: id });
  if (error) return fail(dbMessage(error));
  bust('/leads', `/leads/${id}`, '/pipeline', '/dashboard');
  return succeed('Dados pessoais removidos. Os números agregados foram mantidos.');
}

export async function applyRetention(): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase.rpc('lead_apply_retention', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  bust('/leads', '/dashboard', '/configuracoes');
  return succeed(`${Number(data ?? 0)} lead(s) anonimizado(s) pela política de retenção. Convertidos são mantidos.`);
}

// ----------------------------------------------------------------- importação
export type ImportReport = ActionState & { created?: number; duplicates?: number; invalid?: number; lines?: string[]; unknownHeaders?: string[]; preview?: boolean };

/** Importação de leads por CSV. A caixa «apenas validar» não grava nada. */
export async function importLeads(_prev: ImportReport, formData: FormData): Promise<ImportReport> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const file = formData.get('file');
  const apply = formData.get('dryRun') !== 'on';
  if (!(file instanceof File) || file.size === 0) return fail('Selecione um arquivo CSV.');
  if (file.size > MAX_IMPORT_BYTES) return fail('Arquivo muito grande (máximo de 1 MB).');
  const parsedCsv = parseLeadsCsv(await file.text());
  if (!parsedCsv.ok) return fail(parsedCsv.error);
  const { data, error } = await ctx.supabase.rpc('lead_import', { p_org: org(ctx), p_rows: parsedCsv.rows, p_apply: apply });
  if (error) return fail(dbMessage(error));
  const r = data as { created: number; duplicates: number; invalid: number; lines: string[] };
  const base = { unknownHeaders: parsedCsv.unknownHeaders, lines: r.lines, duplicates: r.duplicates, invalid: r.invalid, created: r.created };
  if (!apply) return { ...succeed(`Validação concluída: ${r.created} pronto(s) para importar, ${r.duplicates} duplicado(s), ${r.invalid} com erro. Nada foi gravado.`), ...base, preview: true };
  if (r.created === 0) return { ...fail('Nenhuma linha válida para importar.'), ...base };
  logEvent('info', 'leads_imported', { count: r.created });
  bust('/leads', '/pipeline', '/dashboard');
  return { ...succeed(`${r.created} lead(s) importado(s).`), ...base };
}

// ===================================================================== atividades
export async function addActivity(leadId: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(leadId).success) return fail('Registro inválido.');
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { done, ...rest } = parsed.data;
  const { data, error } = await ctx.supabase.from('lead_activities').insert({
    organization_id: org(ctx), lead_id: leadId, type: rest.type, description: rest.description, due_at: rest.due_at, completed_at: done ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) return fail(dbMessage(error));
  bust(`/leads/${leadId}`, '/atividades', '/leads', '/dashboard');
  return { ...succeed(done ? 'Atividade registrada.' : 'Atividade agendada.'), id: (data as { id: string }).id };
}

export async function completeActivity(id: string, leadId: string, done: boolean): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('lead_activities').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust(`/leads/${leadId}`, '/atividades', '/dashboard');
  return succeed(done ? 'Atividade concluída.' : 'Atividade reaberta.');
}

// ===================================================================== formulários
export async function createForm(input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = formCreateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const t = parsed.data.template ? templateById(parsed.data.template) : undefined;
  if (parsed.data.template && !t) return fail('Modelo de formulário inexistente.');
  const { data, error } = await ctx.supabase.rpc('lead_form_create', {
    p_org: org(ctx), p_name: parsed.data.name, p_slug: parsed.data.slug,
    p_schema: t?.schema ?? null, p_logic: t?.logic ?? null, p_consent: t?.consent ?? null,
  });
  if (error) return fail(dbMessage(error, 'Este link já está em uso por outro formulário. Escolha outro.'), error.code === '23505' ? { slug: ['Este link já está em uso.'] } : undefined);
  bust('/formularios');
  return { ...succeed('Formulário criado como rascunho.'), id: data as string };
}

const draftShape = z.object({
  schema: z.object({ steps: z.array(z.object({ id: z.string().max(40), title: z.string().max(120) })).max(20), fields: z.array(z.record(z.string(), z.unknown())).max(80) }),
  logic: z.array(z.record(z.string(), z.unknown())).max(80),
  consent: z.object({ required: z.boolean().optional(), text: z.string().max(1000), policy_url: z.string().max(300).optional() }),
  meta: formMetaSchema,
});

export async function saveFormDraft(formId: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(formId).success) return fail('Registro inválido.');
  const parsed = draftShape.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { schema, logic, consent, meta } = parsed.data;
  const { data, error } = await ctx.supabase.rpc('lead_form_save_draft', {
    p_form: formId,
    p_payload: { schema, logic, consent, name: meta.name, description: meta.description ?? '', thank_you_message: meta.thank_you_message, success_redirect_url: meta.success_redirect_url ?? '' },
  });
  if (error) return fail(dbMessage(error));
  const problems = Array.isArray(data) ? (data as string[]) : [];
  bust('/formularios', `/formularios/${formId}`);
  return { ...succeed(problems.length ? 'Rascunho salvo. Há pontos a corrigir antes de publicar.' : 'Rascunho salvo.'), problems };
}

export async function publishForm(formId: string): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(formId).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.rpc('lead_form_publish', { p_form: formId });
  if (error) return fail(dbMessage(error));
  const r = data as { ok?: boolean; errors?: string[]; version?: number };
  if (!r?.ok) return { ...fail('O formulário ainda não pode ser publicado.'), problems: r?.errors ?? [] };
  bust('/formularios', `/formularios/${formId}`);
  return { ...succeed(`Versão ${r.version} publicada. O link público já usa esta versão.`), version: r.version };
}

export async function archiveForm(formId: string, archive: boolean): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(formId).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('lead_form_archive', { p_form: formId, p_archive: archive });
  if (error) return fail(dbMessage(error));
  bust('/formularios', `/formularios/${formId}`);
  return succeed(archive ? 'Formulário arquivado. O link público saiu do ar.' : 'Formulário restaurado.');
}

export async function duplicateForm(formId: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(formId).success) return fail('Registro inválido.');
  const parsed = formCreateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.rpc('lead_form_duplicate', { p_form: formId, p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) return fail(dbMessage(error, 'Este link já está em uso por outro formulário.'));
  bust('/formularios');
  return { ...succeed('Formulário duplicado como rascunho.'), id: data as string };
}

/** Confere a definição no servidor com o mesmo contrato do banco (retorna problemas para a tela). */
export async function checkFormDefinition(schema: FormSchema, logic: LogicRule[], consent: ConsentConfig): Promise<string[]> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return [];
  return validateDefinition(schema, logic, consent);
}

// ===================================================================== score
export async function startModelDraft(): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase.rpc('lead_model_draft', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  bust('/qualificacao');
  return { ...succeed('Rascunho do modelo pronto. Edite as regras e publique quando terminar.'), id: data as string };
}

export async function saveRule(modelId: string, ruleId: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(modelId).success || (ruleId !== null && !idSchema.safeParse(ruleId).success)) return fail('Registro inválido.');
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parseRuleValue(parsed.data.operator, parsed.data.value);
  if (!v.ok) return fail(v.error, { value: [v.error] });
  const row = { label: parsed.data.label, field_key: parsed.data.field_key, operator: parsed.data.operator, condition_json: v.value ?? null, points: parsed.data.points, enabled: parsed.data.enabled };
  if (ruleId === null) {
    const { data, error } = await ctx.supabase.from('scoring_rules').insert({ organization_id: org(ctx), model_id: modelId, ...row }).select('id').single();
    if (error) return fail(dbMessage(error, 'Regra repetida.'));
    bust('/qualificacao');
    return { ...succeed('Regra adicionada ao rascunho.'), id: (data as { id: string }).id };
  }
  const { data, error } = await ctx.supabase.from('scoring_rules').update(row).eq('id', ruleId).eq('model_id', modelId).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Esta regra não pode ser alterada (só o rascunho é editável).');
  bust('/qualificacao');
  return { ...succeed('Regra atualizada.'), id: ruleId };
}

export async function deleteRule(modelId: string, ruleId: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(ruleId).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.from('scoring_rules').delete().eq('id', ruleId).eq('model_id', modelId);
  if (error) return fail(dbMessage(error));
  bust('/qualificacao');
  return succeed('Regra removida do rascunho.');
}

export async function saveThresholds(modelId: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(modelId).success) return fail('Registro inválido.');
  const parsed = thresholdsSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique as faixas.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.from('scoring_models').update({ thresholds_json: parsed.data }).eq('id', modelId).eq('status', 'draft').select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Só o rascunho pode ser alterado.');
  bust('/qualificacao');
  return succeed('Faixas salvas no rascunho.');
}

export async function publishModel(modelId: string): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(modelId).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.rpc('lead_model_publish', { p_model: modelId });
  if (error) return fail(dbMessage(error));
  const r = data as { ok?: boolean; errors?: string[]; version?: number };
  if (!r?.ok) return { ...fail('O modelo ainda não pode ser publicado.'), problems: r?.errors ?? [] };
  bust('/qualificacao', '/dashboard');
  return { ...succeed(`Modelo versão ${r.version} publicado. Novos leads usam esta versão; os anteriores só mudam se você recalcular.`), version: r.version };
}

/** Cria (se preciso) o rascunho e acrescenta as regras sugeridas pelo modelo de formulário escolhido. */
export async function applySuggestedRules(templateId: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const t = templateById(templateId);
  if (!t) return fail('Modelo inexistente.');
  const { data: draft, error } = await ctx.supabase.rpc('lead_model_draft', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  const rows = t.rules.map((r, i) => ({ organization_id: org(ctx), model_id: draft as string, label: r.label, field_key: r.field_key, operator: r.operator, condition_json: r.condition ?? null, points: r.points, priority: 100 + i, enabled: true }));
  const { error: insErr } = await ctx.supabase.from('scoring_rules').insert(rows);
  if (insErr) return fail(dbMessage(insErr));
  bust('/qualificacao');
  return succeed(`${rows.length} regras sugeridas adicionadas ao rascunho. Ajuste os pontos à sua realidade antes de publicar.`);
}

const simulateSchema = z.object({ answers: z.record(z.string().max(40), z.unknown()) });
export async function simulateScore(modelId: string, input: unknown, formId: string | null = null): Promise<ActionState & { result?: unknown }> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(modelId).success) return fail('Registro inválido.');
  const parsed = simulateSchema.safeParse(input);
  if (!parsed.success || JSON.stringify(parsed.data).length > 20_000) return fail('Respostas inválidas.');
  const { data, error } = await ctx.supabase.rpc('lead_simulate', { p_model: modelId, p_answers: parsed.data.answers, p_form: formId && idSchema.safeParse(formId).success ? formId : null });
  if (error) return fail(dbMessage(error));
  return { ...succeed(), result: data };
}

// ===================================================================== distribuição, campanhas, configurações
export async function setSeller(userId: string, active: boolean): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(userId).success) return fail('Registro inválido.');
  // atualiza e, se ainda não existe, insere (upsert exigiria permissão de alterar a chave, que as colunas protegidas não dão)
  const upd = await ctx.supabase.from('lead_sellers').update({ active }).eq('organization_id', org(ctx)).eq('user_id', userId).select('user_id');
  if (upd.error) return fail(dbMessage(upd.error));
  if (!upd.data?.length) {
    const { error } = await ctx.supabase.from('lead_sellers').insert({ organization_id: org(ctx), user_id: userId, active });
    if (error) return fail(dbMessage(error));
  }
  bust('/distribuicao');
  return succeed(active ? 'Vendedor ativo no rodízio.' : 'Vendedor pausado no rodízio.');
}

export async function removeSeller(userId: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(userId).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.from('lead_sellers').delete().eq('organization_id', org(ctx)).eq('user_id', userId);
  if (error) return fail(dbMessage(error));
  bust('/distribuicao');
  return succeed('Vendedor removido do rodízio.');
}

export async function saveDistributionRule(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = distributionRuleSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parseRuleValue(parsed.data.operator, parsed.data.value);
  if (!v.ok) return fail(v.error, { value: [v.error] });
  const row = { name: parsed.data.name, priority: parsed.data.priority, enabled: parsed.data.enabled, field_key: parsed.data.field_key, operator: parsed.data.operator, condition_json: v.value ?? null, assign_to: parsed.data.assign_to };
  if (id === null) {
    const { data, error } = await ctx.supabase.from('distribution_rules').insert({ organization_id: org(ctx), ...row }).select('id').single();
    if (error) return fail(dbMessage(error));
    bust('/distribuicao');
    return { ...succeed('Regra de distribuição criada.'), id: (data as { id: string }).id };
  }
  const { data, error } = await ctx.supabase.from('distribution_rules').update(row).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/distribuicao');
  return { ...succeed('Regra atualizada.'), id };
}

export async function deleteDistributionRule(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.from('distribution_rules').delete().eq('id', id).eq('organization_id', org(ctx));
  if (error) return fail(dbMessage(error));
  bust('/distribuicao');
  return succeed('Regra removida.');
}

export async function saveCampaign(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const dup = 'Já existe uma campanha com esta chave (utm_campaign).';
  if (id === null) {
    const { data, error } = await ctx.supabase.from('campaigns').insert({ organization_id: org(ctx), ...parsed.data }).select('id').single();
    if (error) return fail(dbMessage(error, dup));
    bust('/campanhas');
    return { ...succeed('Campanha cadastrada.'), id: (data as { id: string }).id };
  }
  const { name, source, medium } = parsed.data;
  const { data, error } = await ctx.supabase.from('campaigns').update({ name, source, medium }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error, dup));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/campanhas');
  return { ...succeed('Campanha atualizada.'), id };
}

export async function saveSettings(input: unknown): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.from('lead_settings').update(parsed.data).eq('organization_id', org(ctx)).select('organization_id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/configuracoes', '/dashboard', '/distribuicao', '/leads');
  return succeed('Configurações salvas.');
}

export async function saveAiConfig(input: unknown): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = aiConfigSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  if (parsed.data.enabled && !readAiEnv()) return fail('Defina AI_API_KEY, AI_BASE_URL e AI_MODEL no ambiente do servidor antes de habilitar (docs/DEPLOYMENT.md).');
  const row = { enabled: parsed.data.enabled, config_json: { daily_limit: parsed.data.daily_limit }, secret_reference: 'AI_API_KEY' };
  const upd = await ctx.supabase.from('integration_configs').update(row).eq('organization_id', org(ctx)).eq('provider', 'ai').select('id');
  if (upd.error) return fail(dbMessage(upd.error));
  if (!upd.data?.length) {
    const { error } = await ctx.supabase.from('integration_configs').insert({ organization_id: org(ctx), provider: 'ai', ...row });
    if (error) return fail(dbMessage(error));
  }
  bust('/configuracoes');
  return succeed(parsed.data.enabled ? 'Análise por IA habilitada.' : 'Análise por IA desabilitada.');
}

// ===================================================================== IA (opcional; nunca altera o score)
export async function analyzeLead(leadId: string): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(leadId).success) return fail('Registro inválido.');
  const cfg = await loadAiConfig(ctx);
  const env = readAiEnv();
  if (!cfg.enabled || !env) return fail('A análise por IA não está habilitada para esta organização.');
  const usage = await ctx.supabase.rpc('lead_ai_usage', { p_org: org(ctx) });
  if (!usage.error && Number(usage.data ?? 0) >= cfg.daily_limit) return fail('Limite diário de análises atingido. Tente novamente amanhã.');
  const detail = await loadLead(ctx, leadId);
  if (!detail) return fail('Lead não encontrado.');
  if (detail.lead.anonymized_at) return fail('Este lead foi anonimizado.');
  const outcome = await analyzeWithAi(minimizeLead(detail), env);
  const { error } = await ctx.supabase.rpc('lead_ai_save', {
    p_lead: leadId, p_provider: outcome.provider, p_model: outcome.model,
    p_analysis: outcome.ok ? outcome.analysis : {}, p_status: outcome.ok ? 'ok' : 'failed', p_error: outcome.ok ? null : outcome.error,
    p_tokens_in: outcome.ok ? outcome.tokensIn : null, p_tokens_out: outcome.ok ? outcome.tokensOut : null,
  });
  logEvent('info', 'ai_analysis', { ok: outcome.ok });
  if (error) return fail(dbMessage(error));
  bust(`/leads/${leadId}`);
  return outcome.ok ? succeed('Análise gerada. Ela é uma sugestão e não altera o score.') : fail(outcome.error);
}
