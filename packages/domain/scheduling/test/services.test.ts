/**
 * Phase 2 acceptance at the service level, against a real database with RLS:
 * 1. generating a term skips Chol HaMoed; 2. a girl cannot be placed in a boys-only window, with a clear reason;
 * 3. instructor shift changes require acceptance, and only an applied change emits `scheduling.staff_changed`.
 * All people and places are fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { addLevel, createPolicyVersion, createProgram, listPrograms } from '@rswim/domain-settings';
import { addAvailabilityRule } from '@rswim/domain-staff';
import { addClosure, createPool, createVenue, getVenue, saveWindow } from '@rswim/domain-venues';
import {
  addToWaitlist,
  answerShiftChange,
  applyShiftChange,
  boardData,
  bookSlot,
  cancelBooking,
  createGroup,
  createTerm,
  escalateDueShiftChanges,
  generateSessions,
  getGroup,
  groupSuggestions,
  listShiftChanges,
  mySessions,
  listSlots,
  openSlots,
  placeFromWaitlist,
  placeStudent,
  previewPlacement,
  requestShiftChange,
  updateGroup,
  type TemplateInput,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const users: Record<'dana' | 'rina' | 'yossi', string> = { dana: '', rina: '', yossi: '' };
const staff: Record<'dana' | 'rina' | 'yossi', string> = { dana: '', rina: '', yossi: '' };
const kids: Record<string, string> = {};

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const events = async (type: string) =>
  (await q(`select payload from outbox where event_type = $1 order by created_at`, [type])).map(
    (r: { payload: Record<string, unknown> }) => r.payload,
  );
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, params: e.params };
    throw e;
  }
  return null;
};

let venueId: string;
let poolId: string;
let lanes: string[];
let kidsProgram: string;
let campProgram: string;
let levels: string[];
let termId: string;
let nowTermId: string;
/** Today in Israel per the database, and dates relative to it, so the parts that depend on "now" never go stale. */
let today: string;
let nextMonday: string; // a Monday at least a week ahead
let changeFrom: string; // the Monday a reassignment starts
let nextTuesday: string;
const plusDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const onOrAfter = (d: string, weekday: number) => {
  let x = d;
  while (new Date(`${x}T12:00:00Z`).getUTCDay() !== weekday) x = plusDays(x, 1);
  return x;
};

beforeAll(async () => {
  t = await createTestDatabase();
  today = (await t.pool.query(`select app.today()::text as d`)).rows[0].d;
  nextMonday = onOrAfter(plusDays(today, 7), 1);
  changeFrom = plusDays(nextMonday, 14);
  nextTuesday = onOrAfter(plusDays(today, 7), 2);
  const [org] = await q(
    `insert into organizations (slug, name) values ('sched', 'בדיקת שיבוץ') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  for (const [key, first, gender] of [
    ['dana', 'דנה', 'female'],
    ['rina', 'רינה', 'female'],
    ['yossi', 'יוסי', 'male'],
  ] as const) {
    const [s] = await q(
      `insert into staff_members (organization_id, first_name, last_name, gender, employment_type, skills)
       values ($1, $2, 'דמו', $3, 'employee', '{water_fear}') returning id`,
      [ctx.orgId, first, gender],
    );
    const [user] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    await q(
      `insert into memberships (organization_id, user_id, role, staff_member_id) values ($1, $2, 'instructor', $3)`,
      [ctx.orgId, user.id, s.id],
    );
    staff[key] = s.id;
    users[key] = user.id;
  }
  const [hh] = await q(
    `insert into households (organization_id, display_name) values ($1, 'משפחת דמו') returning id`,
    [ctx.orgId],
  );
  await q(
    `insert into guardians (organization_id, household_id, first_name, last_name) values ($1, $2, 'אמא', 'דמו')`,
    [ctx.orgId, hh.id],
  );
  for (const [key, first, gender, dob] of [
    ['noa', 'נועה', 'female', '2019-03-01'],
    ['maya', 'מאיה', 'female', '2019-06-01'],
    ['ari', 'ארי', 'male', '2019-05-01'],
    ['tamar', 'תמר', 'female', '2018-01-10'],
    ['lia', 'ליה', 'female', '2023-02-01'],
  ] as const) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', $4, $5) returning id`,
      [ctx.orgId, hh.id, first, gender, dob],
    );
    kids[key] = s.id;
  }

  await owner(async (tx) => {
    await createPolicyVersion(
      tx,
      ctx,
      { scopeType: 'org' },
      {
        effectiveFrom: '2026-01-01',
        rules: DEFAULT_ORG_RULES,
        notes: null,
      },
    );
    venueId = await createVenue(tx, ctx, {
      name: 'בריכת הדמו',
      kind: 'country_club',
      status: 'active',
      address: null,
      city: 'ירושלים',
      parkingInstructions: null,
      entryInstructions: null,
      frontDeskScript: null,
      notes: null,
    });
    poolId = await createPool(tx, ctx, venueId, {
      name: 'ראשית',
      indoor: true,
      tempMinC: null,
      tempMaxC: null,
      depthMinCm: null,
      depthMaxCm: null,
      laneCount: 4,
    });
    lanes = (await getVenue(tx, venueId))?.pools[0]?.lanes.map((l) => l.id) ?? [];
    const window = (weekday: number, genderRestriction: 'female' | 'male' | 'mixed') =>
      saveWindow(tx, ctx, venueId, {
        poolId,
        weekday,
        startsAt: '15:00',
        endsAt: '19:00',
        genderRestriction,
        effectiveFrom: '2026-09-01',
        effectiveTo: null,
        laneIds: lanes,
        notes: null,
      });
    await window(1, 'female'); // Monday: women and girls
    await window(3, 'male'); // Wednesday: men and boys
    await window(0, 'mixed'); // Sunday: mixed
    await window(2, 'mixed'); // Tuesday: mixed
    kidsProgram = await createProgram(tx, ctx, {
      code: 'kids',
      kind: 'group_kids',
      nameHe: 'קבוצת ילדים',
      nameEn: null,
      defaultDurationMin: 45,
      defaultCapacity: 6,
      minAgeMonths: 48,
      maxAgeMonths: 144,
      parentInWater: false,
      active: true,
    });
    for (const [code, name] of [
      ['l1', 'צב'],
      ['l2', 'דג'],
      ['l3', 'כריש'],
    ] as const) {
      await addLevel(tx, ctx, kidsProgram, { code, nameHe: name, nameEn: null, skills: [] });
    }
    levels =
      (await listPrograms(tx)).find((p) => p.id === kidsProgram)?.levels.map((l) => l.id) ?? [];
    campProgram = await createProgram(tx, ctx, {
      code: 'camp',
      kind: 'camp',
      nameHe: 'קייטנה',
      nameEn: null,
      defaultDurationMin: 60,
      defaultCapacity: 10,
      minAgeMonths: null,
      maxAgeMonths: null,
      parentInWater: false,
      active: true,
    });
    // Camps run on Chol HaMoed (POLICIES.md §7).
    await createPolicyVersion(
      tx,
      ctx,
      { scopeType: 'program', programId: campProgram },
      {
        effectiveFrom: '2026-01-01',
        rules: { calendar: { chol_hamoed: 'run' } },
        notes: null,
      },
    );
    for (const s of Object.values(staff)) {
      for (const weekday of [0, 1, 2, 3, 4]) {
        await addAvailabilityRule(tx, ctx, s, {
          weekday,
          startsAt: '14:00',
          endsAt: '20:00',
          venueId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        });
      }
    }
    termId = await createTerm(tx, ctx, {
      name: 'סתיו 2026',
      kind: 'school_year',
      startsOn: '2026-09-01',
      endsOn: '2027-01-31',
      notes: null,
    });
    nowTermId = await createTerm(tx, ctx, {
      name: 'המחזור הנוכחי',
      kind: 'custom',
      startsOn: plusDays(today, -14),
      endsOn: plusDays(today, 120),
      notes: null,
    });
  });
  await q(`update students set level_id = $1 where id = any($2)`, [
    levels[1],
    [kids.noa, kids.maya, kids.ari],
  ]);
});
afterAll(async () => {
  await t.drop();
});

const group = (over: Partial<TemplateInput>): TemplateInput => ({
  name: 'בנות דג',
  programId: kidsProgram,
  venueId,
  poolId,
  weekday: 1,
  startsAt: '16:00',
  durationMin: 45,
  laneIds: [lanes[0] as string],
  levelMinId: null,
  levelMaxId: null,
  ageMinMonths: 48,
  ageMaxMonths: 120,
  admittedGender: 'female',
  capacity: 6,
  requiredInstructorGender: null,
  requiredSkills: [],
  leadStaffId: null,
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  notes: null,
  ...over,
});

const ids: Record<string, string> = {};

describe('groups and the hard rules for a group', () => {
  it('creates a girls group in the Monday women/girls window; the lead waits for Dana to accept', async () => {
    ids.girls = await owner((tx) => createGroup(tx, ctx, group({ leadStaffId: staff.dana })));
    const detail = await owner((tx) => getGroup(tx, ids.girls as string));
    expect(detail?.group.leadStaffId).toBeNull();
    expect(detail?.shiftChanges.map((c) => [c.kind, c.status, c.toStaffId])).toEqual([
      ['reassign_group', 'pending', staff.dana],
    ]);
    await as('dana', (tx) =>
      answerShiftChange(
        tx,
        { orgId: ctx.orgId, userId: users.dana },
        detail?.shiftChanges[0]?.id as string,
        {
          accept: true,
          note: null,
        },
      ),
    );
    expect(
      await system((tx) => applyShiftChange(tx, ctx, detail?.shiftChanges[0]?.id as string)),
    ).toBe(true);
    expect((await owner((tx) => getGroup(tx, ids.girls as string)))?.group.leadStaffId).toBe(
      staff.dana,
    );
  });

  it('refuses a boys group in the women window, a lane already taken, and time outside every window', async () => {
    expect(
      await codeOf(owner((tx) => createGroup(tx, ctx, group({ admittedGender: 'male' })))),
    ).toMatchObject({
      code: 'scheduling.rules.windowAdmits',
    });
    expect(
      await codeOf(owner((tx) => createGroup(tx, ctx, group({ name: 'כפול', startsAt: '16:30' })))),
    ).toEqual({
      code: 'scheduling.rules.laneTaken',
      params: { group: 'בנות דג' },
    });
    expect(
      await codeOf(
        owner((tx) => createGroup(tx, ctx, group({ name: 'מאוחר', startsAt: '18:30' }))),
      ),
    ).toMatchObject({
      code: 'scheduling.rules.outsideWindow',
    });
    // A male lead is refused in a women window (scheduling.window_instructor_gender = match_window).
    expect(
      await codeOf(
        owner((tx) =>
          createGroup(
            tx,
            ctx,
            group({ name: 'בנות ב', laneIds: [lanes[1] as string], leadStaffId: staff.yossi }),
          ),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.windowInstructorGender' });
  });

  it('creates the Wednesday boys group, a Sunday mixed group and a camp group (acceptance off by policy for speed)', async () => {
    await owner((tx) =>
      createPolicyVersion(
        tx,
        ctx,
        { scopeType: 'venue', venueId },
        {
          effectiveFrom: '2026-01-01',
          rules: { staffing: { shift_change_requires_acceptance: false } },
          notes: null,
        },
      ),
    );
    ids.boys = await owner((tx) =>
      createGroup(
        tx,
        ctx,
        group({ name: 'בנים דג', weekday: 3, admittedGender: 'male', leadStaffId: staff.yossi }),
      ),
    );
    ids.mixed = await owner((tx) =>
      createGroup(
        tx,
        ctx,
        group({ name: 'מעורב', weekday: 0, admittedGender: 'mixed', leadStaffId: staff.rina }),
      ),
    );
    ids.camp = await owner((tx) =>
      createGroup(
        tx,
        ctx,
        group({
          name: 'קייטנת סוכות',
          programId: campProgram,
          weekday: 2,
          admittedGender: 'mixed',
          ageMinMonths: null,
          ageMaxMonths: null,
          effectiveTo: '2026-10-15',
          leadStaffId: staff.dana,
        }),
      ),
    );
    // With acceptance off the lead is applied at once.
    expect((await owner((tx) => getGroup(tx, ids.boys as string)))?.group.leadStaffId).toBe(
      staff.yossi,
    );
    // From today on the venue asks instructors again (a version in effect is history: a new one follows it).
    await owner((tx) =>
      createPolicyVersion(
        tx,
        ctx,
        { scopeType: 'venue', venueId },
        {
          effectiveFrom: today,
          rules: { staffing: { shift_change_requires_acceptance: true } },
          notes: null,
        },
      ),
    );
  });

  it('refuses moving the time of a group that has an instructor and sessions ahead', async () => {
    await owner((tx) => generateSessions(tx, ctx, nowTermId, [ids.girls as string]));
    expect(
      await codeOf(
        owner((tx) => updateGroup(tx, ctx, ids.girls as string, group({ startsAt: '17:00' }))),
      ),
    ).toMatchObject({ code: 'scheduling.errors.timeChangeNeedsNewGroup' });
    await owner((tx) => updateGroup(tx, ctx, ids.girls as string, group({ capacity: 5 })));
  });
});

describe('AC 1: generating a term skips Chol HaMoed', () => {
  it('generates every group without Yom Tov, Erev Chag or Chol HaMoed, and reports each skipped date', async () => {
    await owner((tx) =>
      addClosure(tx, ctx, venueId, {
        startsOn: '2026-12-01',
        endsOn: '2026-12-03',
        source: 'venue',
        reason: 'שיפוץ (דמו)',
      }),
    );
    const report = await owner((tx) => generateSessions(tx, ctx, termId));
    const dates = (await q(
      `select s.date::text as d, ct.name from sessions s join class_templates ct on ct.id = s.class_template_id`,
    )) as {
      d: string;
      name: string;
    }[];
    const regular = dates.filter((r) => r.name !== 'קייטנת סוכות').map((r) => r.d);
    // Chol HaMoed Sukkot 5787: 27 Sep → 2 Oct 2026; Yom Kippur 21 Sep; Rosh Hashana 12–13 Sep; Erev YK 20 Sep.
    for (const holiday of [
      '2026-09-27',
      '2026-09-28',
      '2026-09-30',
      '2026-09-21',
      '2026-09-13',
      '2026-09-20',
    ]) {
      expect(regular, holiday).not.toContain(holiday);
    }
    expect(regular).toContain('2026-09-07'); // an ordinary Monday
    expect(regular).not.toContain('2026-12-02'); // closure (Wednesday)
    const chol = report.skipped.filter((s) => s.reasons.includes('chol_hamoed'));
    expect(chol.map((s) => [s.date, s.groupName])).toEqual([
      ['2026-09-27', 'מעורב'],
      ['2026-09-28', 'בנות דג'],
      ['2026-09-30', 'בנים דג'],
    ]);
    expect(report.skipped.find((s) => s.date === '2026-12-02')).toMatchObject({
      reasons: ['venue_closure'],
      details: ['שיפוץ (דמו)'],
    });
    // The girls group was generated earlier for the current term; dates shared with it are not duplicated.
    const [dupes] = await q(
      `select count(*)::int as n from (select class_template_id, date from sessions group by 1, 2 having count(*) > 1) x`,
    );
    expect(dupes.n).toBe(0);
    expect(report.created).toBeGreaterThan(40);
  });

  it('runs the camp on Chol HaMoed because its program policy says so', async () => {
    const camp = (await q(
      `select s.date::text as d from sessions s where class_template_id = $1 order by s.date`,
      [ids.camp],
    )) as { d: string }[];
    expect(camp.map((r) => r.d)).toContain('2026-09-29'); // Tuesday of Chol HaMoed
    expect(camp.map((r) => r.d).at(-1)).toBe('2026-10-13'); // the camp ends on 15 Oct
  });

  it('adds nothing the second time, and records each session with its policy version and lead', async () => {
    const again = await owner((tx) => generateSessions(tx, ctx, termId));
    expect(again.created).toBe(0);
    const [row] = await q(
      `select count(*)::int as n, count(*) filter (where policy_version_key is null)::int as missing,
              count(*) filter (where (starts_at at time zone 'Asia/Jerusalem')::time <> '16:00')::int as wrong_time
       from sessions where class_template_id = $1`,
      [ids.girls],
    );
    expect(row).toMatchObject({ missing: 0, wrong_time: 0 });
    const [lead] = await q(
      `select count(*)::int as n from session_staff ss join sessions s on s.id = ss.session_id
       where s.class_template_id = $1 and ss.staff_member_id = $2 and ss.role = 'lead'`,
      [ids.girls, staff.dana],
    );
    expect(lead.n).toBe(row.n);
    expect(await events('scheduling.sessions_generated')).toHaveLength(3);
    await owner((tx) => generateSessions(tx, ctx, nowTermId));
  });
});

describe('AC 2: placing a girl in a boys-only window is refused with the reason', () => {
  it('places girls in the girls group and refuses Noa in the boys group, naming the window and the child', async () => {
    for (const k of ['noa', 'maya', 'tamar']) {
      await owner((tx) =>
        placeStudent(tx, ctx, {
          studentId: kids[k] as string,
          toTemplateId: ids.girls as string,
          fromTemplateId: null,
          onDate: '2026-09-01',
          status: 'active',
        }),
      );
    }
    const move = {
      studentId: kids.noa as string,
      toTemplateId: ids.boys as string,
      fromTemplateId: ids.girls as string,
      onDate: '2026-10-05',
      status: 'active' as const,
    };
    const preview = await owner((tx) => previewPlacement(tx, move));
    expect(preview.decision.ok).toBe(false);
    expect(preview.decision.violations[0]).toEqual({
      code: 'scheduling.rules.windowGender',
      params: { name: 'נועה', window: 'male', gender: 'female' },
    });
    expect(await codeOf(owner((tx) => placeStudent(tx, ctx, move)))).toMatchObject({
      code: 'scheduling.rules.windowGender',
    });
    // She is still in her group.
    const board = await owner((tx) => boardData(tx, venueId, '2026-10-05'));
    const girls = board.groups.find((g) => g.id === ids.girls);
    expect(girls?.members.map((m) => m.firstName)).toEqual(['מאיה', 'נועה', 'תמר']);
    expect(girls?.windowRestriction).toBe('female');
    expect(board.groups.find((g) => g.id === ids.boys)?.windowRestriction).toBe('male');
  });

  it('moves a child between groups that admit her, with a score and who to notify', async () => {
    const move = {
      studentId: kids.maya as string,
      toTemplateId: ids.mixed as string,
      fromTemplateId: ids.girls as string,
      onDate: '2026-09-14',
      status: 'active' as const,
    };
    const preview = await owner((tx) => previewPlacement(tx, move));
    expect(preview.decision.ok).toBe(true);
    expect(preview.notify).toEqual({
      guardians: ['אמא דמו'],
      instructors: ['דנה דמו', 'רינה דמו'],
    });
    await owner((tx) => placeStudent(tx, ctx, move));
    const rows = await q(
      `select ct.name, e.status, e.starts_on::text, e.ends_on::text, e.previous_enrollment_id is not null as linked
       from enrollments e join class_templates ct on ct.id = e.class_template_id
       where e.student_id = $1 order by e.starts_on`,
      [kids.maya],
    );
    expect(rows).toEqual([
      {
        name: 'בנות דג',
        status: 'completed',
        starts_on: '2026-09-01',
        ends_on: '2026-09-14',
        linked: false,
      },
      { name: 'מעורב', status: 'active', starts_on: '2026-09-14', ends_on: null, linked: true },
    ]);
    // Too young for the group's age band.
    expect(
      await codeOf(
        owner((tx) =>
          placeStudent(tx, ctx, { ...move, studentId: kids.lia as string, fromTemplateId: null }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.tooYoung' });
  });

  it('lets an instructor see only the children of groups they teach', async () => {
    const seen = await as('dana', (tx) =>
      tx.execute<{ first_name: string }>(sql`select first_name from students order by first_name`),
    );
    expect(seen.rows.map((r) => r.first_name)).toEqual(['נועה', 'תמר']);
    const yossi = await as('yossi', (tx) =>
      tx.execute<{ id: string }>(sql`select id from students`),
    );
    expect(yossi.rows).toEqual([]);
  });
});

describe('AC 3: instructor shift changes require acceptance', () => {
  let changeId: string;

  it('records the change as pending and leaves the sessions and parents alone', async () => {
    const r = await owner((tx) =>
      requestShiftChange(tx, ctx, {
        kind: 'reassign_group',
        classTemplateId: ids.girls as string,
        effectiveFrom: changeFrom,
        toStaffId: staff.rina,
        reason: 'דנה עוברת לבוקר',
      }),
    );
    expect(r.status).toBe('pending');
    changeId = r.id;
    const [lead] = await q(
      `select count(*)::int as n from session_staff ss join sessions s on s.id = ss.session_id
       where s.class_template_id = $1 and s.date >= $3 and ss.staff_member_id = $2`,
      [ids.girls, staff.rina, changeFrom],
    );
    expect(lead.n).toBe(0);
    expect(
      (await events('scheduling.staff_changed')).filter((p) => p.shiftChangeId === changeId),
    ).toEqual([]);
    expect(
      await codeOf(
        owner((tx) =>
          requestShiftChange(tx, ctx, {
            kind: 'reassign_group',
            classTemplateId: ids.girls as string,
            effectiveFrom: changeFrom,
            toStaffId: staff.rina,
            reason: null,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.shift.alreadyPending' });
  });

  it('only the instructor it waits for can answer, and only with accept or decline', async () => {
    const dana = await as('dana', (tx) => listShiftChanges(tx));
    expect(dana.map((c) => c.id)).toContain(changeId); // she is the one being replaced
    await expect(
      as('dana', (tx) =>
        answerShiftChange(tx, { orgId: ctx.orgId, userId: users.dana }, changeId, {
          accept: true,
          note: null,
        }),
      ),
    ).rejects.toThrow();
    expect((await as('yossi', (tx) => listShiftChanges(tx))).map((c) => c.id)).not.toContain(
      changeId,
    );
    // The instructor app lists only the answers each instructor owes.
    expect(
      (await as('dana', (tx) => listShiftChanges(tx, { awaitingMe: true }))).map((c) => c.id),
    ).not.toContain(changeId);
    expect(
      (await as('rina', (tx) => listShiftChanges(tx, { awaitingMe: true }))).map((c) => c.id),
    ).toContain(changeId);
    const forged = await as('rina', (tx) =>
      tx.execute(sql`update shift_changes set to_staff_id = ${staff.yossi} where id = ${changeId}`),
    ).catch((e: { cause?: { message?: string } }) => e.cause?.message);
    expect(forged).toMatch(/only the instructor/);
  });

  it('applies on acceptance (worker) and only then tells parents', async () => {
    await as('rina', (tx) =>
      answerShiftChange(tx, { orgId: ctx.orgId, userId: users.rina }, changeId, {
        accept: true,
        note: 'בשמחה',
      }),
    );
    expect(await events('scheduling.shift_change_answered')).toContainEqual({
      shiftChangeId: changeId,
      accepted: true,
    });
    expect(
      (await events('scheduling.staff_changed')).filter((p) => p.shiftChangeId === changeId),
    ).toEqual([]);
    expect(await system((tx) => applyShiftChange(tx, ctx, changeId))).toBe(true);
    expect(await system((tx) => applyShiftChange(tx, ctx, changeId))).toBe(false);
    const rinaDays = (await as('rina', (tx) => mySessions(tx, changeFrom, changeFrom))).map(
      (x) => x.classTemplateId,
    );
    expect(rinaDays).toContain(ids.girls);
    const leads = await q(
      `select s.date::text as d, sm.first_name from sessions s
       join session_staff ss on ss.session_id = s.id and ss.role = 'lead'
       join staff_members sm on sm.id = ss.staff_member_id
       where s.class_template_id = $1 and s.date in ($2, $3) order by s.date`,
      [ids.girls, nextMonday, changeFrom],
    );
    expect(leads).toEqual([
      { d: nextMonday, first_name: 'דנה' },
      { d: changeFrom, first_name: 'רינה' },
    ]);
    const [applied] = (await events('scheduling.staff_changed')).filter(
      (p) => p.shiftChangeId === changeId,
    );
    expect(applied).toMatchObject({
      kind: 'reassign_group',
      fromStaffId: staff.dana,
      toStaffId: staff.rina,
      acceptedByInstructor: true,
    });
    expect((applied?.sessionIds as string[]).length).toBeGreaterThan(5 - 1);
  });

  it('applies nothing when declined, and escalates an unanswered change to the owner', async () => {
    const [session] = await q(
      `select id from sessions where class_template_id = $1 and date = $2`,
      [ids.girls, plusDays(changeFrom, 7)],
    );
    const declined = await owner((tx) =>
      requestShiftChange(tx, ctx, {
        kind: 'reschedule_session',
        sessionId: session.id,
        startsAt: '17:00',
        endsAt: '17:45',
        reason: null,
      }),
    );
    await as('rina', (tx) =>
      answerShiftChange(tx, { orgId: ctx.orgId, userId: users.rina }, declined.id, {
        accept: false,
        note: 'לא מתאים לי',
      }),
    );
    expect(await codeOf(system((tx) => applyShiftChange(tx, ctx, declined.id)))).toMatchObject({
      code: 'scheduling.shift.notAccepted',
    });
    const [time] = await q(
      `select (starts_at at time zone 'Asia/Jerusalem')::time::text as t from sessions where id = $1`,
      [session.id],
    );
    expect(time.t).toBe('16:00:00');

    const waiting = await owner((tx) =>
      requestShiftChange(tx, ctx, {
        kind: 'reassign_session',
        sessionId: session.id,
        toStaffId: staff.dana,
        reason: null,
      }),
    );
    expect(
      await system((tx) => escalateDueShiftChanges(tx, ctx, new Date(Date.now() + 11 * 3_600_000))),
    ).toBe(0);
    expect(
      await system((tx) => escalateDueShiftChanges(tx, ctx, new Date(Date.now() + 13 * 3_600_000))),
    ).toBe(1);
    expect((await owner((tx) => listShiftChanges(tx)))[0]).toMatchObject({
      id: waiting.id,
      status: 'escalated',
    });
    // The owner may then apply it herself; the event records that the instructor did not accept.
    await owner((tx) => applyShiftChange(tx, ctx, waiting.id, { withoutAcceptance: true }));
    expect(
      (await events('scheduling.staff_changed')).find((p) => p.shiftChangeId === waiting.id),
    ).toMatchObject({
      acceptedByInstructor: false,
    });
  });

  it('refuses a new instructor who cannot take the group', async () => {
    expect(
      await codeOf(
        owner((tx) =>
          requestShiftChange(tx, ctx, {
            kind: 'reassign_group',
            classTemplateId: ids.girls as string,
            effectiveFrom: plusDays(changeFrom, 28),
            toStaffId: staff.yossi,
            reason: null,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.windowInstructorGender' });
  });
});

describe('private slots and the waitlist', () => {
  it('opens weekly private slots, books one, refuses a full slot and a clash', async () => {
    const slotIds = await owner((tx) =>
      openSlots(tx, ctx, {
        staffMemberId: staff.dana,
        venueId,
        poolId,
        programId: null,
        kind: 'private',
        date: nextTuesday,
        startsAt: '18:00',
        endsAt: '18:30',
        capacity: null,
        repeatWeeks: 3,
        notes: null,
      }),
    );
    expect(slotIds).toHaveLength(3);
    await owner((tx) => bookSlot(tx, ctx, slotIds[0] as string, kids.ari as string));
    expect(
      await codeOf(owner((tx) => bookSlot(tx, ctx, slotIds[0] as string, kids.noa as string))),
    ).toMatchObject({
      code: 'scheduling.errors.slotNotOpen',
    });
    const slots = await owner((tx) =>
      listSlots(tx, {
        from: nextTuesday,
        to: plusDays(nextTuesday, 20),
        staffMemberId: staff.dana,
      }),
    );
    expect(slots.map((s) => [s.date, s.status, s.bookings.length])).toEqual([
      [nextTuesday, 'full', 1],
      [plusDays(nextTuesday, 7), 'open', 0],
      [plusDays(nextTuesday, 14), 'open', 0],
    ]);
    await owner((tx) => cancelBooking(tx, ctx, slots[0]?.bookings[0]?.id as string));
    expect(
      await codeOf(
        owner((tx) =>
          openSlots(tx, ctx, {
            staffMemberId: staff.dana,
            venueId,
            poolId: null,
            programId: null,
            kind: 'trial',
            date: plusDays(nextTuesday, 7),
            startsAt: '18:15',
            endsAt: '18:45',
            capacity: null,
            repeatWeeks: 1,
            notes: null,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.instructorBusyOn' });
    // Rina teaches the Monday girls group from the change date on: no slot on top of it.
    expect(
      await codeOf(
        owner((tx) =>
          openSlots(tx, ctx, {
            staffMemberId: staff.rina,
            venueId,
            poolId: null,
            programId: null,
            kind: 'private',
            date: plusDays(changeFrom, 14),
            startsAt: '16:15',
            endsAt: '16:45',
            capacity: null,
            repeatWeeks: 1,
            notes: null,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.instructorBusyOn' });
  });

  it('suggests a new group from waiting children and places one from the list', async () => {
    const extra: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [s] = await q(
        `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
         select organization_id, household_id, $2, 'ממתינה', 'female', '2023-03-15' from students where id = $1 returning id`,
        [kids.noa, `ממתינה ${i + 1}`],
      );
      extra.push(s.id);
    }
    for (const s of [...extra, kids.lia as string]) {
      await owner((tx) =>
        addToWaitlist(tx, ctx, {
          studentId: s,
          programId: kidsProgram,
          venueId,
          classTemplateId: null,
          preferredWeekdays: [0],
          earliestAt: '16:20',
          latestAt: null,
          priority: 0,
          notes: null,
        }),
      );
    }
    const suggestions = await owner((tx) => groupSuggestions(tx));
    expect(suggestions).toEqual([
      expect.objectContaining({
        weekday: 0,
        hour: '16:00',
        ageFromYears: 3,
        ageToYears: 4,
        entryIds: expect.any(Array),
      }),
    ]);
    expect(suggestions[0]?.entryIds).toHaveLength(5);
    const [entry] = await q(`select id from waitlist_entries where student_id = $1`, [extra[0]]);
    expect(
      await codeOf(
        owner((tx) =>
          placeFromWaitlist(tx, ctx, entry.id, {
            toTemplateId: ids.mixed as string,
            onDate: today,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.rules.tooYoung' });
    expect(
      await codeOf(
        owner((tx) =>
          addToWaitlist(tx, ctx, {
            studentId: extra[0] as string,
            programId: kidsProgram,
            venueId: null,
            classTemplateId: null,
            preferredWeekdays: [],
            earliestAt: null,
            latestAt: null,
            priority: 0,
            notes: null,
          }),
        ),
      ),
    ).toMatchObject({ code: 'scheduling.errors.alreadyWaiting' });
    await q(`update class_templates set age_min_months = null where id = $1`, [ids.mixed]);
    await owner((tx) =>
      placeFromWaitlist(tx, ctx, entry.id, { toTemplateId: ids.mixed as string, onDate: today }),
    );
    const [placed] = await q(
      `select status, placed_enrollment_id is not null as linked from waitlist_entries where id = $1`,
      [entry.id],
    );
    expect(placed).toEqual({ status: 'placed', linked: true });
  });
});
