-- Qualificador de Leads Inteligente — FLUXO (parte 2): formulários, captação pública, score, atribuição, pipeline, retenção.
-- Tudo que muda status, atribuição, score, versão de formulário ou modelo passa por estas funções
-- (security definer, search_path vazio, papel e MFA verificados DENTRO de cada uma).
-- O visitante (anon) só executa lead_public_form e lead_public_submit.

begin;

-- ======================================================================= utilitários
create function private.lead_assert_manager(org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.lead_is_manager(org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
end $$;
create function private.lead_assert_admin(org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.lead_is_admin(org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
end $$;
revoke all on function private.lead_assert_manager(uuid) from public;
revoke all on function private.lead_assert_admin(uuid) from public;

-- Limite de taxa compartilhado (tabela do banco): true = permitido.
create function private.lead_rate_hit(p_bucket text, p_window interval, p_max integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h integer;
begin
  insert into public.public_rate_limits (bucket, window_start, hits) values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when public.public_rate_limits.window_start < now() - p_window then 1 else public.public_rate_limits.hits + 1 end,
    window_start = case when public.public_rate_limits.window_start < now() - p_window then now() else public.public_rate_limits.window_start end
  returning hits into h;
  -- limpeza oportunista de janelas antigas
  if random() < 0.02 then delete from public.public_rate_limits where window_start < now() - interval '1 day'; end if;
  return h <= p_max;
end $$;
revoke all on function private.lead_rate_hit(text, interval, integer) from public;

create function private.lead_log_status(p_org uuid, p_lead uuid, p_prev public.lead_status, p_new public.lead_status, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status, reason, changed_by)
  values (p_org, p_lead, p_prev, p_new, p_reason, (select auth.uid()));
$$;
revoke all on function private.lead_log_status(uuid, uuid, public.lead_status, public.lead_status, text) from public;

-- ======================================================================= atribuição (trava por organização; idempotente)
create function private.lead_eligible(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user and m.role <> 'viewer');
$$;
revoke all on function private.lead_eligible(uuid, uuid) from public;

create function private.lead_assign_auto(p_lead uuid, p_answers jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.leads%rowtype; st public.lead_settings%rowtype; target uuid; method public.lead_assign_method; rule record; pool uuid[]; nxt uuid;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found or l.assigned_to is not null or l.archived_at is not null then return l.assigned_to; end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_assign:' || l.organization_id::text, 0));
  select * into st from public.lead_settings where organization_id = l.organization_id;
  if st.assignment_strategy = 'manual' then return null; end if;

  if st.assignment_strategy = 'criteria' then
    for rule in select * from public.distribution_rules d where d.organization_id = l.organization_id and d.enabled order by d.priority, d.created_at loop
      if coalesce(private.lead_cond(rule.operator, coalesce(p_answers, '{}'::jsonb) -> rule.field_key, rule.condition_json), false) and private.lead_eligible(l.organization_id, rule.assign_to) then
        target := rule.assign_to; method := 'criteria'; exit;
      end if;
    end loop;
  end if;

  if target is null and (st.assignment_strategy = 'round_robin' or (st.assignment_strategy = 'criteria' and st.criteria_fallback_round_robin)) then
    select coalesce(array_agg(s.user_id order by s.user_id), '{}') into pool
      from public.lead_sellers s where s.organization_id = l.organization_id and s.active and private.lead_eligible(l.organization_id, s.user_id);
    if cardinality(pool) > 0 then
      select u into nxt from unnest(pool) u where st.rr_last_user is null or u > st.rr_last_user order by u limit 1;
      target := coalesce(nxt, pool[1]); method := 'round_robin';
      update public.lead_settings set rr_last_user = target where organization_id = l.organization_id;
    end if;
  end if;

  if target is null then return null; end if;   -- fila sem responsável
  update public.leads set assigned_to = target where id = l.id;
  insert into public.lead_assignments (organization_id, lead_id, assigned_to, assigned_by, assignment_method) values (l.organization_id, l.id, target, null, method);
  return target;
end $$;
revoke all on function private.lead_assign_auto(uuid, jsonb) from public;

create function public.lead_assign(p_lead uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(l.organization_id);
  if p_to is not null and not private.lead_eligible(l.organization_id, p_to) then raise exception 'responsável inválido' using errcode = '22023'; end if;
  if l.assigned_to is not distinct from p_to then return; end if;   -- idempotente
  update public.leads set assigned_to = p_to where id = l.id;
  insert into public.lead_assignments (organization_id, lead_id, assigned_to, assigned_by, assignment_method) values (l.organization_id, l.id, p_to, (select auth.uid()), 'manual');
end $$;

-- Distribui os leads sem responsável conforme a estratégia da organização. Idempotente: quem já tem responsável é ignorado.
create function public.lead_distribute_pending(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; a jsonb;
begin
  perform private.lead_assert_manager(p_org);
  for r in select id from public.leads where organization_id = p_org and assigned_to is null and archived_at is null and status not in ('converted', 'disqualified') order by created_at limit 500 loop
    select s.answers_json into a from public.form_submissions s where s.lead_id = r.id order by s.submitted_at desc limit 1;
    if private.lead_assign_auto(r.id, a) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ======================================================================= score do lead
-- Regras do modelo em JSON. Com o esquema do formulário, regras sobre perguntas que o formulário NÃO tem são ignoradas
-- (não pontuam nem aparecem como dado ausente): um modelo único serve a vários formulários.
create function private.lead_rules_json(p_model uuid, p_schema jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'field_key', r.field_key, 'operator', r.operator, 'condition', r.condition_json, 'points', r.points, 'enabled', r.enabled) order by r.priority, r.created_at), '[]'::jsonb)
  from public.scoring_rules r
  where r.model_id = p_model and (p_schema is null or exists (select 1 from jsonb_array_elements(p_schema -> 'fields') f where f ->> 'key' = r.field_key));
$$;
revoke all on function private.lead_rules_json(uuid, jsonb) from public;
grant execute on function private.lead_rules_json(uuid, jsonb) to authenticated;

create function private.lead_score_lead(p_lead uuid, p_submission uuid, p_answers jsonb, p_hidden text[], p_schema jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype; m public.scoring_models%rowtype; rules jsonb; res jsonb;
begin
  select * into l from public.leads where id = p_lead;
  select * into m from public.scoring_models where organization_id = l.organization_id and status = 'published';
  if not found then return null; end if;
  rules := private.lead_rules_json(m.id, p_schema);
  res := public.lead_score_compute(rules, p_answers, m.thresholds_json, p_hidden);
  insert into public.lead_score_events (organization_id, lead_id, scoring_model_id, submission_id, score, classification, qualified, explanation_json)
  values (l.organization_id, l.id, m.id, p_submission, (res ->> 'score')::int, res ->> 'classification', (res ->> 'qualified')::boolean,
          res || jsonb_build_object('model_version', m.version, 'model_name', m.name));
  update public.leads set current_score = (res ->> 'score')::int, qualification = res ->> 'classification', qualified = (res ->> 'qualified')::boolean where id = l.id;
  return res;
end $$;
revoke all on function private.lead_score_lead(uuid, uuid, jsonb, text[], jsonb) from public;

-- Recalcula com o modelo vigente (ACRESCENTA um evento; o histórico fica).
create function public.lead_rescore(p_lead uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype; s public.form_submissions%rowtype; v public.lead_form_versions%rowtype; chk jsonb;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(l.organization_id);
  select * into s from public.form_submissions where lead_id = p_lead order by submitted_at desc limit 1;
  if not found then raise exception 'o lead não tem respostas de formulário' using errcode = '23514'; end if;
  select * into v from public.lead_form_versions where id = s.form_version_id;
  chk := public.lead_validate_answers(v.schema_json, v.conditional_logic_json, s.answers_json);
  return private.lead_score_lead(l.id, s.id, s.answers_json, array(select jsonb_array_elements_text(chk -> 'hidden')), v.schema_json);
end $$;

create function public.lead_rescore_all(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  perform private.lead_assert_manager(p_org);
  for r in select distinct on (s.lead_id) s.lead_id from public.form_submissions s join public.leads l on l.id = s.lead_id
           where l.organization_id = p_org and l.archived_at is null and l.anonymized_at is null order by s.lead_id limit 2000 loop
    perform public.lead_rescore(r.lead_id); n := n + 1;
  end loop;
  return n;
end $$;

-- ======================================================================= modelos de score
create function public.lead_model_draft(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d uuid; pub public.scoring_models%rowtype; v integer; nid uuid;
begin
  perform private.lead_assert_manager(p_org);
  select id into d from public.scoring_models where organization_id = p_org and status = 'draft';
  if d is not null then return d; end if;
  select * into pub from public.scoring_models where organization_id = p_org and status = 'published';
  select coalesce(max(version), 0) + 1 into v from public.scoring_models where organization_id = p_org;
  insert into public.scoring_models (organization_id, name, version, status, thresholds_json, score_config_json)
  values (p_org, coalesce(pub.name, 'Modelo de qualificação'), v, 'draft', coalesce(pub.thresholds_json, '{"warm_min":40,"hot_min":70,"qualified_min":70}'::jsonb), coalesce(pub.score_config_json, '{}'::jsonb))
  returning id into nid;
  if pub.id is not null then
    insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, condition_json, points, priority, enabled)
    select organization_id, nid, label, field_key, operator, condition_json, points, priority, enabled from public.scoring_rules where model_id = pub.id;
  end if;
  return nid;
end $$;

create function public.lead_model_publish(p_model uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.scoring_models%rowtype; warm int; hot int; qmin int; bad text;
begin
  select * into m from public.scoring_models where id = p_model for update;
  if not found then raise exception 'modelo não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(m.organization_id);
  if m.status <> 'draft' then raise exception 'só rascunho pode ser publicado' using errcode = '23514'; end if;
  begin
    warm := (m.thresholds_json ->> 'warm_min')::int; hot := (m.thresholds_json ->> 'hot_min')::int; qmin := (m.thresholds_json ->> 'qualified_min')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Faixas inválidas.'));
  end;
  if not (warm > 0 and warm < hot and hot <= 100 and qmin between 0 and 100) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Faixas inválidas: use 0 < morno < quente ≤ 100 e qualificação entre 0 e 100.'));
  end if;
  select string_agg(distinct r.label, ', ') into bad from public.scoring_rules r
   where r.model_id = m.id and r.enabled and (
     (r.operator in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains') and (r.condition_json is null or jsonb_typeof(r.condition_json) = 'null')) or
     (r.operator in ('in', 'not_in') and jsonb_typeof(r.condition_json) <> 'array') or
     (r.operator = 'between' and (jsonb_typeof(r.condition_json) <> 'object' or not (r.condition_json ? 'min' and r.condition_json ? 'max'))));
  if bad is not null then return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Regras com valor inválido: ' || bad)); end if;
  update public.scoring_models set status = 'archived' where organization_id = m.organization_id and status = 'published';
  update public.scoring_models set status = 'published', published_at = now() where id = m.id;
  return jsonb_build_object('ok', true, 'version', m.version);
end $$;

-- Simula um lead antes de ativar as regras (usa as regras do modelo informado; com p_form, só as que valem para as perguntas do formulário).
create function public.lead_simulate(p_model uuid, p_answers jsonb, p_form uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.scoring_models%rowtype; sch jsonb;
begin
  select * into m from public.scoring_models where id = p_model;
  if not found then raise exception 'modelo não encontrado' using errcode = 'P0002'; end if;
  if p_form is not null then
    select v.schema_json into sch from public.lead_form_versions v where v.form_id = p_form order by v.version_number desc limit 1;
  end if;
  return public.lead_score_compute(private.lead_rules_json(m.id, sch), p_answers, m.thresholds_json);
end $$;

-- ======================================================================= formulários (construtor, versões, publicação)
create function private.lead_default_schema() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"steps":[],"fields":[{"key":"nome","type":"text","label":"Seu nome","required":true,"lead_field":"name"},{"key":"email","type":"email","label":"Seu e-mail","required":true,"lead_field":"email"},{"key":"telefone","type":"phone","label":"Telefone (opcional)","required":false,"lead_field":"phone"}]}'::jsonb;
$$;

create function public.lead_form_create(p_org uuid, p_name text, p_slug text, p_schema jsonb default null, p_logic jsonb default null, p_consent jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare fid uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.lead_assert_manager(p_org);
  if char_length(v_name) not between 2 and 120 then raise exception 'o nome deve ter de 2 a 120 caracteres' using errcode = '22023'; end if;
  insert into public.lead_forms (organization_id, name, slug) values (p_org, v_name, lower(btrim(coalesce(p_slug, '')))) returning id into fid;
  insert into public.lead_form_versions (organization_id, form_id, version_number, schema_json, conditional_logic_json, consent_config_json)
  values (p_org, fid, 1, coalesce(p_schema, private.lead_default_schema()), coalesce(p_logic, '[]'::jsonb),
          coalesce(p_consent, '{"required":true,"text":"Concordo com o tratamento dos meus dados para contato comercial."}'::jsonb));
  return fid;
end $$;

-- Salva o RASCUNHO. Se só existe versão publicada, cria um novo rascunho a partir dela. Devolve os problemas encontrados (informativos).
create function public.lead_form_save_draft(p_form uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.lead_forms%rowtype; d public.lead_form_versions%rowtype; last public.lead_form_versions%rowtype; sch jsonb; lg jsonb; cs jsonb; ui jsonb;
begin
  select * into f from public.lead_forms where id = p_form for update;
  if not found then raise exception 'formulário não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(f.organization_id);
  if f.status = 'archived' then raise exception 'formulário arquivado' using errcode = '23514'; end if;
  select * into d from public.lead_form_versions where form_id = f.id and published_at is null for update;
  if not found then
    select * into last from public.lead_form_versions where form_id = f.id order by version_number desc limit 1;
    insert into public.lead_form_versions (organization_id, form_id, version_number, schema_json, ui_schema_json, conditional_logic_json, consent_config_json)
    values (f.organization_id, f.id, last.version_number + 1, last.schema_json, last.ui_schema_json, last.conditional_logic_json, last.consent_config_json) returning * into d;
  end if;
  sch := coalesce(p_payload -> 'schema', d.schema_json); lg := coalesce(p_payload -> 'logic', d.conditional_logic_json);
  cs := coalesce(p_payload -> 'consent', d.consent_config_json); ui := coalesce(p_payload -> 'ui', d.ui_schema_json);
  if jsonb_typeof(sch) <> 'object' or jsonb_typeof(lg) <> 'array' or jsonb_typeof(cs) <> 'object' or jsonb_typeof(ui) <> 'object' then raise exception 'conteúdo inválido' using errcode = '22023'; end if;
  update public.lead_form_versions set schema_json = sch, conditional_logic_json = lg, consent_config_json = cs, ui_schema_json = ui where id = d.id;
  update public.lead_forms set
    name = coalesce(nullif(btrim(p_payload ->> 'name'), ''), name),
    description = case when p_payload ? 'description' then nullif(btrim(p_payload ->> 'description'), '') else description end,
    thank_you_message = coalesce(nullif(btrim(p_payload ->> 'thank_you_message'), ''), thank_you_message),
    success_redirect_url = case when p_payload ? 'success_redirect_url' then nullif(btrim(p_payload ->> 'success_redirect_url'), '') else success_redirect_url end
  where id = f.id;
  return public.lead_validate_form_def(sch, lg, cs);
end $$;

create function public.lead_form_publish(p_form uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.lead_forms%rowtype; d public.lead_form_versions%rowtype; errs jsonb;
begin
  select * into f from public.lead_forms where id = p_form for update;
  if not found then raise exception 'formulário não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(f.organization_id);
  if f.status = 'archived' then raise exception 'formulário arquivado' using errcode = '23514'; end if;
  select * into d from public.lead_form_versions where form_id = f.id and published_at is null for update;
  if not found then raise exception 'não há alterações para publicar' using errcode = '23514'; end if;
  errs := public.lead_validate_form_def(d.schema_json, d.conditional_logic_json, d.consent_config_json);
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;
  update public.lead_form_versions set published_at = now() where id = d.id;
  update public.lead_forms set status = 'published', current_published_version_id = d.id where id = f.id;
  return jsonb_build_object('ok', true, 'version', d.version_number);
end $$;

create function public.lead_form_archive(p_form uuid, p_archive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.lead_forms%rowtype;
begin
  select * into f from public.lead_forms where id = p_form for update;
  if not found then raise exception 'formulário não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(f.organization_id);
  update public.lead_forms set status = case when p_archive then 'archived'::public.lead_form_status
    when f.current_published_version_id is not null then 'published'::public.lead_form_status else 'draft'::public.lead_form_status end where id = f.id;
end $$;

create function public.lead_form_duplicate(p_form uuid, p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.lead_forms%rowtype; v public.lead_form_versions%rowtype; nid uuid;
begin
  select * into f from public.lead_forms where id = p_form;
  if not found then raise exception 'formulário não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_manager(f.organization_id);
  select * into v from public.lead_form_versions where form_id = f.id order by version_number desc limit 1;
  nid := public.lead_form_create(f.organization_id, p_name, p_slug, v.schema_json, v.conditional_logic_json, v.consent_config_json);
  update public.lead_forms set description = f.description, thank_you_message = f.thank_you_message, success_redirect_url = f.success_redirect_url where id = nid;
  return nid;
end $$;

-- ======================================================================= captação pública
create function public.lead_public_form(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.lead_forms%rowtype; v public.lead_form_versions%rowtype; brand record; st public.lead_settings%rowtype;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 60 then return jsonb_build_object('state', 'unavailable'); end if;
  select * into f from public.lead_forms where slug = p_slug and status = 'published';
  if not found then return jsonb_build_object('state', 'unavailable'); end if;
  select * into v from public.lead_form_versions where id = f.current_published_version_id;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;
  select coalesce(s.display_name, o.name) as name, s.theme into brand from public.organizations o left join public.organization_settings s on s.organization_id = o.id where o.id = f.organization_id;
  select * into st from public.lead_settings where organization_id = f.organization_id;
  return jsonb_build_object('state', 'open', 'name', f.name, 'description', f.description, 'schema', v.schema_json, 'logic', v.conditional_logic_json,
    'consent', v.consent_config_json, 'thank_you', f.thank_you_message, 'redirect', f.success_redirect_url, 'privacy_url', st.privacy_policy_url,
    'company', brand.name, 'primary', brand.theme ->> 'primary', 'version', v.version_number);
end $$;

create function public.lead_public_submit(p_slug text, p_answers jsonb, p_meta jsonb, p_consent boolean, p_submission_key uuid, p_client_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.lead_forms%rowtype; v public.lead_form_versions%rowtype; st public.lead_settings%rowtype; chk jsonb; clean jsonb; hidden text[];
  lf record; v_name text; v_email text; v_phone text; v_company text; v_segment text; existing public.leads%rowtype; lid uuid; sid uuid; dup boolean := false; is_new boolean := true;
  m jsonb := coalesce(p_meta, '{}'::jsonb); u_source text; u_medium text; u_campaign text; u_content text; u_term text; landing text; cid uuid; ckey text; v_source text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 60 then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  -- limite de taxa (compartilhado): por visitante e por formulário
  if p_client_key is null or char_length(p_client_key) not between 8 and 128 then p_client_key := 'anon'; end if;
  if not private.lead_rate_hit('v:' || p_slug || ':' || p_client_key, interval '10 minutes', 15)
     or not private.lead_rate_hit('f:' || p_slug, interval '1 hour', 600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into f from public.lead_forms where slug = p_slug and status = 'published';
  if not found then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  select * into v from public.lead_form_versions where id = f.current_published_version_id;
  select * into st from public.lead_settings where organization_id = f.organization_id;

  -- reenvio com a mesma chave: não duplica nada
  if p_submission_key is not null and exists (select 1 from public.form_submissions s where s.form_id = f.id and s.submission_key = p_submission_key) then
    return jsonb_build_object('ok', true, 'repeated', true);
  end if;

  chk := public.lead_validate_answers(v.schema_json, v.conditional_logic_json, p_answers);
  if chk -> 'errors' <> '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', chk -> 'errors'); end if;
  if coalesce((v.consent_config_json ->> 'required')::boolean, true) and not coalesce(p_consent, false) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_object('_consent', 'É necessário concordar para enviar.'));
  end if;
  clean := chk -> 'clean';
  hidden := array(select jsonb_array_elements_text(chk -> 'hidden'));

  -- campos vinculados ao lead
  for lf in select x ->> 'key' as k, x ->> 'lead_field' as lead_field from jsonb_array_elements(v.schema_json -> 'fields') x where x ->> 'lead_field' is not null loop
    if clean ? lf.k then
      case lf.lead_field
        when 'name' then v_name := left(clean ->> lf.k, 160);
        when 'email' then v_email := private.lead_norm_email(clean ->> lf.k);
        when 'phone' then v_phone := private.lead_norm_phone(clean ->> lf.k);
        when 'company_name' then v_company := left(clean ->> lf.k, 160);
        when 'segment' then v_segment := left(clean ->> lf.k, 120);
        else null;
      end case;
    end if;
  end loop;
  if v_email is null and v_phone is null then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_object('_contact', 'Informe e-mail ou telefone.')); end if;

  -- metadados (UTM) saneados
  u_source := nullif(left(btrim(m ->> 'utm_source'), 120), ''); u_medium := nullif(left(btrim(m ->> 'utm_medium'), 120), '');
  u_campaign := nullif(left(btrim(m ->> 'utm_campaign'), 120), ''); u_content := nullif(left(btrim(m ->> 'utm_content'), 120), ''); u_term := nullif(left(btrim(m ->> 'utm_term'), 120), '');
  landing := case when (m ->> 'landing_page') ~ '^https?://[^\s]+$' then left(m ->> 'landing_page', 300) end;
  v_source := coalesce(lower(u_source), 'direto');

  perform pg_advisory_xact_lock(hashtextextended('lead_dedupe:' || f.organization_id::text || ':' || coalesce(v_email, v_phone), 0));
  if u_campaign is not null then
    ckey := left(regexp_replace(lower(btrim(u_campaign)), '[^a-z0-9_.-]+', '-', 'g'), 80);
    ckey := regexp_replace(ckey, '^[^a-z0-9]+', '');
    if ckey <> '' then
      insert into public.campaigns (organization_id, name, source, medium, campaign_key) values (f.organization_id, left(u_campaign, 120), u_source, u_medium, ckey)
      on conflict (organization_id, campaign_key) do nothing;
      select id into cid from public.campaigns where organization_id = f.organization_id and campaign_key = ckey;
    end if;
  end if;

  select * into existing from public.leads l where l.organization_id = f.organization_id and l.archived_at is null and l.anonymized_at is null
    and ((v_email is not null and l.email = v_email) or (v_phone is not null and l.phone = v_phone)) order by l.created_at limit 1;
  if found then
    dup := true;
    if st.duplicate_policy = 'link' then
      lid := existing.id; is_new := false;
      -- completa dados que faltavam (nunca sobrescreve)
      update public.leads set name = case when name = 'Sem nome' and v_name is not null then v_name else name end, email = coalesce(email, v_email), phone = coalesce(phone, v_phone),
        company_name = coalesce(company_name, v_company), segment = coalesce(segment, v_segment) where id = existing.id;
    end if;
  end if;
  if is_new then
    insert into public.leads (organization_id, name, email, phone, company_name, segment, source, medium, campaign_id, first_form_id, duplicate_of, needs_review)
    values (f.organization_id, coalesce(v_name, 'Sem nome'), v_email, v_phone, v_company, v_segment, v_source, u_medium, cid, f.id, case when dup then existing.id end, dup and st.duplicate_policy = 'review')
    returning id into lid;
    perform private.lead_log_status(f.organization_id, lid, null, 'new', null);
  end if;

  insert into public.form_submissions (organization_id, form_id, form_version_id, lead_id, answers_json, consent_given, submission_key, is_duplicate, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
  values (f.organization_id, f.id, v.id, lid, clean, coalesce(p_consent, false), p_submission_key, dup, v_source, u_source, u_medium, u_campaign, u_content, u_term, landing)
  returning id into sid;

  perform private.lead_score_lead(lid, sid, clean, hidden, v.schema_json);
  perform private.lead_assign_auto(lid, clean);
  return jsonb_build_object('ok', true);
end $$;

-- ======================================================================= leads (criação manual, importação, status, anonimização)
create function private.lead_find_dup(p_org uuid, p_email text, p_phone text) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.leads l where l.organization_id = p_org and l.archived_at is null and l.anonymized_at is null
    and ((p_email is not null and l.email = p_email) or (p_phone is not null and l.phone = p_phone)) order by l.created_at limit 1;
$$;
revoke all on function private.lead_find_dup(uuid, text, text) from public;

create function public.lead_create(p_org uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare role public.org_role := private.lead_role(p_org); v_email text; v_phone text; d uuid; lid uuid; v_name text;
begin
  if role is null or role = 'viewer' then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  v_email := private.lead_norm_email(p_payload ->> 'email'); v_phone := private.lead_norm_phone(p_payload ->> 'phone');
  v_name := nullif(btrim(p_payload ->> 'name'), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido' using errcode = '22023'; end if;
  if v_email is null and v_phone is null then raise exception 'informe e-mail ou telefone válidos' using errcode = '22023'; end if;
  d := private.lead_find_dup(p_org, v_email, v_phone);
  if d is not null then return jsonb_build_object('ok', false, 'error', 'duplicate', 'lead_id', d); end if;
  insert into public.leads (organization_id, name, email, phone, company_name, segment, source, notes)
  values (p_org, coalesce(left(v_name, 160), 'Sem nome'), v_email, v_phone, nullif(left(btrim(p_payload ->> 'company_name'), 160), ''), nullif(left(btrim(p_payload ->> 'segment'), 120), ''),
          coalesce(nullif(left(lower(btrim(p_payload ->> 'source')), 80), ''), 'manual'), nullif(left(btrim(p_payload ->> 'notes'), 4000), '')) returning id into lid;
  perform private.lead_log_status(p_org, lid, null, 'new', null);
  if role = 'member' then
    update public.leads set assigned_to = (select auth.uid()) where id = lid;
    insert into public.lead_assignments (organization_id, lead_id, assigned_to, assigned_by, assignment_method) values (p_org, lid, (select auth.uid()), (select auth.uid()), 'system');
  else
    perform private.lead_assign_auto(lid, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'lead_id', lid);
end $$;

-- Importação em lote (apenas validar ou gravar). Linhas: {name,email,phone,company_name,segment,source}.
create function public.lead_import(p_org uuid, p_rows jsonb, p_apply boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; i int := 0; created int := 0; dups int := 0; bad int := 0; lines jsonb := '[]'::jsonb; v_email text; v_phone text; lid uuid; seen_e text[] := '{}'; seen_p text[] := '{}'; v_name text;
begin
  perform private.lead_assert_manager(p_org);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'envie até 2.000 linhas' using errcode = '22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_email := private.lead_norm_email(r ->> 'email'); v_phone := private.lead_norm_phone(r ->> 'phone'); v_name := nullif(btrim(r ->> 'name'), '');
    if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254) then bad := bad + 1; if jsonb_array_length(lines) < 50 then lines := lines || to_jsonb(format('Linha %s: e-mail inválido.', i + 1)); end if; continue; end if;
    if v_email is null and v_phone is null then bad := bad + 1; if jsonb_array_length(lines) < 50 then lines := lines || to_jsonb(format('Linha %s: informe e-mail ou telefone válidos.', i + 1)); end if; continue; end if;
    if (v_email is not null and v_email = any(seen_e)) or (v_phone is not null and v_phone = any(seen_p)) or private.lead_find_dup(p_org, v_email, v_phone) is not null then
      dups := dups + 1; if jsonb_array_length(lines) < 50 then lines := lines || to_jsonb(format('Linha %s: contato já existe.', i + 1)); end if; continue;
    end if;
    if v_email is not null then seen_e := seen_e || v_email; end if; if v_phone is not null then seen_p := seen_p || v_phone; end if;
    if p_apply then
      insert into public.leads (organization_id, name, email, phone, company_name, segment, source)
      values (p_org, coalesce(left(v_name, 160), 'Sem nome'), v_email, v_phone, nullif(left(btrim(r ->> 'company_name'), 160), ''), nullif(left(btrim(r ->> 'segment'), 120), ''), coalesce(nullif(left(lower(btrim(r ->> 'source')), 80), ''), 'importação'))
      returning id into lid;
      perform private.lead_log_status(p_org, lid, null, 'new', null);
      perform private.lead_assign_auto(lid, '{}'::jsonb);
    end if;
    created := created + 1;
  end loop;
  return jsonb_build_object('total', i, 'created', created, 'duplicates', dups, 'invalid', bad, 'lines', lines, 'applied', p_apply);
end $$;

create function public.lead_change_status(p_lead uuid, p_status public.lead_status, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype; r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if not private.lead_can_write(l.organization_id, l.assigned_to) or not private.mfa_ok() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.archived_at is not null then raise exception 'lead arquivado' using errcode = '23514'; end if;
  if l.status = p_status then return; end if;   -- idempotente
  if p_status = 'disqualified' and r is null then raise exception 'informe o motivo da desqualificação' using errcode = '23514'; end if;
  update public.leads set status = p_status,
    disqualify_reason = case when p_status = 'disqualified' then left(r, 200) when l.status = 'disqualified' then null else disqualify_reason end,
    converted_at = case when p_status = 'converted' then now() else converted_at end where id = l.id;
  perform private.lead_log_status(l.organization_id, l.id, l.status, p_status, left(r, 200));
end $$;

-- LGPD: anonimiza o lead (mantém números agregados; remove dados pessoais e respostas).
create function private.lead_anonymize_one(p_lead uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.leads set anonymized_at = now(), name = 'Anonimizado', email = null, phone = null, company_name = null, segment = null, notes = null, custom = '{}'::jsonb where id = p_lead;
  update public.form_submissions set answers_json = '{}'::jsonb, landing_page = null where lead_id = p_lead;
  delete from public.ai_analyses where lead_id = p_lead;
  update public.lead_activities set description = null where lead_id = p_lead;
end $$;
revoke all on function private.lead_anonymize_one(uuid) from public;

create function public.lead_anonymize(p_lead uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  perform private.lead_assert_admin(l.organization_id);
  perform private.lead_anonymize_one(l.id);
end $$;

-- Retenção: anonimiza leads antigos que NÃO foram convertidos. Executada por um administrador (ou agendada pelo implantador).
create function public.lead_apply_retention(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare days integer; r record; n integer := 0;
begin
  perform private.lead_assert_admin(p_org);
  select retention_days into days from public.lead_settings where organization_id = p_org;
  if days is null then return 0; end if;
  for r in select id from public.leads where organization_id = p_org and anonymized_at is null and status <> 'converted' and created_at < now() - make_interval(days => days) limit 1000 loop
    perform private.lead_anonymize_one(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ======================================================================= IA opcional (análise textual separada do score)
-- A análise NUNCA altera o score. Gravação e limite diário passam por estas funções (a tabela não aceita escrita direta).
create function public.lead_ai_usage(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.ai_analyses a where a.organization_id = p_org and private.is_member(p_org) and a.created_at >= now() - interval '24 hours';
$$;

create function public.lead_ai_save(p_lead uuid, p_provider text, p_model text, p_analysis jsonb, p_status text, p_error text, p_tokens_in integer, p_tokens_out integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype; cfg public.integration_configs%rowtype; lim integer; used integer; nid uuid;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if not private.lead_can_write(l.organization_id, l.assigned_to) or not private.mfa_ok() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if l.anonymized_at is not null then raise exception 'lead anonimizado' using errcode = '23514'; end if;
  select * into cfg from public.integration_configs where organization_id = l.organization_id and provider = 'ai';
  if not found or not cfg.enabled then raise exception 'a análise por IA não está habilitada' using errcode = '23514'; end if;
  lim := case when (cfg.config_json ->> 'daily_limit') ~ '^\d{1,3}$' then (cfg.config_json ->> 'daily_limit')::int else 20 end;
  perform pg_advisory_xact_lock(hashtextextended('lead_ai:' || l.organization_id::text, 0));
  select count(*) into used from public.ai_analyses where organization_id = l.organization_id and created_at >= now() - interval '24 hours';
  if used >= lim then raise exception 'limite diário de análises atingido' using errcode = '23514'; end if;
  if p_status not in ('ok', 'failed') then raise exception 'status inválido' using errcode = '22023'; end if;
  insert into public.ai_analyses (organization_id, lead_id, provider, model, analysis_json, status, error_message, tokens_in, tokens_out)
  values (l.organization_id, l.id, left(p_provider, 40), left(p_model, 80), coalesce(p_analysis, '{}'::jsonb), p_status, left(p_error, 300), p_tokens_in, p_tokens_out) returning id into nid;
  return nid;
end $$;

-- Existe outro lead com este contato? Só devolve verdadeiro/falso (vendedor também precisa saber, mesmo sem ver o lead do colega).
create function public.lead_find_duplicate(p_org uuid, p_email text, p_phone text, p_except uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.organization_id = p_org and private.is_member(p_org) and l.archived_at is null and l.anonymized_at is null and l.id is distinct from p_except
      and ((private.lead_norm_email(p_email) is not null and l.email = private.lead_norm_email(p_email)) or (private.lead_norm_phone(p_phone) is not null and l.phone = private.lead_norm_phone(p_phone))));
$$;

-- ======================================================================= privilégios de execução
do $$
declare f text;
begin
  foreach f in array array[
    'public.lead_validate_form_def(jsonb, jsonb, jsonb)', 'public.lead_validate_answers(jsonb, jsonb, jsonb)', 'public.lead_score_compute(jsonb, jsonb, jsonb, text[])',
    'public.lead_assign(uuid, uuid)', 'public.lead_distribute_pending(uuid)', 'public.lead_rescore(uuid)', 'public.lead_rescore_all(uuid)',
    'public.lead_model_draft(uuid)', 'public.lead_model_publish(uuid)', 'public.lead_simulate(uuid, jsonb, uuid)',
    'public.lead_form_create(uuid, text, text, jsonb, jsonb, jsonb)', 'public.lead_form_save_draft(uuid, jsonb)', 'public.lead_form_publish(uuid)',
    'public.lead_form_archive(uuid, boolean)', 'public.lead_form_duplicate(uuid, text, text)',
    'public.lead_create(uuid, jsonb)', 'public.lead_import(uuid, jsonb, boolean)', 'public.lead_change_status(uuid, public.lead_status, text)',
    'public.lead_anonymize(uuid)', 'public.lead_apply_retention(uuid)',
    'public.lead_find_duplicate(uuid, text, text, uuid)', 'public.lead_ai_usage(uuid)', 'public.lead_ai_save(uuid, text, text, jsonb, text, text, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.lead_public_form(text)', 'public.lead_public_submit(text, jsonb, jsonb, boolean, uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
comment on function public.lead_public_form(text) is 'PUBLIC_ENDPOINT: definição do formulário publicado para a página pública /f/[slug]. Resposta uniforme (unavailable). Ver docs/DATABASE.md.';
comment on function public.lead_public_submit(text, jsonb, jsonb, boolean, uuid, text) is 'PUBLIC_ENDPOINT: captação pública. Valida contra a versão publicada, limita taxa (tabela compartilhada), deduplica, pontua e atribui numa transação; não devolve dados de leads. Ver docs/DATABASE.md.';

commit;
