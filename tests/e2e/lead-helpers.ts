import type { Browser, BrowserContext, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, rest, uiLogin, uniqueEmail } from './helpers';

export type Owner = { ctx: BrowserContext; page: Page; email: string; userId: string; secret: string; orgId: string; token: string };

export const suffix = () => randomBytes(3).toString('hex');
export const DEMO_PASSWORD = 'DemoLocal#2026';

/** Cria um proprietário com organização e MFA ativo, mais um token AAL2 para preparar dados via API. */
export async function setupOwner(browser: Browser, tag: string): Promise<Owner> {
  const email = uniqueEmail(tag);
  const { id: userId } = await apiSignUp(email);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, `Empresa ${tag} ${suffix()}`);
  const orgId = (await ctx.cookies()).find((c) => c.name === 'pack25_org')!.value;
  const token = await apiAal2Token(await apiLogin(email), secret);
  return { ctx, page, email, userId, secret, orgId, token };
}

export async function restJson<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await rest(token, path, init);
  if (!res.ok) throw new Error(`REST ${path} falhou: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function rpc<T = unknown>(token: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc ${fn} falhou: ${res.status} ${await res.text()}`);
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
}

/** Registra violações de Content-Security-Policy vistas no console do navegador. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

export async function addMember(owner: Owner, userId: string, role: 'member' | 'manager' | 'viewer') {
  await restJson(owner.token, 'organization_members', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, user_id: userId, role }) });
}

/** Data (YYYY-MM-DD) daqui a `days` dias, no horário de Brasília. */
export function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

/** Cria o modelo de score e o formulário (publicados) por API, para os testes que não são sobre o construtor. */
export async function seedPublishedForm(owner: Owner, slug: string): Promise<{ formId: string; modelId: string }> {
  const schema = {
    steps: [],
    fields: [
      { key: 'nome', type: 'text', label: 'Seu nome', required: true, lead_field: 'name' },
      { key: 'email', type: 'email', label: 'Seu e-mail', required: true, lead_field: 'email' },
      { key: 'telefone', type: 'phone', label: 'Telefone', lead_field: 'phone' },
      { key: 'orcamento', type: 'currency', label: 'Orçamento', required: true, min: 0 },
      { key: 'prazo', type: 'select', label: 'Prazo', required: true, options: [{ value: 'ate_30', label: 'Até 30 dias' }, { value: 'mais_90', label: 'Mais de 90 dias' }] },
    ],
  };
  const formId = await rpc<string>(owner.token, 'lead_form_create', { p_org: owner.orgId, p_name: `Form ${slug}`, p_slug: slug, p_schema: schema, p_logic: [], p_consent: { required: true, text: 'Concordo com o contato comercial.' } });
  const pub = await rpc<{ ok: boolean }>(owner.token, 'lead_form_publish', { p_form: formId });
  if (!pub.ok) throw new Error('publicação do formulário de teste falhou');
  const modelId = await rpc<string>(owner.token, 'lead_model_draft', { p_org: owner.orgId });
  await restJson(owner.token, 'scoring_rules', {
    method: 'POST',
    body: JSON.stringify([
      { organization_id: owner.orgId, model_id: modelId, label: 'Orçamento acima de R$ 5.000', field_key: 'orcamento', operator: 'gt', condition_json: 5000, points: 50, priority: 1 },
      { organization_id: owner.orgId, model_id: modelId, label: 'Quer contratar em até 30 dias', field_key: 'prazo', operator: 'eq', condition_json: 'ate_30', points: 50, priority: 2 },
    ]),
  });
  const pubModel = await rpc<{ ok: boolean }>(owner.token, 'lead_model_publish', { p_model: modelId });
  if (!pubModel.ok) throw new Error('publicação do modelo de teste falhou');
  return { formId, modelId };
}

/** Envia o formulário público de teste por API (como o visitante faria). */
export async function publicSubmit(slug: string, answers: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  const res = await fetch(`${process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/rpc/lead_public_submit`, {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ p_slug: slug, p_answers: answers, p_meta: meta, p_consent: true, p_submission_key: crypto.randomUUID(), p_client_key: randomBytes(16).toString('hex') }),
  });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
}

export async function leadByEmail(owner: Owner, email: string) {
  const rows = await restJson<Array<{ id: string; name: string; status: string; current_score: number | null; qualification: string | null; assigned_to: string | null }>>(
    owner.token, `leads?select=id,name,status,current_score,qualification,assigned_to&email=eq.${encodeURIComponent(email)}`);
  return rows;
}
