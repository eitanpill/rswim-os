/**
 * The club's rules in a screen (fake seed): the manager schedules a new version for a future date, so nothing in
 * today's demo changes; a bad pair of limits is refused on the field; the front desk cannot open the editor.
 */
import { expect, test } from '@playwright/test';

test('the manager schedules a new rules version from a future date', async ({ page }) => {
  await page.goto('/dev/login?as=diveManager');
  await page.getByTestId('edit-rules').click();
  await expect(page).toHaveURL(/\/dive\/rules$/);
  const form = page.getByTestId('rules-form');
  await expect(form.getByLabel('קורס')).toHaveValue(/\d+/);

  // Caution above the closing limit is refused on the field.
  await form.getByLabel('רוח: זהירות מעל (קשר)').fill('30');
  await form.getByLabel('בתוקף מתאריך').fill('2031-01-01');
  await form.getByRole('button', { name: 'שמירת החוקים' }).click();
  await expect(form.getByText('סף הזהירות גבוה מסף הסגירה')).toBeVisible();

  await form.getByLabel('רוח: זהירות מעל (קשר)').fill('12');
  await form.getByLabel('קורס').fill('3');
  await form.getByLabel('בתוקף מתאריך').fill('2031-01-01');
  await form.getByLabel('מה השתנה ולמה (לא חובה)').fill('יחס קורס מחמיר (בדיקה)');
  await form.getByRole('button', { name: 'שמירת החוקים' }).click();
  await expect(form.getByRole('status')).toContainText('החוקים נשמרו');
  const scheduled = page
    .getByTestId('rules-version')
    .filter({ hasText: 'יחס קורס מחמיר (בדיקה)' });
  await expect(scheduled).toContainText('מתוזמנת');
  await expect(page.getByTestId('rules-upcoming')).toBeVisible();
});

test('the front desk cannot open the rules editor', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/rules');
  await expect(page).toHaveURL(/\/dive\/office$/);
});
