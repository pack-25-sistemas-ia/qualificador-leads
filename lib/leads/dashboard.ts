import 'server-only';
import type { Context } from '@/lib/auth/session';
import { addDays, daysBetween, rpcArgs, type LeadFilters, type LeadStatus } from './filters';

export type * from './dashboard-types';
import type { AlertCount, ClassRow, DashboardData, FunnelRow, Kpis } from './dashboard-types';

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
type Rec = Record<string, unknown>;
const rows = (d: unknown): Rec[] => (Array.isArray(d) ? (d as Rec[]) : []);

export function toKpis(row: Rec | undefined): Kpis | null {
  return row ? {
    captured: num(row.captured), qualified: num(row.qualified), qualification_rate: numOrNull(row.qualification_rate), avg_score: numOrNull(row.avg_score), hot: num(row.hot),
    converted: num(row.converted), conversion_rate: numOrNull(row.conversion_rate), avg_first_contact_minutes: numOrNull(row.avg_first_contact_minutes),
    unassigned: num(row.unassigned), overdue_followups: num(row.overdue_followups),
  } : null;
}

export async function loadDashboard(ctx: Context, f: LeadFilters): Promise<DashboardData> {
  const org = ctx.membership.organization_id;
  const db = ctx.supabase;
  const base = rpcArgs(org, f);
  const len = daysBetween(f.from, f.to) + 1;
  const prevTo = addDays(f.from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const [k, pk, se, sc, cl, so, ca, sl, fu, st, ct, al] = await Promise.all([
    db.rpc('lead_kpis', base),
    db.rpc('lead_kpis', { ...base, p_from: prevFrom, p_to: prevTo }),
    db.rpc('lead_series', base),
    db.rpc('lead_score_distribution', base),
    db.rpc('lead_class_distribution', base),
    db.rpc('lead_by_source', base),
    db.rpc('lead_by_campaign', base),
    db.rpc('lead_by_seller', base),
    db.rpc('lead_funnel', base),
    db.rpc('lead_status_counts', base),
    db.rpc('lead_first_contact_distribution', base),
    db.rpc('lead_alerts', { p_org: org }),
  ]);
  const error = Boolean(k.error || se.error || sc.error || cl.error || so.error || ca.error || sl.error || fu.error || st.error || ct.error || al.error);
  return {
    error,
    kpis: toKpis(rows(k.data)[0]),
    previous: pk.error ? null : toKpis(rows(pk.data)[0]),
    series: rows(se.data).map((p) => ({ bucket: String(p.bucket), granularity: String(p.granularity), captured: num(p.captured), qualified: num(p.qualified), converted: num(p.converted), qualification_rate: numOrNull(p.qualification_rate) })),
    scores: rows(sc.data).map((p) => ({ bucket_start: num(p.bucket_start), label: String(p.label), leads: num(p.leads) })),
    classes: rows(cl.data).map((p) => ({ classification: p.classification as ClassRow['classification'], leads: num(p.leads) })),
    sources: rows(so.data).map((p) => ({ source: String(p.source), captured: num(p.captured), qualified: num(p.qualified), qualification_rate: numOrNull(p.qualification_rate), avg_score: numOrNull(p.avg_score), converted: num(p.converted), conversion_rate: numOrNull(p.conversion_rate) })),
    campaigns: rows(ca.data).map((p) => ({ campaign_id: (p.campaign_id as string | null) ?? null, campaign: String(p.campaign), captured: num(p.captured), qualified: num(p.qualified), qualification_rate: numOrNull(p.qualification_rate), avg_score: numOrNull(p.avg_score), converted: num(p.converted), conversion_rate: numOrNull(p.conversion_rate) })),
    sellers: rows(sl.data).map((p) => ({ seller_id: (p.seller_id as string | null) ?? null, leads: num(p.leads), qualified: num(p.qualified), converted: num(p.converted), conversion_rate: numOrNull(p.conversion_rate), avg_score: numOrNull(p.avg_score), avg_first_contact_minutes: numOrNull(p.avg_first_contact_minutes) })),
    funnel: rows(fu.data).map((p) => ({ stage: p.stage as FunnelRow['stage'], ord: num(p.ord), leads: num(p.leads) })),
    statuses: rows(st.data).map((p) => ({ status: p.status as LeadStatus, leads: num(p.leads) })),
    contact: rows(ct.data).map((p) => ({ bucket: String(p.bucket), ord: num(p.ord), leads: num(p.leads) })),
    alerts: rows(al.data).map((p) => ({ key: p.key as AlertCount['key'], leads: num(p.leads) })),
  };
}
