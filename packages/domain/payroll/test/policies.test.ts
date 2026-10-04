import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeStaffPay,
  payForItem,
  payrollRulesFrom,
  pensionStatus,
  periodBounds,
  previousPeriod,
  ruleFor,
  sickAccrual,
  type PayRuleRow,
  type WorkItem,
} from '../src/policies';

const KIDS = 'program-kids';
const PRIVATE = 'program-private';
const GUSH = 'venue-gush';
const JLM = 'venue-jlm';

const rule = (over: Partial<PayRuleRow>): PayRuleRow => ({
  id: 'r',
  basis: 'per_hour',
  amountAgorot: 9000,
  programId: null,
  venueId: null,
  routing: 'payslip',
  travelAllowanceAgorot: 0,
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  ...over,
});

const item = (over: Partial<WorkItem>): WorkItem => ({
  workKind: 'group',
  sessionId: 's',
  slotId: null,
  date: '2026-10-06',
  venueId: GUSH,
  programId: KIDS,
  minutes: 45,
  heads: 6,
  label: 'בנים דולפין',
  ...over,
});

describe('periods', () => {
  it('steps back a month and across a year', () => {
    expect(previousPeriod('2026-10')).toBe('2026-09');
    expect(previousPeriod('2027-01')).toBe('2026-12');
  });
  it('knows the last day of the month', () => {
    expect(periodBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds('2028-02').to).toBe('2028-02-29');
    expect(periodBounds('2026-10').to).toBe('2026-10-31');
  });
});

describe('payrollRulesFrom', () => {
  it('reads the policy and falls back to the defaults', () => {
    expect(payrollRulesFrom({})).toEqual({ pensionThresholdMonths: 3, sickHalfDaysPerMonth: 3 });
    expect(
      payrollRulesFrom({
        payroll: { pension_threshold_months: 6, sick_leave_accrual_halfdays_per_month: 2 },
      }),
    ).toEqual({ pensionThresholdMonths: 6, sickHalfDaysPerMonth: 2 });
  });
});

describe('ruleFor', () => {
  const any = rule({ id: 'any' });
  const venue = rule({ id: 'venue', venueId: GUSH });
  const program = rule({ id: 'program', programId: KIDS });
  const both = rule({ id: 'both', programId: KIDS, venueId: GUSH });

  it('picks the most specific rule that fits', () => {
    expect(ruleFor(item({}), [any, venue, program, both])?.id).toBe('both');
    expect(ruleFor(item({}), [any, venue, program])?.id).toBe('program');
    expect(ruleFor(item({}), [any, venue])?.id).toBe('venue');
    expect(ruleFor(item({ venueId: JLM }), [any, venue])?.id).toBe('any');
  });
  it('skips rules for another program or venue, and says when none fits', () => {
    expect(ruleFor(item({ programId: PRIVATE }), [program, venue])?.id).toBe('venue');
    expect(ruleFor(item({ programId: null, venueId: JLM }), [program, venue])).toBeNull();
  });
  it('uses the version in force on the lesson date, the latest on a tie', () => {
    const old = rule({ id: 'old', effectiveTo: '2026-10-10' });
    const next = rule({ id: 'new', effectiveFrom: '2026-10-10' });
    expect(ruleFor(item({ date: '2026-10-09' }), [old, next])?.id).toBe('old');
    expect(ruleFor(item({ date: '2026-10-10' }), [old, next])?.id).toBe('new');
    expect(ruleFor(item({ date: '2026-08-31' }), [old, next])).toBeNull();
    const a = rule({ id: 'a', effectiveFrom: '2026-09-01' });
    const b = rule({ id: 'b', effectiveFrom: '2026-10-01' });
    expect(ruleFor(item({}), [a, b])?.id).toBe('b');
    expect(ruleFor(item({}), [b, a])?.id).toBe('b');
    expect(ruleFor(item({}), [a, a])?.id).toBe('a');
  });
});

describe('payForItem', () => {
  it('pays per hour by the minute, rounded half-up to the agora', () => {
    expect(payForItem(item({ minutes: 45 }), rule({}))).toMatchObject({
      quantity: 0.75,
      unit: 'hour',
      amount: 6750,
      explanation: { code: 'payroll.decision.perHour', params: { minutes: 45, rate: 9000 } },
    });
    expect(payForItem(item({ minutes: 40 }), rule({ amountAgorot: 8500 })).amount).toBe(5667);
  });
  it('pays per session and per head', () => {
    expect(payForItem(item({}), rule({ basis: 'per_session', amountAgorot: 12000 }))).toMatchObject(
      { quantity: 1, unit: 'session', amount: 12000 },
    );
    expect(
      payForItem(item({ heads: 7 }), rule({ basis: 'per_head', amountAgorot: 1500 })),
    ).toMatchObject({
      quantity: 7,
      unit: 'head',
      amount: 10500,
    });
  });
});

describe('computeStaffPay: the hybrid instructor (acceptance criterion 1)', () => {
  // Hand-calculated fixture. Groups: ₪90/hour on the payslip with ₪15 travel a day; privates: ₪120 a lesson by transfer.
  const groups = rule({ id: 'groups', programId: KIDS, travelAllowanceAgorot: 1500 });
  const privates = rule({
    id: 'privates',
    basis: 'per_session',
    amountAgorot: 12000,
    programId: PRIVATE,
    routing: 'transfer',
  });
  const slot = (date: string, venueId: string, slotId: string) =>
    item({
      workKind: 'slot',
      sessionId: null,
      slotId,
      date,
      venueId,
      programId: PRIVATE,
      minutes: 30,
      heads: 1,
      label: 'פרטי',
    });
  const items: WorkItem[] = [
    item({ sessionId: 'a', date: '2026-10-06', minutes: 45, label: 'בנים דולפין' }), // 67.50
    item({ sessionId: 'b', date: '2026-10-06', minutes: 45, label: 'בנות כריש' }), // 67.50
    slot('2026-10-06', GUSH, 'p1'), // 120 transfer
    item({ sessionId: 'c', date: '2026-10-13', minutes: 50, label: 'בנים דולפין' }), // 75.00
    slot('2026-10-15', JLM, 'p2'), // 120 transfer
    slot('2026-10-15', JLM, 'p3'), // 120 transfer
  ];
  const pay = computeStaffPay(
    items,
    [groups, privates],
    [{ id: 'adj', kind: 'bonus', routing: 'payslip', amountAgorot: 20000, note: 'בונוס קייטנה' }],
  );

  it('matches the hand calculation: payslip ₪440, transfer ₪360', () => {
    // 67.50 + 67.50 + 75.00 + travel 15 × 2 days at Gush + bonus 200 = 440.00
    expect(pay.payslip).toBe(44000);
    // 3 × 120 = 360.00 (no travel on the private rule)
    expect(pay.transfer).toBe(36000);
    expect(pay.unpriced).toEqual([]);
  });
  it('routes each lesson with its rule and explains it', () => {
    const work = pay.lines.filter((l) => l.kind === 'work');
    expect(work.map((l) => [l.date, l.routing, l.amount])).toEqual([
      ['2026-10-06', 'payslip', 6750],
      ['2026-10-06', 'payslip', 6750],
      ['2026-10-06', 'transfer', 12000],
      ['2026-10-13', 'payslip', 7500],
      ['2026-10-15', 'transfer', 12000],
      ['2026-10-15', 'transfer', 12000],
    ]);
    expect(
      work.every((l) => l.payRuleId && l.explanation.code.startsWith('payroll.decision.')),
    ).toBe(true);
    expect(
      pay.lines.filter((l) => l.kind === 'travel').map((l) => [l.date, l.amount, l.routing]),
    ).toEqual([
      ['2026-10-06', 1500, 'payslip'],
      ['2026-10-13', 1500, 'payslip'],
    ]);
    expect(pay.lines.find((l) => l.kind === 'adjustment')).toMatchObject({
      amount: 20000,
      description: 'בונוס קייטנה',
      explanation: { code: 'payroll.decision.adjustment.bonus' },
    });
  });
  it('leaves a lesson no rule prices unpaid, for the review', () => {
    const lonely = item({ programId: 'other', venueId: JLM });
    const r = computeStaffPay([lonely], [groups, privates]);
    expect(r.unpriced).toEqual([lonely]);
    expect(r.lines).toEqual([]);
    expect(r.payslip + r.transfer).toBe(0);
  });
  it('pays travel once a day per venue: the largest allowance, the payslip on a tie', () => {
    const big = rule({ id: 'big', venueId: JLM, travelAllowanceAgorot: 3000, routing: 'transfer' });
    const small = rule({ id: 'small', programId: KIDS, travelAllowanceAgorot: 1000 });
    const r1 = computeStaffPay(
      [item({ venueId: JLM, programId: 'x' }), item({ venueId: JLM, programId: KIDS })],
      [big, small],
    );
    expect(r1.lines.filter((l) => l.kind === 'travel').map((l) => [l.amount, l.routing])).toEqual([
      [3000, 'transfer'],
    ]);
    const t1 = rule({
      id: 't1',
      programId: PRIVATE,
      travelAllowanceAgorot: 1000,
      routing: 'transfer',
    });
    const t2 = rule({ id: 't2', programId: KIDS, travelAllowanceAgorot: 1000 });
    const t3 = rule({
      id: 't3',
      programId: 'third',
      travelAllowanceAgorot: 1000,
      routing: 'transfer',
    });
    const r2 = computeStaffPay(
      [
        item({ programId: PRIVATE, label: 'a' }),
        item({ programId: KIDS, label: 'b' }),
        item({ programId: 'third', label: 'c' }),
      ],
      [t1, t2, t3],
    );
    expect(r2.lines.filter((l) => l.kind === 'travel').map((l) => [l.amount, l.routing])).toEqual([
      [1000, 'payslip'],
    ]);
  });
  it('sorts lessons by date then label', () => {
    const r = computeStaffPay(
      [
        item({ date: '2026-10-08', label: 'b' }),
        item({ date: '2026-10-07', label: 'z' }),
        item({ date: '2026-10-08', label: 'a' }),
      ],
      [rule({})],
    );
    expect(r.lines.map((l) => `${l.date}${l.description}`)).toEqual([
      '2026-10-07z',
      '2026-10-08a',
      '2026-10-08b',
    ]);
  });
  it('totals are always the sum of the rounded lines, per routing', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            minutes: fc.integer({ min: 15, max: 120 }),
            programId: fc.constantFrom(KIDS, PRIVATE),
            day: fc.integer({ min: 1, max: 28 }),
          }),
          { maxLength: 30 },
        ),
        (rows) => {
          const its = rows.map((r) =>
            item({
              minutes: r.minutes,
              programId: r.programId,
              date: `2026-10-${String(r.day).padStart(2, '0')}`,
            }),
          );
          const p = computeStaffPay(its, [groups, privates]);
          const sum = (routing: string) =>
            p.lines.filter((l) => l.routing === routing).reduce((s, l) => s + l.amount, 0);
          return (
            p.payslip === sum('payslip') &&
            p.transfer === sum('transfer') &&
            p.lines.every((l) => Number.isInteger(l.amount) && l.amount >= 0)
          );
        },
      ),
    );
  });
});

describe('pensionStatus', () => {
  it('counts continuous months ending this month and flags the retro start once', () => {
    expect(pensionStatus(['2026-08', '2026-09'], '2026-09', 3)).toMatchObject({
      continuousMonths: 2,
      eligible: false,
      newlyEligible: false,
      retroFrom: null,
      explanation: { code: 'payroll.decision.pension.notYet', params: { months: 2, threshold: 3 } },
    });
    expect(pensionStatus(['2026-08', '2026-09', '2026-10'], '2026-10', 3)).toMatchObject({
      continuousMonths: 3,
      eligible: true,
      newlyEligible: true,
      retroFrom: '2026-08',
      explanation: { code: 'payroll.decision.pension.newlyEligible' },
    });
    expect(pensionStatus(['2026-08', '2026-09', '2026-10', '2026-11'], '2026-11', 3)).toMatchObject(
      {
        eligible: true,
        newlyEligible: false,
        retroFrom: null,
        explanation: { code: 'payroll.decision.pension.eligible' },
      },
    );
  });
  it('a gap breaks the streak, across a year too', () => {
    expect(pensionStatus(['2026-07', '2026-09', '2026-10'], '2026-10', 3).continuousMonths).toBe(2);
    expect(pensionStatus(['2026-11', '2026-12', '2027-01'], '2027-01', 3).retroFrom).toBe(
      '2026-11',
    );
    expect(pensionStatus(['2026-09'], '2026-10', 3)).toMatchObject({
      continuousMonths: 0,
      eligible: false,
    });
  });
  it('a zero threshold makes any worked month eligible', () => {
    expect(pensionStatus(['2026-10'], '2026-10', 0)).toMatchObject({
      eligible: true,
      newlyEligible: true,
    });
    expect(pensionStatus([], '2026-10', 0)).toMatchObject({ eligible: false });
  });
});

describe('sickAccrual', () => {
  const rules = { pensionThresholdMonths: 3, sickHalfDaysPerMonth: 3 };
  it('employees and hybrids on the payslip accrue; freelancers and idle months do not', () => {
    expect(sickAccrual('employee', true, rules)).toBe(3);
    expect(sickAccrual('hybrid', true, rules)).toBe(3);
    expect(sickAccrual('freelancer_exempt', true, rules)).toBe(0);
    expect(sickAccrual('employee', false, rules)).toBe(0);
  });
});
