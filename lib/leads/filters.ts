// Filtros globais do painel e dos relatórios. Vêm da URL (compartilháveis) e SEMPRE são validados:
// período inválido cai no padrão de 30 dias, sem erro. A "data de hoje" usa o fuso da organização.
import { z } from 'zod';

export const PERIODS = ['7d', '30d', '90d', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export const CLASSES = ['hot', 'warm', 'cold'] as const;
export type Classification = (typeof CLASSES)[number];
export const LEAD_STATUSES = ['new', 'qualifying', 'qualified', 'contacted', 'converted', 'disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadFilters = {
  period: Period;
  /** 'YYYY-MM-DD', inclusivo. */
  from: string;
  /** 'YYYY-MM-DD', inclusivo. */
  to: string;
  seller: string | null;
  campaign: string | null;
  source: string | null;
  form: string | null;
  classification: Classification | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.uuid();
const MAX_SPAN_DAYS = 366;
const PRESET_DAYS: Record<Exclude<Period, 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90 };
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Fuso válido (IANA)? Se não for, usa o padrão. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Data de hoje no fuso informado, 'YYYY-MM-DD'. */
export function todayIn(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}
export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  return new Date(toUtcMs(value)).toISOString().slice(0, 10) === value;
}
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const SOURCE_RE = /^[\p{L}\p{N} ._-]{1,80}$/u;

export function parseFilters(searchParams: Record<string, string | string[] | undefined>, today: string = todayIn()): LeadFilters {
  const rawPeriod = first(searchParams.period);
  let period: Period = (PERIODS as readonly string[]).includes(rawPeriod ?? '') ? (rawPeriod as Period) : '30d';
  let from = addDays(today, -(PRESET_DAYS['30d'] - 1));
  let to = today;
  if (period === 'custom') {
    const f = first(searchParams.from) ?? '';
    const t = first(searchParams.to) ?? '';
    if (isRealDate(f) && isRealDate(t) && f <= t && daysBetween(f, t) < MAX_SPAN_DAYS) {
      from = f;
      to = t;
    } else {
      period = '30d';
    }
  }
  if (period !== 'custom') {
    from = addDays(today, -(PRESET_DAYS[period] - 1));
    to = today;
  }
  const id = (key: string) => {
    const v = first(searchParams[key]);
    return v && uuid.safeParse(v).success ? v : null;
  };
  const cls = first(searchParams.class);
  const src = (first(searchParams.source) ?? '').trim();
  return {
    period, from, to,
    seller: id('seller'),
    campaign: id('campaign'),
    source: src && SOURCE_RE.test(src) ? src : null,
    form: id('form'),
    classification: (CLASSES as readonly string[]).includes(cls ?? '') ? (cls as Classification) : null,
  };
}

/** Query string canônica dos filtros (links de exportação e navegação). */
export function filtersToQuery(f: LeadFilters): string {
  const p = new URLSearchParams();
  p.set('period', f.period);
  if (f.period === 'custom') {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  if (f.seller) p.set('seller', f.seller);
  if (f.campaign) p.set('campaign', f.campaign);
  if (f.source) p.set('source', f.source);
  if (f.form) p.set('form', f.form);
  if (f.classification) p.set('class', f.classification);
  return p.toString();
}

/** Argumentos comuns das funções SQL de indicadores. */
export function rpcArgs(org: string, f: LeadFilters) {
  return { p_org: org, p_from: f.from, p_to: f.to, p_seller: f.seller, p_campaign: f.campaign, p_source: f.source, p_form: f.form, p_class: f.classification };
}

export const PERIOD_LABELS: Record<Period, string> = {
  '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', custom: 'Período personalizado',
};
export const CLASS_LABELS: Record<Classification | 'unscored', string> = { hot: 'Quente', warm: 'Morno', cold: 'Frio', unscored: 'Sem score' };
export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo', qualifying: 'Em qualificação', qualified: 'Qualificado', contacted: 'Em contato', converted: 'Convertido', disqualified: 'Desqualificado',
};
export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'message', 'diagnostic', 'other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABELS: Record<ActivityType, string> = { call: 'Ligação', email: 'E-mail', meeting: 'Reunião', message: 'Mensagem', diagnostic: 'Diagnóstico', other: 'Outro' };

/** Transições válidas do pipeline (espelha o gatilho do banco). */
export const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['qualifying', 'qualified', 'contacted', 'disqualified'],
  qualifying: ['new', 'qualified', 'contacted', 'disqualified'],
  qualified: ['qualifying', 'contacted', 'converted', 'disqualified'],
  contacted: ['qualified', 'converted', 'disqualified'],
  converted: [],
  disqualified: ['new', 'qualifying'],
};
export const canTransition = (from: LeadStatus, to: LeadStatus) => from === to || TRANSITIONS[from].includes(to);
