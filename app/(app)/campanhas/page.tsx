import type { Metadata } from 'next';
import { EmptyState, PageHeader, Card } from '@/components/ui/primitives';
import { CampaignForm } from '@/components/leads/admin-forms';
import { CampaignsTable } from '@/components/leads/tables';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/leads/access';
import { loadDashboard } from '@/lib/leads/dashboard';
import { listCampaigns, loadSettings } from '@/lib/leads/data';
import { parseFilters, todayIn } from '@/lib/leads/filters';
import { FilterBar } from '@/components/app/filter-bar';
import { listForms, listSources } from '@/lib/leads/data';
import { formatDate } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Campanhas' };

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const settings = await loadSettings(ctx);
  const filters = parseFilters(sp, todayIn(settings.timezone));
  const [campaigns, data, sources, forms] = await Promise.all([listCampaigns(ctx), loadDashboard(ctx, filters), listSources(ctx), manager ? listForms(ctx) : Promise.resolve([])]);
  const stats = Object.fromEntries(data.campaigns.filter((c) => c.campaign_id).map((c) => [c.campaign_id!, { captured: c.captured, qualified: c.qualified, avg: c.avg_score }]));
  const noCampaign = data.campaigns.find((c) => c.campaign_id === null);

  return (
    <>
      <PageHeader title="Campanhas" description={`Qualidade dos leads por campanha, de ${formatDate(filters.from)} a ${formatDate(filters.to)}. As campanhas nascem sozinhas do utm_campaign do link; cadastrar aqui serve para dar um nome amigável.`} />
      <FilterBar action="/campanhas" filters={filters} campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))} sources={sources} forms={forms.map((f) => ({ value: f.id, label: f.name }))} />
      <CampaignsTable rows={campaigns} stats={stats} empty={<EmptyState title="Nenhuma campanha ainda" description="Divulgue o link do formulário com ?utm_campaign=nome e ela aparece aqui automaticamente." />} />
      {noCampaign ? <p className="mt-3 text-sm text-muted">{noCampaign.captured} lead(s) no período vieram sem campanha (score médio {noCampaign.avg_score ?? '—'}).</p> : null}
      <p className="mt-2 text-xs text-muted">Custo, ROAS e CAC não são calculados aqui: o sistema não recebe dados de investimento dos anúncios.</p>
      {manager ? <div className="mt-6"><Card title="Cadastrar campanha"><CampaignForm /></Card></div> : null}
    </>
  );
}
