/**
 * The club's forms (fake seed): a diver renews her insurance from her phone with a photo of the policy and a drawn
 * signature, the office clears a health declaration that waits for it and signs a waiver on the desk's tablet, and
 * the manager publishes a new text. Every name is invented.
 */
import { expect, test, type Page } from '@playwright/test';

/** A 1x1 PNG, the "photo of the policy". */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function draw(page: Page) {
  const pad = page.getByTestId('signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error('no signature pad');
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await page.mouse.move(...at(0.1, 0.6));
  await page.mouse.down();
  for (const [fx, fy] of [
    [0.2, 0.3],
    [0.3, 0.7],
    [0.4, 0.35],
    [0.5, 0.65],
    [0.6, 0.4],
    [0.75, 0.55],
  ] as const)
    await page.mouse.move(...at(fx, fy), { steps: 4 });
  await page.mouse.up();
}

test('a diver renews her insurance from her phone, with the policy and her signature', async ({
  page,
}) => {
  await page.goto('/dev/login?as=diveCustomer');
  await expect(page).toHaveURL(/\/dive\/me$/);
  // Her insurance ends in 12 days: the page says so and links straight to the form.
  await expect(page.getByTestId('paperwork-todo')).toContainText('הביטוח שלך נגמר בעוד');
  await page.getByTestId('my-forms-link').click();
  await expect(page).toHaveURL(/\/dive\/me\/forms$/);
  await expect(page.getByTestId('paper-insurance')).toContainText('נגמר בקרוב');
  await page.getByTestId('sign-link-insurance').click();

  const form = page.getByTestId('sign-insurance');
  await form.getByLabel('חברת ביטוח').fill('DAN Europe');
  await form.getByLabel('מספר פוליסה').fill('DV-204-778');
  await form.getByLabel('בתוקף עד').fill('2099-05-31');
  await form.getByLabel('צילום הפוליסה (רשות)').setInputFiles({
    name: 'policy.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  // Without a signature or the agreement, nothing is sent.
  await form.getByTestId('sign-submit').click();
  await expect(form.getByText('חסרה חתימה. חתמו בתוך המסגרת.')).toBeVisible();
  await expect(form.getByText('יש לסמן שקראת ושהפרטים נכונים.')).toBeVisible();
  await form.getByTestId('agree').check();
  await draw(page);
  await form.getByTestId('sign-submit').click();

  await expect(page).toHaveURL(/\/dive\/me\/forms\?signed=insurance/);
  await expect(page.getByTestId('signed-banner')).toContainText('הטופס נחתם');
  await expect(page.getByTestId('paper-insurance')).toContainText('בתוקף');
  await expect(page.getByTestId('paper-insurance')).toContainText('DV-204-778');

  // The signed copy: the text, the policy, the drawn signature, the fingerprint and the attached photo.
  await page.getByTestId('paper-insurance').getByRole('link', { name: 'לטופס החתום' }).click();
  await expect(page.getByTestId('signed-form')).toContainText('DAN Europe');
  await expect(page.getByTestId('signature-image').locator('polyline').first()).toBeVisible();
  await expect(page.getByTestId('signed-meta')).toContainText('sha256');
  const href = await page.getByTestId('attached-file').getAttribute('href');
  const file = await page.request.get(href as string);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/png');
});

test('the office clears a health declaration and signs a waiver at the desk', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.getByTestId('bottom-nav').getByRole('link', { name: 'מסמכים' }).click();
  await expect(page).toHaveURL(/\/dive\/forms$/);
  const pending = page.getByTestId('pending-review');
  const before = await pending.count();
  expect(before).toBeGreaterThan(0);
  const first = pending.first();
  await first.getByLabel('הערה').fill('אישור רופא ריאות מ-30.10');
  await first.getByTestId('review-clear').click();
  await expect(pending).toHaveCount(before - 1);

  // A diver booked this week with a form missing: open their file and sign the waiver on the tablet.
  const missing = page.getByTestId('unsigned-booked').getByRole('link').first();
  await missing.click();
  await expect(page.getByTestId('diver-paperwork')).toBeVisible();
  await page.getByTestId('sign-link-waiver').click();
  await expect(page.getByTestId('desk-sign')).toBeVisible();
  const form = page.getByTestId('sign-waiver');
  await expect(form.getByTestId('form-body')).toContainText('כתב ויתור');
  await form.getByTestId('agree').check();
  await draw(page);
  await form.getByTestId('sign-submit').click();
  await expect(page.getByTestId('signed-banner')).toContainText('נחתם בדלפק');
  await expect(page.getByTestId('paper-waiver')).toContainText('בתוקף');
});

test('a health declaration with a "yes" waits for the club', async ({ page }) => {
  await page.goto('/dev/login?as=diveCustomer');
  await page.goto('/dive/me/forms/health');
  const form = page.getByTestId('sign-health');
  const questions = form.getByTestId('form-questions').locator('li');
  const n = await questions.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++)
    await questions
      .nth(i)
      .getByRole('radio', { name: i === 1 ? 'כן' : 'לא', exact: true })
      .check();
  await form.getByTestId('agree').check();
  await draw(page);
  await form.getByTestId('sign-submit').click();
  await expect(page.getByTestId('signed-banner')).toContainText('המועדון יאשר');
  await expect(page.getByTestId('paper-health')).toContainText('ממתין לאישור');
});

test('the manager rewrites the waiver and publishes it @desktop', async ({ page }) => {
  await page.goto('/dev/login?as=diveManager');
  await page.goto('/dive/forms');
  const box = page.getByTestId('texts-waiver');
  const editor = box.getByTestId('draft-waiver');
  if (!(await editor.isVisible())) await box.locator('summary').first().click();
  await editor.getByLabel('כותרת').fill('כתב ויתור ושחרור מאחריות 2027');
  await editor.getByRole('button', { name: 'שמירת טיוטה' }).click();
  await expect(editor.getByRole('status')).toContainText('הטיוטה נשמרה');
  page.once('dialog', (d) => d.accept());
  await box.getByTestId('publish-waiver').click();
  await expect(box).toContainText(/גרסה \d+ בתוקף/);
  await expect(box.getByTestId('publish-waiver')).toHaveCount(0);
});
