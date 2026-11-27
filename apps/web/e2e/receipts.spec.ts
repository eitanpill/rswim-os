/**
 * The business's own receipts account (docs/payments/MORNING.md): the owner connects Morning with an API key, sees it
 * saved with its secret masked, and, while the live adapter is off (no RSWIM_MORNING_LIVE), sees that no receipt goes
 * through it yet. Every key is fake.
 */
import { expect, test } from '@playwright/test';

test('the owner connects Morning and the secret is never shown again', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-receipts').click();
  await expect(page).toHaveURL(/\/admin\/integrations\/receipts$/);
  // The school's processor (Grow) has no API for documents, so Morning is the only source offered.
  await expect(page.getByTestId('receipts-processor-none')).toContainText('Grow');
  await expect(page.getByTestId('receipts-use-processor')).toHaveCount(0);
  const form = page.getByTestId('receipts-form');
  await form.getByLabel('מזהה המפתח (API Key ID)').fill('e2e-key-id-not-real');
  await form.getByLabel('סוד המפתח (API Key Secret)').fill('e2e-secret-not-real-4417');
  await page.getByTestId('receipts-save').click();
  const status = page.getByTestId('receipts-status');
  await expect(status).toContainText('מורנינג (חשבונית ירוקה)');
  await expect(status).toContainText('••••4417');
  await expect(status).not.toContainText('e2e-secret-not-real-4417');
  await expect(page.getByTestId('receipts-error')).toContainText('החיבור החי למורנינג עוד לא נפתח');
});

test('a family member cannot open the receipts connection', async ({ page }) => {
  await page.goto('/dev/login?as=parent');
  await page.goto('/admin/integrations/receipts');
  await expect(page.getByTestId('receipts-form')).toHaveCount(0);
});
