'use client';

import { useState } from 'react';
import { submitPublicLead } from '@/app/f/[slug]/actions';
import { FormRenderer, type SubmitResult } from '@/components/leads/form-renderer';
import type { ConsentConfig, FormSchema, LogicRule } from '@/lib/leads/formlogic';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/** Captura os UTM da URL (até 120 caracteres cada) e o endereço da página SEM a query (minimização de dados). */
function readMeta() {
  const q = new URLSearchParams(window.location.search);
  const meta: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = q.get(k)?.trim();
    if (v) meta[k] = v.slice(0, 120);
  }
  meta.landing_page = `${window.location.origin}${window.location.pathname}`.slice(0, 300);
  return meta;
}

export function PublicForm({ slug, schema, logic, consent, privacyUrl, thankYou, redirectUrl, prefill }: {
  slug: string; schema: FormSchema; logic: LogicRule[]; consent: ConsentConfig; privacyUrl: string | null; thankYou: string; redirectUrl: string | null; prefill: Record<string, string>;
}) {
  const [startedAt] = useState(() => Date.now());

  async function onSubmit(input: { answers: Record<string, unknown>; consent: boolean; website: string; key: string }): Promise<SubmitResult> {
    const res = await submitPublicLead({ slug, answers: input.answers, consent: input.consent, website: input.website, key: input.key, elapsedMs: Date.now() - startedAt, meta: readMeta() });
    return res.ok ? { ok: true } : { ok: false, message: res.message, errors: res.errors };
  }

  return <FormRenderer schema={schema} logic={logic} consent={consent} privacyUrl={privacyUrl} onSubmit={onSubmit} prefill={prefill} thankYou={thankYou} redirectUrl={redirectUrl} />;
}
