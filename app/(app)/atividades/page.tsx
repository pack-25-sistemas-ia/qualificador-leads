import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ActivityToggle } from '@/components/leads/lead-forms';
import { requireContext } from '@/lib/auth/session';
import { nowIso } from '@/lib/time';
import { canWriteLeads, isManager, one, type SearchParams } from '@/lib/leads/access';
import { labelMap, listOpenActivities, loadPeople, loadSettings } from '@/lib/leads/data';
import { ACTIVITY_LABELS, type ActivityType } from '@/lib/leads/filters';
import { formatDateTime } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Atividades' };

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const mine = !manager || one(sp.mine) === '1';
  const [acts, people, settings] = await Promise.all([listOpenActivities(ctx, mine), loadPeople(ctx), loadSettings(ctx)]);
  const labels = labelMap(people);
  const now = Date.parse(nowIso());
  const late = acts.filter((a) => a.due_at && Date.parse(a.due_at) < now);
  const rest = acts.filter((a) => !(a.due_at && Date.parse(a.due_at) < now));
  const canWrite = canWriteLeads(ctx.membership.role);

  const Item = ({ a }: { a: (typeof acts)[number] }) => (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium"><Link className="underline-offset-2 hover:underline" href={`/leads/${a.lead_id}`}>{a.lead_name}</Link> · {ACTIVITY_LABELS[a.type as ActivityType] ?? a.type}</p>
        {a.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted">{a.description}</p> : null}
        <p className="mt-1 text-xs text-muted">{a.due_at ? `Prazo ${formatDateTime(a.due_at, settings.timezone)}` : 'Sem prazo'}{a.user_id ? ` · ${labels.get(a.user_id) ?? 'Usuário'}` : ''}</p>
      </div>
      {canWrite ? <ActivityToggle id={a.id} leadId={a.lead_id} done={false} /> : null}
    </li>
  );

  return (
    <>
      <PageHeader title="Atividades e follow-ups" description={mine ? 'Suas atividades em aberto.' : 'Atividades em aberto da equipe.'}>
        {manager ? <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={mine ? '/atividades' : '/atividades?mine=1'}>{mine ? 'Ver da equipe' : 'Ver só as minhas'}</Link> : null}
      </PageHeader>
      {acts.length === 0 ? <EmptyState title="Nada pendente" description="Registre uma atividade agendada no lead para criar um follow-up." /> : (
        <div className="space-y-6">
          {late.length ? <section aria-label="Atrasadas"><h2 className="mb-2 flex items-center gap-2 text-base font-semibold">Atrasadas <Badge tone="danger">{late.length}</Badge></h2><ul className="space-y-2">{late.map((a) => <Item key={a.id} a={a} />)}</ul></section> : null}
          {rest.length ? <section aria-label="Próximas"><h2 className="mb-2 flex items-center gap-2 text-base font-semibold">Próximas e sem prazo <Badge tone="warning">{rest.length}</Badge></h2><ul className="space-y-2">{rest.map((a) => <Item key={a.id} a={a} />)}</ul></section> : null}
        </div>
      )}
    </>
  );
}
