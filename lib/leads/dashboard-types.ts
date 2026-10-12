import type { LeadStatus } from './filters';

// Leitura dos indicadores (todos calculados em funções SQL; ver docs/METRICS.md). Nenhum número é fixo.
export type Kpis = {
  captured: number; qualified: number; qualification_rate: number | null; avg_score: number | null; hot: number; converted: number; conversion_rate: number | null;
  avg_first_contact_minutes: number | null; unassigned: number; overdue_followups: number;
};
export type SeriesPoint = { bucket: string; granularity: string; captured: number; qualified: number; converted: number; qualification_rate: number | null };
export type ScoreBucket = { bucket_start: number; label: string; leads: number };
export type ClassRow = { classification: 'hot' | 'warm' | 'cold' | 'unscored'; leads: number };
export type SourceRow = { source: string; captured: number; qualified: number; qualification_rate: number | null; avg_score: number | null; converted: number; conversion_rate: number | null };
export type CampaignStatRow = { campaign_id: string | null; campaign: string; captured: number; qualified: number; qualification_rate: number | null; avg_score: number | null; converted: number; conversion_rate: number | null };
export type SellerRow = { seller_id: string | null; leads: number; qualified: number; converted: number; conversion_rate: number | null; avg_score: number | null; avg_first_contact_minutes: number | null };
export type FunnelRow = { stage: 'captured' | 'worked' | 'contacted' | 'converted'; ord: number; leads: number };
export type StatusCount = { status: LeadStatus; leads: number };
export type ContactBucket = { bucket: string; ord: number; leads: number };
export type AlertCount = { key: 'hot_without_contact' | 'unassigned' | 'overdue_followups' | 'needs_review'; leads: number };

export type DashboardData = {
  kpis: Kpis | null;
  /** mesmos indicadores no período imediatamente anterior, de igual duração (para a variação) */
  previous: Kpis | null;
  series: SeriesPoint[];
  scores: ScoreBucket[];
  classes: ClassRow[];
  sources: SourceRow[];
  campaigns: CampaignStatRow[];
  sellers: SellerRow[];
  funnel: FunnelRow[];
  statuses: StatusCount[];
  contact: ContactBucket[];
  alerts: AlertCount[];
  error: boolean;
};
