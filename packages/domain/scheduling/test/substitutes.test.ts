/**
 * Phase 6 acceptance criterion 2 at the service level, against a real database with RLS: substitute offers go out in
 * waves and lock on first accept. Two instructors accepting at the same moment leave exactly one assignment; the
 * others' offers are withdrawn; the worker puts the substitute on the lesson and emits `scheduling.staff_changed`
 * (what tells the parents). Plus the next wave, an unfilled request, and the staffing-gap forecast. All people are fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  advanceSubstituteWaves,
  answerSubstituteOffer,
  applySubstitute,
  cancelSubstituteRequest,
  listSubstituteRequests,
  myOffers,
  requestSubstitute,
  staffingGapsFor,
  upcomingLessons,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let lessonDate = '';
const lessons = { main: '', second: '', third: '', clash: '', orphan: '' };
const staff: Record<string, string> = {};
const users: Record<string, string> = {};

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: string, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who] as string, org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const sys = (): ServiceContext => ({ orgId: ctx.orgId, userId: null });
const codeOf = async (p: Promise<unknown>) => {
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
    `insert into organizations (slug, name) values ('subs', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2025-01-01', $2)`,
    [
      ctx.orgId,
      JSON.stringify({
        ...DEFAULT_ORG_RULES,
        staffing: {
          ...DEFAULT_ORG_RULES.staffing,
          substitute_wave_size: 2,
          substitute_wave_minutes: 30,
        },
      }),
    ],
  );
  const [d] = await q(
    `select (app.today() + 3)::text as d, extract(dow from app.today() + 3)::int as w`,
  );
  lessonDate = d.d;
  const weekday = d.w as number;

  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'אפרת (דמו)') returning id`,
    [ctx.orgId],
  );
  const [v2] = await q(
    `insert into venues (organization_id, name) values ($1, 'הר חומה (דמו)') returning id`,
    [ctx.orgId],
  );
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  const [pool2] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v2.id],
  );
  const [p] = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'kids', 'group_kids', 'קבוצת ילדים', 45, 6) returning id`,
    [ctx.orgId],
  );

  // The lead (רעות) cancels. Candidates: ליה and מאיה and נועה and אסף are certified and available; נועה taught the
  // group before; אסף is at this venue that day; דני has no certificate; טל is busy at the same time; גל is away.
  const people: [string, string, string, boolean][] = [
    ['reut', 'רעות', 'female', true],
    ['lia', 'ליה', 'female', true],
    ['maya', 'מאיה', 'female', true],
    ['noa', 'נועה', 'female', true],
    ['asaf', 'אסף', 'male', true],
    ['dani', 'דני', 'male', false],
    ['tal', 'טל', 'female', true],
    ['gal', 'גל', 'female', true],
  ];
  for (const [key, name, gender, certified] of people) {
    const [s] = await q(
      `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
       values ($1, $2, 'דמו', $3, 'employee') returning id`,
      [ctx.orgId, name, gender],
    );
    staff[key] = s.id;
    if (certified) {
      await q(
        `insert into certifications (organization_id, staff_member_id, type, issuer) values ($1, $2, 'swim_instructor', 'וינגייט (דמו)')`,
        [ctx.orgId, s.id],
      );
    }
    await q(
      `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, effective_from)
       values ($1, $2, $3, '14:00', '21:00', '2025-01-01')`,
      [ctx.orgId, s.id, weekday],
    );
    const [su] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = su.id;
    await q(
      `insert into memberships (organization_id, user_id, role, staff_member_id) values ($1, $2, 'instructor', $3)`,
      [ctx.orgId, su.id, s.id],
    );
  }
  await q(
    `insert into availability_exceptions (organization_id, staff_member_id, kind, starts_on, ends_on)
     values ($1, $2, 'unavailable', $3, $3)`,
    [ctx.orgId, staff.gal, lessonDate],
  );

  const template = async (name: string, venue: string, poolId: string, starts: string) => {
    const [tpl] = await q(
      `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                    duration_min, capacity, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7, 45, 6, '2025-01-01') returning id`,
      [ctx.orgId, name, p.id, venue, poolId, weekday, starts],
    );
    return tpl.id as string;
  };
  const session = async (
    tpl: string,
    venue: string,
    date: string,
    from: string,
    to: string,
    lead: string | null,
  ) => {
    const [s] = await q(
      `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at)
       values ($1, $2, $3, $4::date, ($4::date + $5::time) at time zone 'Asia/Jerusalem',
               ($4::date + $6::time) at time zone 'Asia/Jerusalem') returning id`,
      [ctx.orgId, tpl, venue, date, from, to],
    );
    if (lead) {
      await q(
        `insert into session_staff (organization_id, session_id, staff_member_id, role) values ($1, $2, $3, 'lead')`,
        [ctx.orgId, s.id, lead],
      );
    }
    return s.id as string;
  };
  const dolphins = await template('דולפינים', v.id, pool.id, '16:00');
  const sharks = await template('כרישים', v.id, pool.id, '17:00');
  const evening = await template('כרישים ערב', v.id, pool.id, '19:00');
  const seals = await template('כלבי ים', v.id, pool.id, '18:00');
  const other = await template('צבים', v2.id, pool2.id, '16:00');
  const turtles = await template('צבים צעירים', v2.id, pool2.id, '17:00');
  lessons.main = await session(dolphins, v.id, lessonDate, '16:00', '16:45', staff.reut as string);
  lessons.second = await session(sharks, v.id, lessonDate, '17:00', '17:45', staff.reut as string);
  lessons.third = await session(evening, v.id, lessonDate, '19:00', '19:45', staff.reut as string);
  // נועה taught the dolphins last week; אסף teaches at Efrat at 18:00 that day; טל teaches elsewhere at 16:00.
  await session(
    dolphins,
    v.id,
    (await q(`select ($1::date - 7)::text as d`, [lessonDate]))[0].d,
    '16:00',
    '16:45',
    staff.noa as string,
  );
  await session(seals, v.id, lessonDate, '18:00', '18:45', staff.asaf as string);
  lessons.clash = await session(other, v2.id, lessonDate, '16:00', '16:45', staff.tal as string);
  lessons.orphan = await session(turtles, v2.id, lessonDate, '17:00', '17:45', null);
}, 60_000);

afterAll(async () => {
  await t?.drop();
});

describe('AC2: substitute offers go out in waves and lock on first accept', () => {
  let requestId = '';

  it('offers the first wave to the best-placed qualified instructors', async () => {
    const r = await owner((tx) =>
      requestSubstitute(tx, ctx, { sessionId: lessons.main, reason: 'מחלה' }),
    );
    requestId = r.id;
    expect(r).toMatchObject({ status: 'open', offered: 2 });
    // נועה knows the group, אסף is at the venue that day, then the rest by name; wave size 2.
    expect(r.ranked.map((x) => [x.staffId, x.wave])).toEqual([
      [staff.noa, 1],
      [staff.asaf, 1],
      [staff.lia, 2],
      [staff.maya, 2],
    ]);
    const [list] = await owner((tx) => listSubstituteRequests(tx));
    expect(list?.lesson).toMatchObject({ groupName: 'דולפינים', startsAt: '16:00' });
    expect(list?.offers.map((o) => [o.name, o.status])).toEqual([
      ['נועה דמו', 'offered'],
      ['אסף דמו', 'offered'],
      ['ליה דמו', 'queued'],
      ['מאיה דמו', 'queued'],
    ]);
    // One open request per lesson.
    expect(
      await codeOf(owner((tx) => requestSubstitute(tx, ctx, { sessionId: lessons.main }))),
    ).toBe('scheduling.substitute.alreadyOpen');
  });

  it('a later wave does not see its offer yet', async () => {
    expect(await as('lia', (tx) => myOffers(tx, staff.lia as string))).toEqual([]);
    const [mine] = await as('noa', (tx) => myOffers(tx, staff.noa as string));
    expect(mine).toMatchObject({
      status: 'offered',
      lesson: { groupName: 'דולפינים', venueName: 'אפרת (דמו)' },
    });
  });

  it('two accepting at once: exactly one gets it, the other offers are withdrawn', async () => {
    const offers = await q(
      `select id, staff_member_id from substitute_offers where request_id = $1 and status = 'offered'`,
      [requestId],
    );
    const offerOf = (s: string) => offers.find((o) => o.staff_member_id === s)?.id as string;
    const results = await Promise.allSettled([
      as('noa', (tx) =>
        answerSubstituteOffer(tx, ctx, staff.noa as string, {
          offerId: offerOf(staff.noa as string),
          accept: true,
        }),
      ),
      as('asaf', (tx) =>
        answerSubstituteOffer(tx, ctx, staff.asaf as string, {
          offerId: offerOf(staff.asaf as string),
          accept: true,
        }),
      ),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(['staffing.errors.substituteTaken', 'scheduling.substitute.offerClosed']).toContain(
      toDomainError(lost[0]?.reason)?.code,
    );
    const rows = await q(
      `select staff_member_id, status from substitute_offers where request_id = $1 order by rank`,
      [requestId],
    );
    expect(rows.filter((r) => r.status === 'accepted')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'withdrawn')).toHaveLength(3);
    const [req] = await q(`select status, filled_by from substitute_requests where id = $1`, [
      requestId,
    ]);
    expect(req.status).toBe('filled');
    expect(req.filled_by).toBe(rows.find((r) => r.status === 'accepted')?.staff_member_id);
  });

  it('the worker puts the substitute on the lesson and tells the parents, once', async () => {
    const [req] = await q(`select filled_by from substitute_requests where id = $1`, [requestId]);
    expect(await system((tx) => applySubstitute(tx, sys(), requestId))).toBe(true);
    expect(await system((tx) => applySubstitute(tx, sys(), requestId))).toBe(false);
    const [lead] = await q(
      `select staff_member_id from session_staff where session_id = $1 and role = 'lead'`,
      [lessons.main],
    );
    expect(lead.staff_member_id).toBe(req.filled_by);
    const events = await q(
      `select payload from outbox where event_type = 'scheduling.staff_changed'`,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      kind: 'substitute',
      sessionIds: [lessons.main],
      fromStaffId: staff.reut,
      toStaffId: req.filled_by,
    });
  });

  it("nobody answers a closed offer or someone else's", async () => {
    const [open] = await q(
      `select id from substitute_offers where request_id = $1 and status = 'withdrawn' limit 1`,
      [requestId],
    );
    expect(
      await codeOf(
        as('lia', (tx) =>
          answerSubstituteOffer(tx, ctx, staff.lia as string, { offerId: open.id, accept: true }),
        ),
      ),
    ).toBe('scheduling.substitute.offerClosed');
  });
});

describe('waves', () => {
  it('opens the next wave when nobody answers, then gives up', async () => {
    const r = await owner((tx) => requestSubstitute(tx, ctx, { sessionId: lessons.second }));
    expect(r.offered).toBe(2);
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await system((tx) => advanceSubstituteWaves(tx, sys(), later))).toEqual({
      advanced: 1,
      unfilled: 0,
    });
    // Five qualified (טל is free at 17:00 too): waves of two, two and one.
    const statuses = await q(
      `select wave, status from substitute_offers where request_id = $1 order by rank`,
      [r.id],
    );
    expect(statuses.map((s) => [s.wave, s.status])).toEqual([
      [1, 'offered'],
      [1, 'offered'],
      [2, 'offered'],
      [2, 'offered'],
      [3, 'queued'],
    ]);
    // The first wave can still answer; one declines. Nothing is due again until the new wave times out.
    const [first] = await q(
      `select id, staff_member_id from substitute_offers where request_id = $1 and wave = 1 limit 1`,
      [r.id],
    );
    const who = Object.keys(staff).find((k) => staff[k] === first.staff_member_id) as string;
    expect(
      await as(who, (tx) =>
        answerSubstituteOffer(tx, ctx, first.staff_member_id, { offerId: first.id, accept: false }),
      ),
    ).toBe('declined');
    expect(await system((tx) => advanceSubstituteWaves(tx, sys(), later))).toEqual({
      advanced: 0,
      unfilled: 0,
    });
    const step = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    expect(await system((tx) => advanceSubstituteWaves(tx, sys(), step(62)))).toEqual({
      advanced: 1,
      unfilled: 0,
    });
    expect(await system((tx) => advanceSubstituteWaves(tx, sys(), step(93)))).toEqual({
      advanced: 0,
      unfilled: 1,
    });
    const [req] = await q(`select status, next_wave_at from substitute_requests where id = $1`, [
      r.id,
    ]);
    expect(req).toEqual({ status: 'unfilled', next_wave_at: null });
    const [ev] = await q(
      `select payload from outbox where event_type = 'staffing.substitute_unfilled'`,
    );
    expect(ev.payload).toMatchObject({ requestId: r.id });
  });

  it('the office cancels a request; a past or missing lesson cannot be requested', async () => {
    const r = await owner((tx) => requestSubstitute(tx, ctx, { sessionId: lessons.third }));
    await owner((tx) => cancelSubstituteRequest(tx, r.id));
    expect(await codeOf(owner((tx) => cancelSubstituteRequest(tx, r.id)))).toBe(
      'scheduling.substitute.notOpen',
    );
    const offers = await q(`select distinct status from substitute_offers where request_id = $1`, [
      r.id,
    ]);
    expect(offers).toEqual([{ status: 'withdrawn' }]);
    const [past] = await q(
      `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at)
       select organization_id, class_template_id, venue_id, app.today() - 1, starts_at - interval '4 days', ends_at - interval '4 days'
       from sessions where id = $1 returning id`,
      [lessons.third],
    );
    expect(await codeOf(owner((tx) => requestSubstitute(tx, ctx, { sessionId: past.id })))).toBe(
      'scheduling.substitute.notUpcoming',
    );
    expect(
      await codeOf(
        owner((tx) =>
          requestSubstitute(tx, ctx, { sessionId: '00000000-0000-4000-8000-000000000000' }),
        ),
      ),
    ).toBe('common.errors.notFound');
  });

  it('with nobody qualified the request opens as unfilled', async () => {
    // Everyone free is busy at 16:00 at Har Homa? No: only the orphan lesson's slot is open; make everyone unavailable.
    await q(`update certifications set expires_on = '2020-01-01' where organization_id = $1`, [
      ctx.orgId,
    ]);
    const r = await owner((tx) => requestSubstitute(tx, ctx, { sessionId: lessons.clash }));
    expect(r).toMatchObject({ status: 'unfilled', offered: 0 });
    await q(`update certifications set expires_on = null where organization_id = $1`, [ctx.orgId]);
  });
});

describe('staffing gaps and lessons', () => {
  it('finds the lesson with no instructor', async () => {
    const gaps = await owner((tx) => staffingGapsFor(tx, { from: lessonDate, to: lessonDate }));
    expect(gaps).toEqual([
      expect.objectContaining({
        venueName: 'הר חומה (דמו)',
        from: '17:00',
        to: '17:45',
        groups: ['צבים צעירים'],
      }),
    ]);
    const upcoming = await owner((tx) =>
      upcomingLessons(tx, { from: lessonDate, to: lessonDate, staffId: staff.reut }),
    );
    expect(upcoming.map((l) => l.starts)).toEqual(['17:00', '19:00']);
    expect(upcoming[0]?.openRequest).toBe(false);
  });
});
