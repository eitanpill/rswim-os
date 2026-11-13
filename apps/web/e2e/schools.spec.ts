/**
 * One app for everyone (store launch, stage 3), on the fake seed: one sign-in screen sends each person to their
 * place; someone with two hats (an instructor at the demo school, a parent at the second one) switches between
 * them; someone with no place yet gets the front door. Every name is invented.
 */
import { expect, test } from '@playwright/test';

test('each kind of person lands in their own place from the same sign-in', async ({ page }) => {
  for (const [persona, path] of [
    ['owner', /\/admin$/],
    ['instructor', /\/instructor$/],
    ['parent', /\/parent$/],
    ['diveCustomer', /\/dive/],
    ['newcomer', /\/start$/],
  ] as const) {
    await page.goto(`/dev/login?as=${persona}`);
    await expect(page, persona).toHaveURL(path);
    // One school only: no switch button.
    await expect(page.getByTestId('switch-school'), persona).toHaveCount(0);
  }
});

test('a person with two hats switches between their schools', async ({ page }) => {
  await page.goto('/dev/login?as=twoHats');
  await expect(page).toHaveURL(/\/instructor$/);
  await expect(page.getByTestId('org-name')).toHaveText('R-SWIM (דמו)');

  await page.getByTestId('switch-school').click();
  await expect(page).toHaveURL(/\/me\/schools$/);
  const list = page.getByTestId('my-schools');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('את/ה כאן עכשיו');

  await list.getByRole('listitem').filter({ hasText: 'בריכת הדגמה' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByTestId('org-name')).toHaveText('בריכת הדגמה');

  // And back again.
  await page.getByTestId('switch-school').click();
  await page
    .getByTestId('my-schools')
    .getByRole('listitem')
    .filter({ hasText: 'R-SWIM (דמו)' })
    .getByRole('button')
    .click();
  await expect(page).toHaveURL(/\/instructor$/);
});

test('someone with no place yet opens the link their school sent', async ({ page }) => {
  await page.goto('/dev/login?as=newcomer');
  await expect(page).toHaveURL(/\/start$/);
  const form = page.getByTestId('school-link');
  await form.getByLabel('הקישור מבית הספר').fill('https://example.com/admin');
  await form.getByRole('button', { name: 'המשך' }).click();
  await expect(form).toContainText('זה לא נראה כמו קישור הצטרפות');

  await form.getByLabel('הקישור מבית הספר').fill('aqua-swim.co.il/join/eilat-deep-blue');
  await form.getByRole('button', { name: 'המשך' }).click();
  await expect(page).toHaveURL(/\/join\/eilat-deep-blue$/);
});
