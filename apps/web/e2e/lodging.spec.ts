/**
 * Lodging, end to end on fake data: the owner's morning (who leaves, who arrives, which room to make up between
 * them), finding free rooms for dates and booking one, and adding rooms of a kind. A freediving club's front desk
 * runs the same screens under /dive.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.RSWIM_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
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

test('the owner keeps a price list of seasons, weekends and holidays, and the board prices by it', async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 4);
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/lodging/prices');
  const rates = page.getByTestId('lodging-rate');
  await expect(rates.filter({ hasText: 'קיץ' })).toContainText('תוספת 20%');
  await expect(rates.filter({ hasText: 'חגים' })).toContainText('ערבי חג וחול המועד');
  // The holidays come from the Hebrew calendar, nobody types them.
  await expect(page.getByTestId('lodging-holidays').locator('li').first()).toBeVisible();

  const season = page.getByTestId('rate-add-season');
  await season.locator('input[name="name"]').fill(`חורף זול ${tag}`);
  await season.locator('input[name="startsOn"]').fill('2030-01-05');
  await season.locator('input[name="endsOn"]').fill('2030-01-20');
  await season.locator('input[name="yearly"]').uncheck();
  await season.locator('input[name="percent"]').fill('-10');
  await season.getByRole('button', { name: 'להוסיף למחירון' }).click();
  const mine = rates.filter({ hasText: `חורף זול ${tag}` });
  await expect(mine).toContainText('הנחה 10%');
  await shot(page, 'prices');

  // A week with a Thursday and a Friday: the weekend nights are dearer, and the board says so.
  await page.goto(`/admin/lodging/board?in=2030-01-06&out=2030-01-13&guests=2`);
  const option = page.getByTestId('find-option').filter({ hasText: 'משפחתי 2' });
  await option.locator('summary').click();
  await expect(option.getByTestId('find-price-lines')).toContainText('סוף שבוע: 2 לילות');
  await expect(option.getByTestId('find-price-lines')).toContainText(`חורף זול ${tag}: 7 לילות`);
  await shot(page, 'board-prices');

  await page.goto('/admin/lodging/prices');
  await mine.getByTestId('rate-remove').click();
  await expect(mine).toHaveCount(0);
});

test('the freediving club desk runs the same lodging', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/lodging');
  await expect(page.getByTestId('lodging-arrivals')).toContainText('משפחת חדד');
  await expect(page.getByTestId('lodging-departures')).toContainText('משפחת אדלר');
  await shot(page, 'dive-today');
  await page.goto('/dive/lodging/prices');
  await expect(page.getByTestId('lodging-rate').filter({ hasText: 'חורף באילת' })).toBeVisible();
});
