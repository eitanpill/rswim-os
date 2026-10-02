/**
 * Phase 4 acceptance, through the UI: the pre-run review shows each flag with its Hebrew reason (a charge without an
 * enrollment, an enrollment without a charge, a duplicate standing order); the declined card's family sits on the
 * debts dashboard with its collection case; the office records a payment on a family card; and a parent sees what
 * they owe. Every family, card and amount is fake (demo seed).
 */
import { expect, test } from '@playwright/test';

test('AC2: the October review flags all three problems, each with its reason', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/money/runs');
  await page
    .getByTestId('runs')
    .getByRole('link', { name: /10\/2026/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'חיוב 10/2026' })).toBeVisible();

  const flags = page.getByTestId('run-flags');
  const flag = (kind: string) => flags.locator(`[data-kind="${kind}"]`);
  await expect(flag('charge_without_enrollment').first()).toContainText('חיוב בלי רישום');
  await expect(flag('charge_without_enrollment').first()).toContainText(
    'הוראת קבע פעילה בלי אף מקום בקבוצה',
  );
  await expect(flag('enrollment_without_charge').first()).toContainText('רישום בלי חיוב');
  await expect(flag('enrollment_without_charge').first()).toContainText(
    'אין מחיר במחירון לתוכנית הזו',
  );
  await expect(flag('duplicate_mandate').first()).toContainText('הוראת קבע כפולה');
  await expect(flag('duplicate_mandate').first()).toContainText('2 הוראות קבע פעילות למשפחה אחת');
  await expect(page.getByRole('button', { name: 'לאשר ולגבות' })).toBeVisible();
  // Each family's lines are explained (proration, sibling discount) next to last month's total.
  await expect(page.getByTestId('run-family').first()).toContainText('בחודש הקודם');
});

test('AC3: the declined card shows on the debts dashboard with an open collection case', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/money');
  const row = page.getByTestId('debt-row').filter({ hasText: 'הוראת קבע נכשלה' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('תיק גבייה: פתוח');
});

test('the office records a cash payment on a family card and the balance drops', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/money');
  // A family that owes and has no standing order (it paid nothing in September).
  const row = page
    .getByTestId('debt-row')
    .filter({ hasText: 'אין הוראת קבע' })
    .filter({ hasNotText: 'תיק גבייה' })
    .first();
  await row.getByRole('link').click();
  const balance = page.getByTestId('family-balance');
  await expect(balance).toContainText('חייבים');
  const before = (await balance.textContent()) ?? '';

  await page.getByText('רישום תשלום', { exact: true }).click();
  const form = page.getByTestId('manual-payment');
  await form.getByLabel('אמצעי תשלום').selectOption({ label: 'מזומן' });
  await form.getByLabel('סכום (₪)').fill('50');
  await form.getByRole('button', { name: 'לרשום תשלום' }).click();
  await expect(form.getByRole('status')).toBeVisible();
  await expect(balance).not.toHaveText(before);
  await expect(page.getByTestId('family-payments')).toContainText('מזומן');
});

test('a parent sees their balance and history on the payments page', async ({ page }) => {
  await page.goto('/dev/login?as=parent');
  await page.goto('/parent/payments');
  await expect(page.getByRole('heading', { level: 1, name: 'תשלומים' })).toBeVisible();
  // The Cohens' standing order paid September (seed).
  await expect(page.getByTestId('parent-balance')).toContainText('הכול שולם');
  await expect(page.getByTestId('parent-balance')).toContainText('הוראת קבע: כרטיס');
  await expect(page.getByRole('heading', { name: 'תנועות' })).toBeVisible();
  await expect(page.getByText(/חיוב .* 09\/2026/).first()).toBeVisible();
});
