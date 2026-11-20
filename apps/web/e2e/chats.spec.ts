/**
 * WhatsApp track W9, end to end on fake data: a number writes on WhatsApp and shows up on the one conversations
 * screen; the owner opens the thread, takes the conversation over, answers and gives it back to the bot. A freediving
 * club's front desk opens the same screen.
 */
import { randomInt, randomUUID, sign } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { e2eGhlKey } from './ghl-key';

/** A signed GHL webhook, as WhatsApp delivers it. */
async function whatsapp(request: APIRequestContext, phone: string, body: string) {
  const raw = JSON.stringify({
    type: 'InboundMessage',
    locationId: 'demo-location-0001',
    messageId: `e2e-${randomUUID()}`,
    phone,
    body,
    messageType: 'WhatsApp',
    direction: 'inbound',
  });
  const signature = sign('sha256', Buffer.from(raw), e2eGhlKey().privateKey).toString('base64');
  const res = await request.post('/api/webhooks/ghl', {
    data: raw,
    headers: { 'content-type': 'application/json', 'x-wh-signature': signature },
  });
  expect(res.status()).toBe(200);
}

test('the owner takes a WhatsApp conversation over, answers and gives it back', async ({
  page,
  request,
}) => {
  // A fake number nobody in the demo has (058 + 7 random digits).
  const digits = String(randomInt(1_000_000, 9_999_999));
  const phone = `+97258${digits}`;
  const local = `058-${digits.slice(0, 3)}-${digits.slice(3)}`;
  const tag = randomUUID().slice(0, 4);
  await whatsapp(request, phone, `שלום, יש מקום בקבוצה? ${tag}`);

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/messages');
  await page.getByRole('link', { name: 'שיחות', exact: true }).click();
  await expect(page.getByTestId('bot-performance')).toBeVisible();
  const row = page.getByTestId('chat').filter({ hasText: local });
  await expect(row).toContainText(`יש מקום בקבוצה? ${tag}`);
  await expect(row).toContainText('לקוח חדש');

  await row.click();
  await expect(page.getByTestId('chat-line-in')).toContainText(tag);
  await expect(page.getByTestId('chat-hold')).toContainText('הבוט עונה בשיחה הזאת');
  await page.getByTestId('chat-take').click();
  await expect(page.getByTestId('chat-hold')).toContainText('הבוט שותק');

  const reply = page.getByTestId('chat-reply');
  await reply.locator('textarea[name="text"]').fill(`כן, יש מקום ביום שלישי ${tag}`);
  await reply.getByRole('button', { name: 'שליחה' }).click();
  await expect(page.getByTestId('chat-line-out').last()).toContainText(`ביום שלישי ${tag}`);
  await expect(page.getByTestId('chat-line-out').last()).toContainText('הצוות');

  await page.goto('/admin/messages/chats?show=held');
  await expect(page.getByTestId('chat').filter({ hasText: local })).toContainText('אצל אדם');
  await page.getByTestId('chat').filter({ hasText: local }).click();
  await page.getByTestId('chat-release').click();
  await expect(page.getByTestId('chat-hold')).toContainText('הבוט עונה בשיחה הזאת');
});

test('a freediving club’s front desk opens the same conversations screen', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/office');
  await page.getByTestId('all-chats').click();
  await expect(page).toHaveURL(/\/dive\/chats$/);
  await expect(page.getByTestId('bot-performance')).toBeVisible();
});
