-- Qualificador de Leads Inteligente — INDICADORES (parte 3). Fonte única dos números do painel e dos relatórios.
-- Definições, datas e exclusões: docs/METRICS.md. Funções security INVOKER: o RLS já limita o que cada papel enxerga
-- (vendedor só os leads atribuídos a ele). p_org restringe à organização ativa. Leads arquivados ficam de fora.
-- Período = leads CRIADOS no intervalo (coorte), no fuso da organização (lead_settings.timezone).

begin;

create function private.lead_window(p_org uuid, p_from date, p_to date)
returns table (t0 timestamptz, t1 timestamptz, tz text)
language plpgsql stable security invoker set search_path = '' as $$
declare v_tz text;
begin
  if p_org is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 730 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  select s.timezone into v_tz from public.lead_settings s where s.organization_id = p_org;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then v_tz := 'America/Sao_Paulo'; end if;
  return query select (p_from::timestamp at time zone v_tz), ((p_to + 1)::timestamp at time zone v_tz), v_tz;
end $$;

-- Leads dentro dos filtros globais. p_t0/p_t1 nulos = sem limite de data.
create function private.lead_scope(p_org uuid, p_t0 timestamptz, p_t1 timestamptz, p_seller uuid, p_campaign uuid, p_source text, p_form uuid, p_class text)
returns setof public.leads
language sql stable security invoker set search_path = '' as $$
  select l.* from public.leads l
  where l.organization_id = p_org and l.archived_at is null
    and (p_t0 is null or l.created_at >= p_t0) and (p_t1 is null or l.created_at < p_t1)
    and (p_seller is null or l.assigned_to = p_seller)
    and (p_campaign is null or l.campaign_id = p_campaign)
    and (p_source is null or coalesce(l.source, 'direto') = p_source)
    and (p_form is null or l.first_form_id = p_form)
    and (p_class is null or l.qualification = p_class);
$$;

do $$
declare f text;
begin
  foreach f in array array['private.lead_window(uuid, date, date)',
    'private.lead_scope(uuid, timestamptz, timestamptz, uuid, uuid, text, uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= indicadores
create function public.lead_kpis(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                 p_source text default null, p_form uuid default null, p_class text default null)
returns table (captured bigint, qualified bigint, qualification_rate numeric, avg_score numeric, hot bigint, converted bigint, conversion_rate numeric,
               avg_first_contact_minutes numeric, unassigned bigint, overdue_followups bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class)),
  snap as (select * from private.lead_scope(p_org, null, null, p_seller, p_campaign, p_source, p_form, p_class))
  select
    (select count(*) from c),
    (select count(*) from c where c.qualified),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where c.qualified) / count(*), 2) end from c),
    (select round(avg(c.current_score)::numeric, 1) from c where c.current_score is not null),
    (select count(*) from c where c.qualification = 'hot'),
    (select count(*) from c where c.status = 'converted'),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where c.status = 'converted') / count(*), 2) end from c),
    (select round(avg(greatest(0, extract(epoch from (c.first_contact_at - c.created_at)) / 60.0))::numeric, 1) from c where c.first_contact_at is not null),
    (select count(*) from snap where snap.assigned_to is null and snap.status not in ('converted', 'disqualified')),
    (select count(distinct a.lead_id) from public.lead_activities a join snap s on s.id = a.lead_id where a.completed_at is null and a.due_at < now());
end $$;

-- Série temporal: dia (<= 62 dias), semana (<= 210 dias) ou mês. Buckets sem leads aparecem com zero.
create function public.lead_series(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                   p_source text default null, p_form uuid default null, p_class text default null)
returns table (bucket date, granularity text, captured bigint, qualified bigint, converted bigint, qualification_rate numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record; unit text;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  unit := case when p_to - p_from <= 62 then 'day' when p_to - p_from <= 210 then 'week' else 'month' end;
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class)),
  b as (select date_trunc(unit, c.created_at at time zone w.tz)::date as d, count(*) as n, count(*) filter (where c.qualified) as q, count(*) filter (where c.status = 'converted') as v from c group by 1),
  axis as (select generate_series(date_trunc(unit, p_from::timestamp), date_trunc(unit, p_to::timestamp), ('1 ' || unit)::interval)::date as d)
  select axis.d, unit, coalesce(b.n, 0), coalesce(b.q, 0), coalesce(b.v, 0),
         case when coalesce(b.n, 0) = 0 then null else round(100.0 * b.q / b.n, 2) end
  from axis left join b on b.d = axis.d order by axis.d;
end $$;

-- Distribuição do score em faixas de 10 pontos (90 = 90 a 100).
create function public.lead_score_distribution(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                               p_source text default null, p_form uuid default null, p_class text default null)
returns table (bucket_start integer, label text, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class) s where s.current_score is not null),
  b as (select least(c.current_score / 10, 9) * 10 as s, count(*) as n from c group by 1)
  select g.s, case when g.s = 90 then '90–100' else g.s || '–' || (g.s + 9) end, coalesce(b.n, 0)
  from generate_series(0, 90, 10) g(s) left join b on b.s = g.s order by g.s;
end $$;

-- Frio / morno / quente / sem score.
create function public.lead_class_distribution(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                               p_source text default null, p_form uuid default null, p_class text default null)
returns table (classification text, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class))
  select k.k, (select count(*) from c where coalesce(c.qualification, 'unscored') = k.k)
  from (values ('hot', 1), ('warm', 2), ('cold', 3), ('unscored', 4)) k(k, o) order by k.o;
end $$;

create function public.lead_by_source(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                      p_source text default null, p_form uuid default null, p_class text default null)
returns table (source text, captured bigint, qualified bigint, qualification_rate numeric, avg_score numeric, converted bigint, conversion_rate numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class))
  select coalesce(c.source, 'direto'), count(*), count(*) filter (where c.qualified),
         round(100.0 * count(*) filter (where c.qualified) / count(*), 2), round(avg(c.current_score)::numeric, 1),
         count(*) filter (where c.status = 'converted'), round(100.0 * count(*) filter (where c.status = 'converted') / count(*), 2)
  from c group by 1 order by count(*) desc, 1;
end $$;

create function public.lead_by_campaign(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                        p_source text default null, p_form uuid default null, p_class text default null)
returns table (campaign_id uuid, campaign text, captured bigint, qualified bigint, qualification_rate numeric, avg_score numeric, converted bigint, conversion_rate numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class))
  select c.campaign_id, coalesce(max(k.name), 'Sem campanha'), count(*), count(*) filter (where c.qualified),
         round(100.0 * count(*) filter (where c.qualified) / count(*), 2), round(avg(c.current_score)::numeric, 1),
         count(*) filter (where c.status = 'converted'), round(100.0 * count(*) filter (where c.status = 'converted') / count(*), 2)
  from c left join public.campaigns k on k.id = c.campaign_id
  group by c.campaign_id order by count(*) desc, 2;
end $$;

-- Conversão por vendedor (null = sem responsável).
create function public.lead_by_seller(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                      p_source text default null, p_form uuid default null, p_class text default null)
returns table (seller_id uuid, leads bigint, qualified bigint, converted bigint, conversion_rate numeric, avg_score numeric, avg_first_contact_minutes numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class))
  select c.assigned_to, count(*), count(*) filter (where c.qualified), count(*) filter (where c.status = 'converted'),
         round(100.0 * count(*) filter (where c.status = 'converted') / count(*), 2), round(avg(c.current_score)::numeric, 1),
         round((avg(greatest(0, extract(epoch from (c.first_contact_at - c.created_at)) / 60.0)) filter (where c.first_contact_at is not null))::numeric, 1)
  from c group by c.assigned_to order by count(*) desc, 1;
end $$;

-- Funil: etapas cumulativas (cada etapa contém a seguinte). Ver docs/METRICS.md.
create function public.lead_funnel(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                   p_source text default null, p_form uuid default null, p_class text default null)
returns table (stage text, ord integer, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class)),
  h as (
    select c.id,
      bool_or(sh.new_status in ('qualifying', 'qualified', 'contacted', 'converted')) as worked,
      bool_or(sh.new_status in ('contacted', 'converted')) as contacted
    from c left join public.lead_status_history sh on sh.lead_id = c.id group by c.id)
  select 'captured', 1, (select count(*) from c)
  union all select 'worked', 2, (select count(*) from c join h on h.id = c.id where coalesce(h.worked, false) or coalesce(h.contacted, false) or c.first_contact_at is not null or c.status = 'converted')
  union all select 'contacted', 3, (select count(*) from c join h on h.id = c.id where coalesce(h.contacted, false) or c.first_contact_at is not null or c.status = 'converted')
  union all select 'converted', 4, (select count(*) from c where c.status = 'converted')
  order by 2;
end $$;

-- Situação atual no pipeline.
create function public.lead_status_counts(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                          p_source text default null, p_form uuid default null, p_class text default null)
returns table (status public.lead_status, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select * from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class))
  select s.s, (select count(*) from c where c.status = s.s)
  from unnest(enum_range(null::public.lead_status)) s(s);
end $$;

-- Tempo até o primeiro contato (primeira atividade concluída), em faixas.
create function public.lead_first_contact_distribution(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_campaign uuid default null,
                                                       p_source text default null, p_form uuid default null, p_class text default null)
returns table (bucket text, ord integer, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.lead_window(p_org, p_from, p_to);
  return query
  with c as (select c.*, case when c.first_contact_at is null then null else greatest(0, extract(epoch from (c.first_contact_at - c.created_at)) / 60.0) end as mins from private.lead_scope(p_org, w.t0, w.t1, p_seller, p_campaign, p_source, p_form, p_class) c)
  select k.b, k.o, (select count(*) from c where
      case k.o when 1 then c.mins is not null and c.mins <= 15
               when 2 then c.mins > 15 and c.mins <= 60
               when 3 then c.mins > 60 and c.mins <= 240
               when 4 then c.mins > 240 and c.mins <= 1440
               when 5 then c.mins > 1440
               else c.first_contact_at is null end)
  from (values ('≤ 15 min', 1), ('15 min – 1 h', 2), ('1 – 4 h', 3), ('4 – 24 h', 4), ('> 24 h', 5), ('sem contato', 6)) k(b, o) order by k.o;
end $$;

-- Alertas operacionais (foto de agora; respeitam o papel via RLS).
create function public.lead_alerts(p_org uuid)
returns table (key text, leads bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare hrs integer;
begin
  if p_org is null then raise exception 'organização inválida' using errcode = '22023'; end if;
  select s.alert_no_contact_hours into hrs from public.lead_settings s where s.organization_id = p_org;
  hrs := coalesce(hrs, 24);
  return query
  select 'hot_without_contact', (select count(*) from public.leads l where l.organization_id = p_org and l.archived_at is null and l.qualification = 'hot'
      and l.first_contact_at is null and l.status not in ('converted', 'disqualified') and l.created_at < now() - make_interval(hours => hrs))
  union all select 'unassigned', (select count(*) from public.leads l where l.organization_id = p_org and l.archived_at is null and l.assigned_to is null and l.status not in ('converted', 'disqualified'))
  union all select 'overdue_followups', (select count(distinct a.lead_id) from public.lead_activities a join public.leads l on l.id = a.lead_id
      where a.organization_id = p_org and l.archived_at is null and a.completed_at is null and a.due_at < now())
  union all select 'needs_review', (select count(*) from public.leads l where l.organization_id = p_org and l.archived_at is null and l.needs_review);
end $$;

-- Nomes exibidos nos responsáveis e rankings. Expõe só o nome (ou parte local do e-mail) a membros da própria organização.
create function public.lead_user_labels(p_org uuid) returns table (user_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), nullif(split_part(p.email, '@', 1), ''), 'Usuário')
  from public.organization_members m
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and private.is_member(p_org);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.lead_user_labels(uuid)',
    'public.lead_kpis(uuid, date, date, uuid, uuid, text, uuid, text)', 'public.lead_series(uuid, date, date, uuid, uuid, text, uuid, text)',
    'public.lead_score_distribution(uuid, date, date, uuid, uuid, text, uuid, text)', 'public.lead_class_distribution(uuid, date, date, uuid, uuid, text, uuid, text)',
    'public.lead_by_source(uuid, date, date, uuid, uuid, text, uuid, text)', 'public.lead_by_campaign(uuid, date, date, uuid, uuid, text, uuid, text)',
    'public.lead_by_seller(uuid, date, date, uuid, uuid, text, uuid, text)', 'public.lead_funnel(uuid, date, date, uuid, uuid, text, uuid, text)',
    'public.lead_status_counts(uuid, date, date, uuid, uuid, text, uuid, text)', 'public.lead_first_contact_distribution(uuid, date, date, uuid, uuid, text, uuid, text)',
    'public.lead_alerts(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
