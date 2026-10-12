import { expect, test, type Page } from '@playwright/test';
import { restJson, rpc, setupOwner, suffix, watchCsp, type Owner } from './lead-helpers';

const column = (page: Page, name: string) => page.getByRole('region', { name: `Coluna ${name}` });
const firstContact = (page: Page) => page.locator('dt', { hasText: 'Primeiro contato' }).locator('xpath=following-sibling::dd');
// espera o servidor confirmar (o cartão fica aria-busy enquanto a mudança está em andamento)
const settle = (page: Page) => expect(page.locator('li[aria-busy="true"]')).toHaveCount(0);
const move = async (page: Page, lead: string, to: string) => {
  await page.getByLabel(`Mover ${lead} para`).selectOption({ label: to });
  if (to !== 'Desqualificado') await expect(column(page, to).getByRole('link', { name: lead })).toBeVisible(); // a mudança otimista já foi desenhada
  await settle(page); // e agora o servidor confirmou
};
const create = (owner: Owner, name: string, extra: Record<string, unknown> = {}) =>
  rpc<{ ok: boolean; lead_id: string }>(owner.token, 'lead_create', { p_org: owner.orgId, p_payload: { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${suffix()}@exemplo.test`, ...extra } });

test('pipeline: mover entre colunas, transições válidas, motivo ao desqualificar e status final', async ({ browser }) => {
  const owner = await setupOwner(browser, 'pipe');
  const { page } = owner;
  const violations = watchCsp(page);
  const a = `Lead Um ${suffix()}`;
  const b = `Lead Dois ${suffix()}`;
  const c = `Lead Tres ${suffix()}`;
  const [la, lb] = await Promise.all([create(owner, a), create(owner, b), create(owner, c)]);

  await page.goto('/pipeline');
  await expect(column(page, 'Novo').getByRole('link', { name: a })).toBeVisible();

  // new → em qualificação (select acessível); as opções mostram só as transições válidas
  await move(page, a, 'Em qualificação');
  await expect(column(page, 'Em qualificação').getByRole('link', { name: a })).toBeVisible();
  const options = await page.getByLabel(`Mover ${a} para`).locator('option').allInnerTexts();
  expect(options).toContain('Qualificado');
  expect(options).not.toContain('Convertido');

  // desqualificar exige motivo
  await move(page, b, 'Desqualificado');
  const dialog = page.getByRole('dialog', { name: 'Motivo da desqualificação' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Desqualificar' })).toBeDisabled();
  await dialog.getByLabel('Motivo').selectOption({ label: 'Sem orçamento' });
  await dialog.getByRole('button', { name: 'Desqualificar' }).click();
  await settle(page);
  await expect(column(page, 'Desqualificado').getByRole('link', { name: b })).toBeVisible();

  // convertido é final: sem seletor depois
  await move(page, c, 'Qualificado');
  await expect(column(page, 'Qualificado').getByRole('link', { name: c })).toBeVisible();
  await expect(page.getByLabel(`Mover ${c} para`)).toBeEnabled(); // aguarda a confirmação do servidor
  await move(page, c, 'Convertido');
  await expect(column(page, 'Convertido').getByRole('link', { name: c })).toBeVisible();
  await expect(page.getByLabel(`Mover ${c} para`)).toHaveCount(0);

  // persiste ao recarregar
  await page.reload();
  await expect(column(page, 'Convertido').getByRole('link', { name: c })).toBeVisible();
  await expect(column(page, 'Desqualificado').getByRole('link', { name: b })).toBeVisible();

  // detalhe: histórico e motivo; reabrir limpa o motivo
  await page.goto(`/leads/${lb.lead_id}`);
  await expect(page.getByText('Motivo: Sem orçamento')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Histórico do lead' })).toContainText('Novo → Desqualificado · Sem orçamento');
  await page.getByLabel('Mover para').selectOption({ label: 'Em qualificação' });
  await page.getByRole('button', { name: 'Atualizar status' }).click();
  await expect(page.getByText('Motivo: Sem orçamento')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Histórico do lead' })).toContainText('Desqualificado → Em qualificação');

  // o banco recusa mudança de status fora da função (defesa em profundidade)
  const direct = await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/leads?id=eq.${la.lead_id}`, {
    method: 'PATCH', headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'converted' }),
  });
  expect(direct.ok).toBe(false);
  expect(violations).toEqual([]);
});

test('arrastar pelo teclado move o lead para a coluna ao lado', async ({ browser }) => {
  const owner = await setupOwner(browser, 'kbd');
  const { page } = owner;
  const name = `Lead Teclado ${suffix()}`;
  await create(owner, name);
  await page.goto('/pipeline');
  const handle = page.getByRole('button', { name: new RegExp(`Arrastar ${name}`) });
  await handle.focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 14; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(column(page, 'Em qualificação').getByRole('link', { name: name })).toBeVisible({ timeout: 10_000 });
});

test('atividades: primeiro contato só conta quando concluída; follow-up atrasado aparece e some ao concluir', async ({ browser }) => {
  const owner = await setupOwner(browser, 'act');
  const { page } = owner;
  const name = `Lead Atividade ${suffix()}`;
  const lead = await create(owner, name);

  await page.goto(`/leads/${lead.lead_id}`);
  // follow-up agendado no passado, ainda não concluído
  await page.getByLabel('Tipo').selectOption({ label: 'Ligação' });
  const past = new Date(Date.now() - 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByLabel('Data e hora (follow-up)').fill(`${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T10:00`);
  await page.getByLabel('O que foi feito / combinado').fill('Retornar a ligação.');
  await page.getByRole('button', { name: 'Registrar atividade' }).click();
  await expect(page.getByText('Atrasada')).toBeVisible();
  await expect(firstContact(page)).toHaveText('—');

  await page.goto('/atividades');
  await expect(page.getByRole('heading', { name: /Atrasadas/ })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();

  // painel: follow-up atrasado contado
  await page.goto('/dashboard?period=7d');
  await expect(page.getByRole('region', { name: 'Indicadores' }).getByText('Follow-ups atrasados', { exact: true }).locator('..')).toContainText('1');

  // concluir marca o primeiro contato
  await page.goto('/atividades');
  await page.getByRole('button', { name: 'Concluir' }).first().click();
  await expect(page.getByText(name)).toHaveCount(0);
  await page.goto(`/leads/${lead.lead_id}`);
  await expect(page.getByText('Concluída', { exact: true })).toBeVisible();
  await expect(firstContact(page)).not.toHaveText('—');
  await page.goto('/dashboard?period=7d');
  await expect(page.getByRole('region', { name: 'Indicadores' }).getByText('Tempo até o 1º contato', { exact: true }).locator('..').locator('p').nth(1)).not.toHaveText('—');
});

test('cadastro manual, duplicidade, importação CSV (validar → importar) e exportação segura', async ({ browser }) => {
  const owner = await setupOwner(browser, 'imp');
  const { page } = owner;
  const tag = suffix();
  const email = `manual.${tag}@exemplo.test`;

  await page.goto('/leads/novo');
  await page.getByLabel('Nome', { exact: true }).fill(`Cliente Manual ${tag}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Cadastrar lead' }).click();
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: `Cliente Manual ${tag}` })).toBeVisible();

  // mesmo contato de novo: avisa em vez de duplicar
  await page.goto('/leads/novo');
  await page.getByLabel('Nome', { exact: true }).fill('Outro nome');
  await page.getByLabel('E-mail').fill(email.toUpperCase());
  await page.getByRole('button', { name: 'Cadastrar lead' }).click();
  await expect(page.getByText('Já existe um lead com este e-mail ou telefone.')).toBeVisible();

  // importação: 2 novos, 1 duplicado do manual, 1 sem contato
  const csv = ['nome;e-mail;telefone;empresa;origem', `Imp Um ${tag};imp1.${tag}@exemplo.test;;Empresa Um;evento`, `Imp Dois ${tag};;(21) 98888-7777;;evento`, `Duplicado;${email};;;`, 'Sem contato;;;;'].join('\n');
  await page.goto('/leads/importar');
  await page.setInputFiles('#file', { name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Enviar' }).click();
  const report = page.getByRole('region', { name: 'Relatório da importação' });
  await expect(report).toContainText('Prontos');
  await expect(report.locator('dd').nth(0)).toHaveText('2');
  await expect(report.locator('dd').nth(1)).toHaveText('1');
  await expect(report.locator('dd').nth(2)).toHaveText('1');
  await expect(page.getByText('Nada foi gravado.')).toBeVisible();
  // ainda não gravou
  await page.goto(`/leads?q=${encodeURIComponent(`Imp Um ${tag}`)}`);
  await expect(page.getByText('Nenhum lead encontrado')).toBeVisible();

  await page.goto('/leads/importar');
  await page.setInputFiles('#file', { name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByLabel(/Apenas validar/).uncheck();
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('2 lead(s) importado(s).')).toBeVisible();
  await page.goto(`/leads?q=${encodeURIComponent(`Imp Um ${tag}`)}`);
  await expect(page.getByRole('table', { name: 'Leads' })).toContainText(`Imp Um ${tag}`);

  // exportação CSV: BOM, cabeçalho em português e fórmula neutralizada
  await rpc(owner.token, 'lead_create', { p_org: owner.orgId, p_payload: { name: `=HYPERLINK("http://x")${tag}`, email: `formula.${tag}@exemplo.test` } });
  const res = await page.request.get('/export/leads');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['cache-control']).toContain('no-store');
  const body = await res.text();
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain('"Nome";"E-mail"');
  expect(body).toContain(`"'=HYPERLINK(""http://x"")${tag}"`);
  expect(body).not.toContain(`;=HYPERLINK`);
  void restJson;
});
