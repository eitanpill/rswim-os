/**
 * WhatsApp track W6: the parents' bot serves existing customers, on the fake demo tenant with the rules-based
 * stand-in. A family that asks to pay gets a payment link through the brain (once; asking again points at the open
 * link), a family with nothing open hears so, receipts come with their links, missing forms with the signing page,
 * and transport questions with the child's route. Another family's receipts never show. Families with a lesson
 * tomorrow who owe forms are reminded once a week.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import { botToolbox, FakeParentBotModel, runParentBot } from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { formsDueFor, queueFormsReminders } from '@rswim/domain-enrollment';
import { todayIL } from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const URL = 'https://app.example.test';
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, DEMO_ORG.id, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const model = new FakeParentBotModel();
let today = '';

interface Family {
  householdId: string;
  phone: string;
}
let families: Family[] = [];

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
  const actions = await q(`select * from copilot_actions where inbound_message_id = $1`, [
    intake.inboundMessageId,
  ]);
  return { run, reply, actions };
}

/** What a family's tool answers, read the way the bot reads it. */
const tool = <T>(householdId: string, name: string) =>
  system(
    async (tx) =>
      (await botToolbox(
        tx,
        worker,
        householdId,
        today,
        [],
        {
          id: randomUUID(),
          body: '',
          receivedAt: new Date(),
        },
        URL,
      ).call(name, {})) as T,
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as((tx) => todayIL(tx));
  // One guardian per phone, so the message lands on exactly one family.
  families = (
    await q(
      `select distinct on (h.id) h.id "householdId", g.phone_e164 phone
       from households h join guardians g on g.household_id = h.id and g.phone_e164 is not null
       where h.organization_id = $1
         and (select count(*) from guardians x where x.phone_e164 = g.phone_e164) = 1
         and exists (select 1 from students s where s.household_id = h.id)
       order by h.id, g.created_at`,
      [DEMO_ORG.id],
    )
  ).map((r) => ({ householdId: r.householdId, phone: r.phone }));
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the parents' bot serves existing customers (W6)", () => {
  it('sends a payment link for the open balance through the brain, once', async () => {
    let debtor: Family | undefined;
    for (const f of families) {
      const open = await q(
        `select 1 from payment_links where household_id = $1 and status = 'open'`,
        [f.householdId],
      );
      if (open.length) continue;
      const b = await tool<{ balanceAgorot: number }>(f.householdId, 'family_balance');
      if (b.balanceAgorot > 0) {
        debtor = f;
        break;
      }
    }
    expect(debtor).toBeDefined();
    const f = debtor as Family;
    const r = await write(f.phone, 'אפשר לקבל קישור לתשלום?');
    expect(r.run.outcome).toBe('answered');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ kind: 'payment_link', source: 'parent_whatsapp' });
    const links = await q(
      `select amount_agorot from payment_links where household_id = $1 and status = 'open'`,
      [f.householdId],
    );
    if (r.actions[0].status === 'confirmed') {
      expect(links).toHaveLength(1);
      expect(r.reply.answer).toContain('קישור לתשלום');
      // Asking again does not open a second link.
      const again = await write(f.phone, 'רוצה לשלם');
      expect(again.actions).toHaveLength(0);
      expect(again.run.outcome).toBe('answered');
      expect(
        await q(`select 1 from payment_links where household_id = $1 and status = 'open'`, [
          f.householdId,
        ]),
      ).toHaveLength(1);
    } else {
      // The owner's settings may hold a link over her automatic limit: it waits for her.
      expect(r.actions[0].status).toBe('proposed');
      expect(r.reply.answer).toContain('המשרד יאשר');
    }
  });

  it('tells a family with nothing open that there is nothing to pay', async () => {
    let clear: Family | undefined;
    for (const f of families) {
      const open = await q(
        `select 1 from payment_links where household_id = $1 and status = 'open'`,
        [f.householdId],
      );
      if (open.length) continue;
      const b = await tool<{ balanceAgorot: number }>(f.householdId, 'family_balance');
      if (b.balanceAgorot <= 0) {
        clear = f;
        break;
      }
    }
    expect(clear).toBeDefined();
    const r = await write((clear as Family).phone, 'איך אפשר לשלם?');
    expect(r.actions).toHaveLength(0);
    expect(r.reply.answer).toContain('אין מה לשלם');
  });

  it("sends the family's receipts with their links, and never another family's", async () => {
    const [f, other] = families as [Family, Family];
    const [doc] = await q(
      `insert into fiscal_documents (organization_id, household_id, status, provider, number, total_agorot,
         request, idempotency_key, issued_at)
       values ($1, $2, 'issued', 'fake', '40071', 32000, '{}', $3, now()) returning id`,
      [DEMO_ORG.id, f.householdId, `test:${randomUUID()}`],
    );
    const r = await write(f.phone, 'אפשר לקבל את הקבלה האחרונה?');
    expect(r.run.outcome).toBe('answered');
    expect(r.reply.answer).toContain(`${URL}/parent/receipts/${doc.id}`);
    expect(r.reply.answer).toContain('40071');
    const theirs = await tool<{ id: string }[]>(other.householdId, 'family_receipts');
    expect(theirs.map((d) => d.id)).not.toContain(doc.id);
  });

  it('lists the forms still to sign with the signing page', async () => {
    const f = families[2] as Family;
    const { due } = await system((tx) => formsDueFor(tx, f.householdId));
    const r = await write(f.phone, 'אילו טפסים חסרים לנו?');
    expect(r.run.outcome).toBe('answered');
    if (due.length) expect(r.reply.answer).toContain(`${URL}/parent/documents`);
    else expect(r.reply.answer).toContain('כל הטפסים חתומים');
  });

  it("answers a transport question with the child's route", async () => {
    const [rider] = await q(
      `select h.id "householdId", g.phone_e164 phone, r.name route
       from route_riders rr join transport_routes r on r.id = rr.route_id and r.active
       join students st on st.id = rr.student_id join households h on h.id = st.household_id
       join guardians g on g.household_id = h.id and g.phone_e164 is not null
       where rr.ends_on is null and rr.starts_on <= $1::date and h.organization_id = $2
         and (select count(*) from guardians x where x.phone_e164 = g.phone_e164) = 1
       limit 1`,
      [today, DEMO_ORG.id],
    );
    expect(rider).toBeDefined();
    const r = await write(rider.phone, 'מתי יוצאת ההסעה היום?');
    expect(r.run.outcome).toBe('answered');
    expect(r.reply.answer).toContain(rider.route);
  });

  it('reminds families with a lesson tomorrow who owe forms, once a week', async () => {
    // A lesson day ahead on which some family with a lesson still owes forms.
    let day = '';
    for (const [d] of (
      await q(
        `select distinct s.date::text d from sessions s
         where s.date > $1::date and s.status = 'scheduled' and s.organization_id = $2
         order by 1 limit 10`,
        [today, DEMO_ORG.id],
      )
    ).map((r) => [r.d as string])) {
      const n = await system((tx) => queueFormsReminders(tx, worker, `${URL}/`, d));
      if (n > 0) {
        day = d as string;
        break;
      }
    }
    expect(day).not.toBe('');
    const first = (await q(`select 1 from outbox where event_type = 'enrollment.forms_reminder'`))
      .length;
    const rows = await q(
      `select payload from outbox where event_type = 'enrollment.forms_reminder' order by created_at`,
    );
    expect(rows).toHaveLength(first);
    for (const r of rows) {
      expect(r.payload.url).toBe(`${URL}/parent/documents`);
      expect(r.payload.forms.length).toBeGreaterThan(0);
      const { due } = await system((tx) => formsDueFor(tx, r.payload.householdId));
      expect(due.length).toBeGreaterThan(0);
    }
    await system((tx) => queueFormsReminders(tx, worker, URL, day));
    expect(
      await q(`select 1 from outbox where event_type = 'enrollment.forms_reminder'`),
    ).toHaveLength(first);
  });
});
