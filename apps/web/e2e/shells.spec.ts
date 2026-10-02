/**
 * Phase 0 acceptance: three role-based shells render RTL on mobile.
 * Uses the local demo login (RSWIM_DEV_AUTH=1); every name shown is fake.
 */
import { expect, test, type Page } from '@playwright/test';

async function loginAs(page: Page, persona: string) {
  await page.goto(`/dev/login?as=${persona}`);
}

async function expectRtlMobileShell(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  // Nothing may overflow sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The bottom nav is visible, and its first item sits on the right (start side in RTL).
  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' }).last();
  await expect(nav).toBeVisible();
  const links = nav.getByRole('link');
  const first = await links.first().boundingBox();
  const last = await links.last().boundingBox();
  expect(first && last && first.x > last.x).toBe(true);
  // Tap targets are at least 44px tall.
  for (const box of [first, last]) expect(box!.height).toBeGreaterThanOrEqual(44);
}

test.describe('role shells on mobile', () => {
  test('owner sees the Hebrew Command Center', async ({ page }) => {
    await loginAs(page, 'owner');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1, name: 'מרכז הבקרה' })).toBeVisible();
    await expect(page.getByTestId('org-name')).toHaveText('R-SWIM (דמו)');
    await expect(page.getByRole('link', { name: 'משפחות' }).last()).toBeVisible();
    await expect(page.getByTestId('today-line')).toBeVisible();
    await expectRtlMobileShell(page);
    await expect(page).toHaveScreenshot('admin-mobile.png', {
      mask: [page.getByTestId('today-line')],
      fullPage: true,
    });
  });

  test('instructor sees "My day"', async ({ page }) => {
    await loginAs(page, 'instructor');
    await expect(page).toHaveURL(/\/instructor$/);
    await expect(page.getByRole('heading', { level: 1, name: 'היום שלי' })).toBeVisible();
    await expectRtlMobileShell(page);
    // The day's lessons and pending answers change with the date and the other tests: the screenshot covers the
    // shell (header and bottom nav) only.
    await expect(page).toHaveScreenshot('instructor-mobile.png', { mask: [page.locator('main')] });
  });

  test('parent sees their family portal', async ({ page }) => {
    await loginAs(page, 'parent');
    await expect(page).toHaveURL(/\/parent$/);
    await expect(page.getByRole('heading', { level: 1, name: 'המשפחה שלי' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'דיווח היעדרות' })).toBeVisible();
    await expectRtlMobileShell(page);
    await expect(page).toHaveScreenshot('parent-mobile.png', { fullPage: true });
  });

  test('bottom nav marks the current section', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'כספים' }).last().click();
    await expect(page).toHaveURL(/\/admin\/money$/);
    await expect(page.getByRole('heading', { level: 1, name: 'כספים' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'כספים' }).last()).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('המסך הזה ייבנה בשלב 4')).toBeVisible();
  });
});

test.describe('access guards', () => {
  test('anonymous users are sent to login, which is Hebrew RTL', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'כניסת צוות' })).toBeVisible();
    await expect(page.getByRole('link', { name: /כניסה עם מספר טלפון/ })).toBeVisible();
    await expect(page).toHaveScreenshot('login-mobile.png', { fullPage: true });
  });

  test('a parent cannot open the admin or instructor surfaces', async ({ page }) => {
    await loginAs(page, 'parent');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/parent$/);
    await page.goto('/instructor');
    await expect(page).toHaveURL(/\/parent$/);
  });

  test('an instructor cannot open admin, parent or accountant surfaces', async ({ page }) => {
    await loginAs(page, 'instructor');
    for (const path of ['/admin', '/parent', '/accountant']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/instructor$/);
    }
  });

  test('owners are kept out of the platform console', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/platform');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('signing out ends the session', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('button', { name: 'יציאה' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('locale', () => {
  test('switching to English flips the page to LTR', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Command center' })).toBeVisible();
    await page.getByRole('button', { name: 'עברית' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test('@desktop owner shell shows the side nav on the right', async ({ page }) => {
  await loginAs(page, 'owner');
  const side = page.getByRole('navigation', { name: 'ניווט ראשי' }).first();
  await expect(side).toBeVisible();
  const box = await side.boundingBox();
  expect(box!.x).toBeGreaterThan(600);
  await expect(page).toHaveScreenshot('admin-desktop.png', {
    mask: [page.getByTestId('today-line')],
  });
});
