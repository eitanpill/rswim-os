/**
 * Phase 8 courses, camps and institutions in the office (demo seed, all fake): the camp week shows its staff ratio,
 * the course roster prints with the children and their parents, and the school's September invoice takes the rest of
 * its payment and is paid. The attendance report lists the pupils against September's lessons.
 */
import { expect, test } from '@playwright/test';

test('the office runs a camp week, prints a course roster and collects an institution invoice', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');

  await page.goto('/admin/cohorts');
  const camp = page.getByTestId('cohort').filter({ hasText: 'קייטנת קיץ' });
  await expect(camp.getByTestId('cohort-ratio')).toContainText('יחס צוות תקין');

  await page.getByRole('link', { name: 'קורס חנוכה מרוכז' }).click();
  await expect(page.getByTestId('cohort-member')).toHaveCount(4);
  await expect(page.getByTestId('cohort-groups').locator('li')).toHaveCount(2);
  await page.getByTestId('roster-link').click();
  await expect(page.getByTestId('roster-row')).toHaveCount(4);
  await expect(page.getByTestId('roster')).toContainText('כהן');

  await page.goto('/admin/institutions');
  await expect(page.getByTestId('institution-debts')).toContainText('360');
  await page.getByRole('link', { name: 'בית ספר אופק (דמו)' }).first().click();
  const september = page.getByTestId('institution-invoice').filter({ hasText: '09/2026' });
  await expect(september).toHaveAttribute('data-state', /partial|overdue/);
  await september.getByTestId('institution-payment').getByRole('button').click();
  await expect(
    page.getByTestId('institution-invoice').filter({ hasText: '09/2026' }),
  ).toHaveAttribute('data-state', 'paid');

  await page.goto(
    (await page.getByTestId('attendance-report').first().getAttribute('href'))!.replace(
      /\d{4}-\d{2}$/,
      '2026-09',
    ),
  );
  await expect(page.getByTestId('report-row')).toHaveCount(6);
});
