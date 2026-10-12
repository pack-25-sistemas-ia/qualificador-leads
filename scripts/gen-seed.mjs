#!/usr/bin/env node
// Gera supabase/seed.sql (dados de DEMONSTRAÇÃO, fictícios e determinísticos) a partir dos modelos de formulário do próprio sistema.
// Os leads, as respostas e os planos de atendimento vêm daqui; as NOTAS, justificativas e classificações são calculadas dentro do banco
// pelas mesmas funções do sistema (lead_validate_answers / lead_score_compute). Rode: node scripts/gen-seed.mjs  (Node >= 22.6 lê TypeScript direto).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../lib/leads/templates.ts';
import { computeScore } from '../lib/leads/scoring.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 150;

// ----------------------------------------------------------------- gerador pseudoaleatório determinístico (LCG)
let seed = 20261012;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const weighted = (pairs) => { let t = rnd() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { t -= w; if (t <= 0) return v; } return pairs[0][0]; };
const some = (list, min, max) => { const n = min + Math.floor(rnd() * (max - min + 1)); const c = [...list]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };

const FIRST = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Elisa', 'Fábio', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Leonardo', 'Mariana', 'Nelson', 'Olívia', 'Paulo', 'Queila', 'Rodrigo', 'Sabrina', 'Tiago', 'Úrsula', 'Vítor', 'Wanda', 'Xavier', 'Yara', 'Zeca'];
const LAST = ['Almeida', 'Barros', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Hernandes', 'Ito', 'Junqueira', 'Klein', 'Lopes', 'Macedo', 'Nogueira', 'Oliveira', 'Prado', 'Queiroz', 'Ramos', 'Siqueira', 'Teixeira'];
const COMPANIES = ['Atlas', 'Boreal', 'Cedro', 'Delta', 'Estrela', 'Farol', 'Granito', 'Horizonte', 'Ipê', 'Jacarandá', 'Kairós', 'Lume', 'Mirante', 'Nexo', 'Origem', 'Pioneira'];
const COMPANY_KIND = ['Tecnologia', 'Logística', 'Alimentos', 'Consultoria', 'Educação', 'Saúde', 'Comércio', 'Serviços'];
const SEGMENTS = ['Tecnologia', 'Logística', 'Alimentos', 'Consultoria', 'Educação', 'Saúde', 'Varejo', 'Indústria'];
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;

const CAMPAIGNS = [
  { key: 'lancamento-verao', name: 'Lançamento Verão', source: 'instagram', medium: 'social' },
  { key: 'webinar-vendas', name: 'Webinar de Vendas', source: 'email', medium: 'newsletter' },
  { key: 'google-ads-marca', name: 'Google Ads — Marca', source: 'google', medium: 'cpc' },
  { key: 'indicacao-clientes', name: 'Indicação de Clientes', source: 'indicacao', medium: 'referral' },
];
const ORIGINS = [
  { campaign: 2, w: 28 }, { campaign: 0, w: 22 }, { campaign: 1, w: 16 }, { campaign: 3, w: 12 }, { campaign: -1, source: 'direto', w: 12 }, { campaign: -1, source: 'linkedin', medium: 'social', w: 10 },
];

const T = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
const opt = (tpl, key) => T[tpl].schema.fields.find((f) => f.key === key).options.map((o) => o.value);

function answersFor(formKey, contact) {
  if (formKey === 'b2b') {
    return {
      ...contact, empresa: contact.empresa, segmento: contact.segment,
      cargo: weighted([['decisor', 35], ['influenciador', 40], ['pesquisa', 25]]),
      funcionarios: weighted([['ate_10', 30], ['11_50', 30], ['51_200', 25], ['mais_200', 15]]),
      orcamento: weighted([['ate_5k', 28], ['5k_20k', 28], ['20k_50k', 20], ['mais_50k', 12], ['indefinido', 12]]),
      prazo: weighted([['ate_30', 28], ['30_90', 34], ['mais_90', 20], ['pesquisando', 18]]),
      ...(rnd() < 0.7 ? { problema: pick(['Precisamos organizar a prospecção e dar retorno mais rápido aos contatos.', 'Perdemos oportunidades por falta de acompanhamento.', 'Queremos saber quais campanhas trazem clientes melhores.', 'O time comercial não tem um critério único para priorizar.']) } : {}),
    };
  }
  if (formKey === 'imobiliaria') {
    const financia = rnd() < 0.5;
    return {
      ...contact,
      interesse: weighted([['comprar', 50], ['alugar', 30], ['investir', 20]]),
      tipo: some(opt('imobiliaria', 'tipo'), 1, 2),
      valor: weighted([['ate_300k', 25], ['300k_700k', 40], ['700k_1500k', 25], ['mais_1500k', 10]]),
      prazo: weighted([['ate_30', 25], ['30_90', 40], ['mais_90', 35]]),
      financia, ...(financia ? { entrada: pick([20000, 45000, 80000, 120000, 200000]) } : {}),
      visita: rnd() < 0.4,
    };
  }
  return {
    ...contact,
    site: rnd() < 0.6 ? `https://${slug(contact.empresa ?? 'empresa')}.exemplo-demo.invalid` : undefined,
    investimento: weighted([['nenhum', 15], ['ate_2k', 30], ['2k_10k', 35], ['mais_10k', 20]]),
    objetivos: some(opt('agencia', 'objetivos'), 1, 3), canais: some(opt('agencia', 'canais'), 0, 3),
    prazo: weighted([['imediato', 30], ['mes', 40], ['depois', 30]]),
  };
}

const REASONS = ['Sem orçamento', 'Sem interesse', 'Fora do perfil', 'Contato inválido', 'Já é cliente'];
const rows = [];
for (let i = 1; i <= N; i += 1) {
  const formKey = weighted([['b2b', 52], ['imobiliaria', 24], ['agencia', 24]]);
  const first = pick(FIRST);
  const last = pick(LAST);
  const name = `${first} ${last}`;
  const company = `${pick(COMPANIES)} ${pick(COMPANY_KIND)}`;
  const emailBase = `${slug(first)}.${slug(last)}${i}`;
  const phone = `(${pick(['11', '21', '31', '41', '51', '61'])}) 9${String(1000 + Math.floor(rnd() * 8999))}-${String(1000 + Math.floor(rnd() * 8999))}`;
  const contact = { nome: name, email: `${emailBase}@exemplo-demo.invalid`, telefone: phone, empresa: formKey === 'imobiliaria' ? undefined : company, segment: pick(SEGMENTS) };
  const answers = answersFor(formKey, contact);
  delete answers.segment;
  if (formKey === 'imobiliaria') delete answers.empresa;
  const origin = weighted(ORIGINS.map((o) => [o, o.w]));
  const camp = origin.campaign >= 0 ? CAMPAIGNS[origin.campaign] : null;
  const createdAgo = Math.max(0, Math.round(89 - (i / N) * 88 + (rnd() - 0.5) * 3));
  const rules = T[formKey === 'agencia' ? 'agencia' : formKey === 'imobiliaria' ? 'imobiliaria' : 'b2b'].rules.map((r, k) => ({ id: String(k), ...r }));
  const score = computeScore(TEMPLATES.flatMap((t) => t.rules.map((r, k) => ({ id: `${t.id}${k}`, ...r }))).filter((r) => T[formKey].schema.fields.some((f) => f.key === r.field_key)), answers).score;
  void rules;
  let plan;
  if (i > N - 6) plan = 'new_unassigned';
  else {
    const p = score >= 70 ? [['conv', 36], ['cont', 28], ['qual', 14], ['new', 10], ['disq', 12]] : score >= 40 ? [['conv', 9], ['cont', 24], ['qual', 28], ['new', 17], ['disq', 22]] : [['conv', 1], ['cont', 10], ['qual', 12], ['new', 25], ['disq', 52]];
    plan = weighted(p);
    if (createdAgo <= 2 && plan !== 'new') plan = 'new';
  }
  rows.push({
    i, formKey, name, email: contact.email, phone, company: formKey === 'imobiliaria' ? null : company, segment: contact.segment, answers,
    source: camp ? camp.source : origin.source, medium: camp ? camp.medium : origin.medium ?? null, campaign: camp ? camp.key : null,
    createdAgo, createdHour: 8 + Math.floor(rnd() * 10), plan, contactMin: Math.floor(5 + rnd() * rnd() * 2600),
    seller: plan === 'new_unassigned' ? 0 : 1 + (i % 2), reason: plan === 'disq' ? pick(REASONS) : null,
    followDays: (() => { const d = Math.floor(rnd() * 9) - 3; return d === 0 ? 1 : d; })(), dupOf: null,
  });
}
// três possíveis duplicados (mesmo e-mail de um lead anterior) para demonstrar a fila de revisão
for (const [i, of] of [[140, 20], [146, 33], [147, 51]]) { const r = rows[i - 1]; r.dupOf = of; r.email = rows[of - 1].email; r.answers = { ...r.answers, email: rows[of - 1].email }; r.plan = 'new_unassigned'; r.seller = 0; r.createdAgo = Math.min(r.createdAgo, 3); }

const jsonb = (v) => `${sq(JSON.stringify(v))}::jsonb`;
const valuesSql = rows.map((r) => `(${r.i}, ${sq(r.formKey)}, ${sq(r.name)}, ${sq(r.email)}, ${sq(r.phone)}, ${r.company ? sq(r.company) : 'null'}, ${sq(r.segment)}, ${jsonb(Object.fromEntries(Object.entries(r.answers).filter(([, v]) => v !== undefined)))}, ${sq(r.source)}, ${r.medium ? sq(r.medium) : 'null'}, ${r.campaign ? sq(r.campaign) : 'null'}, ${r.createdAgo}, ${r.createdHour}, ${sq(r.plan)}, ${r.contactMin}, ${r.seller}, ${r.reason ? sq(r.reason) : 'null'}, ${r.followDays}, ${r.dupOf ?? 'null'})`).join(',\n  ');

const forms = [
  { key: 'b2b', id: '1', name: 'Qualificação B2B', published: true },
  { key: 'imobiliaria', id: '2', name: 'Busca de imóvel', published: true },
  { key: 'agencia', id: '3', name: 'Contato para agência de marketing', published: true },
  { key: 'diagnostico', id: '4', name: 'Diagnóstico empresarial (rascunho)', published: false },
];
const fid = (n) => `'e5e5e5e5-0000-4000-8000-00000000f00${n}'`;
const vid = (n) => `'e5e5e5e5-0000-4000-8000-00000000e00${n}'`;
const formSql = forms.map((f) => {
  const t = T[f.key];
  return `  insert into public.lead_forms (id, organization_id, name, slug, description, status, thank_you_message, created_at)
  values (${fid(f.id)}, org, ${sq(f.name)}, ${sq(t.slug)}, ${sq(t.description)}, '${f.published ? 'published' : 'draft'}', 'Obrigado! Recebemos suas informações e entraremos em contato.', pg_temp.d(${f.published ? 112 : 20}));
  insert into public.lead_form_versions (id, organization_id, form_id, version_number, schema_json, conditional_logic_json, consent_config_json, published_at, created_at)
  values (${vid(f.id)}, org, ${fid(f.id)}, 1, ${jsonb(t.schema)}, ${jsonb(t.logic)}, ${jsonb(t.consent)}, ${f.published ? 'pg_temp.d(110)' : 'null'}, pg_temp.d(${f.published ? 112 : 20}));${f.published ? `
  update public.lead_forms set current_published_version_id = ${vid(f.id)} where id = ${fid(f.id)};` : ''}`;
}).join('\n');

const ruleRows = [];
let prio = 0;
for (const id of ['b2b', 'imobiliaria', 'agencia']) for (const r of T[id].rules) { prio += 1; ruleRows.push(`(org, model, ${sq(r.label)}, ${sq(r.field_key)}, ${sq(r.operator)}, ${jsonb(r.condition ?? null)}, ${r.points}, ${prio})`); }

const sql = `-- ============================================================================================
-- DADOS DE DEMONSTRAÇÃO — SOMENTE DESENVOLVIMENTO LOCAL. GERADO por scripts/gen-seed.mjs. NÃO edite à mão.
-- Executado automaticamente por \`supabase db reset\` (nunca no Supabase hospedado, a menos que você rode este arquivo
-- manualmente: NÃO faça isso em produção). Tudo aqui é FICTÍCIO e determinístico (sem random()): rodar de novo gera sempre os
-- mesmos dados. Para remover: apague a organização «Empresa Demonstração» (as tabelas em cascata limpam o resto) ou rode \`supabase db reset\`.
-- Os formulários, o modelo de score e as notas usam as MESMAS funções do sistema (validação e pontuação no banco);
-- só as datas são recuadas para o painel mostrar histórico. Os e-mails usam o domínio reservado .invalid (nunca existem).
--
-- Usuários de demonstração (senha local única: DemoLocal#2026):
--   dono@demo.exemplo       proprietário  (exige cadastrar verificação em duas etapas no primeiro acesso)
--   gerente@demo.exemplo    gestor comercial (vê todos os leads, formulários, modelo e distribuição)
--   vendedor1@demo.exemplo  vendedor      (vê só os leads atribuídos a ele)
--   vendedor2@demo.exemplo  vendedor
--   leitor@demo.exemplo     leitor        (somente leitura)
-- Formulário público de demonstração: /f/qualificacao-b2b, /f/busca-de-imovel, /f/agencia-de-marketing
-- ============================================================================================

create function pg_temp.d(p_days_ago int, p_time time default '12:00') returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - p_days_ago)::timestamp + p_time) at time zone 'America/Sao_Paulo'
$$;

-- Só no seed: desliga/religa os gatilhos de regra (dono das tabelas pode; o papel postgres do Supabase não é superusuário).
create function pg_temp.triggers(p_on boolean) returns void language plpgsql as $f$
declare t text;
begin
  foreach t in array array['leads', 'lead_activities', 'lead_forms', 'lead_form_versions', 'scoring_models', 'scoring_rules', 'campaigns', 'lead_settings', 'distribution_rules'] loop
    execute format('alter table public.%I %s trigger user', t, case when p_on then 'enable' else 'disable' end);
  end loop;
end $f$;

create temp table seed_rows (
  i int, form_key text, name text, email text, phone text, company text, segment text, answers jsonb, source text, medium text, campaign text,
  created_ago int, created_hour int, plan text, contact_min int, seller int, reason text, follow_days int, dup_of int
) on commit drop;
insert into seed_rows values
  ${valuesSql};

do $$
declare
  org uuid := 'e5e5e5e5-0000-4000-8000-000000000001';
  model uuid := 'e5e5e5e5-0000-4000-8000-0000000000d1';
  u_dono uuid := 'e5e5e5e5-0000-4000-8000-0000000000a1';
  u_ger uuid := 'e5e5e5e5-0000-4000-8000-0000000000a2';
  u_v1 uuid := 'e5e5e5e5-0000-4000-8000-0000000000a3';
  u_v2 uuid := 'e5e5e5e5-0000-4000-8000-0000000000a4';
  u_leitor uuid := 'e5e5e5e5-0000-4000-8000-0000000000a5';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
  r record; v_form uuid; v_ver uuid; v_schema jsonb; v_logic jsonb; chk jsonb; res jsonb; v_rules jsonb; v_lead uuid; v_sub uuid; v_camp uuid;
  v_status public.lead_status; v_created timestamptz; v_contact timestamptz; v_assignee uuid; v_dup uuid; cls text; sc int;
  v_thr jsonb := '{"warm_min":40,"hot_min":70,"qualified_min":70}';
begin
  if exists (select 1 from public.organizations where id = org) then
    return; -- já semeado
  end if;

  -- ---------------------------------------------------------------- usuários (login por e-mail e senha)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email, pw, now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values (u_dono, 'dono@demo.exemplo', 'Marina Proprietária'), (u_ger, 'gerente@demo.exemplo', 'Rafael Gestor'),
               (u_v1, 'vendedor1@demo.exemplo', 'Camila Vendas'), (u_v2, 'vendedor2@demo.exemplo', 'Diego Vendas'),
               (u_leitor, 'leitor@demo.exemplo', 'Lívia Leitora')) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);

  -- ---------------------------------------------------------------- organização (configuração e motivos nascem por gatilho)
  insert into public.organizations (id, name, slug) values (org, 'Empresa Demonstração (dados fictícios)', 'demo');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Empresa Demonstração', '{"primary":"#162a43"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, u_dono, 'owner'), (org, u_ger, 'manager'), (org, u_v1, 'member'), (org, u_v2, 'member'), (org, u_leitor, 'viewer');

  perform pg_temp.triggers(false);
  update public.lead_settings set assignment_strategy = 'round_robin', privacy_policy_url = 'https://exemplo-demo.invalid/privacidade' where organization_id = org;
  insert into public.lead_sellers (organization_id, user_id) values (org, u_v1), (org, u_v2);
  update public.lead_settings set rr_last_user = u_v2 where organization_id = org;

  insert into public.campaigns (organization_id, name, source, medium, campaign_key, created_at) values
${CAMPAIGNS.map((c, k) => `    (org, ${sq(c.name)}, ${sq(c.source)}, ${sq(c.medium)}, ${sq(c.key)}, pg_temp.d(${100 - k * 5}))`).join(',\n')};

  -- ---------------------------------------------------------------- formulários (versão 1 publicada; o 4º segue como rascunho)
${formSql}

  -- ---------------------------------------------------------------- modelo de score (regras sugeridas pelos modelos de formulário)
  insert into public.scoring_models (id, organization_id, name, version, status, thresholds_json, created_at) values (model, org, 'Modelo de qualificação comercial', 1, 'draft', v_thr, pg_temp.d(112));
  insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, condition_json, points, priority) values
  ${ruleRows.join(',\n  ')};
  update public.scoring_models set status = 'published', published_at = pg_temp.d(110) where id = model;

  insert into public.distribution_rules (organization_id, name, priority, field_key, operator, condition_json, assign_to) values
    (org, 'Orçamento alto para a Camila', 10, 'orcamento', 'in', '["20k_50k","mais_50k"]', u_v1);

  -- ---------------------------------------------------------------- leads: respostas, notas (pelo motor do banco), histórico, atribuições e atividades
  for r in select * from seed_rows order by i loop
    v_form := case r.form_key when 'b2b' then 'e5e5e5e5-0000-4000-8000-00000000f001' when 'imobiliaria' then 'e5e5e5e5-0000-4000-8000-00000000f002' else 'e5e5e5e5-0000-4000-8000-00000000f003' end::uuid;
    v_ver := case r.form_key when 'b2b' then 'e5e5e5e5-0000-4000-8000-00000000e001' when 'imobiliaria' then 'e5e5e5e5-0000-4000-8000-00000000e002' else 'e5e5e5e5-0000-4000-8000-00000000e003' end::uuid;
    select schema_json, conditional_logic_json into v_schema, v_logic from public.lead_form_versions where id = v_ver;
    chk := public.lead_validate_answers(v_schema, v_logic, r.answers);
    v_rules := private.lead_rules_json(model, v_schema);
    res := public.lead_score_compute(v_rules, chk -> 'clean', v_thr, array(select jsonb_array_elements_text(chk -> 'hidden')));
    sc := (res ->> 'score')::int; cls := res ->> 'classification';
    select id into v_camp from public.campaigns where organization_id = org and campaign_key = r.campaign;
    v_lead := ('e5e5e5e5-1000-4000-8000-' || lpad(r.i::text, 12, '0'))::uuid;
    v_sub := ('e5e5e5e5-2000-4000-8000-' || lpad(r.i::text, 12, '0'))::uuid;
    v_created := pg_temp.d(r.created_ago, make_time(r.created_hour, (r.i * 7) % 60, 0));
    v_status := case r.plan when 'conv' then 'converted' when 'cont' then 'contacted' when 'qual' then 'qualifying' when 'disq' then 'disqualified' else 'new' end;
    v_assignee := case r.seller when 1 then u_v1 when 2 then u_v2 else null end;
    v_contact := case when r.plan in ('conv', 'cont') or (r.plan = 'qual' and r.i % 2 = 0) then v_created + r.contact_min * interval '1 minute' end;
    v_dup := case when r.dup_of is not null then ('e5e5e5e5-1000-4000-8000-' || lpad(r.dup_of::text, 12, '0'))::uuid end;

    insert into public.leads (id, organization_id, name, email, phone, company_name, segment, status, qualification, qualified, current_score, assigned_to, source, medium, campaign_id, first_form_id,
                              duplicate_of, needs_review, disqualify_reason, converted_at, first_contact_at, created_at, updated_at)
    values (v_lead, org, r.name, lower(r.email), '55' || regexp_replace(r.phone, '\\D', '', 'g'), r.company, r.segment, v_status, cls, (res ->> 'qualified')::boolean, sc, v_assignee,
            case when r.source = 'direto' then null else r.source end, r.medium, v_camp, v_form, v_dup, v_dup is not null, case when r.plan = 'disq' then r.reason end,
            case when r.plan = 'conv' then v_contact + interval '2 days' end, v_contact, v_created, v_created);
    insert into public.form_submissions (id, organization_id, form_id, form_version_id, lead_id, answers_json, consent_given, is_duplicate, source, utm_source, utm_medium, utm_campaign, landing_page, submitted_at)
    values (v_sub, org, v_form, v_ver, v_lead, chk -> 'clean', true, v_dup is not null, case when r.source = 'direto' then 'direto' else r.source end,
            case when r.source = 'direto' then null else r.source end, r.medium, r.campaign, 'https://exemplo-demo.invalid/f/' || r.form_key, v_created);
    insert into public.lead_score_events (organization_id, lead_id, scoring_model_id, submission_id, score, classification, qualified, explanation_json, evaluated_at)
    values (org, v_lead, model, v_sub, sc, cls, (res ->> 'qualified')::boolean, res || jsonb_build_object('model_version', 1, 'model_name', 'Modelo de qualificação comercial'), v_created);

    -- histórico de status
    insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, reason, changed_at) values (org, v_lead, null, 'new', null, v_created);
    if r.plan in ('qual', 'cont', 'conv') then
      insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, changed_at) values (org, v_lead, 'new', 'qualifying', v_created + interval '30 minutes');
    end if;
    if r.plan in ('cont', 'conv') then
      insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, changed_at) values (org, v_lead, 'qualifying', 'contacted', coalesce(v_contact, v_created) + interval '5 minutes');
    end if;
    if r.plan = 'conv' then
      insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, changed_at) values (org, v_lead, 'contacted', 'converted', v_contact + interval '2 days');
    end if;
    if r.plan = 'disq' then
      insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, reason, changed_at) values (org, v_lead, 'new', 'disqualified', r.reason, v_created + interval '1 day');
    end if;
    -- atribuição (rodízio)
    if v_assignee is not null then
      insert into public.lead_assignments (organization_id, lead_id, assigned_to, assignment_method, assigned_at) values (org, v_lead, v_assignee, 'round_robin', v_created + interval '1 minute');
    end if;
    -- atividades: primeiro contato concluído; follow-up agendado (alguns vencidos)
    if v_contact is not null then
      insert into public.lead_activities (organization_id, lead_id, user_id, type, description, completed_at, created_at)
      values (org, v_lead, v_assignee, (case when r.i % 3 = 0 then 'message' when r.i % 3 = 1 then 'call' else 'email' end)::public.lead_activity_type, 'Primeiro contato realizado.', v_contact, v_contact);
    end if;
    if r.plan in ('cont', 'qual') and r.i % 2 = 1 then
      insert into public.lead_activities (organization_id, lead_id, user_id, type, description, due_at, created_at)
      values (org, v_lead, v_assignee, 'call'::public.lead_activity_type, 'Retornar a ligação e confirmar a proposta.', pg_temp.d(-r.follow_days, '10:00'), coalesce(v_contact, v_created));
    end if;
  end loop;

  -- uma análise de IA de exemplo (a IA segue desabilitada; este registro só mostra como a sugestão aparece, separada do score)
  insert into public.ai_analyses (organization_id, lead_id, provider, model, analysis_json, status, created_at)
  select org, id, 'demonstracao', 'exemplo', jsonb_build_object('summary', 'Lead com bom encaixe: orçamento compatível e prazo curto. Vale priorizar o contato.',
         'strengths', jsonb_build_array('Prazo de decisão curto', 'Orçamento compatível'), 'risks', jsonb_build_array('Pouco detalhe sobre o problema a resolver'), 'next_steps', jsonb_build_array('Ligar hoje', 'Enviar proposta preliminar')), 'ok', pg_temp.d(2)
  from public.leads where organization_id = org and qualification = 'hot' and status = 'contacted' order by created_at desc limit 1;

  perform pg_temp.triggers(true);
end $$;
`;
writeFileSync(join(root, 'supabase', 'seed.sql'), sql);
console.log('gerado supabase/seed.sql', rows.length, 'leads');
