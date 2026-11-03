/**
 * The business brain (docs/AI-BRAIN.md) with the rules-based stand-in model (RSWIM_COPILOT_FAKE=1): the owner lets
 * payment links run on their own, the chat then sends one at once and the journal undoes it; a link above the cap
 * waits for the owner on the home page; the stop switch pauses everything. Only payment links change level here, so
 * the copilot spec's moves (which run in parallel on the same database) keep waiting for approval. Fake data only.
 */
import { expect, test, type Page } from '@playwright/test';

const STUDENT = 'אורי לוי';

const ask = async (page: Page, prompt: string) => {
  await page.goto('/admin/copilot');
  await page.getByTestId('copilot-form').locator('textarea[name="prompt"]').fill(prompt);
  await page.getByTestId('copilot-form').getByRole('button').click();
  // The copilot spec asks in parallel on the same school, so find this exchange by its words, not by a count.
  const exchange = page.getByTestId('copilot-exchange').filter({ hasText: prompt }).first();
  await expect(exchange).toBeVisible();
  return exchange;
};

const setPaymentLevel = async (page: Page, level: 'approve' | 'auto') => {
  await page.goto('/admin/brain');
  await page.getByTestId('brain-level-payment_link').selectOption(level);
  await page.getByTestId('brain-save').click();
  await expect(page.getByTestId('brain-settings').getByRole('status')).toContainText('נשמרו');
};

test('the owner lets payment links run alone, undoes one, approves above the cap and pauses', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-brain').click();
  await expect(page).toHaveURL(/\/admin\/brain$/);
  await expect(page.getByTestId('brain-status')).toHaveAttribute('data-paused', 'no');
  // Free text and cancelled lessons never run alone: "on its own" is not offered.
  await expect(
    page.getByTestId('brain-level-message_family').locator('option[value="auto"]'),
  ).toHaveCount(0);

  await setPaymentLevel(page, 'auto');
  const small = await ask(page, `תשלח קישור תשלום להורים של ${STUDENT} על 150`);
  await expect(small.getByTestId('copilot-answer')).toContainText('שלחתי');
  await expect(small.getByTestId('copilot-action')).toHaveAttribute('data-status', 'confirmed');

  await page.goto('/admin/brain/journal');
  const done = page.getByTestId('agent-action').filter({ hasText: '150' }).first();
  await expect(done).toHaveAttribute('data-status', 'confirmed');
  await expect(done).toContainText('בוצע לבד');
  await done.getByTestId('agent-undo').click();
  await expect(done).toHaveAttribute('data-status', 'undone');

  const big = await ask(page, `תשלח קישור תשלום להורים של ${STUDENT} על 900`);
  await expect(big.getByTestId('copilot-answer')).toContainText('מחכה לאישור');
  await page.goto('/admin');
  const waiting = page
    .getByTestId('home-brain-waiting')
    .getByTestId('agent-action')
    .filter({ hasText: '900' });
  await expect(waiting.getByTestId('agent-wait-reason')).toContainText('התקרה');
  await waiting.getByTestId('agent-dismiss').click();
  await expect(waiting).toHaveCount(0);

  await page.goto('/admin/brain');
  await page.getByTestId('brain-pause').click();
  await expect(page.getByTestId('brain-status')).toHaveAttribute('data-paused', 'yes');
  await page.getByTestId('brain-pause').click();
  await expect(page.getByTestId('brain-status')).toHaveAttribute('data-paused', 'no');
  await setPaymentLevel(page, 'approve');
  await expect(page.getByTestId('brain-profile-careful')).toContainText('פעיל');
});

test('the office admin cannot see or change the brain', async ({ page }) => {
  await page.goto('/dev/login?as=admin');
  await page.goto('/admin/brain');
  await expect(page.getByTestId('brain-owner-only')).toBeVisible();
  await expect(page.getByTestId('brain-settings')).toHaveCount(0);
});

test('the owner sets the WhatsApp number that approves waiting actions', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/brain');
  const card = page.getByTestId('brain-whatsapp');
  await card.locator('input[name="phone"]').fill('123');
  await card.getByTestId('brain-whatsapp-save').click();
  await expect(card.getByRole('alert')).toContainText('מספר טלפון לא תקין');
  await card.locator('input[name="phone"]').fill('050-999-0001');
  await card.getByTestId('brain-whatsapp-save').click();
  await expect(card.getByRole('status')).toContainText('המספר נשמר');
  await expect(card).toContainText('נשלחות גם לוואטסאפ');
  await page.reload();
  await expect(card.locator('input[name="phone"]')).toHaveValue('+972509990001');
});
