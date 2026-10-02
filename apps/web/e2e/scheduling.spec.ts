/**
 * Phase 2 acceptance, through the UI: (1) generating a term skips Chol HaMoed and says so in the report; (2) a girl
 * dragged onto a group in the boys-only window is blocked with a clear Hebrew reason; (3) changing an instructor's
 * shift waits for that instructor's acceptance in the instructor app. All people and places are fake (demo seed).
 */
import { expect, test, type Page } from '@playwright/test';

const run = Date.now().toString(36);
const JERUSALEM = 'קאנטרי הדמו - ירושלים';

async function openBoard(page: Page) {
  await page.goto('/dev/login?as=owner');
  await page.getByRole('link', { name: 'לוח קבוצות' }).last().click();
  await page.getByRole('link', { name: JERUSALEM }).click();
  await expect(page.getByTestId('board-group-בנים צפרדע')).toBeVisible();
}

test('AC1: generating a term skips Chol HaMoed and reports why', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.getByRole('link', { name: 'עוד' }).last().click();
  await page.getByTestId('more-terms').click();
  await page.getByText('תקופה חדשה').click();
  const form = page.getByTestId('term-form');
  await form.getByLabel('שם').fill(`קורס סוכות ${run}`);
  await form.getByLabel('סוג').selectOption({ label: 'קורס' });
  await form.getByLabel('מתאריך').fill('2026-09-20');
  await form.getByLabel('עד תאריך').fill('2026-10-10');
  await form.getByRole('button', { name: 'יצירת תקופה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `קורס סוכות ${run}` })).toBeVisible();

  await page.getByRole('button', { name: 'יצירת שיעורים עכשיו' }).click();
  await expect(page.getByTestId('generate-form')).toContainText('השיעורים נוצרו');
  const days = page.getByTestId('skipped-day');
  // Monday 28.9 and Wednesday 30.9 are Chol HaMoed Sukkot 5787; the groups on those days get no session.
  for (const date of ['28.9.2026', '30.9.2026']) {
    await expect(days.filter({ hasText: date })).toContainText('חול המועד');
  }
  await expect(days.filter({ hasText: '28.9.2026' })).toContainText('בנות צפרדע');
  await expect(days.filter({ hasText: '21.9.2026' })).toContainText('יום כיפור');
});

test('AC2: dragging a girl into the boys-only window is blocked with a Hebrew reason @desktop', async ({
  page,
}) => {
  await openBoard(page);
  const girl = page
    .getByTestId('board-group-בנות צפרדע')
    .locator('[data-testid^="member-"]')
    .first();
  const name = (await girl.locator('span.font-medium').textContent())?.trim() ?? '';
  // A real drag with intermediate moves (HTML5 drag and drop), grabbing the chip by the name. Tall viewport so both
  // groups are on screen without scrolling mid-drag.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await girl.locator('span.font-medium').hover();
  await page.mouse.down();
  const target = await page.getByTestId('board-group-בנים צפרדע').boundingBox();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 20, { steps: 10 });
  await page.mouse.up();

  const sheet = page.getByTestId('move-preview');
  await expect(sheet).toContainText('אי אפשר להעביר');
  await expect(sheet.getByTestId('move-violation').first()).toContainText(
    `${name.split(' ')[0]} בת, והבריכה בשעה הזו פתוחה רק לגברים ובנים`,
  );
  await expect(sheet.getByRole('button', { name: 'אישור העברה' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'סגירה' }).click();
  // Nothing moved.
  await expect(page.getByTestId('board-group-בנות צפרדע')).toContainText(name);
});

test('AC2 on a phone: "move to" a boys group shows the same reason', async ({ page }) => {
  await openBoard(page);
  const girl = page
    .getByTestId('board-group-בנות צפרדע')
    .locator('[data-testid^="member-"]')
    .first();
  const boys = await page
    .getByTestId('board-group-בנים צפרדע')
    .evaluate((el) => el.getAttribute('data-testid'));
  expect(boys).toBeTruthy();
  const picker = girl.getByTestId('move-picker');
  const option = picker.locator('option', { hasText: 'בנים צפרדע' });
  await picker.selectOption(await option.getAttribute('value'));
  await expect(page.getByTestId('move-violation').first()).toContainText('פתוחה רק לגברים ובנים');
});

test('AC3: an instructor shift change waits for the instructor to accept', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');
  // The demo seed already asked Noa about this group; withdraw it and ask again from the group page.
  await page.goto('/admin/shifts');
  const seeded = page
    .getByTestId('shift-change')
    .filter({ hasText: 'בנות כריש' })
    .filter({ hasText: 'ממתין' });
  if (await seeded.count()) {
    await seeded.first().getByRole('button', { name: 'ביטול השינוי' }).click();
    await expect(seeded).toHaveCount(0);
  }
  await page.goto('/admin/groups');
  await page.getByTestId('group-row').filter({ hasText: 'בנות כריש' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'בנות כריש' })).toBeVisible();
  const form = page.getByTestId('reassign-group-form');
  await form.getByLabel('מדריך/ה חדש/ה').selectOption({ label: 'נועה דמו' });
  await form.getByLabel('סיבה (תוצג למדריך/ה)').fill(`בדיקה ${run}`);
  await form.getByRole('button', { name: 'שליחה לאישור' }).click();
  await expect(form).toContainText('השינוי נשלח לאישור המדריך/ה');
  // Nothing changed yet: the group still has its instructor.
  await expect(page.getByTestId('group-lead')).toHaveText('ליה בדיקה');

  await page.goto('/dev/login?as=instructor');
  const ask = page.getByTestId('my-shift-change').filter({ hasText: `בדיקה ${run}` });
  await expect(ask).toContainText('לקחת את בנות כריש');
  await ask.getByRole('button', { name: 'מאשר/ת' }).click();
  await expect(page.getByText('התשובה נשלחה')).toBeVisible();

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/shifts');
  await expect(page.getByTestId('shift-change').filter({ hasText: `בדיקה ${run}` })).toContainText(
    'אושר',
  );
});
