'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { formatDay, formatPhone, sourceLabel } from '@/lib/leads/format';
import type { CampaignRow, LeadRow } from '@/lib/leads/data';
import { ACTIVITY_LABELS, type ActivityType } from '@/lib/leads/filters';
import { ScoreBadge, StatusBadge } from './badges';

const dash = <span className="text-muted">—</span>;

export function LeadsTable({ rows, owners, timezone, empty }: { rows: LeadRow[]; owners: Record<string, string>; timezone: string; empty: React.ReactNode }) {
  const columns: ColumnDef<LeadRow, unknown>[] = [
    {
      accessorKey: 'name', header: 'Lead',
      cell: ({ row }) => (
        <div>
          <Link className="font-medium underline-offset-2 hover:underline" href={`/leads/${row.original.id}`}>{row.original.name}</Link>
          {row.original.needs_review ? <span className="ml-2"><Badge tone="warning">Revisar duplicidade</Badge></span> : null}
          <div className="text-xs text-muted">{row.original.company_name ?? ''}</div>
        </div>
      ),
    },
    { id: 'contact', header: 'Contato', enableSorting: false, cell: ({ row }) => <div className="text-xs"><div>{row.original.email ?? dash}</div><div className="text-muted">{formatPhone(row.original.phone)}</div></div> },
    { accessorKey: 'current_score', header: 'Score', cell: ({ row }) => <ScoreBadge score={row.original.current_score} classification={row.original.qualification} /> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'owner', header: 'Responsável', accessorFn: (r) => (r.assigned_to ? owners[r.assigned_to] ?? '' : ''), cell: ({ getValue }) => (getValue() as string) || <span className="text-xs text-warning">Sem responsável</span> },
    { id: 'source', header: 'Origem', accessorFn: (r) => sourceLabel(r.source), cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{getValue() as string}</span> },
    { accessorKey: 'created_at', header: 'Criado em', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted">{formatDay(getValue() as string, timezone)}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Leads" empty={empty} />;
}

export function CampaignsTable({ rows, stats, empty }: { rows: CampaignRow[]; stats: Record<string, { captured: number; qualified: number; avg: number | null }>; empty: React.ReactNode }) {
  const columns: ColumnDef<CampaignRow, unknown>[] = [
    { accessorKey: 'name', header: 'Campanha', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'campaign_key', header: 'utm_campaign', cell: ({ getValue }) => <code className="text-xs">{getValue() as string}</code> },
    { id: 'origin', header: 'Origem / mídia', accessorFn: (r) => `${r.source ?? ''} ${r.medium ?? ''}`, cell: ({ row }) => <span className="text-xs">{[row.original.source, row.original.medium].filter(Boolean).join(' / ') || '—'}</span> },
    { id: 'captured', header: 'Capturados', accessorFn: (r) => stats[r.id]?.captured ?? 0, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { id: 'qualified', header: 'Qualificados', accessorFn: (r) => stats[r.id]?.qualified ?? 0, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { id: 'avg', header: 'Score médio', accessorFn: (r) => stats[r.id]?.avg ?? -1, cell: ({ row }) => <span className="tabular-nums">{stats[row.original.id]?.avg ?? '—'}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Campanhas" empty={empty} />;
}

export type OpenActivity = { id: string; lead_id: string; lead_name: string; type: string; description: string | null; due_at: string | null; owner: string };
export function overdue(a: { due_at: string | null }, now: number): boolean {
  return a.due_at !== null && Date.parse(a.due_at) < now;
}
export const activityLabel = (t: string) => ACTIVITY_LABELS[t as ActivityType] ?? t;
