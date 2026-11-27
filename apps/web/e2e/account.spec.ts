/**
 * Deleting your own account from inside the app (store launch, stage 8), on the fake seed. Every name is invented.
 */
import { expect, test } from '@playwright/test';

test('a parent deletes their account from the app', async ({ page }) => {
  await page.goto('/dev/login?as=leaver');
  await expect(page).toHaveURL(/\/parent$/);
  await page.getByTestId('my-account').click();
  await expect(page).toHaveURL(/\/me\/account$/);

  const card = page.getByTestId('delete-account');
  await expect(card).toContainText('תיק המשפחה, השיעורים, התשלומים והקבלות');
  await card.getByLabel('כדי לאשר').fill('כן');
  await card.getByTestId('delete-submit').click();
  await expect(card).toContainText('צריך להקליד בדיוק את המילה שלמעלה');

  await card.getByLabel('כדי לאשר').fill('מחיקה');
  await card.getByTestId('delete-submit').click();
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByTestId('goodbye')).toBeVisible();
  // Signed out.
  await page.goto('/parent');
  await expect(page).toHaveURL(/\/login/);
});

test("the only owner of a school can't delete the account before handing it over", async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.getByTestId('my-account').click();
  await expect(page.getByTestId('sole-owner')).toContainText('R-SWIM (דמו)');
  await expect(page.getByTestId('delete-submit')).toHaveCount(0);
});

// "My account" sits outside every role's own nav, so it must lead back home, not only to signing out.
for (const [as, home] of [
  ['owner', /\/admin$/],
  ['parent', /\/parent$/],
  ['instructor', /\/instructor$/],
  ['diveCustomer', /\/dive\/me$|\/dive$/],
] as const) {
  test(`${as} leaves "my account" back to the main screen`, async ({ page }) => {
    await page.goto(`/dev/login?as=${as}`);
    await page.goto('/me/account');
    await page.getByTestId('back-home').click();
    await expect(page).toHaveURL(home);
    // The school's mark in the top bar leads home too.
    await page.goto('/me/account');
    await page.getByTestId('home-mark').click();
    await expect(page).toHaveURL(home);
  });
}
