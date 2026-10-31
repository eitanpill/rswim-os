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

test('the desk combines filters on its diver list', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/divers');
  const rows = page.getByTestId('diver-row');
  const all = await rows.count();
  expect(all).toBeGreaterThan(50);
  // A quick view, then one more filter from the full set: each narrows the list and shows as a removable chip.
  await page.getByTestId('quick-owes').click();
  await expect(page).toHaveURL(/balance=owes/);
  const owing = await rows.count();
  expect(owing).toBeLessThan(all);
  await expect(rows.first().getByText('חוב פתוח')).toBeVisible();
  await page.getByTestId('filter-upcoming').selectOption('booked');
  await expect(page).toHaveURL(/upcoming=booked/);
  await expect(page).toHaveURL(/balance=owes/);
  await expect(page.getByTestId('active-filters').getByRole('link')).toHaveCount(3);
  expect(await rows.count()).toBeLessThanOrEqual(owing);
  // Removing one keeps the other; clearing brings everyone back.
  await page.getByRole('link', { name: /הסרת הסינון תשלום/ }).click();
  await expect(page).not.toHaveURL(/balance=/);
  await expect(page).toHaveURL(/upcoming=booked/);
  await page.getByTestId('clear-filters').click();
  await expect(page).toHaveURL(/\/dive\/divers$/);
  await expect(rows).toHaveCount(all);
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
  // Training on her punch card is confirmed at once; nothing to pay.
  await page
    .getByTestId('bookable')
    .getByRole('button', { name: 'להירשם', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/dive\/me\?booked=1$/);
  await expect(next).toHaveCount(Math.min(booked + 1, 5));
  // A diver has no business on the staff screens.
  await page.goto('/dive/owner');
  await expect(page).toHaveURL(/\/dive\/me$/);
});

test('a booking counts only once the diver pays for it', async ({ page }) => {
  await page.goto('/dev/login?as=diveCustomer');
  await expect(page).toHaveURL(/\/dive\/me$/);
  // The workshop the office booked her into on WhatsApp still waits for her money.
  await expect(page.getByTestId('unpaid')).toBeVisible();
  await expect(page.getByTestId('my-next')).toContainText('ממתין לתשלום');
  await page.getByTestId('pay-link').first().click();
  await expect(page).toHaveURL(/\/dive\/me\/pay\//);
  await expect(page.getByTestId('checkout-amount')).toContainText('₪');
  await page.getByTestId('pay-now').click();
  await expect(page).toHaveURL(/\/dive\/me\?paid=/);
  await expect(page.getByTestId('paid-banner')).toContainText('ההרשמה אושרה');
  await expect(page.getByTestId('unpaid')).toHaveCount(0);
  await expect(page.getByTestId('my-next')).not.toContainText('ממתין לתשלום');
});

test('the desk takes payment and confirms the booking', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await expect(page).toHaveURL(/\/dive\/office$/);
  const settle = page.getByTestId('settle');
  const before = await settle.count();
  expect(before).toBeGreaterThan(0);
  const till = await page.getByTestId('till').innerText();
  await settle.first().getByTestId('settle-submit').click();
  await expect(settle).toHaveCount(before - 1);
  await expect(page.getByTestId('till')).not.toHaveText(till);
});

test('the desk decides what to charge: a pass given free, a booking collected at the club', async ({
  page,
}) => {
  await page.goto('/dev/login?as=diveOffice');
  await expect(page).toHaveURL(/\/dive\/office$/);
  const pass = page.getByTestId('sell-pass');
  await pass.getByLabel('תשלום', { exact: true }).selectOption('comp');
  await pass.getByRole('button', { name: 'הוספה לצולל' }).click();
  await expect(pass.getByRole('status')).toContainText('נוסף לצולל');
  await expect(page.getByTestId('till')).toBeVisible();
  const book = page.getByTestId('quick-book');
  await book.getByLabel('תשלום', { exact: true }).selectOption('collect');
  await book.getByRole('button', { name: 'לרשום' }).click();
  await expect(book.getByRole('status')).toContainText('נרשם');
});

test('a diver buys a pass online and it is active once paid', async ({ page }) => {
  await page.goto('/dev/login?as=diveCustomer');
  await expect(page).toHaveURL(/\/dive\/me$/);
  await page.getByTestId('buy-pass').locator('summary').click();
  await page.getByTestId('buy-punch5').click();
  await expect(page).toHaveURL(/\/dive\/me\/pay\/pass\/punch5$/);
  await expect(page.getByTestId('checkout-amount')).toContainText('₪');
  await page.getByTestId('buy-pass-now').click();
  await expect(page).toHaveURL(/\/dive\/me\?pass=1$/);
  await expect(page.getByTestId('paid-banner')).toContainText('הכרטיסייה פעילה');
  await expect(page.getByTestId('my-passes')).toContainText('כרטיסיית 5 אימונים');
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
