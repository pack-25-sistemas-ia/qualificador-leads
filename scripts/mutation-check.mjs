#!/usr/bin/env node
// Teste de mutação das regras críticas do banco: quebra cada regra DE PROPÓSITO numa cópia das migrações
// e exige que a suíte (pnpm test:db) reprove. Se alguma mutação sobreviver, falta teste.
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

// { name, file (trecho do arquivo), find, replace, nth (1 = primeira ocorrência) }
const M = [
  { name: 'score: teto de 100 removido', file: 'leads_schema', find: 'greatest(0, least(100, raw))', replace: 'greatest(0, least(1000, raw))' },
  { name: 'score: faixa quente exclui o limite', file: 'leads_schema', find: "case when sc >= hot then 'hot'", replace: "case when sc > hot then 'hot'" },
  { name: 'score: qualificado exclui o limite', file: 'leads_schema', find: "'qualified', sc >= qmin", replace: "'qualified', sc > qmin" },
  { name: 'score: eq diferencia maiúsculas', file: 'leads_schema', find: "return lower(a #>> '{}') = lower(c #>> '{}');", replace: "return (a #>> '{}') = (c #>> '{}');" },
  { name: 'score: between exclusivo', file: 'leads_schema', find: 'return n between lo and hi;', replace: 'return n > lo and n < hi;' },
  { name: 'score: resposta ausente aplica a regra', file: 'leads_schema', find: "if not private.lead_is_answered(p_ans) then return null; end if;", replace: "if not private.lead_is_answered(p_ans) then return true; end if;" },
  { name: 'envio: campo oculto não é descartado', file: 'leads_schema', find: "if not visible then hidden := hidden || k; continue; end if;", replace: "if not visible then hidden := hidden || k; end if;" },
  { name: 'envio: consentimento não exigido', file: 'leads_flow', find: "and not coalesce(p_consent, false) then", replace: "and false then" },
  { name: 'envio: reenvio com a mesma chave duplica', file: 'leads_flow', find: "if p_submission_key is not null and exists (", replace: "if false and exists (" },
  { name: 'envio: sem limite de taxa', file: 'leads_flow', find: 'return h <= p_max;', replace: 'return true;' },
  { name: 'envio: duplicidade (link) ignorada', file: 'leads_flow', find: "if st.duplicate_policy = 'link' then", replace: 'if false then' },
  { name: 'score: regra sobre pergunta fora do formulário não é ignorada', file: 'leads_flow', find: "and (p_schema is null or exists (select 1 from jsonb_array_elements(p_schema -> 'fields') f where f ->> 'key' = r.field_key));", replace: ';' },
  { name: 'envio: campanha não vem do UTM', file: 'leads_flow', find: "if u_campaign is not null then", replace: 'if false then' },
  { name: 'segurança: anônimo executa funções internas', file: 'leads_flow', find: "execute format('revoke all on function %s from public, anon', f);", replace: "execute format('revoke all on function %s from public', f);" },
  { name: 'segurança: vendedor lê leads de outros', file: 'leads_schema', find: "when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);", replace: "when 'member' then true else false end, false);", nth: 1 },
  { name: 'segurança: status editável por UPDATE', file: 'leads_schema', find: 'grant update (name, email, phone, company_name, segment, notes, archived_at, custom) on public.leads', replace: 'grant update (name, email, phone, company_name, segment, notes, archived_at, custom, status) on public.leads' },
  { name: 'segurança: MFA ignorado na gestão', file: 'leads_flow', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;", replace: '', nth: 1 },
  { name: 'pipeline: novo → convertido permitido', file: 'leads_schema', find: "(old.status = 'new' and new.status in ('qualifying', 'qualified', 'contacted', 'disqualified'))", replace: "(old.status = 'new' and new.status in ('qualifying', 'qualified', 'contacted', 'disqualified', 'converted'))" },
  { name: 'pipeline: desqualificar sem motivo', file: 'leads_flow', find: "if p_status = 'disqualified' and r is null then", replace: "if false and r is null then" },
  { name: 'distribuição: round-robin não avança', file: 'leads_flow', find: 'where st.rr_last_user is null or u > st.rr_last_user', replace: 'where true' },
  { name: 'distribuição: atribuição repetida duplica histórico', file: 'leads_flow', find: 'if l.assigned_to is not distinct from p_to then return; end if;', replace: '' },
  { name: 'versões: formulário publicado editável', file: 'leads_schema', find: 'if old.published_at is not null then raise exception', replace: 'if false then raise exception' },
  { name: 'versões: regras de modelo publicado editáveis', file: 'leads_schema', find: "if exists (select 1 from public.scoring_models m where m.id = mid and m.status <> 'draft') then", replace: 'if false then' },
  { name: 'versões: recálculo sobrescreve o histórico', file: 'leads_flow', find: "insert into public.lead_score_events (organization_id, lead_id, scoring_model_id, submission_id, score, classification, qualified, explanation_json)\n  values (l.organization_id, l.id, m.id, p_submission, (res ->> 'score')::int", replace: "delete from public.lead_score_events where lead_id = l.id;\n  insert into public.lead_score_events (organization_id, lead_id, scoring_model_id, submission_id, score, classification, qualified, explanation_json)\n  values (l.organization_id, l.id, m.id, p_submission, (res ->> 'score')::int" },
  { name: 'LGPD: anonimização mantém as respostas', file: 'leads_flow', find: "update public.form_submissions set answers_json = '{}'::jsonb, landing_page = null where lead_id = p_lead;", replace: 'select 1;' },
  { name: 'LGPD: retenção anonimiza convertidos', file: 'leads_flow', find: "and status <> 'converted' and created_at <", replace: 'and created_at <' },
  { name: 'métricas: qualificado conta lead sem score', file: 'leads_metrics', find: '(select count(*) from c where c.qualified),', replace: '(select count(*) from c where c.qualified is not false),' },
  { name: 'métricas: período inclui o dia seguinte', file: 'leads_metrics', find: "((p_to + 1)::timestamp at time zone v_tz)", replace: "((p_to + 2)::timestamp at time zone v_tz)" },
  { name: 'métricas: fuso fixo em UTC', file: 'leads_metrics', find: "(p_from::timestamp at time zone v_tz)", replace: "(p_from::timestamp at time zone 'UTC')" },
  { name: 'métricas: tempo de contato inclui quem não teve contato', file: 'leads_metrics', find: 'case when c.first_contact_at is null then null else greatest(0, extract(epoch from (c.first_contact_at - c.created_at)) / 60.0) end as mins', replace: 'greatest(0, extract(epoch from (c.first_contact_at - c.created_at)) / 60.0) as mins' },
  { name: 'métricas: lead arquivado entra na conta', file: 'leads_metrics', find: 'where l.organization_id = p_org and l.archived_at is null\n    and (p_t0', replace: 'where l.organization_id = p_org\n    and (p_t0' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));

function runSuite(dir) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, 'scripts', 'test-db.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function workspace(label, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-mut-${label}-`));
  mkdirSync(join(dir, 'scripts'));
  cpSync(join(root, 'scripts', 'test-db.mjs'), join(dir, 'scripts', 'test-db.mjs'));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    const path = join(dir, 'supabase', 'migrations', f);
    let text = readFileSync(path, 'utf8');
    const parts = text.split(mutate.find);
    const nth = mutate.nth ?? 1;
    if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
    if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
    text = parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find);
    writeFileSync(path, text);
  }
  return dir;
}

const base = workspace('base', null);
const baseline = await runSuite(base);
rmSync(base, { recursive: true, force: true });
if (baseline.code !== 0) {
  console.error('A suíte sem mutação já reprova; corrija antes.\n' + baseline.out.slice(-1500));
  process.exit(2);
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    const dir = workspace(String(next), m);
    const r = await runSuite(dir);
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA    ' : 'SOBREVIVEU'}  ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length}/${todo.length} mutações reprovadas pela suíte.`);
if (survived.length) { console.error('Sobreviveram:\n- ' + survived.join('\n- ')); process.exit(1); }
