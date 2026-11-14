/**
 * Finding a school (store launch, stage 4), on the fake seed: the app's school search, a parent who asks to join and
 * the office that accepts, and a parent the school already knows by phone. Every name is invented.
 */
import { expect, test } from '@playwright/test';

test('anyone can search schools by name or city, before signing in', async ({ page }) => {
  await page.goto('/schools');
  const results = page.getByTestId('school-results');
  await expect(results).toContainText('R-SWIM (דמו)');
  await expect(results).toContainText('כחול עמוק אילת (דמו)');

  await page.getByLabel('שם או עיר').fill('אילת');
  await page.getByRole('button', { name: 'חיפוש' }).click();
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results).toContainText('מועדון צלילה חופשית · אילת');

  await page.getByLabel('שם או עיר').fill('אילת');
  await page.getByRole('radio', { name: 'בית ספר לשחייה' }).check();
  await page.getByRole('button', { name: 'חיפוש' }).click();
  await expect(page.getByTestId('school-none')).toBeVisible();

  // A swim school's page asks the visitor to sign in first.
  await page.goto('/join/rswim-demo');
  await expect(page.getByTestId('join-school')).toHaveText('R-SWIM (דמו)');
  await expect(page.getByTestId('join-sign-in')).toHaveAttribute(
    'href',
    '/login/phone?join=rswim-demo',
  );
});

test('a parent asks to join, the office accepts, and the parent enters the school', async ({
  page,
}) => {
  await page.goto('/dev/login?as=familyNewcomer');
  await expect(page).toHaveURL(/\/start$/);
  await page.getByTestId('start-search').click();
  await page.getByLabel('שם או עיר').fill('גוש עציון');
  await page.getByRole('button', { name: 'חיפוש' }).click();
  await page
    .getByTestId('school-results')
    .getByRole('link', { name: /R-SWIM/ })
    .click();
  await expect(page).toHaveURL(/\/join\/rswim-demo$/);

  const form = page.getByTestId('join-request');
  await form.getByText('להצטרף לקבוצה').click();
  await form.getByLabel('שם פרטי', { exact: true }).fill('דנה');
  await form.getByLabel('שם משפחה').fill('מחפשת');
  await form.getByLabel('טלפון').fill('050-0000205');
  await form.getByLabel('שם ילד/ה 1').fill('יובל');
  await form.getByLabel('תאריך לידה').first().fill('2019-03-10');
  await form.getByLabel('משהו שכדאי שנדע?').fill('מעדיפים ימי שלישי');
  await form.getByTestId('join-submit').click();
  await expect(page.getByRole('heading', { name: 'הבקשה נשלחה' })).toBeVisible();

  await page.goto('/start');
  await expect(page.getByTestId('my-requests')).toContainText('R-SWIM (דמו)');
  await expect(page.getByTestId('my-requests')).toContainText('מחכה למשרד');

  // The office.
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/join');
  const request = page.getByTestId('join-request').filter({ hasText: 'דנה מחפשת' });
  await expect(request).toContainText('יובל (2019)');
  await expect(request).toContainText('מעדיפים ימי שלישי');
  await request.getByTestId('accept').click();
  await expect(page.getByTestId('join-request').filter({ hasText: 'דנה מחפשת' })).toHaveCount(0);

  // Back to the parent: accepted, and one tap into the school.
  await page.goto('/dev/login?as=familyNewcomer');
  await expect(page.getByTestId('my-requests')).toContainText('אושרה');
  await page.getByTestId('my-requests').getByTestId('enter-school').click();
  await expect(page).toHaveURL(/\/parent$/);
});

test('a parent the school already has on file is found by phone', async ({ page }) => {
  await page.goto('/dev/login?as=knownParent');
  await expect(page).toHaveURL(/\/start$/);
  const match = page.getByTestId('phone-match');
  await expect(match).toContainText('מצאנו אותך בבריכת הדגמה');
  await match.getByRole('button', { name: 'כן, זה אני' }).click();
  await expect(page).toHaveURL(/\/parent$/);
});

test('the office shares its link and QR, and decides how it shows in the search', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-join').click();
  await expect(page).toHaveURL(/\/admin\/join$/);
  const link = page.getByTestId('join-link');
  await expect(link).toContainText('/join/rswim-demo');
  await expect(link.locator('svg')).toBeVisible();
  const listing = page.getByTestId('listing');
  await expect(listing.getByLabel('להופיע בחיפוש')).toBeChecked();
  await expect(listing.getByLabel('עיר')).toHaveValue('גוש עציון');
  await listing.getByRole('button', { name: 'שמירה' }).click();
  await expect(listing).toContainText('נשמר');
});
