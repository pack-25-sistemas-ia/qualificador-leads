import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import type { ConsentConfig, FormSchema, LogicRule } from './formlogic';

// Captação pública. Usa a chave pública (anon), SEM cookies nem sessão: o visitante só executa duas funções do banco
// (lead_public_form / lead_public_submit). Nenhuma tabela é acessível. Respostas de link inválido são idênticas (sem enumeração).

export type PublicForm = {
  name: string; description: string | null; schema: FormSchema; logic: LogicRule[]; consent: ConsentConfig; thankYou: string; redirect: string | null;
  privacyUrl: string | null; company: string; primary: string | null; version: number;
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function anonClient() {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function fetchPublicForm(slug: string): Promise<PublicForm | null> {
  if (!SLUG_RE.test(slug) || slug.length > 60) return null;
  const { data, error } = await anonClient().rpc('lead_public_form', { p_slug: slug });
  if (error || !data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  if (r.state !== 'open' || !r.schema || typeof r.schema !== 'object') return null;
  return {
    name: String(r.name ?? ''), description: (r.description as string | null) ?? null, schema: r.schema as FormSchema, logic: (r.logic as LogicRule[]) ?? [],
    consent: (r.consent as ConsentConfig) ?? { text: '' }, thankYou: String(r.thank_you ?? 'Obrigado!'), redirect: (r.redirect as string | null) ?? null,
    privacyUrl: (r.privacy_url as string | null) ?? null, company: String(r.company ?? ''), primary: (r.primary as string | null) ?? null, version: Number(r.version ?? 1),
  };
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; error: 'invalid'; errors: Record<string, string> }
  | { ok: false; error: 'unavailable' | 'rate_limited' | 'failed' };

export type SubmitMeta = { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string; landing_page?: string };

/** Chave anônima do visitante para o limite de taxa: só o hash do IP é enviado ao banco (e apagado em até um dia). */
export function clientKey(ip: string): string {
  return createHash('sha256').update(`pack25-rl:${ip}`, 'utf8').digest('hex');
}

export async function submitPublicForm(slug: string, answers: Record<string, unknown>, meta: SubmitMeta, consent: boolean, submissionKey: string, ip: string): Promise<SubmitOutcome> {
  if (!SLUG_RE.test(slug) || slug.length > 60) return { ok: false, error: 'unavailable' };
  const { data, error } = await anonClient().rpc('lead_public_submit', {
    p_slug: slug, p_answers: answers, p_meta: meta, p_consent: consent, p_submission_key: submissionKey, p_client_key: clientKey(ip),
  });
  if (error || !data || typeof data !== 'object') return { ok: false, error: 'failed' };
  const r = data as { ok?: boolean; error?: string; errors?: Record<string, string> };
  if (r.ok) return { ok: true };
  if (r.error === 'invalid') return { ok: false, error: 'invalid', errors: r.errors && typeof r.errors === 'object' ? r.errors : {} };
  if (r.error === 'rate_limited') return { ok: false, error: 'rate_limited' };
  if (r.error === 'unavailable') return { ok: false, error: 'unavailable' };
  return { ok: false, error: 'failed' };
}
