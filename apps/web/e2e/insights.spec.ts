/**
 * The owner's insights feed on the command center: a check finds the demo's children who keep missing lessons, each
 * insight says what to do and links to its screen, and "handled" sets it aside. Advisory only; every name is fake.
 */
import { expect, test } from '@playwright/test';

test('the owner checks for insights, reads one and sets it aside', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await expect(page).toHaveURL(/\/admin$/);
  const feed = page.getByTestId('insights');
  await expect(feed).toContainText('המלצות בלבד');

  await feed.getByTestId('insights-refresh').click();
  const churn = feed.locator('[data-testid="insight"][data-kind="churn_risk"]');
  await expect(churn).toBeVisible();
  await expect(churn).toContainText('בסיכון עזיבה');
  await expect(churn).toContainText('מה לעשות');
  await churn.getByText('פירוט').click();
  await expect(churn).toContainText('היעדרויות ברצף');
  await expect(churn.getByRole('link', { name: 'פתיחה' })).toHaveAttribute(
    'href',
    '/admin/families',
  );

  await churn.getByTestId('insight-dismiss').click();
  await expect(churn).toHaveCount(0);
  await expect(page.getByTestId('home-money')).toBeVisible();
  await expect(page.getByTestId('home-growth')).toBeVisible();
});
