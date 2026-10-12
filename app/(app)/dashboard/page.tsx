import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import { CampaignChartClient, CapturedChartClient, ClassChartClient, ContactChartClient, FunnelChartClient, QualificationRateChartClient, ScoreChartClient, SellerChartClient, SourceChartClient } from '@/components/leads/charts-loader';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/leads/access';
import { ALERT_LINKS, ALERT_TITLES, classRows, funnelRows, periodRows, sellerRows, sourceRows } from '@/lib/leads/chart-rows';
import { loadDashboard } from '@/lib/leads/dashboard';
import { labelMap, listCampaigns, listForms, listSources, loadPeople, loadSettings, personOptions } from '@/lib/leads/data';
import { filtersToQuery, parseFilters, todayIn } from '@/lib/leads/filters';
import { formatDate, formatInt, formatMinutes, formatPct, formatScore, variationPct } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Painel' };

function Kpi({ label, value, hint, help, trend, muted }: { label: string; value: string; hint: string; help: string; trend?: string | null; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" title={help}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? 'text-muted' : ''}`}>{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
      {trend ? <p className="mt-1 text-xs font-medium">{trend}</p> : null}
    </div>
  );
}

/** Variação em texto ("▲ +12,5% vs período anterior"): não depende só de cor. */
function trendText(v: number | null, suffix = '%'): string | null {
  if (v === null) return null;
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '■';
  return `${arrow} ${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suffix} vs período anterior`;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await loadSettings(ctx);
  const filters = parseFilters(sp, todayIn(settings.timezone));
  const manager = isManager(ctx.membership.role);
  const [people, campaigns, sources, forms, data] = await Promise.all([loadPeople(ctx), listCampaigns(ctx), listSources(ctx), manager ? listForms(ctx) : Promise.resolve([]), loadDashboard(ctx, filters)]);
  const labels = labelMap(people);
  const query = filtersToQuery(filters);

  if (data.error || !data.kpis) {
    return (
      <>
        <PageHeader title="Painel" />
        <Alert tone="error">Não foi possível carregar os indicadores agora. Tente novamente em instantes.</Alert>
      </>
    );
  }

  const k = data.kpis;
  const p = data.previous;
  const empty = k.captured === 0;
  const alerts = data.alerts.filter((a) => a.leads > 0);

  return (
    <>
      <PageHeader title="Painel" description={`Período: ${formatDate(filters.from)} a ${formatDate(filters.to)} (fuso ${settings.timezone}). Números calculados do banco de dados; fórmulas em docs/METRICS.md.`}>
        <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/relatorios?${query}`}>Relatórios</Link>
      </PageHeader>

      <FilterBar action="/dashboard" filters={filters} sellers={manager ? personOptions(people) : undefined} campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))} sources={sources} forms={forms.map((f) => ({ value: f.id, label: f.name }))} />
      {!manager ? <div className="mb-4"><Alert tone="info">Você vê os números dos leads atribuídos a você.</Alert></div> : null}
      {empty ? <div className="mb-4"><Alert tone="info">Ainda não há leads neste período. Publique um formulário em «Formulários», importe uma lista em «Leads» ou amplie o período.</Alert></div> : null}

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Leads capturados" value={formatInt(k.captured)} hint="Leads criados no período." help="Quantidade de leads criados no período (formulário, importação ou cadastro manual)." trend={trendText(variationPct(k.captured, p?.captured ?? null))} />
        <Kpi label="Leads qualificados" value={formatInt(k.qualified)} hint="Score igual ou acima do mínimo de qualificação." help="Leads do período cujo score atual é maior ou igual ao mínimo de qualificação do modelo." trend={trendText(variationPct(k.qualified, p?.qualified ?? null))} />
        <Kpi label="Taxa de qualificação" value={formatPct(k.qualification_rate)} hint={k.qualification_rate === null ? 'Sem leads no período' : `${k.qualified} qualificado(s) ÷ ${k.captured} capturado(s)`} help="Qualificados ÷ capturados × 100. Leads ainda sem score contam no total." muted={k.qualification_rate === null} trend={p && k.qualification_rate !== null && p.qualification_rate !== null ? trendText(Math.round((k.qualification_rate - p.qualification_rate) * 10) / 10, ' p.p.') : null} />
        <Kpi label="Score médio" value={formatScore(k.avg_score)} hint={k.avg_score === null ? 'Sem leads com score' : 'Média dos leads com score (0 a 100).'} help="Média do score atual dos leads do período que têm score." muted={k.avg_score === null} />
        <Kpi label="Leads quentes" value={formatInt(k.hot)} hint="Score na faixa quente do modelo." help="Leads do período classificados como quentes pelas faixas do modelo publicado." trend={trendText(variationPct(k.hot, p?.hot ?? null))} />
        <Kpi label="Leads convertidos" value={formatInt(k.converted)} hint="Dos criados no período, os que viraram clientes." help="Coorte: leads criados no período que hoje estão convertidos." trend={trendText(variationPct(k.converted, p?.converted ?? null))} />
        <Kpi label="Taxa de conversão" value={formatPct(k.conversion_rate)} hint={k.conversion_rate === null ? 'Sem leads no período' : `${k.converted} convertido(s) ÷ ${k.captured} capturado(s)`} help="Convertidos ÷ capturados × 100, entre os leads criados no período (coorte)." muted={k.conversion_rate === null} trend={p && k.conversion_rate !== null && p.conversion_rate !== null ? trendText(Math.round((k.conversion_rate - p.conversion_rate) * 10) / 10, ' p.p.') : null} />
        <Kpi label="Tempo até o 1º contato" value={formatMinutes(k.avg_first_contact_minutes)} hint={k.avg_first_contact_minutes === null ? 'Nenhum contato registrado' : 'Média entre a criação e a primeira atividade concluída.'} help="Média, em minutos, da criação do lead até a primeira atividade concluída. Tarefa apenas agendada não conta." muted={k.avg_first_contact_minutes === null} />
        <Kpi label="Sem responsável" value={formatInt(k.unassigned)} hint="Situação atual (não depende do período)." help="Leads em aberto que ainda não têm vendedor responsável." />
        <Kpi label="Follow-ups atrasados" value={formatInt(k.overdue_followups)} hint="Leads com atividade vencida e não concluída (agora)." help="Quantidade de leads com ao menos uma atividade agendada, vencida e não concluída." />
      </section>

      <section aria-label="Gráficos" className="mt-6 grid gap-4 lg:grid-cols-2">
        <CapturedChartClient rows={periodRows(data.series)} />
        <QualificationRateChartClient rows={periodRows(data.series)} />
        <ScoreChartClient rows={data.scores.map((s) => ({ label: s.label, leads: s.leads }))} />
        <ClassChartClient rows={classRows(data.classes)} />
        <SourceChartClient rows={sourceRows(data.sources)} />
        <CampaignChartClient rows={data.campaigns.slice(0, 10).map((c) => ({ name: c.campaign, captured: c.captured, qualified: c.qualified, avg: c.avg_score }))} />
        <FunnelChartClient rows={funnelRows(data.funnel)} />
        <SellerChartClient rows={sellerRows(data.sellers, labels)} />
        <ContactChartClient rows={data.contact.map((c) => ({ name: c.bucket, value: c.leads }))} />
      </section>

      <section aria-label="Alertas" className="mt-6">
        <Card title="Alertas" description={`Situação de agora. «Quente sem contato» considera leads sem atividade concluída há mais de ${settings.alert_no_contact_hours} h.`}>
          {alerts.length === 0 ? <p className="text-sm text-muted">Nenhum alerta no momento. Tudo em dia.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {alerts.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <Link className="font-medium underline-offset-2 hover:underline" href={ALERT_LINKS[a.key]}>{ALERT_TITLES[a.key]}</Link>
                  <Badge tone={a.key === 'hot_without_contact' || a.key === 'overdue_followups' ? 'danger' : 'warning'}>{a.leads}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
