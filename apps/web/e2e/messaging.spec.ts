/**
 * Phase 5 acceptance, end to end: a known guardian's WhatsApp "<child> לא יגיע ב-<date>" arrives as a signed GHL
 * webhook, becomes a pre-filled absence draft before the webhook is answered (well under 5 seconds), and one tap in
 * the inbox records the absence. Every person is fake (demo seed); the signing key is a throwaway generated locally.
 */
import { randomUUID, sign } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { e2eGhlKey } from './ghl-key';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
const DB_URL = Object.assign(new URL(ADMIN_URL), { pathname: '/rswim_e2e' }).toString();

interface Pick {
  student_id: string;
  first_name: string;
  phone: string;
  session_id: string;
  date: string;
}

/**
 * A boy who is his household's only child, with an opted-in guardian and a lesson 2–20 days ahead that has no
 * absence notice yet (so a retry picks a fresh lesson).
 */
async function pickLesson(): Promise<Pick> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const r = await client.query<Pick>(
      `select s.id student_id, s.first_name, g.phone_e164 phone, se.id session_id, se.date::text date
       from students s
       join guardians g on g.household_id = s.household_id and g.whatsapp_opt_in and g.phone_e164 is not null
       join enrollments e on e.student_id = s.id and e.status = 'active'
       join sessions se on se.class_template_id = e.class_template_id and se.status = 'scheduled'
       join organizations o on o.id = s.organization_id and o.slug = 'rswim-demo'
       where s.gender = 'male'
         and (select count(*) from students x where x.household_id = s.household_id) = 1
         and (select count(*) from guardians y where y.phone_e164 = g.phone_e164) = 1
         and se.date between (now() at time zone 'Asia/Jerusalem')::date + 2
                         and (now() at time zone 'Asia/Jerusalem')::date + 20
         and not exists (select 1 from absence_notices a where a.session_id = se.id and a.student_id = s.id)
         and not exists (select 1 from sessions se2 where se2.date = se.date and se2.id <> se.id
                           and se2.class_template_id in (select class_template_id from enrollments where student_id = s.id and status = 'active'))
       order by se.date, s.first_name limit 1`,
    );
    const row = r.rows[0];
    if (!row) throw new Error('no lesson to report an absence for');
    return row;
  } finally {
    await client.end();
  }
}

async function absenceCount(studentId: string, sessionId: string): Promise<number> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const r = await client.query<{ n: number }>(
      `select count(*)::int n from absence_notices where student_id = $1 and session_id = $2 and channel = 'whatsapp'`,
      [studentId, sessionId],
    );
    return r.rows[0]?.n ?? 0;
  } finally {
    await client.end();
  }
}

test('AC1: a WhatsApp "won\'t come" becomes a one-tap absence', async ({ page, request }) => {
  const lesson = await pickLesson();
  const [, m, d] = lesson.date.split('-').map(Number) as [number, number, number];
  const raw = JSON.stringify({
    type: 'InboundMessage',
    locationId: 'demo-location-0001',
    messageId: `e2e-${randomUUID()}`,
    phone: lesson.phone,
    body: `שלום, ${lesson.first_name} לא יגיע ב-${d}.${m}, תודה`,
    messageType: 'WhatsApp',
    direction: 'inbound',
  });
  const signature = sign('sha256', Buffer.from(raw), e2eGhlKey().privateKey).toString('base64');

  const started = Date.now();
  const res = await request.post('/api/webhooks/ghl', {
    data: raw,
    headers: { 'content-type': 'application/json', 'x-wh-signature': signature },
  });
  expect(res.status()).toBe(200);
  const { result } = (await res.json()) as { result: { status: string; actionId: string | null } };
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(result.actionId).not.toBeNull();

  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/messages');
  const item = page.getByTestId('inbox-item').filter({ hasText: `${lesson.first_name} לא יגיע` });
  await expect(item.getByTestId('triage-action')).toContainText(`${d}.${m}`);
  await item.getByTestId('approve-action').click();
  await expect(item.getByTestId('approve-action')).toHaveCount(0);
  await expect.poll(() => absenceCount(lesson.student_id, lesson.session_id)).toBe(1);
});
