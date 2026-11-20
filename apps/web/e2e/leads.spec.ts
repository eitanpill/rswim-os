/**
 * WhatsApp track, stage 1, end to end on fake data: a number the school does not know writes on WhatsApp and lands
 * on the owner's "new enquiries" board by itself; she opens it, answers on WhatsApp and the lead moves to "talking";
 * a lead from a phone call is written down by hand and dropped with a reason. A freediving club's front desk shows
 * the same list.
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

test('a new number on WhatsApp becomes a lead the owner answers', async ({ page, request }) => {
  // A fake number nobody in the demo has (058 + 7 random digits).
  const digits = String(randomInt(1_000_000, 9_999_999));
  const phone = `+97258${digits}`;
  const local = `058-${digits.slice(0, 3)}-${digits.slice(3)}`;
  const tag = randomUUID().slice(0, 4);
  await whatsapp(request, phone, `היי, יש חוג לגיל 7 בימי ראשון? ${tag}`);
  await whatsapp(request, phone, `ומה המחיר? ${tag}`);

  await page.goto('/dev/login?as=owner');
  await expect(page.getByTestId('home-leads')).toBeVisible();
  await page.goto('/admin/leads');
  const card = page.getByTestId('lead-column-new').getByTestId('lead').filter({ hasText: local });
  await expect(card).toContainText(`ומה המחיר? ${tag}`);
  await expect(card).toContainText('2 הודעות');

  await card.getByTestId('lead-open').click();
  await expect(page.getByTestId('lead-message-in')).toHaveCount(2);
  const reply = page.getByTestId('lead-reply');
  await reply.locator('textarea[name="text"]').fill(`בשמחה! יש קבוצה בראשון ב-17:00 ${tag}`);
  await reply.getByRole('button', { name: 'שליחה' }).click();
  await expect(page.getByTestId('lead-message-out')).toContainText(`ב-17:00 ${tag}`);
  await expect(page.getByTestId('lead-stage')).not.toContainText('דיברנו');

  await page.goto('/admin/leads');
  await expect(
    page.getByTestId('lead-column-talking').getByTestId('lead').filter({ hasText: local }),
  ).toBeVisible();
});

test('a phone call is written down by hand and dropped with a reason', async ({ page }) => {
  const name = `ליד טלפוני ${randomUUID().slice(0, 4)}`;
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/leads');
  await page.getByTestId('lead-new-toggle').click();
  const form = page.getByTestId('lead-new');
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="interest"]').fill('שיעור פרטי');
  await form.getByRole('button', { name: 'הוספה' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  const lost = page.getByTestId('lead-lost');
  await lost.locator('select[name="lostReason"]').selectOption('price');
  await lost.getByRole('button').click();
  await expect(page.getByText('ירד/ה: המחיר')).toBeVisible();
});

test('the freediving club front desk shows the same lead list', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/office');
  const leads = page.getByTestId('leads');
  await expect(leads).toContainText('בשיחה');
  await expect(leads).toContainText('נרשמו');
  await expect(leads.getByTestId('lead').first()).toBeVisible();
});
