/**
 * SaaS stage 5 acceptance: a business brings its people over from the previous system. The swim school's owner
 * uploads a Hebrew CSV of families, checks and corrects the columns, sees the bad row flagged before anything is
 * saved, imports the rest, sees who still has to sign a standing order, and takes the import back. The freediving
 * club's owner does the same with a divers file. Everyone in the files is made up, with fresh phone numbers per run
 * so a retry never meets the previous run's families.
 */
import { expect, test, type Page } from '@playwright/test';

/** Four fresh mobile numbers (05X-XXXXXXX) for this run. */
function phones(): string[] {
  const base = 1_000_000 + (Date.now() % 8_000_000);
  return [0, 1, 2, 3].map((i) => `054${String(base + i * 7).padStart(7, '0')}`);
}

function csv(rows: string[][]): Buffer {
  return Buffer.from(`\uFEFF${rows.map((r) => r.join(',')).join('\r\n')}\r\n`, 'utf8');
}

async function upload(page: Page, kind: string, name: string, body: Buffer) {
  const form = page.getByTestId('import-upload');
  await form.getByLabel('מה יש בקובץ?').selectOption({ label: kind });
  await form
    .getByLabel('קובץ אקסל או CSV')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: body });
  await page.getByTestId('import-upload-submit').click();
  await expect(page.getByTestId('import-draft')).toBeVisible();
}

test('AC: a families file is previewed with its problems, imported, and taken back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => void d.accept());
  const [p1, p2, p3] = phones() as [string, string, string];

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-import').click();
  await expect(page).toHaveURL(/\/admin\/import$/);

  await upload(
    page,
    'משפחות',
    'families.csv',
    csv([
      ['שם ההורה', 'טלפון', 'שם הילד', 'תאריך לידה', 'יתרה', 'מידע נוסף'],
      ['רונית בדיקה', p1, 'נועה בדיקה', '05/03/2017', '120', 'אלרגיה לכלור'],
      ['רונית בדיקה', p1, 'איתי בדיקה', '11/09/2019', '', ''],
      ['משה ניסיון', p2, 'יעל ניסיון', '2018-01-20', '', ''],
      ['דנה דמה', p3, 'עומר דמה', '14.2.2016', '(80)', ''],
      ['בלי טלפון', '123', 'ילד', '', '', ''],
    ]),
  );

  // The rules placed the known headers; the free-text column waits for the owner.
  await expect(page.getByTestId('import-col-1')).toHaveValue('phone');
  await expect(page.getByTestId('import-col-5')).toHaveValue('');
  await expect(page.getByTestId('import-stat-records')).toHaveText('3');
  await expect(page.getByTestId('import-stat-skipped')).toHaveText('1');
  await expect(page.getByTestId('import-issues')).toContainText('מספר טלפון לא תקין');

  await page.getByTestId('import-col-5').selectOption('notes');
  await page.getByTestId('import-mapping-save').click();
  // The form is drawn again from the saved mapping.
  await expect(page.getByTestId('import-col-5')).toHaveValue('notes');
  await page.reload();
  await expect(page.getByTestId('import-col-5')).toHaveValue('notes');

  const commit = page.getByTestId('import-commit');
  await commit.getByLabel('הלקוחות שבקובץ הסכימו לקבל מאיתנו הודעות WhatsApp').check();
  await page.getByTestId('import-commit-submit').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await expect(page.getByTestId('import-result')).toContainText('3 משפחות נכנסו');
  await expect(page.getByTestId('import-result')).toContainText('4 ילדים');
  await expect(page.getByTestId('import-mandates-summary')).toContainText('עוד לא: 3');
  await expect(page.getByTestId('import-mandates')).toContainText('בדיקה');

  await page.getByTestId('import-undo').click();
  await expect(page.getByTestId('import-result')).toContainText('3 נמחקו');
  await expect(page.getByTestId('import-undo')).toHaveCount(0);

  await page.goto('/admin/import');
  await expect(page.getByTestId('import-history').locator('li').first()).toContainText('בוטל');
});

test('AC: a freediving club imports its divers and takes them back', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('dialog', (d) => void d.accept());
  const [p1, p2] = phones().slice(2) as [string, string];

  await page.goto('/dev/login?as=diveOwner');
  await page.goto('/dive/setup');
  await page.getByTestId('setup-to-import').click();
  await expect(page).toHaveURL(/\/dive\/import$/);

  await upload(
    page,
    'צוללים',
    'divers.csv',
    csv([
      ['שם מלא', 'נייד', 'אימייל', 'רמת הסמכה', 'עיר'],
      ['גל בדיקה', p1, 'gal@example.com', '2', 'אילת'],
      ['שיר ניסיון', p2, '', 'AIDA 3', 'באר שבע'],
    ]),
  );
  await expect(page.getByTestId('import-stat-records')).toHaveText('2');
  await page.getByTestId('import-commit-submit').click();
  await expect(page.getByTestId('import-result')).toContainText('2 צוללים נכנסו');

  await page.getByTestId('import-undo').click();
  await expect(page.getByTestId('import-result')).toContainText('2 נמחקו');
});
