'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Alert, Button, Field, Select, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/app/modal';
import { changeStatus } from '@/lib/leads/actions';
import { LEAD_STATUSES, STATUS_LABELS, TRANSITIONS, canTransition, type LeadStatus } from '@/lib/leads/filters';
import { formatPhone, sourceLabel } from '@/lib/leads/format';
import { cn } from '@/lib/utils';
import { ScoreBadge } from './badges';

export type BoardLead = {
  id: string; name: string; company: string | null; email: string | null; phone: string | null; status: LeadStatus; score: number | null; classification: string | null;
  owner: string | null; source: string | null; canWrite: boolean;
};

function Card({ lead, busy, onMove }: { lead: BoardLead; busy: boolean; onMove: (id: string, to: LeadStatus) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, disabled: busy || !lead.canWrite || TRANSITIONS[lead.status].length === 0 });
  const targets = TRANSITIONS[lead.status];
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      aria-busy={busy}
      className={cn('rounded-md border border-border bg-card p-3 text-sm shadow-sm', isDragging && 'z-10 opacity-80 shadow-lg', busy && 'opacity-60')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/leads/${lead.id}`} className="block truncate font-medium underline-offset-2 hover:underline">{lead.name}</Link>
          <p className="truncate text-xs text-muted">{lead.company ?? lead.email ?? formatPhone(lead.phone)}</p>
        </div>
        {lead.canWrite && targets.length > 0 ? (
          <button type="button" aria-label={`Arrastar ${lead.name}. Use espaço e as setas para mover entre colunas.`} className="min-h-9 min-w-9 cursor-grab rounded border border-border text-muted active:cursor-grabbing" {...listeners} {...attributes}>⠿</button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ScoreBadge score={lead.score} classification={lead.classification} />
        <span className="text-xs text-muted">{sourceLabel(lead.source)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{lead.owner ?? <span className="text-warning">Sem responsável</span>}</p>
      {lead.canWrite && targets.length > 0 ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`mv-${lead.id}`}>Mover {lead.name} para</label>
          <Select id={`mv-${lead.id}`} value="" disabled={busy} onChange={(e) => { if (e.target.value) onMove(lead.id, e.target.value as LeadStatus); }} className="min-h-9 text-xs">
            <option value="">Mover para…</option>
            {targets.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </Select>
        </div>
      ) : null}
    </li>
  );
}

function Column({ status, leads, activeFrom, busy, onMove }: { status: LeadStatus; leads: BoardLead[]; activeFrom: LeadStatus | null; busy: ReadonlySet<string>; onMove: (id: string, to: LeadStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const allowed = activeFrom === null || canTransition(activeFrom, status);
  return (
    <section
      ref={setNodeRef}
      aria-label={`Coluna ${STATUS_LABELS[status]}`}
      className={cn('flex w-72 shrink-0 flex-col rounded-lg border border-border bg-black/[0.03] p-3 dark:bg-white/[0.03]', isOver && allowed && 'ring-2 ring-ring', activeFrom !== null && !allowed && 'opacity-50')}
    >
      <h3 className="mb-3 flex items-center justify-between text-sm font-semibold">{STATUS_LABELS[status]} <span className="rounded-full border border-border px-2 text-xs tabular-nums text-muted">{leads.length}</span></h3>
      <ul className="flex max-h-[70vh] min-h-16 flex-col gap-2 overflow-y-auto">
        {leads.map((l) => <Card key={l.id} lead={l} busy={busy.has(l.id)} onMove={onMove} />)}
        {leads.length === 0 ? <li className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted">Nenhum lead</li> : null}
      </ul>
    </section>
  );
}

/** Quadro do pipeline. Mover por arrastar, por teclado ou pelo seletor «Mover para…». As regras de transição são as do banco. */
export function Kanban({ leads, reasons }: { leads: BoardLead[]; reasons: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(leads);
  const [prev, setPrev] = useState(leads);
  if (prev !== leads) { setPrev(leads); setRows(leads); } // novos dados do servidor substituem o estado local
  const [activeFrom, setActiveFrom] = useState<LeadStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<{ id: string } | null>(null);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  function apply(id: string, to: LeadStatus, why: string) {
    const before = rows;
    setRows((r) => r.map((l) => (l.id === id ? { ...l, status: to } : l)));
    setBusy((b) => new Set(b).add(id)); // uma mudança por vez em cada lead: a próxima parte do estado já confirmado
    start(async () => {
      const res = await changeStatus(id, { status: to, reason: why });
      if (res.ok) { setMessage({ ok: true, text: 'Status atualizado.' }); router.refresh(); }
      else { setRows(before); setMessage({ ok: false, text: res.message ?? 'Não foi possível mover o lead.' }); }
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    });
  }

  function request(id: string, to: LeadStatus) {
    const lead = rows.find((l) => l.id === id);
    if (!lead || lead.status === to || busy.has(id)) return;
    if (!canTransition(lead.status, to)) { setMessage({ ok: false, text: `Não é possível ir de «${STATUS_LABELS[lead.status]}» para «${STATUS_LABELS[to]}».` }); return; }
    if (to === 'disqualified') { setAsk({ id }); setReason(''); setOther(''); return; }
    apply(id, to, '');
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveFrom(null);
    if (e.over) request(String(e.active.id), e.over.id as LeadStatus);
  }

  const finalReason = reason === '__other' ? other.trim() : reason;
  return (
    <div>
      <div className="mb-3 min-h-10" aria-live="polite">{message ? <Alert tone={message.ok ? 'success' : 'error'}>{message.text}</Alert> : null}</div>
      <DndContext sensors={sensors} onDragStart={(e) => setActiveFrom(rows.find((l) => l.id === String(e.active.id))?.status ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActiveFrom(null)}>
        <div className="relative flex gap-4 overflow-x-auto pb-4" tabIndex={0} aria-label="Quadro do pipeline (role para o lado)">
          {LEAD_STATUSES.map((s) => <Column key={s} status={s} leads={rows.filter((l) => l.status === s)} activeFrom={activeFrom} busy={busy} onMove={request} />)}
        </div>
      </DndContext>
      <Modal open={ask !== null} onClose={() => setAsk(null)} title="Motivo da desqualificação">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask || !finalReason) return;
            const id = ask.id;
            setAsk(null);
            apply(id, 'disqualified', finalReason);
          }}
        >
          <Field label="Motivo" name="board-reason">
            <Select id="board-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Selecione…</option>
              {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="__other">Outro (descrever)</option>
            </Select>
          </Field>
          {reason === '__other' ? <Field label="Descreva o motivo" name="board-other"><Textarea id="board-other" maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} className="min-h-16" /></Field> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={!finalReason}>Desqualificar</Button>
            <Button type="button" variant="secondary" onClick={() => setAsk(null)}>Cancelar</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
