// Motor de score (espelho TypeScript de public.lead_score_compute / private.lead_cond). A fonte da verdade é o BANCO;
// este espelho serve ao simulador e à prévia e passa nas mesmas fixtures calculadas à mão (tests/fixtures/scoring-cases.json).
// Determinístico, sem IA e sem executar nada que venha do usuário: operadores de uma lista fechada. Ver docs/SCORING.md.

export const OPERATORS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'is_true', 'answered', 'not_answered'] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'é igual a', neq: 'é diferente de', in: 'está entre', not_in: 'não está entre', gt: 'é maior que', gte: 'é maior ou igual a', lt: 'é menor que', lte: 'é menor ou igual a',
  between: 'está no intervalo', contains: 'contém', is_true: 'está marcado', answered: 'foi respondido', not_answered: 'não foi respondido',
};
/** Operadores que não precisam de valor. */
export const VALUELESS: readonly Operator[] = ['is_true', 'answered', 'not_answered'];

export type ScoreRule = { id?: string; label: string; field_key: string; operator: string; condition: unknown; points: number; enabled?: boolean };
export type Thresholds = { warm_min?: number; hot_min?: number; qualified_min?: number };
export type ScoreResult = {
  raw_total: number;
  score: number;
  classification: 'cold' | 'warm' | 'hot';
  qualified: boolean;
  applied: Array<{ rule_id: string | undefined; label: string; field_key: string; points: number }>;
  missing: string[];
};

export const DEFAULT_THRESHOLDS = { warm_min: 40, hot_min: 70, qualified_min: 70 } as const;

type Json = unknown;

export function isAnswered(a: Json): boolean {
  if (a === undefined || a === null) return false;
  if (typeof a === 'string') return a.trim() !== '';
  if (Array.isArray(a)) return a.length > 0;
  return true;
}

export function tryNumeric(a: Json): number | null {
  if (typeof a === 'number') return Number.isFinite(a) ? a : null;
  if (typeof a === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(a)) return Number(a.trim().replace(',', '.'));
  return null;
}

function textOf(v: Json): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function scalarEq(a: Json, c: Json): boolean {
  if (Array.isArray(a)) return a.some((el) => scalarEq(el, c));
  const cn = tryNumeric(c);
  if (typeof a === 'number' && cn !== null) return a === cn;
  const x = textOf(a);
  const y = textOf(c);
  return x !== null && y !== null && x.toLowerCase() === y.toLowerCase();
}

/** Avalia uma condição. `null` = a resposta falta e a regra "não se aplica". */
export function evalCondition(op: string, ans: Json, cond: Json): boolean | null {
  if (op === 'answered') return isAnswered(ans);
  if (op === 'not_answered') return !isAnswered(ans);
  if (!isAnswered(ans)) return null;
  if (op === 'is_true') return ans === true;
  if (op === 'eq' || op === 'neq') {
    const hit = scalarEq(ans, cond);
    return op === 'eq' ? hit : !hit;
  }
  if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(cond)) return null;
    const hit = cond.some((el) => scalarEq(ans, el));
    return op === 'in' ? hit : !hit;
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const n = tryNumeric(ans);
    const c = tryNumeric(cond);
    if (n === null || c === null) return null;
    return op === 'gt' ? n > c : op === 'gte' ? n >= c : op === 'lt' ? n < c : n <= c;
  }
  if (op === 'between') {
    const n = tryNumeric(ans);
    const range = cond as { min?: Json; max?: Json } | null;
    const lo = tryNumeric(range?.min);
    const hi = tryNumeric(range?.max);
    if (n === null || lo === null || hi === null) return null;
    return n >= lo && n <= hi;
  }
  if (op === 'contains') {
    if (cond === undefined || cond === null) return null;
    if (Array.isArray(ans)) return scalarEq(ans, cond);
    return (textOf(ans) ?? '').toLowerCase().includes((textOf(cond) ?? '').toLowerCase());
  }
  return null;
}

export function validateThresholds(t: Thresholds): string | null {
  const warm = t.warm_min ?? DEFAULT_THRESHOLDS.warm_min;
  const hot = t.hot_min ?? DEFAULT_THRESHOLDS.hot_min;
  const q = t.qualified_min ?? hot;
  if (![warm, hot, q].every(Number.isInteger)) return 'As faixas devem ser números inteiros.';
  if (!(warm > 0 && warm < hot && hot <= 100)) return 'Use 0 < morno < quente ≤ 100.';
  if (!(q >= 0 && q <= 100)) return 'A qualificação deve estar entre 0 e 100.';
  return null;
}

export function computeScore(rules: ScoreRule[], answers: Record<string, Json>, thresholds: Thresholds = {}, hidden: readonly string[] = []): ScoreResult {
  if (!Array.isArray(rules)) throw new Error('regras inválidas');
  const err = validateThresholds(thresholds);
  if (err) throw new Error(err);
  const warm = thresholds.warm_min ?? DEFAULT_THRESHOLDS.warm_min;
  const hot = thresholds.hot_min ?? DEFAULT_THRESHOLDS.hot_min;
  const qmin = thresholds.qualified_min ?? hot;
  const data = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  let raw = 0;
  const applied: ScoreResult['applied'] = [];
  const missing: string[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    const ans = data[r.field_key];
    const res = evalCondition(r.operator, ans, r.condition);
    if (res === null) {
      if (!isAnswered(ans) && !hidden.includes(r.field_key) && !missing.includes(r.field_key)) missing.push(r.field_key);
    } else if (res) {
      raw += r.points;
      applied.push({ rule_id: r.id, label: r.label, field_key: r.field_key, points: r.points });
    }
  }
  const score = Math.max(0, Math.min(100, raw));
  const classification = score >= hot ? 'hot' : score >= warm ? 'warm' : 'cold';
  return { raw_total: raw, score, classification, qualified: score >= qmin, applied, missing };
}
