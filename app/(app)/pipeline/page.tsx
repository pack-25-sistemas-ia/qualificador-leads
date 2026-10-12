import type { Metadata } from 'next';
import { Alert, PageHeader, Select, Button } from '@/components/ui/primitives';
import { Kanban, type BoardLead } from '@/components/leads/kanban';
import { requireContext } from '@/lib/auth/session';
import { canWriteLeads, isManager, one, type SearchParams } from '@/lib/leads/access';
import { BOARD_LIMIT, labelMap, listBoardLeads, listDisqualificationReasons, loadPeople, personOptions } from '@/lib/leads/data';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const sellerParam = one(sp.seller);
  const seller = manager && /^[0-9a-f-]{36}$/i.test(sellerParam) ? sellerParam : null;
  const [{ rows, truncated }, people, reasons] = await Promise.all([listBoardLeads(ctx, seller), loadPeople(ctx), listDisqualificationReasons(ctx)]);
  const labels = labelMap(people);
  const canWrite = canWriteLeads(ctx.membership.role);
  const leads: BoardLead[] = rows.map((l) => ({
    id: l.id, name: l.name, company: l.company_name, email: l.email, phone: l.phone, status: l.status, score: l.current_score, classification: l.qualification,
    owner: l.assigned_to ? labels.get(l.assigned_to) ?? 'Usuário' : null, source: l.source, canWrite: canWrite && l.anonymized_at === null,
  }));

  return (
    <>
      <PageHeader title="Pipeline" description="Arraste o lead entre as colunas, use o teclado (espaço e setas) ou o seletor «Mover para…». Só as transições válidas são aceitas.">
        {manager ? (
          <form action="/pipeline" method="get" className="flex items-end gap-2" aria-label="Filtrar por responsável">
            <div>
              <label htmlFor="seller" className="mb-1 block text-xs font-medium text-muted">Responsável</label>
              <Select id="seller" name="seller" defaultValue={seller ?? ''} className="w-48">
                <option value="">Todos</option>
                {personOptions(people).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </div>
            <Button type="submit" variant="secondary">Filtrar</Button>
          </form>
        ) : null}
      </PageHeader>
      {truncated ? <div className="mb-4"><Alert tone="info">Mostrando os {BOARD_LIMIT} leads mais recentes. Use «Leads» para ver os demais, com filtros.</Alert></div> : null}
      <Kanban leads={leads} reasons={reasons} />
    </>
  );
}
