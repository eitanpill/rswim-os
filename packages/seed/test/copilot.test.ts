/**
 * Phase 9 owner copilot on the fake demo tenant, with the rules-based stand-in model: requests propose, nothing
 * changes until the owner confirms, a confirmed move runs through the board's service and can be undone, and only the
 * owner can use it or read it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  applyAgentProfile,
  askCopilot,
  confirmCopilotAction,
  dismissCopilotAction,
  FakeCopilotModel,
  getAgentSettings,
  listAgentActions,
  listCopilot,
  saveAgentSettings,
  setAgentPaused,
  undoCopilotAction,
  waitingActionsCount,
} from '@rswim/domain-copilot';
import { AGENT_PROFILE_LEVELS } from '@rswim/contracts';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { previewPlacement, todayIL } from '@rswim/domain-scheduling';
import type { CopilotModel } from '@rswim/integrations';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const ctx: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(who: keyof typeof PERSONAS, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS[who].userId, org_id: ctx.orgId }, fn);
const owner = <T>(fn: (tx: Tx) => Promise<T>) => as('owner', fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};
let model: FakeCopilotModel;
let today = '';
const move = { studentId: '', student: '', fromId: '', toId: '', to: '' };

const ask = (prompt: string) =>
  owner(async (tx) => {
    const id = await askCopilot(tx, ctx, model, prompt);
    return (await listCopilot(tx)).find((r) => r.id === id)!;
  });

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await owner((tx) => todayIL(tx));
  model = new FakeCopilotModel(today);
  // A child and another group of the same program the rules let them join (the fake names them in Hebrew).
  const seats = await q(
    `select s.id sid, s.first_name || ' ' || s.last_name student, e.class_template_id from_id,
            o.id to_id, o.name to_name, o.weekday
     from enrollments e join students s on s.id = e.student_id
     join class_templates t on t.id = e.class_template_id
     join class_templates o on o.program_id = t.program_id and o.id <> t.id and o.status = 'active' and o.cohort_id is null
     where e.status = 'active' and e.ends_on is null and t.cohort_id is null
       and (select count(*) from students x where x.first_name || ' ' || x.last_name = s.first_name || ' ' || s.last_name) = 1
       and (select count(*) from class_templates y where y.name ilike '%' || o.name || '%') = 1
       and (select count(*) from enrollments z where z.student_id = s.id and z.status = 'active') = 1
     order by s.first_name, o.name`,
  );
  for (const c of seats) {
    const d = new Date(`${today}T12:00:00Z`);
    const ahead = (c.weekday - d.getUTCDay() + 7) % 7;
    const onDate = new Date(d.getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
    const p = await owner((tx) =>
      previewPlacement(tx, {
        studentId: c.sid,
        fromTemplateId: c.from_id,
        toTemplateId: c.to_id,
        onDate,
        status: 'active',
      }),
    );
    if (p.decision.violations.length === 0) {
      Object.assign(move, {
        studentId: c.sid,
        student: c.student,
        fromId: c.from_id,
        toId: c.to_id,
        to: c.to_name,
      });
      break;
    }
  }
}, 240_000);
afterAll(async () => {
  await t.drop();
});

const groupsOf = async (studentId: string) =>
  (
    await q(
      `select class_template_id id from enrollments where student_id = $1 and status = 'active'
         and (ends_on is null or ends_on > $2::date + 7)`,
      [studentId, today],
    )
  ).map((r) => r.id);

describe('owner copilot', () => {
  it('proposes a move and changes nothing until the owner confirms; then it can be undone', async () => {
    expect(move.studentId).not.toBe('');
    const r = await ask(`תעביר את ${move.student} ל${move.to}`);
    expect(r.status).toBe('answered');
    expect(r.answer).toContain('מחכה לאישור');
    expect(r.trace.at(-1)?.tool).toBe('propose_move_student');
    const [action] = r.actions;
    expect(action).toMatchObject({
      kind: 'move_student',
      status: 'proposed',
      summary: { code: 'copilot.summary.move' },
    });
    expect(await groupsOf(move.studentId)).toEqual([move.fromId]);

    expect(await owner((tx) => confirmCopilotAction(tx, ctx, action!.id))).toMatchObject({
      status: 'confirmed',
    });
    // The ordinary board move: the old place ends, the new one continues it.
    const [moved] = await q(
      `select class_template_id, previous_enrollment_id is not null linked, source from enrollments
       where student_id = $1 order by created_at desc limit 1`,
      [move.studentId],
    );
    expect(moved).toEqual({ class_template_id: move.toId, linked: true, source: 'board_move' });
    expect(await code(owner((tx) => confirmCopilotAction(tx, ctx, action!.id)))).toBe(
      'copilot.errors.alreadyDecided',
    );

    await owner((tx) => undoCopilotAction(tx, ctx, action!.id));
    expect(await groupsOf(move.studentId)).toEqual([move.fromId]);
    expect(await code(owner((tx) => undoCopilotAction(tx, ctx, action!.id)))).toBe(
      'copilot.errors.notConfirmed',
    );
    const [audit] = await q(
      `select count(*)::int n from audit_log where subject_type = 'copilot_actions' and subject_id = $1::text`,
      [action!.id],
    );
    expect(audit.n).toBeGreaterThanOrEqual(2);
  });

  it('proposes a family message that is queued only once confirmed', async () => {
    const r = await ask(
      `תשלח להורים של ${move.student}: השיעור ביום ראשון מתחיל חצי שעה מאוחר יותר (דמו)`,
    );
    const [action] = r.actions;
    expect(action).toMatchObject({
      kind: 'message_family',
      summary: { code: 'copilot.summary.message' },
    });
    const count = async () =>
      (
        await q(`select count(*)::int n from messages where idempotency_key like $1`, [
          `copilot:${action!.id}:%`,
        ])
      )[0].n;
    expect(await count()).toBe(0);
    const out = await owner((tx) => confirmCopilotAction(tx, ctx, action!.id));
    expect(out.status).toBe('confirmed');
    expect(await count()).toBeGreaterThan(0);
    expect(await code(owner((tx) => undoCopilotAction(tx, ctx, action!.id)))).toBe(
      'copilot.errors.notUndoable',
    );
  });

  it('stores a refusal by the rules on the action, and dismisses what the owner turns down', async () => {
    const r = await ask('תפתח השלמות עם דני ב-2020-01-05 16:00-16:30');
    const slots = r.actions[0];
    expect(slots?.kind).toBe('open_makeup_slots');
    const out = await owner((tx) => confirmCopilotAction(tx, ctx, slots!.id));
    expect(out.status).toBe('failed');
    const stored = (await owner((tx) => listCopilot(tx)))
      .flatMap((x) => x.actions)
      .find((a) => a.id === slots!.id);
    expect(stored).toMatchObject({ status: 'failed' });
    expect(stored?.errorCode).toMatch(/^scheduling\./);

    const again = await ask(`תשלח להורים של ${move.student}: לא לשלוח (דמו)`);
    await owner((tx) => dismissCopilotAction(tx, ctx, again.actions[0]!.id));
    expect((await owner((tx) => listCopilot(tx)))[0]?.actions[0]?.status).toBe('dismissed');
  });

  it('answers questions from the read tools and explains what it understands', async () => {
    expect((await ask('מי חייב?')).answer).toMatch(/החובות הגדולים|אין חובות/);
    expect((await ask('מה יש היום')).answer).toContain(today);
    expect((await ask('שלום')).answer).toContain('תעביר את');
    const unknown = await ask(`תעביר את מישהו-שלא-קיים ל${move.to}`);
    expect(unknown.actions).toEqual([]);
  });

  it('records a model failure, and lets only the owner use or read the copilot', async () => {
    const broken: CopilotModel = {
      name: 'broken',
      run: async () => {
        throw new Error('network');
      },
    };
    const failed = await owner(async (tx) => {
      const id = await askCopilot(tx, ctx, broken, 'מי חייב?');
      return (await listCopilot(tx)).find((r) => r.id === id);
    });
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'copilot.errors.modelFailed' });
    expect(await code(owner((tx) => askCopilot(tx, ctx, null, 'x')))).toBe(
      'copilot.errors.noModel',
    );
    expect(await code(owner((tx) => askCopilot(tx, ctx, model, ' ')))).toBe(
      'copilot.errors.prompt',
    );
    const admin = { orgId: ctx.orgId, userId: PERSONAS.admin.userId };
    expect(await code(as('admin', (tx) => askCopilot(tx, admin, model, 'מי חייב?')))).toBe(
      'copilot.errors.ownerOnly',
    );
    expect(await as('admin', (tx) => listCopilot(tx))).toEqual([]);
    expect(await as('instructor', (tx) => listCopilot(tx))).toEqual([]);
  });
});

describe('the business brain (docs/AI-BRAIN.md)', () => {
  const settings = {
    profile: 'autopilot' as const,
    levels: AGENT_PROFILE_LEVELS.autopilot,
    maxAutoPerDay: 30,
    maxAutoPaymentAgorot: 30000,
    paused: false,
  };

  it('starts careful: the chat only proposes, as before', async () => {
    const s = await owner((tx) => getAgentSettings(tx));
    expect(s).toMatchObject({ profile: 'careful', matches: 'careful', paused: false });
    expect(s.effective.move_student).toBe('approve');
    expect(s.effective.report_absence).toBe('auto');
  });

  it('on autopilot runs a move at once, journals it as done alone, and undoes it', async () => {
    await owner((tx) => applyAgentProfile(tx, ctx, 'autopilot'));
    const r = await ask(`תעביר את ${move.student} ל${move.to}`);
    expect(r.answer).toContain('העברתי');
    expect(r.actions[0]).toMatchObject({ kind: 'move_student', status: 'confirmed' });
    expect(await groupsOf(move.studentId)).toEqual([move.toId]);
    const [row] = await owner((tx) => listAgentActions(tx, { limit: 1 }));
    expect(row).toMatchObject({
      source: 'owner_chat',
      autonomy: 'auto',
      ranAlone: true,
      status: 'confirmed',
      prompt: `תעביר את ${move.student} ל${move.to}`,
    });
    const [db] = await q(`select decided_by from copilot_actions where id = $1`, [row!.id]);
    expect(db.decided_by).toBeNull();
    await owner((tx) => undoCopilotAction(tx, ctx, row!.id));
    expect(await groupsOf(move.studentId)).toEqual([move.fromId]);
  });

  it('sends a payment link alone under the cap, waits above it, and cancels one on undo', async () => {
    const small = await ask(`תשלח קישור תשלום להורים של ${move.student} על 120`);
    expect(small.actions[0]).toMatchObject({ kind: 'payment_link', status: 'confirmed' });
    expect(small.answer).toContain('שלחתי');
    const { linkId } = small.actions[0]!.result as { linkId: string };
    const link = async () =>
      (await q(`select amount_agorot, status from payment_links where id = $1`, [linkId]))[0];
    expect(await link()).toEqual({ amount_agorot: 12000, status: 'open' });
    await owner((tx) => undoCopilotAction(tx, ctx, small.actions[0]!.id));
    expect((await link()).status).toBe('cancelled');

    const big = await ask(`תשלח קישור תשלום להורים של ${move.student} על 500`);
    expect(big.actions[0]).toMatchObject({
      status: 'proposed',
      result: { waitReason: 'amount_cap' },
    });
    expect(big.answer).toContain('מחכה לאישור');
    expect(await owner((tx) => waitingActionsCount(tx))).toBeGreaterThan(0);
    await owner((tx) => dismissCopilotAction(tx, ctx, big.actions[0]!.id));
  });

  it('never sends free text alone, and waits for the owner while paused', async () => {
    const msg = await ask(`תשלח להורים של ${move.student}: בדיקה (דמו)`);
    expect(msg.actions[0]).toMatchObject({ status: 'proposed' });
    const [m] = await owner((tx) => listAgentActions(tx, { limit: 1 }));
    expect(m).toMatchObject({ kind: 'message_family', autonomy: 'approve', ranAlone: false });
    await owner((tx) => dismissCopilotAction(tx, ctx, m!.id));

    await owner((tx) => setAgentPaused(tx, ctx, true));
    const r = await ask(`תעביר את ${move.student} ל${move.to}`);
    expect(r.actions[0]).toMatchObject({ status: 'proposed', result: { waitReason: 'paused' } });
    expect(await groupsOf(move.studentId)).toEqual([move.fromId]);
    await owner((tx) => dismissCopilotAction(tx, ctx, r.actions[0]!.id));
    await owner((tx) => setAgentPaused(tx, ctx, false));
  });

  it('refuses a kind that is off, and stops running alone at the daily cap', async () => {
    await owner((tx) =>
      saveAgentSettings(tx, ctx, {
        ...settings,
        levels: { ...settings.levels, move_student: 'off' },
      }),
    );
    const off = await ask(`תעביר את ${move.student} ל${move.to}`);
    expect(off.actions).toEqual([]);
    expect(off.trace.at(-1)).toMatchObject({ error: true, output: 'agent.errors.off' });
    expect((await owner((tx) => getAgentSettings(tx))).matches).toBeNull();

    await owner((tx) => saveAgentSettings(tx, ctx, { ...settings, maxAutoPerDay: 0 }));
    const capped = await ask(`תעביר את ${move.student} ל${move.to}`);
    expect(capped.actions[0]).toMatchObject({
      status: 'proposed',
      result: { waitReason: 'daily_cap' },
    });
    await owner((tx) => dismissCopilotAction(tx, ctx, capped.actions[0]!.id));
  });

  it("refuses a level above a ceiling, and keeps the settings and journal the owner's", async () => {
    expect(
      await code(
        owner((tx) =>
          saveAgentSettings(tx, ctx, {
            ...settings,
            levels: { ...settings.levels, cancel_lessons: 'auto' },
          }),
        ),
      ),
    ).toBe('agent.errors.aboveCeiling');
    const admin = { orgId: ctx.orgId, userId: PERSONAS.admin.userId };
    // The admin sees the defaults (not the owner's row) and cannot write them.
    expect((await as('admin', (tx) => getAgentSettings(tx))).profile).toBe('careful');
    await expect(as('admin', (tx) => setAgentPaused(tx, admin, true))).rejects.toThrow();
    expect(await as('admin', (tx) => listAgentActions(tx))).toEqual([]);
    const [audit] = await q(
      `select count(*)::int n from audit_log where subject_type = 'agent_settings'`,
    );
    expect(audit.n).toBeGreaterThanOrEqual(3);
    await owner((tx) => applyAgentProfile(tx, ctx, 'careful'));
  });
});
