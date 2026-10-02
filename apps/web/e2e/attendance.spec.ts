/**
 * Phase 3 acceptance, through the UI: (1) an absence notice 13 hours before a lesson earns a makeup credit that
 * expires at the end of that month, and one 11 hours before does not; (2) a three-day venue closure cancels its
 * lessons, gives every child with an active seat a credit, opens the makeup window and shows the uptake report.
 * Also: the instructor's one-tap attendance survives going offline, and a family reports an absence and signs a form.
 * Every person and place is fake (demo seed). The tests touch different groups and dates so they can run in parallel.
 */
import { expect, test, type Page } from '@playwright/test';

const GUSH = 'בריכת הדמו - גוש עציון';

/** Today in Israel plus some days, as YYYY-MM-DD (wall-clock arithmetic on noon UTC never crosses a date line). */
function dayIL(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const dmy = (date: string) => {
  const [y, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

/** The wall-clock time some hours before a local date and time, as a datetime-local value. */
function hoursBefore(date: string, hhmm: string, hours: number): string {
  const t = Date.parse(`${date}T${hhmm}:00Z`) - hours * 3_600_000;
  return new Date(t).toISOString().slice(0, 16);
}

function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Opens the first lesson of a group on or after `fromOffset` days from today that has no absence notices yet (so a
 * retry on the same database picks a fresh one); returns its date and start time.
 */
async function openLesson(page: Page, group: string, fromOffset: number) {
  for (let i = fromOffset; i < fromOffset + 30; i++) {
    const date = dayIL(i);
    await page.goto(`/admin/attendance?date=${date}`);
    const link = page.getByTestId('day-session').filter({ hasText: group });
    if ((await link.count()) === 0) continue;
    const text = (await link.first().textContent()) ?? '';
    const start = /(\d{2}:\d{2})/.exec(text)?.[1] ?? '';
    await link.first().click();
    await expect(page.getByRole('heading', { level: 1, name: group })).toBeVisible();
    if ((await page.getByTestId('notice-row').count()) === 0) return { date, start };
  }
  throw new Error(`no lesson of ${group}`);
}

test('AC1: 13 hours of notice earns a credit until the end of the month; 11 hours does not', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  const { date, start } = await openLesson(page, 'בנים דולפין', 3);
  const form = page.getByTestId('absence-form');
  const student = form.getByLabel('ילד/ה');
  const options = await student.locator('option').allTextContents();
  expect(options.length).toBeGreaterThanOrEqual(2);
  const [early, late] = options as [string, string];

  await student.selectOption({ label: early });
  await form.getByLabel('איך הודיעו').selectOption({ label: 'וואטסאפ' });
  await form.getByLabel('מתי התקבלה ההודעה').fill(hoursBefore(date, start, 13));
  await form.getByRole('button', { name: 'רישום ובדיקה מול התקנון' }).click();
  await expect(form.getByRole('status')).toContainText(
    'ההודעה התקבלה 13 שעות ו-0 דקות לפני השיעור (נדרשות לפחות 12 שעות) · נפתחה השלמה',
  );

  await student.selectOption({ label: late });
  await form.getByLabel('מתי התקבלה ההודעה').fill(hoursBefore(date, start, 11));
  await form.getByRole('button', { name: 'רישום ובדיקה מול התקנון' }).click();
  await expect(form.getByRole('status')).toContainText(
    'ההודעה התקבלה רק 11 שעות ו-0 דקות לפני השיעור (נדרשות לפחות 12 שעות) · הודעה מאוחרת לא מזכה בהשלמה',
  );

  const notices = page.getByTestId('notice-row');
  await expect(notices.filter({ hasText: early })).toContainText('מזכה בהשלמה');
  await expect(notices.filter({ hasText: late })).toContainText('ללא השלמה');

  // The credit is valid until the last day of the lesson's month; the late notice made none.
  await page.goto('/admin/makeups');
  const credits = page.getByTestId('credit-row');
  await expect(credits.filter({ hasText: early })).toContainText(
    `בתוקף עד ${dmy(endOfMonth(date))}`,
  );
  await expect(credits.filter({ hasText: late })).toHaveCount(0);
});

test('AC2: a three-day closure cancels the lessons, issues credits, opens makeups and reports uptake', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');
  // From the first Tuesday two weeks out, Tuesday to Thursday: both Gush Etzion lesson days.
  let offset = 14;
  while (new Date(`${dayIL(offset)}T12:00:00Z`).getUTCDay() !== 2) offset++;
  // A retry on the same database moves on to a week that is not closed yet.
  for (;;) {
    await page.goto(`/admin/attendance?date=${dayIL(offset)}`);
    const lesson = page.getByTestId('day-session').filter({ hasText: 'גוש שלישי' });
    if ((await lesson.count()) > 0 && !(await lesson.textContent())?.includes('בוטל')) break;
    offset += 7;
  }
  const [from, to] = [dayIL(offset), dayIL(offset + 2)];

  await page.goto('/admin/closures');
  const form = page.getByTestId('closure-form');
  await form.getByLabel('מקום').selectOption({ label: GUSH });
  await form.getByLabel('סיבת הסגירה').selectOption({ label: 'המקום' });
  await form.getByLabel('מתאריך').fill(from);
  await form.getByLabel('עד תאריך').fill(to);
  await form.getByLabel('תיאור (יוצג להורים)').fill('תחזוקת הבריכה (דמו)');
  await form.getByRole('button', { name: 'תצוגה מקדימה' }).click();

  const preview = page.getByTestId('closure-preview');
  await expect(preview).toBeVisible();
  const sessions = preview.getByTestId('preview-session');
  expect(await sessions.count()).toBeGreaterThanOrEqual(2);
  const totals = (await page.getByTestId('preview-totals').textContent()) ?? '';
  const credits = Number(/(\d+) השלמות ייפתחו/.exec(totals)?.[1]);
  expect(credits).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'פתיחת האירוע וביטול השיעורים' }).click();
  await expect(page.getByRole('status')).toContainText(`נפתחו ${credits} השלמות`);
  const report = page.getByTestId('uptake-report');
  const total = report.getByTestId('uptake-row').last();
  await expect(total).toContainText('סה״כ');
  // Issued = every credit, all still open: nobody booked yet.
  await expect(total.locator('td').nth(1)).toHaveText(String(credits));
  await expect(total.locator('td').nth(7)).toHaveText(String(credits));

  // The lessons are cancelled on the day screen, and the credits sit in the makeup window after the closure.
  await page.goto(`/admin/attendance?date=${from}`);
  await expect(page.getByTestId('day-session').filter({ hasText: 'גוש שלישי' })).toContainText(
    'בוטל (סגירה חיצונית)',
  );
  await page.goto('/admin/makeups');
  await expect(
    page.getByTestId('credit-row').filter({ hasText: `לניצול בין ${dmy(dayIL(offset + 3))}` }),
  ).toHaveCount(credits);
});

test('an instructor marks attendance in one tap, and marks made offline sync when back online', async ({
  page,
  context,
}) => {
  await page.goto('/dev/login?as=instructor');
  await page.getByTestId('my-session').first().click();
  await expect(page.getByTestId('instructor-lineup')).toBeVisible();
  const rows = page.getByTestId('mark-row');
  await rows.nth(0).getByRole('button', { name: 'הגיע/ה', exact: true }).click();
  await expect(rows.nth(0).getByTestId('mark-status')).toHaveText('הגיע/ה');
  await expect(page.getByTestId('sync-done')).toBeVisible();

  await context.setOffline(true);
  await rows.nth(1).getByRole('button', { name: 'לא הגיע/ה' }).click();
  await expect(page.getByTestId('sync-pending')).toContainText('1');
  await context.setOffline(false);
  await expect(page.getByTestId('sync-done')).toBeVisible();

  await page.reload();
  await expect(rows.nth(0).getByTestId('mark-status')).toHaveText('הגיע/ה');
  await expect(rows.nth(1).getByTestId('mark-status')).toHaveText('לא הגיע/ה');
});

test('a parent reports an absence and accepts a form in the portal', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=parent');
  await page.getByRole('link', { name: 'לו״ז' }).last().click();
  const open = page
    .getByTestId('parent-lesson')
    .filter({ has: page.getByRole('button', { name: 'לא נגיע' }) });
  const id = await open.last().getAttribute('data-lesson');
  const lesson = page.locator(`[data-lesson="${id}"]`);
  await open.last().getByRole('button', { name: 'לא נגיע' }).click();
  await expect(lesson).toContainText('ההודעה התקבלה');

  await page.getByRole('link', { name: 'מסמכים' }).last().click();
  const forms = page.getByTestId('form-due');
  await expect(forms.first()).toBeVisible();
  const before = await forms.count();
  await forms.first().getByRole('button', { name: 'קראתי ואני מאשר/ת' }).click();
  await expect(page.getByTestId('form-due')).toHaveCount(before - 1);
});
