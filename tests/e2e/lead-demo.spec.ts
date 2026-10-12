import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers';
import { DEMO_PASSWORD, inDays, watchCsp } from './lead-helpers';

// Painel, relatórios e permissões com os DADOS DE DEMONSTRAÇÃO (seed determinístico: supabase/seed.sql). Valores conferidos contra o seed:
//   150 leads em 90 dias; 42 quentes (= 42 qualificados); 32 convertidos; 7 sem responsável; 10 follow-ups atrasados;
//   71 atribuídos a Camila (vendedor1) e 72 a Diego (vendedor2); 3 possíveis duplicados.
const PERIOD = () => `/dashboard?period=custom&from=${inDays(-120)}&to=${inDays(0)}`;
const card = (page: Page, label: string) => page.getByRole('region', { name: 'Indicadores' }).getByText(label, { exact: true }).locator('..');

async function login(page: Page, email: string) {
  await uiLogin(page, email, DEMO_PASSWORD);
  await page.waitForURL('**/dashboard');
}

test('gestor: indicadores batem com o seed, nove gráficos reais e alertas', async ({ page }) => {
  const violations = watchCsp(page);
  await login(page, 'gerente@demo.exemplo');
  await page.goto(PERIOD());
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(card(page, 'Leads capturados')).toContainText('150');
  await expect(card(page, 'Leads qualificados')).toContainText('42');
  await expect(card(page, 'Taxa de qualificação')).toContainText('28,00%');
  await expect(card(page, 'Taxa de qualificação')).toContainText('42 qualificado(s) ÷ 150 capturado(s)');
  await expect(card(page, 'Score médio')).toContainText('53,8');
  await expect(card(page, 'Leads quentes')).toContainText('42');
  await expect(card(page, 'Leads convertidos')).toContainText('32');
  await expect(card(page, 'Taxa de conversão')).toContainText('21,33%');
  await expect(card(page, 'Tempo até o 1º contato')).toContainText('11 h 47 min');
  await expect(card(page, 'Sem responsável')).toContainText('7');
  await expect(card(page, 'Follow-ups atrasados')).toContainText('10');
  // período anterior sem dados: a variação não é inventada
  await expect(page.getByText('vs período anterior')).toHaveCount(0);

  const titles = ['Leads capturados', 'Taxa de qualificação', 'Distribuição do score', 'Quentes, mornos e frios', 'Leads por origem', 'Qualidade por campanha', 'Funil do pipeline', 'Conversão por vendedor', 'Tempo até o primeiro contato'];
  for (const t of titles) await expect(page.getByRole('region', { name: t, exact: true })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  expect(await page.locator('.recharts-surface').count()).toBeGreaterThanOrEqual(8);

  // tabelas alternativas acessíveis, com os mesmos dados
  const funnel = page.getByRole('region', { name: 'Funil do pipeline' });
  await funnel.getByText('Ver dados em tabela').click();
  await expect(funnel.getByRole('row', { name: /Capturados/ })).toContainText('150');
  await expect(funnel.getByRole('row', { name: /Em atendimento/ })).toContainText('87');
  await expect(funnel.getByRole('row', { name: /Contatados/ })).toContainText('81');
  await expect(funnel.getByRole('row', { name: /Convertidos/ })).toContainText('32');
  const origin = page.getByRole('region', { name: 'Leads por origem' });
  await origin.getByText('Ver dados em tabela').click();
  await expect(origin.getByRole('row', { name: /google/ })).toContainText('50');
  const sellers = page.getByRole('region', { name: 'Conversão por vendedor' });
  await sellers.getByText('Ver dados em tabela').click();
  await expect(sellers.getByRole('table')).toContainText('Camila Vendas');
  await expect(sellers.getByRole('table')).toContainText('Diego Vendas');

  // alertas calculados do banco
  const alerts = page.getByRole('region', { name: 'Alertas' });
  await expect(alerts.getByRole('link', { name: 'Leads sem responsável' }).locator('..')).toContainText('7');
  await expect(alerts.getByRole('link', { name: 'Follow-ups atrasados' }).locator('..')).toContainText('10');
  await expect(alerts.getByRole('link', { name: /duplicados/ }).locator('..')).toContainText('3');
  expect(violations).toEqual([]);
});

test('filtros mudam os números; o período curto e o filtro por classe funcionam', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto(PERIOD());
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ label: 'Camila Vendas' });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await page.waitForURL(/seller=/);
  await expect(card(page, 'Leads capturados')).toContainText('71');
  const sellers = page.getByRole('region', { name: 'Conversão por vendedor' });
  await sellers.getByText('Ver dados em tabela').click();
  await expect(sellers.getByRole('table')).not.toContainText('Diego Vendas');

  await page.goto(`${PERIOD()}&class=hot`);
  await expect(card(page, 'Leads capturados')).toContainText('42');
  await expect(card(page, 'Taxa de qualificação')).toContainText('100,00%');
  // filtro de origem
  await page.goto(`${PERIOD()}&source=google`);
  await expect(card(page, 'Leads capturados')).toContainText('50');
  // período inválido cai no padrão de 30 dias sem erro
  await page.goto('/dashboard?period=custom&from=2026-99-99&to=lixo');
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(page.getByText('Ainda não há leads neste período').or(card(page, 'Leads capturados'))).toBeVisible();
});

test('vendedor vê só os dele e não alcança áreas de gestão; leitor só lê', async ({ page, browser }) => {
  await login(page, 'vendedor1@demo.exemplo');
  await expect(page.getByText('Você vê os números dos leads atribuídos a você.')).toBeVisible();
  await page.goto('/leads');
  await expect(page.getByText('71 registro(s)')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Distribuição' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Formulários' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Configurações comerciais' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Importar CSV' })).toHaveCount(0);
  expect((await page.goto('/distribuicao'))?.status()).toBe(404);
  expect((await page.goto('/configuracoes'))?.status()).toBe(404);
  expect((await page.goto('/formularios/novo'))?.status()).toBe(404);
  const exp = await page.request.get('/export/leads');
  expect(exp.status()).toBe(403);
  // pipeline: só os dele
  await page.goto('/pipeline');
  await expect(page.getByRole('region', { name: 'Coluna Novo' })).toBeVisible();

  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  await login(viewer, 'leitor@demo.exemplo');
  await viewer.goto('/leads');
  await expect(viewer.getByText('150 registro(s)')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Novo lead' })).toHaveCount(0);
  await viewer.goto('/pipeline');
  await expect(viewer.getByLabel(/^Mover .* para$/)).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /^Arrastar/ })).toHaveCount(0);
  expect((await viewer.goto('/formularios/novo'))?.status()).toBe(404);
  await viewer.goto('/formularios');
  await expect(viewer.getByRole('link', { name: 'Novo formulário' })).toHaveCount(0);
  await ctx.close();
});

test('lead quente: justificativa do score, respostas com rótulos e histórico', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/leads?class=hot&status=contacted');
  await page.getByRole('table', { name: 'Leads' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Por que esta nota?' })).toBeVisible();
  const why = page.getByRole('heading', { name: 'Por que esta nota?' }).locator('xpath=ancestor::section[1]');
  await expect(why).toContainText('/ 100');
  await expect(why).toContainText('Quente');
  await expect(why).toContainText('Modelo «Modelo de qualificação comercial» versão 1');
  await expect(why.locator('li').first()).toContainText(/\+\d+/);
  // respostas com os rótulos das perguntas (não as chaves)
  const answers = page.getByRole('heading', { name: 'Respostas do formulário' }).locator('xpath=ancestor::section[1]');
  await expect(answers).toContainText(/Nome completo|Faixa de valor|Quanto investe/);
  await expect(answers).not.toContainText('orcamento');
  await expect(page.getByRole('list', { name: 'Histórico do lead' })).toContainText('Entrou como Novo');
  // IA desabilitada: sem botão, com a explicação
  await expect(page.getByRole('button', { name: 'Gerar análise por IA' })).toHaveCount(0);
});

test('página pública da demonstração: disponível, indexação bloqueada, rascunho e inexistente iguais', async ({ page, request }) => {
  const violations = watchCsp(page);
  await page.goto('/f/qualificacao-b2b');
  await expect(page.getByRole('heading', { name: 'Qualificação B2B' })).toBeVisible();
  await expect(page.getByText('Etapa 1 de 3: Seus dados')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  const res = await request.get('/f/qualificacao-b2b');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res.headers()['x-frame-options']).toBe('DENY');
  // rascunho e inexistente: a mesma resposta (sem enumerar)
  const draft = await (await request.get('/f/diagnostico-empresarial')).text();
  const ghost = await (await request.get('/f/nao-existe-mesmo')).text();
  expect(draft).toContain('Formulário indisponível');
  expect(ghost).toContain('Formulário indisponível');
  // validação no navegador: etapa 1 sem preencher
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Campo obrigatório.').first()).toBeVisible();
  expect(violations).toEqual([]);
});
