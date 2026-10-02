/**
 * Phase 3 acceptance at the service level, against a real database with RLS:
 * 1. a 13h-before absence yields a credit expiring at the end of the month; an 11h one doesn't;
 * 2. a 3-day venue closure issues credits to every affected active student, opens makeup windows and produces an
 *    uptake report that bookings move.
 * Plus the marketplace, offline attendance, trials, forms and who may do what. All people and places are fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  bookTrial,
  convertTrial,
  createFormVersion,
  formsDueFor,
  publishFormVersion,
  recordTrialVerdict,
  submitForm,
} from '@rswim/domain-enrollment';
import { createPolicyVersion, createProgram } from '@rswim/domain-settings';
import {
  createGroup,
  createTerm,
  generateSessions,
  placeStudent,
  removeStudent,
  type TemplateInput,
} from '@rswim/domain-scheduling';
import { addAvailabilityRule } from '@rswim/domain-staff';
import { createPool, createVenue, getVenue, saveWindow } from '@rswim/domain-venues';
import {
  bookMakeup,
  cancelMakeupBooking,
  closeClosureEvent,
  closureReport,
  createClosureEvent,
  expireDueCredits,
  listCredits,
  makeupOffers,
  openClosureEvent,
  previewClosure,
  processPendingNotices,
  recordAttendance,
  reportAbsence,
  sessionLineup,
  setProgress,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { rina: '', parent1: '', parent2: '' };
let rinaStaff = '';
const kids: Record<string, string> = {};
const households: Record<'h1' | 'h2' | 'h3', string> = { h1: '', h2: '', h3: '' };

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const ctxOf = (who: keyof typeof users): ServiceContext => ({
  orgId: ctx.orgId,
  userId: users[who],
});
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
/** The database's own message under drizzle's "Failed query" wrapper. */
const dbError = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
  }
  return null;
};
const events = async (type: string) =>
  (await q(`select payload from outbox where event_type = $1 order by created_at`, [type])).map(
    (r: { payload: Record<string, unknown> }) => r.payload,
  );

const plusDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
/** An instant as typed in Israel ("YYYY-MM-DDTHH:MM"). */
const israelLocal = (instant: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(instant)
    .replace(' ', 'T');
const endOfMonth = (d: string) => {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

let today: string;
let v1 = '';
let v2 = '';
const groups: Record<'sun' | 'mon' | 'tue' | 'thu', string> = {
  sun: '',
  mon: '',
  tue: '',
  thu: '',
};
interface S {
  id: string;
  date: string;
  starts_at: Date;
  class_template_id: string;
}
let sessions: S[] = [];
const sessionOf = (group: keyof typeof groups, date: string) =>
  sessions.find((s) => s.class_template_id === groups[group] && s.date === date);
const nextSession = (group: keyof typeof groups, after: string) =>
  sessions.find((s) => s.class_template_id === groups[group] && s.date > after) as S;
/** The closure: a Sunday, Monday and Tuesday with sessions at venue 1, soon after today. */
let closure: { from: string; to: string };

beforeAll(async () => {
  t = await createTestDatabase();
  today = (await t.pool.query(`select app.today()::text as d`)).rows[0].d;
  const [org] = await q(
    `insert into organizations (slug, name) values ('att', 'בדיקת נוכחות') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  const [rina] = await q(
    `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
     values ($1, 'רינה', 'דמו', 'female', 'employee') returning id`,
    [ctx.orgId],
  );
  rinaStaff = rina.id;
  const [ru] = await q(`insert into auth.users (email) values ('rina@example.test') returning id`);
  users.rina = ru.id;
  await q(
    `insert into memberships (organization_id, user_id, role, staff_member_id) values ($1, $2, 'instructor', $3)`,
    [ctx.orgId, ru.id, rina.id],
  );
  for (const h of ['h1', 'h2', 'h3'] as const) {
    const [hh] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, `משפחת ${h}`],
    );
    households[h] = hh.id;
  }
  for (const [key, h] of [
    ['parent1', 'h1'],
    ['parent2', 'h2'],
  ] as const) {
    const [g] = await q(
      `insert into guardians (organization_id, household_id, first_name, last_name) values ($1, $2, 'הורה', $3) returning id`,
      [ctx.orgId, households[h], key],
    );
    const [pu] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = pu.id;
    await q(
      `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
      [ctx.orgId, pu.id, g.id],
    );
  }
  for (const [key, h, gender] of [
    ['ana', 'h1', 'female'],
    ['ben', 'h1', 'male'],
    ['gil', 'h2', 'male'],
    ['dina', 'h3', 'female'],
    ['eli', 'h3', 'male'],
    ['fay', 'h3', 'female'],
    ['hila', 'h3', 'female'],
    ['ido', 'h3', 'male'],
    ['josh', 'h3', 'male'],
    ['kim', 'h3', 'female'],
  ] as const) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', $4, '2018-05-01') returning id`,
      [ctx.orgId, households[h], key, gender],
    );
    kids[key] = s.id;
  }
  await q(`update students set water_fear = true, photo_consent = false where id = $1`, [kids.ana]);
  await q(`update students set enc_medical_notes = '\\x00' where id = $1`, [kids.ben]);

  await owner(async (tx) => {
    await createPolicyVersion(
      tx,
      ctx,
      { scopeType: 'org' },
      {
        effectiveFrom: '2026-01-01',
        rules: {
          ...DEFAULT_ORG_RULES,
          staffing: { ...DEFAULT_ORG_RULES.staffing, shift_change_requires_acceptance: false },
        },
        notes: null,
      },
    );
    for (const weekday of [0, 1, 2, 3, 4]) {
      await addAvailabilityRule(tx, ctx, rinaStaff, {
        weekday,
        startsAt: '14:00',
        endsAt: '20:00',
        venueId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      });
    }
    const kidsProgram = await createProgram(tx, ctx, {
      code: 'kids',
      kind: 'group_kids',
      nameHe: 'קבוצת ילדים',
      nameEn: null,
      defaultDurationMin: 45,
      defaultCapacity: 6,
      minAgeMonths: null,
      maxAgeMonths: null,
      parentInWater: false,
      active: true,
    });
    for (const [key, name] of [
      ['v1', 'בריכה אחת'],
      ['v2', 'בריכה שתיים'],
    ] as const) {
      const venueId = await createVenue(tx, ctx, {
        name,
        kind: 'country_club',
        status: 'active',
        address: null,
        city: 'ירושלים',
        parkingInstructions: null,
        entryInstructions: null,
        frontDeskScript: null,
        notes: null,
      });
      const poolId = await createPool(tx, ctx, venueId, {
        name: 'ראשית',
        indoor: true,
        tempMinC: null,
        tempMaxC: null,
        depthMinCm: null,
        depthMaxCm: null,
        laneCount: 2,
      });
      const lanes = (await getVenue(tx, venueId))?.pools[0]?.lanes.map((l) => l.id) ?? [];
      for (const weekday of [0, 1, 2, 3, 4]) {
        await saveWindow(tx, ctx, venueId, {
          poolId,
          weekday,
          startsAt: '15:00',
          endsAt: '19:00',
          genderRestriction: 'mixed',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          laneIds: lanes,
          notes: null,
        });
      }
      const group = (name: string, weekday: number, capacity: number): TemplateInput => ({
        name,
        programId: kidsProgram,
        venueId,
        poolId,
        weekday,
        startsAt: '17:00',
        durationMin: 45,
        laneIds: [lanes[0] as string],
        levelMinId: null,
        levelMaxId: null,
        ageMinMonths: null,
        ageMaxMonths: null,
        admittedGender: 'mixed',
        capacity,
        requiredInstructorGender: null,
        requiredSkills: [],
        leadStaffId: rinaStaff,
        effectiveFrom: plusDays(today, -21),
        effectiveTo: null,
        notes: null,
      });
      if (key === 'v1') {
        v1 = venueId;
        groups.sun = await createGroup(tx, ctx, group('ראשון', 0, 5));
        groups.mon = await createGroup(tx, ctx, group('שני', 1, 6));
        groups.tue = await createGroup(tx, ctx, group('שלישי', 2, 4));
      } else {
        v2 = venueId;
        groups.thu = await createGroup(tx, ctx, group('חמישי', 4, 3));
      }
    }
    const termId = await createTerm(tx, ctx, {
      name: 'מחזור הבדיקה',
      kind: 'custom',
      startsOn: plusDays(today, -14),
      endsOn: plusDays(today, 70),
      notes: null,
    });
    await generateSessions(tx, ctx, termId);
    const place = (kid: string, group: string, onDate: string) =>
      placeStudent(tx, ctx, {
        studentId: kids[kid] as string,
        toTemplateId: group,
        fromTemplateId: null,
        onDate,
        status: 'active',
      });
    const start = plusDays(today, -14);
    for (const k of ['ana', 'ben', 'dina', 'fay']) await place(k, groups.sun, start);
    for (const k of ['gil', 'hila']) await place(k, groups.mon, start);
    for (const k of ['ana', 'ido']) await place(k, groups.tue, start);
    for (const k of ['josh', 'kim']) await place(k, groups.thu, start);
  });
  sessions = (
    await q(
      `select id, date::text as date, starts_at, class_template_id from sessions where status = 'scheduled' order by starts_at`,
    )
  ).map((r: S) => ({ ...r, starts_at: new Date(r.starts_at) }));
  // The first Sunday from tomorrow on whose Sunday, Monday and Tuesday all have lessons at venue 1.
  for (let d = plusDays(today, 1); ; d = plusDays(d, 1)) {
    if (
      weekdayOf(d) === 0 &&
      sessionOf('sun', d) &&
      sessionOf('mon', plusDays(d, 1)) &&
      sessionOf('tue', plusDays(d, 2))
    ) {
      closure = { from: d, to: plusDays(d, 2) };
      break;
    }
  }
  // Dina is frozen; Fay left the group before the closure.
  await q(`update enrollments set status = 'frozen' where student_id = $1`, [kids.dina]);
  await owner((tx) =>
    removeStudent(tx, ctx, {
      studentId: kids.fay as string,
      templateId: groups.sun,
      onDate: today,
    }),
  );
});
afterAll(async () => {
  await t.drop();
});

describe('Phase 3 acceptance 1: absence notices and makeup credits', () => {
  it('a notice 13 hours before yields a credit expiring at the end of the month; 11 hours before does not', async () => {
    const lesson = nextSession('mon', closure.to);
    const thirteen = israelLocal(new Date(lesson.starts_at.getTime() - 13 * 3_600_000));
    const eleven = israelLocal(new Date(lesson.starts_at.getTime() - 11 * 3_600_000));

    const timely = await owner((tx) =>
      reportAbsence(tx, ctx, {
        sessionId: lesson.id,
        studentId: kids.gil as string,
        channel: 'phone',
        receivedAt: thirteen,
      }),
    );
    expect(timely).toMatchObject({
      status: 'processed',
      classification: 'timely',
      notice: { code: 'attendance.decision.timely', params: { hours: 13, minutes: 0, min: 12 } },
      credit: { code: 'attendance.decision.creditIssued' },
    });
    const [credit] = await q(`select * from makeup_credits where id = $1`, [timely.creditId]);
    expect(credit).toMatchObject({
      status: 'open',
      reason: 'notified_absence',
      source_session_id: lesson.id,
      counts_toward_cap: true,
    });
    expect(credit.expires_on.toISOString?.() ? credit.expires_on : credit.expires_on).toBeTruthy();
    const [{ e }] = await q(`select expires_on::text as e from makeup_credits where id = $1`, [
      timely.creditId,
    ]);
    expect(e).toBe(endOfMonth(lesson.date));
    expect(credit.policy_version_key).toMatch(/.+/);
    const [notice] = await q(`select * from absence_notices where id = $1`, [timely.noticeId]);
    expect(notice).toMatchObject({
      status: 'processed',
      classification: 'timely',
      minutes_before: 780,
      credit_id: timely.creditId,
      policy_version_key: credit.policy_version_key,
      channel: 'phone',
    });

    const late = await owner((tx) =>
      reportAbsence(tx, ctx, {
        sessionId: lesson.id,
        studentId: kids.hila as string,
        channel: 'whatsapp',
        receivedAt: eleven,
      }),
    );
    expect(late).toMatchObject({
      status: 'processed',
      classification: 'late_notice',
      creditId: null,
      notice: { code: 'attendance.decision.lateNotice', params: { hours: 11 } },
      credit: { code: 'attendance.decision.lateNoMakeup' },
    });
    expect(await q(`select 1 from makeup_credits where student_id = $1`, [kids.hila])).toEqual([]);
    expect((await events('attendance.absence_processed')).length).toBe(2);
  });

  it('stops at one makeup a month, refuses a second notice for the same lesson and a child not in it', async () => {
    const first = nextSession('mon', closure.to);
    const second = sessions.find(
      (s) =>
        s.class_template_id === groups.mon &&
        s.date > first.date &&
        s.date.slice(0, 7) === first.date.slice(0, 7),
    );
    if (second) {
      const capped = await owner((tx) =>
        reportAbsence(tx, ctx, {
          sessionId: second.id,
          studentId: kids.gil as string,
          channel: 'phone',
          receivedAt: israelLocal(new Date(second.starts_at.getTime() - 48 * 3_600_000)),
        }),
      );
      expect(capped).toMatchObject({
        classification: 'timely',
        creditId: null,
        credit: { code: 'attendance.decision.monthlyCap', params: { max: 1 } },
      });
    }
    expect(
      await codeOf(
        owner((tx) =>
          reportAbsence(tx, ctx, {
            sessionId: first.id,
            studentId: kids.gil as string,
            channel: 'phone',
            receivedAt: '',
          }),
        ),
      ),
    ).toBe('attendance.errors.alreadyReported');
    expect(
      await codeOf(
        owner((tx) =>
          reportAbsence(tx, ctx, {
            sessionId: first.id,
            studentId: kids.josh as string,
            channel: 'phone',
            receivedAt: '',
          }),
        ),
      ),
    ).toBe('attendance.errors.notInSession');
  });

  it('a parent’s notice is received now and waits; the worker classifies it, whatever the parent sent', async () => {
    const lesson = nextSession('sun', plusDays(closure.to, 7));
    const outcome = await as('parent1', (tx) =>
      reportAbsence(tx, ctxOf('parent1'), {
        sessionId: lesson.id,
        studentId: kids.ben as string,
        channel: 'phone',
        receivedAt: '2020-01-01T00:00',
      }),
    );
    expect(outcome).toMatchObject({ status: 'pending', creditId: null });
    const [n] = await q(`select * from absence_notices where id = $1`, [outcome.noticeId]);
    expect(n.channel).toBe('parent_portal');
    expect(Math.abs(new Date(n.received_at).getTime() - Date.now())).toBeLessThan(60_000);
    expect(await events('attendance.absence_reported')).toEqual([
      { noticeId: outcome.noticeId, sessionId: lesson.id, studentId: kids.ben },
    ]);
    // A forged insert straight into the table gets the same treatment.
    await as('parent1', (tx) =>
      tx.execute(sql`insert into absence_notices (organization_id, session_id, student_id, channel, received_at,
                       status, classification)
                     values (${ctx.orgId}, ${nextSession('tue', plusDays(closure.to, 7)).id}, ${kids.ana},
                             'phone', '2020-01-01', 'processed', 'timely')`),
    );
    const [forged] = await q(
      `select status, classification, channel from absence_notices where student_id = $1`,
      [kids.ana],
    );
    expect(forged).toEqual({ status: 'pending', classification: null, channel: 'parent_portal' });
    expect(
      await system((tx) => processPendingNotices(tx, { orgId: ctx.orgId, userId: null })),
    ).toBe(2);
    const [after] = await q(
      `select status, classification, credit_id from absence_notices where id = $1`,
      [outcome.noticeId],
    );
    expect(after.status).toBe('processed');
    expect(after.classification).toBe('timely');
    expect(after.credit_id).not.toBeNull();
    // Parents read their own credits only, and cannot issue one.
    expect(
      (await as('parent1', (tx) => listCredits(tx))).every((c) =>
        [kids.ben, kids.ana].includes(c.studentId),
      ),
    ).toBe(true);
    expect(
      await as('parent2', (tx) => listCredits(tx, { studentIds: [kids.ben as string] })),
    ).toEqual([]);
    expect(
      await dbError(
        as('parent1', (tx) =>
          tx.execute(sql`insert into makeup_credits (organization_id, student_id, program_id, reason, issued_on, expires_on)
                       select ${ctx.orgId}, ${kids.ben}, program_id, 'goodwill', current_date, current_date + 30
                       from class_templates limit 1`),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('Phase 3 acceptance 2: a 3-day venue closure', () => {
  let eventId = '';

  it('previews every affected session and child, with who gets a credit and why not', async () => {
    // Eli has a trial in the closed Sunday lesson.
    await owner((tx) =>
      bookTrial(tx, ctx, {
        studentId: kids.eli as string,
        sessionId: sessionOf('sun', closure.from)?.id as string,
      }),
    );
    const preview = await owner((tx) =>
      previewClosure(tx, {
        venueId: v1,
        startsOn: closure.from,
        endsOn: closure.to,
        source: 'water_quality',
      }),
    );
    expect(preview.sessions.map((s) => [s.groupName, s.date])).toEqual([
      ['ראשון', closure.from],
      ['שני', plusDays(closure.from, 1)],
      ['שלישי', closure.to],
    ]);
    const sunday = preview.sessions[0]?.children.map((c) => [
      c.studentId,
      c.getsCredit,
      c.why.code,
    ]);
    expect(sunday).toEqual(
      expect.arrayContaining([
        [kids.ana, true, 'attendance.closure.credit'],
        [kids.ben, true, 'attendance.closure.credit'],
        [kids.dina, false, 'attendance.closure.frozen'],
        [kids.eli, false, 'attendance.closure.trial'],
      ]),
    );
    expect(sunday?.some(([id]) => id === kids.fay)).toBe(false);
    expect(preview.treatment).toMatchObject({
      sessionStatus: 'cancelled_external',
      guarantee: 'best_effort',
      issuesCredits: true,
    });
    // ana ×2 (Sunday, Tuesday), ben, gil, hila, ido.
    expect(preview.totals).toMatchObject({ sessions: 3, credits: 6, children: 7 });
  });

  it('opening it cancels the sessions, issues one credit per lost lesson, opens the window and cancels the trial', async () => {
    const deadline = plusDays(closure.to, 30);
    eventId = await owner((tx) =>
      createClosureEvent(tx, ctx, {
        venueId: v1,
        startsOn: closure.from,
        endsOn: closure.to,
        source: 'water_quality',
        reason: 'תקלת מים (דמו)',
        makeupFrom: '',
        makeupDeadline: deadline,
        endRule: '',
      }),
    );
    expect((await q(`select status from closure_events where id = $1`, [eventId]))[0].status).toBe(
      'draft',
    );
    // Nothing changed yet.
    expect(
      (
        await q(`select status from sessions where id = $1`, [sessionOf('sun', closure.from)?.id])
      )[0].status,
    ).toBe('scheduled');
    const result = await owner((tx) => openClosureEvent(tx, ctx, eventId));
    expect(result).toEqual({ sessionsCancelled: 3, creditsIssued: 6 });
    const cancelled = await q(
      `select status, closure_event_id from sessions where venue_id = $1 and date between $2 and $3`,
      [v1, closure.from, closure.to],
    );
    expect(cancelled).toHaveLength(3);
    expect(
      cancelled.every(
        (s: { status: string; closure_event_id: string }) =>
          s.status === 'cancelled_external' && s.closure_event_id === eventId,
      ),
    ).toBe(true);
    const credits = await q(
      `select student_id, valid_from::text as f, expires_on::text as e, reason, counts_toward_cap, status
       from makeup_credits where closure_event_id = $1`,
      [eventId],
    );
    expect(credits.map((c: { student_id: string }) => c.student_id).sort()).toEqual(
      [kids.ana, kids.ana, kids.ben, kids.gil, kids.hila, kids.ido].sort(),
    );
    expect(credits[0]).toMatchObject({
      f: plusDays(closure.to, 1),
      e: deadline,
      reason: 'external_closure',
      counts_toward_cap: false,
      status: 'open',
    });
    expect((await q(`select status from trials where student_id = $1`, [kids.eli]))[0].status).toBe(
      'cancelled',
    );
    expect(await q(`select 1 from enrollments where student_id = $1`, [kids.eli])).toEqual([]);
    // The venue closure exists too, so a regenerated term skips the dates.
    expect(await q(`select source from venue_closures where venue_id = $1`, [v1])).toEqual([
      { source: 'water_quality' },
    ]);
    expect(await events('attendance.closure_opened')).toEqual([
      expect.objectContaining({ closureEventId: eventId, sessionsCancelled: 3, creditsIssued: 6 }),
    ]);
    expect(await codeOf(owner((tx) => openClosureEvent(tx, ctx, eventId)))).toBe(
      'attendance.errors.eventNotDraft',
    );
  });

  it('the family sees makeup seats inside the window and books one; the report counts it', async () => {
    const [anaCredit] = await q(
      `select id from makeup_credits where closure_event_id = $1 and student_id = $2 limit 1`,
      [eventId, kids.ana],
    );
    const { offers } = await as('parent1', (tx) => makeupOffers(tx, anaCredit.id));
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.date > closure.to && o.decision.ok)).toBe(true);
    // Ana's own groups (Sunday, Tuesday) are never offered.
    const offeredGroups = new Set(
      offers.map((o) => sessions.find((s) => s.id === o.sessionId)?.class_template_id),
    );
    expect(offeredGroups.has(groups.sun) || offeredGroups.has(groups.tue)).toBe(false);
    const thursday = nextSession('thu', closure.to);
    const offer = offers.find((o) => o.sessionId === thursday.id);
    expect(offer).toMatchObject({ groupName: 'חמישי', venueName: 'בריכה שתיים', freeSeats: 1 });
    await as('parent1', (tx) =>
      bookMakeup(tx, ctxOf('parent1'), { creditId: anaCredit.id, sessionId: thursday.id }),
    );
    expect(
      (await q(`select status from makeup_credits where id = $1`, [anaCredit.id]))[0].status,
    ).toBe('booked');
    const { report } = await owner((tx) => closureReport(tx, eventId));
    expect(report.total).toMatchObject({ issued: 6, booked: 1, outstanding: 5 });
    expect(report.rows.find((r) => r.groupName === 'ראשון')).toMatchObject({ issued: 2 });
  });

  it('the last seat goes once: another family cannot book the full session', async () => {
    const thursday = nextSession('thu', closure.to);
    const [gilCredit] = await q(
      `select id from makeup_credits where closure_event_id = $1 and student_id = $2`,
      [eventId, kids.gil],
    );
    const { offers } = await as('parent2', (tx) => makeupOffers(tx, gilCredit.id));
    expect(offers.some((o) => o.sessionId === thursday.id)).toBe(false);
    expect(
      await codeOf(
        as('parent2', (tx) =>
          bookMakeup(tx, ctxOf('parent2'), { creditId: gilCredit.id, sessionId: thursday.id }),
        ),
      ),
    ).toBe('attendance.decision.noSeat');
    // Even a direct insert is stopped by the seat check under the row lock.
    expect(
      await dbError(
        as('parent2', (tx) =>
          tx.execute(sql`insert into makeup_bookings (organization_id, credit_id, session_id, student_id)
                       values (${ctx.orgId}, ${gilCredit.id}, ${thursday.id}, ${kids.gil})`),
        ),
      ),
    ).toMatch(/attendance.errors.noSeat/);
    // And nobody books with someone else's credit.
    expect(
      await dbError(
        as('parent2', (tx) =>
          tx.execute(sql`insert into makeup_bookings (organization_id, credit_id, session_id, student_id)
                       select ${ctx.orgId}, id, ${thursday.id}, ${kids.gil} from makeup_credits
                       where student_id = ${kids.gil} limit 1`),
        ),
      ),
    ).toMatch(/attendance.errors/);
  });

  it('the instructor marks the guest present: the booking is attended and the credit used', async () => {
    const thursday = nextSession('thu', closure.to);
    const lineup = await as('rina', (tx) => sessionLineup(tx, thursday.id));
    const ana = lineup.rows.find((r) => r.studentId === kids.ana);
    expect(ana).toMatchObject({
      kind: 'makeup',
      flags: { waterFear: true, noPhotos: true, medical: false, femaleInstructor: false },
    });
    expect(
      lineup.rows
        .filter((r) => r.kind === 'member')
        .map((r) => r.firstName)
        .sort(),
    ).toEqual(['josh', 'kim']);
    const now = new Date().toISOString();
    expect(
      await as('rina', (tx) =>
        recordAttendance(tx, ctxOf('rina'), thursday.id, [
          {
            studentId: kids.ana as string,
            status: 'present',
            clientMarkId: 'dev1-0001',
            markedAt: now,
          },
          {
            studentId: kids.josh as string,
            status: 'late',
            minutesLate: 15,
            clientMarkId: 'dev1-0002',
            markedAt: now,
          },
        ]),
      ),
    ).toEqual({ applied: 2, ignored: 0 });
    expect(
      (await q(`select status from makeup_bookings where student_id = $1`, [kids.ana]))[0].status,
    ).toBe('attended');
    // 15 minutes late is past attendance.late_threshold_min (10): counted as absent.
    expect(
      (
        await q(`select status, minutes_late from attendance where student_id = $1`, [kids.josh])
      )[0],
    ).toEqual({ status: 'absent', minutes_late: 15 });
    const { report } = await owner((tx) => closureReport(tx, eventId));
    expect(report.total).toMatchObject({ issued: 6, used: 1, booked: 0, outstanding: 5 });
  });

  it('closing the event expires the credits nobody used, and the report shows it', async () => {
    // Ben books and then cancels: his credit is open again before the close.
    const [benCredit] = await q(
      `select id from makeup_credits where closure_event_id = $1 and student_id = $2`,
      [eventId, kids.ben],
    );
    const { offers } = await as('parent1', (tx) => makeupOffers(tx, benCredit.id));
    const bookingId = await as('parent1', (tx) =>
      bookMakeup(tx, ctxOf('parent1'), {
        creditId: benCredit.id,
        sessionId: offers[0]?.sessionId as string,
      }),
    );
    await as('parent1', (tx) => cancelMakeupBooking(tx, ctxOf('parent1'), bookingId));
    expect(
      (await q(`select status from makeup_credits where id = $1`, [benCredit.id]))[0].status,
    ).toBe('open');

    expect(await owner((tx) => closeClosureEvent(tx, ctx, eventId))).toEqual({
      expired: 5,
      converted: 0,
    });
    const { report, event, sessionsCancelled } = await owner((tx) => closureReport(tx, eventId));
    expect(event.status).toBe('closed');
    expect(sessionsCancelled).toBe(3);
    expect(report.total).toMatchObject({ issued: 6, used: 1, expired: 5, outstanding: 0 });
  });

  it('an event with convert_to_credit converts open credits for Phase 4', async () => {
    const day = nextSession('thu', plusDays(closure.to, 7));
    const id = await owner((tx) =>
      createClosureEvent(tx, ctx, {
        venueId: v2,
        startsOn: day.date,
        endsOn: day.date,
        source: 'school',
        reason: 'השתלמות צוות (דמו)',
        makeupFrom: '',
        makeupDeadline: plusDays(day.date, 20),
        endRule: 'convert_to_credit',
      }),
    );
    await owner((tx) => openClosureEvent(tx, ctx, id));
    expect(
      (await q(`select distinct status from sessions where closure_event_id = $1`, [id]))[0].status,
    ).toBe('cancelled_by_school');
    expect(await owner((tx) => closeClosureEvent(tx, ctx, id))).toEqual({
      expired: 0,
      converted: 2,
    });
    expect((await events('attendance.closure_credits_converted'))[0]).toMatchObject({
      closureEventId: id,
      endRule: 'convert_to_credit',
    });
  });
});

describe('attendance offline sync', () => {
  it('applies a replayed mark once and keeps the latest tap by device time', async () => {
    const lesson = nextSession('mon', plusDays(closure.to, 14));
    const mark = (status: 'present' | 'absent', id: string, at: string) =>
      as('rina', (tx) =>
        recordAttendance(tx, ctxOf('rina'), lesson.id, [
          { studentId: kids.hila as string, status, clientMarkId: id, markedAt: at },
        ]),
      );
    expect(await mark('present', 'dev2-0001', '2026-10-01T10:00:00Z')).toEqual({
      applied: 1,
      ignored: 0,
    });
    expect(await mark('present', 'dev2-0001', '2026-10-01T10:00:00Z')).toEqual({
      applied: 0,
      ignored: 1,
    });
    expect(await mark('absent', 'dev3-0001', '2026-10-01T09:00:00Z')).toEqual({
      applied: 0,
      ignored: 1,
    });
    expect(await mark('absent', 'dev3-0002', '2026-10-01T11:00:00Z')).toEqual({
      applied: 1,
      ignored: 0,
    });
    expect(
      (await q(`select status from attendance where session_id = $1`, [lesson.id]))[0].status,
    ).toBe('absent');
    expect(
      await codeOf(
        as('rina', (tx) =>
          recordAttendance(tx, ctxOf('rina'), lesson.id, [
            {
              studentId: kids.josh as string,
              status: 'present',
              clientMarkId: 'dev2-0009',
              markedAt: '2026-10-01T10:00:00Z',
            },
          ]),
        ),
      ),
    ).toBe('attendance.errors.notInSession');
  });

  it('only the session’s instructor marks it; parents read their own children’s marks', async () => {
    const lesson = nextSession('mon', plusDays(closure.to, 14));
    expect(
      await as('parent2', (tx) => tx.execute(sql`select student_id from attendance`)).then(
        (r) => r.rows,
      ),
    ).toEqual([]);
    await expect(
      as('parent2', (tx) =>
        recordAttendance(tx, ctxOf('parent2'), lesson.id, [
          {
            studentId: kids.gil as string,
            status: 'present',
            clientMarkId: 'p-000001',
            markedAt: '2026-10-01T12:00:00Z',
          },
        ]),
      ),
    ).rejects.toThrow();
  });

  it('ticks progress for a child the instructor teaches', async () => {
    const [level] = await q(
      `insert into levels (organization_id, program_id, code, name_he, ordinal, skills)
       select $1, id, 'l1', 'צב', 1, '[{"code":"s1","he":"ציפה"}]' from programs limit 1 returning id`,
      [ctx.orgId],
    );
    await q(`update students set level_id = $1 where id = $2`, [level.id, kids.hila]);
    const lesson = nextSession('mon', plusDays(closure.to, 14));
    await as('rina', (tx) =>
      setProgress(tx, ctxOf('rina'), {
        studentId: kids.hila as string,
        levelId: level.id,
        skillCode: 's1',
        sessionId: lesson.id,
        achieved: true,
      }),
    );
    const lineup = await as('rina', (tx) => sessionLineup(tx, lesson.id));
    expect(lineup.rows.find((r) => r.studentId === kids.hila)?.skills).toEqual([
      { code: 's1', he: 'ציפה', achieved: true },
    ]);
    expect((await q(`select staff_member_id from progress_marks`))[0].staff_member_id).toBe(
      rinaStaff,
    );
  });
});

describe('trials and forms', () => {
  it('books a one-day trial seat, takes the verdict and converts after the forms are accepted', async () => {
    await owner(async (tx) => {
      for (const kind of ['regulations', 'health_declaration'] as const) {
        const id = await createFormVersion(tx, ctx, {
          kind,
          title: kind === 'regulations' ? 'תקנון (דמו)' : 'הצהרת בריאות (דמו)',
          body: 'נוסח לדוגמה בלבד.',
          questions: kind === 'health_declaration' ? 'האם יש מגבלה רפואית?' : '',
          effectiveFrom: '2026-01-01',
        });
        await publishFormVersion(tx, ctx, id);
      }
    });
    const lesson = nextSession('tue', plusDays(closure.to, 7));
    const trialId = await owner((tx) =>
      bookTrial(tx, ctx, { studentId: kids.kim as string, sessionId: lesson.id }),
    );
    const [seat] = await q(
      `select status, starts_on::text as s, ends_on::text as e from enrollments where student_id = $1 and class_template_id = $2`,
      [kids.kim, groups.tue],
    );
    expect(seat).toEqual({ status: 'trial_booked', s: lesson.date, e: plusDays(lesson.date, 1) });
    // The instructor gives the verdict; the seat is done.
    await as('rina', (tx) =>
      recordTrialVerdict(tx, ctxOf('rina'), trialId, {
        attended: true,
        outcome: 'fit',
        recommendedLevelId: '',
        recommendedTemplateId: groups.tue,
        note: 'שוחה יפה',
      }),
    );
    const [trial] = await q(
      `select status, outcome, offer_valid_until::text as o, verdict_by from trials where id = $1`,
      [trialId],
    );
    expect(trial).toEqual({
      status: 'attended',
      outcome: 'fit',
      o: plusDays(lesson.date, 14),
      verdict_by: users.rina,
    });
    // An instructor cannot touch anything else on the trial.
    expect(
      await dbError(
        as('rina', (tx) => tx.execute(sql`update trials set fee_agorot = 0 where id = ${trialId}`)),
      ),
    ).toMatch(/verdictOnly/);
    expect(
      await codeOf(
        owner((tx) =>
          convertTrial(tx, ctx, trialId, {
            templateId: groups.tue,
            startsOn: plusDays(lesson.date, 7),
          }),
        ),
      ),
    ).toBe('enrollment.errors.formsMissing');
    const { due, current } = await owner((tx) => formsDueFor(tx, households.h3));
    // Regulations once for the household, a health declaration per child (7 children in h3).
    expect(due.filter((d) => d.kind === 'regulations')).toHaveLength(1);
    expect(due.filter((d) => d.kind === 'health_declaration')).toHaveLength(7);
    const regs = current.find((f) => f.kind === 'regulations');
    const health = current.find((f) => f.kind === 'health_declaration');
    await owner(async (tx) => {
      await submitForm(tx, ctx, {
        formTemplateId: regs?.id as string,
        householdId: households.h3,
        channel: 'owner_recorded',
      });
      await submitForm(tx, ctx, {
        formTemplateId: health?.id as string,
        householdId: households.h3,
        studentId: kids.kim as string,
        answers: { q1: false },
        channel: 'paper',
      });
    });
    const converted = await owner((tx) =>
      convertTrial(tx, ctx, trialId, {
        templateId: groups.tue,
        startsOn: plusDays(lesson.date, 7),
      }),
    );
    // No trial price list exists in this test org, so no fee and no offset.
    expect(converted.offset).toEqual({
      offsetAgorot: 0,
      explanation: { code: 'enrollment.decision.noFee', params: {} },
    });
    expect((await events('enrollment.trial_converted'))[0]).toMatchObject({
      trialId,
      offsetAgorot: 0,
    });
    // Submissions are history.
    await expect(q(`delete from form_submissions`)).rejects.toThrow(/append-only/);
    await expect(
      q(`update form_templates set title = 'x' where published_at is not null`),
    ).rejects.toThrow(/versionLocked/);
  });

  it('a parent accepts their own household’s forms only', async () => {
    const { current } = await as('parent1', (tx) => formsDueFor(tx, households.h1));
    const regs = current.find((f) => f.kind === 'regulations');
    await as('parent1', (tx) =>
      submitForm(tx, ctxOf('parent1'), {
        formTemplateId: regs?.id as string,
        householdId: households.h1,
      }),
    );
    const { due } = await as('parent1', (tx) => formsDueFor(tx, households.h1));
    expect(due.map((d) => d.kind)).toEqual(['health_declaration', 'health_declaration']);
    expect(
      await codeOf(
        as('parent1', (tx) =>
          submitForm(tx, ctxOf('parent1'), {
            formTemplateId: regs?.id as string,
            householdId: households.h2,
          }),
        ),
      ),
    ).toBe('common.errors.notFound');
  });
});

describe('daily jobs', () => {
  it('expires open credits past their last day', async () => {
    await q(
      `insert into makeup_credits (organization_id, student_id, program_id, reason, issued_on, expires_on)
       select $1, $2, program_id, 'goodwill', current_date - 40, current_date - 10 from class_templates limit 1`,
      [ctx.orgId, kids.ido],
    );
    expect(await system((tx) => expireDueCredits(tx, { orgId: ctx.orgId, userId: null }))).toBe(1);
    expect(await system((tx) => expireDueCredits(tx, { orgId: ctx.orgId, userId: null }))).toBe(0);
  });
});
