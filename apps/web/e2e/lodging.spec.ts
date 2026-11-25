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

test('a held booking asks for a deposit, the guest pays the link, and the desk takes the rest', async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 4);
  const guest = `משפחת מקדמה ${tag}`;
  await page.goto('/dev/login?as=owner');
  await page.goto(`/admin/lodging/board?in=${dayFromNow(40)}&out=${dayFromNow(42)}&guests=2`);
  const option = page.getByTestId('find-option').first();
  await option.locator('summary').click();
  await option.locator('input[name="guestName"]').fill(guest);
  await option.locator('input[name="phone"]').fill('050-0000404');
  await option.locator('input[name="hold"]').check();
  await option.getByRole('button', { name: 'להזמין' }).click();
  await expect(page.getByText('ההזמנה נשמרה')).toBeVisible();

  await page.goto(`/admin/lodging/board?from=${dayFromNow(40)}`);
  const href = await page
    .getByTestId('board-stay')
    .filter({ hasText: guest })
    .first()
    .getAttribute('href');
  expect(href).toMatch(/^\/admin\/lodging\/stays\//);
  const stayUrl = href as string;
  await page.goto(stayUrl);
  const money = page.getByTestId('lodging-money');
  await expect(money.getByTestId('money-deposit')).toContainText('חסרה מקדמה');
  await expect(money.getByTestId('money-hold')).toContainText('מוחזק עד');
  await money.locator('input[name="send"]').check();
  await money.getByTestId('money-link-deposit').click();
  await expect(money.getByTestId('money-link')).toBeVisible();
  await shot(page, 'stay-deposit');

  // The guest's side: the business's processor (sandboxed here) takes the card, and its callback records it.
  await money.getByTestId('money-link').click();
  await expect(page.getByTestId('pay-amount')).toContainText('₪');
  await page.getByTestId('pay-card').click();
  await expect(page).toHaveURL(/\/sandbox\?m=card/);
  await page.getByTestId('sandbox-approve').click();
  await expect(page.getByTestId('pay-paid')).toBeVisible();
  await page.goto(stayUrl);
  await expect(page.getByTestId('lodging-stay')).toContainText('מאושר');
  await expect(money.getByTestId('money-deposit')).toContainText('המקדמה התקבלה');
  await expect(money.getByTestId('money-payments')).toContainText('בקישור לתשלום');

  // The rest at the desk, in cash: nothing is left to pay.
  const record = money.getByTestId('money-record');
  await record.locator('select[name="method"]').selectOption('cash');
  await record.getByRole('button', { name: 'לרשום' }).click();
  await expect(money.getByTestId('money-due')).toHaveText(/נשאר לשלם\W*0\W*₪/);
  await shot(page, 'stay-paid');
});

test('the owner closes a room for repair and opens it again, and sets what the guests hear the day before', async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 4);
  const reason = `צביעה ${tag}`;
  await page.goto('/dev/login?as=owner');
  await page.goto(`/admin/lodging/board?from=${dayFromNow(60)}`);
  const block = page.getByTestId('lodging-block');
  await block.locator('summary').click();
  await block.locator('select[name="target"]').selectOption({ label: 'זוגי 2' });
  await block.locator('input[name="reason"]').fill(reason);
  await block.locator('input[name="from"]').fill(dayFromNow(61));
  await block.locator('input[name="to"]').fill(dayFromNow(64));
  await block.getByRole('button', { name: 'לחסום' }).click();
  await expect(page.getByText('החדר נחסם בתאריכים האלה')).toBeVisible();
  const closed = page.getByTestId('board-block').filter({ hasText: reason });
  await expect(closed).toBeVisible();
  await shot(page, 'board-block');

  // Nobody can book it on those nights.
  await page.goto(`/admin/lodging/board?in=${dayFromNow(62)}&out=${dayFromNow(63)}&guests=2`);
  await expect(page.getByTestId('find-options')).toBeVisible();
  await expect(page.getByTestId('find-option').filter({ hasText: 'זוגי 2' })).toHaveCount(0);
  await expect(page.getByTestId('find-option').filter({ hasText: 'זוגי 1' })).toHaveCount(1);

  // Its page: the reason, the dates, and one way out.
  await page.goto(`/admin/lodging/board?from=${dayFromNow(60)}`);
  const href = await closed.first().getAttribute('href');
  await page.goto(href as string);
  const card = page.getByTestId('lodging-stay-block');
  await expect(card).toContainText(reason);
  await expect(page.getByTestId('lodging-money')).toHaveCount(0);
  await shot(page, 'stay-block');
  await card.getByTestId('block-remove').click();
  await expect(card.getByTestId('block-remove')).toHaveCount(0);
  await page.goto(`/admin/lodging/board?from=${dayFromNow(60)}`);
  await expect(page.getByTestId('board-block').filter({ hasText: reason })).toHaveCount(0);

  // The day-before reminder and how to get here.
  await page.goto('/admin/lodging/rooms');
  const settings = page.getByTestId('lodging-settings-form');
  await expect(settings.locator('input[name="guestReminder"]')).toBeChecked();
  await settings.locator('textarea[name="arrivalNote"]').fill(`החניה ליד הבריכה, קוד לשער ${tag}`);
  await settings.getByRole('button', { name: 'הגדרות לינה' }).click();
  await page.reload();
  await expect(settings.locator('textarea[name="arrivalNote"]')).toHaveValue(
    `החניה ליד הבריכה, קוד לשער ${tag}`,
  );
  await shot(page, 'rooms-reminder');
  await page.goto('/admin/lodging');
  await expect(page.getByTestId('lodging-reminder-note')).toContainText('17:00');
});

test('a room the WhatsApp bot chose for a new customer waits on the brain, and the owner holds it', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/brain');
  await expect(page.getByTestId('brain-level-book_lodging')).toBeVisible();
  const waiting = page.getByTestId('brain-waiting');
  await expect(waiting).toContainText('להחזיק למשפחת רוזן את משפחתי 3');
  await shot(page, 'brain-lodging');
  const action = page.locator('[data-testid="agent-action"][data-kind="book_lodging"]').first();
  await action.getByTestId('agent-approve').click();
  await expect(waiting).not.toContainText('להחזיק למשפחת רוזן');
  await page.goto('/admin/brain/journal');
  await expect(
    page
      .locator('[data-testid="agent-action"][data-kind="book_lodging"][data-status="confirmed"]')
      .first(),
  ).toBeVisible();
  await page.goto(`/admin/lodging/board?from=${dayFromNow(28)}`);
  await expect(page.getByTestId('board-stay').filter({ hasText: 'משפחת רוזן' })).toBeVisible();
});

test('a guest pays the rest at the desk on arrival: the desk sees what to collect, and the deposit still goes ahead', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/lodging');
  // The Ben Davids paid their deposit and pay the rest at the desk; the Golans owe it all.
  const benDavid = page.getByTestId('lodging-arrival').filter({ hasText: 'משפחת בן דוד' });
  await expect(benDavid.getByTestId('lodging-collect')).toContainText('משלם בהגעה: לגבות');
  await expect(
    page
      .getByTestId('lodging-arrival')
      .filter({ hasText: 'משפחת גולן' })
      .getByTestId('lodging-collect'),
  ).toContainText('לגבות');
  await shot(page, 'today-collect');

  await benDavid.getByRole('link').click();
  const desk = page.getByTestId('money-at-arrival');
  await expect(desk).toHaveAttribute('data-on', 'yes');
  await expect(desk).toContainText('במזומן או באשראי');
  await shot(page, 'stay-at-arrival');
  // Back to paying by link, and again at the desk.
  await desk.getByTestId('money-at-arrival-toggle').click();
  await expect(desk).toHaveAttribute('data-on', 'no');
  await desk.getByTestId('money-at-arrival-toggle').click();
  await expect(desk).toHaveAttribute('data-on', 'yes');

  // The business decides whether guests may pay at the desk at all.
  await page.goto('/admin/lodging/rooms');
  await expect(
    page.getByTestId('lodging-settings-form').locator('input[name="payAtArrival"]'),
  ).toBeChecked();
});
