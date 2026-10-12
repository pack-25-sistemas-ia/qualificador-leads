-- Qualificador de Leads Inteligente — SCHEMA, VALIDAÇÃO DE FORMULÁRIO, MOTOR DE SCORE E SEGURANÇA (parte 1)
-- Depende das migrações do Core. Arquivo do sistema: pode ser editado.
-- Princípios: toda tabela com organization_id + RLS; versões publicadas imutáveis; status e atribuição só por funções;
-- a captação pública é validada, pontuada e gravada NO BANCO (parte 2), sem service_role e sem acesso a tabelas.

begin;

-- ======================================================================= tipos
create type public.lead_status as enum ('new', 'qualifying', 'qualified', 'contacted', 'converted', 'disqualified');
create type public.lead_form_status as enum ('draft', 'published', 'archived');
create type public.scoring_model_status as enum ('draft', 'published', 'archived');
create type public.lead_activity_type as enum ('call', 'email', 'meeting', 'message', 'diagnostic', 'other');
create type public.lead_assign_method as enum ('manual', 'round_robin', 'criteria', 'system');

-- ======================================================================= autorização
create function private.lead_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;

-- Leitura: gestão e leitor veem tudo; vendedor só os leads atribuídos a ele.
create function private.lead_can_read(org uuid, assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case private.lead_role(org)
    when 'owner' then true when 'admin' then true when 'manager' then true when 'viewer' then true
    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);
$$;
-- Escrita: gestão em tudo; vendedor só nos atribuídos a ele.
create function private.lead_can_write(org uuid, assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case private.lead_role(org)
    when 'owner' then true when 'admin' then true when 'manager' then true
    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);
$$;
create function private.lead_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.lead_role(org) in ('owner', 'admin', 'manager'), false);
$$;
create function private.lead_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.lead_role(org) in ('owner', 'admin'), false);
$$;
revoke all on function private.lead_role(uuid) from public;
revoke all on function private.lead_can_read(uuid, uuid) from public;
revoke all on function private.lead_can_write(uuid, uuid) from public;
revoke all on function private.lead_is_manager(uuid) from public;
revoke all on function private.lead_is_admin(uuid) from public;
grant execute on function private.lead_role(uuid) to authenticated;
grant execute on function private.lead_can_read(uuid, uuid) to authenticated;
grant execute on function private.lead_can_write(uuid, uuid) to authenticated;
grant execute on function private.lead_is_manager(uuid) to authenticated;
grant execute on function private.lead_is_admin(uuid) to authenticated;

-- ======================================================================= normalização
create function private.lead_norm_email(t text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(coalesce(t, ''))), '');
$$;
-- Telefone: só dígitos; com 10 ou 11 dígitos assume Brasil (+55); aceita 8 a 15 dígitos; senão nulo.
create function private.lead_norm_phone(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if char_length(d) in (10, 11) then d := '55' || d; end if;
  return case when char_length(d) between 8 and 15 then d end;
end $$;
grant execute on function private.lead_norm_email(text) to authenticated;
grant execute on function private.lead_norm_phone(text) to authenticated;
revoke all on function private.lead_norm_email(text) from public;
revoke all on function private.lead_norm_phone(text) from public;

-- ======================================================================= tabelas
create table public.lead_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 60),
  duplicate_policy text not null default 'link' check (duplicate_policy in ('link', 'flag', 'review')),
  assignment_strategy text not null default 'manual' check (assignment_strategy in ('manual', 'round_robin', 'criteria')),
  criteria_fallback_round_robin boolean not null default true,
  rr_last_user uuid,
  alert_no_contact_hours integer not null default 24 check (alert_no_contact_hours between 1 and 720),
  privacy_policy_url text check (privacy_policy_url is null or (privacy_policy_url ~ '^https://[^\s]+$' and char_length(privacy_policy_url) <= 300)),
  retention_days integer check (retention_days is null or retention_days between 30 and 3650),
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  updated_at timestamptz not null default now()
);

create table public.lead_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  description text check (description is null or char_length(description) <= 600),
  status public.lead_form_status not null default 'draft',
  current_published_version_id uuid,
  thank_you_message text not null default 'Obrigado! Recebemos suas informações e entraremos em contato.' check (char_length(thank_you_message) between 1 and 600),
  success_redirect_url text check (success_redirect_url is null or (success_redirect_url ~ '^https://[^\s]+$' and char_length(success_redirect_url) <= 300)),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index lead_forms_org_idx on public.lead_forms (organization_id, status);

create table public.lead_form_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  form_id uuid not null,
  version_number integer not null check (version_number >= 1),
  schema_json jsonb not null default '{"steps":[],"fields":[]}'::jsonb check (jsonb_typeof(schema_json) = 'object' and pg_column_size(schema_json) <= 131072),
  ui_schema_json jsonb not null default '{}'::jsonb check (jsonb_typeof(ui_schema_json) = 'object' and pg_column_size(ui_schema_json) <= 16384),
  conditional_logic_json jsonb not null default '[]'::jsonb check (jsonb_typeof(conditional_logic_json) = 'array' and pg_column_size(conditional_logic_json) <= 65536),
  consent_config_json jsonb not null default '{"required":true,"text":"Concordo com o tratamento dos meus dados para contato comercial."}'::jsonb check (jsonb_typeof(consent_config_json) = 'object' and pg_column_size(consent_config_json) <= 8192),
  published_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (form_id, version_number),
  foreign key (form_id, organization_id) references public.lead_forms (id, organization_id) on delete cascade
);
create unique index lead_form_one_draft on public.lead_form_versions (form_id) where published_at is null;
alter table public.lead_forms
  add foreign key (current_published_version_id, organization_id) references public.lead_form_versions (id, organization_id) on delete set null (current_published_version_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  source text check (source is null or char_length(source) <= 80),
  medium text check (medium is null or char_length(medium) <= 80),
  campaign_key text not null check (campaign_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, campaign_key)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Sem nome' check (char_length(name) between 1 and 160),
  email text check (email is null or (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  company_name text check (company_name is null or char_length(company_name) <= 160),
  segment text check (segment is null or char_length(segment) <= 120),
  status public.lead_status not null default 'new',
  qualification text check (qualification is null or qualification in ('cold', 'warm', 'hot')),
  qualified boolean,
  current_score integer check (current_score is null or current_score between 0 and 100),
  assigned_to uuid,
  source text check (source is null or char_length(source) <= 80),
  medium text check (medium is null or char_length(medium) <= 80),
  campaign_id uuid,
  first_form_id uuid,
  duplicate_of uuid,
  needs_review boolean not null default false,
  disqualify_reason text check (disqualify_reason is null or char_length(disqualify_reason) <= 200),
  notes text check (notes is null or char_length(notes) <= 4000),
  converted_at timestamptz,
  first_contact_at timestamptz,
  archived_at timestamptz,
  anonymized_at timestamptz,
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id) on delete set null (assigned_to),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete set null (campaign_id),
  foreign key (first_form_id, organization_id) references public.lead_forms (id, organization_id) on delete set null (first_form_id),
  foreign key (duplicate_of, organization_id) references public.leads (id, organization_id) on delete set null (duplicate_of)
);
create index leads_org_status_idx on public.leads (organization_id, status, created_at desc);
create index leads_org_assignee_idx on public.leads (organization_id, assigned_to);
create index leads_org_email_idx on public.leads (organization_id, email) where email is not null;
create index leads_org_phone_idx on public.leads (organization_id, phone) where phone is not null;
create index leads_org_campaign_idx on public.leads (organization_id, campaign_id);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  form_id uuid not null,
  form_version_id uuid not null,
  lead_id uuid not null,
  answers_json jsonb not null check (jsonb_typeof(answers_json) = 'object' and pg_column_size(answers_json) <= 32768),
  consent_given boolean not null default false,
  submission_key uuid,
  is_duplicate boolean not null default false,
  source text check (source is null or char_length(source) <= 80),
  utm_source text check (utm_source is null or char_length(utm_source) <= 120),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 120),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 120),
  utm_content text check (utm_content is null or char_length(utm_content) <= 120),
  utm_term text check (utm_term is null or char_length(utm_term) <= 120),
  landing_page text check (landing_page is null or char_length(landing_page) <= 300),
  submitted_at timestamptz not null default now(),
  foreign key (form_id, organization_id) references public.lead_forms (id, organization_id) on delete cascade,
  foreign key (form_version_id, organization_id) references public.lead_form_versions (id, organization_id) on delete restrict,
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create unique index form_submissions_key_uniq on public.form_submissions (form_id, submission_key) where submission_key is not null;
create index form_submissions_lead_idx on public.form_submissions (lead_id, submitted_at desc);
create index form_submissions_org_idx on public.form_submissions (organization_id, submitted_at desc);

create table public.scoring_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  version integer not null check (version >= 1),
  status public.scoring_model_status not null default 'draft',
  score_config_json jsonb not null default '{}'::jsonb check (jsonb_typeof(score_config_json) = 'object' and pg_column_size(score_config_json) <= 8192),
  thresholds_json jsonb not null default '{"warm_min":40,"hot_min":70,"qualified_min":70}'::jsonb check (jsonb_typeof(thresholds_json) = 'object'),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, version)
);
create unique index scoring_one_published on public.scoring_models (organization_id) where status = 'published';
create unique index scoring_one_draft on public.scoring_models (organization_id) where status = 'draft';

create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  model_id uuid not null,
  label text not null check (char_length(label) between 1 and 120),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  operator text not null check (operator in ('eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'is_true', 'answered', 'not_answered')),
  condition_json jsonb default 'null'::jsonb check (pg_column_size(condition_json) <= 4096),
  points integer not null check (points between -100 and 100),
  priority integer not null default 100 check (priority between 0 and 10000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (model_id, organization_id) references public.scoring_models (id, organization_id) on delete cascade
);
create index scoring_rules_model_idx on public.scoring_rules (model_id, priority);

create table public.lead_score_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  scoring_model_id uuid,
  submission_id uuid,
  score integer not null check (score between 0 and 100),
  classification text not null check (classification in ('cold', 'warm', 'hot')),
  qualified boolean not null,
  explanation_json jsonb not null check (pg_column_size(explanation_json) <= 32768),
  evaluated_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade,
  foreign key (scoring_model_id, organization_id) references public.scoring_models (id, organization_id) on delete restrict
);
create index lead_score_events_lead_idx on public.lead_score_events (lead_id, id desc);
create index lead_score_events_org_idx on public.lead_score_events (organization_id, evaluated_at desc);

create table public.lead_sellers (
  organization_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

create table public.distribution_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  priority integer not null default 100 check (priority between 0 and 10000),
  enabled boolean not null default true,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  operator text not null check (operator in ('eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'is_true', 'answered', 'not_answered')),
  condition_json jsonb default 'null'::jsonb check (pg_column_size(condition_json) <= 4096),
  assign_to uuid not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, assign_to) references public.organization_members (organization_id, user_id) on delete cascade
);

create table public.lead_assignments (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  assigned_to uuid,
  assigned_by uuid,
  assignment_method public.lead_assign_method not null,
  assigned_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_assignments_lead_idx on public.lead_assignments (lead_id, id desc);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  lead_id uuid not null,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  type public.lead_activity_type not null default 'other',
  description text check (description is null or char_length(description) <= 2000),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index lead_activities_open_idx on public.lead_activities (organization_id, due_at) where completed_at is null;

create table public.lead_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  previous_status public.lead_status,
  new_status public.lead_status not null,
  reason text check (reason is null or char_length(reason) <= 200),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_status_history_lead_idx on public.lead_status_history (lead_id, id desc);

create table public.disqualification_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index disq_reason_uniq on public.disqualification_reasons (organization_id, lower(name));

-- Configuração de integrações (hoje: somente a IA opcional). Segredos NUNCA ficam aqui: só variáveis de ambiente do servidor.
create table public.integration_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('ai')),
  enabled boolean not null default false,
  config_json jsonb not null default '{}'::jsonb check (jsonb_typeof(config_json) = 'object' and pg_column_size(config_json) <= 4096),
  secret_reference text check (secret_reference is null or secret_reference ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  lead_id uuid not null,
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 80),
  analysis_json jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis_json) = 'object' and pg_column_size(analysis_json) <= 16384),
  status text not null check (status in ('ok', 'failed')),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  estimated_cost numeric(12, 6),
  tokens_in integer,
  tokens_out integer,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index ai_analyses_lead_idx on public.ai_analyses (lead_id, created_at desc);
create index ai_analyses_org_day_idx on public.ai_analyses (organization_id, created_at desc);

-- Limite de taxa da captação pública, COMPARTILHADO entre instâncias do app (nenhum privilégio para usuários).
create table public.public_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['lead_settings','lead_forms','leads','integration_configs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ======================================================================= condição e resposta (fonte única no banco)
create function private.lead_is_answered(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select a is not null and jsonb_typeof(a) <> 'null'
     and not (jsonb_typeof(a) = 'string' and btrim(a #>> '{}') = '')
     and not (jsonb_typeof(a) = 'array' and jsonb_array_length(a) = 0);
$$;

create function private.lead_try_numeric(a jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if a is null then return null; end if;
  if jsonb_typeof(a) = 'number' then return (a #>> '{}')::numeric; end if;
  if jsonb_typeof(a) = 'string' and (a #>> '{}') ~ '^\s*-?\d+([.,]\d+)?\s*$' then return replace(btrim(a #>> '{}'), ',', '.')::numeric; end if;
  return null;
end $$;

create function private.lead_scalar_eq(a jsonb, c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare an numeric; cn numeric; el jsonb;
begin
  if jsonb_typeof(a) = 'array' then
    for el in select value from jsonb_array_elements(a) loop
      if private.lead_scalar_eq(el, c) then return true; end if;
    end loop;
    return false;
  end if;
  an := private.lead_try_numeric(a); cn := private.lead_try_numeric(c);
  if jsonb_typeof(a) = 'number' and cn is not null then return an = cn; end if;
  return lower(a #>> '{}') = lower(c #>> '{}');
end $$;

-- Operadores FECHADOS. Devolve null quando a resposta falta (a regra "não se aplica").
create function private.lead_cond(p_op text, p_ans jsonb, p_cond jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n numeric; c numeric; lo numeric; hi numeric; el jsonb; hit boolean;
begin
  if p_op = 'answered' then return private.lead_is_answered(p_ans); end if;
  if p_op = 'not_answered' then return not private.lead_is_answered(p_ans); end if;
  if not private.lead_is_answered(p_ans) then return null; end if;
  if p_op = 'is_true' then return p_ans = 'true'::jsonb; end if;
  if p_op in ('eq', 'neq') then
    hit := private.lead_scalar_eq(p_ans, p_cond);
    return case when p_op = 'eq' then hit else not hit end;
  end if;
  if p_op in ('in', 'not_in') then
    if p_cond is null or jsonb_typeof(p_cond) <> 'array' then return null; end if;
    hit := false;
    for el in select value from jsonb_array_elements(p_cond) loop
      if private.lead_scalar_eq(p_ans, el) then hit := true; exit; end if;
    end loop;
    return case when p_op = 'in' then hit else not hit end;
  end if;
  if p_op in ('gt', 'gte', 'lt', 'lte') then
    n := private.lead_try_numeric(p_ans); c := private.lead_try_numeric(p_cond);
    if n is null or c is null then return null; end if;
    return case p_op when 'gt' then n > c when 'gte' then n >= c when 'lt' then n < c else n <= c end;
  end if;
  if p_op = 'between' then
    n := private.lead_try_numeric(p_ans);
    lo := private.lead_try_numeric(p_cond -> 'min'); hi := private.lead_try_numeric(p_cond -> 'max');
    if n is null or lo is null or hi is null then return null; end if;
    return n between lo and hi;
  end if;
  if p_op = 'contains' then
    if p_cond is null or jsonb_typeof(p_cond) = 'null' then return null; end if;
    if jsonb_typeof(p_ans) = 'array' then return private.lead_scalar_eq(p_ans, p_cond); end if;
    return strpos(lower(p_ans #>> '{}'), lower(p_cond #>> '{}')) > 0;
  end if;
  return null;
end $$;

-- ======================================================================= validação de DEFINIÇÃO do formulário (publicação)
-- Devolve lista de problemas (vazia = válido). schema: {steps:[{id,title}], fields:[...]}; logic: [{target, show_if:{all|any:[{field,op,value}]}}]
create function public.lead_validate_form_def(p_schema jsonb, p_logic jsonb, p_consent jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  errs jsonb := '[]'::jsonb; f jsonb; keys text[] := '{}'; k text; t text; i int := 0; step_ids text[] := '{}'; s jsonb;
  has_contact boolean := false; seen_name boolean := false; seen_email boolean := false; seen_phone boolean := false; seen_company boolean := false; seen_segment boolean := false;
  o jsonb; ovals text[]; lf text; rule jsonb; cond jsonb; pos int; earlier text[]; branch text; ctarget int;
begin
  if jsonb_typeof(p_schema) <> 'object' or jsonb_typeof(p_schema -> 'fields') <> 'array' then
    return jsonb_build_array('Esquema inválido.');
  end if;
  if jsonb_array_length(p_schema -> 'fields') = 0 then errs := errs || to_jsonb('Adicione ao menos uma pergunta.'::text); end if;
  if jsonb_array_length(p_schema -> 'fields') > 60 then errs := errs || to_jsonb('No máximo 60 perguntas.'::text); end if;
  if jsonb_typeof(coalesce(p_schema -> 'steps', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_schema -> 'steps', '[]'::jsonb)) > 10 then
    errs := errs || to_jsonb('No máximo 10 etapas.'::text);
  else
    for s in select value from jsonb_array_elements(coalesce(p_schema -> 'steps', '[]'::jsonb)) loop
      if coalesce(s ->> 'id', '') !~ '^[a-z][a-z0-9_]{0,29}$' or char_length(coalesce(s ->> 'title', '')) not between 1 and 80 or (s ->> 'id') = any(step_ids) then
        errs := errs || to_jsonb('Etapa inválida ou repetida.'::text);
      else step_ids := step_ids || (s ->> 'id'); end if;
    end loop;
  end if;

  for f in select value from jsonb_array_elements(p_schema -> 'fields') loop
    i := i + 1;
    k := f ->> 'key'; t := f ->> 'type';
    if k is null or k !~ '^[a-z][a-z0-9_]{0,39}$' then errs := errs || to_jsonb(format('Pergunta %s: chave inválida (use letras minúsculas, números e _).', i)); continue; end if;
    if k = any(keys) then errs := errs || to_jsonb(format('Chave repetida: %s.', k)); continue; end if;
    keys := keys || k;
    if t is null or t not in ('text', 'textarea', 'email', 'phone', 'number', 'currency', 'select', 'radio', 'checkbox', 'date', 'multiselect', 'hidden', 'consent') then
      errs := errs || to_jsonb(format('Pergunta %s: tipo inválido.', k)); continue;
    end if;
    if char_length(coalesce(f ->> 'label', '')) not between 1 and 200 then errs := errs || to_jsonb(format('Pergunta %s: informe o rótulo (até 200 caracteres).', k)); end if;
    if f ? 'step' and cardinality(step_ids) > 0 and not ((f ->> 'step') = any(step_ids)) then errs := errs || to_jsonb(format('Pergunta %s: etapa inexistente.', k)); end if;
    if f ? 'help' and char_length(coalesce(f ->> 'help', '')) > 400 then errs := errs || to_jsonb(format('Pergunta %s: ajuda muito longa.', k)); end if;
    if t in ('select', 'radio', 'multiselect') then
      if jsonb_typeof(f -> 'options') <> 'array' or jsonb_array_length(f -> 'options') not between 2 and 50 then
        errs := errs || to_jsonb(format('Pergunta %s: informe de 2 a 50 opções.', k));
      else
        ovals := '{}';
        for o in select value from jsonb_array_elements(f -> 'options') loop
          if char_length(coalesce(o ->> 'value', '')) not between 1 and 80 or char_length(coalesce(o ->> 'label', '')) not between 1 and 160 or (o ->> 'value') = any(ovals) then
            errs := errs || to_jsonb(format('Pergunta %s: opção inválida ou repetida.', k)); exit;
          end if;
          ovals := ovals || (o ->> 'value');
        end loop;
      end if;
    end if;
    lf := f ->> 'lead_field';
    if lf is not null then
      if lf not in ('name', 'email', 'phone', 'company_name', 'segment') then errs := errs || to_jsonb(format('Pergunta %s: vínculo inválido com o lead.', k)); end if;
      if (lf = 'name' and seen_name) or (lf = 'email' and seen_email) or (lf = 'phone' and seen_phone) or (lf = 'company_name' and seen_company) or (lf = 'segment' and seen_segment) then
        errs := errs || to_jsonb(format('Mais de uma pergunta vinculada a «%s».', lf));
      end if;
      seen_name := seen_name or lf = 'name'; seen_email := seen_email or lf = 'email'; seen_phone := seen_phone or lf = 'phone';
      seen_company := seen_company or lf = 'company_name'; seen_segment := seen_segment or lf = 'segment';
      if lf in ('email', 'phone') and coalesce((f ->> 'required')::boolean, false) then has_contact := true; end if;
      if lf = 'email' and t <> 'email' then errs := errs || to_jsonb(format('Pergunta %s: o vínculo «email» exige o tipo e-mail.', k)); end if;
      if lf = 'phone' and t <> 'phone' then errs := errs || to_jsonb(format('Pergunta %s: o vínculo «phone» exige o tipo telefone.', k)); end if;
    end if;
  end loop;

  if not has_contact then errs := errs || to_jsonb('O formulário precisa de uma pergunta OBRIGATÓRIA de e-mail ou telefone vinculada ao lead.'::text); end if;

  if jsonb_typeof(p_logic) <> 'array' or jsonb_array_length(p_logic) > 60 then
    errs := errs || to_jsonb('Lógica condicional inválida.'::text);
  else
    for rule in select value from jsonb_array_elements(p_logic) loop
      k := rule ->> 'target';
      if k is null or not (k = any(keys)) then errs := errs || to_jsonb(format('Condição para pergunta inexistente: %s.', coalesce(k, '?'))); continue; end if;
      pos := array_position(keys, k);
      earlier := keys[1:pos - 1];
      -- campo de contato obrigatório não pode ficar escondido
      if exists (select 1 from jsonb_array_elements(p_schema -> 'fields') x where x ->> 'key' = k and (x ->> 'lead_field') in ('email', 'phone') and coalesce((x ->> 'required')::boolean, false)) then
        errs := errs || to_jsonb(format('A pergunta %s (contato obrigatório) não pode ser condicional.', k));
      end if;
      foreach branch in array array['all', 'any'] loop
        if (rule -> 'show_if') ? branch then
          if jsonb_typeof(rule -> 'show_if' -> branch) <> 'array' or jsonb_array_length(rule -> 'show_if' -> branch) not between 1 and 10 then
            errs := errs || to_jsonb(format('Condição de %s inválida.', k)); continue;
          end if;
          for cond in select value from jsonb_array_elements(rule -> 'show_if' -> branch) loop
            if coalesce(cond ->> 'op', '') not in ('eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_true', 'answered', 'not_answered') then
              errs := errs || to_jsonb(format('Condição de %s: operador inválido.', k));
            elsif not ((cond ->> 'field') = any(earlier)) then
              errs := errs || to_jsonb(format('Condição de %s: só pode depender de perguntas ANTERIORES.', k));
            end if;
          end loop;
        end if;
      end loop;
      if not ((rule -> 'show_if') ? 'all' or (rule -> 'show_if') ? 'any') then errs := errs || to_jsonb(format('Condição de %s sem regras.', k)); end if;
    end loop;
  end if;

  if jsonb_typeof(p_consent) <> 'object' or char_length(coalesce(p_consent ->> 'text', '')) not between 1 and 600 then
    errs := errs || to_jsonb('Informe o texto do consentimento/aviso de privacidade (até 600 caracteres).'::text);
  end if;
  return errs;
end $$;

-- ======================================================================= validação do ENVIO contra a versão publicada
-- Devolve {clean:{...}, hidden:[chaves ocultas], errors:{chave:mensagem}}. Campos ocultos pela lógica são DESCARTADOS
-- (a resposta para um campo que não deveria aparecer não é confiada). Chaves desconhecidas são ignoradas.
create function public.lead_validate_answers(p_schema jsonb, p_logic jsonb, p_answers jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb; k text; t text; v jsonb; clean jsonb := '{}'::jsonb; hidden text[] := '{}'; errs jsonb := '{}'::jsonb;
  rule jsonb; visible boolean; cond jsonb; res boolean; all_ok boolean; any_ok boolean; ans jsonb; txt text; n numeric; mx int; o jsonb; ok boolean; arr jsonb; el jsonb; vals text[]; req boolean; d date;
begin
  if jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 32768 then
    return jsonb_build_object('clean', '{}'::jsonb, 'hidden', '[]'::jsonb, 'errors', jsonb_build_object('_', 'Dados inválidos.'));
  end if;
  for f in select value from jsonb_array_elements(p_schema -> 'fields') loop
    k := f ->> 'key'; t := f ->> 'type'; req := coalesce((f ->> 'required')::boolean, false) or t = 'consent';
    -- visibilidade
    visible := true;
    for rule in select value from jsonb_array_elements(p_logic) where value ->> 'target' = k loop
      all_ok := true; any_ok := false;
      if (rule -> 'show_if') ? 'all' then
        for cond in select value from jsonb_array_elements(rule -> 'show_if' -> 'all') loop
          res := coalesce(private.lead_cond(cond ->> 'op', clean -> (cond ->> 'field'), cond -> 'value'), false);
          if not res then all_ok := false; end if;
        end loop;
      end if;
      if (rule -> 'show_if') ? 'any' then
        for cond in select value from jsonb_array_elements(rule -> 'show_if' -> 'any') loop
          res := coalesce(private.lead_cond(cond ->> 'op', clean -> (cond ->> 'field'), cond -> 'value'), false);
          if res then any_ok := true; end if;
        end loop;
        if not any_ok then all_ok := false; end if;
      end if;
      if not all_ok then visible := false; end if;
    end loop;
    if not visible then hidden := hidden || k; continue; end if;

    ans := p_answers -> k;
    if ans is null or jsonb_typeof(ans) = 'null' or (jsonb_typeof(ans) = 'string' and btrim(ans #>> '{}') = '') or (jsonb_typeof(ans) = 'array' and jsonb_array_length(ans) = 0) then
      if t in ('checkbox', 'consent') and ans = 'false'::jsonb then
        if req then errs := errs || jsonb_build_object(k, 'Marque esta opção para continuar.'); else clean := clean || jsonb_build_object(k, false); end if;
      elsif req then errs := errs || jsonb_build_object(k, 'Campo obrigatório.');
      end if;
      continue;
    end if;
    case t
      when 'text', 'textarea', 'hidden' then
        if jsonb_typeof(ans) <> 'string' then errs := errs || jsonb_build_object(k, 'Resposta inválida.'); continue; end if;
        txt := regexp_replace(btrim(ans #>> '{}'), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g');
        mx := coalesce((f ->> 'max_length')::int, case t when 'textarea' then 2000 else 200 end);
        if mx > 4000 then mx := 4000; end if;
        if char_length(txt) > mx then errs := errs || jsonb_build_object(k, format('Máximo de %s caracteres.', mx)); continue; end if;
        clean := clean || jsonb_build_object(k, txt);
      when 'email' then
        txt := lower(btrim(coalesce(ans #>> '{}', '')));
        if jsonb_typeof(ans) <> 'string' or char_length(txt) > 254 or txt !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then errs := errs || jsonb_build_object(k, 'E-mail inválido.'); continue; end if;
        clean := clean || jsonb_build_object(k, txt);
      when 'phone' then
        txt := coalesce(ans #>> '{}', '');
        if jsonb_typeof(ans) <> 'string' or txt !~ '^[0-9+()\-.\s]{8,25}$' or private.lead_norm_phone(txt) is null then errs := errs || jsonb_build_object(k, 'Telefone inválido.'); continue; end if;
        clean := clean || jsonb_build_object(k, txt);
      when 'number', 'currency' then
        n := private.lead_try_numeric(ans);
        if n is null or abs(n) > 1000000000000 or (t = 'currency' and n < 0) then errs := errs || jsonb_build_object(k, 'Número inválido.'); continue; end if;
        if (f ->> 'min') is not null and n < (f ->> 'min')::numeric then errs := errs || jsonb_build_object(k, format('Valor mínimo: %s.', f ->> 'min')); continue; end if;
        if (f ->> 'max') is not null and n > (f ->> 'max')::numeric then errs := errs || jsonb_build_object(k, format('Valor máximo: %s.', f ->> 'max')); continue; end if;
        clean := clean || jsonb_build_object(k, round(n, 2));
      when 'select', 'radio' then
        txt := ans #>> '{}';
        if jsonb_typeof(ans) <> 'string' or not exists (select 1 from jsonb_array_elements(f -> 'options') opt where opt ->> 'value' = txt) then errs := errs || jsonb_build_object(k, 'Escolha uma opção válida.'); continue; end if;
        clean := clean || jsonb_build_object(k, txt);
      when 'multiselect' then
        if jsonb_typeof(ans) <> 'array' or jsonb_array_length(ans) > 20 then errs := errs || jsonb_build_object(k, 'Escolha opções válidas.'); continue; end if;
        vals := '{}'; ok := true;
        for el in select value from jsonb_array_elements(ans) loop
          if jsonb_typeof(el) <> 'string' or not exists (select 1 from jsonb_array_elements(f -> 'options') opt where opt ->> 'value' = (el #>> '{}')) then ok := false; exit; end if;
          if not ((el #>> '{}') = any(vals)) then vals := vals || (el #>> '{}'); end if;
        end loop;
        if not ok then errs := errs || jsonb_build_object(k, 'Escolha opções válidas.'); continue; end if;
        clean := clean || jsonb_build_object(k, to_jsonb(vals));
      when 'checkbox', 'consent' then
        if jsonb_typeof(ans) <> 'boolean' then errs := errs || jsonb_build_object(k, 'Resposta inválida.'); continue; end if;
        if req and ans <> 'true'::jsonb then errs := errs || jsonb_build_object(k, 'Marque esta opção para continuar.'); continue; end if;
        clean := clean || jsonb_build_object(k, ans);
      when 'date' then
        txt := coalesce(ans #>> '{}', '');
        begin d := txt::date; exception when others then d := null; end;
        if jsonb_typeof(ans) <> 'string' or txt !~ '^\d{4}-\d{2}-\d{2}$' or d is null or to_char(d, 'YYYY-MM-DD') <> txt then errs := errs || jsonb_build_object(k, 'Data inválida.'); continue; end if;
        clean := clean || jsonb_build_object(k, txt);
      else null;
    end case;
  end loop;
  return jsonb_build_object('clean', clean, 'hidden', to_jsonb(hidden), 'errors', errs);
end $$;

-- ======================================================================= MOTOR DE SCORE (fonte única; docs/SCORING.md)
-- rules: [{id,label,field_key,operator,condition,points,enabled}]; thresholds: {warm_min,hot_min,qualified_min}
create function public.lead_score_compute(p_rules jsonb, p_answers jsonb, p_thresholds jsonb, p_hidden text[] default '{}')
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  r jsonb; raw bigint := 0; applied jsonb := '[]'::jsonb; missing text[] := '{}'; res boolean; ans jsonb; pts int; sc int; cls text;
  warm int := coalesce((p_thresholds ->> 'warm_min')::int, 40); hot int := coalesce((p_thresholds ->> 'hot_min')::int, 70); qmin int := coalesce((p_thresholds ->> 'qualified_min')::int, coalesce((p_thresholds ->> 'hot_min')::int, 70));
  fk text;
begin
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'regras inválidas' using errcode = '22023'; end if;
  if jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  if not (warm > 0 and warm < hot and hot <= 100 and qmin between 0 and 100) then raise exception 'faixas inválidas' using errcode = '22023'; end if;
  for r in select value from jsonb_array_elements(p_rules) loop
    if not coalesce((r ->> 'enabled')::boolean, true) then continue; end if;
    fk := r ->> 'field_key';
    ans := p_answers -> fk;
    pts := (r ->> 'points')::int;
    res := private.lead_cond(r ->> 'operator', ans, r -> 'condition');
    if res is null then
      if not private.lead_is_answered(ans) and not (fk = any(p_hidden)) and not (fk = any(missing)) then missing := missing || fk; end if;
    elsif res then
      raw := raw + pts;
      applied := applied || jsonb_build_object('rule_id', r -> 'id', 'label', r ->> 'label', 'field_key', fk, 'points', pts);
    end if;
  end loop;
  sc := greatest(0, least(100, raw))::int;
  cls := case when sc >= hot then 'hot' when sc >= warm then 'warm' else 'cold' end;
  return jsonb_build_object('raw_total', raw, 'score', sc, 'classification', cls, 'qualified', sc >= qmin, 'applied', applied, 'missing', to_jsonb(missing));
end $$;

-- ======================================================================= regras em gatilhos
-- Modelo publicado/arquivado é imutável (regras incluídas).
create function private.lead_model_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (new.name, new.thresholds_json, new.score_config_json, new.version, new.organization_id) is distinct from (old.name, old.thresholds_json, old.score_config_json, old.version, old.organization_id) then
    raise exception 'modelo publicado é imutável: crie um rascunho' using errcode = '23514';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then raise exception 'modelo arquivado não volta' using errcode = '23514'; end if;
  if old.status = 'published' and new.status = 'draft' then raise exception 'modelo publicado não volta a rascunho' using errcode = '23514'; end if;
  return new;
end $$;
create trigger scoring_models_immutable before update on public.scoring_models for each row execute function private.lead_model_immutable();

create function private.lead_rules_immutable() returns trigger
language plpgsql set search_path = '' as $$
declare mid uuid := case when tg_op = 'DELETE' then old.model_id else new.model_id end;
begin
  if exists (select 1 from public.scoring_models m where m.id = mid and m.status <> 'draft') then
    raise exception 'regras de modelo publicado são imutáveis' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger scoring_rules_immutable before insert or update or delete on public.scoring_rules for each row execute function private.lead_rules_immutable();

-- Versão de formulário publicada é imutável.
create function private.lead_form_version_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.published_at is not null then raise exception 'versão publicada é imutável' using errcode = '23514'; end if;
  return new;
end $$;
create trigger lead_form_versions_immutable before update on public.lead_form_versions for each row execute function private.lead_form_version_immutable();

-- O link público (slug) não muda depois que o formulário foi publicado alguma vez.
create function private.lead_form_slug_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.slug is distinct from old.slug and exists (select 1 from public.lead_form_versions v where v.form_id = old.id and v.published_at is not null) then
    raise exception 'o link do formulário não pode mudar depois de publicado' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger lead_forms_slug_lock before update of slug on public.lead_forms for each row execute function private.lead_form_slug_lock();

-- Normalização de contato e consistência do lead.
create function private.lead_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := private.lead_norm_email(new.email);
  if new.phone is not null then new.phone := private.lead_norm_phone(new.phone); end if;
  new.name := coalesce(nullif(btrim(new.name), ''), 'Sem nome');
  if new.email is null and new.phone is null and new.anonymized_at is null then raise exception 'informe e-mail ou telefone' using errcode = '23514'; end if;
  return new;
end $$;
create trigger leads_normalize before insert or update of email, phone, name on public.leads for each row execute function private.lead_normalize();

-- Transições de status válidas (defesa em profundidade; a função lead_change_status também valida).
create function private.lead_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'new' and new.status in ('qualifying', 'qualified', 'contacted', 'disqualified')) or
    (old.status = 'qualifying' and new.status in ('new', 'qualified', 'contacted', 'disqualified')) or
    (old.status = 'qualified' and new.status in ('qualifying', 'contacted', 'converted', 'disqualified')) or
    (old.status = 'contacted' and new.status in ('qualified', 'converted', 'disqualified')) or
    (old.status = 'disqualified' and new.status in ('new', 'qualifying'))
  ) then
    raise exception 'transição de status não permitida: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger leads_status_guard before update of status on public.leads for each row execute function private.lead_status_guard();

-- Primeiro atendimento = primeira atividade CONCLUÍDA (registrar tarefa não conta).
create function private.lead_first_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.completed_at is not null then
    update public.leads set first_contact_at = new.completed_at where id = new.lead_id and first_contact_at is null;
  end if;
  return null;
end $$;
revoke all on function private.lead_first_contact() from public;
create trigger lead_activities_first_contact after insert or update of completed_at on public.lead_activities for each row execute function private.lead_first_contact();

-- ======================================================================= padrões por organização
create function private.lead_bootstrap_org(org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.lead_settings (organization_id) values (org) on conflict do nothing;
  insert into public.disqualification_reasons (organization_id, name) values
    (org, 'Sem orçamento'), (org, 'Sem interesse'), (org, 'Fora do perfil'), (org, 'Contato inválido'), (org, 'Já é cliente'), (org, 'Outro')
  on conflict do nothing;
end $$;
revoke all on function private.lead_bootstrap_org(uuid) from public;
create function private.lead_on_org_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform private.lead_bootstrap_org(new.id); return null; end $$;
revoke all on function private.lead_on_org_created() from public;
create trigger lead_on_org_created after insert on public.organizations for each row execute function private.lead_on_org_created();
select private.lead_bootstrap_org(id) from public.organizations;

do $$
declare t text;
begin
  foreach t in array array['lead_forms','leads','scoring_models','scoring_rules','distribution_rules','campaigns'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
  create trigger audit_lead_settings after update on public.lead_settings for each row execute function private.audit_trigger('organization_id', 'organization_id');
  create trigger audit_integration_configs after insert or update or delete on public.integration_configs for each row execute function private.audit_trigger('organization_id', 'id');
end $$;

-- ======================================================================= RLS
do $$
declare t text;
begin
  foreach t in array array['lead_settings','lead_forms','lead_form_versions','campaigns','leads','form_submissions','scoring_models','scoring_rules','lead_score_events',
                           'lead_sellers','distribution_rules','lead_assignments','lead_activities','lead_status_history','disqualification_reasons','integration_configs','ai_analyses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- limites de taxa: sem nenhum acesso (só as funções públicas escrevem)
alter table public.public_rate_limits enable row level security;
revoke all on public.public_rate_limits from anon, authenticated;

-- Configuração: membros leem; gestão/administração escrevem conforme o caso.
create policy lead_settings_select on public.lead_settings for select to authenticated using (private.is_member(organization_id));
create policy lead_settings_update on public.lead_settings for update to authenticated
  using (private.lead_is_admin(organization_id)) with check (private.lead_is_admin(organization_id));

create policy lead_forms_select on public.lead_forms for select to authenticated using (private.lead_is_manager(organization_id) or private.lead_role(organization_id) = 'viewer');
create policy lead_form_versions_select on public.lead_form_versions for select to authenticated using (private.lead_is_manager(organization_id) or private.lead_role(organization_id) = 'viewer');

create policy campaigns_select on public.campaigns for select to authenticated using (private.is_member(organization_id));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (private.lead_is_manager(organization_id));
create policy campaigns_update on public.campaigns for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));

create policy leads_select on public.leads for select to authenticated using (private.lead_can_read(organization_id, assigned_to));
create policy leads_update on public.leads for update to authenticated
  using (private.lead_can_write(organization_id, assigned_to)) with check (private.lead_can_write(organization_id, assigned_to));

-- Tabelas do lead: lê quem enxerga o lead.
do $$
declare t text;
begin
  foreach t in array array['form_submissions','lead_score_events','lead_assignments','lead_status_history','ai_analyses'] loop
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id))', t || '_select', t);
  end loop;
end $$;

create policy lead_activities_select on public.lead_activities for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (exists (select 1 from public.leads l where l.id = lead_id and private.lead_can_write(l.organization_id, l.assigned_to)));
create policy lead_activities_update on public.lead_activities for update to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id and private.lead_can_write(l.organization_id, l.assigned_to)))
  with check (exists (select 1 from public.leads l where l.id = lead_id and private.lead_can_write(l.organization_id, l.assigned_to)));
create policy lead_activities_delete on public.lead_activities for delete to authenticated using (private.lead_is_manager(organization_id));

-- Score: gestão lê regras e modelos; vendedor lê o modelo vigente (para entender o score).
create policy scoring_models_select on public.scoring_models for select to authenticated using (private.is_member(organization_id));
create policy scoring_models_insert on public.scoring_models for insert to authenticated with check (private.lead_is_manager(organization_id) and status = 'draft');
create policy scoring_models_update on public.scoring_models for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));
create policy scoring_rules_select on public.scoring_rules for select to authenticated using (private.is_member(organization_id));
create policy scoring_rules_insert on public.scoring_rules for insert to authenticated with check (private.lead_is_manager(organization_id));
create policy scoring_rules_update on public.scoring_rules for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));
create policy scoring_rules_delete on public.scoring_rules for delete to authenticated using (private.lead_is_manager(organization_id));

create policy lead_sellers_select on public.lead_sellers for select to authenticated using (private.is_member(organization_id));
create policy lead_sellers_insert on public.lead_sellers for insert to authenticated with check (private.lead_is_manager(organization_id));
create policy lead_sellers_update on public.lead_sellers for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));
create policy lead_sellers_delete on public.lead_sellers for delete to authenticated using (private.lead_is_manager(organization_id));
create policy distribution_rules_select on public.distribution_rules for select to authenticated using (private.lead_is_manager(organization_id));
create policy distribution_rules_insert on public.distribution_rules for insert to authenticated with check (private.lead_is_manager(organization_id));
create policy distribution_rules_update on public.distribution_rules for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));
create policy distribution_rules_delete on public.distribution_rules for delete to authenticated using (private.lead_is_manager(organization_id));

create policy disq_reasons_select on public.disqualification_reasons for select to authenticated using (private.is_member(organization_id));
create policy disq_reasons_insert on public.disqualification_reasons for insert to authenticated with check (private.lead_is_manager(organization_id));
create policy disq_reasons_update on public.disqualification_reasons for update to authenticated using (private.lead_is_manager(organization_id)) with check (private.lead_is_manager(organization_id));

create policy integration_configs_select on public.integration_configs for select to authenticated using (private.lead_is_admin(organization_id));
create policy integration_configs_insert on public.integration_configs for insert to authenticated with check (private.lead_is_admin(organization_id));
create policy integration_configs_update on public.integration_configs for update to authenticated using (private.lead_is_admin(organization_id)) with check (private.lead_is_admin(organization_id));

-- MFA no banco (padrão do Core): escrita de owner/admin exige AAL2.
do $$
declare t text;
begin
  foreach t in array array['lead_settings','campaigns','leads','scoring_models','scoring_rules','lead_sellers','distribution_rules','lead_activities','disqualification_reasons','integration_configs'] loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
  end loop;
end $$;

-- Privilégios por coluna (status, atribuição, score e datas só por funções; created_by e organization_id nunca em UPDATE).
grant update (timezone, duplicate_policy, assignment_strategy, criteria_fallback_round_robin, alert_no_contact_hours, privacy_policy_url, retention_days, custom) on public.lead_settings to authenticated;
grant insert (organization_id, name, source, medium, campaign_key) on public.campaigns to authenticated;
grant update (name, source, medium) on public.campaigns to authenticated;
grant update (name, email, phone, company_name, segment, notes, archived_at, custom) on public.leads to authenticated;
grant insert (organization_id, name, version, score_config_json, thresholds_json, status) on public.scoring_models to authenticated;
grant update (name, thresholds_json, score_config_json, status, published_at) on public.scoring_models to authenticated;
grant insert (organization_id, model_id, label, field_key, operator, condition_json, points, priority, enabled) on public.scoring_rules to authenticated;
grant update (label, field_key, operator, condition_json, points, priority, enabled) on public.scoring_rules to authenticated;
grant delete on public.scoring_rules to authenticated;
grant insert (organization_id, user_id, active) on public.lead_sellers to authenticated;
grant update (active) on public.lead_sellers to authenticated;
grant delete on public.lead_sellers to authenticated;
grant insert (organization_id, name, priority, enabled, field_key, operator, condition_json, assign_to) on public.distribution_rules to authenticated;
grant update (name, priority, enabled, field_key, operator, condition_json, assign_to) on public.distribution_rules to authenticated;
grant delete on public.distribution_rules to authenticated;
grant insert (organization_id, name, active) on public.disqualification_reasons to authenticated;
grant update (name, active) on public.disqualification_reasons to authenticated;
grant insert (organization_id, lead_id, type, description, due_at, completed_at) on public.lead_activities to authenticated;
grant update (type, description, due_at, completed_at) on public.lead_activities to authenticated;
grant delete on public.lead_activities to authenticated;
grant insert (organization_id, provider, enabled, config_json, secret_reference) on public.integration_configs to authenticated;
grant update (enabled, config_json, secret_reference) on public.integration_configs to authenticated;

commit;
