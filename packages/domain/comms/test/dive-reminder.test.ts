/**
 * The freediving day-before reminder: the club reminds every diver booked for tomorrow once (whatever the reruns),
 * and the automation renders the time, the session and the site for the diver's household, with a payment nudge
 * when the seat is still held for payment. Every person and phone number is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import type { ServiceContext } from '@rswim/domain-core';
import { queueSessionReminders } from '@rswim/domain-dive';
import { runAutomation } from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const id = {} as { dana: string; ron: string; tomorrow: string; later: string; bDana: string };
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0].id as string;
const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(t.db, ctx.orgId, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  const org = await one(
    `insert into organizations (slug, name, vertical) values ('reef', 'מועדון דמו', 'freediving') returning id`,
  );
  ctx = { orgId: org, userId: null };
  await q(`insert into org_settings (organization_id) values ($1)`, [org]);
  const hh = await one(
    `insert into households (organization_id, display_name) values ($1, 'דנה (דמו)') returning id`,
    [org],
  );
  const g = await one(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, whatsapp_opt_in)
     values ($1, $2, 'דנה', 'דמו', '+972501234567', true) returning id`,
    [org, hh],
  );
  id.dana = await one(
    `insert into dive_divers (organization_id, guardian_id, first_name, last_name) values ($1, $2, 'דנה', 'דמו') returning id`,
    [org, g],
  );
  id.ron = await one(
    `insert into dive_divers (organization_id, first_name, last_name) values ($1, 'רון', 'דמו') returning id`,
    [org],
  );
  const site = await one(
    `insert into dive_sites (organization_id, name, kind, max_depth_m) values ($1, 'המגדלור', 'shore', 40) returning id`,
    [org],
  );
  const program = await one(
    `insert into dive_programs (organization_id, code, name_he, name_en, kind, price_agorot)
     values ($1, 'line', 'אימון חבלים', 'Line training', 'training', 18000) returning id`,
    [org],
  );
  const session = (days: number) =>
    one(
      `insert into dive_sessions (organization_id, program_id, site_id, starts_at, ends_at, capacity)
       values ($1, $2, $3, ((app.today() + $4::int) + time '09:00') at time zone 'Asia/Jerusalem',
               ((app.today() + $4::int) + time '11:00') at time zone 'Asia/Jerusalem', 6) returning id`,
      [org, program, site, days],
    );
  id.tomorrow = await session(1);
  id.later = await session(3);
  const book = (session: string, diver: string, status = 'booked') =>
    one(
      `insert into dive_bookings (organization_id, session_id, diver_id, status, hold_until)
       values ($1, $2, $3, $4, case when $4 = 'pending_payment' then now() + interval '2 days' end) returning id`,
      [org, session, diver, status],
    );
  id.bDana = await book(id.tomorrow, id.dana, 'pending_payment');
  await book(id.tomorrow, id.ron);
  await book(id.later, id.dana);
});
afterAll(async () => {
  await t.drop();
});

describe('the day-before dive reminder', () => {
  it('queues one reminder per booking for tomorrow, once however often it runs', async () => {
    expect(await system((tx) => queueSessionReminders(tx, ctx))).toBe(2);
    await system((tx) => queueSessionReminders(tx, ctx));
    const events = await q(
      `select payload from outbox where organization_id = $1 and event_type = 'dive.session_reminder'`,
      [ctx.orgId],
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload.sessionId)).not.toContain(id.later);
  });

  it("messages the diver's household with when, what and where, and nudges an unpaid seat", async () => {
    const [ev] = await q(
      `select id, event_type, payload from outbox where event_type = 'dive.session_reminder' and payload->>'bookingId' = $1`,
      [id.bDana],
    );
    const r = await system((tx) =>
      runAutomation(tx, ctx, { id: ev.id, type: ev.event_type, payload: ev.payload }),
    );
    expect(r).toMatchObject({ outcome: 'done', queued: 1 });
    const [m] = await q(`select body, template_key from messages where organization_id = $1`, [
      ctx.orgId,
    ]);
    expect(m.template_key).toBe('dive_reminder');
    expect(m.body).toContain('היי דנה');
    expect(m.body).toContain('09:00');
    expect(m.body).toContain('אימון חבלים');
    expect(m.body).toContain('המגדלור');
    expect(m.body).toContain('לשלם');
  });

  it('sends nothing for a diver with no household to reach', async () => {
    const [ev] = await q(
      `select id, event_type, payload from outbox where event_type = 'dive.session_reminder' and payload->>'bookingId' <> $1`,
      [id.bDana],
    );
    const r = await system((tx) =>
      runAutomation(tx, ctx, { id: ev.id, type: ev.event_type, payload: ev.payload }),
    );
    expect(r).toMatchObject({ outcome: 'done', queued: 0, blocked: 0 });
  });
});
