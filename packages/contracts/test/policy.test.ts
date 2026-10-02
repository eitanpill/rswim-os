import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORG_RULES,
  getRule,
  PolicyRules,
  policyFields,
  setRule,
  windowAdmits,
  type GenderRestriction,
} from '../src';

describe('PolicyRules', () => {
  it('accepts the R-SWIM defaults and an empty override', () => {
    expect(PolicyRules.parse(DEFAULT_ORG_RULES)).toEqual(DEFAULT_ORG_RULES);
    expect(PolicyRules.parse({})).toEqual({});
  });
  it('rejects unknown keys and out-of-range values', () => {
    expect(PolicyRules.safeParse({ absence: { notice_hours: 12 } }).success).toBe(false);
    expect(PolicyRules.safeParse({ billing: { cancellation_cutoff_day: 40 } }).success).toBe(false);
    expect(PolicyRules.safeParse({ nonsense: {} }).success).toBe(false);
  });
});

describe('policyFields', () => {
  const fields = policyFields();
  const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
  it('lists every leaf with its editor type and unit', () => {
    expect(byPath['absence.notice_min_hours']).toEqual({
      path: 'absence.notice_min_hours',
      type: 'int',
      min: 0,
      max: 336,
      unit: 'hours',
    });
    expect(byPath['makeup.self_booking']).toEqual({ path: 'makeup.self_booking', type: 'boolean' });
    expect(byPath['discount.sibling.kind']).toMatchObject({
      type: 'enum',
      options: ['percent', 'flat'],
    });
    expect(byPath['calendar.no_lessons_on']).toMatchObject({ type: 'multi' });
    expect(byPath['discount.sibling.percent_bp']).toMatchObject({ unit: 'bp' });
    expect(byPath['venue.extra_child_fee_agorot']).toMatchObject({ unit: 'agorot' });
    expect(byPath['attendance.late_threshold_min']).toMatchObject({ unit: 'minutes' });
    expect(byPath['trial.offset.valid_days']).toMatchObject({ unit: 'days' });
    expect(byPath['calendar.holiday_notice_days_before']).toMatchObject({ unit: 'days' });
    expect(byPath['billing.run_day']).not.toHaveProperty('unit');
    expect(byPath['comms.quiet_hours_start']).toBeUndefined(); // free-form strings are not in the form editor
  });
});

describe('getRule / setRule', () => {
  it('reads dotted paths and tolerates missing branches', () => {
    expect(getRule(DEFAULT_ORG_RULES, 'absence.notice_min_hours')).toBe(12);
    expect(getRule({}, 'absence.notice_min_hours')).toBeUndefined();
    expect(
      getRule({ absence: { notice_min_hours: 3 } }, 'absence.notice_min_hours.deeper'),
    ).toBeUndefined();
  });
  it('sets and removes leaves immutably, pruning empty parents', () => {
    const r1 = setRule({}, 'discount.sibling.percent_bp', 500);
    expect(r1).toEqual({ discount: { sibling: { percent_bp: 500 } } });
    const r2 = setRule(r1, 'discount.stacking', 'additive');
    expect(r2).toEqual({ discount: { sibling: { percent_bp: 500 }, stacking: 'additive' } });
    expect(setRule(r2, 'discount.sibling.percent_bp', undefined)).toEqual({
      discount: { stacking: 'additive' },
    });
    expect(setRule(r1, 'discount.sibling.percent_bp', undefined)).toEqual({});
    expect(setRule({ makeup: { enabled: true } }, 'makeup', undefined)).toEqual({});
    expect(r1).toEqual({ discount: { sibling: { percent_bp: 500 } } });
  });
});

describe('windowAdmits', () => {
  const girl = { gender: 'female' as const, isAdult: false };
  const woman = { gender: 'female' as const, isAdult: true };
  const boy = { gender: 'male' as const, isAdult: false };
  const man = { gender: 'male' as const, isAdult: true };
  const unknown = { gender: null, isAdult: false };
  const table: [GenderRestriction, boolean[]][] = [
    ['mixed', [true, true, true, true, true]],
    ['female', [true, true, false, false, false]],
    ['male', [false, false, true, true, false]],
    ['women', [false, true, false, false, false]],
    ['men', [false, false, false, true, false]],
    ['girls', [true, false, false, false, false]],
    ['boys', [false, false, true, false, false]],
  ];
  it.each(table)('%s', (restriction, expected) => {
    expect([girl, woman, boy, man, unknown].map((p) => windowAdmits(restriction, p))).toEqual(
      expected,
    );
  });
});
