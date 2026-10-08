/**
 * The parents' WhatsApp bot on the fake demo tenant, with the rules-based stand-in model: it answers a family from
 * their own lessons, hands sensitive and unknown questions to the office with a note to the family, learns from the
 * office's answer once approved, and stays out of the way when turned off.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound, listInbox, replyToInbound } from '@rswim/domain-comms';
import {
  botToolbox,
  FakeParentBotModel,
  listBotReplies,
  listKnowledge,
  reviewBotReply,
  runParentBot,
  saveKnowledge,
  setKnowledgeStatus,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const office: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(who: keyof typeof PERSONAS, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS[who].userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const model = new FakeParentBotModel();

/** Two families with a phone and a child with a lesson in the next two weeks. */
const fam: { householdId: string; phone: string; child: string }[] = [];
let today = '';

/** A family writes on WhatsApp: the inbox stores it, then the bot runs as the worker would. */
async function write(i: number, body: string) {
  const f = fam[i]!;
  const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
    intakeInbound(tx, worker, {
      provider: 'ghl',
      externalId: randomUUID(),
      phoneE164: f.phone,
      ghlContactId: null,
      body,
      receivedAt: new Date(),
    }),
  );
  if (intake.outcome !== 'stored') throw new Error('not stored');
  const run = await withOrg(t.db, DEMO_ORG.id, (tx) =>
    runParentBot(tx, worker, model, intake.inboundMessageId),
  );
  const [reply] = await q(`select * from bot_replies where inbound_message_id = $1`, [
    intake.inboundMessageId,
  ]);
  const [inbound] = await q(`select status from inbound_messages where id = $1`, [
    intake.inboundMessageId,
  ]);
  const sent = reply?.message_id
    ? (await q(`select template_key, body from messages where id = $1`, [reply.message_id]))[0]
    : null;
  return { id: intake.inboundMessageId, run, reply, status: inbound.status as string, sent };
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as('owner', (tx) => todayIL(tx));
  const rows = await q(
    `select distinct on (h.id) h.id household_id, g.phone_e164 phone, st.first_name child
     from households h join guardians g on g.household_id = h.id and g.phone_e164 is not null
     join students st on st.household_id = h.id
     join enrollments e on e.student_id = st.id and e.status = 'active'
     join sessions s on s.class_template_id = e.class_template_id and s.status = 'scheduled'
       and s.date between $1::date and $1::date + 13 and s.starts_at > now()
       and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)
     where (select count(*) from guardians x where x.phone_e164 = g.phone_e164) = 1
     order by h.id, g.created_at limit 2`,
    [today],
  );
  for (const r of rows) fam.push({ householdId: r.household_id, phone: r.phone, child: r.child });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("parents' bot", () => {
  it("answers a family's question from their own lessons and closes the message", async () => {
    expect(fam).toHaveLength(2);
    const r = await write(0, 'מתי השיעור הבא?');
    expect(r.run.outcome).toBe('answered');
    expect(r.reply).toMatchObject({ outcome: 'answered', model: 'fake:rules' });
    expect(r.reply.answer).toContain(`השיעור הבא של ${fam[0]!.child}`);
    expect(r.sent).toMatchObject({ template_key: 'free_text', body: r.reply.answer });
    expect(r.status).toBe('actioned');
    // Running again on the same message does nothing.
    const again = await withOrg(t.db, DEMO_ORG.id, (tx) => runParentBot(tx, worker, model, r.id));
    expect(again).toEqual({ outcome: 'skipped', reason: 'already' });
  });

  it("reads only the writing family's data", async () => {
    const lessons = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      botToolbox(tx, fam[0]!.householdId, today, []).call('family_lessons', {}),
    );
    const children = (
      await q(`select first_name from students where household_id = $1`, [fam[0]!.householdId])
    ).map((c) => c.first_name);
    expect((lessons as { child: string }[]).length).toBeGreaterThan(0);
    for (const l of lessons as { child: string }[]) expect(children).toContain(l.child);
  });

  it('hands a sensitive message to the office without asking the model, and tells the family once', async () => {
    const r = await write(1, 'שאלה רפואית: יש לה אלרגיה לכלור, מה עושים?');
    expect(r.reply).toMatchObject({
      outcome: 'handed_off',
      handoff_reason: 'sensitive',
      model: 'rules',
      trace: [],
    });
    expect(r.status).toBe('needs_human');
    expect(r.sent?.template_key).toBe('bot_handoff');
    expect(r.sent?.body).toContain('נחזור אליך');
    // A second handed-off message soon after gets no second note.
    const r2 = await write(1, 'ועוד שאלה: אפשר לבוא עם סבתא?');
    expect(r2.reply).toMatchObject({ outcome: 'handed_off', handoff_reason: 'unknown' });
    expect(r2.reply.message_id).toBeNull();
    const inbox = await as('owner', (tx) => listInbox(tx, { status: 'open' }));
    expect(inbox.find((m) => m.id === r2.id)?.bot?.handoffSummary).toContain('סבתא');
  });

  it("learns from the office's answer once approved, and then answers by itself", async () => {
    const r = await write(1, 'איפה חונים ליד הבריכה?');
    expect(r.reply).toMatchObject({ outcome: 'handed_off', handoff_reason: 'unknown' });
    await as('owner', (tx) =>
      replyToInbound(tx, office, {
        inboundMessageId: r.id,
        text: 'יש חניה חינם בחניון הקאנטרי, ממש ליד הכניסה.',
      }),
    );
    const [suggestion] = await as('owner', (tx) => listKnowledge(tx, ['suggested']));
    expect(suggestion).toMatchObject({
      question: 'איפה חונים ליד הבריכה?',
      source: 'learned',
      status: 'suggested',
    });
    // Not used until approved.
    const before = await write(0, 'איפה חונים ליד הבריכה?');
    expect(before.reply.outcome).toBe('handed_off');

    await as('owner', (tx) =>
      saveKnowledge(tx, office, {
        id: suggestion!.id,
        question: suggestion!.question,
        answer: 'יש חניה חינם בחניון הקאנטרי, ממש ליד הכניסה 🚗',
        approve: 'on',
      }),
    );
    const after = await write(0, 'שלום, איפה חונים ליד הבריכה?');
    expect(after.reply).toMatchObject({
      outcome: 'answered',
      answer: 'יש חניה חינם בחניון הקאנטרי, ממש ליד הכניסה 🚗',
      knowledge_ids: [suggestion!.id],
    });

    // The office marks the answer, and can take an entry out of use.
    await as('owner', (tx) => reviewBotReply(tx, office, { id: after.reply.id, review: 'good' }));
    const log = await as('owner', (tx) => listBotReplies(tx, { review: 'good' }));
    expect(log.map((x) => x.id)).toEqual([after.reply.id]);
    expect(log[0]!.family).not.toBeNull();
    await as('owner', (tx) =>
      setKnowledgeStatus(tx, office, { id: suggestion!.id, status: 'archived' }),
    );
    expect(await as('owner', (tx) => listKnowledge(tx, ['active']))).toEqual([]);
  });

  it('writes a new entry that is active at once', async () => {
    const id = await as('owner', (tx) =>
      saveKnowledge(tx, office, {
        question: 'מה צריך להביא לשיעור?',
        answer: 'בגד ים, מגבת וכובע ים',
      }),
    );
    const r = await write(1, 'מה צריך להביא לשיעור?');
    expect(r.reply).toMatchObject({ outcome: 'answered', knowledge_ids: [id] });
  });

  it('is visible to the office only', async () => {
    expect(await as('instructor', (tx) => listBotReplies(tx))).toEqual([]);
    expect(await as('instructor', (tx) => listKnowledge(tx, ['active']))).toEqual([]);
    expect((await as('admin', (tx) => listBotReplies(tx))).length).toBeGreaterThan(0);
  });

  it('stays out of the way when turned off', async () => {
    // A new version of the school's rules from today, with the bot off.
    await q(
      `insert into policy_sets (organization_id, scope_type, effective_from, rules)
       select organization_id, 'org', $2::date, jsonb_set(rules, '{comms,bot_enabled}', 'false')
       from policy_sets where organization_id = $1 and scope_type = 'org'
       order by effective_from desc limit 1`,
      [DEMO_ORG.id, today],
    );
    const r = await write(0, 'מתי השיעור הבא?');
    expect(r.run).toEqual({ outcome: 'skipped', reason: 'off' });
    expect(r.reply).toBeUndefined();
    expect(r.status).toBe('new');
  });
});
