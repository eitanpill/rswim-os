/**
 * Joining the club on one's own (fake seed): Noam opens the Eilat club's join link, signs in, joins as a diver, adds
 * an emergency contact, uploads a photo of his card and signs the waiver from his phone; the desk checks a card a new
 * diver uploaded and the diver's level follows. Every name is invented.
 */
import { expect, test, type Page } from '@playwright/test';
import { resetDiveNewcomer } from './worker';

/** A 1x1 PNG, the "photo of the card". */
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
    [0.25, 0.3],
    [0.4, 0.7],
    [0.55, 0.35],
    [0.7, 0.6],
  ] as const)
    await page.mouse.move(...at(fx, fy), { steps: 4 });
  await page.mouse.up();
}

test('a new diver joins through the link, adds his card and signs the waiver from his phone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetDiveNewcomer();

  // Signed out, the link shows the club and how joining works.
  await page.goto('/join/eilat-deep-blue');
  await expect(page.getByTestId('join-club')).toContainText('כחול עמוק אילת');
  await expect(page.getByTestId('join-how')).toBeVisible();
  await expect(page.getByTestId('join-sign-in')).toHaveAttribute(
    'href',
    '/login/phone?join=eilat-deep-blue',
  );
  await page.goto('/join/no-such-club');
  await expect(page.getByTestId('join-not-found')).toBeVisible();

  // The demo sign-in stands in for the SMS code and comes back to the link.
  await page.goto('/dev/login?as=diveNewcomer');
  await expect(page).toHaveURL(/\/join\/eilat-deep-blue$/);
  const form = page.getByTestId('join-form');
  await form.getByLabel('שם פרטי').fill('נועם');
  await form.getByLabel('שם משפחה').fill('חדש');
  await form.getByLabel('טלפון נייד').fill('12');
  await form.getByTestId('join-submit').click();
  await expect(form.getByText('מספר טלפון לא תקין.')).toBeVisible();
  await expect(form.getByLabel('שם פרטי')).toHaveValue('נועם');
  await form.getByLabel('טלפון נייד').fill('050-0000203');
  await form.getByLabel(/אני מסכים\/ה ש/).check();
  await form.getByTestId('join-submit').click();

  // First steps: the emergency contact is next.
  await expect(page).toHaveURL(/\/dive\/me\/welcome$/);
  await expect(page.getByTestId('welcome')).toContainText('ברוכים הבאים, נועם!');
  await expect(page.getByTestId('step-details')).toHaveAttribute('data-state', 'todo');
  const details = page.getByTestId('details-form');
  await details.getByLabel('איש קשר לחירום').fill('מיכל חדש');
  await details.getByLabel('הטלפון שלו/ה').fill('052-7654321');
  await details.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByTestId('step-details')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('step-cert')).toHaveAttribute('data-state', 'todo');

  // His card, with a photo: it waits for the club.
  await page.getByTestId('step-cert').click();
  await expect(page).toHaveURL(/\/dive\/me\/certs$/);
  const cert = page.getByTestId('cert-form');
  await cert.getByLabel('ארגון מסמיך').selectOption('molchanovs');
  await cert.getByLabel('רמה').selectOption('3');
  await cert.getByLabel('שם ההסמכה').fill('Molchanovs Wave 2');
  await cert.getByLabel('מספר תעודה').fill('MOL-424242');
  await cert.getByLabel('צילום התעודה').setInputFiles({
    name: 'card.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await cert.getByTestId('cert-submit').click();
  await expect(page.getByTestId('cert-list')).toContainText('Molchanovs Wave 2');
  await expect(page.getByTestId('cert-list')).toContainText('ממתינה לבדיקה');

  // The waiver, signed with a finger.
  await page.goto('/dive/me/welcome');
  await expect(page.getByTestId('step-cert')).toHaveAttribute('data-state', 'waiting');
  await page.getByTestId('step-waiver').click();
  const waiver = page.getByTestId('sign-waiver');
  await waiver.getByTestId('agree').check();
  await draw(page);
  await waiver.getByTestId('sign-submit').click();
  await expect(page).toHaveURL(/\/dive\/me\/forms\?signed=waiver/);

  // Home keeps pointing at what is left.
  await page.goto('/dive/me');
  await expect(page.getByTestId('welcome-link')).toContainText('צעדים ראשונים במועדון');
  await page.goto('/dive/me/welcome');
  await expect(page.getByTestId('step-waiver')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('step-health')).toHaveAttribute('data-state', 'todo');
});

test('the desk checks a card a new diver uploaded @desktop', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/forms');
  const card = page.getByTestId('pending-cert').filter({ hasText: 'עומר שגיא' });
  await expect(card).toContainText('AIDA 3');
  const file = await card.getByRole('link', { name: /עומר שגיא/ }).getAttribute('href');
  await card.getByLabel('הערה').fill('נבדק מול אתר AIDA');
  await card.getByTestId('cert-verify').click();
  await expect(page.getByTestId('pending-cert').filter({ hasText: 'עומר שגיא' })).toHaveCount(0);

  // The diver's file shows the verified card and the level it brought.
  await page.goto(file as string);
  await expect(page.getByTestId('diver-certs')).toContainText('מאושרת');
  await expect(page.getByTestId('diver-certs')).toContainText('נבדק מול אתר AIDA');
});
