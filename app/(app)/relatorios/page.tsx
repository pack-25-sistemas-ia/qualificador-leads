import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/leads/access';
import { FUNNEL_LABELS, funnelRows } from '@/lib/leads/chart-rows';
import { loadDashboard } from '@/lib/leads/dashboard';
import { labelMap, listCampaigns, listForms, listSources, loadPeople, loadSettings, personOptions } from '@/lib/leads/data';
import { filtersToQuery, parseFilters, todayIn } from '@/lib/leads/filters';
import { formatDate, formatInt, formatMinutes, formatPct, formatScore } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Relatórios' };

const TH = 'px-3 py-2 text-left font-medium text-muted';
const TD = 'px-3 py-2 tabular-nums';
function Report({ title, description, csv, query, children }: { title: string; description: string; csv: string; query: string; children: React.ReactNode }) {
  return (
    <Card title={title} description={description}>
      <div className="mb-3 flex justify-end"><a className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/export/${csv}?${query}`}>Exportar CSV</a></div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const settings = await loadSettings(ctx);
  const filters = parseFilters(sp, todayIn(settings.timezone));
  const [people, campaigns, sources, forms, data] = await Promise.all([loadPeople(ctx), listCampaigns(ctx), listSources(ctx), manager ? listForms(ctx) : Promise.resolve([]), loadDashboard(ctx, filters)]);
  const labels = labelMap(people);
  const query = filtersToQuery(filters);
  const empty = <p className="py-4 text-sm text-muted">Sem dados no período selecionado.</p>;

  return (
    <>
      <PageHeader title="Relatórios" description={`De ${formatDate(filters.from)} a ${formatDate(filters.to)} (fuso ${settings.timezone}). Os mesmos números do painel, em tabela e CSV. Definições em docs/METRICS.md.`} />
      <FilterBar action="/relatorios" filters={filters} sellers={manager ? personOptions(people) : undefined} campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))} sources={sources} forms={forms.map((f) => ({ value: f.id, label: f.name }))} />
      {data.error ? <p className="text-sm text-danger">Não foi possível carregar os relatórios agora.</p> : (
        <div className="space-y-6">
          <Report title="Leads por origem" description="Origem informada pelo utm_source; sem UTM = direto." csv="by-source" query={query}>
            {data.sources.length === 0 ? empty : (
              <table className="w-full text-sm"><caption className="sr-only">Leads por origem</caption><thead><tr>{['Origem', 'Capturados', 'Qualificados', 'Taxa de qualificação', 'Score médio', 'Convertidos', 'Conversão'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>{data.sources.map((r) => <tr key={r.source} className="border-t border-border"><td className="px-3 py-2">{r.source}</td><td className={TD}>{formatInt(r.captured)}</td><td className={TD}>{formatInt(r.qualified)}</td><td className={TD}>{formatPct(r.qualification_rate)}</td><td className={TD}>{formatScore(r.avg_score)}</td><td className={TD}>{formatInt(r.converted)}</td><td className={TD}>{formatPct(r.conversion_rate)}</td></tr>)}</tbody></table>
            )}
          </Report>
          <Report title="Qualidade por campanha" description="Quais campanhas trazem leads melhores, não apenas mais leads." csv="by-campaign" query={query}>
            {data.campaigns.length === 0 ? empty : (
              <table className="w-full text-sm"><caption className="sr-only">Leads por campanha</caption><thead><tr>{['Campanha', 'Capturados', 'Qualificados', 'Taxa de qualificação', 'Score médio', 'Convertidos', 'Conversão'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>{data.campaigns.map((r) => <tr key={r.campaign_id ?? 'none'} className="border-t border-border"><td className="px-3 py-2">{r.campaign}</td><td className={TD}>{formatInt(r.captured)}</td><td className={TD}>{formatInt(r.qualified)}</td><td className={TD}>{formatPct(r.qualification_rate)}</td><td className={TD}>{formatScore(r.avg_score)}</td><td className={TD}>{formatInt(r.converted)}</td><td className={TD}>{formatPct(r.conversion_rate)}</td></tr>)}</tbody></table>
            )}
          </Report>
          <Report title="Funil do pipeline" description="Cada etapa contém a seguinte: capturados ⊇ em atendimento ⊇ contatados ⊇ convertidos." csv="funnel" query={query}>
            <table className="w-full text-sm"><caption className="sr-only">Funil</caption><thead><tr>{['Etapa', 'Leads', '% dos capturados'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody>{funnelRows(data.funnel).map((r) => <tr key={r.name} className="border-t border-border"><td className="px-3 py-2">{r.name}</td><td className={TD}>{formatInt(r.value)}</td><td className={TD}>{formatPct(r.pct)}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted">{Object.values(FUNNEL_LABELS).join(' → ')}</p>
          </Report>
          {manager ? (
            <Report title="Conversão por vendedor" description="Leads criados no período, agrupados pelo responsável atual." csv="by-seller" query={query}>
              {data.sellers.length === 0 ? empty : (
                <table className="w-full text-sm"><caption className="sr-only">Conversão por vendedor</caption><thead><tr>{['Vendedor', 'Leads', 'Qualificados', 'Convertidos', 'Conversão', 'Score médio', 'Tempo até o 1º contato'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                  <tbody>{data.sellers.map((r) => <tr key={r.seller_id ?? 'none'} className="border-t border-border"><td className="px-3 py-2">{r.seller_id ? labels.get(r.seller_id) ?? 'Usuário' : 'Sem responsável'}</td><td className={TD}>{formatInt(r.leads)}</td><td className={TD}>{formatInt(r.qualified)}</td><td className={TD}>{formatInt(r.converted)}</td><td className={TD}>{formatPct(r.conversion_rate)}</td><td className={TD}>{formatScore(r.avg_score)}</td><td className={TD}>{formatMinutes(r.avg_first_contact_minutes)}</td></tr>)}</tbody></table>
              )}
            </Report>
          ) : null}
          <Report title="Evolução no período" description="Capturados, qualificados e convertidos por dia, semana ou mês." csv="series" query={query}>
            {data.series.length === 0 ? empty : (
              <table className="w-full text-sm"><caption className="sr-only">Evolução</caption><thead><tr>{['Início', 'Capturados', 'Qualificados', 'Convertidos', 'Taxa de qualificação'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>{data.series.map((r) => <tr key={r.bucket} className="border-t border-border"><td className="px-3 py-2">{formatDate(r.bucket)}</td><td className={TD}>{formatInt(r.captured)}</td><td className={TD}>{formatInt(r.qualified)}</td><td className={TD}>{formatInt(r.converted)}</td><td className={TD}>{formatPct(r.qualification_rate)}</td></tr>)}</tbody></table>
            )}
          </Report>
        </div>
      )}
    </>
  );
}
