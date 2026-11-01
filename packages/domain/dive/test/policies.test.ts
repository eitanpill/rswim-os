import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVE_RULES as R, resolveDiveRules } from '@rswim/contracts';
import {
  addMonths,
  allowedDepth,
  bookingConfirmation,
  bookingDecision,
  clubInsights,
  daysBetween,
  expiryState,
  formState,
  formsToSign,
  insuranceReadiness,
  passBalance,
  planLines,
  ratioCheck,
  readiness,
  seaCall,
  welcomeSteps,
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

describe('insurance', () => {
  const P = R.paperwork;
  it('is not asked when the club turns it off', () => {
    expect(insuranceReadiness(null, '2026-10-10', { ...P, insurance: 'off' })).toBeNull();
  });
  it('is fine, warns when running out, and blocks only when required', () => {
    expect(insuranceReadiness('2027-01-01', '2026-10-10', P)).toEqual({
      key: 'insurance',
      state: 'ok',
    });
    expect(insuranceReadiness('2026-10-20', '2026-10-10', P)).toEqual({
      key: 'insurance',
      state: 'warn',
      params: { days: 10 },
    });
    expect(insuranceReadiness(null, '2026-10-10', P)).toEqual({
      key: 'insurance',
      state: 'warn',
      params: { days: 'none' },
    });
    expect(insuranceReadiness('2026-01-01', '2026-10-10', { ...P, insurance: 'require' })).toEqual({
      key: 'insurance',
      state: 'missing',
    });
  });
  it('joins readiness when the caller checks it', () => {
    const facts = {
      waiverSignedOn: '2026-03-01',
      medicalExpiresOn: '2027-03-01',
      certLevel: 2,
      paid: true,
    };
    const on = { onDate: '2026-10-10', minLevel: 0 };
    expect(readiness(facts, on, P).items).toHaveLength(4);
    const req = { ...P, insurance: 'require' as const };
    const r = readiness({ ...facts, insuranceExpiresOn: null }, on, req);
    expect(r.items[4]).toEqual({ key: 'insurance', state: 'missing' });
    expect(r.ready).toBe(false);
    expect(
      readiness({ ...facts, insuranceExpiresOn: null }, on, { ...P, insurance: 'off' }).items,
    ).toHaveLength(4);
  });
});

describe('forms', () => {
  const P = R.paperwork;
  const today = '2026-10-10';
  it('says where each form stands', () => {
    expect(formState('waiver', null, today, P)).toEqual({
      state: 'missing',
      until: null,
      days: null,
    });
    expect(formState('health', { validUntil: null, review: 'pending' }, today, P).state).toBe(
      'pending',
    );
    expect(
      formState('health', { validUntil: '2027-01-01', review: 'refused' }, today, P).state,
    ).toBe('refused');
    expect(formState('health', { validUntil: '2026-10-30', review: 'cleared' }, today, P)).toEqual({
      state: 'warn',
      until: '2026-10-30',
      days: 20,
    });
    expect(formState('waiver', { validUntil: '2026-10-30', review: 'none' }, today, P).state).toBe(
      'ok',
    );
    expect(formState('insurance', { validUntil: '2026-10-01', review: 'none' }, today, P)).toEqual({
      state: 'expired',
      until: '2026-10-01',
      days: -9,
    });
    expect(formState('insurance', { validUntil: null, review: 'none' }, today, P).days).toBeNull();
  });
  it('lists what the diver still has to sign', () => {
    const states = { health: 'pending', waiver: 'expired', insurance: 'missing' } as const;
    expect(formsToSign(states, P)).toEqual(['waiver', 'insurance']);
    expect(formsToSign(states, { ...P, insurance: 'off' })).toEqual(['waiver']);
    expect(formsToSign({ health: 'warn', waiver: 'ok', insurance: 'refused' }, P)).toEqual([
      'health',
      'insurance',
    ]);
  });
});

describe('welcomeSteps', () => {
  const P = R.paperwork;
  const fresh = {
    hasEmergencyContact: true,
    cert: 'none',
    beginner: false,
    forms: { health: 'missing', waiver: 'missing', insurance: 'missing' },
    bookings: 0,
  } as const;
  const states = (f: Parameters<typeof welcomeSteps>[0], p = P) =>
    welcomeSteps(f, p).steps.map((s) => `${s.key}:${s.state}`);

  it('starts a new diver at their card, with insurance optional while the club only tracks it', () => {
    expect(states(fresh)).toEqual([
      'details:done',
      'cert:todo',
      'health:todo',
      'waiver:todo',
      'insurance:optional',
      'book:todo',
    ]);
    expect(welcomeSteps(fresh, P)).toMatchObject({ next: 'cert', done: 2 });
    expect(welcomeSteps({ ...fresh, hasEmergencyContact: false }, P).next).toBe('details');
  });

  it('a beginner skips the card; waiting steps are on the club; a required insurance is a step', () => {
    const f = {
      ...fresh,
      beginner: true,
      cert: 'rejected',
      forms: { health: 'pending', waiver: 'ok', insurance: 'missing' },
    } as const;
    expect(states(f, { ...P, insurance: 'require' })).toEqual([
      'details:done',
      'cert:optional',
      'health:waiting',
      'waiver:done',
      'insurance:todo',
      'book:todo',
    ]);
    expect(states({ ...f, cert: 'pending' }, { ...P, insurance: 'off' })).toEqual([
      'details:done',
      'cert:waiting',
      'health:waiting',
      'waiver:done',
      'book:todo',
    ]);
  });

  it('is finished once everything is in and a first dive is booked', () => {
    const r = welcomeSteps(
      {
        ...fresh,
        cert: 'verified',
        forms: { health: 'warn', waiver: 'ok', insurance: 'ok' },
        bookings: 1,
      },
      { ...P, insurance: 'require' },
    );
    expect(r).toMatchObject({ next: null, done: 6 });
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

describe('bookingConfirmation', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const base = {
    price: 18000,
    coveredByPass: false,
    paidNow: false,
    online: true,
    startsAt: new Date('2026-10-10T05:00:00Z'),
    endsAt: new Date('2026-10-10T07:00:00Z'),
  };
  it('confirms a pass, a free session, money taken now, or a club that lets divers pay later', () => {
    expect(bookingConfirmation({ ...base, coveredByPass: true }, now, R.booking).status).toBe(
      'booked',
    );
    expect(bookingConfirmation({ ...base, price: 0 }, now, R.booking).reason.code).toBe('free');
    expect(bookingConfirmation({ ...base, paidNow: true }, now, R.booking).reason.code).toBe(
      'paid',
    );
    expect(
      bookingConfirmation(base, now, { ...R.booking, require_payment: false }).reason.code,
    ).toBe('payLater');
    // The desk may confirm and collect at the club; online, that choice is not the diver's.
    expect(
      bookingConfirmation({ ...base, online: false, collectAtClub: true }, now, R.booking).reason
        .code,
    ).toBe('collectAtClub');
    expect(bookingConfirmation({ ...base, collectAtClub: true }, now, R.booking).status).toBe(
      'pending_payment',
    );
  });
  it('holds an online booking for the payment window, never past the start', () => {
    const held = bookingConfirmation(base, now, R.booking);
    expect(held.status).toBe('pending_payment');
    expect(held.holdUntil?.toISOString()).toBe('2026-10-09T10:30:00.000Z');
    const soon = bookingConfirmation(
      { ...base, startsAt: new Date('2026-10-09T10:10:00Z') },
      now,
      R.booking,
    );
    expect(soon.holdUntil?.toISOString()).toBe('2026-10-09T10:10:00.000Z');
  });
  it('holds a desk booking paid on arrival until the session ends', () => {
    const desk = bookingConfirmation({ ...base, online: false }, now, R.booking);
    expect(desk).toEqual({
      status: 'pending_payment',
      holdUntil: base.endsAt,
      reason: { code: 'payOnArrival' },
    });
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
    paymentsPending: { count: 0, amount: 0 },
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
      paymentsPending: { count: 2, amount: 36000 },
      formsPending: 2,
      certsPending: 3,
      insuranceExpiring: 7,
    });
    expect(out.map((i) => `${i.kind}:${i.severity}`)).toEqual([
      'weather:urgent',
      'course_fill:urgent',
      'staff_cert:urgent',
      'weather:attention',
      'course_fill:attention',
      'medicals:attention',
      'forms_pending:attention',
      'certs_pending:attention',
      'staff_cert:attention',
      'rentals_overdue:attention',
      'payments_pending:attention',
      'leads:attention',
      'insurance:info',
      'gear_service:info',
      'graduates:info',
      'safety_streak:info',
    ]);
  });
});
