/**
 * Phase 9 owner copilot with the rules-based stand-in model (RSWIM_COPILOT_FAKE=1): the owner asks in Hebrew, sees a
 * proposal that changes nothing until confirmed, confirms the move, undoes it, and sends a family message. Other staff
 * cannot use it. The child and groups are fake demo seed data.
 */
import { expect, test, type Page } from '@playwright/test';

const STUDENT = 'אורי לוי';
const GROUP = 'אופק – כיתות ג׳';

const ask = async (page: Page, prompt: string) => {
  const before = await page.getByTestId('copilot-exchange').count();
  await page.getByTestId('copilot-form').locator('textarea[name="prompt"]').fill(prompt);
  await page.getByTestId('copilot-form').getByRole('button').click();
  await expect(page.getByTestId('copilot-exchange')).toHaveCount(before + 1);
  return page.getByTestId('copilot-exchange').filter({ hasText: prompt }).first();
};

test('the owner confirms, undoes and messages through the copilot', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-copilot').click();
  await expect(page).toHaveURL(/\/admin\/copilot$/);

  const move = await ask(page, `תעביר את ${STUDENT} ל${GROUP}`);
  await expect(move.getByTestId('copilot-answer')).toContainText('מחכה לאישור');
  const action = move.getByTestId('copilot-action');
  await expect(action).toHaveAttribute('data-status', 'proposed');
  await expect(action).toContainText(GROUP);
  await action.getByTestId('copilot-confirm').click();
  await expect(action).toHaveAttribute('data-status', 'confirmed');
  await action.getByTestId('copilot-undo').click();
  await expect(action).toHaveAttribute('data-status', 'undone');

  const message = await ask(
    page,
    `תשלח להורים של ${STUDENT}: השיעור מתחיל חצי שעה מאוחר יותר (דמו)`,
  );
  const send = message.getByTestId('copilot-action');
  await expect(send).toHaveAttribute('data-status', 'proposed');
  await send.getByTestId('copilot-confirm').click();
  await expect(send).toHaveAttribute('data-status', 'confirmed');
  await expect(send.getByTestId('copilot-undo')).toHaveCount(0);

  const debts = await ask(page, 'מי חייב?');
  await expect(debts.getByTestId('copilot-answer')).toContainText(/החובות הגדולים|אין חובות/);
});

test('the office admin cannot use the copilot', async ({ page }) => {
  await page.goto('/dev/login?as=admin');
  await page.goto('/admin/copilot');
  await expect(page.getByTestId('copilot-off')).toBeVisible();
  await expect(page.getByTestId('copilot-form')).toHaveCount(0);
});
