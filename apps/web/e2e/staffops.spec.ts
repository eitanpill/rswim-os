/**
 * Phase 6 acceptance, through the UI: last month's payroll shows the hybrid instructor's groups on the payslip and
 * privates by transfer; an open timesheet dispute blocks approval until the office closes it; the accountant exports
 * the approved month; and the instructor persona takes a substitute offer that went out in the first wave. Every
 * instructor, lesson and amount is fake (demo seed).
 */
import { expect, test } from '@playwright/test';

// One payroll month and one substitute request, changed in order.
test.describe.configure({ mode: 'serial' });

test('AC1: the hybrid instructor is split into payslip and transfer; a dispute blocks approval', async ({
  page,
}) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/staff/payroll');
  await expect(page.getByTestId('payroll-run')).toContainText('טיוטה');

  const asaf = page.getByTestId('payroll-staff').filter({ hasText: 'אסף' });
  await expect(asaf).toContainText('משולב');
  await expect(asaf.getByTestId('staff-payslip')).toHaveText(/[1-9]/);
  await expect(asaf.getByTestId('staff-transfer')).toHaveText(/[1-9]/);
  await asaf.getByText('פירוט').click();
  await expect(asaf).toContainText('לשיעור');
  await expect(asaf).toContainText('העברה מול חשבונית');
  await expect(asaf).toContainText('בונוס על החלפות');

  // Dani's dispute is still open.
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('approve-payroll').click();
  await expect(page.getByTestId('payroll-run').getByRole('alert')).toContainText(
    'יש בירור שעות אחד פתוח',
  );

  await page.goto('/admin/staff/timesheets');
  const dani = page.getByTestId('timesheet-row').filter({ hasText: 'דני' });
  await expect(dani).toContainText('חסר לי שיעור פרטי');
  await dani.getByLabel('איך נסגר').fill('נבדק מול היומן, נוסף שיעור');
  await dani.getByLabel('תיקון בתלוש (₪, לא חובה)').fill('110');
  await dani.getByLabel('לאן').selectOption({ label: 'העברה מול חשבונית' });
  await dani.getByRole('button', { name: 'סגירת הבירור' }).click();
  await expect(dani).toContainText('טופל');

  await page.goto('/admin/staff/payroll');
  await page.getByRole('button', { name: 'להכין טיוטה מחדש' }).click();
  await expect(page.getByTestId('draft-payroll').getByRole('status')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('approve-payroll').click();
  await expect(page.getByTestId('payroll-run')).toContainText('אושר');
  await expect(page.getByRole('button', { name: 'לאשר משכורות' })).toHaveCount(0);
});

test('the accountant exports the approved month as a spreadsheet', async ({ page }) => {
  await page.goto('/dev/login?as=accountant');
  await page.goto('/accountant');
  const payroll = page.getByTestId('accountant-payroll');
  const link = payroll.getByRole('link', { name: 'אקסל' }).first();
  await expect(link).toBeVisible();
  const res = await page.request.get((await link.getAttribute('href')) ?? '');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('spreadsheetml');
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
});

test('AC2: the instructor takes the substitute offer and the office sees it filled', async ({
  page,
}) => {
  await page.goto('/dev/login?as=instructor');
  await page.goto('/instructor/swaps');
  const offer = page.getByTestId('my-offer').first();
  await offer.getByTestId('accept-offer').click();
  await expect(page.getByRole('status')).toContainText('השיעור שלך');
  await expect(page.getByTestId('my-offer').first()).toContainText('קיבל/ה');

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/staff/substitutes');
  await expect(page.getByTestId('substitute-requests')).toContainText('מלמד/ת: נועה');
});

test('the instructor sees last month and the hours to confirm', async ({ page }) => {
  await page.goto('/dev/login?as=instructor');
  await page.goto('/instructor/hours');
  await expect(page.getByTestId('my-month')).toHaveCount(2);
  await expect(page.getByTestId('my-statements')).toBeVisible();
});
