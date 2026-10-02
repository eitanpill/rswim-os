import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import {
  addDays,
  attendanceRulesFrom,
  attendanceStatusForArrival,
  canBookMakeup,
  canEarnMakeup,
  classifyAbsenceNotice,
  closureEndActions,
  closureTreatment,
  endOfMonth,
  freeSeats,
  levelDistance,
  makeupCandidates,
  makeupExpiry,
  monthOf,
  uptakeReport,
  type MakeupCredit,
  type MakeupFit,
  type MakeupStudent,
  type MarketSession,
} from '../src/policies';

const rules = attendanceRulesFrom(DEFAULT_ORG_RULES);
const hoursBefore = (h: number, m = 0) => {
  const startsAt = new Date('2026-10-14T14:00:00Z'); // 17:00 in Israel
  return { startsAt, receivedAt: new Date(startsAt.getTime() - (h * 60 + m) * 60_000) };
};

describe('rules with defaults', () => {
  it('reads R-SWIM’s regulations', () => {
    expect(rules).toMatchObject({
      noticeMinHours: 12,
      timelyEarnsMakeup: true,
      makeupsEnabled: true,
      maxPerMonth: 1,
      expiry: 'end_of_source_month',
      lateThresholdMin: 10,
      capBypass: true,
      levelTolerance: 1,
    });
  });
  it('falls back to the documented defaults when nothing is set', () => {
    expect(attendanceRulesFrom({})).toEqual(rules);
  });
});

describe('dates', () => {
  it('finds the end of a month, also across years and in February', () => {
    expect(endOfMonth('2026-10-14')).toBe('2026-10-31');
    expect(endOfMonth('2026-12-02', 1)).toBe('2027-01-31');
    expect(endOfMonth('2028-01-31', 1)).toBe('2028-02-29');
    expect(endOfMonth('2026-11-30')).toBe('2026-11-30');
  });
  it('names the month and adds days', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('classifyAbsenceNotice (Phase 3 acceptance 1)', () => {
  it('13 hours before is timely, 11 hours before is a late notice', () => {
    const timely = classifyAbsenceNotice(hoursBefore(13), rules);
    expect(timely).toEqual({
      classification: 'timely',
      minutesBefore: 780,
      explanation: {
        code: 'attendance.decision.timely',
        params: { hours: 13, minutes: 0, min: 12 },
      },
    });
    const late = classifyAbsenceNotice(hoursBefore(11), rules);
    expect(late.classification).toBe('late_notice');
    expect(late.explanation.code).toBe('attendance.decision.lateNotice');
  });
  it('is timely at exactly the threshold and late one minute after it', () => {
    expect(classifyAbsenceNotice(hoursBefore(12), rules).classification).toBe('timely');
    expect(classifyAbsenceNotice(hoursBefore(11, 59), rules).classification).toBe('late_notice');
  });
  it('applies the 24-hour rule of private lessons', () => {
    expect(classifyAbsenceNotice(hoursBefore(23), { noticeMinHours: 24 }).classification).toBe(
      'late_notice',
    );
    expect(classifyAbsenceNotice(hoursBefore(24), { noticeMinHours: 24 }).classification).toBe(
      'timely',
    );
  });
  it('treats a notice after the lesson started as late, and says so', () => {
    const d = classifyAbsenceNotice(hoursBefore(-1, -5), rules);
    expect(d).toMatchObject({
      classification: 'late_notice',
      minutesBefore: -65,
      explanation: { code: 'attendance.decision.afterStart', params: { hours: 1, minutes: 5 } },
    });
  });
  it('measures instants, so the clock change does not move the boundary', () => {
    // Israel leaves summer time on 2026-10-25 at 02:00; a 12h notice before a 09:00 lesson that day is still 12h.
    const startsAt = new Date('2026-10-25T07:00:00Z');
    const receivedAt = new Date('2026-10-24T19:00:00Z');
    expect(classifyAbsenceNotice({ startsAt, receivedAt }, rules).classification).toBe('timely');
  });
});

describe('canEarnMakeup', () => {
  it('a timely notice under the cap earns a credit', () => {
    expect(canEarnMakeup({ classification: 'timely', creditsThisMonth: 0 }, rules)).toEqual({
      earns: true,
      explanation: { code: 'attendance.decision.creditIssued', params: {} },
    });
  });
  it('a late notice earns nothing', () => {
    expect(
      canEarnMakeup({ classification: 'late_notice', creditsThisMonth: 0 }, rules).explanation.code,
    ).toBe('attendance.decision.lateNoMakeup');
  });
  it('stops at the monthly cap', () => {
    expect(canEarnMakeup({ classification: 'timely', creditsThisMonth: 1 }, rules)).toEqual({
      earns: false,
      explanation: { code: 'attendance.decision.monthlyCap', params: { max: 1 } },
    });
  });
  it('summer courses with makeups off earn nothing, and so do regulations without timely makeups', () => {
    expect(
      canEarnMakeup(
        { classification: 'timely', creditsThisMonth: 0 },
        { ...rules, makeupsEnabled: false },
      ).explanation.code,
    ).toBe('attendance.decision.makeupsOff');
    expect(
      canEarnMakeup(
        { classification: 'timely', creditsThisMonth: 0 },
        { ...rules, timelyEarnsMakeup: false },
      ).explanation.code,
    ).toBe('attendance.decision.timelyNoMakeup');
  });
});

describe('makeupExpiry', () => {
  it('ends with the source month, the next month, or the event deadline', () => {
    expect(makeupExpiry('2026-10-14', 'end_of_source_month')).toBe('2026-10-31');
    expect(makeupExpiry('2026-10-14', 'end_of_next_month')).toBe('2026-11-30');
    expect(makeupExpiry('2026-10-14', 'event_deadline', '2026-11-15')).toBe('2026-11-15');
    expect(makeupExpiry('2026-10-14', 'event_deadline')).toBe('2026-10-31');
  });
});

describe('attendanceStatusForArrival', () => {
  it('present on time, late up to the threshold, absent after it', () => {
    expect(attendanceStatusForArrival(null, rules).status).toBe('present');
    expect(attendanceStatusForArrival(0, rules).status).toBe('present');
    expect(attendanceStatusForArrival(10, rules)).toEqual({
      status: 'late',
      explanation: { code: 'attendance.decision.late', params: { minutes: 10, max: 10 } },
    });
    expect(attendanceStatusForArrival(11, rules).explanation.code).toBe(
      'attendance.decision.tooLate',
    );
  });
});

describe('closureTreatment', () => {
  it('guarantees a makeup when the school cancels', () => {
    for (const source of ['school', 'holiday'] as const) {
      expect(closureTreatment(source, rules)).toMatchObject({
        sessionStatus: 'cancelled_by_school',
        creditReason: 'school_cancellation',
        guarantee: 'guaranteed',
        issuesCredits: true,
        countsTowardCap: false,
        endRule: 'expire',
      });
    }
  });
  it('offers a best-effort makeup for external closures, and none when the regulations say none', () => {
    expect(closureTreatment('water_quality', rules)).toMatchObject({
      sessionStatus: 'cancelled_external',
      creditReason: 'external_closure',
      guarantee: 'best_effort',
      issuesCredits: true,
      explanation: { code: 'attendance.decision.closureExternal' },
    });
    const none = closureTreatment('venue', { ...rules, externalMakeup: 'none', capBypass: false });
    expect(none).toMatchObject({ issuesCredits: false, countsTowardCap: true });
  });
});

describe('freeSeats', () => {
  it('frees the seats of notified absences and takes the guests’, never below zero', () => {
    expect(freeSeats({ capacity: 6, seatHolders: 6, notifiedAbsent: 2, makeupGuests: 1 })).toBe(1);
    expect(freeSeats({ capacity: 6, seatHolders: 7, notifiedAbsent: 0, makeupGuests: 0 })).toBe(0);
  });
});

const student: MakeupStudent = {
  id: 's1',
  firstName: 'נועה',
  gender: 'female',
  ageMonths: 100,
  isAdult: false,
  levelOrdinal: 3,
  requiresFemaleInstructor: false,
  ownTemplateIds: ['own'],
};
const credit: MakeupCredit = {
  id: 'c1',
  programId: 'kids',
  status: 'open',
  expiresOn: '2026-10-31',
  windowFrom: null,
};
const session = (over: Partial<MarketSession> = {}): MarketSession => ({
  sessionId: 'x',
  date: '2026-10-20',
  classTemplateId: 'other',
  programId: 'kids',
  admittedGender: 'mixed',
  ageMinMonths: 72,
  ageMaxMonths: 120,
  levelMinOrdinal: 3,
  levelMaxOrdinal: 4,
  windowRestriction: 'mixed',
  leadGender: 'female',
  freeSeats: 1,
  ...over,
});
const codes = (fit: MakeupFit) => ({
  hard: fit.hard.map((e) => e.code.replace('attendance.decision.', '')),
  soft: fit.soft.map((e) => e.code.replace('attendance.decision.', '')),
});
const fit = (s: Partial<MarketSession>, st: Partial<MakeupStudent> = {}, c = credit) =>
  codes(makeupCandidates({ ...student, ...st }, c, [session(s)], rules, '2026-10-15')[0]!);

describe('makeupCandidates', () => {
  it('a compatible group with a free seat is a clean fit', () => {
    expect(fit({})).toEqual({ hard: [], soft: [] });
  });
  it('never offers a full session, the child’s own group, another program or a date outside the credit', () => {
    expect(fit({ freeSeats: 0 }).hard).toEqual(['noSeat']);
    expect(fit({ classTemplateId: 'own' }).hard).toEqual(['ownGroup']);
    expect(fit({ programId: 'babies' }).hard).toEqual(['otherProgram']);
    expect(fit({ date: '2026-11-01' }).hard).toEqual(['afterExpiry']);
    expect(fit({ date: '2026-10-14' }).hard).toEqual(['beforeWindow']);
  });
  it('spends closure credits inside the event window', () => {
    const c = { ...credit, windowFrom: '2026-10-25' };
    expect(fit({ date: '2026-10-20' }, {}, c).hard).toEqual(['beforeWindow']);
    expect(fit({ date: '2026-10-26' }, {}, c).hard).toEqual([]);
    expect(fit({ date: '2026-10-16' }, {}, { ...credit, windowFrom: '2026-10-01' }).hard).toEqual(
      [],
    );
  });
  it('keeps the pool window’s and the group’s gender rules', () => {
    expect(fit({ windowRestriction: 'boys' }).hard).toEqual(['windowGender']);
    expect(fit({ windowRestriction: 'girls' }).hard).toEqual([]);
    expect(fit({ windowRestriction: null }).hard).toEqual([]);
    expect(fit({ windowRestriction: 'girls' }, { gender: null }).soft).toEqual(['genderUnknown']);
    expect(fit({ admittedGender: 'male' }).hard).toEqual(['groupGender']);
    expect(fit({ admittedGender: 'female' }).hard).toEqual([]);
  });
  it('flags age and level gaps as soft, within the level tolerance', () => {
    expect(fit({ ageMinMonths: 110 }).soft).toEqual(['tooYoung']);
    expect(fit({ ageMaxMonths: 90 }).soft).toEqual(['tooOld']);
    expect(fit({ ageMinMonths: null, ageMaxMonths: null }).soft).toEqual([]);
    expect(fit({}, { ageMonths: null }).soft).toEqual([]);
    expect(fit({ levelMinOrdinal: 4, levelMaxOrdinal: 5 }).soft).toEqual([]);
    expect(fit({ levelMinOrdinal: 5, levelMaxOrdinal: 6 }).soft).toEqual(['levelApart']);
    expect(fit({ levelMinOrdinal: 1, levelMaxOrdinal: 1 }).soft).toEqual(['levelApart']);
  });
  it('keeps a female instructor for families who require one', () => {
    expect(fit({ leadGender: 'male' }, { requiresFemaleInstructor: true }).hard).toEqual([
      'femaleInstructorRequired',
    ]);
    expect(fit({ leadGender: null }, { requiresFemaleInstructor: true }).hard).toEqual([]);
  });
});

describe('levelDistance', () => {
  it('is zero inside the range or when anything is unknown', () => {
    expect(levelDistance(null, 1, 2)).toBe(0);
    expect(levelDistance(3, null, null)).toBe(0);
    expect(levelDistance(1, 3, null)).toBe(2);
    expect(levelDistance(5, null, 3)).toBe(2);
  });
});

describe('canBookMakeup', () => {
  const clean: MakeupFit = { sessionId: 'x', hard: [], soft: [] };
  const soft: MakeupFit = {
    sessionId: 'x',
    hard: [],
    soft: [{ code: 'attendance.decision.tooOld', params: {} }],
  };
  const book = (
    over: Partial<Parameters<typeof canBookMakeup>[0]> = {},
    r: Partial<typeof rules> = {},
  ) =>
    canBookMakeup(
      {
        actor: 'family',
        credit: { status: 'open' },
        fit: clean,
        hasActiveEnrollment: true,
        overrideNote: null,
        ...over,
      },
      { ...rules, ...r },
    );
  const vcodes = (d: ReturnType<typeof canBookMakeup>) =>
    d.violations.map((v) => v.code.replace('attendance.decision.', ''));

  it('lets a family book a clean fit with an open credit', () => {
    expect(book()).toEqual({ ok: true, violations: [], overridden: [] });
  });
  it('refuses a used credit, a hard rule, and family booking when self booking is off', () => {
    expect(vcodes(book({ credit: { status: 'booked' } }))).toEqual(['creditNotOpen']);
    expect(
      vcodes(
        book({
          fit: {
            sessionId: 'x',
            hard: [{ code: 'attendance.decision.noSeat', params: {} }],
            soft: [],
          },
        }),
      ),
    ).toEqual(['noSeat']);
    expect(vcodes(book({}, { selfBooking: false }))).toEqual(['selfBookingOff']);
    expect(book({ actor: 'office' }, { selfBooking: false }).ok).toBe(true);
  });
  it('never lets a family past a soft rule; the office needs an override note', () => {
    expect(vcodes(book({ fit: soft }))).toEqual(['tooOld']);
    expect(vcodes(book({ fit: soft, actor: 'office' }))).toEqual(['tooOld', 'overrideNeeded']);
    expect(book({ fit: soft, actor: 'office', overrideNote: 'אישרה רעות' })).toMatchObject({
      ok: true,
      overridden: [{ code: 'attendance.decision.tooOld' }],
    });
    expect(book({ fit: soft, overrideNote: 'x' }).ok).toBe(false);
  });
  it('requires an active enrollment when the regulations do, as a soft rule', () => {
    expect(vcodes(book({ hasActiveEnrollment: false }))).toEqual(['noActiveEnrollment']);
    expect(book({ hasActiveEnrollment: false }, { requiresActiveSubscription: false }).ok).toBe(
      true,
    );
  });
  it('with soft enforcement, soft rules never block', () => {
    expect(book({ fit: soft }, { enforcement: 'soft' })).toMatchObject({
      ok: true,
      overridden: [{ code: 'attendance.decision.tooOld' }],
    });
  });
});

describe('uptakeReport', () => {
  it('counts issued credits per group by where they are now', () => {
    const r = uptakeReport([
      { id: '1', groupId: 'b', groupName: 'בנות', status: 'open', bookingStatus: null },
      { id: '2', groupId: 'b', groupName: 'בנות', status: 'booked', bookingStatus: 'booked' },
      { id: '3', groupId: 'b', groupName: 'בנות', status: 'used', bookingStatus: 'attended' },
      { id: '4', groupId: 'a', groupName: 'אלפא', status: 'used', bookingStatus: 'missed' },
      { id: '5', groupId: 'a', groupName: 'אלפא', status: 'expired', bookingStatus: null },
      { id: '6', groupId: 'a', groupName: 'אלפא', status: 'converted', bookingStatus: null },
      { id: '7', groupId: 'a', groupName: 'אלפא', status: 'void', bookingStatus: null },
    ]);
    expect(r.rows.map((x) => x.groupName)).toEqual(['אלפא', 'בנות']);
    expect(r.rows[0]).toMatchObject({ issued: 3, missed: 1, expired: 1, converted: 1 });
    expect(r.rows[1]).toMatchObject({ issued: 3, outstanding: 1, booked: 1, used: 1 });
    expect(r.total).toMatchObject({
      issued: 6,
      outstanding: 1,
      booked: 1,
      used: 1,
      missed: 1,
      expired: 1,
      converted: 1,
    });
  });
});

describe('closureEndActions', () => {
  const credits = [
    { id: 'a', status: 'open' as const },
    { id: 'b', status: 'booked' as const },
    { id: 'c', status: 'used' as const },
  ];
  it('expires or converts the open credits and leaves booked ones', () => {
    expect(closureEndActions(credits, 'expire')).toEqual({ expire: ['a'], convert: [] });
    expect(closureEndActions(credits, 'convert_to_credit')).toEqual({ expire: [], convert: ['a'] });
    expect(closureEndActions(credits, 'partial_refund')).toEqual({ expire: [], convert: ['a'] });
  });
});
