/**
 * WhatsApp track W6, second part: a freediving club's registered diver on WhatsApp, on the fake Eilat club with the
 * rules-based stand-in. The bot lists what the diver can book, books the one picked (a pass covers it, or the place
 * is held with a payment link), shows their coming dives, passes and missing forms, hands a sensitive message to the
 * desk, and never books a session the diver's own app would not offer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@rswim/db';
import { DIVE_ORG } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import { diverToolbox, FakeParentBotModel, runParentBot } from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { diverPaperwork } from '@rswim/domain-dive';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DIVE_ORG.id, userId: null };
const URL = 'https://app.example.test';
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, DIVE_ORG.id, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const model = new FakeParentBotModel();

interface Open {
  sessionId: string;
  title: string;
  priceAgorot: number;
}
interface Diver {
  id: string;
  phone: string;
  open: Open[];
}
const divers: Diver[] = [];

const tool = <T>(diverId: string, name: string, input: unknown = {}) =>
  system(async (tx) => (await diverToolbox(tx, worker, diverId, [], URL).call(name, input)) as T);

async function write(phone: string, body: string) {
  const intake = await system((tx) =>
    intakeInbound(tx, worker, {
      provider: 'ghl',
      externalId: randomUUID(),
      phoneE164: phone,
      ghlContactId: null,
      body,
      receivedAt: new Date(),
    }),
  );
  if (intake.outcome !== 'stored') throw new Error('not stored');
  const run = await system((tx) =>
    runParentBot(tx, worker, model, intake.inboundMessageId, { publicUrl: `${URL}/` }),
  );
  const [reply] = await q(`select * from bot_replies where inbound_message_id = $1`, [
    intake.inboundMessageId,
  ]);
  const [inbound] = await q(`select status, lead_id from inbound_messages where id = $1`, [
    intake.inboundMessageId,
  ]);
  return { run, reply, inbound };
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  // Divers with their own phone and something to book.
  const rows = await q(
    `select d.id, d.phone_e164 phone from dive_divers d
     where d.organization_id = $1 and d.phone_e164 is not null
       and (select count(*) from dive_divers x where x.phone_e164 = d.phone_e164) = 1
       and not exists (select 1 from guardians g where g.phone_e164 = d.phone_e164)
       and not exists (select 1 from staff_members s where s.phone_e164 = d.phone_e164)
     order by d.created_at, d.id limit 40`,
    [DIVE_ORG.id],
  );
  for (const r of rows) {
    const open = await tool<Open[]>(r.id, 'open_sessions');
    if (open.length) divers.push({ id: r.id, phone: r.phone, open });
    if (divers.length >= 6) break;
  }
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the divers' bot (W6)", () => {
  it('lists what the diver can book and does not open a lead for them', async () => {
    expect(divers.length).toBeGreaterThanOrEqual(3);
    const d = divers[0]!;
    const r = await write(d.phone, 'מה פנוי השבוע?');
    expect(r.run.outcome).toBe('answered');
    expect(r.inbound.lead_id).toBeNull();
    expect(r.reply.diver_id).toBe(d.id);
    expect(r.reply.answer).toContain(d.open[0]!.title);
    expect(r.reply.answer).toContain('להזמין');
  });

  it('books the session picked: held with a payment link, or confirmed by a pass', async () => {
    const d = divers[1]!;
    const pick = d.open[0]!;
    const r = await write(d.phone, 'להזמין 1');
    expect(r.run.outcome).toBe('answered');
    const [b] = await q(
      `select id, status, booked_via from dive_bookings where diver_id = $1 and session_id = $2`,
      [d.id, pick.sessionId],
    );
    expect(b.booked_via).toBe('office');
    if (b.status === 'pending_payment') {
      expect(r.reply.answer).toContain(`${URL}/dive/me/pay/${b.id}`);
      // Their coming dives show it with the same link.
      const mine = await write(d.phone, 'מתי הצלילה הבאה שלי?');
      expect(mine.reply.answer).toContain(`${URL}/dive/me/pay/${b.id}`);
    } else {
      expect(b.status).toBe('booked');
      expect(r.reply.answer).toContain('נרשמת');
    }
    // The session is no longer offered to them.
    const after = await tool<Open[]>(d.id, 'open_sessions');
    expect(after.map((s) => s.sessionId)).not.toContain(pick.sessionId);
  });

  it('refuses a session the app would not offer the diver', async () => {
    const d = divers[2]!;
    const [past] = await q(
      `select id from dive_sessions where organization_id = $1 and starts_at < now() limit 1`,
      [DIVE_ORG.id],
    );
    await expect(tool(d.id, 'book_dive', { sessionId: past.id })).rejects.toThrow();
    await expect(tool(d.id, 'book_dive', { sessionId: 'nope' })).rejects.toThrow();
  });

  it('answers about forms and passes from the diver’s own file', async () => {
    const d = divers[2]!;
    const p = await system((tx) => diverPaperwork(tx, d.id));
    const forms = await write(d.phone, 'אילו טפסים חסרים לי?');
    expect(forms.run.outcome).toBe('answered');
    if (p.toSign.length) expect(forms.reply.answer).toContain(`${URL}/dive/me/forms`);
    else expect(forms.reply.answer).toContain('חתומים');
    const passes = await write(d.phone, 'כמה נשאר לי בכרטיסייה?');
    expect(passes.run.outcome).toBe('answered');
    expect(passes.reply.answer).toMatch(/כרטיסייה|מנוי/);
  });

  it('hands a sensitive message and an unknown question to the desk', async () => {
    const d = divers[0]!;
    const hurt = await write(d.phone, 'נפצעתי באוזן בצלילה אתמול');
    expect(hurt.run.outcome).toBe('handed_off');
    expect(hurt.reply.handoff_reason).toBe('sensitive');
    expect(hurt.inbound.status).toBe('needs_human');
    const other = await write(d.phone, 'יש לכם חליפות להשכרה?');
    expect(other.run.outcome).toBe('handed_off');
  });
});
