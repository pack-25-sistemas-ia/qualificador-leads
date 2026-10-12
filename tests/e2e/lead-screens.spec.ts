import { test } from '@playwright/test';
import { uiLogin } from './helpers';
import { DEMO_PASSWORD } from './lead-helpers';

// Capturas para revisão visual (dados de demonstração). Saída: test-results/screens/ (não roda no CI: grep-invert "capturas")
const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, colorScheme: 'light' as const },
  { name: 'mobile', viewport: { width: 390, height: 844 }, colorScheme: 'light' as const },
  { name: 'dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const },
];

for (const v of VIEWS) {
  test(`capturas ${v.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const page = await ctx.newPage();
    const shot = async (n: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `test-results/screens/${v.name}-${n}.png`, fullPage: true });
    };
    await uiLogin(page, 'gerente@demo.exemplo', DEMO_PASSWORD);
    await page.waitForURL('**/dashboard');
    for (const [n, path] of [
      ['dashboard', '/dashboard?period=90d'], ['leads', '/leads'], ['pipeline', '/pipeline'], ['formularios', '/formularios'], ['atividades', '/atividades'],
      ['qualificacao', '/qualificacao'], ['distribuicao', '/distribuicao'], ['campanhas', '/campanhas?period=90d'], ['relatorios', '/relatorios?period=90d'], ['configuracoes-negado-gestor', '/dashboard'],
    ] as const) {
      await page.goto(path);
      await shot(n);
    }
    // detalhe de um lead quente
    await page.goto('/leads?class=hot&status=contacted');
    await page.getByRole('table', { name: 'Leads' }).getByRole('link').first().click();
    await shot('lead-detalhe');
    // editor de formulário
    await page.goto('/formularios');
    await page.getByRole('link', { name: 'Qualificação B2B' }).click();
    await shot('formulario-editor');
    // formulário público (etapas)
    const anon = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const pub = await anon.newPage();
    await pub.goto('/f/qualificacao-b2b');
    await pub.waitForTimeout(800);
    await pub.screenshot({ path: `test-results/screens/${v.name}-publico-1.png`, fullPage: true });
    await pub.getByLabel('Nome completo').fill('Maria Souza');
    await pub.getByLabel('E-mail profissional').fill('maria@exemplo.test');
    await pub.getByLabel('Empresa').fill('Empresa Exemplo');
    await pub.getByRole('button', { name: 'Continuar' }).click();
    await pub.waitForTimeout(500);
    await pub.screenshot({ path: `test-results/screens/${v.name}-publico-2.png`, fullPage: true });
    await anon.close();
    // administração (proprietário exige MFA; usa a captura do gestor para as telas de gestão acima)
    await ctx.close();
  });
}
