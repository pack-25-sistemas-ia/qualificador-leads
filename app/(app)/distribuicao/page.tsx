import type { Metadata } from 'next';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { DistributeButton, DistributionRuleForm, DistributionRules, SellerList } from '@/components/leads/admin-forms';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';
import { listDistributionRules, listSellers, loadPeople, loadSettings, personOptions } from '@/lib/leads/data';
import { STRATEGY_LABELS } from '@/lib/leads/validation';

export const metadata: Metadata = { title: 'Distribuição' };

export default async function DistributionPage() {
  const ctx = await requireContext(MANAGER_ROLES);
  const [people, sellers, rules, settings] = await Promise.all([loadPeople(ctx), listSellers(ctx), listDistributionRules(ctx), loadSettings(ctx)]);
  const options = personOptions(people);
  const { count } = await ctx.supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.membership.organization_id).is('assigned_to', null).is('archived_at', null).not('status', 'in', '(converted,disqualified)');
  const waiting = count ?? 0;

  return (
    <>
      <PageHeader title="Distribuição de leads" description="Quem recebe cada lead novo. A atribuição é feita no banco, com trava, e nunca duplica." />
      <div className="mb-4"><Alert tone="info">Estratégia atual: <strong>{STRATEGY_LABELS[settings.assignment_strategy]}</strong>. Para mudar, use Configurações (somente administração).</Alert></div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Leads aguardando" description="Leads em aberto sem responsável.">
          <p className="mb-3 text-3xl font-semibold tabular-nums">{waiting}</p>
          <DistributeButton disabled={waiting === 0} />
          {waiting === 0 ? <p className="mt-2 text-sm text-muted">Nenhum lead aguardando.</p> : null}
          {settings.assignment_strategy === 'manual' && waiting > 0 ? <p className="mt-2 text-xs text-muted">Na estratégia manual, atribua pelo lead ou pelo pipeline; o botão acima distribui conforme a estratégia atual, então mude a estratégia antes se quiser automatizar.</p> : null}
        </Card>
        <Card title="Vendedores no rodízio"><SellerList sellers={sellers} people={options} /></Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Regras por critério" description="Avaliadas na ordem de prioridade; a primeira que servir atribui. Usam as respostas do formulário.">
          <DistributionRules rules={rules} people={options} />
        </Card>
        <Card title="Nova regra">{options.length ? <DistributionRuleForm people={options} /> : <p className="text-sm text-muted">Não há usuários para receber leads.</p>}</Card>
      </div>
    </>
  );
}
