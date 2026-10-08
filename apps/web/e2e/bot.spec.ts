/**
 * The parents' bot, end to end on fake data: a question the bot cannot answer reaches the inbox with its summary, the
 * owner answers the family, approves the answer on the bot screen, and the next family asking the same gets it from
 * the bot by itself.
 */
import { randomUUID, sign } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import { e2eGhlKey } from './ghl-key';
import { runBot } from './worker';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
const DB_URL = Object.assign(new URL(ADMIN_URL), { pathname: '/rswim_e2e' }).toString();

/** Two opted-in guardians of different families whose phones are unique. */
async function pickPhones(): Promise<string[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const r = await client.query<{ phone: string }>(
      `select distinct on (g.household_id) g.phone_e164 phone from guardians g
       join organizations o on o.id = g.organization_id and o.slug = 'rswim-demo'
       where g.whatsapp_opt_in and g.phone_e164 is not null
         and (select count(*) from guardians y where y.phone_e164 = g.phone_e164) = 1
       order by g.household_id desc limit 2`,
    );
    return r.rows.map((x) => x.phone);
  } finally {
    await client.end();
  }
}

/** A signed GHL webhook, as WhatsApp delivers it; returns the stored inbound message's id. */
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
  const { result } = (await res.json()) as { result: { inboundMessageId: string } };
  return result.inboundMessageId;
}

test('the bot hands an unknown question to the owner and learns her answer', async ({
  page,
  request,
}) => {
  const [first, second] = await pickPhones();
  const tag = randomUUID().slice(0, 4);
  const question = `איפה חונים ליד בריכה ${tag}?`;
  const asked = await whatsapp(request, first!, question);
  expect(await runBot(asked)).toMatchObject({ outcome: 'handed_off' });

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/messages');
  const item = page.getByTestId('inbox-item').filter({ hasText: question });
  await expect(item.getByTestId('inbox-bot')).toBeVisible();
  await item.getByText('תשובה', { exact: true }).first().click();
  await item.locator('textarea[name="text"]').fill(`יש חניה חינם בחניון ${tag}`);
  await item.getByRole('button', { name: 'שליחה' }).click();
  // Answered, the message leaves the open list.
  await expect(item).toHaveCount(0);

  await page.goto('/admin/messages/bot');
  const suggestion = page.getByTestId('bot-suggestion').filter({ hasText: tag });
  await suggestion.getByRole('button', { name: 'אישור והוספה למאגר' }).click();
  await expect(page.getByTestId('bot-entry').filter({ hasText: tag })).toBeVisible();

  const again = await whatsapp(request, second!, question);
  expect(await runBot(again)).toMatchObject({ outcome: 'answered' });
  await page.reload();
  await expect(
    page
      .getByTestId('bot-reply')
      .filter({ hasText: `יש חניה חינם בחניון ${tag}` })
      .first(),
  ).toHaveAttribute('data-outcome', 'answered');
});
