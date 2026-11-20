/**
 * The bot's personal invite (WhatsApp track): the link opens the school's page made for this person, with their
 * number half hidden and a sign-in that has it ready; a made-up link shows that it is not known. Every phone is fake.
 */
import { expect, test } from '@playwright/test';
import { leadWithInvite } from './worker';

test("a new customer's invite opens the school with their phone ready", async ({ page }) => {
  const token = await leadWithInvite('+972585550041', 'נטע ברק');
  await page.goto(`/i/${token}`);
  await expect(page.getByTestId('join-school')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('נטע, הוזמנת להצטרף');
  await expect(page.getByTestId('invite-how')).toContainText('058-***-0041');
  await page.getByTestId('invite-sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/login/phone\\?invite=${token}`));
  await expect(page.locator('input[name="phone"]')).toHaveValue('0585550041');
  await expect(page.locator('input[name="invite"]')).toHaveValue(token);

  await page.goto('/i/AbCdEf0123456789_-not-a-real-invite');
  await expect(page.getByTestId('invite-unknown')).toBeVisible();
});
