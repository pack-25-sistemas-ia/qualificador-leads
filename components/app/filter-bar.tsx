'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { CLASS_LABELS, CLASSES, PERIOD_LABELS, PERIODS, type LeadFilters, type Period } from '@/lib/leads/filters';

type Opt = { value: string; label: string };

/** Filtros globais do painel e dos relatórios (período, vendedor, campanha, origem, formulário, classe). Envia por GET: a URL é compartilhável. */
export function FilterBar({ action, filters, sellers, campaigns, sources, forms }: { action: string; filters: LeadFilters; sellers?: Opt[]; campaigns: Opt[]; sources: string[]; forms: Opt[] }) {
  const [period, setPeriod] = useState<Period>(filters.period);
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Filtros do período">
      <div>
        <label htmlFor="period" className="mb-1 block text-xs font-medium text-muted">Período</label>
        <Select id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-48">
          {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
        </Select>
      </div>
      {period === 'custom' ? (
        <>
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-muted">De</label>
            <Input id="from" name="from" type="date" defaultValue={filters.from} required />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">Até</label>
            <Input id="to" name="to" type="date" defaultValue={filters.to} required />
          </div>
        </>
      ) : null}
      {sellers ? (
        <div>
          <label htmlFor="seller" className="mb-1 block text-xs font-medium text-muted">Vendedor</label>
          <Select id="seller" name="seller" defaultValue={filters.seller ?? ''} className="w-44">
            <option value="">Todos</option>
            {sellers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ) : null}
      <div>
        <label htmlFor="campaign" className="mb-1 block text-xs font-medium text-muted">Campanha</label>
        <Select id="campaign" name="campaign" defaultValue={filters.campaign ?? ''} className="w-44">
          <option value="">Todas</option>
          {campaigns.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="source" className="mb-1 block text-xs font-medium text-muted">Origem</label>
        <Select id="source" name="source" defaultValue={filters.source ?? ''} className="w-36">
          <option value="">Todas</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="form" className="mb-1 block text-xs font-medium text-muted">Formulário</label>
        <Select id="form" name="form" defaultValue={filters.form ?? ''} className="w-44">
          <option value="">Todos</option>
          {forms.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="class" className="mb-1 block text-xs font-medium text-muted">Classificação</label>
        <Select id="class" name="class" defaultValue={filters.classification ?? ''} className="w-36">
          <option value="">Todas</option>
          {CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABELS[c]}</option>)}
        </Select>
      </div>
      <Button type="submit">Aplicar</Button>
    </form>
  );
}
