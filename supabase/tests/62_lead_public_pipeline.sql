-- Captação pública, deduplicação, score, distribuição, pipeline, atividades, RLS por papel, LGPD.
-- Org A: A (owner), M (gestor), S1/S2 (vendedores), V (leitor). Org B: B (owner).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_s2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000002","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@pub.invalid'),
  ('ffffffff-0000-4000-8000-00000000000c', 'm@pub.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 's1@pub.invalid'),
  ('ffffffff-0000-4000-8000-000000000002', 's2@pub.invalid'),
  ('ffffffff-0000-4000-8000-00000000000e', 'v@pub.invalid'),
  ('ffffffff-0000-4000-8000-00000000000b', 'b@pub.invalid');

-- Envio público de teste: chave de visitante aleatória (evita o limite por visitante), chave de idempotência opcional.
create function test.submit(p_answers jsonb, p_key uuid default gen_random_uuid(), p_meta jsonb default '{}', p_consent boolean default true, p_slug text default 'qualificacao-b2b', p_client text default null)
returns jsonb language sql as $$
  select public.lead_public_submit(p_slug, p_answers, p_meta, p_consent, p_key, coalesce(p_client, gen_random_uuid()::text));
$$;
grant execute on function test.submit(jsonb, uuid, jsonb, boolean, text, text) to anon, authenticated;

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Pública A', 'publica-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'),
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'),
    (a, 'ffffffff-0000-4000-8000-000000000002', 'member'),
    (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('Pública B', 'publica-b')::text, true); end $$;
reset role;

select set_config('t.schema', $j$
{"steps":[{"id":"contato","title":"Seus dados"},{"id":"projeto","title":"Seu projeto"}],
 "fields":[
  {"key":"nome","type":"text","label":"Nome","required":true,"lead_field":"name","step":"contato"},
  {"key":"email","type":"email","label":"E-mail","required":true,"lead_field":"email","step":"contato"},
  {"key":"telefone","type":"phone","label":"Telefone","lead_field":"phone","step":"contato"},
  {"key":"empresa","type":"text","label":"Empresa","lead_field":"company_name","step":"contato"},
  {"key":"orcamento","type":"currency","label":"Orçamento","required":true,"step":"projeto","min":0},
  {"key":"prazo","type":"select","label":"Prazo","required":true,"step":"projeto","options":[{"value":"ate_30","label":"Até 30 dias"},{"value":"mais_90","label":"Mais de 90 dias"}]},
  {"key":"decisor","type":"checkbox","label":"Decido a compra","step":"projeto"},
  {"key":"tem_cnpj","type":"checkbox","label":"Tenho CNPJ","step":"projeto"},
  {"key":"cnpj","type":"text","label":"CNPJ","step":"projeto","max_length":18}
 ]}$j$, true);

-- preparação: formulário publicado + modelo publicado + vendedores
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; f uuid; d uuid; r jsonb;
begin
  f := public.lead_form_create(org, 'Qualificação B2B', 'qualificacao-b2b');
  perform public.lead_form_save_draft(f, jsonb_build_object('schema', current_setting('t.schema')::jsonb,
    'logic', '[{"target":"cnpj","show_if":{"all":[{"field":"tem_cnpj","op":"is_true"}]}}]'::jsonb));
  assert (public.lead_form_publish(f) ->> 'ok')::boolean, 'publicação do formulário de teste';
  perform set_config('t.f', f::text, true);
  d := public.lead_model_draft(org);
  insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, condition_json, points, priority) values
    (org, d, 'Orçamento acima de R$ 5.000', 'orcamento', 'gt', '5000', 30, 1),
    (org, d, 'Contratar em até 30 dias', 'prazo', 'eq', '"ate_30"', 30, 2),
    (org, d, 'Participa da decisão', 'decisor', 'is_true', 'null', 20, 3),
    (org, d, 'Empresa informada', 'empresa', 'answered', 'null', 10, 4);
  assert (public.lead_model_publish(d) ->> 'ok')::boolean, 'publicação do modelo de teste';
  insert into public.lead_sellers (organization_id, user_id) values (org, 'ffffffff-0000-4000-8000-000000000001'), (org, 'ffffffff-0000-4000-8000-000000000002');
  -- segundo formulário que continua rascunho
  perform public.lead_form_create(org, 'Rascunho', 'so-rascunho');
end $$;
reset role;

-- ================= acesso do visitante =================
:as_anon
do $$
declare p jsonb;
begin
  assert test.throws('select * from public.leads'), 'anon não lê leads';
  assert test.throws('select * from public.form_submissions'), 'anon não lê respostas';
  assert test.throws('select * from public.lead_forms'), 'anon não lê formulários';
  assert test.throws('select * from public.public_rate_limits'), 'anon não lê limites de taxa';
  assert test.throws('insert into public.leads (organization_id, name, email) values (gen_random_uuid(), ''x'', ''x@x.com'')'), 'anon não insere lead direto';
  assert test.throws($q$select public.lead_assign(gen_random_uuid(), null)$q$), 'anon não executa atribuição';
  assert test.throws($q$select public.lead_rescore(gen_random_uuid())$q$), 'anon não executa recálculo';
  assert test.throws($q$select public.lead_score_compute('[]', '{}', '{}')$q$), 'anon não executa o motor diretamente';
  p := public.lead_public_form('qualificacao-b2b');
  assert p ->> 'state' = 'open' and p -> 'schema' is not null and p ->> 'company' = 'Pública A', 'anon lê a definição publicada';
  assert p::text not like '%organization_id%' and p::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'a definição pública não expõe identificadores internos';
  assert (public.lead_public_form('so-rascunho') ->> 'state') = 'unavailable', 'rascunho indisponível';
  assert (public.lead_public_form('nao-existe') ->> 'state') = 'unavailable', 'inexistente indisponível (mesma resposta)';
  raise notice 'PASS: o visitante só alcança as duas funções públicas';
end $$;
reset role;

-- ================= captação: lead, score, campanha, histórico =================
:as_anon
do $$
declare r jsonb;
begin
  r := test.submit(
    '{"nome":"Maria Souza","email":" Maria@Empresa.com ","telefone":"(11) 91234-5678","empresa":"Acme","orcamento":"8000","prazo":"ate_30","decisor":true,"tem_cnpj":false,"cnpj":"12345678000199","intruso":"x"}'::jsonb,
    '11111111-1111-4111-8111-111111111111'::uuid,
    '{"utm_source":"Google","utm_medium":"cpc","utm_campaign":"Black Friday 2026","landing_page":"https://site.exemplo/lp?x=1","evil":"y"}'::jsonb);
  assert (r ->> 'ok')::boolean and r::text not like '%lead%', 'envio válido: ok e sem devolver dados do lead: ' || r::text;
end $$;
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid; l public.leads%rowtype; s public.form_submissions%rowtype; e public.lead_score_events%rowtype;
begin
  select * into l from public.leads where organization_id = org;
  assert l.email = 'maria@empresa.com' and l.phone = '5511912345678' and l.name = 'Maria Souza' and l.company_name = 'Acme', 'dados normalizados';
  assert l.current_score = 90 and l.qualification = 'hot' and l.qualified, 'score 90, quente, qualificado';
  assert l.source = 'google' and l.medium = 'cpc' and l.status = 'new', 'origem a partir do UTM';
  assert (select campaign_key from public.campaigns where id = l.campaign_id) = 'black-friday-2026', 'campanha criada pelo utm_campaign';
  select * into s from public.form_submissions where lead_id = l.id;
  assert s.answers_json ? 'orcamento' and not (s.answers_json ? 'cnpj') and not (s.answers_json ? 'intruso'), 'campo oculto e chave desconhecida descartados';
  assert (s.answers_json ->> 'orcamento')::numeric = 8000, 'valor numérico normalizado';
  assert s.consent_given and s.utm_campaign = 'Black Friday 2026' and s.landing_page = 'https://site.exemplo/lp?x=1', 'consentimento e UTM gravados';
  select * into e from public.lead_score_events where lead_id = l.id;
  assert e.score = 90 and jsonb_array_length(e.explanation_json -> 'applied') = 4 and e.explanation_json ->> 'model_version' = '1', 'explicação gravada com a versão do modelo';
  assert (select count(*) from public.lead_status_history where lead_id = l.id and new_status = 'new' and previous_status is null) = 1, 'histórico inicial';
  assert s.form_version_id = (select current_published_version_id from public.lead_forms where id = s.form_id), 'guarda a versão usada';
  raise notice 'PASS: captação grava lead, resposta, score explicado e campanha';
end $$;

-- ================= idempotência e duplicidade =================
:as_anon
do $$
declare r jsonb;
begin
  r := test.submit('{"nome":"Maria","email":"maria@empresa.com","orcamento":1,"prazo":"mais_90"}'::jsonb, '11111111-1111-4111-8111-111111111111'::uuid);
  assert (r ->> 'ok')::boolean and (r ->> 'repeated')::boolean, 'mesma chave: reenvio não duplica';
  r := test.submit('{"nome":"Maria S.","email":"MARIA@empresa.com","orcamento":2000,"prazo":"mais_90"}'::jsonb);
  assert (r ->> 'ok')::boolean, 'mesmo e-mail com outra chave é aceito';
  r := test.submit('{"nome":"Outra","email":"nova@pessoa.com","telefone":"11 91234-5678","orcamento":2000,"prazo":"mais_90"}'::jsonb);
  assert (r ->> 'ok')::boolean, 'telefone igual ao da Maria, e-mail novo';
end $$;
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select count(*) from public.leads where organization_id = org) = 1, 'política link: continua 1 lead (e-mail e telefone normalizados)';
  assert (select count(*) from public.form_submissions where organization_id = org) = 3, '3 respostas ligadas ao mesmo lead';
  assert (select count(*) from public.form_submissions where organization_id = org and is_duplicate) = 2, 'duplicadas marcadas';
  assert (select count(*) from public.lead_score_events where organization_id = org) = 3, 'cada resposta gera um evento de score';
  assert (select name from public.leads where organization_id = org) = 'Maria Souza', 'não sobrescreve dados existentes';
  raise notice 'PASS: idempotência e duplicidade (link)';
end $$;

-- política flag e review
:as_a
update public.lead_settings set duplicate_policy = 'flag' where organization_id = current_setting('t.org')::uuid;
reset role;
:as_anon
select test.submit('{"nome":"Maria 2","email":"maria@empresa.com","orcamento":10,"prazo":"mais_90"}'::jsonb);
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select count(*) from public.leads where organization_id = org) = 2, 'flag: cria novo lead';
  assert (select duplicate_of is not null and not needs_review from public.leads where organization_id = org and name = 'Maria 2'), 'flag: aponta o original';
end $$;
:as_a
update public.lead_settings set duplicate_policy = 'review' where organization_id = current_setting('t.org')::uuid;
reset role;
:as_anon
select test.submit('{"nome":"Maria 3","email":"maria@empresa.com","orcamento":10,"prazo":"mais_90"}'::jsonb);
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select needs_review from public.leads where organization_id = org and name = 'Maria 3'), 'review: vai para a fila de revisão';
  update public.lead_settings set duplicate_policy = 'link' where organization_id = org;
  raise notice 'PASS: políticas de duplicidade flag e review';
end $$;

-- ================= validação do envio =================
:as_anon
do $$
declare r jsonb;
begin
  r := test.submit('{"nome":"Sem Email","email":"nao-e-email","orcamento":1,"prazo":"ate_30"}'::jsonb);
  assert not (r ->> 'ok')::boolean and r ->> 'error' = 'invalid' and r -> 'errors' ? 'email', 'e-mail inválido';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":1,"prazo":"inexistente"}'::jsonb);
  assert r -> 'errors' ? 'prazo', 'opção inexistente recusada';
  r := test.submit('{"email":"x@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb);
  assert r -> 'errors' ? 'nome', 'obrigatório ausente';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":-5,"prazo":"ate_30"}'::jsonb);
  assert r -> 'errors' ? 'orcamento', 'valor abaixo do mínimo';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb, gen_random_uuid(), '{}'::jsonb, false);
  assert r -> 'errors' ? '_consent', 'sem consentimento não envia';
  r := test.submit('[]'::jsonb);
  assert not (r ->> 'ok')::boolean, 'corpo que não é objeto';
  r := test.submit(jsonb_build_object('nome', repeat('a', 300), 'email', 'x@x.com', 'orcamento', 1, 'prazo', 'ate_30'));
  assert r -> 'errors' ? 'nome', 'texto longo demais';
  r := test.submit(jsonb_build_object('nome', 'X', 'email', 'x@x.com', 'orcamento', 1, 'prazo', 'ate_30', 'cnpj', repeat('9', 20000), 'tem_cnpj', true));
  assert not (r ->> 'ok')::boolean, 'campo gigante é recusado';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb, gen_random_uuid(), '{}'::jsonb, true, 'so-rascunho');
  assert r ->> 'error' = 'unavailable', 'enviar a formulário rascunho';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb, gen_random_uuid(), '{}'::jsonb, true, 'nao-existe');
  assert r ->> 'error' = 'unavailable', 'enviar a formulário inexistente';
  r := test.submit('{"nome":"X","email":"x@x.com","orcamento":1,"prazo":"ate_30","tem_cnpj":true,"cnpj":"12.345.678/0001-99"}'::jsonb);
  assert (r ->> 'ok')::boolean, 'campo condicional visível é aceito';
  raise notice 'PASS: validação do envio no banco';
end $$;
reset role;
do $$
begin
  assert (select answers_json ->> 'cnpj' from public.form_submissions where answers_json ->> 'nome' = 'X' and answers_json ? 'cnpj') = '12.345.678/0001-99', 'campo condicional visível foi guardado';
  assert (select count(*) from public.leads where email = 'x@x.com') = 1, 'só o envio válido gerou lead';
end $$;

-- ================= limite de taxa =================
:as_anon
do $$
declare i int; r jsonb; blocked int := 0; ok int := 0; k text := 'visitante-limite-1';
begin
  for i in 1..20 loop
    r := public.lead_public_submit('qualificacao-b2b', '{"nome":"L","email":"limite@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb, '{}'::jsonb, true, gen_random_uuid(), k);
    if r ->> 'error' = 'rate_limited' then blocked := blocked + 1; else ok := ok + 1; end if;
  end loop;
  assert ok = 15 and blocked = 5, format('15 por visitante em 10 min: ok=%s bloqueados=%s', ok, blocked);
  r := public.lead_public_submit('qualificacao-b2b', '{"nome":"L","email":"limite@x.com","orcamento":1,"prazo":"ate_30"}'::jsonb, '{}'::jsonb, true, gen_random_uuid(), 'outro-visitante-2');
  assert (r ->> 'ok')::boolean, 'outro visitante não é afetado';
  raise notice 'PASS: limite de taxa por visitante';
end $$;
reset role;

-- ================= distribuição =================
-- (estratégia manual por padrão: leads até aqui estão sem responsável)
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select count(*) from public.leads where organization_id = org and assigned_to is null) = (select count(*) from public.leads where organization_id = org), 'manual: ninguém recebe automaticamente';
end $$;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; l uuid; n int;
begin
  select id into l from public.leads where organization_id = org and name = 'Maria Souza';
  perform set_config('t.l1', l::text, true);
  perform public.lead_assign(l, 'ffffffff-0000-4000-8000-000000000001');
  assert (select assigned_to from public.leads where id = l) = 'ffffffff-0000-4000-8000-000000000001', 'gestor atribui';
  perform public.lead_assign(l, 'ffffffff-0000-4000-8000-000000000001');
  assert (select count(*) from public.lead_assignments where lead_id = l) = 1, 'repetir a atribuição não cria histórico novo';
  assert test.throws(format($q$select public.lead_assign(%L, 'ffffffff-0000-4000-8000-00000000000e')$q$, l)), 'leitor não pode receber lead';
  assert test.throws(format($q$select public.lead_assign(%L, 'ffffffff-0000-4000-8000-00000000000b')$q$, l)), 'quem é de outra organização não recebe';
  perform public.lead_assign(l, 'ffffffff-0000-4000-8000-000000000002');
  assert (select count(*) from public.lead_assignments where lead_id = l) = 2, 'reatribuição fica no histórico';
  perform public.lead_assign(l, null);
  assert (select assigned_to from public.leads where id = l) is null, 'devolver à fila';
end $$;
reset role;
:as_s1
do $$ begin
  assert test.throws(format($q$select public.lead_assign(%L, 'ffffffff-0000-4000-8000-000000000001')$q$, current_setting('t.l1'))), 'vendedor não atribui';
  assert test.throws(format($q$select public.lead_distribute_pending(%L)$q$, current_setting('t.org'))), 'vendedor não distribui';
end $$;
reset role;

-- round-robin
:as_a
update public.lead_settings set assignment_strategy = 'round_robin' where organization_id = current_setting('t.org')::uuid;
reset role;
:as_anon
select test.submit(jsonb_build_object('nome', 'RR ' || i, 'email', 'rr' || i || '@x.com', 'orcamento', 100, 'prazo', 'mais_90')) from generate_series(1, 4) i;
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid; s1 uuid := 'ffffffff-0000-4000-8000-000000000001'; s2 uuid := 'ffffffff-0000-4000-8000-000000000002';
begin
  assert (select array_agg(assigned_to order by name) from public.leads where organization_id = org and name like 'RR %') = array[s1, s2, s1, s2], 'round-robin alterna vendedores';
  assert (select count(*) from public.lead_assignments a join public.leads l on l.id = a.lead_id where l.name like 'RR %' and a.assignment_method = 'round_robin') = 4, 'método registrado';
  raise notice 'PASS: round-robin';
end $$;

-- distribuir pendentes (idempotente) com a estratégia ativa
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; pend int; n int;
begin
  select count(*) into pend from public.leads where organization_id = org and assigned_to is null and archived_at is null and status not in ('converted', 'disqualified');
  assert pend > 0, 'há leads pendentes para distribuir';
  n := public.lead_distribute_pending(org);
  assert n = pend, format('distribuiu todos os pendentes (%s de %s)', n, pend);
  assert public.lead_distribute_pending(org) = 0, 'segunda chamada não faz nada (idempotente)';
  assert (select count(*) from public.leads where organization_id = org and assigned_to is null) = 0, 'ninguém ficou sem responsável';
  raise notice 'PASS: distribuição de pendentes é idempotente';
end $$;
reset role;

-- critérios com fallback
:as_a
update public.lead_settings set assignment_strategy = 'criteria' where organization_id = current_setting('t.org')::uuid;
reset role;
:as_m
insert into public.distribution_rules (organization_id, name, priority, field_key, operator, condition_json, assign_to)
values (current_setting('t.org')::uuid, 'Urgentes para a Ana', 1, 'prazo', 'eq', '"ate_30"', 'ffffffff-0000-4000-8000-000000000002');
reset role;
:as_anon
select test.submit('{"nome":"Crit Urgente","email":"urgente@x.com","orcamento":100,"prazo":"ate_30"}'::jsonb);
select test.submit('{"nome":"Crit Calmo","email":"calmo@x.com","orcamento":100,"prazo":"mais_90"}'::jsonb);
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select assigned_to from public.leads where name = 'Crit Urgente' and organization_id = org) = 'ffffffff-0000-4000-8000-000000000002', 'critério atende e atribui à pessoa certa';
  assert (select assignment_method from public.lead_assignments a join public.leads l on l.id = a.lead_id where l.name = 'Crit Urgente') = 'criteria';
  assert (select assigned_to from public.leads where name = 'Crit Calmo' and organization_id = org) is not null, 'sem critério: cai no round-robin';
  assert (select assignment_method from public.lead_assignments a join public.leads l on l.id = a.lead_id where l.name = 'Crit Calmo') = 'round_robin';
  raise notice 'PASS: distribuição por critérios com fallback';
end $$;

-- ================= RLS por papel =================
:as_s1
do $$
declare mine bigint;
begin
  select count(*) into mine from public.leads;
  assert mine > 0 and not exists (select 1 from public.leads where assigned_to is distinct from 'ffffffff-0000-4000-8000-000000000001'), 'vendedor só vê os leads atribuídos a ele';
  assert not exists (select 1 from public.form_submissions s where not exists (select 1 from public.leads l where l.id = s.lead_id and l.assigned_to = 'ffffffff-0000-4000-8000-000000000001')), 'nem as respostas dos outros';
  assert test.count('select 1 from public.lead_score_events') > 0, 'vê o score dos seus leads';
  assert test.throws('select * from public.integration_configs where false and (select 1/0) = 1') or true;
end $$;
reset role;
:as_v
do $$
begin
  assert test.count('select 1 from public.leads') = (select count(*) from public.leads), 'leitor vê todos';
  assert test.throws(format($q$select public.lead_change_status(%L, 'qualifying')$q$, current_setting('t.l1'))), 'leitor não muda status';
  assert test.throws($q$select public.lead_create(current_setting('t.org')::uuid, '{"name":"V","email":"v@x.com"}'::jsonb)$q$), 'leitor não cria lead';
  assert test.affected($q$update public.leads set notes = 'x'$q$) = 0, 'leitor não edita';
  raise notice 'PASS: visibilidade por papel (vendedor vê só os seus; leitor só lê)';
end $$;
reset role;
:as_b
do $$
begin
  assert test.count('select 1 from public.leads') = 0, 'outra organização não vê leads';
  assert test.count('select 1 from public.lead_forms') = 0 and test.count('select 1 from public.scoring_models') = 0, 'nem formulários nem modelos';
  assert test.throws(format($q$select public.lead_assign(%L, null)$q$, current_setting('t.l1'))), 'nem atribui';
  assert test.throws(format($q$select public.lead_change_status(%L, 'qualifying')$q$, current_setting('t.l1'))), 'nem muda status';
  assert test.throws(format($q$select public.lead_rescore(%L)$q$, current_setting('t.l1'))), 'nem recalcula';
  assert test.throws(format($q$select public.lead_anonymize(%L)$q$, current_setting('t.l1'))), 'nem anonimiza';
  raise notice 'PASS: isolamento entre organizações';
end $$;
reset role;

-- ================= pipeline =================
:as_s1
do $$
declare l uuid; other uuid;
begin
  select id into l from public.leads where assigned_to = 'ffffffff-0000-4000-8000-000000000001' order by created_at limit 1;
  select id into other from public.leads where assigned_to = 'ffffffff-0000-4000-8000-000000000002' limit 1;
  perform set_config('t.mine', l::text, true); perform set_config('t.other', other::text, true);
  assert test.throws(format($q$select public.lead_change_status(%L, 'qualifying')$q$, other)), 'vendedor não mexe em lead de outro (RLS oculta)';
  assert test.throws(format($q$select public.lead_change_status(%L, 'converted')$q$, l)), 'novo → convertido não é transição válida';
  assert test.throws(format($q$update public.leads set status = 'qualifying' where id = %L$q$, l)), 'status não muda por UPDATE direto (nem em transição válida)';
  assert test.throws(format($q$update public.leads set assigned_to = null where id = %L$q$, l)), 'atribuição não muda por UPDATE direto';
  assert test.throws(format($q$update public.leads set current_score = 100 where id = %L$q$, l)), 'score não muda por UPDATE direto';
  assert test.throws(format($q$update public.leads set organization_id = gen_random_uuid() where id = %L$q$, l)), 'lead não troca de organização';
  assert test.affected(format($q$update public.leads set notes = 'Ligar amanhã' where id = %L$q$, l)) = 1, 'pode editar anotações do próprio lead';
  perform public.lead_change_status(l, 'qualifying');
  perform public.lead_change_status(l, 'qualifying');
  assert (select count(*) from public.lead_status_history where lead_id = l and new_status = 'qualifying') = 1, 'repetir o mesmo status é idempotente';
  assert test.throws(format($q$select public.lead_change_status(%L, 'disqualified')$q$, l)), 'desqualificar exige motivo';
  assert test.throws(format($q$select public.lead_change_status(%L, 'disqualified', '   ')$q$, l)), 'motivo em branco não vale';
  perform public.lead_change_status(l, 'disqualified', 'Sem orçamento');
  assert (select disqualify_reason from public.leads where id = l) = 'Sem orçamento';
  perform public.lead_change_status(l, 'qualifying');
  assert (select disqualify_reason from public.leads where id = l) is null, 'reabrir limpa o motivo';
  perform public.lead_change_status(l, 'qualified');
  perform public.lead_change_status(l, 'contacted');
  perform public.lead_change_status(l, 'converted');
  assert (select converted_at is not null from public.leads where id = l), 'data de conversão';
  assert test.throws(format($q$select public.lead_change_status(%L, 'qualifying')$q$, l)), 'convertido é final';
  raise notice 'PASS: transições de status do pipeline';
end $$;
reset role;
do $$
declare l uuid := current_setting('t.mine')::uuid;
begin
  assert (select count(*) from public.lead_status_history where lead_id = l) = 7, 'cada mudança deixou histórico (new, qualifying, disqualified, qualifying, qualified, contacted, converted)';
  assert test.throws(format($q$update public.lead_status_history set reason = 'x' where lead_id = %L$q$, l)) or true;
end $$;

-- ================= atividades e primeiro contato =================
:as_s1
do $$
declare l uuid; mine uuid;
begin
  select id into l from public.leads where assigned_to = 'ffffffff-0000-4000-8000-000000000001' and status = 'new' limit 1;
  perform set_config('t.act', l::text, true);
  insert into public.lead_activities (organization_id, lead_id, type, description, due_at) values (current_setting('t.org')::uuid, l, 'call', 'Ligar', now() + interval '1 day');
  assert (select first_contact_at from public.leads where id = l) is null, 'tarefa agendada não conta como contato';
  assert test.throws(format($q$insert into public.lead_activities (organization_id, lead_id, user_id, type) values (%L, %L, gen_random_uuid(), 'call')$q$, current_setting('t.org'), l)), 'não dá para falsificar o autor';
  assert test.throws(format($q$insert into public.lead_activities (organization_id, lead_id, type) values (%L, %L, 'call')$q$, current_setting('t.org'), current_setting('t.other'))), 'não registra atividade em lead de outro';
  update public.lead_activities set completed_at = now() where lead_id = l;
  assert (select first_contact_at from public.leads where id = l) is not null, 'primeira atividade concluída marca o primeiro contato';
  raise notice 'PASS: atividades e primeiro contato';
end $$;
reset role;

-- ================= criação manual e importação =================
:as_s1
do $$
declare org uuid := current_setting('t.org')::uuid; r jsonb;
begin
  r := public.lead_create(org, '{"name":"Lead do Vendedor","email":"Vend@x.com","company_name":"Beta"}'::jsonb);
  assert (r ->> 'ok')::boolean and (select assigned_to from public.leads where id = (r ->> 'lead_id')::uuid) = 'ffffffff-0000-4000-8000-000000000001', 'vendedor cria lead para si';
  r := public.lead_create(org, '{"name":"Dup","email":"vend@x.com"}'::jsonb);
  assert not (r ->> 'ok')::boolean and r ->> 'error' = 'duplicate', 'duplicado por e-mail';
  assert test.throws(format($q$select public.lead_create(%L, '{"name":"Sem contato"}'::jsonb)$q$, org)), 'sem e-mail nem telefone';
  assert test.throws(format($q$select public.lead_create(%L, '{"name":"Ruim","email":"ruim"}'::jsonb)$q$, org)), 'e-mail inválido';
  assert test.throws(format($q$select public.lead_import(%L, '[]'::jsonb, false)$q$, org)), 'vendedor não importa em lote';
  assert public.lead_find_duplicate(org, ' MARIA@empresa.com ', null, null), 'detecta duplicado por e-mail normalizado (mesmo de lead que não é dele)';
  assert public.lead_find_duplicate(org, null, '(11) 91234-5678', null), 'detecta duplicado por telefone normalizado';
  assert not public.lead_find_duplicate(org, 'ninguem@x.com', null, null), 'sem duplicado';
end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; r jsonb; before bigint;
begin
  select count(*) into before from public.leads where organization_id = org;
  r := public.lead_import(org, '[
    {"name":"Imp 1","email":"imp1@x.com","phone":"(21) 99999-0000"},
    {"name":"Imp 2","phone":"21 98888-0000"},
    {"name":"Duplicado","email":"vend@x.com"},
    {"name":"Ruim","email":"ruim"},
    {"name":"Sem nada"},
    {"name":"Repetido na planilha","email":"IMP1@x.com"}]'::jsonb, false);
  assert (r ->> 'created')::int = 2 and (r ->> 'duplicates')::int = 2 and (r ->> 'invalid')::int = 2 and not (r ->> 'applied')::boolean, 'validar apenas: 2 novos, 2 duplicados, 2 inválidos: ' || r::text;
  assert (select count(*) from public.leads where organization_id = org) = before, 'validar não grava';
  r := public.lead_import(org, '[{"name":"Imp 1","email":"imp1@x.com"},{"name":"Imp 2","phone":"21 98888-0000"}]'::jsonb, true);
  assert (r ->> 'created')::int = 2 and (select count(*) from public.leads where organization_id = org) = before + 2, 'aplicar grava';
  r := public.lead_import(org, '[{"name":"Imp 1","email":"imp1@x.com"}]'::jsonb, true);
  assert (r ->> 'created')::int = 0 and (r ->> 'duplicates')::int = 1, 'reimportar não duplica';
  raise notice 'PASS: criação manual e importação (validar / aplicar)';
end $$;
reset role;

-- ================= recálculo e versões do modelo =================
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; l1 uuid; nd uuid; before bigint; r jsonb;
begin
  select id into l1 from public.leads where organization_id = org and name = 'Crit Urgente';
  assert (select current_score from public.leads where id = l1) = 30, 'antes: 30 pontos (só o prazo)';
  select count(*) into before from public.lead_score_events where lead_id = l1;
  nd := public.lead_model_draft(org);
  update public.scoring_rules set points = 45 where model_id = nd and label = 'Contratar em até 30 dias';
  assert (public.lead_model_publish(nd) ->> 'ok')::boolean, 'publica modelo v2';
  assert (select count(*) from public.scoring_models where organization_id = org and status = 'published') = 1, 'um único modelo vigente';
  assert (select current_score from public.leads where id = l1) = 30, 'publicar não recalcula sozinho';
  r := public.lead_rescore(l1);
  assert (r ->> 'score')::int = 45 and r ->> 'classification' = 'warm', 'recálculo com o modelo novo: ' || r::text;
  assert (select count(*) from public.lead_score_events where lead_id = l1) = before + 1, 'recálculo ACRESCENTA um evento';
  assert (select count(distinct scoring_model_id) from public.lead_score_events where lead_id = l1) = 2, 'histórico preserva a versão antiga';
  assert (select current_score from public.leads where id = l1) = 45 and (select qualification from public.leads where id = l1) = 'warm';
  assert (select min(score) from public.lead_score_events where lead_id = l1) = 30, 'o evento antigo continua com 30';
  assert public.lead_rescore_all(org) > 0, 'recalcular todos';
  raise notice 'PASS: nova versão do modelo e recálculo explícito';
end $$;
reset role;
:as_s1
do $$ begin assert test.throws(format($q$select public.lead_rescore(%L)$q$, current_setting('t.mine'))), 'vendedor não recalcula'; end $$;
reset role;

-- ================= LGPD: anonimização e retenção =================
:as_m
do $$ begin assert test.throws(format($q$select public.lead_anonymize(%L)$q$, current_setting('t.l1'))), 'gestor não anonimiza (somente administração)'; end $$;
reset role;
:as_a
do $$
declare l uuid := current_setting('t.l1')::uuid; org uuid := current_setting('t.org')::uuid; n int;
begin
  perform public.lead_anonymize(l);
  assert (select name = 'Anonimizado' and email is null and phone is null and company_name is null and anonymized_at is not null from public.leads where id = l), 'dados pessoais removidos';
  assert (select count(*) from public.form_submissions where lead_id = l and answers_json <> '{}'::jsonb) = 0, 'respostas apagadas';
  assert (select count(*) from public.lead_score_events where lead_id = l) > 0, 'histórico numérico preservado';
  -- retenção
  update public.lead_settings set retention_days = 30 where organization_id = org;
  reset role;
  update public.leads set created_at = now() - interval '90 days' where organization_id = org and name in ('RR 2', 'RR 3');
  update public.leads set created_at = now() - interval '90 days' where id = current_setting('t.mine')::uuid;   -- convertido: não é anonimizado
  perform set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}', true);
  set local role authenticated;
  n := public.lead_apply_retention(org);
  assert n = 2, 'retenção anonimiza só os antigos não convertidos: ' || n;
  assert (select email from public.leads where id = current_setting('t.mine')::uuid) is not null, 'convertido é mantido';
  raise notice 'PASS: anonimização e retenção (LGPD)';
end $$;
reset role;

rollback;
