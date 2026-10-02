/**
 * Phase 1 acceptance, through the UI only: the owner configures a Har Homa-style venue with gender windows and two
 * price lists effective on different dates, and the price check answers ₪330 in the autumn and ₪350 from January.
 * Runs on the phone-sized project, because the owner does this from her phone. All data is fake.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const run = Date.now().toString(36);
const VENUE = `הר חומה ${run}`;

/** Opens a collapsed <details> section by its summary text; leaves it alone when already open. */
async function open(scope: Page | Locator, summary: string) {
  const details = scope
    .locator('details', { has: scope.locator('summary', { hasText: summary }) })
    .last();
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await details.locator('summary').first().click();
  }
}

async function addWindow(
  page: Page,
  w: { day: string; admits: string; from: string; to: string; lanes: string[] },
) {
  await open(page, 'הוספת חלון זמן');
  const form = page.getByTestId('window-form-בריכה ראשית');
  await form.getByLabel('יום').selectOption({ label: w.day });
  await form.getByLabel('מי נכנס/ת').selectOption({ label: w.admits });
  await form.getByLabel('משעה').fill(w.from);
  await form.getByLabel('עד שעה').fill(w.to);
  for (const lane of w.lanes) await form.getByLabel(lane, { exact: true }).check();
  await form.getByLabel('בתוקף מ-').fill('2026-09-01');
  await form.getByRole('button', { name: 'הוספת חלון זמן' }).click();
  return form;
}

test('owner sets up Har Homa with gender windows and two dated price lists', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');

  // ─── Venue, pool and lanes ────────────────────────────────────────────────
  await page.getByRole('link', { name: 'עוד' }).last().click();
  await page.getByTestId('more-venues').click();
  await page.getByRole('link', { name: 'מקום חדש' }).click();
  const venueForm = page.getByTestId('venue-form');
  await venueForm.getByLabel('שם המקום').fill(VENUE);
  await venueForm.getByLabel('סוג').selectOption({ label: 'קאנטרי קלאב' });
  await venueForm.getByLabel('עיר').fill('ירושלים');
  await venueForm.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: VENUE })).toBeVisible();

  const poolForm = page.getByTestId('pool-form');
  await poolForm.getByLabel('שם הבריכה').fill('בריכה ראשית');
  await poolForm.getByLabel('מספר מסלולים').fill('4');
  await poolForm.getByRole('button', { name: 'הוספת בריכה' }).click();
  await expect(page.getByTestId('pool-בריכה ראשית')).toContainText('4 מסלולים');

  // ─── Gender windows: women and girls on Monday, men and boys on Wednesday ──
  const all = ['מסלול 1', 'מסלול 2', 'מסלול 3', 'מסלול 4'];
  await addWindow(page, {
    day: 'שני',
    admits: 'נשים ובנות',
    from: '16:00',
    to: '19:00',
    lanes: all,
  });
  await expect(page.getByTestId('window-row')).toHaveCount(1);
  await addWindow(page, {
    day: 'רביעי',
    admits: 'גברים ובנים',
    from: '16:00',
    to: '19:00',
    lanes: all,
  });
  await expect(page.getByTestId('window-row')).toHaveCount(2);
  const rows = page.getByTestId('window-row');
  await expect(rows.nth(0)).toContainText('שני');
  await expect(rows.nth(0)).toContainText('נשים ובנות');
  await expect(rows.nth(1)).toContainText('רביעי');
  await expect(rows.nth(1)).toContainText('גברים ובנים');

  // A mixed hour on Monday's lane 1 collides with the women's window and is refused.
  const clash = await addWindow(page, {
    day: 'שני',
    admits: 'מעורב',
    from: '17:00',
    to: '18:00',
    lanes: ['מסלול 1'],
  });
  await expect(clash.getByRole('alert')).toContainText('כבר תפוס');
  await expect(page.getByTestId('window-row')).toHaveCount(2);

  // ─── Price list from 1 September: ₪330 for the kids group ─────────────────
  await page.getByRole('link', { name: 'עוד' }).last().click();
  await page.getByTestId('more-prices').click();
  const listForm = page.getByTestId('price-list-form');
  await listForm.getByLabel('שם המחירון').fill(`${VENUE} ספטמבר`);
  await listForm.getByLabel('מקום').selectOption({ label: VENUE });
  await listForm.getByLabel('בתוקף מ-').fill('2026-09-01');
  await listForm.getByRole('button', { name: 'יצירת טיוטה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${VENUE} ספטמבר` })).toBeVisible();

  const setPrice = async (shekels: string) => {
    const itemForm = page.getByTestId('price-item-form');
    await itemForm.getByLabel('תוכנית').selectOption({ label: 'קבוצת ילדים' });
    await itemForm.getByLabel('סוג').selectOption({ label: 'מנוי חודשי' });
    await itemForm.getByLabel('מחיר (₪)').fill(shekels);
    await itemForm.getByRole('button', { name: 'שמירת מחיר' }).click();
    await expect(page.getByTestId('price-items')).toContainText(`${shekels}`);
  };
  await setPrice('330');
  await page.getByRole('button', { name: 'פרסום' }).click();
  // In effect now: locked, so the item form is gone and the page says how to change a price.
  await expect(page.getByText('המחירון בתוקף ולכן נעול')).toBeVisible();
  await expect(page.getByTestId('price-item-form')).toHaveCount(0);

  // ─── New version from 1 January: copy, raise to ₪350, publish ─────────────
  await open(page, 'גרסה חדשה מתאריך');
  const versionForm = page.getByTestId('price-list-form');
  await versionForm.getByLabel('שם המחירון').fill(`${VENUE} ינואר`);
  await versionForm.getByLabel('בתוקף מ-').fill('2027-01-01');
  await versionForm.getByRole('button', { name: 'יצירת גרסה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${VENUE} ינואר` })).toBeVisible();
  await expect(page.getByTestId('price-items')).toContainText('330');
  await setPrice('350');
  await expect(page.getByTestId('price-items')).not.toContainText('330');
  await page.getByRole('button', { name: 'פרסום' }).click();
  await expect(page.getByText('פורסם').first()).toBeVisible();

  // ─── Price check: the same question on two dates ──────────────────────────
  await page.getByRole('link', { name: 'עוד' }).last().click();
  await page.getByTestId('more-prices').click();
  const check = page.getByTestId('price-check');
  const ask = async (date: string) => {
    await check.getByLabel('מקום').selectOption({ label: VENUE });
    await check.getByLabel('תוכנית').selectOption({ label: 'קבוצת ילדים' });
    await check.getByLabel('סוג').selectOption({ label: 'מנוי חודשי' });
    await check.getByLabel('בתאריך').fill(date);
    await check.getByRole('button', { name: 'כמה זה עולה?' }).click();
    return page.getByTestId('price-answer');
  };
  await expect(await ask('2026-10-15')).toContainText('330');
  await expect(page.getByTestId('price-answer')).toContainText(`${VENUE} ספטמבר`);
  await expect(await ask('2027-01-15')).toContainText('350');
  await expect(page.getByTestId('price-answer')).toContainText(`${VENUE} ינואר`);

  // Nothing overflows sideways on the phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
