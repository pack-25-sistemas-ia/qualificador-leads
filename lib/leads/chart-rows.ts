// Preparação (pura e testável) dos dados dos gráficos: rótulos legíveis e nomes de pessoas.
import { bucketLabel } from './format';
import type { ClassRow, FunnelRow, SellerRow, SeriesPoint, SourceRow } from './dashboard-types';

export type PeriodRow = { label: string; captured: number; qualified: number; converted: number; rate: number | null };
export type NamedRow = { name: string; value: number };
export type SellerChartRow = { name: string; leads: number; converted: number; rate: number | null };

export function periodRows(series: SeriesPoint[]): PeriodRow[] {
  return series.map((p) => ({ label: bucketLabel(p.bucket, p.granularity), captured: p.captured, qualified: p.qualified, converted: p.converted, rate: p.qualification_rate }));
}

export const FUNNEL_LABELS: Record<FunnelRow['stage'], string> = {
  captured: 'Capturados', worked: 'Em atendimento', contacted: 'Contatados', converted: 'Convertidos',
};
export function funnelRows(funnel: FunnelRow[]): Array<NamedRow & { pct: number | null }> {
  const top = funnel.find((f) => f.stage === 'captured')?.leads ?? 0;
  return [...funnel].sort((a, b) => a.ord - b.ord).map((f) => ({ name: FUNNEL_LABELS[f.stage], value: f.leads, pct: top === 0 ? null : Math.round((f.leads / top) * 1000) / 10 }));
}

export function sourceRows(sources: SourceRow[]): Array<{ name: string; captured: number; qualified: number }> {
  return sources.slice(0, 10).map((s) => ({ name: s.source, captured: s.captured, qualified: s.qualified }));
}

export function sellerRows(sellers: SellerRow[], labels: Map<string, string>): SellerChartRow[] {
  return sellers.slice(0, 12).map((s) => ({ name: s.seller_id ? labels.get(s.seller_id) ?? 'Usuário' : 'Sem responsável', leads: s.leads, converted: s.converted, rate: s.conversion_rate }));
}

export function classRows(classes: ClassRow[]): Array<{ key: ClassRow['classification']; value: number }> {
  return classes.map((c) => ({ key: c.classification, value: c.leads }));
}

export const ALERT_TITLES = {
  hot_without_contact: 'Leads quentes sem contato',
  unassigned: 'Leads sem responsável',
  overdue_followups: 'Follow-ups atrasados',
  needs_review: 'Possíveis duplicados para revisar',
} as const;
export const ALERT_LINKS: Record<keyof typeof ALERT_TITLES, string> = {
  hot_without_contact: '/leads?class=hot&status=new',
  unassigned: '/leads?unassigned=1',
  overdue_followups: '/atividades',
  needs_review: '/leads?review=1',
};
