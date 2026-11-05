/**
 * The business's own processor (docs/PAYMENTS.md), on a phone: the owner sees the connected processor with its keys
 * masked; a family sets up a standing order in one tap on the school's processor (a decline first, then approval);
 * and processor callbacks it did not sign, or for no connection, are refused. The processor runs as the demo processor (RSWIM_GROW_FAKE=1).
 * Every person, key and card is fake.
 */
import { expect, test } from '@playwright/test';

test('the owner sees the processor connected, with its secret key masked', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-payments').click();
  await expect(page).toHaveURL(/\/admin\/integrations\/payments$/);
  const status = page.getByTestId('payments-status');
  await expect(status).toContainText('Grow (Meshulam)');
  await expect(status).toContainText('מחובר');
  await expect(status).toContainText('••••7731');
  await expect(status).not.toContainText('demo-key-not-real-7731');
  // A callback to its address that the processor did not sign is refused.
  const hook = new URL((await page.getByTestId('payments-webhook').innerText()).trim());
  const forged = await page.request.post(hook.pathname, {
    data: { type: 'checkout.paid', amountAgorot: 100 },
  });
  expect(forged.status()).toBe(401);
  // Choosing another processor shows its own fields.
  await page.getByTestId('payments-provider-cardcom').click();
  await expect(page.getByTestId('payments-form').getByLabel('מספר מסוף')).toBeVisible();
});

test('a family sets up a standing order in one tap', async ({ page }) => {
  await page.goto('/dev/login?as=parent');
  await page.goto('/parent/payments');
  await page.getByTestId('family-mandate').click();
  await expect(page).toHaveURL(/\/pay\/[A-Za-z0-9_-]+\/sandbox\?m=standing_order/);
  // The processor declines first: nothing changes and the family can try again.
  await page.getByTestId('sandbox-decline').click();
  await expect(page.getByTestId('pay-failed')).toBeVisible();
  await page.getByTestId('pay-standing_order').click();
  await page.getByTestId('sandbox-approve').click();
  await expect(page.getByTestId('pay-paid')).toContainText('הוראת הקבע הוקמה');
  await expect(page.getByTestId('pay-paid')).toContainText('4242');
  await page.goto('/parent/payments');
  await expect(page.getByTestId('parent-balance')).toContainText('4242');
});

test('a callback for an unknown connection is refused', async ({ request }) => {
  const res = await request.post('/api/webhooks/pay/00000000-0000-4000-8000-000000000000', {
    data: { type: 'checkout.paid' },
  });
  expect(res.status()).toBe(404);
});
