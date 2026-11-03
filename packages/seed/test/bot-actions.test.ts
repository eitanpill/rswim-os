/**
 * The parents' bot acting through the business brain (docs/AI-BRAIN.md, stage 2), on the fake demo tenant with the
 * rules-based stand-in: an absence runs on its own under the careful profile, a makeup booking waits for the owner and
 * runs on her tap, a freeze runs alone once she allows it and is undone from the journal, a kind she turned off goes
 * to the office, and the bot never touches another family's children.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { issueGoodwillCredit } from '@rswim/domain-attendance';
import { intakeInbound } from '@rswim/domain-comms';
import {
  botToolbox,
  confirmCopilotAction,
  FakeParentBotModel,
  getAgentSettings,
  listAgentActions,
  runParentBot,
  saveAgentSettings,
  undoCopilotAction,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import type { AgentActionKind, AutonomyLevel } from '@rswim/contracts';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const model = new FakeParentBotModel();

interface Family {
  householdId: string;
  phone: string;
  studentId: string;
  child: string;
  programId: string;
}
const fam: Family[] = [];
let today = '';

async function write(f: Family, body: string) {
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
  const actions = await q(
    `select * from copilot_actions where inbound_message_id = $1 order by created_at`,
    [intake.inboundMessageId],
  );
  const [inbound] = await q(`select status from inbound_messages where id = $1`, [
    intake.inboundMessageId,
  ]);
  return { id: intake.inboundMessageId, run, reply, actions, status: inbound.status as string };
}

async function setLevels(levels: Partial<Record<AgentActionKind, AutonomyLevel>>) {
  await as(async (tx) => {
    const s = await getAgentSettings(tx);
    await saveAgentSettings(tx, owner, {
      profile: s.profile,
      levels: { ...s.effective, ...levels },
      maxAutoPerDay: s.maxAutoPerDay,
      maxAutoPaymentAgorot: s.maxAutoPaymentAgorot,
      paused: false,
    });
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as((tx) => todayIL(tx));
  // Families with one child (so the message names nobody else) holding one place with lessons ahead.
  const rows = await q(
    `select distinct on (h.id) h.id household_id, g.phone_e164 phone, st.id student_id, st.first_name child,
            ct.program_id
     from households h join guardians g on g.household_id = h.id and g.phone_e164 is not null
     join students st on st.household_id = h.id
     join enrollments e on e.student_id = st.id and e.status = 'active'
     join class_templates ct on ct.id = e.class_template_id
     join sessions s on s.class_template_id = e.class_template_id and s.status = 'scheduled'
       and s.date between $1::date and $1::date + 13 and s.starts_at > now()
       and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)
     where (select count(*) from guardians x where x.phone_e164 = g.phone_e164) = 1
       and (select count(*) from students y where y.household_id = h.id) = 1
       and (select count(*) from enrollments z where z.student_id = st.id and z.status = 'active') = 1
     order by h.id, g.created_at limit 12`,
    [today],
  );
  for (const r of rows)
    fam.push({
      householdId: r.household_id,
      phone: r.phone,
      studentId: r.student_id,
      child: r.child,
      programId: r.program_id,
    });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the parents' bot acts through the brain", () => {
  it('records an absence on its own under the careful profile, in the journal with the message', async () => {
    expect(fam.length).toBeGreaterThanOrEqual(4);
    const f = fam[0]!;
    const body = `${f.child} לא יגיע לשיעור הבא`;
    const r = await write(f, body);
    expect(r.run.outcome).toBe('answered');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({
      kind: 'report_absence',
      source: 'parent_whatsapp',
      autonomy: 'auto',
      ran_alone: true,
      status: 'confirmed',
      decided_by: null,
    });
    const [notice] = await q(`select channel, student_id from absence_notices where id = $1`, [
      r.actions[0].result.noticeId,
    ]);
    expect(notice).toMatchObject({ channel: 'whatsapp', student_id: f.studentId });
    expect(r.reply.answer).toContain('רשמנו');
    expect(r.status).toBe('actioned');
    // The inbox's own draft of the same absence is set aside.
    const drafts = await q(
      `select status from triage_actions where inbound_message_id = $1 and status = 'pending'`,
      [r.id],
    );
    expect(drafts).toHaveLength(0);
    const journal = await as((tx) => listAgentActions(tx, {}));
    expect(journal.find((a) => a.id === r.actions[0].id)).toMatchObject({
      source: 'parent_whatsapp',
      prompt: body,
      summary: { code: 'copilot.summary.absence' },
    });
  });

  it('books a makeup that waits for the owner, then runs on her tap and is undone', async () => {
    // A family whose child has a free seat to make up in (which ones do depends on the day the test runs).
    const [{ d: expiresOn }] = await q(`select ($1::date + 30)::text d`, [today]);
    let found: { f: Family; creditId: string } | null = null;
    for (const f of [fam[1]!, ...fam.slice(4)]) {
      const creditId = await as((tx) =>
        issueGoodwillCredit(tx, owner, {
          studentId: f.studentId,
          programId: f.programId,
          expiresOn,
          note: 'בדיקה',
        }),
      );
      const options = await withOrg(t.db, DEMO_ORG.id, (tx) =>
        botToolbox(tx, worker, f.householdId, today, [], {
          id: randomUUID(),
          body: '',
          receivedAt: new Date(),
        }).call('makeup_options', { creditId }),
      );
      if ((options as unknown[]).length > 0) {
        found = { f, creditId };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { f, creditId } = found!;
    const r = await write(f, `אפשר לקבוע השלמה ל${f.child}?`);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({
      kind: 'book_makeup',
      autonomy: 'approve',
      status: 'proposed',
      ran_alone: false,
    });
    expect(r.reply.answer).toContain('המשרד יאשר');
    expect(await q(`select 1 from makeup_bookings where credit_id = $1`, [creditId])).toHaveLength(
      0,
    );

    const out = await as((tx) => confirmCopilotAction(tx, owner, r.actions[0].id));
    expect(out.status).toBe('confirmed');
    const [booking] = await q(`select status from makeup_bookings where credit_id = $1`, [
      creditId,
    ]);
    expect(booking).toMatchObject({ status: 'booked' });
    await as((tx) => undoCopilotAction(tx, owner, r.actions[0].id));
    const [after] = await q(`select status from makeup_bookings where credit_id = $1`, [creditId]);
    expect(after).toMatchObject({ status: 'cancelled' });
  });

  it('freezes alone once the owner allows it, and the journal undoes it', async () => {
    await setLevels({ freeze: 'auto' });
    const f = fam[2]!;
    const [{ from, to }] = await q(
      `select ($1::date + 20)::text "from", ($1::date + 40)::text "to"`,
      [today],
    );
    const r = await write(f, `רוצה להקפיא את ${f.child} מ-${from} עד ${to}`);
    expect(r.actions[0]).toMatchObject({
      kind: 'freeze',
      ran_alone: true,
      status: 'confirmed',
    });
    const freezeId = r.actions[0].result.freezeId as string;
    const [freeze] = await q(
      `select from_date::text, to_date::text from enrollment_freezes where id = $1`,
      [freezeId],
    );
    expect(freeze).toMatchObject({ from_date: from, to_date: to });
    await as((tx) => undoCopilotAction(tx, owner, r.actions[0].id));
    const [after] = await q(`select status from enrollment_freezes where id = $1`, [freezeId]);
    expect(after).toMatchObject({ status: 'cancelled' });
  });

  it('leaves the request to the office when the owner turned that kind off', async () => {
    await setLevels({ report_absence: 'off', book_makeup: 'off' });
    const f = fam[3]!;
    // The inbox drafted the absence for the office's one tap; the bot stays out of it.
    const absence = await write(f, `${f.child} לא תגיע לשיעור`);
    expect(absence.run).toEqual({ outcome: 'skipped', reason: 'action_drafted' });
    expect(absence.actions).toHaveLength(0);
    expect(
      await q(`select 1 from triage_actions where inbound_message_id = $1 and status = 'pending'`, [
        absence.id,
      ]),
    ).toHaveLength(1);
    // Asked without a draft, the bot is told it may not and hands the request over with a note for the office.
    const [{ d: expiresOn }] = await q(`select ($1::date + 30)::text d`, [today]);
    const creditId = await as((tx) =>
      issueGoodwillCredit(tx, owner, {
        studentId: f.studentId,
        programId: f.programId,
        expiresOn,
        note: 'בדיקה',
      }),
    );
    const [lesson] = (await withOrg(t.db, DEMO_ORG.id, (tx) =>
      botToolbox(tx, worker, f.householdId, today, [], {
        id: absence.id,
        body: '',
        receivedAt: new Date(),
      }).call('makeup_options', { creditId }),
    )) as { sessionId: string }[];
    if (lesson) {
      const out = await withOrg(t.db, DEMO_ORG.id, (tx) =>
        botToolbox(tx, worker, f.householdId, today, [], {
          id: absence.id,
          body: '',
          receivedAt: new Date(),
        }).call('book_makeup', { creditId, sessionId: lesson.sessionId }),
      );
      expect(out).toEqual({ status: 'not_allowed' });
    }
    await setLevels({ report_absence: 'auto', book_makeup: 'approve' });
  });

  it("never acts on another family's child", async () => {
    const lessons = (await withOrg(t.db, DEMO_ORG.id, (tx) =>
      botToolbox(tx, worker, fam[1]!.householdId, today, [], {
        id: randomUUID(),
        body: '',
        receivedAt: new Date(),
      }).call('family_lessons', {}),
    )) as { sessionId: string; childId: string }[];
    const other = lessons[0]!;
    await expect(
      withOrg(t.db, DEMO_ORG.id, (tx) =>
        botToolbox(tx, worker, fam[0]!.householdId, today, [], {
          id: randomUUID(),
          body: '',
          receivedAt: new Date(),
        }).call('report_absence', { childId: other.childId, sessionId: other.sessionId }),
      ),
    ).rejects.toMatchObject({ code: 'bot.errors.notYourChild' });
  });
});
