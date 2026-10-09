/**
 * The Eilat freediving club (fake seed): every role lands on its own screen and does its main taps. The swim school
 * and the club never see each other's screens. Every name is invented.
 */
import { expect, test } from '@playwright/test';

test('the owner reads the bridge', async ({ page }) => {
  await page.goto('/dev/login?as=diveOwner');
  await expect(page).toHaveURL(/\/dive\/owner$/);
  await expect(page.getByTestId('org-name')).toContainText('כחול עמוק אילת');
  await expect(page.getByTestId('sea-card')).toBeVisible();
  await expect(page.getByTestId('kpi-revenue')).toContainText('₪');
  await expect(page.getByTestId('insights')).toContainText('דחוף');
  await expect(
    page.getByTestId('revenue-chart').locator('svg[role="img"] path').first(),
  ).toBeVisible();
  await expect(page.getByTestId('club-records')).toBeVisible();
  // The owner can open every staff screen.
  for (const tab of ['חדר מבצעים', 'דלפק', 'במים', 'צוללים'])
    await expect(page.getByRole('link', { name: tab })).toBeVisible();
});

test('the manager posts a windy sea and the rules close it', async ({ page }) => {
  await page.goto('/dev/login?as=diveManager');
  await expect(page).toHaveURL(/\/dive\/manager$/);
  await expect(page.getByTestId('board-session').first()).toBeVisible();
  const form = page.getByTestId('sea-form');
  await form.getByLabel('רוח (קשר)').fill('25');
  await form.getByLabel('גלים (ס״מ)').fill('80');
  await form.getByLabel('ראות (מ׳)').fill('12');
  await form.getByLabel('טמפ׳ מים (°C)').fill('25');
  await form.getByRole('button', { name: 'לפרסם את מצב הים' }).click();
  await expect(form.getByRole('status')).toContainText('לא נכנסים לים');
  await expect(page.getByTestId('shell-call')).toContainText('לא נכנסים לים');
});

test('the front desk rents gear out and takes it back', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await expect(page).toHaveURL(/\/dive\/office$/);
  await expect(page.getByTestId('arrival').first()).toBeVisible();
  const rentals = page.getByTestId('rentals');
  const before = await rentals.getByRole('button', { name: 'הוחזר' }).count();
  await rentals.getByText('השכרת ציוד').click();
  await rentals.getByRole('button', { name: 'להשכיר' }).click();
  await expect(rentals.getByRole('status')).toContainText('הציוד יצא');
  await expect(rentals.getByRole('button', { name: 'הוחזר' })).toHaveCount(before + 1);
  await rentals.getByRole('button', { name: 'הוחזר' }).last().click();
  await expect(rentals.getByRole('button', { name: 'הוחזר' })).toHaveCount(before);
  await expect(page.getByTestId('leads').getByTestId('lead').first()).toBeVisible();
});

test('the instructor sees allowed depths and logs a dive', async ({ page }) => {
  await page.goto('/dev/login?as=diveInstructor');
  await expect(page).toHaveURL(/\/dive\/instructor$/);
  const diver = page.getByTestId('lineup-diver').first();
  await expect(diver).toContainText('מותר היום');
  await diver.getByText('תיעוד צלילה').click();
  await diver.getByLabel('עומק (מ׳)').fill('8');
  await diver.getByRole('button', { name: 'שמירה' }).click();
  await expect(diver.getByRole('status')).toContainText('הצלילה תועדה');
});

test('the diver sees her depth and books training', async ({ page }) => {
  await page.goto('/dev/login?as=diveCustomer');
  await expect(page).toHaveURL(/\/dive\/me$/);
  await expect(page.getByTestId('diver-banner')).toContainText('דנה');
  await expect(page.getByTestId('allowed-depth')).toContainText('27');
  await expect(page.getByTestId('my-passes')).toContainText('כרטיסיית 10 אימונים');
  await expect(page.getByTestId('depth-chart').locator('svg[role="img"]')).toBeVisible();
  const next = page.getByTestId('my-next').getByRole('button', { name: 'ביטול הרשמה' });
  const booked = await next.count();
  await page.getByTestId('bookable').getByTestId('book').first().click();
  await expect(next).toHaveCount(Math.min(booked + 1, 5));
  // A diver has no business on the staff screens.
  await page.goto('/dive/owner');
  await expect(page).toHaveURL(/\/dive\/me$/);
});

test('swim and dive stay apart, and the platform sees both', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/dive/owner');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/dive\/office$/);
  await page.goto('/dev/login?as=platform');
  await page.goto('/platform');
  const network = page.getByTestId('network');
  await expect(network.getByTestId('network-eilat-deep-blue')).toContainText('מועדון צלילה חופשית');
  await expect(network.getByTestId('network-rswim-demo')).toContainText('בית ספר לשחייה');
});
