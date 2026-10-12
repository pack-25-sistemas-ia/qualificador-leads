-- Indicadores: conjunto de dados pequeno, com TODOS os resultados esperados calculados à mão (ver docs/METRICS.md).
-- Período: 01/03/2025 a 31/03/2025, fuso America/Sao_Paulo (UTC-3). Org A: A (owner), S1/S2 (vendedores), V (leitor). Org B: B.
--
--  lead  criado (UTC-3)      origem     camp  score  qual.  status       resp  1º contato
--  L1    03-01 10:00         google     C1    90     sim    convertido   S1    10 min
--  L2    03-02 12:00         google     C1    75     sim    em contato   S1    50 min
--  L3    03-03 09:00         instagram  C2    50     não    qualificando S2    120 min
--  L4    03-10 08:00         (direto)   —     20     não    desqualif.   S2    —
--  L5    03-10 22:30         instagram  C2    85     sim    novo         —     —
--  L6    03-15 15:00         google     C1    —      —      qualificando S1    —
--  L7    02-28 23:30  (fora: antes)   L8  04-01 00:30  (fora: depois)   L9  arquivado no período (fora)

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@met.invalid'), ('ffffffff-0000-4000-8000-000000000001', 's1@met.invalid'),
  ('ffffffff-0000-4000-8000-000000000002', 's2@met.invalid'), ('ffffffff-0000-4000-8000-00000000000e', 'v@met.invalid'),
  ('ffffffff-0000-4000-8000-00000000000b', 'b@met.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Métricas A', 'metricas-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'), (a, 'ffffffff-0000-4000-8000-000000000002', 'member'),
    (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('Métricas B', 'metricas-b')::text, true); end $$;
reset role;

do $$
declare
  org uuid := current_setting('t.org')::uuid; s1 uuid := 'ffffffff-0000-4000-8000-000000000001'; s2 uuid := 'ffffffff-0000-4000-8000-000000000002';
  c1 uuid := '00000000-0000-4000-8000-0000000000c1'; c2 uuid := '00000000-0000-4000-8000-0000000000c2';
  l1 uuid := '00000000-0000-4000-8000-0000000000a1'; l2 uuid := '00000000-0000-4000-8000-0000000000a2'; l3 uuid := '00000000-0000-4000-8000-0000000000a3';
  l4 uuid := '00000000-0000-4000-8000-0000000000a4'; l5 uuid := '00000000-0000-4000-8000-0000000000a5'; l6 uuid := '00000000-0000-4000-8000-0000000000a6';
begin
  insert into public.campaigns (id, organization_id, name, campaign_key) values (c1, org, 'Campanha 1', 'camp-1'), (c2, org, 'Campanha 2', 'camp-2');
  insert into public.leads (id, organization_id, name, email, source, campaign_id, current_score, qualification, qualified, status, assigned_to, first_contact_at, created_at, converted_at, needs_review) values
    (l1, org, 'L1', 'l1@x.com', 'google',    c1, 90,   'hot',  true,  'converted',  s1, '2025-03-01 10:10:00-03', '2025-03-01 10:00:00-03', '2025-03-04 10:00:00-03', false),
    (l2, org, 'L2', 'l2@x.com', 'google',    c1, 75,   'hot',  true,  'contacted',  s1, '2025-03-02 12:50:00-03', '2025-03-02 12:00:00-03', null, false),
    (l3, org, 'L3', 'l3@x.com', 'instagram', c2, 50,   'warm', false, 'qualifying', s2, '2025-03-03 11:00:00-03', '2025-03-03 09:00:00-03', null, false),
    (l4, org, 'L4', 'l4@x.com', null,        null, 20, 'cold', false, 'disqualified', s2, null, '2025-03-10 08:00:00-03', null, true),
    (l5, org, 'L5', 'l5@x.com', 'instagram', c2, 85,   'hot',  true,  'new',        null, null, '2025-03-10 22:30:00-03', null, false),
    (l6, org, 'L6', 'l6@x.com', 'google',    c1, null, null,   null,  'qualifying', s1, null, '2025-03-15 15:00:00-03', null, false);
  insert into public.leads (organization_id, name, email, source, campaign_id, current_score, qualification, qualified, status, assigned_to, first_contact_at, created_at) values
    (org, 'L7', 'l7@x.com', 'google', c1, 90, 'hot', true, 'converted', s1, '2025-03-01 09:00:00-03', '2025-02-28 23:30:00-03'),
    (org, 'L8', 'l8@x.com', 'google', c1, 10, 'cold', false, 'new', s1, null, '2025-04-01 00:30:00-03');
  insert into public.leads (organization_id, name, email, source, status, created_at, archived_at) values
    (org, 'L9', 'l9@x.com', 'google', 'new', '2025-03-05 10:00:00-03', now());
  insert into public.lead_status_history (organization_id, lead_id, previous_status, new_status) values
    (org, l1, null, 'new'), (org, l1, 'new', 'contacted'), (org, l1, 'contacted', 'converted'),
    (org, l2, null, 'new'), (org, l2, 'new', 'contacted'),
    (org, l3, null, 'new'), (org, l3, 'new', 'qualifying'),
    (org, l4, null, 'new'), (org, l4, 'new', 'disqualified'),
    (org, l5, null, 'new'),
    (org, l6, null, 'new'), (org, l6, 'new', 'qualifying');
  insert into public.lead_activities (organization_id, lead_id, type, description, due_at, completed_at) values
    (org, l3, 'call', 'atrasada', '2025-03-05 10:00:00-03', null),
    (org, l2, 'call', 'futura', '2099-01-01 10:00:00-03', null);
end $$;

-- ================= indicadores principais =================
:as_a
do $$
declare k record; org uuid := current_setting('t.org')::uuid;
begin
  select * into k from public.lead_kpis(org, '2025-03-01', '2025-03-31');
  assert k.captured = 6, 'capturados = 6 (fora do período e arquivado ficam de fora): ' || k.captured;
  assert k.qualified = 3, 'qualificados = 3';
  assert k.qualification_rate = 50.00, 'taxa de qualificação = 50% (3/6; sem score conta no denominador)';
  assert k.avg_score = 64.0, 'score médio = 64.0 (5 leads com score)';
  assert k.hot = 3, 'quentes = 3';
  assert k.converted = 1 and k.conversion_rate = 16.67, 'conversão: 1 de 6 = 16.67%';
  assert k.avg_first_contact_minutes = 60.0, 'tempo médio até o 1º contato = (10+50+120)/3 = 60.0 min';
  assert k.unassigned = 1, 'sem responsável (hoje, sem recorte de data, sem finalizados) = 1 (L5)';
  assert k.overdue_followups = 1, 'follow-ups atrasados = 1 lead (L3)';
  raise notice 'PASS: indicadores principais calculados à mão';
end $$;

-- ================= filtros =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', null, null, 'google')) = 3, 'filtro origem google = 3';
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', null, null, 'direto')) = 1, 'origem direto = leads sem origem';
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', 'ffffffff-0000-4000-8000-000000000002')) = 2, 'filtro vendedor S2 = 2';
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', null, null, null, null, 'hot')) = 3, 'filtro classe quente = 3';
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', null, '00000000-0000-4000-8000-0000000000c2')) = 2, 'filtro campanha 2 = 2';
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31', null, null, null, gen_random_uuid())) = 0, 'formulário sem leads = 0';
  assert (select captured from public.lead_kpis(org, '2025-03-02', '2025-03-02')) = 1, 'período de um dia';
  assert (select count(*) from public.lead_kpis(org, '2025-03-20', '2025-03-21')) = 1 and (select qualification_rate from public.lead_kpis(org, '2025-03-20', '2025-03-21')) is null, 'sem leads: taxa nula (não zero)';
  assert test.throws(format($q$select * from public.lead_kpis(%L, '2025-03-31', '2025-03-01')$q$, org)), 'período invertido é recusado';
  assert test.throws(format($q$select * from public.lead_kpis(%L, '2020-01-01', '2025-03-01')$q$, org)), 'período gigante é recusado';
  raise notice 'PASS: filtros dos indicadores';
end $$;

-- ================= fuso horário (por organização) =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  update public.lead_settings set timezone = 'UTC' where organization_id = org;
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31')) = 7, 'em UTC, L7 (28/02 23:30-03 = 01/03 02:30Z) entra no período';
  update public.lead_settings set timezone = 'Fuso/Inexistente' where organization_id = org;
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31')) = 6, 'fuso inválido volta ao padrão de São Paulo';
  update public.lead_settings set timezone = 'America/Sao_Paulo' where organization_id = org;
  raise notice 'PASS: fuso horário configurável';
end $$;

-- ================= séries e distribuições =================
do $$
declare org uuid := current_setting('t.org')::uuid; r record;
begin
  assert (select count(*) from public.lead_series(org, '2025-03-01', '2025-03-31')) = 31 and (select min(granularity) from public.lead_series(org, '2025-03-01', '2025-03-31')) = 'day', '31 dias com zeros preenchidos';
  select * into r from public.lead_series(org, '2025-03-01', '2025-03-31') where bucket = '2025-03-01';
  assert r.captured = 1 and r.qualified = 1 and r.converted = 1 and r.qualification_rate = 100.00, 'dia 01';
  select * into r from public.lead_series(org, '2025-03-01', '2025-03-31') where bucket = '2025-03-03';
  assert r.captured = 1 and r.qualified = 0 and r.qualification_rate = 0.00, 'dia 03';
  select * into r from public.lead_series(org, '2025-03-01', '2025-03-31') where bucket = '2025-03-10';
  assert r.captured = 2 and r.qualified = 1 and r.qualification_rate = 50.00, 'dia 10 (L5 às 22:30-03 conta em 10/03, não em 11/03)';
  select * into r from public.lead_series(org, '2025-03-01', '2025-03-31') where bucket = '2025-03-11';
  assert r.captured = 0 and r.qualification_rate is null, 'dia sem leads: zero e taxa nula';
  assert (select sum(captured) from public.lead_series(org, '2025-03-01', '2025-03-31')) = 6, 'série soma o total';
  assert (select granularity from public.lead_series(org, '2025-01-01', '2025-04-30') limit 1) = 'week', 'semana até 210 dias';
  assert (select granularity from public.lead_series(org, '2024-01-01', '2025-03-31') limit 1) = 'month', 'mês acima de 210 dias';

  assert (select array_agg(leads order by bucket_start) from public.lead_score_distribution(org, '2025-03-01', '2025-03-31')) = array[0,0,1,0,0,1,0,1,1,1]::bigint[], 'distribuição de score: 20, 50, 75, 85, 90';
  assert (select count(*) from public.lead_score_distribution(org, '2025-03-01', '2025-03-31')) = 10, '10 faixas sempre';
  assert (select array_agg(leads order by classification) from public.lead_class_distribution(org, '2025-03-01', '2025-03-31')) = array[1,3,1,1]::bigint[], 'classes (cold, hot, unscored, warm)';
  raise notice 'PASS: séries e distribuições';
end $$;

-- ================= origem, campanha, vendedor =================
do $$
declare org uuid := current_setting('t.org')::uuid; r record;
begin
  select * into r from public.lead_by_source(org, '2025-03-01', '2025-03-31') where source = 'google';
  assert r.captured = 3 and r.qualified = 2 and r.qualification_rate = 66.67 and r.avg_score = 82.5 and r.converted = 1 and r.conversion_rate = 33.33, 'origem google';
  select * into r from public.lead_by_source(org, '2025-03-01', '2025-03-31') where source = 'instagram';
  assert r.captured = 2 and r.qualified = 1 and r.qualification_rate = 50.00 and r.avg_score = 67.5 and r.converted = 0 and r.conversion_rate = 0.00, 'origem instagram';
  select * into r from public.lead_by_source(org, '2025-03-01', '2025-03-31') where source = 'direto';
  assert r.captured = 1 and r.avg_score = 20.0, 'origem direto';
  assert (select array_agg(source order by captured desc, source) from public.lead_by_source(org, '2025-03-01', '2025-03-31')) = array['google', 'instagram', 'direto'], 'ordenado por volume';

  select * into r from public.lead_by_campaign(org, '2025-03-01', '2025-03-31') where campaign = 'Campanha 1';
  assert r.captured = 3 and r.qualified = 2 and r.converted = 1 and r.avg_score = 82.5, 'campanha 1';
  select * into r from public.lead_by_campaign(org, '2025-03-01', '2025-03-31') where campaign = 'Sem campanha';
  assert r.captured = 1 and r.campaign_id is null, 'leads sem campanha agrupados';

  select * into r from public.lead_by_seller(org, '2025-03-01', '2025-03-31') where seller_id = 'ffffffff-0000-4000-8000-000000000001';
  assert r.leads = 3 and r.qualified = 2 and r.converted = 1 and r.conversion_rate = 33.33 and r.avg_score = 82.5 and r.avg_first_contact_minutes = 30.0, 'vendedor S1';
  select * into r from public.lead_by_seller(org, '2025-03-01', '2025-03-31') where seller_id = 'ffffffff-0000-4000-8000-000000000002';
  assert r.leads = 2 and r.converted = 0 and r.avg_score = 35.0 and r.avg_first_contact_minutes = 120.0, 'vendedor S2';
  select * into r from public.lead_by_seller(org, '2025-03-01', '2025-03-31') where seller_id is null;
  assert r.leads = 1 and r.qualified = 1 and r.avg_first_contact_minutes is null, 'sem responsável';
  raise notice 'PASS: origem, campanha e vendedor';
end $$;

-- ================= funil, status, primeiro contato, alertas =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select array_agg(leads order by ord) from public.lead_funnel(org, '2025-03-01', '2025-03-31')) = array[6, 4, 3, 1]::bigint[], 'funil: 6 capturados, 4 trabalhados, 3 contatados, 1 convertido';
  assert (select array_agg(leads order by status) from public.lead_status_counts(org, '2025-03-01', '2025-03-31')) = array[1,2,0,1,1,1]::bigint[], 'status (new, qualifying, qualified, contacted, converted, disqualified)';
  assert (select array_agg(leads order by ord) from public.lead_first_contact_distribution(org, '2025-03-01', '2025-03-31')) = array[1,1,1,0,0,3]::bigint[], 'faixas de primeiro contato';
  assert (select leads from public.lead_alerts(org) where key = 'hot_without_contact') = 1, 'alerta: quente sem contato';
  assert (select leads from public.lead_alerts(org) where key = 'unassigned') = 1, 'alerta: sem responsável';
  assert (select leads from public.lead_alerts(org) where key = 'overdue_followups') = 1, 'alerta: follow-up atrasado';
  assert (select leads from public.lead_alerts(org) where key = 'needs_review') = 1, 'alerta: revisão de duplicidade';
  raise notice 'PASS: funil, status, primeiro contato e alertas';
end $$;
reset role;

-- ================= papéis =================
:as_s1
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31')) = 3, 'vendedor: indicadores só dos seus leads (L1, L2, L6)';
  assert (select sum(captured) from public.lead_series(org, '2025-03-01', '2025-03-31')) = 3, 'série do vendedor';
  assert (select leads from public.lead_alerts(org) where key = 'unassigned') = 0, 'vendedor não enxerga os sem responsável';
end $$;
reset role;
:as_v
do $$ begin assert (select captured from public.lead_kpis(current_setting('t.org')::uuid, '2025-03-01', '2025-03-31')) = 6, 'leitor vê o total'; end $$;
reset role;
:as_b
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select captured from public.lead_kpis(org, '2025-03-01', '2025-03-31')) = 0, 'outra organização não enxerga nada';
  assert (select coalesce(sum(captured), 0) from public.lead_by_source(org, '2025-03-01', '2025-03-31')) = 0;
  assert (select sum(leads) from public.lead_funnel(org, '2025-03-01', '2025-03-31')) = 0;
  raise notice 'PASS: indicadores respeitam o papel e a organização';
end $$;
reset role;
:as_anon
do $$ begin
  assert test.throws(format($q$select * from public.lead_kpis(%L, '2025-03-01', '2025-03-31')$q$, current_setting('t.org'))), 'anon não executa indicadores';
  assert test.throws(format($q$select * from public.lead_alerts(%L)$q$, current_setting('t.org'))), 'anon não executa alertas';
end $$;
reset role;

rollback;
