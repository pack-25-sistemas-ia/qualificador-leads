'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinutes, formatPct } from '@/lib/leads/format';
import { CLASS_LABELS } from '@/lib/leads/filters';
import type { NamedRow, PeriodRow, SellerChartRow } from '@/lib/leads/chart-rows';

// Dados já preparados no servidor (rótulos legíveis). Todos os valores vêm do banco; nada é fixo.
const CLASS_COLOR: Record<string, string> = { hot: '#b91c1c', warm: '#d97706', cold: '#0891b2', unscored: '#94a3b8' };
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };

function ChartFrame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? (
        <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no período selecionado</p>
      ) : (
        <div className="h-[260px] w-full text-muted">{children}</div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const Table = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;

/** 1 — Leads capturados ao longo do tempo (com os qualificados). */
export function CapturedChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame title="Leads capturados" description="Leads criados em cada período e quantos deles estão qualificados (score a partir do mínimo de qualificação)."
      empty={rows.every((r) => r.captured === 0)}
      table={<Table caption="Leads capturados por período" head={['Período', 'Capturados', 'Qualificados']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.captured}</td><td className={TD}>{r.qualified}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="captured" name="Capturados" fill="#64748b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="qualified" name="Qualificados" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 2 — Taxa de qualificação ao longo do tempo. */
export function QualificationRateChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame title="Taxa de qualificação" description="Qualificados ÷ capturados em cada período. Período sem leads não tem taxa."
      empty={rows.every((r) => r.rate === null)}
      table={<Table caption="Taxa de qualificação por período" head={['Período', 'Capturados', 'Qualificados', 'Taxa']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.captured}</td><td className={TD}>{r.qualified}</td><td className={TD}>{formatPct(r.rate)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
          <Tooltip formatter={(v) => formatPct(Number(v))} contentStyle={TOOLTIP} />
          <Line type="monotone" dataKey="rate" name="Taxa de qualificação" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 3 — Distribuição do score em faixas de 10 pontos. */
export function ScoreChart({ rows }: { rows: Array<{ label: string; leads: number }> }) {
  return (
    <ChartFrame title="Distribuição do score" description="Quantos leads há em cada faixa de 10 pontos (só leads com score)."
      empty={rows.every((r) => r.leads === 0)}
      table={<Table caption="Distribuição do score" head={['Faixa', 'Leads']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.leads}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Bar dataKey="leads" name="Leads" fill="#162a43" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 4 — Frio, morno e quente. */
export function ClassChart({ rows }: { rows: Array<{ key: 'hot' | 'warm' | 'cold' | 'unscored'; value: number }> }) {
  return (
    <ChartFrame title="Quentes, mornos e frios" description="Classificação atual dos leads do período, pelas faixas do modelo de score."
      empty={rows.every((r) => r.value === 0)}
      table={<Table caption="Classificação dos leads" head={['Classificação', 'Leads']}>{rows.map((r) => <tr key={r.key}><td className={TD}>{CLASS_LABELS[r.key]}</td><td className={TD}>{r.value}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows.filter((r) => r.value > 0).map((r) => ({ name: CLASS_LABELS[r.key], value: r.value, key: r.key }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
            {rows.filter((r) => r.value > 0).map((r) => <Cell key={r.key} fill={CLASS_COLOR[r.key]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 5 — Leads por origem. */
export function SourceChart({ rows }: { rows: Array<{ name: string; captured: number; qualified: number }> }) {
  return (
    <ChartFrame title="Leads por origem" description="Origem informada pelo utm_source (sem UTM = direto)."
      empty={rows.length === 0}
      table={<Table caption="Leads por origem" head={['Origem', 'Capturados', 'Qualificados']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.captured}</td><td className={TD}>{r.qualified}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="captured" name="Capturados" fill="#64748b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="qualified" name="Qualificados" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 6 — Qualidade por campanha. */
export function CampaignChart({ rows }: { rows: Array<{ name: string; captured: number; qualified: number; avg: number | null }> }) {
  return (
    <ChartFrame title="Qualidade por campanha" description="Capturados e qualificados por campanha (utm_campaign). A tabela traz o score médio."
      empty={rows.length === 0}
      table={<Table caption="Qualidade por campanha" head={['Campanha', 'Capturados', 'Qualificados', 'Score médio']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.captured}</td><td className={TD}>{r.qualified}</td><td className={TD}>{r.avg ?? '—'}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" tick={TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={TICK} width={110} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="captured" name="Capturados" fill="#64748b" radius={[0, 4, 4, 0]} />
          <Bar dataKey="qualified" name="Qualificados" fill="#0891b2" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 7 — Funil. */
export function FunnelChart({ rows }: { rows: Array<NamedRow & { pct: number | null }> }) {
  return (
    <ChartFrame title="Funil do pipeline" description="Capturados → em atendimento → contatados → convertidos. Cada etapa contém a seguinte."
      empty={rows.every((r) => r.value === 0)}
      table={<Table caption="Funil do pipeline" head={['Etapa', 'Leads', '% dos capturados']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.value}</td><td className={TD}>{formatPct(r.pct)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" tick={TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={TICK} width={110} />
          <Tooltip contentStyle={TOOLTIP} />
          <Bar dataKey="value" name="Leads" fill="#162a43" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 8 — Conversão por vendedor. */
export function SellerChart({ rows }: { rows: SellerChartRow[] }) {
  return (
    <ChartFrame title="Conversão por vendedor" description="Leads atribuídos e convertidos por responsável (leads criados no período)."
      empty={rows.every((r) => r.leads === 0)}
      table={<Table caption="Conversão por vendedor" head={['Vendedor', 'Leads', 'Convertidos', 'Conversão']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.leads}</td><td className={TD}>{r.converted}</td><td className={TD}>{formatPct(r.rate)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="leads" name="Leads" fill="#64748b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="converted" name="Convertidos" fill="#047857" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 9 — Tempo até o primeiro contato. */
export function ContactChart({ rows }: { rows: Array<{ name: string; value: number }>; avgMinutes?: number | null }) {
  return (
    <ChartFrame title="Tempo até o primeiro contato" description="Da criação do lead à primeira atividade concluída. «Sem contato» = ainda sem atividade concluída."
      empty={rows.every((r) => r.value === 0)}
      table={<Table caption="Tempo até o primeiro contato" head={['Faixa', 'Leads']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.value}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} formatter={(v) => `${v} lead(s)`} />
          <Bar dataKey="value" name="Leads" fill="#7c3aed" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export { formatMinutes };
