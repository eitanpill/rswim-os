/**
 * Phase 9 acceptance: migrating all groups from a closing venue to another produces a preview, personalized messages,
 * and is reversible within 24h. The owner opens the wizard for the demo Gush Etzion pool, moves every group to the
 * Jerusalem country club at the same times (Lia's Thursday group without a lead for now: she does not teach there),
 * checks the preview and the message for each child, executes, sees the families' messages queued, and reverts.
 * Every person and place is fake (demo seed). The move starts eight weeks out so it never meets the lessons the
 * other specs touch, and the revert puts everything back for them.
 */
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { E2E_DB_URL, runAutomations } from './worker';

const GUSH = 'בריכת הדמו - גוש עציון';
const JLM = 'קאנטרי הדמו - ירושלים';
const FEAR = 'פחד ממים חמישי';

/** A Sunday eight weeks or more from today in Israel, as YYYY-MM-DD. */
function sundayAhead(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  let t = Date.parse(`${today}T12:00:00Z`) + 56 * 86_400_000;
  while (new Date(t).getUTCDay() !== 0) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Where the Gush Etzion groups are, by group name. */
async function gushGroups(): Promise<Record<string, string>> {
  const client = new pg.Client({ connectionString: E2E_DB_URL });
  await client.connect();
  try {
    const r = await client.query<{ name: string; venue: string }>(
      `select t.name, v.name venue from class_templates t join venues v on v.id = t.venue_id
       where t.name in ('גוש שלישי', 'מבוגרים גוש', $1)`,
      [FEAR],
    );
    return Object.fromEntries(r.rows.map((x) => [x.name, x.venue]));
  } finally {
    await client.end();
  }
}

test('AC: moving every group out of a closing pool previews, messages each family and can be reverted', async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => void d.accept());
  expect(Object.values(await gushGroups())).toEqual([GUSH, GUSH, GUSH]);

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/venues');
  await page.getByRole('link', { name: 'מעבר בריכה' }).click();
  await expect(page).toHaveURL(/\/admin\/venues\/migrations$/);

  // A retry on the same database continues the draft it left behind.
  const draft = page.getByTestId('migration').filter({ hasText: 'טיוטה' });
  if ((await draft.count()) > 0) {
    await draft.first().click();
  } else {
    const form = page.getByTestId('migration-form');
    await form.getByLabel('הבריכה שנסגרת').selectOption({ label: GUSH });
    await form.getByLabel('החל מתאריך').fill(sundayAhead());
    await form.getByLabel('סיבה (לא חובה)').fill('המועצה סוגרת את הבריכה לשיפוץ (דמו)');
    await form.getByRole('button', { name: 'פתיחת אשף המעבר' }).click();
  }
  await expect(page).toHaveURL(/\/admin\/venues\/migrations\/[0-9a-f-]{36}$/);
  const groups = page.getByTestId('migration-group');
  await expect(groups).toHaveCount(3);

  // Every group moves as it is to Jerusalem.
  await page.getByTestId('relocate-all').getByLabel('בריכת יעד').selectOption({ label: JLM });
  await page.getByTestId('relocate-all').getByRole('button', { name: 'העברת כל הקבוצות' }).click();
  for (const g of await groups.all()) {
    await expect(g.getByTestId('migration-target')).toContainText(`עוברת ל${JLM}`);
    await expect(g.getByTestId('migration-price')).toBeVisible();
  }
  // The monthly price before and after (or that the new venue has no price list for that program).
  await expect(groups.first().getByTestId('migration-price')).toContainText('המחיר');

  // Lia does not teach in Jerusalem on Thursdays: the preview says so, and her group moves without a lead for now.
  const fear = page.locator(`[data-testid="migration-group"][data-group="${FEAR}"]`);
  await expect(fear.getByTestId('migration-issues')).toBeVisible();
  await expect(page.getByTestId('execute-migration')).toHaveCount(0);
  const relocate = fear.getByTestId('relocate-form');
  await relocate
    .getByLabel('מדריך/ה', { exact: true })
    .selectOption({ label: 'בלי מדריך/ה בינתיים' });
  await relocate.getByRole('button', { name: 'שמירה' }).click();
  await expect(fear.getByTestId('migration-target')).toContainText('מדריך/ה: עוד לא נקבע');
  await expect(fear.getByTestId('migration-issues').locator('.text-danger')).toHaveCount(0);

  // One personal message per child, naming the child and the new place.
  const messages = page.getByTestId('migration-message');
  const count = await messages.count();
  expect(count).toBeGreaterThan(2);
  for (const m of await messages.all()) await expect(m).toContainText(`עוברת ל${JLM}`);

  // Execute: the groups move and the families' messages are queued by the worker's step.
  await page.getByTestId('execute-migration').click();
  await expect(page.getByTestId('migration-done')).toBeVisible();
  await expect(page.getByText(/אפשר לבטל עד/)).toBeVisible();
  expect(Object.values(await gushGroups())).toEqual([JLM, JLM, JLM]);
  // One message per family contact (a child with two parents on WhatsApp reaches both).
  const queued = await runAutomations('scheduling.venue_migrated');
  expect(queued).toBeGreaterThan(0);
  await page.goto('/admin/messages/log');
  await expect(page.getByText(`עוברת ל${JLM}`).first()).toBeVisible();

  // Revert inside the window: everything is back, and the families hear that the change was cancelled.
  await page.goBack();
  await page.getByTestId('revert-migration').click();
  await expect(page.getByTestId('migration-reverted')).toBeVisible();
  expect(Object.values(await gushGroups())).toEqual([GUSH, GUSH, GUSH]);
  expect(await runAutomations('scheduling.venue_migration_reverted')).toBe(queued);
  await page.goto('/admin/messages/log');
  await expect(page.getByText(`ל${JLM} בוטל`).first()).toBeVisible();
});
