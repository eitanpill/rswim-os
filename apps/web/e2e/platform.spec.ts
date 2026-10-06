/**
 * Phase 10 acceptance, through the UI (the worker's steps played by e2e/worker.ts): a newcomer opens "גלים (דמו)" on
 * the starter plan, installs the marketplace's regulations, catalog and messages, picks a brand colour and adds
 * galim.localhost, which the (fake) DNS check verifies so that galim.localhost/login wears the school's name and
 * colour. A second venue is refused with a Hebrew reason. The platform admin sees the school's usage, ends its
 * trial and runs billing: a declined standing order makes the school past due with a banner, and a good one pays the
 * invoice on the fake Grow. All data is fake.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { billSchoolNow, checkDomains, orgIdOf, resetNewcomer } from './worker';

const BASE = 'http://localhost:3100';
const DEV_COOKIE = 'rswim_dev_session';

async function open(scope: Page | Locator, summary: string) {
  const details = scope.locator('details').filter({ hasText: summary }).first();
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
}

test('a new school signs up, sets up from templates, gets its domain and is billed', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  page.on('dialog', (d) => void d.accept());
  await resetNewcomer();

  // Sign-up: a signed-in user with no school lands on the plans.
  await page.goto('/dev/login?as=newcomer');
  await expect(page).toHaveURL(/\/onboarding$/);
  const signup = page.getByTestId('create-school');
  await signup.getByLabel('שם בית הספר').fill('גלים (דמו)');
  await signup.getByLabel('מזהה קצר באנגלית').fill('galim');
  await signup.getByTestId('plan-starter').click();
  await signup.getByRole('button', { name: 'פתיחת בית הספר' }).click();
  await expect(page).toHaveURL(/\/admin\/onboarding$/);
  await expect(page.getByTestId('org-name')).toHaveText('גלים (דמו)');
  await expect(page.getByTestId('trial-banner')).toContainText('תקופת הניסיון פעילה');
  await expect(page.getByTestId('step-regulations')).toHaveAttribute('data-done', 'false');

  // Marketplace: regulations, the sample catalog and the message wording.
  await page.goto('/admin/templates');
  for (const kind of ['regulations', 'catalog', 'messages']) {
    const card = page.getByTestId(`template-${kind}`);
    await card.getByRole('button', { name: 'התקנה' }).click();
    await expect(card.getByTestId('installed')).toBeVisible();
  }
  await page.goto('/admin/onboarding');
  await expect(page.getByTestId('step-regulations')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('step-messages')).toHaveAttribute('data-done', 'true');

  // Brand and domain.
  await page.goto('/admin/branding');
  const brand = page.getByTestId('branding-form');
  await brand.getByLabel('שם תצוגה').fill('גלים');
  await brand.getByLabel('אלמוג').check();
  await brand.getByRole('button', { name: 'שמירה' }).click();
  await expect(brand.getByRole('status')).toBeVisible();
  const domainForm = page.getByTestId('domain-form');
  await domainForm.getByLabel('כתובת').fill('galim.localhost');
  await domainForm.getByRole('button', { name: 'הוספת דומיין' }).click();
  const domain = page.getByTestId('domain-galim.localhost');
  await expect(domain.getByTestId('domain-status')).toHaveText('ממתין לאימות');
  await expect(domain).toContainText('_rswim.galim.localhost');

  expect(await checkDomains('galim')).toEqual(['verified']);
  await page.reload();
  await expect(domain.getByTestId('domain-status')).toHaveText('מאומת');
  await expect(page.getByTestId('org-name')).toHaveText('גלים');

  // The school's own address: sign-in wears its name and colour.
  const visitor = await context.browser()!.newPage();
  await visitor.goto('http://galim.localhost:3100/login');
  await expect(visitor.getByTestId('login-brand')).toContainText('גלים');
  await expect(visitor.locator('main')).toHaveAttribute('data-brand', 'coral');
  await visitor.close();

  // The starter plan has one venue: the first is fine, the second is refused in Hebrew.
  for (const [name, ok] of [
    ['בריכת גלים', true],
    ['בריכה שנייה', false],
  ] as const) {
    await page.goto('/admin/venues/new');
    const form = page.getByTestId('venue-form');
    await form.getByLabel('שם המקום').fill(name);
    await form.getByRole('button', { name: 'שמירה' }).click();
    if (ok) await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    else await expect(form.getByRole('alert')).toContainText('בריכה אחת בלבד');
  }

  // The platform admin: usage, end of trial, a declined charge.
  await page.goto('/dev/login?as=platform');
  await expect(page).toHaveURL(/\/platform$/);
  const school = page.getByTestId('school-galim');
  await expect(school.getByTestId('school-usage')).toContainText('1 בריכות');
  await expect(school.getByTestId('school-status')).toHaveText('תקופת ניסיון');
  await open(school, 'ניהול');
  await school.getByRole('button', { name: 'סיום תקופת ניסיון' }).click();
  await expect(school.getByTestId('school-status')).toHaveText('פעיל');
  const mandate = school.getByTestId('mandate-form');
  await mandate.getByLabel('הוראת קבע (מזהה)').fill('fake-mandate-fail');
  await mandate.getByRole('button', { name: 'שמירת הוראת קבע' }).click();
  await expect(mandate.getByRole('status')).toBeVisible();
  const run = page.getByTestId('billing-run');
  await run.getByRole('button', { name: 'הפעלת חיוב' }).click();
  await expect(run.getByRole('status')).toContainText('לחיוב');

  expect(await billSchoolNow('galim')).toMatchObject({ billed: true, status: 'failed' });
  await page.reload();
  await expect(school.getByTestId('school-status')).toHaveText('תשלום בפיגור');

  // The school's office sees the banner.
  const orgId = await orgIdOf('galim');
  await context.addCookies([{ name: DEV_COOKIE, value: `newcomer@${orgId}`, url: BASE }]);
  await page.goto('/admin');
  await expect(page.getByTestId('past-due-banner')).toBeVisible();
  await page.goto('/admin/plan');
  await expect(page.getByTestId('plan-status')).toHaveText('תשלום בפיגור');
  await expect(page.getByTestId('platform-invoices')).toContainText('החיוב נכשל');

  // A good standing order: the invoice is charged on the fake and the school is active again.
  await context.addCookies([{ name: DEV_COOKIE, value: 'platform', url: BASE }]);
  await page.goto('/platform');
  await open(school, 'ניהול');
  await mandate.getByLabel('הוראת קבע (מזהה)').fill('fake-mandate-galim');
  await mandate.getByRole('button', { name: 'שמירת הוראת קבע' }).click();
  await expect(mandate.getByRole('status')).toBeVisible();
  expect(await billSchoolNow('galim')).toMatchObject({ billed: true, status: 'paid' });
  await page.reload();
  await expect(school.getByTestId('school-status')).toHaveText('פעיל');
  await expect(school.getByTestId('school-last-invoice')).toContainText('שולם');
});
