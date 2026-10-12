import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { LeadsTable } from '@/components/leads/tables';
import { requireContext } from '@/lib/auth/session';
import { canWriteLeads, isManager, one, type SearchParams } from '@/lib/leads/access';
import { labelMap, listCampaigns, listLeads, listSources, loadPeople, loadSettings, parsePage, personOptions, searchToken } from '@/lib/leads/data';
import { CLASS_LABELS, CLASSES, LEAD_STATUSES, STATUS_LABELS } from '@/lib/leads/filters';

export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const q = searchToken(sp.q);
  const pick = (key: string, allowed?: readonly string[]) => { const v = one(sp[key]); return v && (!allowed || allowed.includes(v)) ? v : ''; };
  const uuidOrEmpty = (key: string) => { const v = one(sp[key]); return /^[0-9a-f-]{36}$/i.test(v) ? v : ''; };
  const filters = {
    q, status: pick('status', LEAD_STATUSES), classification: pick('class', CLASSES), source: searchToken(sp.source), campaign: uuidOrEmpty('campaign'), seller: manager ? uuidOrEmpty('seller') : '',
    unassigned: one(sp.unassigned) === '1', review: one(sp.review) === '1', archived: one(sp.archived) === '1', page: parsePage(sp.page),
  };
  const [{ rows, total }, people, campaigns, sources, settings] = await Promise.all([listLeads(ctx, filters), loadPeople(ctx), listCampaigns(ctx), listSources(ctx), loadSettings(ctx)]);
  const owners = Object.fromEntries(labelMap(people));
  const params = { q, status: filters.status, class: filters.classification, source: filters.source, campaign: filters.campaign, seller: filters.seller, unassigned: filters.unassigned ? '1' : '', review: filters.review ? '1' : '', archived: filters.archived ? '1' : '' };
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const chip = (label: string, key: 'unassigned' | 'review' | 'archived') => {
    const next = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== key));
    if (!filters[key]) next.set(key, '1');
    const on = filters[key];
    return <Link key={key} href={`/leads?${next.toString()}`} aria-pressed={on} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'}`}>{label}</Link>;
  };

  return (
    <>
      <PageHeader title="Leads" description={manager ? 'Todos os leads da organização.' : 'Os leads atribuídos a você.'}>
        <div className="flex flex-wrap gap-2">
          {manager ? <a className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/export/leads${exportQs ? `?${exportQs}` : ''}`}>Exportar CSV</a> : null}
          {manager ? <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href="/leads/importar">Importar CSV</Link> : null}
          {canWriteLeads(ctx.membership.role) ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/leads/novo">Novo lead</Link> : null}
        </div>
      </PageHeader>

      <ListFilters
        action="/leads" q={q} placeholder="Nome, e-mail, telefone ou empresa"
        selects={[
          { name: 'status', label: 'Status', value: filters.status, all: 'Todos', options: LEAD_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) },
          { name: 'class', label: 'Classificação', value: filters.classification, all: 'Todas', options: CLASSES.map((c) => ({ value: c, label: CLASS_LABELS[c] })) },
          { name: 'source', label: 'Origem', value: filters.source, all: 'Todas', options: sources.map((s) => ({ value: s, label: s })) },
          { name: 'campaign', label: 'Campanha', value: filters.campaign, all: 'Todas', options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
          ...(manager ? [{ name: 'seller', label: 'Responsável', value: filters.seller, all: 'Todos', options: personOptions(people) }] : []),
        ]}
        hidden={{ ...(filters.unassigned ? { unassigned: '1' } : {}), ...(filters.review ? { review: '1' } : {}), ...(filters.archived ? { archived: '1' } : {}) }}
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtros rápidos">
        {manager ? chip('Sem responsável', 'unassigned') : null}
        {manager ? chip('Revisar duplicidade', 'review') : null}
        {chip('Arquivados', 'archived')}
      </div>

      <LeadsTable
        rows={rows} owners={owners} timezone={settings.timezone}
        empty={<EmptyState title="Nenhum lead encontrado" description="Ajuste os filtros, publique um formulário para captar leads ou cadastre o primeiro manualmente."><Link className="underline" href="/formularios">Ver formulários</Link></EmptyState>}
      />
      <Pagination basePath="/leads" page={filters.page} total={total} params={params} />
    </>
  );
}
