// Formatação no padrão brasileiro. Datas de calendário ('YYYY-MM-DD') nunca passam por fuso; instantes usam o fuso da organização.
import { safeTimezone } from './filters';

const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const one = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR');

/** Percentual com duas casas; `null` (sem dados) vira "—", nunca "0%". */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${pct.format(value)}%`;
}
export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : int.format(value);
}
export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : one.format(value);
}

/** Minutos -> "35 min", "2 h 5 min", "1 d 3 h". */
export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const m = Math.round(value);
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem deslocamento de fuso. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export function formatDateTime(value: string | null | undefined, tz?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: safeTimezone(tz) }).format(d);
}
export function formatDay(value: string | null | undefined, tz?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: safeTimezone(tz) }).format(d);
}

/** Telefone guardado só com dígitos (ex.: 5511912345678) -> "+55 (11) 91234-5678". Outros formatos voltam como estão. */
export function formatPhone(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

/** Faixa de cor do score (texto + cor; nunca só cor). */
export function scoreTone(classification: string | null | undefined): 'danger' | 'warning' | 'info' | 'neutral' {
  return classification === 'hot' ? 'danger' : classification === 'warm' ? 'warning' : classification === 'cold' ? 'info' : 'neutral';
}

/** 'direto' é a origem de quem chegou sem UTM. */
export function sourceLabel(source: string | null | undefined): string {
  return !source ? 'direto' : source;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Rótulo do ponto da série: dia/semana -> "31/08"; mês -> "set/26". */
export function bucketLabel(bucket: string, granularity: string): string {
  const [y, m, d] = bucket.split('-');
  if (!y || !m || !d) return bucket;
  return granularity === 'month' ? `${MONTHS[Number(m) - 1] ?? m}/${y.slice(2)}` : `${d}/${m}`;
}

/** Variação percentual entre períodos; `null` quando não faz sentido (base zero ou ausente). */
export function variationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
