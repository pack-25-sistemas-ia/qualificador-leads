'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { logEvent } from '@/lib/log';
import { submitPublicForm } from '@/lib/leads/public';
import { rateLimit } from '@/lib/security/rate-limit';

export type PublicSubmitResult = { ok: true } | { ok: false; message: string; errors?: Record<string, string> };

const meta = z.object({
  utm_source: z.string().max(120).optional(), utm_medium: z.string().max(120).optional(), utm_campaign: z.string().max(120).optional(),
  utm_content: z.string().max(120).optional(), utm_term: z.string().max(120).optional(), landing_page: z.string().max(300).optional(),
});
const schema = z.object({
  slug: z.string().max(60),
  answers: z.record(z.string().max(40), z.unknown()),
  consent: z.boolean(),
  website: z.string().max(200),
  key: z.uuid(),
  elapsedMs: z.number().min(0).max(86_400_000),
  meta,
});

/**
 * Envio público do formulário. Camadas: (1) honeypot e tempo mínimo, silenciosos (o robô não aprende nada);
 * (2) limitador em memória por IP (primeira barreira, por instância); (3) limitador COMPARTILHADO no banco, por hash do IP e por
 * formulário, e toda a validação/pontuação/deduplicação dentro da função do banco. Mensagens uniformes, sem dados de leads.
 */
export async function submitPublicLead(input: unknown): Promise<PublicSubmitResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Não foi possível enviar. Atualize a página e tente de novo.' };
  const { slug, answers, consent, website, key, elapsedMs, meta: m } = parsed.data;
  if (JSON.stringify(answers).length > 32_000) return { ok: false, message: 'Os dados enviados são grandes demais.' };

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'desconhecido';

  // honeypot preenchido ou envio humanamente impossível: responde "ok" sem gravar nada
  if (website.trim() !== '' || elapsedMs < 800) {
    logEvent('warn', 'lead_bot_blocked', { reason: website.trim() !== '' ? 'honeypot' : 'too_fast' });
    return { ok: true };
  }
  if (!rateLimit(`lead:${slug}:${ip}`, { limit: 40, windowMs: 10 * 60_000 }).allowed) {
    return { ok: false, message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' };
  }

  const out = await submitPublicForm(slug, answers, m, consent, key, ip);
  if (out.ok) {
    logEvent('info', 'lead_captured', {});
    return { ok: true };
  }
  switch (out.error) {
    case 'invalid': return { ok: false, message: 'Revise os campos destacados.', errors: out.errors };
    case 'rate_limited': return { ok: false, message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' };
    case 'unavailable': return { ok: false, message: 'Este formulário não está mais disponível.' };
    default: return { ok: false, message: 'Não foi possível enviar agora. Tente novamente em instantes.' };
  }
}
