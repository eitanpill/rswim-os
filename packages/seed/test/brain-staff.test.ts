/**
 * The business brain, stage 3 (docs/AI-BRAIN.md), on the fake demo tenant: the owner's chat cancels a day and asks for
 * a substitute; an instructor's "אני חולה" on WhatsApp opens substitute searches that wait for the owner, who is
 * asked on WhatsApp and answers "כן N" / "לא N" from the approvals number; the parents' bot leaves those answers alone.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import {
  askCopilot,
  confirmCopilotAction,
  FakeCopilotModel,
  FakeParentBotModel,
  listCopilot,
  runBrainInbound,
  runParentBot,
  setApprovalPhone,
  undoCopilotAction,
} from '@rswim/domain-copilot';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const OWNER_PHONE = '+972509990001';
let today = '';
let tomorrow = '';
let model: FakeCopilotModel;
/** An instructor with a phone who leads lessons on the next day with lessons. */
const staff = { id: '', phone: '', first: '', lessons: 0 };

async function write(phone: string, body: string) {
  const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
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
  const run = await withOrg(t.db, DEMO_ORG.id, (tx) =>
    runBrainInbound(tx, worker, intake.inboundMessageId),
  );
  const replies = await q(
    `select to_phone_e164, body from messages where inbound_message_id = $1`,
    [intake.inboundMessageId],
  );
  const [inbound] = await q(`select status from inbound_messages where id = $1`, [
    intake.inboundMessageId,
  ]);
  return { id: intake.inboundMessageId, run, replies, status: inbound.status as string };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return toDomainError(e)?.code ?? String(e);
  }
  return null;
};

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as((tx) => todayIL(tx));
  // The next day with lessons (tomorrow may be Shabbat when the suite runs).
  [{ d: tomorrow }] = await q(
    `select min(date)::text d from sessions where date > $1::date and status = 'scheduled'`,
    [today],
  );
  model = new FakeCopilotModel(today);
  const [s] = await q(
    `select m.id, m.phone_e164 phone, m.first_name first, count(*)::int lessons
     from sessions s join class_templates t on t.id = s.class_template_id
     join staff_members m on m.id = coalesce((select ss.staff_member_id from session_staff ss
                                               where ss.session_id = s.id and ss.role = 'lead'), t.lead_staff_id)
     where s.date = $1::date and s.status = 'scheduled' and m.phone_e164 is not null and m.status = 'active'
       and (select count(*) from staff_members x where x.first_name = m.first_name) = 1
     group by m.id order by count(*) desc limit 1`,
    [tomorrow],
  );
  Object.assign(staff, s);
  await as((tx) => setApprovalPhone(tx, owner, '050-999-0001'));
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the brain takes requests from the owner and the instructors', () => {
  it('saves the approvals number and refuses a bad one', async () => {
    const [row] = await q(`select approval_phone_e164 p from agent_settings`);
    expect(row.p).toBe(OWNER_PHONE);
    expect(await code(as((tx) => setApprovalPhone(tx, owner, '123')))).toBe('agent.errors.phone');
  });

  it("asks for substitutes for an instructor's lessons and asks the owner on WhatsApp", async () => {
    expect(staff.lessons).toBeGreaterThan(0);
    const r = await write(staff.phone, `היי, אני חולה ב-${tomorrow}`);
    expect(r.run).toMatchObject({ outcome: 'staff_request', date: tomorrow });
    const actions = await q(
      `select kind, source, status, ref, params from copilot_actions where inbound_message_id = $1 order by ref`,
      [r.id],
    );
    expect(actions).toHaveLength(staff.lessons);
    for (const a of actions)
      expect(a).toMatchObject({ kind: 'substitute', source: 'staff', status: 'proposed' });
    // The instructor hears back; the owner gets one message per waiting action with its number.
    expect(r.replies).toEqual([
      expect.objectContaining({
        to_phone_e164: staff.phone,
        body: expect.stringContaining('מחכה לאישור המשרד'),
      }),
    ]);
    expect(r.status).toBe('actioned');
    const asked = await q(
      `select body from messages where to_phone_e164 = $1 and idempotency_key like 'agent.approval:%'`,
      [OWNER_PHONE],
    );
    expect(asked).toHaveLength(staff.lessons);
    expect(asked.map((m) => m.body).join('\n')).toContain(`"כן ${actions[0].ref}"`);
    expect(asked[0].body).toContain(staff.first);
  });

  it('runs an action when the owner answers yes, drops one on no, and the journal undoes it', async () => {
    const waiting = await q(
      `select id, ref, params from copilot_actions where kind = 'substitute' and status = 'proposed' order by ref`,
    );
    const first = waiting[0];
    const yes = await write(OWNER_PHONE, `כן ${first.ref}`);
    expect(yes.run).toMatchObject({
      outcome: 'owner_decided',
      decision: 'confirmed',
      actionId: first.id,
    });
    expect(yes.replies[0]).toMatchObject({
      to_phone_e164: OWNER_PHONE,
      body: expect.stringContaining('✅'),
    });
    expect(yes.status).toBe('actioned');
    const [action] = await q(
      `select status, decided_by, ran_alone, result from copilot_actions where id = $1`,
      [first.id],
    );
    expect(action).toMatchObject({
      status: 'confirmed',
      decided_by: PERSONAS.owner.userId,
      ran_alone: false,
    });
    const [req] = await q(`select session_id, status from substitute_requests where id = $1`, [
      action.result.substituteRequestId,
    ]);
    expect(req.session_id).toBe(first.params.sessionId);
    expect(['open', 'unfilled']).toContain(req.status);

    // The same answer again finds nothing to decide.
    const again = await write(OWNER_PHONE, `כן ${first.ref}`);
    expect(again.run).toMatchObject({ decision: 'already_decided' });

    // The parents' bot never answers the owner's decision as if it were a family's question.
    const bot = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      runParentBot(tx, worker, new FakeParentBotModel(), again.id),
    );
    expect(bot).toEqual({ outcome: 'skipped', reason: 'owner_reply' });

    await as((tx) => undoCopilotAction(tx, owner, first.id));
    const [after] = await q(`select status from substitute_requests where id = $1`, [
      action.result.substituteRequestId,
    ]);
    expect(after.status).toBe('cancelled');

    if (waiting[1]) {
      const no = await write(OWNER_PHONE, `לא ${waiting[1].ref}`);
      expect(no.run).toMatchObject({ decision: 'dismissed' });
      const [d] = await q(`select status from copilot_actions where id = $1`, [waiting[1].id]);
      expect(d.status).toBe('dismissed');
    }
    const none = await write(OWNER_PHONE, 'כן 99999');
    expect(none.run).toMatchObject({ decision: 'not_found', actionId: null });
  });

  it('leaves other messages from staff and from the owner to the inbox', async () => {
    const chat = await write(staff.phone, 'מתי ישיבת הצוות?');
    expect(chat.run).toEqual({ outcome: 'skipped', reason: 'not_for_brain' });
    expect(chat.replies).toHaveLength(0);
    const ownerChat = await write(OWNER_PHONE, 'כן, נדבר');
    expect(ownerChat.run).toEqual({ outcome: 'skipped', reason: 'not_for_brain' });
  });

  it('asks for substitutes from the owner chat', async () => {
    const r = await as(async (tx) => {
      const id = await askCopilot(tx, owner, model, `תמצא מחליף ל${staff.first} ב-${tomorrow}`);
      return (await listCopilot(tx)).find((x) => x.id === id)!;
    });
    // Lessons already covered by an open search fail at once only when they run; here they wait for the owner.
    expect(r.actions.length).toBe(staff.lessons);
    expect(r.actions.every((a) => a.kind === 'substitute' && a.status === 'proposed')).toBe(true);
    expect(r.answer).toContain('מחכה לאישור שלך');
    // The owner is in the chat already: nothing goes to their WhatsApp.
    const [{ n }] = await q(
      `select count(*)::int n from messages where idempotency_key = any($1::text[])`,
      [r.actions.map((a) => `agent.approval:${a.id}`)],
    );
    expect(n).toBe(0);
  });

  it('cancels a day from the owner chat only after the owner confirms', async () => {
    const before = await q(
      `select id from sessions where date = $1::date and status = 'scheduled'`,
      [tomorrow],
    );
    expect(before.length).toBeGreaterThan(0);
    const r = await as(async (tx) => {
      const id = await askCopilot(
        tx,
        owner,
        model,
        `תבטל את השיעורים ב-${tomorrow} בגלל תקלה בבריכה`,
      );
      return (await listCopilot(tx)).find((x) => x.id === id)!;
    });
    expect(r.actions).toHaveLength(1);
    const [a] = r.actions;
    expect(a).toMatchObject({ kind: 'cancel_lessons', status: 'proposed' });
    expect(a!.summary).toMatchObject({
      code: 'copilot.summary.cancelLessonsAll',
      params: { date: tomorrow, until: tomorrow, sessions: before.length, reason: 'תקלה בבריכה' },
    });
    expect(
      await q(`select 1 from sessions where date = $1::date and status <> 'scheduled'`, [tomorrow]),
    ).toHaveLength(0);
    const out = await as((tx) => confirmCopilotAction(tx, owner, a!.id));
    expect(out.status).toBe('confirmed');
    const [event] = await q(`select status, reason from closure_events where id = $1`, [
      (out as { result: { closureEventId: string } }).result.closureEventId,
    ]);
    expect(event).toMatchObject({ status: 'open', reason: 'תקלה בבריכה' });
    expect(
      await q(`select 1 from sessions where date = $1::date and status = 'scheduled'`, [tomorrow]),
    ).toHaveLength(0);
    // Cancelling is never undone from the journal.
    expect(await code(as((tx) => undoCopilotAction(tx, owner, a!.id)))).toBe(
      'copilot.errors.notUndoable',
    );
    // With nothing left to cancel, the chat says so.
    const empty = await as(async (tx) => {
      const id = await askCopilot(tx, owner, model, `תבטל את השיעורים ב-${tomorrow}`);
      return (await listCopilot(tx)).find((x) => x.id === id)!;
    });
    expect(empty.actions).toHaveLength(0);
    expect(empty.answer).toContain('אין שיעורים לבטל');
  });
});
