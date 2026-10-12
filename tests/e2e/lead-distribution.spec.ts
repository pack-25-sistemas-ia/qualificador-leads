import { expect, test } from '@playwright/test';
import { apiSignUp, uniqueEmail } from './helpers';
import { addMember, leadByEmail, publicSubmit, restJson, seedPublishedForm, setupOwner, suffix } from './lead-helpers';

// Distribuição: rodízio, manual com «distribuir pendentes» (idempotente), critérios com reserva e atribuição manual no lead.
test('distribuição: rodízio, fila manual, critérios com reserva e atribuição manual', async ({ browser }) => {
  const owner = await setupOwner(browser, 'dist');
  const { page } = owner;
  const emailA = uniqueEmail('dsa');
  const emailB = uniqueEmail('dsb');
  const [ua, ub] = await Promise.all([apiSignUp(emailA), apiSignUp(emailB)]);
  await addMember(owner, ua.id, 'member');
  await addMember(owner, ub.id, 'member');
  const labelA = emailA.split('@')[0]!;
  const labelB = emailB.split('@')[0]!;
  const slug = `e2e-dist-${suffix()}`;
  await seedPublishedForm(owner, slug);
  const answers = (n: string, prazo = 'mais_90') => ({ nome: `Lead ${n}`, email: `${n}.${suffix()}@exemplo.test`, orcamento: 1000, prazo });
  const submit = async (n: string, prazo?: string) => {
    const a = answers(n, prazo);
    const r = await publicSubmit(slug, a);
    expect(r.body.ok, JSON.stringify(r.body)).toBe(true);
    return (await leadByEmail(owner, a.email))[0]!;
  };

  // 1) estratégia manual (padrão): ninguém recebe sozinho
  const m1 = await submit('manual1');
  const m2 = await submit('manual2');
  expect(m1.assigned_to).toBeNull();
  expect(m2.assigned_to).toBeNull();

  // 2) escolhe rodízio pela interface e cadastra os vendedores
  await page.goto('/configuracoes');
  await page.getByLabel('Distribuição de novos leads').selectOption({ label: 'Rodízio entre vendedores ativos' });
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  await page.goto('/distribuicao');
  await expect(page.getByText('Estratégia atual: Rodízio entre vendedores ativos')).toBeVisible();
  for (const label of [labelA, labelB]) {
    await page.getByLabel('Adicionar ao rodízio').selectOption({ label });
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.locator('li').filter({ hasText: label }).filter({ hasText: 'No rodízio' })).toBeVisible();
  }

  // 3) leads novos alternam entre os dois
  const r1 = await submit('rr1');
  const r2 = await submit('rr2');
  const r3 = await submit('rr3');
  const r4 = await submit('rr4');
  const owners = [r1, r2, r3, r4].map((l) => l.assigned_to);
  expect(owners.every(Boolean)).toBe(true);
  expect(new Set(owners).size).toBe(2);
  expect(owners[0]).toBe(owners[2]);
  expect(owners[1]).toBe(owners[3]);
  expect(owners[0]).not.toBe(owners[1]);

  // 4) os dois leads que ficaram na fila são distribuídos de uma vez (e só uma vez)
  await page.goto('/distribuicao');
  await expect(page.getByText('Leads em aberto sem responsável.').locator('xpath=following-sibling::div[1]//p[1]')).toHaveText('2');
  await page.getByRole('button', { name: 'Distribuir leads sem responsável' }).click();
  await expect(page.getByText('2 lead(s) distribuído(s).')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Nenhum lead aguardando.')).toBeVisible();
  const afterManual = await restJson<Array<{ assigned_to: string | null }>>(owner.token, 'leads?select=assigned_to&name=like.Lead manual*');
  expect(afterManual.every((l) => l.assigned_to !== null)).toBe(true);

  // 5) critério: «prazo é igual a ate_30» vai para o vendedor A; o resto cai no rodízio
  await page.getByLabel('Nome da regra').fill('Urgentes para o A');
  await page.getByLabel('Chave da pergunta').fill('prazo');
  await page.getByLabel('Valor', { exact: true }).fill('ate_30');
  await page.getByLabel('Atribuir a').selectOption({ label: labelA });
  await page.getByRole('button', { name: 'Adicionar regra' }).click();
  await expect(page.getByText('Urgentes para o A').first()).toBeVisible();
  await page.goto('/configuracoes');
  await page.getByLabel('Distribuição de novos leads').selectOption({ label: 'Por critérios (com rodízio como reserva)' });
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  const urgent = await submit('urgente', 'ate_30');
  const calm = await submit('calmo', 'mais_90');
  expect(urgent.assigned_to).toBe(ua.id);
  expect(calm.assigned_to).not.toBeNull();

  // 6) atribuição manual no lead (gestão) para o OUTRO vendedor, com histórico
  const target = calm.assigned_to === ub.id ? { id: ua.id, label: labelA } : { id: ub.id, label: labelB };
  await page.goto(`/leads/${calm.id}`);
  await page.getByLabel('Responsável', { exact: true }).selectOption({ label: target.label });
  await page.getByRole('button', { name: 'Atribuir', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Histórico do lead' })).toContainText(`Atribuído a ${target.label} (manual)`);
  const now = await restJson<Array<{ assigned_to: string }>>(owner.token, `leads?select=assigned_to&id=eq.${calm.id}`);
  expect(now[0]!.assigned_to).toBe(target.id);
});
