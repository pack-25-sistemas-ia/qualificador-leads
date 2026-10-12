import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers';
import { DEMO_PASSWORD } from './lead-helpers';

// Telas em celular (390×844): a PÁGINA não pode rolar para o lado (o quadro do pipeline rola dentro do próprio contêiner).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const noHorizontalScroll = async (page: Page, where: string) => {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll, `${where}: a página rola para o lado (${w.scroll} > ${w.inner})`).toBeLessThanOrEqual(w.inner + 1);
};

test('páginas autenticadas cabem na tela do celular e o menu funciona', async ({ page }) => {
  await uiLogin(page, 'gerente@demo.exemplo', DEMO_PASSWORD);
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('Menu', { exact: true })).toBeVisible();
  for (const path of ['/dashboard?period=90d', '/leads', '/pipeline', '/formularios', '/qualificacao', '/distribuicao', '/atividades', '/campanhas?period=90d', '/relatorios?period=90d', '/leads/novo', '/leads/importar']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    await noHorizontalScroll(page, path);
  }
  // menu abre e navega
  await page.goto('/dashboard');
  await page.getByText('Menu', { exact: true }).click();
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Leads' }).click();
  await page.waitForURL('**/leads');
  // detalhe do lead no celular
  await page.getByRole('table', { name: 'Leads' }).getByRole('link').first().click();
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
  await noHorizontalScroll(page, 'detalhe do lead');
  // pipeline: o quadro rola dentro do contêiner; seletor «Mover para» é utilizável sem arrastar
  await page.goto('/pipeline');
  await expect(page.getByLabel('Quadro do pipeline (role para o lado)')).toBeVisible();
  await expect(page.getByLabel(/^Mover .* para$/).first()).toBeVisible();
});

test('formulário público no celular: multietapa, alvos de toque grandes e sem rolagem lateral', async ({ page }) => {
  await page.goto('/f/qualificacao-b2b');
  await noHorizontalScroll(page, 'formulário público');
  await expect(page.getByText('Etapa 1 de 3: Seus dados')).toBeVisible();
  const box = await page.getByRole('button', { name: 'Continuar' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  for (const label of ['Nome completo', 'E-mail profissional', 'Empresa']) {
    const b = await page.getByLabel(label).first().boundingBox();
    expect(b!.height, label).toBeGreaterThanOrEqual(40);
  }
  await page.getByLabel('Nome completo').fill('Teste Celular');
  await page.getByLabel('E-mail profissional').fill(`celular.${Date.now()}@exemplo.test`);
  await page.getByLabel('Empresa').fill('Empresa Teste');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Etapa 2 de 3: Sua empresa')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByLabel('Nome completo')).toHaveValue('Teste Celular');
  await noHorizontalScroll(page, 'formulário público (etapa 1 de volta)');
});
