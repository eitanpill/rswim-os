/**
 * SaaS stage 6 acceptance: the owner sees, on one screen, what the business is connected to and what is missing, with
 * this month's AI use against the plan's allowance; the plan page shows the allowance too. The freediving club's
 * owner has the same screen.
 */
import { expect, test } from '@playwright/test';

test('AC: the connections screen shows what is connected and the month of AI use', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-connections').click();
  await expect(page).toHaveURL(/\/admin\/connections$/);
  await expect(page.getByTestId('connection-payments')).toBeVisible();
  await expect(page.getByTestId('connection-receipts')).toHaveAttribute('data-state', 'soon');
  await expect(page.getByTestId('connection-bot')).toHaveAttribute('data-state', 'on');
  await expect(page.getByTestId('ai-meter')).toBeVisible();
  await expect(page.getByTestId('ai-meter-used')).toContainText('0 מתוך 3000 פעולות AI');
  await page.getByTestId('connection-payments-link').click();
  await expect(page).toHaveURL(/\/admin\/integrations\/payments$/);

  await page.goto('/admin/plan');
  await expect(page.getByTestId('ai-meter')).toBeVisible();
  await page.goto('/admin/brain');
  await expect(page.getByTestId('ai-meter')).toBeVisible();
});

test('AC: a freediving club owner opens the same screen', async ({ page }) => {
  await page.goto('/dev/login?as=diveOwner');
  await page.goto('/dive/owner');
  await page.getByTestId('to-connections').click();
  await expect(page.getByTestId('dive-connections')).toBeVisible();
  await expect(page.getByTestId('connection-payments-link')).toHaveAttribute(
    'href',
    '/dive/payments',
  );
  await expect(page.getByTestId('ai-meter')).toBeVisible();
});
