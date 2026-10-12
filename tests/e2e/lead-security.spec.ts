import { expect, test } from '@playwright/test';
import { apiLogin, rest } from './helpers';
import { DEMO_PASSWORD, restJson, rpc, seedPublishedForm, setupOwner, suffix } from './lead-helpers';

const URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.E2E_SUPABASE_ANON_KEY ?? '';
const anonFetch = (path: string, init: RequestInit = {}) => fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, 'content-type': 'application/json', ...init.headers } });

test('visitante anônimo: nenhuma tabela, nenhuma função interna; só as duas funções públicas', async () => {
  for (const table of ['leads', 'form_submissions', 'lead_forms', 'lead_form_versions', 'lead_score_events', 'ai_analyses', 'public_rate_limits', 'scoring_rules', 'organizations', 'lead_activities', 'integration_configs']) {
    const res = await anonFetch(`${table}?select=*`);
    const body = await res.text();
    // sem privilégio: erro de permissão; nunca dados
    expect(res.ok && body !== '[]', `${table} não pode devolver dados ao anônimo (${res.status} ${body.slice(0, 80)})`).toBe(false);
  }
  const insert = await anonFetch('leads', { method: 'POST', body: JSON.stringify({ name: 'x', email: 'x@x.com' }) });
  expect(insert.ok).toBe(false);
  for (const fn of ['lead_assign', 'lead_change_status', 'lead_rescore', 'lead_anonymize', 'lead_import', 'lead_create', 'lead_score_compute', 'lead_distribute_pending', 'lead_ai_save']) {
    const res = await anonFetch(`rpc/${fn}`, { method: 'POST', body: '{}' });
    expect([401, 403, 404, 400].includes(res.status), `${fn} não deve ser executável pelo anônimo (${res.status})`).toBe(true);
    expect(res.ok).toBe(false);
  }
  const pub = await anonFetch('rpc/lead_public_form', { method: 'POST', body: JSON.stringify({ p_slug: 'qualificacao-b2b' }) });
  expect(pub.ok).toBe(true);
  const json = (await pub.json()) as { state: string; schema?: unknown; organization_id?: string };
  expect(json.state).toBe('open');
  expect(JSON.stringify(json)).not.toMatch(/organization_id|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  const ghost = await (await anonFetch('rpc/lead_public_form', { method: 'POST', body: JSON.stringify({ p_slug: 'nao-existe-mesmo' }) })).json();
  const draft = await (await anonFetch('rpc/lead_public_form', { method: 'POST', body: JSON.stringify({ p_slug: 'diagnostico-empresarial' }) })).json();
  expect(ghost).toEqual({ state: 'unavailable' });
  expect(draft).toEqual({ state: 'unavailable' });
});

test('limite de taxa no banco: o mesmo visitante é barrado; outro visitante não', async () => {
  const key = `visitante-${suffix()}-${suffix()}`;
  const send = (k: string) => anonFetch('rpc/lead_public_submit', {
    method: 'POST', body: JSON.stringify({ p_slug: 'qualificacao-b2b', p_answers: {}, p_meta: {}, p_consent: true, p_submission_key: crypto.randomUUID(), p_client_key: k }),
  }).then((r) => r.json() as Promise<{ error?: string }>);
  const results: string[] = [];
  for (let i = 0; i < 18; i += 1) results.push((await send(key)).error ?? 'ok');
  expect(results.filter((r) => r === 'rate_limited').length).toBeGreaterThanOrEqual(3);
  expect(results.slice(0, 15).every((r) => r === 'invalid')).toBe(true);
  expect((await send(`outro-${suffix()}-${suffix()}`)).error).toBe('invalid');
});

test('isolamento entre empresas e papéis (RLS) pela API: outra organização e vendedor', async ({ browser }) => {
  const a = await setupOwner(browser, 'secA');
  const b = await setupOwner(browser, 'secB');
  const { formId } = await seedPublishedForm(a, `sec-${suffix()}`);
  const created = await rpc<{ lead_id: string }>(a.token, 'lead_create', { p_org: a.orgId, p_payload: { name: 'Lead da A', email: `a.${suffix()}@exemplo.test` } });

  // B não enxerga nada de A
  expect(await restJson(b.token, 'leads?select=id')).toEqual([]);
  expect(await restJson(b.token, 'lead_forms?select=id')).toEqual([]);
  expect(await restJson(b.token, 'scoring_models?select=id')).toEqual([]);
  for (const [fn, args] of [
    ['lead_change_status', { p_lead: created.lead_id, p_status: 'qualifying', p_reason: null }],
    ['lead_assign', { p_lead: created.lead_id, p_to: null }],
    ['lead_rescore', { p_lead: created.lead_id }],
    ['lead_anonymize', { p_lead: created.lead_id }],
    ['lead_form_publish', { p_form: formId }],
  ] as const) {
    const res = await rest(b.token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    expect(res.ok, `${fn} de outra organização deve falhar`).toBe(false);
  }
  // B não cria lead nem formulário dentro da organização de A
  expect((await rest(b.token, 'rpc/lead_create', { method: 'POST', body: JSON.stringify({ p_org: a.orgId, p_payload: { name: 'Invasor', email: 'i@x.com' } }) })).ok).toBe(false);
  expect((await rest(b.token, 'rpc/lead_form_create', { method: 'POST', body: JSON.stringify({ p_org: a.orgId, p_name: 'Invasor', p_slug: `inv-${suffix()}` }) })).ok).toBe(false);
  // e o lead de A segue intacto
  expect(await restJson<Array<{ status: string }>>(a.token, `leads?select=status&id=eq.${created.lead_id}`)).toEqual([{ status: 'new' }]);

  // vendedor da demonstração: só os 71 dele; não altera o do colega nem usa funções de gestão
  const seller = await apiLogin('vendedor1@demo.exemplo', DEMO_PASSWORD);
  const mine = await restJson<Array<{ id: string; assigned_to: string }>>(seller, 'leads?select=id,assigned_to');
  expect(mine).toHaveLength(71);
  expect(new Set(mine.map((l) => l.assigned_to)).size).toBe(1);
  const sellerToken = seller;
  const other = await rest(sellerToken, 'leads?select=id&assigned_to=neq.' + mine[0]!.assigned_to);
  expect(await other.json()).toEqual([]);
  const patch = await rest(sellerToken, `leads?id=neq.${mine[0]!.id}&assigned_to=not.is.null`, { method: 'PATCH', body: JSON.stringify({ notes: 'invasão' }) });
  const patched = (await patch.json()) as unknown[];
  expect(Array.isArray(patched) ? patched.filter((l) => (l as { assigned_to: string }).assigned_to !== mine[0]!.assigned_to).length : 0).toBe(0);
  for (const [fn, args] of [
    ['lead_assign', { p_lead: mine[0]!.id, p_to: null }],
    ['lead_rescore_all', { p_org: 'e5e5e5e5-0000-4000-8000-000000000001' }],
    ['lead_distribute_pending', { p_org: 'e5e5e5e5-0000-4000-8000-000000000001' }],
    ['lead_model_draft', { p_org: 'e5e5e5e5-0000-4000-8000-000000000001' }],
    ['lead_anonymize', { p_lead: mine[0]!.id }],
  ] as const) {
    expect((await rest(sellerToken, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })).ok, `${fn} não é do vendedor`).toBe(false);
  }
  // colunas protegidas: status/score/atribuição não mudam por UPDATE
  for (const col of [{ status: 'converted' }, { current_score: 100 }, { assigned_to: null }, { organization_id: a.orgId }]) {
    const res = await rest(sellerToken, `leads?id=eq.${mine[0]!.id}`, { method: 'PATCH', body: JSON.stringify(col) });
    expect(res.ok, `UPDATE direto de ${Object.keys(col)[0]} deve falhar`).toBe(false);
  }
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('chave de serviço e segredos nunca chegam ao navegador; XSS e CSV hostis são neutralizados', async ({ browser }) => {
  const owner = await setupOwner(browser, 'xss');
  const { page } = owner;
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  const evil = `<img src=x onerror=alert(1)> ${suffix()}`;
  await rpc(owner.token, 'lead_create', { p_org: owner.orgId, p_payload: { name: evil, email: `xss.${suffix()}@exemplo.test`, company_name: '<script>alert(2)</script>' } });
  for (const path of ['/leads', '/pipeline', '/dashboard', '/leads/importar']) {
    await page.goto(path);
    await page.waitForLoadState('load'); await page.waitForTimeout(700);
  }
  await page.goto('/leads');
  await expect(page.getByRole('table', { name: 'Leads' })).toContainText('<img src=x onerror=alert(1)>');
  expect(dialogs).toEqual([]);

  // varre os scripts carregados em páginas autenticadas e na pública
  const seen = new Set<string>();
  const bodies: string[] = [];
  page.on('response', async (r) => { if (r.url().includes('/_next/static/') && r.url().endsWith('.js') && !seen.has(r.url())) { seen.add(r.url()); bodies.push(await r.text().catch(() => '')); } });
  for (const path of ['/dashboard', '/leads', '/pipeline', '/formularios', '/qualificacao', '/f/qualificacao-b2b']) {
    await page.goto(path);
    await page.waitForLoadState('load'); await page.waitForTimeout(700);
  }
  const all = bodies.join('\n');
  expect(all.length).toBeGreaterThan(50_000);
  expect(all).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_|AI_API_KEY/);
  expect(all).not.toContain('c2VydmljZV9yb2xl'); // "service_role" em base64 (claim do JWT)
});

test('importação: arquivo grande e planilha com linhas demais são recusados com mensagem clara', async ({ browser }) => {
  const owner = await setupOwner(browser, 'lim');
  const { page } = owner;
  await page.goto('/leads/importar');
  const rows = ['nome;e-mail'];
  for (let i = 0; i < 2001; i += 1) rows.push(`Pessoa ${i};p${i}@exemplo.test`);
  await page.setInputFiles('#file', { name: 'muitas.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n'), 'utf8') });
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Muitas linhas (máximo de 2000 por importação).')).toBeVisible();
  // sem coluna de contato
  await page.setInputFiles('#file', { name: 'sem-contato.csv', mimeType: 'text/csv', buffer: Buffer.from('nome;empresa\nAna;X\n', 'utf8') });
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Não encontrei a coluna de e-mail nem a de telefone.')).toBeVisible();
  // acima de 1 MB: bloqueado no navegador
  await page.setInputFiles('#file', { name: 'grande.csv', mimeType: 'text/csv', buffer: Buffer.alloc(1_100_000, 'a') });
  await expect(page.getByText('Arquivo muito grande (máximo de 1 MB).').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeDisabled();
});
