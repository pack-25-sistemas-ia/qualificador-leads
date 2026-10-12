'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Select } from '@/components/ui/primitives';
import { ActionButton, FormShell, SelectField, TextField, useActionForm, type Opt } from '@/components/app/form-kit';
import { applyRetention, deleteDistributionRule, distributePending, removeSeller, saveAiConfig, saveCampaign, saveDistributionRule, saveSettings, setSeller } from '@/lib/leads/actions';
import { formatRuleValue } from '@/lib/leads/rule-value';
import { OPERATOR_LABELS, OPERATORS, VALUELESS } from '@/lib/leads/scoring';
import { aiConfigSchema, campaignSchema, distributionRuleSchema, settingsSchema, ASSIGNMENT_STRATEGIES, DUPLICATE_LABELS, DUPLICATE_POLICIES, STRATEGY_LABELS } from '@/lib/leads/validation';
import type { DistributionRuleRow, SettingsRow } from '@/lib/leads/data';
import type { ActionState } from '@/lib/actions/result';

// ---------------------------------------------------------------- distribuição
export function SellerList({ sellers, people }: { sellers: Array<{ user_id: string; active: boolean }>; people: Opt[] }) {
  const router = useRouter();
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const label = (id: string) => people.find((p) => p.value === id)?.label ?? 'Usuário';
  const free = people.filter((p) => !sellers.some((s) => s.user_id === p.value));
  return (
    <div className="space-y-4">
      {sellers.length === 0 ? <p className="text-sm text-muted">Nenhum vendedor no rodízio. Adicione quem deve receber leads automaticamente.</p> : (
        <ul className="space-y-2">
          {sellers.map((s) => (
            <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
              <span className="font-medium">{label(s.user_id)} {s.active ? <Badge tone="success">No rodízio</Badge> : <Badge tone="neutral">Pausado</Badge>}</span>
              <span className="flex gap-2">
                <ActionButton label={s.active ? 'Pausar' : 'Reativar'} variant="secondary" action={() => setSeller(s.user_id, !s.active)} />
                <ActionButton label="Remover" variant="secondary" confirm="Remover do rodízio? Os leads já atribuídos continuam com ele." action={() => removeSeller(s.user_id)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!add) return; start(async () => { const r = await setSeller(add, true); setMsg(r); if (r.ok) { setAdd(''); router.refresh(); } }); }}>
          <div className="min-w-56 flex-1"><label htmlFor="add-seller" className="mb-1 block text-xs font-medium text-muted">Adicionar ao rodízio</label>
            <Select id="add-seller" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Selecione…</option>{free.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></div>
          <Button type="submit" disabled={pending || !add}>Adicionar</Button>
        </form>
      ) : null}
      {msg.message && !msg.ok ? <Alert tone="error">{msg.message}</Alert> : null}
      <p className="text-xs text-muted">Quem tem o papel «leitor» nunca recebe leads. O rodízio segue a ordem fixa dos vendedores ativos e é calculado com trava no banco: dois leads simultâneos não vão para a mesma pessoa por engano.</p>
    </div>
  );
}

export function DistributionRuleForm({ rule, people, onDone }: { rule?: DistributionRuleRow; people: Opt[]; onDone?: () => void }) {
  const { form, state, pending, submit } = useActionForm({
    schema: distributionRuleSchema,
    defaultValues: {
      name: rule?.name ?? '', priority: String(rule?.priority ?? 100), field_key: rule?.field_key ?? '', operator: rule?.operator ?? 'eq',
      value: rule ? formatRuleValue(rule.operator, rule.condition_json) : '', assign_to: rule?.assign_to ?? people[0]?.value ?? '', enabled: rule?.enabled ?? true,
    },
    action: (v: { name: string; priority: string; field_key: string; operator: string; value: string; assign_to: string; enabled: boolean }) => saveDistributionRule(rule?.id ?? null, v),
    resetOnSuccess: !rule,
    onSuccess: () => onDone?.(),
  });
  const op = form.watch('operator');
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={rule ? 'Salvar regra' : 'Adicionar regra'} secondary={rule && onDone ? <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button> : undefined}>
      <TextField form={form} name="name" label="Nome da regra" maxLength={120} placeholder="Ex.: Urgentes para a Ana" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="field_key" label="Chave da pergunta" maxLength={40} hint="A chave técnica da pergunta do formulário (ex.: prazo)." />
        <SelectField form={form} name="operator" label="Condição" options={OPERATORS.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
        {(VALUELESS as readonly string[]).includes(op) ? <p className="flex items-end pb-2 text-xs text-muted">Sem valor.</p> : <TextField form={form} name="value" label="Valor" maxLength={500} />}
        <SelectField form={form} name="assign_to" label="Atribuir a" options={people} />
        <TextField form={form} name="priority" label="Prioridade (menor = primeiro)" inputMode="numeric" />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...form.register('enabled')} />Regra ativa</label>
    </FormShell>
  );
}

export function DistributionRules({ rules, people }: { rules: DistributionRuleRow[]; people: Opt[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const label = (id: string) => people.find((p) => p.value === id)?.label ?? 'Usuário';
  if (rules.length === 0) return <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">Nenhuma regra de critério.</p>;
  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-3 text-sm">
          {editing === r.id ? <DistributionRuleForm rule={r} people={people} onDone={() => setEditing(null)} /> : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{r.priority}. {r.name} {!r.enabled ? <Badge tone="neutral">Inativa</Badge> : null}</p>
                <p className="text-xs text-muted">Se «{r.field_key}» {OPERATOR_LABELS[r.operator as keyof typeof OPERATOR_LABELS] ?? r.operator} {formatRuleValue(r.operator, r.condition_json)} → {label(r.assign_to)}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(r.id)}>Editar</Button>
                <ActionButton label="Remover" variant="secondary" confirm="Remover esta regra?" action={() => deleteDistributionRule(r.id)} />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DistributeButton({ disabled }: { disabled: boolean }) {
  const [msg, setMsg] = useState<ActionState & { count?: number }>({});
  return (
    <div className="space-y-2">
      <ActionButton label="Distribuir leads sem responsável" pendingLabel="Distribuindo…" variant="primary" disabled={disabled} action={async () => { const r = await distributePending(); setMsg(r); return r; }} />
      {msg.message && msg.ok ? <Alert tone="success">{msg.message}</Alert> : null}
    </div>
  );
}

// ---------------------------------------------------------------- campanhas
export function CampaignForm({ campaign, onDone }: { campaign?: { id: string; name: string; source: string | null; medium: string | null; campaign_key: string }; onDone?: () => void }) {
  const { form, state, pending, submit } = useActionForm({
    schema: campaignSchema,
    defaultValues: { name: campaign?.name ?? '', source: campaign?.source ?? '', medium: campaign?.medium ?? '', campaign_key: campaign?.campaign_key ?? '' },
    action: (v: { name: string; source: string; medium: string; campaign_key: string }) => saveCampaign(campaign?.id ?? null, v),
    resetOnSuccess: !campaign,
    onSuccess: () => onDone?.(),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={campaign ? 'Salvar campanha' : 'Cadastrar campanha'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" maxLength={120} />
        <TextField form={form} name="campaign_key" label="utm_campaign" maxLength={80} hint={campaign ? 'A chave não muda depois de criada.' : 'Igual ao que vai no link (ex.: black-friday-2026).'} />
        <TextField form={form} name="source" label="Origem (utm_source)" maxLength={80} />
        <TextField form={form} name="medium" label="Mídia (utm_medium)" maxLength={80} />
      </div>
    </FormShell>
  );
}

// ---------------------------------------------------------------- configurações
export function SettingsForm({ initial }: { initial: SettingsRow }) {
  const { form, state, pending, submit } = useActionForm({
    schema: settingsSchema,
    defaultValues: {
      timezone: initial.timezone, duplicate_policy: initial.duplicate_policy, assignment_strategy: initial.assignment_strategy, criteria_fallback_round_robin: initial.criteria_fallback_round_robin,
      alert_no_contact_hours: String(initial.alert_no_contact_hours), privacy_policy_url: initial.privacy_policy_url ?? '', retention_days: initial.retention_days === null ? '' : String(initial.retention_days),
    },
    action: (v: { timezone: string; duplicate_policy: (typeof DUPLICATE_POLICIES)[number]; assignment_strategy: (typeof ASSIGNMENT_STRATEGIES)[number]; criteria_fallback_round_robin: boolean; alert_no_contact_hours: string; privacy_policy_url: string; retention_days: string }) => saveSettings(v),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar configurações">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="timezone" label="Fuso horário (IANA)" maxLength={60} hint="Ex.: America/Sao_Paulo. Define os dias dos relatórios." />
        <TextField form={form} name="alert_no_contact_hours" label="Alerta: lead quente sem contato após (horas)" inputMode="numeric" />
        <SelectField form={form} name="assignment_strategy" label="Distribuição de novos leads" options={ASSIGNMENT_STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABELS[s] }))} />
        <SelectField form={form} name="duplicate_policy" label="Quando o contato já existe" options={DUPLICATE_POLICIES.map((s) => ({ value: s, label: DUPLICATE_LABELS[s] }))} hint="A comparação é por e-mail ou telefone normalizados, nunca pelo nome." />
        <TextField form={form} name="privacy_policy_url" label="Política de privacidade (https://)" maxLength={300} hint="Aparece ao lado do aceite nos formulários públicos." />
        <TextField form={form} name="retention_days" label="Retenção de leads (dias)" inputMode="numeric" hint="Vazio = não anonimiza sozinho. Com valor, o botão abaixo anonimiza leads mais antigos que não foram convertidos." />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...form.register('criteria_fallback_round_robin')} />Se nenhuma regra por critério servir, usar o rodízio</label>
    </FormShell>
  );
}

export function RetentionButton({ days }: { days: number | null }) {
  return days ? <ActionButton label={`Aplicar retenção agora (${days} dias)`} pendingLabel="Aplicando…" variant="danger" confirm={`Anonimizar todos os leads criados há mais de ${days} dias que não foram convertidos? Não pode ser desfeito.`} action={applyRetention} /> : <p className="text-sm text-muted">Defina os dias de retenção acima para habilitar.</p>;
}

export function AiConfigForm({ enabled, dailyLimit, ready }: { enabled: boolean; dailyLimit: number; ready: boolean }) {
  const { state, pending, submit, form } = useActionForm({
    schema: aiConfigSchema,
    defaultValues: { enabled, daily_limit: String(dailyLimit) },
    action: (v: { enabled: boolean; daily_limit: string }) => saveAiConfig(v),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar IA">
      {!ready ? <Alert tone="info">O provedor ainda não está configurado no servidor. Defina AI_API_KEY, AI_BASE_URL e AI_MODEL (docs/DEPLOYMENT.md).</Alert> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...form.register('enabled')} />Habilitar a análise por IA nos leads</label>
      <TextField form={form} name="daily_limit" label="Limite de análises por dia (organização)" inputMode="numeric" hint="Protege contra custo inesperado." />
      <p className="text-xs text-muted">A IA recebe só dados minimizados (sem nome, e-mail, telefone ou empresa), responde em formato fixo e <strong>nunca altera o score</strong>.</p>
    </FormShell>
  );
}
