import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ScoreBadge, StatusBadge } from '@/components/leads/badges';
import { ActivityForm, AnalyzeButton, AssignControl, LeadEditForm, StatusControl } from '@/components/leads/lead-forms';
import { LeadHeaderActions } from '@/components/leads/lead-actions';
import { ActivityList, AnswersList, ScoreExplanation, ScoreHistory, StatusTimeline } from '@/components/leads/lead-detail-bits';
import { readAiEnv } from '@/lib/leads/ai';
import { requireContext } from '@/lib/auth/session';
import { nowIso } from '@/lib/time';
import { canWriteLeads, isLeadAdmin, isManager } from '@/lib/leads/access';
import { labelMap, listDisqualificationReasons, loadAiConfig, loadLead, loadPeople, loadSettings, personOptions } from '@/lib/leads/data';
import { formatDateTime, formatPhone, sourceLabel } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const detail = await loadLead(ctx, id);
  if (!detail) notFound();
  const role = ctx.membership.role;
  const manager = isManager(role);
  const [people, settings, reasons, aiCfg] = await Promise.all([loadPeople(ctx), loadSettings(ctx), listDisqualificationReasons(ctx), loadAiConfig(ctx)]);
  const labels = labelMap(people);
  const { lead } = detail;
  const canWrite = canWriteLeads(role) && !lead.archived_at && !lead.anonymized_at;
  const keyLabel = (k: string) => detail.schema?.fields.find((f) => f.key === k)?.label ?? k;
  const aiReady = aiCfg.enabled && readAiEnv() !== null;
  const now = Date.parse(nowIso());
  const tz = settings.timezone;

  return (
    <>
      <PageHeader title={lead.name} description={[lead.company_name, lead.segment].filter(Boolean).join(' · ') || undefined}>
        <LeadHeaderActions id={lead.id} archived={Boolean(lead.archived_at)} anonymized={Boolean(lead.anonymized_at)} canManage={manager} canAdmin={isLeadAdmin(role)} />
      </PageHeader>

      {lead.anonymized_at ? <div className="mb-4"><Alert tone="info">Este lead foi anonimizado em {formatDateTime(lead.anonymized_at, tz)}. Os dados pessoais e as respostas foram removidos; os números agregados foram mantidos.</Alert></div> : null}
      {lead.archived_at ? <div className="mb-4"><Alert tone="warning">Lead arquivado. Restaure para editar ou mover no pipeline.</Alert></div> : null}
      {lead.needs_review ? <div className="mb-4"><Alert tone="warning">Possível duplicado{lead.duplicate_of ? <> de <Link className="underline" href={`/leads/${lead.duplicate_of}`}>outro lead</Link></> : null}. Confira e arquive o que sobrar.</Alert></div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Resumo">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={lead.status} />
              <ScoreBadge score={lead.current_score} classification={lead.qualification} />
              {lead.qualified ? <Badge tone="success">Qualificado</Badge> : null}
              {lead.disqualify_reason ? <Badge tone="danger">Motivo: {lead.disqualify_reason}</Badge> : null}
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
              <div><dt className="text-xs text-muted">E-mail</dt><dd className="break-all">{lead.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Telefone</dt><dd>{formatPhone(lead.phone) || '—'}</dd></div>
              <div><dt className="text-xs text-muted">Responsável</dt><dd>{lead.assigned_to ? labels.get(lead.assigned_to) ?? 'Usuário' : <span className="text-warning">Sem responsável</span>}</dd></div>
              <div><dt className="text-xs text-muted">Origem</dt><dd>{sourceLabel(lead.source)}{lead.medium ? ` / ${lead.medium}` : ''}</dd></div>
              <div><dt className="text-xs text-muted">Campanha</dt><dd>{detail.campaign?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Formulário</dt><dd>{detail.form ? (manager ? <Link className="underline" href={`/formularios/${detail.form.id}`}>{detail.form.name}</Link> : detail.form.name) : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Criado em</dt><dd>{formatDateTime(lead.created_at, tz)}</dd></div>
              <div><dt className="text-xs text-muted">Primeiro contato</dt><dd>{formatDateTime(lead.first_contact_at, tz)}</dd></div>
            </dl>
            {lead.notes ? <p className="mt-4 whitespace-pre-wrap break-words rounded-md bg-black/5 p-3 text-sm dark:bg-white/5">{lead.notes}</p> : null}
            {detail.submission ? (
              <p className="mt-3 text-xs text-muted">
                UTM: {[detail.submission.utm_source, detail.submission.utm_medium, detail.submission.utm_campaign, detail.submission.utm_content, detail.submission.utm_term].filter(Boolean).join(' · ') || 'nenhum'}
                {detail.submission.consent_given ? ' · consentimento registrado' : ''}
              </p>
            ) : null}
          </Card>

          <Card title="Respostas do formulário" description="Como o lead respondeu, com as perguntas na ordem do formulário.">
            <AnswersList schema={detail.schema} answers={detail.submission?.answers_json ?? {}} />
          </Card>

          <Card title="Atividades e follow-ups" description="A primeira atividade concluída marca o primeiro contato. Tarefa apenas agendada não conta.">
            {canWrite ? <div className="mb-6"><ActivityForm leadId={lead.id} /></div> : null}
            <ActivityList activities={detail.activities} leadId={lead.id} canWrite={canWrite} labels={labels} timezone={tz} now={now} />
          </Card>

          {canWrite ? (
            <Card title="Editar dados do lead">
              <LeadEditForm id={lead.id} initial={{ name: lead.name, email: lead.email ?? '', phone: lead.phone ?? '', company_name: lead.company_name ?? '', segment: lead.segment ?? '', notes: lead.notes ?? '' }} />
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Por que esta nota?" description="O score é calculado por regras transparentes; não é decisão automática sobre pessoas.">
            <ScoreExplanation event={detail.scores[0]} labelOf={keyLabel} />
            <div className="mt-3"><ScoreHistory events={detail.scores} timezone={tz} /></div>
          </Card>

          {canWrite ? <Card title="Pipeline"><StatusControl id={lead.id} status={lead.status} reasons={reasons} /></Card> : null}
          {manager && !lead.archived_at && !lead.anonymized_at ? <Card title="Atribuição"><AssignControl id={lead.id} current={lead.assigned_to} people={personOptions(people)} /></Card> : null}

          <Card title="Análise por IA (opcional)" description="Sugestão em texto, separada do score. Não altera a nota nem decide nada sobre a pessoa.">
            {detail.analyses[0]?.status === 'ok' ? (
              <div className="space-y-2 text-sm">
                <p className="whitespace-pre-wrap">{String(detail.analyses[0].analysis_json.summary ?? '')}</p>
                {(['strengths', 'risks', 'next_steps'] as const).map((k) => {
                  const list = detail.analyses[0]!.analysis_json[k];
                  return Array.isArray(list) && list.length ? (
                    <div key={k}><p className="text-xs font-medium text-muted">{k === 'strengths' ? 'Pontos fortes' : k === 'risks' ? 'Riscos' : 'Próximos passos'}</p><ul className="list-disc pl-5">{list.map((x, i) => <li key={i}>{String(x)}</li>)}</ul></div>
                  ) : null;
                })}
                <p className="text-xs text-muted">Gerada em {formatDateTime(detail.analyses[0].created_at, tz)} · {detail.analyses[0].model}</p>
              </div>
            ) : detail.analyses[0]?.status === 'failed' ? <p className="text-sm text-danger">A última tentativa falhou: {detail.analyses[0].error_message ?? 'erro do provedor'}.</p> : null}
            {aiReady && canWrite ? <div className="mt-3"><AnalyzeButton leadId={lead.id} /></div> : <p className="mt-2 text-xs text-muted">{aiReady ? '' : 'Desabilitada. Um administrador pode habilitar em Configurações (docs/DEPLOYMENT.md).'}</p>}
          </Card>

          <Card title="Histórico"><StatusTimeline history={detail.history} assignments={detail.assignments} labels={labels} timezone={tz} /></Card>
        </div>
      </div>
    </>
  );
}
