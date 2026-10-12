import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';
import { toCsv, int, type CsvCell } from '@/lib/leads/csv';
import { LEAD_COLUMNS, loadSettings, searchToken, type LeadRow } from '@/lib/leads/data';
import { CLASS_LABELS, LEAD_STATUSES, PERIOD_LABELS, STATUS_LABELS, parseFilters, rpcArgs, todayIn, type Classification, type LeadStatus } from '@/lib/leads/filters';
import { formatDate, formatDateTime, formatMinutes, formatPhone, sourceLabel } from '@/lib/leads/format';
import { FUNNEL_LABELS } from '@/lib/leads/chart-rows';

export const runtime = 'nodejs';

const MAX_ROWS = 5000;

function csvResponse(name: string, body: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
const rate = (v: number | null) => (v === null || v === undefined ? '' : Number(v));

/** Exportações em CSV (UTF-8 com BOM, `;`, fórmulas neutralizadas). O RLS limita ao que o usuário enxerga; o resto exige gestão. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await resolveContext();
  if (auth.kind !== 'ok') return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  const { ctx } = auth;
  const org = ctx.membership.organization_id;
  const manager = (MANAGER_ROLES as readonly string[]).includes(ctx.membership.role);
  const { kind } = await params;
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const settings = await loadSettings(ctx);
  const f = parseFilters(sp, todayIn(settings.timezone));
  const db = ctx.supabase;

  if (kind === 'leads-template') {
    if (!manager) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    return csvResponse('modelo-leads', toCsv(['nome', 'e-mail', 'telefone', 'empresa', 'segmento', 'origem'], [['Maria Exemplo', 'maria@exemplo.com.br', '(11) 99999-0000', 'Empresa Exemplo', 'Serviços', 'evento']]));
  }

  if (kind === 'leads') {
    if (!manager) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    let q = db.from('leads').select(LEAD_COLUMNS).eq('organization_id', org);
    q = sp.archived === '1' ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
    const status = sp.status ?? '';
    if ((LEAD_STATUSES as readonly string[]).includes(status)) q = q.eq('status', status);
    if (['hot', 'warm', 'cold'].includes(sp.class ?? '')) q = q.eq('qualification', sp.class!);
    if (sp.source) q = sp.source === 'direto' ? q.is('source', null) : q.eq('source', searchToken(sp.source));
    if (/^[0-9a-f-]{36}$/i.test(sp.campaign ?? '')) q = q.eq('campaign_id', sp.campaign!);
    if (/^[0-9a-f-]{36}$/i.test(sp.seller ?? '')) q = q.eq('assigned_to', sp.seller!);
    if (sp.unassigned === '1') q = q.is('assigned_to', null);
    if (sp.review === '1') q = q.eq('needs_review', true);
    const term = searchToken(sp.q);
    if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`);
    const [{ data }, people, camps] = await Promise.all([
      q.order('created_at', { ascending: false }).limit(MAX_ROWS),
      db.rpc('lead_user_labels', { p_org: org }),
      db.from('campaigns').select('id, name').eq('organization_id', org),
    ]);
    const pMap = new Map(((people.data ?? []) as Array<{ user_id: string; label: string }>).map((p) => [p.user_id, p.label]));
    const cMap = new Map(((camps.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const rows = ((data ?? []) as LeadRow[]).map((l): CsvCell[] => [
      l.name, l.email, formatPhone(l.phone), l.company_name, l.segment, STATUS_LABELS[l.status], l.current_score === null ? '' : int(l.current_score), l.qualification ? CLASS_LABELS[l.qualification] : '',
      l.qualified === null ? '' : l.qualified ? 'sim' : 'não', l.assigned_to ? pMap.get(l.assigned_to) ?? '' : '', sourceLabel(l.source), l.campaign_id ? cMap.get(l.campaign_id) ?? '' : '',
      l.disqualify_reason, formatDateTime(l.created_at, settings.timezone), formatDateTime(l.first_contact_at, settings.timezone),
    ]);
    return csvResponse('leads', toCsv(['Nome', 'E-mail', 'Telefone', 'Empresa', 'Segmento', 'Status', 'Score', 'Classificação', 'Qualificado', 'Responsável', 'Origem', 'Campanha', 'Motivo da desqualificação', 'Criado em', 'Primeiro contato'], rows));
  }

  if (['by-source', 'by-campaign', 'by-seller', 'funnel', 'series', 'status'].includes(kind)) {
    if (!manager && kind === 'by-seller') return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
    const args = rpcArgs(org, f);
    const stamp = `${PERIOD_LABELS[f.period]} (${formatDate(f.from)} a ${formatDate(f.to)})`;
    if (kind === 'by-source') {
      const { data } = await db.rpc('lead_by_source', args);
      const rows = ((data ?? []) as Array<{ source: string; captured: number; qualified: number; qualification_rate: number | null; avg_score: number | null; converted: number; conversion_rate: number | null }>)
        .map((r): CsvCell[] => [r.source, int(r.captured), int(r.qualified), rate(r.qualification_rate), rate(r.avg_score), int(r.converted), rate(r.conversion_rate)]);
      return csvResponse('leads-por-origem', toCsv(['Origem', 'Capturados', 'Qualificados', 'Taxa de qualificação (%)', 'Score médio', 'Convertidos', `Taxa de conversão (%) — ${stamp}`], rows));
    }
    if (kind === 'by-campaign') {
      const { data } = await db.rpc('lead_by_campaign', args);
      const rows = ((data ?? []) as Array<{ campaign: string; captured: number; qualified: number; qualification_rate: number | null; avg_score: number | null; converted: number; conversion_rate: number | null }>)
        .map((r): CsvCell[] => [r.campaign, int(r.captured), int(r.qualified), rate(r.qualification_rate), rate(r.avg_score), int(r.converted), rate(r.conversion_rate)]);
      return csvResponse('leads-por-campanha', toCsv(['Campanha', 'Capturados', 'Qualificados', 'Taxa de qualificação (%)', 'Score médio', 'Convertidos', `Taxa de conversão (%) — ${stamp}`], rows));
    }
    if (kind === 'by-seller') {
      const [{ data }, people] = await Promise.all([db.rpc('lead_by_seller', args), db.rpc('lead_user_labels', { p_org: org })]);
      const pMap = new Map(((people.data ?? []) as Array<{ user_id: string; label: string }>).map((p) => [p.user_id, p.label]));
      const rows = ((data ?? []) as Array<{ seller_id: string | null; leads: number; qualified: number; converted: number; conversion_rate: number | null; avg_score: number | null; avg_first_contact_minutes: number | null }>)
        .map((r): CsvCell[] => [r.seller_id ? pMap.get(r.seller_id) ?? 'Usuário' : 'Sem responsável', int(r.leads), int(r.qualified), int(r.converted), rate(r.conversion_rate), rate(r.avg_score), formatMinutes(r.avg_first_contact_minutes)]);
      return csvResponse('leads-por-vendedor', toCsv(['Vendedor', 'Leads', 'Qualificados', 'Convertidos', 'Taxa de conversão (%)', 'Score médio', `Tempo médio até o 1º contato — ${stamp}`], rows));
    }
    if (kind === 'funnel') {
      const { data } = await db.rpc('lead_funnel', args);
      const list = (data ?? []) as Array<{ stage: keyof typeof FUNNEL_LABELS; ord: number; leads: number }>;
      const top = list.find((r) => r.stage === 'captured')?.leads ?? 0;
      const rows = list.sort((a, b) => a.ord - b.ord).map((r): CsvCell[] => [FUNNEL_LABELS[r.stage], int(r.leads), top === 0 ? '' : Math.round((r.leads / top) * 10000) / 100]);
      return csvResponse('funil', toCsv(['Etapa', 'Leads', `% dos capturados — ${stamp}`], rows));
    }
    if (kind === 'status') {
      const { data } = await db.rpc('lead_status_counts', args);
      const rows = ((data ?? []) as Array<{ status: LeadStatus; leads: number }>).map((r): CsvCell[] => [STATUS_LABELS[r.status], int(r.leads)]);
      return csvResponse('leads-por-status', toCsv(['Status', `Leads — ${stamp}`], rows));
    }
    const { data } = await db.rpc('lead_series', args);
    const rows = ((data ?? []) as Array<{ bucket: string; captured: number; qualified: number; converted: number; qualification_rate: number | null }>)
      .map((r): CsvCell[] => [formatDate(r.bucket), int(r.captured), int(r.qualified), int(r.converted), rate(r.qualification_rate)]);
    return csvResponse('leads-por-periodo', toCsv([`Início do período — ${stamp}`, 'Capturados', 'Qualificados', 'Convertidos', 'Taxa de qualificação (%)'], rows));
  }

  return NextResponse.json({ error: 'Relatório desconhecido.' }, { status: 404 });
}

export type { Classification };
