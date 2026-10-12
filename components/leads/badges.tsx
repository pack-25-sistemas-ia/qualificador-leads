import { Badge } from '@/components/ui/primitives';
import { CLASS_LABELS, STATUS_LABELS, type LeadStatus } from '@/lib/leads/filters';
import { scoreTone } from '@/lib/leads/format';

const STATUS_TONE: Record<LeadStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  new: 'neutral', qualifying: 'warning', qualified: 'warning', contacted: 'warning', converted: 'success', disqualified: 'danger',
};

/** Status no pipeline. O texto sempre acompanha a cor (não depende só da cor). */
export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

/** Score com a classificação em texto: «82 · Quente». */
export function ScoreBadge({ score, classification }: { score: number | null; classification: string | null }) {
  if (score === null || !classification) return <span className="text-xs text-muted">Sem score</span>;
  const tone = scoreTone(classification);
  const t = tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'neutral';
  return <Badge tone={t}>{score} · {CLASS_LABELS[classification as 'hot' | 'warm' | 'cold'] ?? classification}</Badge>;
}
