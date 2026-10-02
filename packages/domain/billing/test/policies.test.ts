import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { agorot } from '@rswim/money';
import {
  addDays,
  agingBuckets,
  allocate,
  annualEarlyTermination,
  applySiblingDiscount,
  balanceOf,
  billingRulesFrom,
  cancellationEffectiveMonth,
  chargeForSeat,
  chargeForSlots,
  daysBetween,
  detectAnomalies,
  dmy,
  dunningNextStep,
  israelDate,
  lessonValue,
  periodEnd,
  periodOf,
  prorate,
  receiptDocuments,
  shiftPeriod,
  statementTotal,
  type HouseholdReview,
  type LedgerFact,
  type ReceiptInput,
  type SeatChargeInput,
} from '../src/policies';

const rules = billingRulesFrom(DEFAULT_ORG_RULES);
const code = (c: string) => `billing.decision.${c}`;

/** Weekly lessons on Tuesdays of October 2026: 6, 13, 20, 27. */
const OCT_TUESDAYS = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
const seat = (over: Partial<SeatChargeInput> = {}): SeatChargeInput => ({
  period: '2026-10',
  price: agorot(33_000),
  sessionDates: OCT_TUESDAYS,
  startsOn: '2026-09-01',
  endsOn: null,
  freezes: [],
  cancellation: null,
  ...over,
});

describe('rules with defaults', () => {
  it('reads R-SWIM’s regulations', () => {
    expect(rules).toMatchObject({
      methodRequired: 'standing_order',
      runDay: 1,
      cancellationCutoffDay: 25,
      proration: 'per_remaining_sessions',
      prorationMinSessions: 1,
      freezeCharge: 'none_while_frozen',
      freezeRequiresApproval: true,
      closureCredit: 'none',
      annualEarlyTermination: 'pay_difference_to_monthly',
      anomalyChangeBp: 3000,
      noticeMinHours: 12,
      sibling: { kind: 'percent', percentBp: 1000, flatAgorot: 3000, appliesTo: 'cheapest_first' },
      dunning: {
        firstRetryDays: 1,
        retryIntervalDays: 3,
        maxRetries: 3,
        escalateAfterDays: 10,
        pauseEnrollment: false,
      },
    });
  });

  it('falls back to the documented defaults on an empty policy', () => {
    expect(billingRulesFrom({})).toEqual(rules);
  });
});

describe('periods and dates', () => {
  it('moves between months and counts days', () => {
    expect(periodOf('2026-10-14')).toBe('2026-10');
    expect(periodEnd('2026-02')).toBe('2026-02-28');
    expect(periodEnd('2028-02')).toBe('2028-02-29');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(dmy('2026-09-03')).toBe('3.9.2026');
  });

  it('reads the date in Israel, not UTC', () => {
    expect(israelDate(new Date('2026-09-25T21:30:00Z'))).toBe('2026-09-26');
    expect(israelDate(new Date('2026-09-25T20:30:00Z'))).toBe('2026-09-25');
  });
});

describe('cancellation cut-off', () => {
  it('a request on the 25th makes this month the last; on the 26th the next one is charged too', () => {
    const on25 = cancellationEffectiveMonth(new Date('2026-10-25T18:00:00Z'), rules);
    expect(on25).toEqual({
      lastChargedPeriod: '2026-10',
      endsOn: '2026-11-01',
      explanation: {
        code: code('cancelBeforeCutoff'),
        params: { cutoff: 25, requested: '25.10.2026', last: '2026-10' },
      },
    });
    const on26 = cancellationEffectiveMonth(new Date('2026-10-26T06:00:00Z'), rules);
    expect(on26.lastChargedPeriod).toBe('2026-11');
    expect(on26.endsOn).toBe('2026-12-01');
    expect(on26.explanation.code).toBe(code('cancelAfterCutoff'));
  });

  it('a cut-off past the end of a short month means its last day', () => {
    const feb = cancellationEffectiveMonth(new Date('2027-02-28T10:00:00Z'), {
      cancellationCutoffDay: 31,
    });
    expect(feb.lastChargedPeriod).toBe('2027-02');
    expect(feb.explanation.params.cutoff).toBe(28);
  });

  it('property: decided by the Israel date — 23:30 Israel time on the cut-off day is still in time', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2025-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z') }),
        fc.integer({ min: 1, max: 31 }),
        (instant, cutoffDay) => {
          if (Number.isNaN(instant.getTime())) return;
          const local = israelDate(instant);
          const d = cancellationEffectiveMonth(instant, { cancellationCutoffDay: cutoffDay });
          const day = Number(local.slice(8, 10));
          const lastDay = Number(periodEnd(periodOf(local)).slice(8, 10));
          const inTime = day <= Math.min(cutoffDay, lastDay);
          expect(d.lastChargedPeriod).toBe(
            inTime ? periodOf(local) : shiftPeriod(periodOf(local), 1),
          );
          // Never charged for fewer than the current month, and at most one more.
          expect(d.lastChargedPeriod >= periodOf(local)).toBe(true);
          expect(d.lastChargedPeriod <= shiftPeriod(periodOf(local), 1)).toBe(true);
        },
      ),
    );
  });
});

describe('proration', () => {
  const base = { price: agorot(33_000), totalSessions: 4, billableDays: 31, totalDays: 31 };

  it('charges the remaining sessions out of the month’s, rounded half-up', () => {
    expect(prorate({ ...base, billableSessions: 3, totalSessions: 4 }, rules)).toEqual({
      amount: 24_750,
      explanation: { code: code('proratedSessions'), params: { billable: 3, total: 4 } },
    });
    expect(
      prorate({ ...base, price: agorot(10_000), billableSessions: 1, totalSessions: 3 }, rules)
        .amount,
    ).toBe(3333);
    expect(
      prorate({ ...base, price: agorot(10_000), billableSessions: 2, totalSessions: 3 }, rules)
        .amount,
    ).toBe(6667);
  });

  it('full month, no sessions, none left, and below the minimum', () => {
    expect(prorate({ ...base, billableSessions: 4 }, rules).explanation.code).toBe(
      code('fullMonth'),
    );
    expect(prorate({ ...base, billableSessions: 0, totalSessions: 0 }, rules)).toMatchObject({
      amount: 0,
      explanation: { code: code('noSessions') },
    });
    expect(prorate({ ...base, billableSessions: 0 }, rules).explanation.code).toBe(
      code('noBillableSessions'),
    );
    expect(
      prorate({ ...base, billableSessions: 1 }, { ...rules, prorationMinSessions: 2 }),
    ).toMatchObject({ amount: 0, explanation: { code: code('belowMinSessions') } });
  });

  it('by days, or the full price for any lesson', () => {
    const days = { ...rules, proration: 'per_remaining_days' as const };
    expect(prorate({ ...base, billableSessions: 2, billableDays: 15 }, days)).toEqual({
      amount: ratio(33_000, 15, 31),
      explanation: { code: code('proratedDays'), params: { days: 15, total: 31 } },
    });
    expect(prorate({ ...base, billableSessions: 2, billableDays: 31 }, days).amount).toBe(33_000);
    const none = { ...rules, proration: 'none' as const };
    expect(prorate({ ...base, billableSessions: 1 }, none).amount).toBe(33_000);
  });

  it('property: never more than the price, and more sessions never cost less', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 0, max: 31 }),
        fc.integer({ min: 0, max: 31 }),
        fc.constantFrom('per_remaining_sessions', 'per_remaining_days', 'none'),
        (price, total, a, b, mode) => {
          const [lo, hi] = [Math.min(a, b, total), Math.min(Math.max(a, b), total)];
          const r = { proration: mode, prorationMinSessions: 1 } as const;
          const at = (n: number) =>
            prorate(
              {
                price: agorot(price),
                billableSessions: n,
                totalSessions: total,
                billableDays: Math.round((n / total) * 31),
                totalDays: 31,
              },
              r,
            ).amount;
          expect(at(hi)).toBeLessThanOrEqual(price);
          expect(at(lo)).toBeGreaterThanOrEqual(0);
          expect(at(lo)).toBeLessThanOrEqual(at(hi));
          expect(Number.isInteger(at(hi))).toBe(true);
        },
      ),
    );
  });
});

const ratio = (a: number, n: number, d: number) => Math.round((a * n) / d);

describe('a seat’s monthly charge', () => {
  it('a full month', () => {
    expect(chargeForSeat(seat(), rules)).toMatchObject({
      amount: 33_000,
      explanation: { code: code('fullMonth'), params: { sessions: 4 } },
      sessionDates: OCT_TUESDAYS,
      frozenSessions: 0,
      missingPrice: false,
    });
  });

  it('starting or leaving mid-month is prorated by remaining sessions', () => {
    const joined = chargeForSeat(seat({ startsOn: '2026-10-14' }), rules);
    expect(joined).toMatchObject({ amount: 16_500, sessionDates: ['2026-10-20', '2026-10-27'] });
    const left = chargeForSeat(seat({ endsOn: '2026-10-14' }), rules);
    expect(left).toMatchObject({ amount: 16_500, sessionDates: ['2026-10-06', '2026-10-13'] });
    const later = chargeForSeat(seat({ endsOn: '2027-01-01' }), rules);
    expect(later.amount).toBe(33_000);
    const notYet = chargeForSeat(seat({ startsOn: '2026-10-28' }), rules);
    expect(notYet).toMatchObject({
      amount: 0,
      explanation: { code: code('noBillableSessions') },
      sessionDates: [],
    });
  });

  it('a cancellation pays through its last month, then stops', () => {
    const lastMonth = chargeForSeat(
      seat({ endsOn: '2026-10-14', cancellation: { lastChargedPeriod: '2026-10' } }),
      rules,
    );
    expect(lastMonth.amount).toBe(33_000);
    const after = chargeForSeat(seat({ cancellation: { lastChargedPeriod: '2026-09' } }), rules);
    expect(after).toMatchObject({
      amount: 0,
      explanation: { code: code('cancelled'), params: { last: '2026-09' } },
    });
  });

  it('freezes: none while frozen, prorated when partly frozen, charged when the policy says full', () => {
    const whole = chargeForSeat(
      seat({ freezes: [{ from: '2026-10-01', to: '2026-10-31' }] }),
      rules,
    );
    expect(whole).toMatchObject({
      amount: 0,
      explanation: { code: code('frozen'), params: { sessions: 4 } },
      frozenSessions: 4,
    });
    const half = chargeForSeat(
      seat({ freezes: [{ from: '2026-10-01', to: '2026-10-15' }] }),
      rules,
    );
    expect(half).toMatchObject({
      amount: 16_500,
      explanation: { code: code('proratedSessions'), params: { billable: 2, total: 4, frozen: 2 } },
      frozenSessions: 2,
    });
    const full = chargeForSeat(seat({ freezes: [{ from: '2026-10-01', to: '2026-10-31' }] }), {
      ...rules,
      freezeCharge: 'full',
    });
    expect(full.amount).toBe(33_000);
  });

  it('a seat with lessons but no price is flagged, not silently free', () => {
    expect(chargeForSeat(seat({ price: null }), rules)).toMatchObject({
      amount: 0,
      explanation: { code: code('noPrice') },
      missingPrice: true,
    });
    // No lessons that month: nothing to price.
    expect(chargeForSeat(seat({ price: null, sessionDates: [] }), rules)).toMatchObject({
      missingPrice: false,
      explanation: { code: code('noSessions') },
    });
    // Below the minimum: not a price problem either.
    expect(
      chargeForSeat(seat({ price: null, startsOn: '2026-10-27' }), {
        ...rules,
        prorationMinSessions: 2,
      }).missingPrice,
    ).toBe(false);
  });

  it('by days counts calendar days in the seat outside freezes', () => {
    const r = { ...rules, proration: 'per_remaining_days' as const };
    expect(chargeForSeat(seat({ startsOn: '2026-10-17' }), r).amount).toBe(ratio(33_000, 15, 31));
  });

  it('property: a seat never costs more than the month’s price, nor less than nothing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        (price, start, end, fFrom, fLen) => {
          const d = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
          const c = chargeForSeat(
            seat({
              price: agorot(price),
              startsOn: d(start),
              endsOn: end > start ? d(end) : null,
              freezes: [{ from: d(fFrom), to: d(Math.min(31, fFrom + fLen)) }],
            }),
            rules,
          );
          expect(c.amount).toBeGreaterThanOrEqual(0);
          expect(c.amount).toBeLessThanOrEqual(price);
          expect(c.sessionDates.every((x) => OCT_TUESDAYS.includes(x))).toBe(true);
        },
      ),
    );
  });
});

describe('per-lesson programs', () => {
  const startsAt = new Date('2026-10-14T14:00:00Z');
  const slot = (over: Partial<Parameters<typeof chargeForSlots>[0][number]>) => ({
    id: 'b',
    date: '2026-10-14',
    startsAt,
    status: 'booked' as const,
    cancelledAt: null,
    price: agorot(16_000),
    ...over,
  });
  const r24 = { noticeMinHours: 24 };

  it('booked lessons are charged; a cancellation inside the notice is charged; one in time is free', () => {
    const lines = chargeForSlots(
      [
        slot({
          id: 'late',
          status: 'cancelled',
          cancelledAt: new Date(startsAt.getTime() - 5 * 3_600_000),
        }),
        slot({
          id: 'ok',
          status: 'cancelled',
          cancelledAt: new Date(startsAt.getTime() - 30 * 3_600_000),
        }),
        slot({ id: 'booked' }),
        slot({ id: 'nostamp', status: 'cancelled', cancelledAt: null }),
      ],
      r24,
    );
    const by = Object.fromEntries(lines.map((l) => [l.bookingId, l]));
    expect(by.booked).toMatchObject({ amount: 16_000, charged: true });
    expect(by.late).toMatchObject({
      amount: 16_000,
      explanation: { code: code('slotLateCancel'), params: { hours: 5, min: 24 } },
    });
    expect(by.ok).toMatchObject({
      amount: 0,
      charged: false,
      explanation: { code: code('slotCancelledInTime'), params: { hours: 30 } },
    });
    expect(by.nostamp?.charged).toBe(true);
  });

  it('a charged lesson with no price is flagged; lessons come out in time order', () => {
    const lines = chargeForSlots(
      [
        slot({ id: 'second', startsAt: new Date(startsAt.getTime() + 86_400_000), price: null }),
        slot({ id: 'first' }),
      ],
      r24,
    );
    expect(lines.map((l) => l.bookingId)).toEqual(['first', 'second']);
    expect(lines[1]).toMatchObject({
      amount: 0,
      missingPrice: true,
      explanation: { code: code('noPrice') },
    });
    expect(
      chargeForSlots(
        [
          slot({
            status: 'cancelled',
            cancelledAt: new Date(startsAt.getTime() - 48 * 3_600_000),
            price: null,
          }),
        ],
        r24,
      )[0]?.missingPrice,
    ).toBe(false);
  });
});

describe('sibling discount', () => {
  const kids = [
    { studentId: 'a', birthDate: '2016-01-01', amount: agorot(33_000) },
    { studentId: 'b', birthDate: '2018-01-01', amount: agorot(28_000) },
    { studentId: 'c', birthDate: '2020-01-01', amount: agorot(36_000) },
    { studentId: 'd', birthDate: null, amount: agorot(0) },
  ];

  it('cheapest_first: the most expensive child pays in full, the others get 10%', () => {
    const d = applySiblingDiscount(kids, rules.sibling);
    expect(d).toEqual([
      {
        studentId: 'a',
        discount: 3300,
        explanation: { code: code('siblingPercent'), params: { percent: 10 } },
      },
      {
        studentId: 'b',
        discount: 2800,
        explanation: { code: code('siblingPercent'), params: { percent: 10 } },
      },
    ]);
  });

  it('youngest_first: the oldest pays in full; a flat discount never exceeds the charge', () => {
    const d = applySiblingDiscount(
      [...kids, { studentId: 'e', birthDate: '2021-01-01', amount: agorot(2000) }],
      { ...rules.sibling, kind: 'flat', appliesTo: 'youngest_first' },
    );
    expect(d.map((x) => [x.studentId, x.discount])).toEqual([
      ['b', 3000],
      ['c', 3000],
      ['e', 2000],
    ]);
    expect(d[0]?.explanation).toEqual({ code: code('siblingFlat'), params: { amount: 3000 } });
    // Unknown birth dates count as the oldest.
    const unknown = applySiblingDiscount(
      [
        { studentId: 'x', birthDate: null, amount: agorot(100) },
        { studentId: 'y', birthDate: '2015-01-01', amount: agorot(100) },
      ],
      { ...rules.sibling, appliesTo: 'youngest_first' },
    );
    expect(unknown.map((x) => x.studentId)).toEqual(['y']);
    const twoUnknown = applySiblingDiscount(
      [
        { studentId: 'q', birthDate: '2015-01-01', amount: agorot(100) },
        { studentId: 'r', birthDate: null, amount: agorot(100) },
        { studentId: 's', birthDate: null, amount: agorot(100) },
      ],
      { ...rules.sibling, appliesTo: 'youngest_first' },
    );
    expect(twoUnknown.map((x) => x.studentId)).toEqual(['s', 'q']);
  });

  it('one charged child gets nothing; ties go by id', () => {
    expect(applySiblingDiscount(kids.slice(3), rules.sibling)).toEqual([]);
    const tie = applySiblingDiscount(
      [
        { studentId: 'z', birthDate: null, amount: agorot(100) },
        { studentId: 'm', birthDate: null, amount: agorot(100) },
      ],
      rules.sibling,
    );
    expect(tie.map((x) => x.studentId)).toEqual(['z']);
    const tieAge = applySiblingDiscount(
      [
        { studentId: 'z', birthDate: '2018-01-01', amount: agorot(100) },
        { studentId: 'm', birthDate: '2018-01-01', amount: agorot(100) },
      ],
      { ...rules.sibling, appliesTo: 'youngest_first' },
    );
    expect(tieAge.map((x) => x.studentId)).toEqual(['z']);
  });

  const child = fc.record({
    studentId: fc.uuid(),
    birthDate: fc.option(
      fc.integer({ min: 0, max: 5000 }).map((n) => addDays('2010-01-01', n)),
      { nil: null },
    ),
    amount: fc.integer({ min: 0, max: 200_000 }).map(agorot),
  });

  it('property: never negative, never more than the charge, and the full payer is the most expensive under cheapest_first', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(child, { minLength: 0, maxLength: 6, selector: (c) => c.studentId }),
        fc.constantFrom('percent', 'flat'),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (children, kind, bp, flat) => {
          const r = { kind, percentBp: bp, flatAgorot: flat, appliesTo: 'cheapest_first' } as const;
          const out = applySiblingDiscount(children, r);
          const charged = children.filter((c) => c.amount > 0);
          expect(out.length).toBe(Math.max(0, charged.length - 1));
          for (const d of out) {
            const c = children.find((x) => x.studentId === d.studentId);
            expect(d.discount).toBeGreaterThanOrEqual(0);
            expect(d.discount).toBeLessThanOrEqual(c?.amount ?? 0);
          }
          if (charged.length >= 2) {
            const max = Math.max(...charged.map((c) => c.amount));
            const fullPayer = charged.find((c) => !out.some((d) => d.studentId === c.studentId));
            expect(fullPayer?.amount).toBe(max);
          }
          // Shuffling the family does not change who is discounted.
          const again = applySiblingDiscount([...children].reverse(), r);
          expect(new Set(again.map((d) => d.studentId))).toEqual(
            new Set(out.map((d) => d.studentId)),
          );
        },
      ),
    );
  });
});

describe('statement total, lesson value and annual termination', () => {
  it('property: the total equals the sum of the rounded lines', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 0, max: 100_000 }),
            n: fc.integer({ min: 0, max: 5 }),
            d: fc.integer({ min: 1, max: 5 }),
          }),
          { maxLength: 12 },
        ),
        (specs) => {
          const lines = specs.map((s) => ({
            amount: prorate(
              {
                price: agorot(s.price),
                billableSessions: Math.min(s.n, s.d),
                totalSessions: s.d,
                billableDays: 0,
                totalDays: 31,
              },
              rules,
            ).amount,
          }));
          const total = statementTotal(lines);
          expect(total).toBe(lines.reduce((sum, l) => sum + l.amount, 0));
          expect(Number.isInteger(total)).toBe(true);
        },
      ),
    );
  });

  it('a lesson is worth the month’s price over its sessions', () => {
    expect(lessonValue(agorot(33_000), 4)).toBe(8250);
    expect(lessonValue(agorot(33_000), 0)).toBe(0);
  });

  it('annual: pay the difference to monthly, never below zero; or no refund', () => {
    const paid = { paid: agorot(300_000), monthsUsed: 4, monthlyPrice: agorot(33_000) };
    expect(annualEarlyTermination(paid, rules)).toEqual({
      amount: 168_000,
      explanation: { code: code('annualDifference'), params: { months: 4 } },
    });
    expect(annualEarlyTermination({ ...paid, monthsUsed: 10 }, rules).amount).toBe(0);
    expect(
      annualEarlyTermination(paid, { annualEarlyTermination: 'no_refund' }).explanation.code,
    ).toBe(code('annualNoRefund'));
  });
});

describe('pre-run review', () => {
  const h = (over: Partial<HouseholdReview> = {}): HouseholdReview => ({
    householdId: 'h',
    seats: [{ enrollmentId: 'e1', studentId: 's1' }],
    lines: [
      { kind: 'seat', enrollmentId: 'e1', studentId: 's1', amount: 33_000, missingPrice: false },
    ],
    mandateIds: ['m1'],
    previousTotal: 33_000,
    ...over,
  });
  const kinds = (x: HouseholdReview, r = rules) =>
    detectAnomalies(x, r).map((a) => a.explanation.code);

  it('a clean household has nothing to flag', () => {
    expect(detectAnomalies(h(), rules)).toEqual([]);
  });

  it('(a) a mandate for a family with no seat, and a seat charge without the seat', () => {
    expect(detectAnomalies(h({ seats: [], lines: [], previousTotal: null }), rules)).toEqual([
      {
        kind: 'charge_without_enrollment',
        householdId: 'h',
        studentId: null,
        enrollmentId: null,
        explanation: { code: code('mandateWithoutSeat'), params: { count: 1 } },
      },
    ]);
    // Paying for privates is a reason to keep the mandate.
    expect(
      kinds(
        h({
          seats: [],
          lines: [
            {
              kind: 'slots',
              enrollmentId: null,
              studentId: 's1',
              amount: 16_000,
              missingPrice: false,
            },
          ],
          previousTotal: 16_000,
        }),
      ),
    ).toEqual([]);
    expect(
      kinds(
        h({
          lines: [
            {
              kind: 'seat',
              enrollmentId: 'e1',
              studentId: 's1',
              amount: 33_000,
              missingPrice: false,
            },
            {
              kind: 'seat',
              enrollmentId: 'gone',
              studentId: 's2',
              amount: 33_000,
              missingPrice: false,
            },
            { kind: 'seat', enrollmentId: null, studentId: 's2', amount: 100, missingPrice: false },
          ],
          previousTotal: null,
        }),
      ),
    ).toEqual([code('chargeWithoutSeat'), code('chargeWithoutSeat')]);
  });

  it('(b) a seat with no price, or with no line at all', () => {
    const a = detectAnomalies(
      h({
        seats: [
          { enrollmentId: 'e1', studentId: 's1' },
          { enrollmentId: 'e2', studentId: 's2' },
        ],
        lines: [
          { kind: 'seat', enrollmentId: 'e1', studentId: 's1', amount: 0, missingPrice: true },
        ],
        previousTotal: null,
      }),
      rules,
    );
    expect(a.map((x) => [x.kind, x.explanation.code, x.enrollmentId])).toEqual([
      ['enrollment_without_charge', code('noPrice'), 'e1'],
      ['enrollment_without_charge', code('seatWithoutLine'), 'e2'],
    ]);
  });

  it('(c) two mandates for one family', () => {
    expect(detectAnomalies(h({ mandateIds: ['m1', 'm2'] }), rules)[0]).toMatchObject({
      kind: 'duplicate_mandate',
      explanation: { params: { count: 2 } },
    });
  });

  it('a family that owes but has no mandate, unless any method is fine', () => {
    expect(kinds(h({ mandateIds: [] }))).toEqual([code('noMandate')]);
    expect(kinds(h({ mandateIds: [] }), { ...rules, methodRequired: 'any' })).toEqual([]);
  });

  it('a total that moved more than the threshold, up or down', () => {
    expect(detectAnomalies(h({ previousTotal: 20_000 }), rules)[0]).toMatchObject({
      kind: 'amount_changed',
      explanation: { code: code('amountUp'), params: { from: 20_000, to: 33_000, percent: 65 } },
    });
    expect(kinds(h({ previousTotal: 60_000 }))).toEqual([code('amountDown')]);
    // 30% exactly is not "more than" 30%.
    expect(kinds(h({ previousTotal: 33_000 * (10 / 13) }))).toEqual([]);
    expect(kinds(h({ previousTotal: 0 }))).toEqual([]);
  });
});

describe('dunning', () => {
  const d = rules.dunning;
  const c = { openedOn: '2026-10-02', status: 'open' as const, retriesDone: 0, hasMandate: true };

  it('waits for the first retry, retries, then resends the link when there is no mandate', () => {
    expect(dunningNextStep(c, '2026-10-02', d)).toEqual({
      action: 'wait',
      nextOn: '2026-10-03',
      pauseEnrollment: false,
      explanation: { code: code('dunningWait'), params: { on: '3.10.2026' } },
    });
    expect(dunningNextStep(c, '2026-10-03', d)).toMatchObject({
      action: 'retry',
      explanation: { code: code('dunningRetry'), params: { attempt: 1, max: 3 } },
    });
    expect(dunningNextStep({ ...c, retriesDone: 1 }, '2026-10-05', d).nextOn).toBe('2026-10-06');
    expect(
      dunningNextStep({ ...c, retriesDone: 1, hasMandate: false }, '2026-10-06', d),
    ).toMatchObject({
      action: 'remind',
      explanation: { code: code('dunningRemind') },
    });
  });

  it('escalates to the owner after the days set, with the pause when the policy asks', () => {
    expect(dunningNextStep({ ...c, retriesDone: 3 }, '2026-10-12', d)).toMatchObject({
      action: 'escalate',
      pauseEnrollment: false,
      explanation: { params: { days: 10 } },
    });
    expect(dunningNextStep(c, '2026-10-20', { ...d, pauseEnrollment: true }).pauseEnrollment).toBe(
      true,
    );
    // Retries exhausted: the next thing is the escalation.
    expect(dunningNextStep({ ...c, retriesDone: 3 }, '2026-10-08', d).nextOn).toBe('2026-10-12');
  });

  it('an escalated case keeps retrying, then waits for the owner', () => {
    const esc = { ...c, status: 'escalated' as const };
    expect(dunningNextStep({ ...esc, retriesDone: 2 }, '2026-10-20', d).action).toBe('retry');
    expect(dunningNextStep({ ...esc, retriesDone: 3 }, '2026-10-20', d)).toMatchObject({
      action: 'wait',
      nextOn: null,
      explanation: { code: code('dunningOwner') },
    });
  });

  it('property: retries never exceed the maximum, and every open case escalates on time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 90 }),
        (first, interval, max, escalate) => {
          const r = {
            ...d,
            firstRetryDays: first,
            retryIntervalDays: interval,
            maxRetries: max,
            escalateAfterDays: escalate,
          };
          let state = { ...c };
          let escalatedOn: string | null = null;
          for (let day = 0; day <= 400; day++) {
            const today = addDays(c.openedOn, day);
            const step = dunningNextStep(state, today, r);
            if (step.action === 'retry') state = { ...state, retriesDone: state.retriesDone + 1 };
            if (step.action === 'escalate') {
              escalatedOn = today;
              state = { ...state, status: 'escalated' as never };
            }
          }
          expect(state.retriesDone).toBeLessThanOrEqual(max);
          expect(escalatedOn).toBe(addDays(c.openedOn, escalate));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('ledger', () => {
  let n = 0;
  const e = (
    type: LedgerFact['type'],
    amount: number,
    occurredOn: string,
    over: Partial<LedgerFact> = {},
  ): LedgerFact => ({
    id: `x${++n}`,
    type,
    amount,
    occurredOn,
    lineId: null,
    reversesEntryId: null,
    ...over,
  });

  it('pays the oldest charges first and nets a line’s discount into its charge', () => {
    const sep = e('charge', 33_000, '2026-09-01', { lineId: 'L1' });
    const disc = e('discount', -3300, '2026-09-01', { lineId: 'L1' });
    const oct = e('charge', 33_000, '2026-10-01');
    const pay = e('payment', -40_000, '2026-10-02');
    const a = allocate([oct, pay, disc, sep]);
    expect(a.byPayment[pay.id]).toEqual([
      { key: 'L1', amount: 29_700 },
      { key: oct.id, amount: 10_300 },
    ]);
    expect(a.outstanding).toEqual([{ key: oct.id, occurredOn: '2026-10-01', amount: 22_700 }]);
    expect(a.unallocated).toBe(0);
    expect(balanceOf([sep, disc, oct, pay])).toBe(22_700);
  });

  it('money paid ahead waits for the next charge; credits are not receipts', () => {
    const credit = e('credit', -5000, '2026-09-20');
    const pay = e('payment', -40_000, '2026-09-25');
    const oct = e('charge', 33_000, '2026-10-01');
    const nov = e('charge', 33_000, '2026-11-01');
    const a = allocate([credit, pay, oct, nov]);
    expect(a.byPayment).toEqual({
      [pay.id]: [
        { key: oct.id, amount: 28_000 },
        { key: nov.id, amount: 12_000 },
      ],
    });
    expect(a.outstanding).toEqual([{ key: nov.id, occurredOn: '2026-11-01', amount: 21_000 }]);
    const ahead = allocate([pay]);
    expect(ahead.unallocated).toBe(40_000);
    expect(ahead.outstanding).toEqual([]);
  });

  it('a reversal drops out with the entry it reverses; a zero line is no item', () => {
    const c = e('charge', 33_000, '2026-10-01');
    const r = e('adjustment', -33_000, '2026-10-03', { reversesEntryId: c.id });
    const zero1 = e('charge', 100, '2026-10-01', { lineId: 'Z' });
    const zero2 = e('discount', -100, '2026-10-01', { lineId: 'Z' });
    const later = e('charge', 500, '2026-10-05', { lineId: 'Y' });
    const earlier = e('discount', -100, '2026-10-04', { lineId: 'Y' });
    const a = allocate([c, r, zero1, zero2, later, earlier]);
    expect(a.outstanding).toEqual([{ key: 'Y', occurredOn: '2026-10-04', amount: 400 }]);
  });

  const entry = fc
    .record({
      kind: fc.constantFrom('charge', 'discount', 'credit', 'payment', 'refund', 'write_off'),
      amount: fc.integer({ min: 1, max: 100_000 }),
      day: fc.integer({ min: 0, max: 200 }),
      line: fc.option(fc.constantFrom('L1', 'L2', 'L3'), { nil: null }),
    })
    .map((r, i = 0): LedgerFact => ({
      id: `p${Math.random().toString(36).slice(2)}${i}`,
      type: r.kind,
      amount: ['charge', 'refund'].includes(r.kind) ? r.amount : -r.amount,
      occurredOn: addDays('2026-01-01', r.day),
      lineId: ['charge', 'discount'].includes(r.kind) ? r.line : null,
      reversesEntryId: null,
    }));

  it('property: the balance is the sum of the ledger in any order, and equals what is unpaid minus what is ahead', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 25 }), fc.integer(), (entries, seed) => {
        const shuffled = [...entries].sort(
          (a, b) => ((a.id.charCodeAt(1) ^ seed) & 7) - ((b.id.charCodeAt(1) ^ seed) & 7),
        );
        expect(balanceOf(shuffled)).toBe(balanceOf(entries));
        const a = allocate(entries);
        const unpaid = a.outstanding.reduce((s, o) => s + o.amount, 0);
        expect(unpaid - a.unallocated).toBe(balanceOf(entries));
        expect(unpaid === 0 || a.unallocated === 0).toBe(true);
        const paid = Object.values(a.byPayment)
          .flat()
          .reduce((s, x) => s + x.amount, 0);
        const payments = -entries
          .filter((x) => x.type === 'payment')
          .reduce((s, x) => s + x.amount, 0);
        expect(paid).toBeLessThanOrEqual(payments);
      }),
    );
  });

  it('property: a reversal brings the balance back', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 15 }), entry, (entries, extra) => {
        const reversal: LedgerFact = {
          ...extra,
          id: `${extra.id}r`,
          type: 'adjustment',
          amount: -extra.amount,
          lineId: null,
          reversesEntryId: extra.id,
        };
        expect(balanceOf([...entries, extra, reversal])).toBe(balanceOf(entries));
        const a = allocate([...entries, extra, reversal]);
        const b = allocate(entries);
        expect(a.outstanding.reduce((s, o) => s + o.amount, 0)).toBe(
          b.outstanding.reduce((s, o) => s + o.amount, 0),
        );
      }),
    );
  });

  it('ages unpaid charges in 30-day buckets', () => {
    expect(
      agingBuckets(
        [
          { key: 'a', occurredOn: '2026-10-01', amount: 100 },
          { key: 'b', occurredOn: '2026-08-25', amount: 200 },
          { key: 'c', occurredOn: '2026-08-01', amount: 300 },
          { key: 'd', occurredOn: '2026-05-01', amount: 400 },
        ],
        '2026-10-20',
      ),
    ).toEqual({ current: 100, days31to60: 200, days61to90: 300, over90: 400 });
  });
});

describe('receipts', () => {
  const profile = {
    wording: 'טיפולי הידרותרפיה',
    requiresNationalId: true,
    includeSessionDates: true,
    splitPerMonth: true,
  };
  const input = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
    payment: { amount: 64_000, method: 'credit_card', paidOn: '2026-10-02' },
    client: { name: 'דנה לוי (דמו)', nationalId: '000000018', email: 'dana@example.test' },
    profile,
    covered: [
      {
        description: 'הידרותרפיה',
        period: '2026-10',
        studentName: 'יואב',
        sessionDates: ['2026-10-13', '2026-10-06'],
        amount: 32_000,
      },
      {
        description: 'הידרותרפיה',
        period: '2026-09',
        studentName: 'יואב',
        sessionDates: ['2026-09-08', '2026-09-15'],
        amount: 32_000,
      },
    ],
    ...over,
  });

  it('reimbursement mode: wording, ID, the lesson dates and the method, one document per month', () => {
    const r = receiptDocuments(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documents.map((d) => d.period)).toEqual(['2026-09', '2026-10']);
    const [sep] = r.documents;
    expect(sep).toEqual({
      period: '2026-09',
      client: { name: 'דנה לוי (דמו)', nationalId: '000000018', email: 'dana@example.test' },
      lines: [
        { description: 'טיפולי הידרותרפיה – יואב – חודש 09/2026', amount: 32_000, quantity: 1 },
      ],
      paymentMethod: 'כרטיס אשראי',
      notes: 'טיפולי הידרותרפיה\nת.ז. 000000018\nתאריכי המפגשים: 8.9.2026, 15.9.2026\nכרטיס אשראי',
      total: 32_000,
    });
    expect(r.documents[1]?.notes).toContain('תאריכי המפגשים: 6.10.2026, 13.10.2026');
  });

  it('refuses without the ID number the profile requires', () => {
    expect(
      receiptDocuments(input({ client: { name: 'x', nationalId: null, email: null } })),
    ).toEqual({
      ok: false,
      explanation: { code: code('receiptNeedsNationalId'), params: {} },
    });
  });

  it('a regular receipt: one document, the charge descriptions, a prepayment line for money ahead', () => {
    const r = receiptDocuments(
      input({
        profile: null,
        client: { name: 'משפחת כהן (דמו)', nationalId: null, email: null },
        payment: { amount: 70_000, method: 'bit', paidOn: '2026-10-02' },
      }),
    );
    if (!r.ok) throw new Error('expected documents');
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]).toMatchObject({
      period: null,
      client: { name: 'משפחת כהן (דמו)' },
      paymentMethod: 'ביט',
      notes: 'ביט',
      total: 70_000,
    });
    expect(r.documents[0]?.lines.map((l) => l.description)).toEqual([
      'הידרותרפיה – יואב – חודש 10/2026',
      'הידרותרפיה – יואב – חודש 09/2026',
      'תשלום על חשבון (יתרת זכות)',
    ]);
  });

  it('split receipts carry a prepayment on the last month; no dates when the profile omits them', () => {
    const r = receiptDocuments(
      input({
        payment: { amount: 70_000, method: 'standing_order', paidOn: '2026-10-02' },
        profile: { ...profile, includeSessionDates: false, requiresNationalId: false },
        client: { name: 'x', nationalId: null, email: null },
        covered: [
          {
            description: 'd',
            period: '2026-10',
            studentName: null,
            sessionDates: [],
            amount: 32_000,
          },
          {
            description: 'd',
            period: '2026-09',
            studentName: null,
            sessionDates: [],
            amount: 32_000,
          },
          { description: 'manual', period: null, studentName: null, sessionDates: [], amount: 0 },
        ],
      }),
    );
    if (!r.ok) throw new Error('expected documents');
    expect(r.documents.map((d) => d.total)).toEqual([32_000, 38_000]);
    expect(r.documents[1]?.lines.at(-1)?.description).toBe('תשלום על חשבון (יתרת זכות)');
    expect(r.documents[0]?.notes).toBe('טיפולי הידרותרפיה\nהוראת קבע (כרטיס אשראי)');
    // A payment that only paid ahead is one prepayment document.
    const ahead = receiptDocuments(input({ covered: [] }));
    if (!ahead.ok) throw new Error('expected documents');
    expect(ahead.documents.map((d) => [d.period, d.total])).toEqual([[null, 64_000]]);
  });

  it('property: the documents always add up to the payment', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            period: fc.option(fc.constantFrom('2026-08', '2026-09', '2026-10'), { nil: null }),
            amount: fc.integer({ min: 0, max: 50_000 }),
          }),
          { maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 50_000 }),
        fc.boolean(),
        (items, extra, split) => {
          const covered = items.map((i) => ({
            ...i,
            description: 'd',
            studentName: null,
            sessionDates: [],
          }));
          const amount = covered.reduce((s, c) => s + c.amount, 0) + extra;
          const r = receiptDocuments(
            input({
              payment: { amount, method: 'cash', paidOn: '2026-10-02' },
              profile: { ...profile, splitPerMonth: split },
              covered,
            }),
          );
          if (!r.ok) throw new Error('expected documents');
          expect(r.documents.reduce((s, d) => s + d.total, 0)).toBe(amount);
          for (const d of r.documents) expect(statementTotal(d.lines)).toBe(d.total);
        },
      ),
    );
  });
});
