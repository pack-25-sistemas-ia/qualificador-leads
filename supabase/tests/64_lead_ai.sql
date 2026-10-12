-- IA opcional: habilitação, limite diário, permissões, isolamento e separação do score.
-- Org A: A (owner), S1/S2 (vendedores), V (leitor). Org B: B.

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_s2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000002","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@ai.invalid'), ('ffffffff-0000-4000-8000-000000000001', 's1@ai.invalid'),
  ('ffffffff-0000-4000-8000-000000000002', 's2@ai.invalid'), ('ffffffff-0000-4000-8000-00000000000e', 'v@ai.invalid'),
  ('ffffffff-0000-4000-8000-00000000000b', 'b@ai.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('IA A', 'ia-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'), (a, 'ffffffff-0000-4000-8000-000000000002', 'member'), (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('IA B', 'ia-b')::text, true); end $$;
reset role;

do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  insert into public.leads (id, organization_id, name, email, current_score, qualification, qualified, assigned_to) values
    ('00000000-0000-4000-8000-0000000000b1', org, 'Do S1', 's1lead@x.com', 55, 'warm', false, 'ffffffff-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-0000000000b2', org, 'Do S2', 's2lead@x.com', 20, 'cold', false, 'ffffffff-0000-4000-8000-000000000002');
end $$;

-- desabilitada por padrão
:as_s1
do $$ begin
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'p', 'm', '{}', 'ok', null, 1, 1)$q$), 'IA desabilitada não grava';
  assert test.throws($q$insert into public.ai_analyses (organization_id, lead_id, provider, model, status) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1', 'p', 'm', 'ok')$q$), 'não há escrita direta na tabela';
end $$;
reset role;

-- somente administração habilita; configuração fica oculta a vendedores
:as_s1
do $$ begin
  assert test.throws(format($q$insert into public.integration_configs (organization_id, provider, enabled) values (%L, 'ai', true)$q$, current_setting('t.org'))), 'vendedor não habilita a IA';
  assert test.count('select 1 from public.integration_configs') = 0, 'vendedor não lê a configuração';
end $$;
reset role;
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  insert into public.integration_configs (organization_id, provider, enabled, config_json, secret_reference) values (org, 'ai', true, '{"daily_limit": 2}', 'AI_API_KEY');
  assert test.throws(format($q$insert into public.integration_configs (organization_id, provider, enabled, secret_reference) values (%L, 'ai', true, 'chave secreta em texto')$q$, org)), 'só nome de variável de ambiente, nunca o segredo';
end $$;
reset role;

:as_s1
do $$
declare id1 uuid;
begin
  id1 := public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'openai-compat', 'modelo-x', '{"summary":"ok"}', 'ok', null, 100, 50);
  assert id1 is not null, 'grava a análise do próprio lead';
  perform public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'openai-compat', 'modelo-x', '{}', 'failed', 'timeout', null, null);
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'p', 'm', '{}', 'ok', null, 1, 1)$q$), 'terceira análise passa do limite diário (2)';
  assert public.lead_ai_usage(current_setting('t.org')::uuid) = 2, 'uso do dia = 2';
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b2', 'p', 'm', '{}', 'ok', null, 1, 1)$q$), 'não analisa lead de outro vendedor';
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'p', 'm', '{}', 'bogus', null, 1, 1)$q$), 'status inválido';
end $$;
reset role;

do $$
begin
  assert (select current_score from public.leads where id = '00000000-0000-4000-8000-0000000000b1') = 55, 'a IA nunca altera o score';
  assert (select qualification from public.leads where id = '00000000-0000-4000-8000-0000000000b1') = 'warm', 'nem a classificação';
  assert (select count(*) from public.lead_score_events where lead_id = '00000000-0000-4000-8000-0000000000b1') = 0, 'nem gera evento de score';
end $$;

:as_s2
do $$ begin assert test.count('select 1 from public.ai_analyses') = 0, 'vendedor 2 não vê análises do vendedor 1'; end $$;
reset role;
:as_v
do $$ begin
  assert test.count('select 1 from public.ai_analyses') = 2, 'leitor vê as análises';
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'p', 'm', '{}', 'ok', null, 1, 1)$q$), 'leitor não grava';
end $$;
reset role;
:as_b
do $$ begin
  assert test.count('select 1 from public.ai_analyses') = 0, 'outra organização não vê';
  assert public.lead_ai_usage(current_setting('t.org')::uuid) = 0, 'nem o consumo da outra organização';
  assert test.throws($q$select public.lead_ai_save('00000000-0000-4000-8000-0000000000b1', 'p', 'm', '{}', 'ok', null, 1, 1)$q$), 'nem grava';
  raise notice 'PASS: IA opcional — habilitação, limite diário, permissões e separação do score';
end $$;
reset role;

-- anonimizar apaga as análises (dado derivado de dados pessoais)
:as_a
do $$ begin
  perform public.lead_anonymize('00000000-0000-4000-8000-0000000000b1');
  assert (select count(*) from public.ai_analyses where lead_id = '00000000-0000-4000-8000-0000000000b1') = 0, 'anonimização apaga as análises de IA';
  raise notice 'PASS: anonimização apaga análises de IA';
end $$;
reset role;

rollback;
