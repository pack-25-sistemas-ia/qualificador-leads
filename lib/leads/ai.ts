import 'server-only';
import { z } from 'zod';
import type { LeadDetail } from './data';
import type { FormField } from './formlogic';

// Análise textual OPCIONAL por IA. Princípios (docs/DECISIONS.md D-5, docs/SCORING.md):
//  - roda só no servidor; a chave vem de variável de ambiente e nunca vai ao navegador nem ao banco;
//  - NUNCA altera o score: o resultado é gravado à parte (ai_analyses) e mostrado como "sugestão";
//  - dados MINIMIZADOS: sem nome, e-mail, telefone ou empresa; e-mails/telefones em textos livres são mascarados;
//  - saída estruturada validada por Zod; tempo limite; sem redirecionamentos; limite diário no banco;
//  - o provedor é qualquer API compatível com "chat completions" (OpenAI, OpenRouter, gateways, servidores locais).

export type AiEnv = { apiKey: string; baseUrl: string; model: string; provider: string };

export function readAiEnv(env: Record<string, string | undefined> = process.env): AiEnv | null {
  const apiKey = env.AI_API_KEY?.trim();
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/+$/, '');
  const model = env.AI_MODEL?.trim();
  if (!apiKey || !baseUrl || !model) return null;
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null; // chave nunca viaja em texto puro
  if (url.username || url.password) return null;
  return { apiKey, baseUrl, model, provider: (env.AI_PROVIDER ?? url.hostname).slice(0, 40) };
}

export const analysisSchema = z.object({
  summary: z.string().trim().min(1).max(700),
  strengths: z.array(z.string().trim().min(1).max(240)).max(5),
  risks: z.array(z.string().trim().min(1).max(240)).max(5),
  next_steps: z.array(z.string().trim().min(1).max(240)).max(5),
});
export type Analysis = z.infer<typeof analysisSchema>;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL_RE, '[e-mail]').replace(PHONE_RE, '[telefone]');
}

export type MinimizedLead = {
  segment: string | null;
  source: string;
  campaign: string | null;
  score: number | null;
  classification: string | null;
  qualified: boolean | null;
  applied_rules: Array<{ rule: string; points: number }>;
  missing_fields: string[];
  answers: Array<{ question: string; answer: string }>;
};

const PERSONAL_LEAD_FIELDS = new Set(['name', 'email', 'phone', 'company_name']);

/** Reduz o lead ao mínimo necessário para a análise: nenhuma informação que identifique a pessoa. */
export function minimizeLead(d: LeadDetail): MinimizedLead {
  const fields = (d.schema?.fields ?? []) as FormField[];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const answers: MinimizedLead['answers'] = [];
  for (const [key, value] of Object.entries(d.submission?.answers_json ?? {})) {
    const f = byKey.get(key);
    if (!f || (f.lead_field && PERSONAL_LEAD_FIELDS.has(f.lead_field)) || f.type === 'email' || f.type === 'phone' || f.type === 'consent' || f.type === 'hidden') continue;
    const optionLabel = (v: unknown) => f.options?.find((o) => o.value === v)?.label ?? String(v);
    const text = Array.isArray(value) ? value.map(optionLabel).join(', ') : typeof value === 'boolean' ? (value ? 'sim' : 'não') : optionLabel(value);
    answers.push({ question: f.label.slice(0, 200), answer: maskPersonalData(text).slice(0, 500) });
  }
  const last = d.scores[0];
  return {
    segment: d.lead.segment,
    source: d.lead.source ?? 'direto',
    campaign: d.campaign?.name ?? null,
    score: d.lead.current_score,
    classification: d.lead.qualification,
    qualified: d.lead.qualified,
    applied_rules: (last?.explanation_json.applied ?? []).map((a) => ({ rule: a.label, points: a.points })),
    missing_fields: last?.explanation_json.missing ?? [],
    answers,
  };
}

const SYSTEM_PROMPT = [
  'Você é um assistente de apoio à qualificação comercial. Responda SEMPRE em português do Brasil e SOMENTE com um objeto JSON.',
  'Formato: {"summary": string, "strengths": string[], "risks": string[], "next_steps": string[]} (até 5 itens por lista).',
  'Use apenas os dados fornecidos. Não invente fatos, não tente identificar a pessoa e NÃO considere nem infira características protegidas',
  '(raça, religião, saúde, orientação sexual, idade, gênero, origem etc.). Você apoia a priorização; não decide sobre pessoas e não altera a nota.',
].join(' ');

export type AiOutcome =
  | { ok: true; analysis: Analysis; tokensIn: number | null; tokensOut: number | null; provider: string; model: string }
  | { ok: false; error: string; provider: string; model: string };

export async function analyzeWithAi(lead: MinimizedLead, env: AiEnv, fetchImpl: typeof fetch = fetch, timeoutMs = 25_000): Promise<AiOutcome> {
  const base = { provider: env.provider, model: env.model };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${env.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({
        model: env.model,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Dados do lead (anonimizados):\n${JSON.stringify(lead)}` },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `O provedor respondeu com erro (${res.status}).`, ...base };
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length > 20_000) return { ok: false, error: 'Resposta do provedor em formato inesperado.', ...base };
    let json: unknown;
    try { json = JSON.parse(content); } catch { return { ok: false, error: 'A resposta não é um JSON válido.', ...base }; }
    const parsed = analysisSchema.safeParse(json);
    if (!parsed.success) return { ok: false, error: 'A resposta não segue o formato esperado.', ...base };
    return { ok: true, analysis: parsed.data, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null, ...base };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, error: aborted ? 'O provedor demorou demais para responder.' : 'Não foi possível falar com o provedor de IA.', ...base };
  } finally {
    clearTimeout(timer);
  }
}
