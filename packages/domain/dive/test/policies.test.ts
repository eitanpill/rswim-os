import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVE_RULES as R, resolveDiveRules } from '@rswim/contracts';
import {
  addMonths,
  allowedDepth,
  bookingDecision,
  clubInsights,
  daysBetween,
  expiryState,
  passBalance,
  planLines,
  ratioCheck,
  readiness,
  seaCall,
  type ClubFacts,
} from '../src/policies';

describe('dates', () => {
  it('counts days and adds months', () => {
    expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(daysBetween('2026-10-12', '2026-10-09')).toBe(-3);
    expect(addMonths('2026-01-31', 12)).toBe('2027-01-31');
  });
  it('classifies an expiry', () => {
    expect(expiryState(null, '2026-10-09', 30)).toBe('missing');
    expect(expiryState('2026-10-08', '2026-10-09', 30)).toBe('expired');
    expect(expiryState('2026-10-20', '2026-10-09', 30)).toBe('warn');
    expect(expiryState('2027-10-20', '2026-10-09', 30)).toBe('ok');
  });
});

describe('seaCall', () => {
  const calm = { windKts: 6, waveCm: 20, visibilityM: 25, current: 'none' as const };
  it('goes on a calm morning', () => {
    expect(seaCall(calm, R.sea)).toEqual({ call: 'go', reasons: [] });
  });
  it('cautions on moderate wind, waves, poor visibility', () => {
    const r = seaCall({ windKts: 16, waveCm: 80, visibilityM: 5, current: 'light' }, R.sea);
    expect(r.call).toBe('caution');
    expect(r.reasons.map((x) => x.code)).toEqual(['wind', 'waves', 'visibility']);
  });
  it('calls it off on strong north wind, big waves or strong current', () => {
    const r = seaCall({ windKts: 24, waveCm: 150, visibilityM: 20, current: 'strong' }, R.sea);
    expect(r.call).toBe('no_go');
    expect(r.reasons.map((x) => x.code)).toEqual(['wind', 'waves', 'current']);
  });
  it('treats strong current as caution when the club allows it', () => {
    const rules = resolveDiveRules({ sea: { strong_current_no_go: false } }).sea;
    expect(seaCall({ ...calm, current: 'strong' }, rules).call).toBe('caution');
  });
});

describe('allowedDepth', () => {
  it('lets the level ceiling decide for a new diver', () => {
    expect(allowedDepth({ certLevel: 2, pbCwtM: null, depthLimitM: null }, R.depth)).toEqual({
      maxM: 20,
      limitedBy: 'level',
    });
  });
  it('keeps the level ceiling when the best is already deeper', () => {
    expect(allowedDepth({ certLevel: 2, pbCwtM: 30, depthLimitM: null }, R.depth).limitedBy).toBe(
      'level',
    );
  });
  it('adds one progression step to the personal best', () => {
    expect(allowedDepth({ certLevel: 3, pbCwtM: 22, depthLimitM: null }, R.depth)).toEqual({
      maxM: 25,
      limitedBy: 'progression',
    });
  });
  it('respects an instructor limit and the site, and clamps odd levels', () => {
    expect(allowedDepth({ certLevel: 4, pbCwtM: 35, depthLimitM: 30 }, R.depth)).toEqual({
      maxM: 30,
      limitedBy: 'instructor',
    });
    expect(allowedDepth({ certLevel: 9, pbCwtM: 60, depthLimitM: null }, R.depth, 18)).toEqual({
      maxM: 18,
      limitedBy: 'site',
    });
    expect(
      allowedDepth(
        { certLevel: 1, pbCwtM: null, depthLimitM: null },
        { ...R.depth, level_max_m: [] },
      ),
    ).toEqual({ maxM: 0, limitedBy: 'level' });
  });
});

describe('readiness', () => {
  const session = { onDate: '2026-10-10', minLevel: 2 };
  it('is ready with everything in order', () => {
    const r = readiness(
      { waiverSignedOn: '2026-03-01', medicalExpiresOn: '2027-03-01', certLevel: 2, paid: true },
      session,
      R.paperwork,
    );
    expect(r.ready).toBe(true);
    expect(r.items.map((i) => i.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });
  it('warns on a medical about to run out but still lets them dive', () => {
    const r = readiness(
      { waiverSignedOn: '2026-10-01', medicalExpiresOn: '2026-10-20', certLevel: 3, paid: true },
      session,
      R.paperwork,
    );
    expect(r.ready).toBe(true);
    expect(r.items[1]).toEqual({ key: 'medical', state: 'warn', params: { days: 10 } });
  });
  it('blocks without a waiver, with an expired medical, a low level or no payment', () => {
    const r = readiness(
      { waiverSignedOn: null, medicalExpiresOn: '2026-01-01', certLevel: 1, paid: false },
      session,
      R.paperwork,
    );
    expect(r.ready).toBe(false);
    expect(r.items.map((i) => i.state)).toEqual(['missing', 'missing', 'missing', 'missing']);
    const old = readiness(
      { waiverSignedOn: '2024-01-01', medicalExpiresOn: null, certLevel: 2, paid: true },
      session,
      R.paperwork,
    );
    expect(old.items[0]?.state).toBe('missing');
  });
});

describe('bookingDecision', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const base = {
    capacity: 6,
    booked: 3,
    status: 'scheduled',
    startsAt: new Date('2026-10-10T05:00:00Z'),
    minLevel: 0,
    diverLevel: 2,
    alreadyBooked: false,
  };
  it('books an open future session', () => {
    expect(bookingDecision(base, now)).toEqual({ ok: true });
  });
  it.each([
    [{ status: 'cancelled' }, 'sessionCancelled'],
    [{ startsAt: new Date('2026-10-09T09:00:00Z') }, 'sessionPast'],
    [{ alreadyBooked: true }, 'alreadyBooked'],
    [{ minLevel: 3 }, 'levelTooLow'],
    [{ booked: 6 }, 'sessionFull'],
  ])('refuses %o with %s', (change, code) => {
    expect(bookingDecision({ ...base, ...change }, now)).toEqual({ ok: false, code });
  });
});

describe('ratioCheck', () => {
  it('needs one instructor per four course divers', () => {
    expect(ratioCheck('course', 6, 1, R.ratio)).toEqual({ needed: 2, ok: false, perInstructor: 4 });
    expect(ratioCheck('training', 6, 1, R.ratio).ok).toBe(true);
    expect(ratioCheck('trip', 0, 0, R.ratio)).toEqual({ needed: 0, ok: true, perInstructor: 8 });
  });
});

describe('passBalance', () => {
  it('counts sessions and days left', () => {
    expect(
      passBalance({ sessionsTotal: 10, used: 6, validUntil: '2026-12-31' }, '2026-10-09'),
    ).toEqual({ remaining: 4, daysLeft: 83, usable: true });
    expect(
      passBalance({ sessionsTotal: 10, used: 12, validUntil: '2026-12-31' }, '2026-10-09'),
    ).toMatchObject({ remaining: 0, usable: false });
    expect(
      passBalance({ sessionsTotal: null, used: 30, validUntil: '2026-10-08' }, '2026-10-09'),
    ).toEqual({ remaining: null, daysLeft: -1, usable: false });
  });
});

describe('planLines', () => {
  it('puts the deepest divers on line A and pairs buddies', () => {
    const plan = planLines(
      [
        { id: 'a', targetM: 12 },
        { id: 'b', targetM: 30 },
        { id: 'c', targetM: 28 },
        { id: 'd', targetM: 15 },
        { id: 'e', targetM: 15 },
      ],
      2,
    );
    expect(plan).toEqual([
      {
        line: 'A',
        divers: [
          { id: 'b', targetM: 30, buddyId: 'c' },
          { id: 'c', targetM: 28, buddyId: 'b' },
        ],
      },
      {
        line: 'B',
        divers: [
          { id: 'd', targetM: 15, buddyId: 'e' },
          { id: 'e', targetM: 15, buddyId: 'd' },
        ],
      },
      { line: 'C', divers: [{ id: 'a', targetM: 12, buddyId: null }] },
    ]);
    expect(planLines([], 3)).toEqual([]);
  });
});

describe('clubInsights', () => {
  const quiet: ClubFacts = {
    today: '2026-10-09',
    forecast: [],
    courses: [],
    medicalsExpiring: 0,
    staffCertsExpiring: [],
    gearServiceDue: 0,
    rentalsOverdue: 0,
    leadsWaiting: 0,
    daysSinceIncident: null,
    graduatesIdle: 0,
  };
  it('says nothing on a quiet day', () => {
    expect(clubInsights(quiet)).toEqual([]);
    expect(clubInsights({ ...quiet, daysSinceIncident: 5 })).toEqual([]);
  });
  it('ranks a no-go morning with divers booked first', () => {
    const out = clubInsights({
      ...quiet,
      forecast: [
        { date: '2026-10-10', call: 'go', windKts: 8, seaBookings: 12 },
        { date: '2026-10-11', call: 'caution', windKts: 16, seaBookings: 0 },
        { date: '2026-10-12', call: 'caution', windKts: 16, seaBookings: 4 },
        { date: '2026-10-13', call: 'no_go', windKts: 24, seaBookings: 9 },
      ],
      courses: [
        { title: 'Wave 1', date: '2026-10-14', booked: 1, capacity: 4 },
        { title: 'Wave 2', date: '2026-10-25', booked: 1, capacity: 4 },
        { title: 'AIDA 2', date: '2026-12-25', booked: 0, capacity: 4 },
        { title: 'Wave 3', date: '2026-10-12', booked: 4, capacity: 4 },
      ],
      medicalsExpiring: 3,
      staffCertsExpiring: [
        { name: 'נטע', title: 'עזרה ראשונה', days: 12 },
        { name: 'רון', title: 'ביטוח', days: -2 },
      ],
      gearServiceDue: 4,
      rentalsOverdue: 1,
      leadsWaiting: 5,
      daysSinceIncident: 23,
      graduatesIdle: 6,
    });
    expect(out.map((i) => `${i.kind}:${i.severity}`)).toEqual([
      'weather:urgent',
      'course_fill:urgent',
      'staff_cert:urgent',
      'weather:attention',
      'course_fill:attention',
      'medicals:attention',
      'staff_cert:attention',
      'rentals_overdue:attention',
      'leads:attention',
      'gear_service:info',
      'graduates:info',
      'safety_streak:info',
    ]);
  });
});
