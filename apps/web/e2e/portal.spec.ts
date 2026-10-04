/**
 * Phase 7 acceptance, on a phone: a parent reports an absence, books the makeup it earns and downloads a receipt in
 * under 60 seconds in total. The worker's step (deciding the notice by the regulations) runs in between, as in
 * production. Also: a freeze request decided by the worker, and the companion pass check at the entrance.
 * Every person is fake (demo seed); the master key is the E2E's fixed fake.
 */
import { expect, test } from '@playwright/test';
import { passToken } from '../src/lib/pass';
import { processAbsence, processRequests } from './worker';

const E2E_MASTER_KEY = Buffer.alloc(32, 7);

function dayIL(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

test('AC: absence → makeup booking → receipt download in under 60 seconds', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const started = Date.now();

  await page.goto('/dev/login?as=parent');
  await page.getByRole('link', { name: 'לו״ז' }).last().click();
  // The first lesson at least two days out that has no notice yet: in good time for a credit.
  const lessons = page
    .getByTestId('parent-lesson')
    .filter({ has: page.getByRole('button', { name: 'לא נגיע' }) });
  await expect(lessons.first()).toBeVisible();
  const soonest = dayIL(2);
  let lesson = null;
  for (const l of await lessons.all()) {
    if (((await l.getAttribute('data-date')) ?? '') >= soonest) {
      lesson = l;
      break;
    }
  }
  if (!lesson) throw new Error('no lesson two days out to report');
  const [studentId = '', sessionId = ''] = ((await lesson.getAttribute('data-lesson')) ?? '').split(
    ':',
  );
  const row = page.locator(`[data-lesson="${studentId}:${sessionId}"]`);
  await lesson.getByRole('button', { name: 'לא נגיע' }).click();
  await expect(row).toContainText('ההודעה התקבלה');

  // The worker decides the notice by the regulations and issues the credit.
  const [creditId] = await processAbsence(studentId, sessionId);
  expect(creditId).toBeTruthy();

  await page.getByRole('link', { name: 'המשפחה' }).last().click();
  await page.locator(`a[href="/parent/makeup/${creditId}"]`).click();
  const offer = page.getByTestId('parent-offer').first();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'קביעה' }).click();
  await expect(page).toHaveURL(/\/parent\/schedule\?booked=1/);
  await expect(page.getByRole('status').first()).toContainText('ההשלמה נקבעה');

  await page.getByRole('link', { name: 'תשלומים' }).last().click();
  await page.getByTestId('open-receipt').first().click();
  await expect(page.getByTestId('receipt')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('receipt-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^receipt-.*\.html$/);

  const seconds = (Date.now() - started) / 1000;
  test.info().annotations.push({ type: 'seconds', description: seconds.toFixed(1) });
  expect(seconds).toBeLessThan(60);
});

test('a family asks to freeze a seat; the worker decides and the answer shows on the child card', async ({
  page,
}) => {
  await page.goto('/dev/login?as=parent');
  await page.getByTestId('parent-children').getByRole('link').first().click();
  await expect(page.getByTestId('child-progress')).toBeVisible();
  const studentId = page.url().split('/').pop() ?? '';

  // A month far enough ahead (and different on a retry) not to overlap an earlier freeze.
  const offset = 60 + Math.floor(Math.random() * 200);
  const seat = page.getByTestId('child-seat').first();
  await seat.getByText('בקשת הקפאה', { exact: true }).click();
  const form = seat.getByTestId('ask-freeze');
  await form.getByLabel('מתאריך').fill(dayIL(offset));
  await form.getByLabel('עד תאריך').fill(dayIL(offset + 10));
  await form.getByRole('button', { name: 'שליחת בקשת הקפאה' }).click();
  await expect(form.getByRole('status')).toContainText('הבקשה נשלחה');

  expect(await processRequests(studentId)).toBeGreaterThanOrEqual(1);
  await page.reload();
  const request = page.getByTestId('child-request').first();
  await expect(request).toContainText('הקפאה');
  await expect(request).toContainText('ההקפאה');
});

test('the companion pass: the parent sees it, and the entrance checks it without a login', async ({
  page,
  browser,
}) => {
  await page.goto('/dev/login?as=parent');
  await page.goto('/parent/pass');
  await expect(page.getByRole('heading', { level: 1, name: 'כרטיס כניסה למלווה' })).toBeVisible();

  // The entrance scans the code on its own phone: no session at all.
  const gate = await browser.newPage();
  const data = { s: 'R-SWIM (דמו)', c: 'נועה', g: 'דולפינים', v: 'בריכת דמו', t: '17:00', n: 1 };
  await gate.goto(`/pass/${passToken({ ...data, d: dayIL(0) }, E2E_MASTER_KEY)}`);
  const check = gate.getByTestId('pass-check');
  await expect(check).toContainText('בתוקף להיום');
  await expect(check).toContainText('נועה');

  await gate.goto(`/pass/${passToken({ ...data, d: dayIL(-1) }, E2E_MASTER_KEY)}`);
  await expect(check).toContainText('פג תוקף');

  const forged = passToken({ ...data, d: dayIL(0) }, Buffer.alloc(32, 8));
  await gate.goto(`/pass/${forged}`);
  await expect(check).toContainText('הכרטיס לא תקין');
  await gate.close();
});
