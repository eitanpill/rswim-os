/**
 * Lodging, end to end on fake data: the owner's morning (who leaves, who arrives, which room to make up between
 * them), finding free rooms for dates and booking one, and adding rooms of a kind. A freediving club's front desk
 * runs the same screens under /dive.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const SHOTS = process.env.RSWIM_SHOTS_DIR;
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!SHOTS) return;
  // A full-page shot repeats the sticky bar mid-page; let it scroll away.
  await page.addStyleTag({ content: 'header { position: static !important; }' });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

/** A local date `days` from today in Jerusalem, as the date inputs want it. */
function dayFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
}

test('the owner sees the morning, finds a free family room and books it', async ({ page }) => {
  const tag = randomUUID().slice(0, 4);
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/lodging');
  await expect(page.getByTestId('lodging-stats')).toBeVisible();
  // Family room 1 turns over: the Mizrahis leave and the Ben Davids arrive, so it is first to make up.
  await expect(page.getByTestId('lodging-prepare-room').first()).toContainText('משפחתי 1');
  await expect(page.getByTestId('lodging-departures')).toContainText('משפחת מזרחי');
  await expect(page.getByTestId('lodging-arrivals')).toContainText('משפחת בן דוד');
  await shot(page, 'today');

  await page.goto(`/admin/lodging/board?in=${dayFromNow(20)}&out=${dayFromNow(23)}&guests=4`);
  const option = page.getByTestId('find-option').filter({ hasText: 'משפחתי 1' });
  await expect(option).toBeVisible();
  await shot(page, 'board');
  await option.locator('summary').click();
  await option.locator('input[name="guestName"]').fill(`משפחת בדיקה ${tag}`);
  await option.getByRole('button', { name: 'להזמין' }).click();
  // Booked: the room is no longer offered for those nights, and the board shows the family on it.
  await expect(option).toHaveCount(0);
  await page.goto(`/admin/lodging/board?from=${dayFromNow(20)}`);
  await expect(
    page.getByTestId('board-stay').filter({ hasText: `משפחת בדיקה ${tag}` }),
  ).toBeVisible();

  await page.goto('/admin/lodging/rooms');
  const add = page.getByTestId('lodging-add');
  await add.locator('input[name="name"]').fill(`סוויטה ${tag}`);
  await add.locator('select[name="kind"]').selectOption('suite');
  await add.locator('input[name="count"]').fill('1');
  await add.locator('input[name="beds"]').fill('2');
  await add.locator('input[name="maxGuests"]').fill('3');
  await add.getByRole('button', { name: 'הוספת חדרים' }).click();
  await expect(page.getByTestId('lodging-room').filter({ hasText: `סוויטה ${tag}` })).toBeVisible();
  await shot(page, 'rooms');
});

test('the freediving club desk runs the same lodging', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/lodging');
  await expect(page.getByTestId('lodging-arrivals')).toContainText('משפחת חדד');
  await expect(page.getByTestId('lodging-departures')).toContainText('משפחת אדלר');
  await shot(page, 'dive-today');
});
