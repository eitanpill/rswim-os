/**
 * SaaS stage 2: a visitor finds Aqua Swim on the platform's address, sees the prices, creates an owner account and
 * opens a business of either kind. Without Supabase (E2E) the account is a real auth.users row with a stand-in
 * session cookie; everything after it runs on the real code. All data is fake.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(page.getByTestId('landing-plan-starter')).toContainText('199');
  await page.getByTestId('landing-signup').click();
  await expect(page).toHaveURL(/\/signup$/);
  const form = page.getByTestId('signup');
  await form.getByLabel('שם מלא').fill(name);
  await form.getByLabel('אימייל').fill(email);
  await form.getByLabel('סיסמה').fill('fake-password-1');
  await form.getByTestId('signup-terms').check();
  await form.getByRole('button', { name: 'פתיחת חשבון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test('a visitor signs up and opens a swim school', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await signUp(page, 'דנה בדיקה', `dana-${stamp}@example.test`);
  const form = page.getByTestId('create-school');
  await form.getByLabel('שם העסק').fill('בריכת הדמו');
  await form.getByLabel('מזהה קצר באנגלית').fill(`swim-${stamp}`);
  await form.getByTestId('vertical-swim').click();
  await form.getByTestId('plan-growth').click();
  await form.getByRole('button', { name: 'פתיחת בית הספר' }).click();

  // The last step saves the card for after the trial on the processor's page (the demo one here), not charged now.
  await expect(page).toHaveURL(/\/billing\/card$/);
  await page.getByTestId('card-step-start').click();
  await expect(page.getByTestId('card-sandbox')).toBeVisible();
  await page.getByTestId('card-sandbox-approve').click();
  await expect(page.getByTestId('card-step-saved')).toContainText('4242');
  await page.getByTestId('card-step-continue').click();
  await expect(page).toHaveURL(/\/admin\/onboarding$/);
  await expect(page.getByTestId('org-name')).toHaveText('בריכת הדמו');
  await expect(page.getByTestId('trial-banner')).toBeVisible();
  await expect(page.getByTestId('trial-add-card')).toHaveCount(0);

  // The owner manages the subscription: another plan, a cancellation and taking it back.
  await page.goto('/admin/plan');
  await expect(page.getByTestId('card-status')).toContainText('4242');
  await page.getByTestId('change-plan-starter').click();
  await expect(page.getByTestId('change-plan-starter')).toHaveCount(0);
  await expect(page.getByTestId('change-plan-growth')).toBeVisible();
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId('cancel-subscription').click();
  await expect(page.getByTestId('cancel-scheduled')).toBeVisible();
  await page.getByTestId('keep-subscription').click();
  await expect(page.getByTestId('cancel-scheduled')).toHaveCount(0);
});

test('an owner who skipped the card step is reminded and can save it later', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await signUp(page, 'מאיה בדיקה', `maya-${stamp}@example.test`);
  const form = page.getByTestId('create-school');
  await form.getByLabel('שם העסק').fill('בריכת מאיה');
  await form.getByLabel('מזהה קצר באנגלית').fill(`maya-${stamp}`);
  await form.getByTestId('vertical-swim').click();
  await form.getByRole('button', { name: 'פתיחת בית הספר' }).click();
  await expect(page).toHaveURL(/\/billing\/card$/);
  await page.getByTestId('card-step-later').click();
  await expect(page).toHaveURL(/\/admin\/onboarding$/);
  await page.getByTestId('trial-add-card').click();
  await expect(page).toHaveURL(/\/billing\/card$/);
  await page.getByTestId('card-step-start').click();
  await page.getByTestId('card-sandbox-decline').click();
  await expect(page.getByTestId('card-step').getByRole('alert')).toBeVisible();
  await page.goto('/admin/plan');
  await page.getByTestId('card-start').click();
  await page.getByTestId('card-sandbox-approve').click();
  await expect(page.getByTestId('card-result')).toBeVisible();
  await expect(page.getByTestId('card-status')).toContainText('4242');
});

test('a visitor signs up and opens a freediving club', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await signUp(page, 'יואב בדיקה', `yoav-${stamp}@example.test`);
  const form = page.getByTestId('create-school');
  await form.getByLabel('שם העסק').fill('מועדון הדמו');
  await form.getByLabel('מזהה קצר באנגלית').fill(`dive-${stamp}`);
  await form.getByTestId('vertical-freediving').click();
  await form.getByRole('button', { name: 'פתיחת בית הספר' }).click();
  await expect(page).toHaveURL(/\/billing\/card$/);
  await page.getByTestId('card-step-later').click();
  await expect(page).toHaveURL(/\/dive/);
});

test('sign-up refuses a taken email and a missing consent', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `taken-${stamp}@example.test`;
  await signUp(page, 'רון בדיקה', email);
  await page.context().clearCookies();

  await page.goto('/signup');
  const form = page.getByTestId('signup');
  await form.getByLabel('שם מלא').fill('רון שני');
  await form.getByLabel('אימייל').fill(email);
  await form.getByLabel('סיסמה').fill('short');
  await form.getByRole('button', { name: 'פתיחת חשבון' }).click();
  await expect(form.getByTestId('signup-terms-error')).toBeVisible();
  await form.getByLabel('סיסמה').fill('fake-password-1');
  await form.getByTestId('signup-terms').check();
  await form.getByRole('button', { name: 'פתיחת חשבון' }).click();
  await expect(form).toContainText('כבר');
});

test('the sign-in page links owners to sign-up', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('signup-link').click();
  await expect(page).toHaveURL(/\/signup$/);
});
