import { expect, test } from '@playwright/test';
import { leadByEmail, setupOwner, suffix, watchCsp } from './lead-helpers';

// Fluxo completo pela interface: construtor de formulários (modelo, condicional, prévia, publicação), modelo de score,
// captação pública multietapa (UTM, consentimento, duplicidade, honeypot) e o lead pontuado e explicado.
test('do construtor ao lead pontuado: formulário, score, captação pública, duplicidade e honeypot', async ({ browser }) => {
  const owner = await setupOwner(browser, 'flow');
  const { page } = owner;
  const violations = watchCsp(page);
  const slug = `e2e-imovel-${suffix()}`;

  // ---- 1. cria o formulário a partir do modelo «Imobiliária»
  await page.goto('/formularios/novo');
  await page.getByLabel('Começar de').selectOption({ label: 'Imobiliária' });
  await page.getByLabel('Nome do formulário').fill(`Busca de imóvel ${slug}`);
  await page.getByLabel('Link público').fill(slug);
  await page.getByRole('button', { name: 'Criar formulário' }).click();
  await page.waitForURL(/\/formularios\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();

  // perguntas do modelo e a condicional já marcada
  const list = page.getByRole('list', { name: 'Perguntas do formulário' });
  const item = (label: string) => list.locator('li', { hasText: label });
  const pick = (label: string) => list.getByRole('button', { name: new RegExp(`^\\d+\\. ${label}`) });
  await expect(item('Quanto tem para a entrada')).toContainText('Condicional');
  await expect(item('E-mail profissional')).toContainText('Obrigatória');

  // ---- 2. edita uma pergunta e acrescenta outra
  await pick('Quero agendar uma visita').click();
  await page.getByLabel('Pergunta (rótulo)').fill('Quero visitar o imóvel');
  await expect(page.getByText('Alterações não salvas')).toBeVisible();
  await page.getByLabel('Tipo da nova pergunta').selectOption({ label: 'Texto curto' });
  await page.getByRole('button', { name: '+ Adicionar pergunta' }).click();
  await page.getByLabel('Pergunta (rótulo)').fill('Bairro de interesse');
  await expect(item('Bairro de interesse')).toBeVisible();

  // ---- 3. prévia: a pergunta condicional só aparece depois do «sim»
  const preview = page.locator('form[aria-label="Formulário"]');
  await preview.getByLabel('Nome completo').fill('Teste');
  await preview.getByLabel('E-mail profissional').fill('teste@exemplo.test');
  await preview.getByRole('button', { name: 'Continuar' }).click();
  await expect(preview.getByLabel('Quanto tem para a entrada')).toHaveCount(0);
  await preview.getByLabel('Vou precisar de financiamento').check();
  await expect(preview.getByLabel('Quanto tem para a entrada')).toBeVisible();

  // ---- 4. link público: só https como redirecionamento
  await page.getByLabel('Redirecionar depois do envio').fill('http://inseguro.exemplo');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Use um endereço https:// completo.')).toBeVisible();
  await page.getByLabel('Redirecionar depois do envio').fill('');

  // ---- 5. salva e publica
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText(/Versão 1 publicada/)).toBeVisible();
  await expect(page.getByText('Publicado', { exact: true }).first()).toBeVisible();

  // ---- 6. modelo de score: cria, importa as regras sugeridas, simula e publica
  await page.goto('/qualificacao');
  await page.getByRole('button', { name: 'Criar o primeiro modelo' }).click();
  await expect(page.getByRole('heading', { name: /Rascunho \(v1\)/ })).toBeVisible();
  await page.getByLabel('Importar regras sugeridas de').selectOption({ label: 'Imobiliária' });
  await page.getByRole('button', { name: 'Adicionar ao rascunho' }).click();
  await expect(page.getByText('Quer fechar em até 30 dias').first()).toBeVisible();
  // simulador: 100 pontos com as respostas «ideais»
  const sim = page.getByRole('heading', { name: 'Simulador' }).locator('xpath=ancestor::section[1]');
  await sim.getByLabel('Em quanto tempo quer fechar?').selectOption({ label: 'Em até 30 dias' });
  await sim.getByLabel('Faixa de valor').selectOption({ label: 'Acima de R$ 1,5 milhão' });
  await sim.getByLabel('Vou precisar de financiamento').check();
  await sim.getByLabel('Quanto tem para a entrada').fill('250000');
  await sim.getByLabel('Quero visitar o imóvel').check();
  await sim.getByLabel('Telefone / WhatsApp').fill('(21) 99876-5432');
  await sim.getByRole('button', { name: 'Simular score' }).click();
  await expect(sim.getByRole('status')).toContainText('100');
  await expect(sim.getByRole('status')).toContainText('Quente');
  await page.getByRole('button', { name: 'Publicar este modelo' }).click();
  await expect(page.getByText('Modelo em uso')).toBeVisible();
  await expect(page.getByText('Publicado', { exact: true }).first()).toBeVisible();

  // ---- 7. visitante anônimo preenche o formulário público (multietapa)
  const email = `maria.${suffix()}@exemplo.test`;
  const fill = async (anon: import('@playwright/test').Page, mail: string, honeypot = false) => {
    await anon.goto(`/f/${slug}?utm_source=google&utm_medium=cpc&utm_campaign=Verao%202027`);
    await expect(anon.getByText('Etapa 1 de 2')).toBeVisible();
    await anon.getByLabel('Nome completo').fill('Maria Souza');
    await anon.getByLabel('E-mail profissional').fill(mail);
    await anon.getByLabel('Telefone / WhatsApp').fill('(21) 99876-5432');
    await anon.getByRole('button', { name: 'Continuar' }).click();
    await expect(anon.getByText('Etapa 2 de 2')).toBeVisible();
    await anon.getByLabel('Comprar', { exact: true }).check();
    await anon.getByLabel('Apartamento').check();
    await anon.getByLabel('Faixa de valor').selectOption({ label: 'Acima de R$ 1,5 milhão' });
    await anon.getByLabel('Em quanto tempo quer fechar?').selectOption({ label: 'Em até 30 dias' });
    await anon.getByLabel('Vou precisar de financiamento').check();
    await anon.getByLabel('Quanto tem para a entrada').fill('250000');
    await anon.getByLabel('Quero visitar o imóvel').check();
    if (honeypot) await anon.locator('input[name="website"]').fill('http://spam.exemplo', { force: true });
    await anon.waitForTimeout(1000); // tempo mínimo humano
    // sem consentimento: não envia
    await anon.getByRole('button', { name: 'Enviar' }).click();
    await expect(anon.getByText('É necessário concordar para enviar.')).toBeVisible();
    await anon.getByLabel(/Concordo em compartilhar/).check();
    await anon.getByRole('button', { name: 'Enviar' }).click();
    await expect(anon.getByText('Recebemos suas informações.')).toBeVisible();
  };
  const ctxA = await browser.newContext();
  const anon = await ctxA.newPage();
  const anonViolations = watchCsp(anon);
  await expect(async () => { await fill(anon, email); }).toPass({ timeout: 30_000 });

  // ---- 8. o lead existe, pontuado, com origem e justificativa
  const rows = await leadByEmail(owner, email);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.current_score).toBe(100);
  expect(rows[0]!.qualification).toBe('hot');
  await page.goto(`/leads/${rows[0]!.id}`);
  await expect(page.getByRole('heading', { name: 'Maria Souza' })).toBeVisible();
  const why = page.getByRole('heading', { name: 'Por que esta nota?' }).locator('xpath=ancestor::section[1]');
  await expect(why).toContainText('100');
  await expect(why).toContainText('Quer fechar em até 30 dias');
  await expect(why).toContainText('+30');
  await expect(page.getByText('UTM: google · cpc · Verao 2027')).toBeVisible();
  await expect(page.getByText('consentimento registrado')).toBeVisible();

  // ---- 9. o mesmo contato envia de novo: continua um só lead (política «ligar à pessoa existente»)
  const ctxB = await browser.newContext();
  const anon2 = await ctxB.newPage();
  await expect(async () => { await fill(anon2, email.toUpperCase()); }).toPass({ timeout: 30_000 });
  expect(await leadByEmail(owner, email)).toHaveLength(1);
  const subs = await (await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/form_submissions?select=id&lead_id=eq.${rows[0]!.id}`, { headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${owner.token}` } })).json() as unknown[];
  expect(subs.length).toBe(2);

  // ---- 10. robô (honeypot preenchido): a tela diz «ok», mas nada é gravado
  const bot = `robo.${suffix()}@exemplo.test`;
  const ctxC = await browser.newContext();
  const anon3 = await ctxC.newPage();
  await expect(async () => { await fill(anon3, bot, true); }).toPass({ timeout: 30_000 });
  expect(await leadByEmail(owner, bot)).toHaveLength(0);

  // ---- 11. a campanha nasceu do utm_campaign
  await page.goto('/campanhas?period=90d');
  await expect(page.getByRole('table', { name: 'Campanhas' })).toContainText('Verao 2027');
  expect(violations).toEqual([]);
  expect(anonViolations).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
  void editorUrl;
});
