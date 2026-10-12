// Conversão entre o que a pessoa digita ("5000", "SP, RJ", "10-50") e o JSON guardado na regra (condition_json).
// Só os operadores da lista fechada são aceitos; nada digitado é executado.
import { OPERATORS, VALUELESS, type Operator } from './scoring';

export function isOperator(op: string): op is Operator {
  return (OPERATORS as readonly string[]).includes(op);
}

function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : null;
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };

/** Texto digitado -> valor da condição. Listas separadas por ";" (ou ","), intervalo como "10-50" ou "10 a 50". */
export function parseRuleValue(op: string, raw: string): ParsedValue {
  if (!isOperator(op)) return { ok: false, error: 'Operador inválido.' };
  const text = raw.trim();
  if ((VALUELESS as readonly string[]).includes(op)) return { ok: true, value: null };
  if (text === '') return { ok: false, error: 'Informe o valor da condição.' };
  if (text.length > 500) return { ok: false, error: 'Valor muito longo.' };
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const n = parseNumber(text);
    return n === null ? { ok: false, error: 'Informe um número (ex.: 5000).' } : { ok: true, value: n };
  }
  if (op === 'between') {
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:-|a|até|;)\s*(-?\d+(?:[.,]\d+)?)\s*$/i.exec(text.replace(/\s+até\s+/i, ' a '));
    const lo = m ? parseNumber(m[1]!) : null;
    const hi = m ? parseNumber(m[2]!) : null;
    if (lo === null || hi === null) return { ok: false, error: 'Informe o intervalo, por exemplo 10 a 50.' };
    if (lo > hi) return { ok: false, error: 'O mínimo deve ser menor ou igual ao máximo.' };
    return { ok: true, value: { min: lo, max: hi } };
  }
  if (op === 'in' || op === 'not_in') {
    const items = text.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    if (items.length === 0 || items.length > 50) return { ok: false, error: 'Informe de 1 a 50 valores separados por vírgula.' };
    return { ok: true, value: [...new Set(items)] };
  }
  return { ok: true, value: text }; // eq, neq, contains
}

/** Valor da condição -> texto para editar. */
export function formatRuleValue(op: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (op === 'between' && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { min?: unknown; max?: unknown };
    return `${String(v.min ?? '')} a ${String(v.max ?? '')}`;
  }
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}
