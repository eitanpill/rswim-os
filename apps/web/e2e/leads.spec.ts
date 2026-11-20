/**
 * WhatsApp track, stage 1, end to end on fake data: a number the school does not know writes on WhatsApp and lands
 * on the owner's "new enquiries" board by itself; she opens it, answers on WhatsApp and the lead moves to "talking";
 * a lead from a phone call is written down by hand and dropped with a reason. A freediving club's front desk shows
 * the same list.
 */
import { randomInt, randomUUID, sign } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { e2eGhlKey } from './ghl-key';
import { runBotOnLatest } from './worker';

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

  // The month's sources report counts the phone call.
  await page.goto('/admin/leads');
  const sources = page.getByTestId('lead-sources');
  await expect(sources.getByTestId('lead-source-phone')).toBeVisible();
  await sources.getByTestId('lead-sources-prev').click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(page.getByTestId('lead-sources')).toBeVisible();
});

test('the freediving club front desk shows the same lead list', async ({ page }) => {
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/office');
  const leads = page.getByTestId('leads');
  await expect(leads).toContainText('בשיחה');
  await expect(leads).toContainText('נרשמו');
  await expect(leads.getByTestId('lead').first()).toBeVisible();
});

test('the bot answers a new customer and collects their details one question at a time', async ({
  page,
  request,
}) => {
  const digits = String(randomInt(1_000_000, 9_999_999));
  const phone = `+97258${digits}`;
  await whatsapp(request, phone, 'היי');
  expect(await runBotOnLatest(phone)).toMatchObject({ outcome: 'answered' });
  await whatsapp(request, phone, 'קוראים לי שירה');
  await runBotOnLatest(phone);
  await whatsapp(request, phone, 'כמה עולה? הבן שלי בן 6');
  await runBotOnLatest(phone);

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/leads');
  const card = page
    .getByTestId('lead-column-talking')
    .getByTestId('lead')
    .filter({ hasText: 'שירה' });
  await card.getByTestId('lead-open').click();
  await expect(page.getByTestId('lead-message-out').first()).toContainText('איך קוראים לך');
  await expect(page.getByTestId('lead-message-out').last()).toContainText('₪');
  await expect(page.getByTestId('lead-bot-details')).toContainText('6');

  await page.goto('/admin/messages/bot');
  await expect(page.getByTestId('bot-leads')).toContainText('עונה גם ללקוחות חדשים');
  await expect(page.getByText('לקוח/ה חדש/ה: שירה').first()).toBeVisible();
});

test('the bot books a trial a new customer chose, and the owner approves it', async ({
  page,
  request,
}) => {
  page.on('dialog', (d) => void d.accept());
  const digits = String(randomInt(1_000_000, 9_999_999));
  const phone = `+97258${digits}`;
  // A unique Hebrew name: the digits as letters.
  const child = `תמר${[...digits.slice(-3)].map((d) => 'אבגדהוזחטי'[Number(d)]).join('')}`;
  await whatsapp(request, phone, 'קוראים לי מיכל אברהם');
  await runBotOnLatest(phone);
  await whatsapp(request, phone, 'אפשר לקבוע שיעור ניסיון?');
  await runBotOnLatest(phone);
  // A five-year-old: the demo has mixed groups with places for that age.
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 5);
  await whatsapp(
    request,
    phone,
    `${child} ${dob.getDate()}.${dob.getMonth() + 1}.${dob.getFullYear()}`,
  );
  await runBotOnLatest(phone);
  await whatsapp(request, phone, '1');
  await runBotOnLatest(phone);

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/brain/journal');
  const action = page.getByTestId('agent-action').filter({ hasText: child }).first();
  await expect(action).toContainText('שיעור ניסיון');
  if ((await action.getAttribute('data-status')) === 'proposed')
    await action.getByTestId('agent-approve').click();
  await expect(action).toHaveAttribute('data-status', 'confirmed');

  await page.goto('/admin/leads');
  await expect(
    page
      .getByTestId('lead-column-trial_booked')
      .getByTestId('lead')
      .filter({ hasText: 'מיכל אברהם' }),
  ).toBeVisible();
});
