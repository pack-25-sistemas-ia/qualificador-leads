import { Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/leads/format';
import { ACTIVITY_LABELS, CLASS_LABELS, STATUS_LABELS, type ActivityType } from '@/lib/leads/filters';
import type { ActivityRow, AssignmentRow, HistoryRow, ScoreEventRow } from '@/lib/leads/data';
import type { FormField, FormSchema } from '@/lib/leads/formlogic';
import { ActivityToggle } from './lead-forms';

/** Respostas do formulário com os RÓTULOS das perguntas (não as chaves), na ordem do formulário. */
export function AnswersList({ schema, answers }: { schema: FormSchema | null; answers: Record<string, unknown> }) {
  const fields: Array<Pick<FormField, 'key' | 'label' | 'options' | 'type'>> = schema?.fields ?? Object.keys(answers).map((k) => ({ key: k, label: k, type: 'text' as const }));
  const shown = fields.filter((f) => f.type !== 'consent' && answers[f.key] !== undefined);
  if (shown.length === 0) return <p className="text-sm text-muted">Sem respostas registradas (lead cadastrado manualmente, importado ou anonimizado).</p>;
  const text = (f: Pick<FormField, 'options'>, v: unknown): string => {
    const opt = (x: unknown) => f.options?.find((o) => o.value === x)?.label ?? String(x);
    if (Array.isArray(v)) return v.map(opt).join(', ');
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    return opt(v);
  };
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {shown.map((f) => (
        <div key={f.key}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm">{text(f, answers[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Por que o lead tem esta nota: cada regra aplicada, os pontos e os dados que faltam. */
export function ScoreExplanation({ event, labelOf }: { event: ScoreEventRow | undefined; labelOf: (key: string) => string }) {
  if (!event) return <p className="text-sm text-muted">Este lead ainda não foi pontuado (não há modelo publicado ou ele não veio de um formulário).</p>;
  const x = event.explanation_json;
  return (
    <div className="space-y-3 text-sm">
      <p>
        <strong className="text-lg tabular-nums">{event.score}</strong> <span className="text-muted">/ 100 · {CLASS_LABELS[event.classification]} · {event.qualified ? 'qualificado' : 'não qualificado'}</span>
      </p>
      {(x.applied ?? []).length > 0 ? (
        <ul className="space-y-1">
          {x.applied!.map((a, i) => (
            <li key={`${a.rule_id ?? i}`} className="flex justify-between gap-3 border-b border-border py-1 last:border-0">
              <span>{a.label}</span>
              <span className={`tabular-nums font-medium ${a.points < 0 ? 'text-danger' : ''}`}>{a.points > 0 ? '+' : ''}{a.points}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted">Nenhuma regra de pontuação foi atendida.</p>}
      {x.raw_total !== undefined && x.raw_total !== event.score ? <p className="text-xs text-muted">Soma bruta {x.raw_total}; o score é limitado a 0–100.</p> : null}
      {(x.missing ?? []).length > 0 ? (
        <p className="rounded-md border border-warning p-2 text-xs"><strong>Dados ausentes que influenciariam a nota:</strong> {x.missing!.map(labelOf).join(', ')}.</p>
      ) : null}
      <p className="text-xs text-muted">Modelo «{x.model_name ?? '—'}» versão {x.model_version ?? '—'} · avaliado em {formatDateTime(event.evaluated_at)}</p>
    </div>
  );
}

export function ScoreHistory({ events, timezone }: { events: ScoreEventRow[]; timezone: string }) {
  if (events.length <= 1) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Histórico de score ({events.length})</summary>
      <ol className="mt-2 space-y-1">
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 text-xs">
            <span>{formatDateTime(e.evaluated_at, timezone)} · modelo v{e.explanation_json.model_version ?? '—'}</span>
            <span className="tabular-nums">{e.score} · {CLASS_LABELS[e.classification]}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function StatusTimeline({ history, assignments, labels, timezone }: { history: HistoryRow[]; assignments: AssignmentRow[]; labels: Map<string, string>; timezone: string }) {
  type Item = { at: string; key: string; text: string };
  const items: Item[] = [
    ...history.map((h) => ({ at: h.changed_at, key: `h${h.id}`, text: `${h.previous_status ? `${STATUS_LABELS[h.previous_status]} → ` : 'Entrou como '}${STATUS_LABELS[h.new_status]}${h.reason ? ` · ${h.reason}` : ''}` })),
    ...assignments.map((a) => ({
      at: a.assigned_at, key: `a${a.id}`,
      text: `${a.assigned_to ? `Atribuído a ${labels.get(a.assigned_to) ?? 'usuário'}` : 'Devolvido à fila'} (${a.assignment_method === 'round_robin' ? 'rodízio' : a.assignment_method === 'criteria' ? 'por critério' : a.assignment_method === 'system' ? 'automático' : 'manual'})`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (items.length === 0) return <p className="text-sm text-muted">Sem eventos.</p>;
  return (
    <ol className="space-y-3 border-l border-border pl-4" aria-label="Histórico do lead">
      {items.map((i) => (
        <li key={i.key} className="relative text-sm">
          <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
          <p className="font-medium">{i.text}</p>
          <p className="text-xs text-muted">{formatDateTime(i.at, timezone)}</p>
        </li>
      ))}
    </ol>
  );
}

export function ActivityList({ activities, leadId, canWrite, labels, timezone, now }: { activities: ActivityRow[]; leadId: string; canWrite: boolean; labels: Map<string, string>; timezone: string; now: number }) {
  if (activities.length === 0) return <p className="text-sm text-muted">Nenhuma atividade registrada.</p>;
  return (
    <ul className="space-y-3">
      {activities.map((a) => {
        const done = a.completed_at !== null;
        const late = !done && a.due_at !== null && Date.parse(a.due_at) < now;
        return (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {ACTIVITY_LABELS[a.type as ActivityType] ?? a.type} {done ? <Badge tone="success">Concluída</Badge> : late ? <Badge tone="danger">Atrasada</Badge> : <Badge tone="warning">Agendada</Badge>}
              </p>
              {a.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted">{a.description}</p> : null}
              <p className="mt-1 text-xs text-muted">
                {a.user_id ? `${labels.get(a.user_id) ?? 'Usuário'} · ` : ''}criada em {formatDateTime(a.created_at, timezone)}
                {a.due_at ? ` · prazo ${formatDateTime(a.due_at, timezone)}` : ''}{a.completed_at ? ` · concluída em ${formatDateTime(a.completed_at, timezone)}` : ''}
              </p>
            </div>
            {canWrite ? <ActivityToggle id={a.id} leadId={leadId} done={done} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
