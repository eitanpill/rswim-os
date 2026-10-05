/**
 * Phase 8 acceptance at the service level, against a real database with RLS: parents receive "arrived at the pool"
 * automatically when the escort taps it. Also: the escort opens today's run of their own route only, marks children,
 * cannot backdate or touch another day's run, the run report gives in-water time, an old tap messages nobody, and a
 * family sees only their own child on the run. Every person and phone number is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  addRider,
  createRoute,
  createSchool,
  escortDay,
  getRun,
  markRider,
  openRun,
  recordStage,
  runsOnDate,
  stageAudience,
} from '@rswim/domain-transport';
import { runAutomation } from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { escort: '', other: '', parent: '', instructor: '' };
const kids = { daniel: '', noa: '', tamar: '' };
let routeId = '';
let today = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const asCtx = (who: keyof typeof users): ServiceContext => ({
  orgId: ctx.orgId,
  userId: users[who],
});
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
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

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('transport', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  [{ today }] = await q(`select (now() at time zone 'Asia/Jerusalem')::date::text as today`);

  const households: Record<string, string> = {};
  const guardians: Record<string, string> = {};
  for (const [key, phone] of [
    ['cohen', '+972501111111'],
    ['levi', '+972502222222'],
  ] as const) {
    const [h] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, `משפחת ${key} (דמו)`],
    );
    households[key] = h.id;
    const [g] = await q(
      `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, whatsapp_opt_in)
       values ($1, $2, 'הורה', 'דמו', $3, true) returning id`,
      [ctx.orgId, h.id, phone],
    );
    guardians[key] = g.id;
  }
  for (const [key, house, name] of [
    ['daniel', 'cohen', 'דניאל'],
    ['noa', 'levi', 'נועה'],
    ['tamar', 'levi', 'תמר'],
  ] as const) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', 'female', '2017-01-01') returning id`,
      [ctx.orgId, households[house], name],
    );
    kids[key] = s.id;
  }
  const staff: Record<string, string> = {};
  for (const [key, first] of [
    ['escort', 'דני'],
    ['other', 'יוסי'],
    ['instructor', 'מיכל'],
  ] as const) {
    const [st] = await q(
      `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
       values ($1, $2, 'דמו', 'male', 'employee') returning id`,
      [ctx.orgId, first],
    );
    staff[key] = st.id;
  }
  for (const [key, role, staffId, guardianId] of [
    ['escort', 'escort', staff.escort, null],
    ['other', 'escort', staff.other, null],
    ['instructor', 'instructor', staff.instructor, null],
    ['parent', 'parent', null, guardians.cohen],
  ] as const) {
    const [usr] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = usr.id;
    await q(
      `insert into memberships (organization_id, user_id, role, staff_member_id, guardian_id)
       values ($1, $2, $3, $4, $5)`,
      [ctx.orgId, usr.id, role, staffId, guardianId],
    );
  }

  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת כרמים (דמו)') returning id`,
    [ctx.orgId],
  );
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  const [p] = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'after', 'after_school', 'צהרון שחייה', 45, 12) returning id`,
    [ctx.orgId],
  );
  const [tpl] = await q(
    `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                  duration_min, capacity, effective_from)
     values ($1, 'צהרון כרמים', $2, $3, $4, extract(dow from $5::date)::int, '16:15', 45, 12, '2026-01-01')
     returning id`,
    [ctx.orgId, p.id, v.id, pool.id, today],
  );
  await q(
    `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at)
     values ($1, $2, $3, $4, ($4::date + time '16:15') at time zone 'Asia/Jerusalem',
             ($4::date + time '17:00') at time zone 'Asia/Jerusalem')`,
    [ctx.orgId, tpl.id, v.id, today],
  );

  const schoolId = await owner((tx) =>
    createSchool(tx, ctx, { name: 'בית ספר אופק (דמו)', address: 'רחוב הדמו 1' }),
  );
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  routeId = await owner((tx) =>
    createRoute(tx, ctx, {
      name: 'אופק → כרמים',
      schoolId,
      classTemplateId: tpl.id,
      weekdays: [String(dow)] as unknown as number[],
      leavesSchoolAt: '15:45',
      rideMinutes: 20,
      escortStaffId: staff.escort,
    }),
  );
  for (const [kid, point] of [
    ['daniel', 'צומת הגפן'],
    ['noa', null],
    ['tamar', null],
  ] as const) {
    await owner((tx) =>
      addRider(tx, ctx, {
        routeId,
        studentId: kids[kid],
        dropoffPoint: point,
        startsOn: '2026-09-01',
      }),
    );
  }
});

afterAll(async () => {
  await t.drop();
});

describe('AC: "arrived at the pool" reaches the families when the escort taps it', () => {
  let runId = '';

  it('the escort opens today’s run of their own route; another escort sees nothing', async () => {
    const day = await as('escort', (tx) => escortDay(tx, asCtx('escort'), today));
    expect(day).toHaveLength(1);
    runId = day[0]!.run.id;
    expect(day[0]!.riders.map((r) => r.name)).toHaveLength(3);
    expect(day[0]!.next).toBe('left_school');
    // Opening again changes nothing.
    expect(await as('escort', (tx) => escortDay(tx, asCtx('escort'), today))).toHaveLength(1);
    expect(await as('other', (tx) => escortDay(tx, asCtx('other'), today))).toEqual([]);
    expect(await as('instructor', (tx) => runsOnDate(tx, today))).toEqual([]);
  });

  it('marks who is on board, then taps the stages in order', async () => {
    const e = asCtx('escort');
    await as('escort', (tx) =>
      markRider(tx, e, { runId, studentId: kids.daniel, mark: 'boarded' }),
    );
    await as('escort', (tx) => markRider(tx, e, { runId, studentId: kids.noa, mark: 'boarded' }));
    await as('escort', (tx) => markRider(tx, e, { runId, studentId: kids.tamar, mark: 'missing' }));
    expect(
      await code(
        as('escort', (tx) => markRider(tx, e, { runId, studentId: kids.tamar, mark: 'boarded' })),
      ),
    ).toBe('transport.errors.riderMarked');
    await as('escort', (tx) => recordStage(tx, e, { runId, stage: 'left_school' }));
    expect(
      await code(as('escort', (tx) => recordStage(tx, e, { runId, stage: 'left_school' }))),
    ).toBe('transport.errors.stageDone');
    const { eventId } = await as('escort', (tx) =>
      recordStage(tx, e, { runId, stage: 'arrived_pool' }),
    );

    // The database stamped who and when, and the run is underway.
    const [ev] = await q(`select recorded_by, at from run_events where id = $1`, [eventId]);
    expect(ev.recorded_by).toBe(users.escort);
    expect(Date.now() - new Date(ev.at).getTime()).toBeLessThan(60_000);
    expect((await q(`select status from route_runs where id = $1`, [runId]))[0].status).toBe(
      'underway',
    );

    // The tap became an event for the communications hub; the worker turns it into messages.
    const [out] = await q(
      `select id, event_type, payload from outbox where event_type = 'transport.arrived_pool'`,
    );
    expect(out.payload).toMatchObject({ eventId, runId });
    const result = await system((tx) =>
      runAutomation(
        tx,
        { orgId: ctx.orgId, userId: null },
        { id: out.id, type: out.event_type, payload: out.payload },
      ),
    );
    expect(result).toMatchObject({ outcome: 'done', queued: 2, blocked: 0 });
    const sent = await q(
      `select m.body, m.status, g.phone_e164 from messages m join guardians g on g.id = m.guardian_id
       where m.template_key = 'transport_arrived_pool' order by g.phone_e164`,
    );
    // Daniel's and Noa's families hear it; Tamar was not on board, so her family's message would mislead.
    expect(sent).toHaveLength(2);
    expect(sent.every((m: { body: string }) => m.body.includes('הגענו לבריכה'))).toBe(true);
    expect(sent.map((m: { body: string }) => /דניאל|נועה/.exec(m.body)?.[0]).sort()).toEqual([
      'דניאל',
      'נועה',
    ]);
    expect(sent.every((m: { status: string }) => ['queued', 'held'].includes(m.status))).toBe(true);
    expect(sent.some((m: { body: string }) => m.body.includes('תמר'))).toBe(false);
  });

  it('in-water time on the run report, and the drop-off message', async () => {
    const e = asCtx('escort');
    await as('escort', (tx) => recordStage(tx, e, { runId, stage: 'in_water' }));
    await as('escort', (tx) => recordStage(tx, e, { runId, stage: 'out_of_water' }));
    await as('escort', (tx) => recordStage(tx, e, { runId, stage: 'left_pool' }));
    const { eventId } = await as('escort', (tx) =>
      markRider(tx, e, { runId, studentId: kids.daniel, mark: 'dropped_off' }),
    );
    expect(
      await code(
        as('escort', (tx) =>
          markRider(tx, e, { runId, studentId: kids.tamar, mark: 'dropped_off' }),
        ),
      ),
    ).toBe('transport.errors.notBoarded');
    const run = await owner((tx) => getRun(tx, runId));
    expect(run?.summary.inWaterMin).toBe(0);
    expect(run?.summary.plannedMin).toBe(45);
    expect(run?.next).toBe('run_done');

    const out = await system((tx) =>
      runAutomation(
        tx,
        { orgId: ctx.orgId, userId: null },
        { id: crypto.randomUUID(), type: 'transport.rider_dropped', payload: { eventId } },
      ),
    );
    expect(out).toMatchObject({ queued: 1 });
    const [m] = await q(`select body from messages where template_key = 'transport_dropped_off'`);
    expect(m.body).toContain('צומת הגפן');
  });

  it('an escort cannot backdate a tap, nor record on another day’s run', async () => {
    const yesterday = await owner((tx) =>
      openRun(tx, ctx, {
        routeId,
        date: new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
      }),
    );
    expect(
      await code(
        as('escort', (tx) =>
          recordStage(tx, asCtx('escort'), { runId: yesterday, stage: 'left_school' }),
        ),
      ),
    ).toBe('common.errors.forbidden');
    await as('escort', (tx) =>
      tx.execute(sql`insert into run_events (organization_id, run_id, kind, at)
        values (${ctx.orgId}, ${runId}, 'run_done', '2026-01-01T00:00:00Z')`),
    );
    const [done] = await q(`select at from run_events where run_id = $1 and kind = 'run_done'`, [
      runId,
    ]);
    expect(Date.now() - new Date(done.at).getTime()).toBeLessThan(60_000);
    expect((await q(`select status from route_runs where id = $1`, [runId]))[0].status).toBe(
      'done',
    );
  });

  it('an old tap messages nobody', async () => {
    const [ev] = await q(`select id from run_events where run_id = $1 and kind = 'arrived_pool'`, [
      runId,
    ]);
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await system((tx) => stageAudience(tx, ev.id, later))).toBeNull();
  });

  it('a family sees their own child on the run, not the others', async () => {
    const [run] = await as('parent', (tx) => runsOnDate(tx, today));
    expect(run?.riders.map((r) => r.studentId)).toEqual([kids.daniel]);
    expect(run?.stages.map((s) => s.stage)).toContain('arrived_pool');
    const marks = await as('parent', (tx) =>
      tx.execute<{ student_id: string }>(
        sql`select student_id from run_events where student_id is not null`,
      ),
    );
    expect(marks.rows.every((r) => r.student_id === kids.daniel)).toBe(true);
  });
});
