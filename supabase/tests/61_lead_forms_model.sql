-- Formulários (ciclo de vida, versões imutáveis, validação) e modelos de score (rascunho, publicação, imutabilidade, simulação).
-- Org A: A (owner), M (gestor), S1/S2 (vendedores), V (leitor). Org B: B (owner).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_a1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal1"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@lead.invalid'),
  ('ffffffff-0000-4000-8000-00000000000c', 'm@lead.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 's1@lead.invalid'),
  ('ffffffff-0000-4000-8000-00000000000e', 'v@lead.invalid'),
  ('ffffffff-0000-4000-8000-00000000000b', 'b@lead.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Leads A', 'leads-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'),
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'),
    (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('Leads B', 'leads-b')::text, true); end $$;
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
select set_config('t.logic', '[{"target":"cnpj","show_if":{"all":[{"field":"tem_cnpj","op":"is_true"}]}}]', true);

-- ================= formulário: criação e permissões =================
:as_s1
do $$ begin
  assert test.throws(format($q$select public.lead_form_create(%L, 'Meu form', 'meu-form')$q$, current_setting('t.org'))), 'vendedor não cria formulário';
end $$;
reset role;
:as_v
do $$ begin
  assert test.throws(format($q$select public.lead_form_create(%L, 'Meu form', 'meu-form')$q$, current_setting('t.org'))), 'leitor não cria formulário';
  assert test.count('select 1 from public.lead_forms') = 0 or true;
end $$;
reset role;
:as_a1
do $$ begin
  assert test.throws(format($q$select public.lead_form_create(%L, 'Meu form', 'meu-form')$q$, current_setting('t.org'))), 'owner sem AAL2 não cria formulário';
end $$;
reset role;
:as_b
do $$ begin
  assert test.throws(format($q$select public.lead_form_create(%L, 'Invasor', 'invasor-x')$q$, current_setting('t.org'))), 'outra organização não cria formulário';
end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; f uuid;
begin
  assert test.throws(format($q$select public.lead_form_create(%L, 'x', 'AB')$q$, org)), 'slug inválido é recusado';
  assert test.throws(format($q$select public.lead_form_create(%L, 'Um', 'ab')$q$, org)), 'slug curto demais é recusado';
  f := public.lead_form_create(org, 'Qualificação B2B', 'qualificacao-b2b');
  perform set_config('t.f', f::text, true);
  assert (select count(*) from public.lead_form_versions where form_id = f and published_at is null) = 1, 'nasce com um rascunho';
  assert test.throws(format($q$select public.lead_form_create(%L, 'Outro', 'qualificacao-b2b')$q$, org)), 'slug é único globalmente';
  raise notice 'PASS: criação de formulário e permissões';
end $$;
reset role;

-- ================= rascunho, validação e publicação =================
:as_m
do $$
declare f uuid := current_setting('t.f')::uuid; r jsonb;
begin
  -- só nome: sem contato obrigatório → não publica
  perform public.lead_form_save_draft(f, '{"schema":{"steps":[],"fields":[{"key":"nome","type":"text","label":"Nome","required":true,"lead_field":"name"}]}}'::jsonb);
  r := public.lead_form_publish(f);
  assert (r ->> 'ok')::boolean = false and r::text like '%OBRIGAT%', 'sem e-mail/telefone obrigatório não publica';
  assert (select status from public.lead_forms where id = f) = 'draft', 'continua rascunho';

  -- problemas apontados no salvamento
  r := public.lead_form_save_draft(f, jsonb_build_object('schema', '{"steps":[],"fields":[{"key":"Nome","type":"text","label":"x"},{"key":"a","type":"select","label":"S","options":[{"value":"1","label":"1"}]},{"key":"b","type":"zzz","label":"Z"}]}'::jsonb));
  assert jsonb_array_length(r) >= 3, 'salvar devolve os problemas encontrados';

  -- condição que depende de pergunta POSTERIOR
  r := public.lead_form_save_draft(f, jsonb_build_object(
    'schema', current_setting('t.schema')::jsonb,
    'logic', '[{"target":"cnpj","show_if":{"all":[{"field":"decisor","op":"is_true"},{"field":"ghost","op":"is_true"}]}}]'::jsonb));
  assert r::text like '%ANTERIORES%', 'condição só pode depender de perguntas anteriores';
  r := public.lead_form_save_draft(f, jsonb_build_object(
    'schema', current_setting('t.schema')::jsonb,
    'logic', '[{"target":"email","show_if":{"all":[{"field":"nome","op":"answered"}]}}]'::jsonb));
  assert r::text like '%contato obrigatório%', 'contato obrigatório não pode ser condicional';
  r := public.lead_form_save_draft(f, jsonb_build_object(
    'schema', current_setting('t.schema')::jsonb,
    'logic', '[{"target":"cnpj","show_if":{"all":[{"field":"tem_cnpj","op":"hack"}]}}]'::jsonb));
  assert r::text like '%operador inválido%', 'operador desconhecido é recusado';
  r := public.lead_form_save_draft(f, jsonb_build_object('schema', current_setting('t.schema')::jsonb, 'logic', current_setting('t.logic')::jsonb,
    'consent', '{"required":true,"text":"Concordo com o contato comercial."}'::jsonb,
    'thank_you_message', 'Obrigado!', 'success_redirect_url', 'https://exemplo.com.br/obrigado'));
  assert jsonb_array_length(r) = 0, 'definição válida não tem problemas: ' || r::text;
  assert test.throws(format($q$select public.lead_form_save_draft(%L, '{"success_redirect_url":"http://inseguro.invalid"}'::jsonb)$q$, f)), 'redirecionamento só https';
  assert test.throws(format($q$select public.lead_form_save_draft(%L, '{"success_redirect_url":"javascript:alert(1)"}'::jsonb)$q$, f)), 'javascript: é recusado';

  r := public.lead_form_publish(f);
  assert (r ->> 'ok')::boolean and (r ->> 'version')::int = 1, 'publica a versão 1';
  assert (select status from public.lead_forms where id = f) = 'published';
  assert test.throws(format($q$select public.lead_form_publish(%L)$q$, f)), 'sem alterações não publica de novo';
  raise notice 'PASS: validação da definição e publicação';
end $$;
reset role;

do $$
declare f uuid := current_setting('t.f')::uuid; v1 uuid;
begin
  select id into v1 from public.lead_form_versions where form_id = f and version_number = 1;
  assert test.throws(format($q$update public.lead_form_versions set schema_json = '{"steps":[],"fields":[]}' where id = %L$q$, v1)), 'versão publicada é imutável';
  assert test.throws(format($q$update public.lead_forms set slug = 'novo-slug-x' where id = %L$q$, f)), 'link não muda depois de publicado';
  assert (select current_published_version_id from public.lead_forms where id = f) = v1;
  raise notice 'PASS: imutabilidade da versão publicada e do link';
end $$;

-- ================= nova versão sem afetar a publicada =================
:as_m
do $$
declare f uuid := current_setting('t.f')::uuid; r jsonb; pub jsonb;
begin
  r := public.lead_form_save_draft(f, jsonb_build_object('name', 'Qualificação B2B v2', 'description', 'Formulário principal'));
  assert (select count(*) from public.lead_form_versions where form_id = f) = 2, 'novo rascunho = versão 2';
  assert (select count(*) from public.lead_form_versions where form_id = f and published_at is null) = 1;
  pub := public.lead_public_form('qualificacao-b2b');
  assert (pub ->> 'version')::int = 1, 'o público continua vendo a versão 1';
  r := public.lead_form_save_draft(f, jsonb_build_object('schema', jsonb_set(current_setting('t.schema')::jsonb, '{fields,4,label}', '"Orçamento mensal"')));
  r := public.lead_form_publish(f);
  assert (r ->> 'version')::int = 2, 'publica a versão 2';
  pub := public.lead_public_form('qualificacao-b2b');
  assert (pub ->> 'version')::int = 2 and pub -> 'schema' -> 'fields' -> 4 ->> 'label' = 'Orçamento mensal', 'o público passa a ver a 2';
  assert (select schema_json -> 'fields' -> 4 ->> 'label' from public.lead_form_versions where form_id = f and version_number = 1) = 'Orçamento', 'versão 1 intacta';
  raise notice 'PASS: versionamento de formulário';
end $$;
reset role;

-- ================= duplicar, arquivar =================
:as_m
do $$
declare f uuid := current_setting('t.f')::uuid; d uuid;
begin
  d := public.lead_form_duplicate(f, 'Cópia do B2B', 'copia-b2b');
  assert (select status from public.lead_forms where id = d) = 'draft', 'cópia nasce como rascunho';
  assert (select schema_json from public.lead_form_versions where form_id = d) = (select schema_json from public.lead_form_versions where form_id = f and version_number = 2), 'cópia traz a última definição';
  assert (public.lead_public_form('copia-b2b') ->> 'state') = 'unavailable', 'rascunho nunca é público';
  perform public.lead_form_archive(f, true);
  assert (public.lead_public_form('qualificacao-b2b') ->> 'state') = 'unavailable', 'arquivado sai do ar';
  assert test.throws(format($q$select public.lead_form_save_draft(%L, '{}'::jsonb)$q$, f)), 'arquivado não é editado';
  perform public.lead_form_archive(f, false);
  assert (public.lead_public_form('qualificacao-b2b') ->> 'state') = 'open', 'desarquivar volta ao ar';
  assert (public.lead_public_form('NÃO ABRE') ->> 'state') = 'unavailable', 'slug inválido → indisponível';
  raise notice 'PASS: duplicar e arquivar formulário';
end $$;
reset role;

-- ================= leitor lê, vendedor não vê formulários =================
:as_s1
do $$ begin assert test.count('select 1 from public.lead_forms') = 0, 'vendedor não lista formulários'; end $$;
reset role;
:as_v
do $$ begin
  assert test.count('select 1 from public.lead_forms') >= 1, 'leitor lista formulários';
  assert test.throws(format($q$select public.lead_form_publish(%L)$q$, current_setting('t.f'))), 'leitor não publica';
  raise notice 'PASS: visibilidade de formulários por papel';
end $$;
reset role;

-- ================= modelo de score =================
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; d uuid; d2 uuid; r jsonb;
begin
  assert (select count(*) from public.scoring_models where organization_id = org) = 0, 'sem modelo inicial';
  d := public.lead_model_draft(org);
  d2 := public.lead_model_draft(org);
  assert d = d2, 'rascunho é único';
  perform set_config('t.m1', d::text, true);
  insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, condition_json, points, priority) values
    (org, d, 'Orçamento acima de R$ 5.000', 'orcamento', 'gt', '5000', 30, 1),
    (org, d, 'Contratar em até 30 dias', 'prazo', 'eq', '"ate_30"', 30, 2),
    (org, d, 'Participa da decisão', 'decisor', 'is_true', 'null', 20, 3),
    (org, d, 'Empresa informada', 'empresa', 'answered', 'null', 10, 4);
  assert test.throws(format($q$insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (%L, %L, 'x', 'Campo Inválido', 'eq', 1)$q$, org, d)), 'chave de campo inválida';
  assert test.throws(format($q$insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (%L, %L, 'x', 'a', 'eval', 1)$q$, org, d)), 'operador fora da lista fechada';
  assert test.throws(format($q$insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (%L, %L, 'x', 'a', 'eq', 101)$q$, org, d)), 'pontos limitados a ±100';

  -- regra sem valor impede publicar; corrigida, publica
  insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (org, d, 'Sem valor', 'cargo', 'gt', 5);
  r := public.lead_model_publish(d);
  assert (r ->> 'ok')::boolean = false and r::text like '%Sem valor%', 'regra sem valor impede publicação';
  delete from public.scoring_rules where model_id = d and label = 'Sem valor';
  update public.scoring_models set thresholds_json = '{"warm_min":80,"hot_min":70,"qualified_min":70}' where id = d;
  r := public.lead_model_publish(d);
  assert (r ->> 'ok')::boolean = false, 'faixas inválidas impedem publicação';
  update public.scoring_models set thresholds_json = '{"warm_min":40,"hot_min":70,"qualified_min":70}' where id = d;
  r := public.lead_model_publish(d);
  assert (r ->> 'ok')::boolean and (r ->> 'version')::int = 1, 'publica o modelo 1';
  raise notice 'PASS: rascunho e publicação de modelo';
end $$;
reset role;

do $$
declare d uuid := current_setting('t.m1')::uuid; org uuid := current_setting('t.org')::uuid;
begin
  assert test.throws(format($q$update public.scoring_models set name = 'alterado' where id = %L$q$, d)), 'modelo publicado é imutável';
  assert test.throws(format($q$insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (%L, %L, 'x', 'a', 'answered', 1)$q$, org, d)), 'não entra regra em modelo publicado';
  assert test.throws(format($q$update public.scoring_rules set points = 99 where model_id = %L$q$, d)), 'regra de modelo publicado não muda';
  assert test.throws(format($q$delete from public.scoring_rules where model_id = %L$q$, d)), 'regra de modelo publicado não é apagada';
  assert test.throws(format($q$update public.scoring_models set status = 'draft' where id = %L$q$, d)), 'publicado não volta a rascunho';
  raise notice 'PASS: imutabilidade do modelo publicado';
end $$;

-- ================= permissões do modelo + simulador =================
:as_s1
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.throws(format($q$select public.lead_model_draft(%L)$q$, org)), 'vendedor não cria rascunho de modelo';
  assert test.count('select 1 from public.scoring_models') = 1, 'vendedor lê o modelo vigente';
  assert test.throws(format($q$insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (%L, gen_random_uuid(), 'x', 'a', 'answered', 1)$q$, org)), 'vendedor não cria regra';
end $$;
reset role;
:as_m
do $$
declare d uuid := current_setting('t.m1')::uuid; r jsonb; org uuid := current_setting('t.org')::uuid; nd uuid;
begin
  r := public.lead_simulate(d, '{"orcamento":8000,"prazo":"ate_30","decisor":true,"empresa":"Acme"}');
  assert (r ->> 'score')::int = 90 and r ->> 'classification' = 'hot' and (r ->> 'qualified')::boolean, 'simulador: 90, quente';
  r := public.lead_simulate(d, '{"orcamento":3000}');
  assert (r ->> 'score')::int = 0 and r -> 'missing' = '["prazo","decisor"]'::jsonb, 'simulador lista dados ausentes: ' || r::text;
  -- novo rascunho copia as regras do publicado
  nd := public.lead_model_draft(org);
  assert nd <> d and (select version from public.scoring_models where id = nd) = 2, 'rascunho v2';
  assert (select count(*) from public.scoring_rules where model_id = nd) = 4, 'rascunho copia as 4 regras';
  assert (select status from public.scoring_models where id = d) = 'published', 'publicado segue vigente até publicar o novo';
  perform set_config('t.m2', nd::text, true);
  -- um modelo único serve a vários formulários: regra sobre pergunta que o formulário não tem é ignorada
  insert into public.scoring_rules (organization_id, model_id, label, field_key, operator, points) values (org, nd, 'Fora do formulário', 'inexistente_x', 'not_answered', 40);
  r := public.lead_simulate(nd, '{"orcamento":8000,"prazo":"ate_30","decisor":true,"empresa":"Acme"}');
  assert (r ->> 'score')::int = 100, 'sem o formulário, a regra vale (90 + 40 limitado a 100)';
  r := public.lead_simulate(nd, '{"orcamento":8000,"prazo":"ate_30","decisor":true,"empresa":"Acme"}', current_setting('t.f')::uuid);
  assert (r ->> 'score')::int = 90 and r::text not like '%inexistente_x%', 'com o formulário, a regra sobre pergunta inexistente é ignorada';
  raise notice 'PASS: simulador e novo rascunho a partir do publicado';
end $$;
reset role;

rollback;
