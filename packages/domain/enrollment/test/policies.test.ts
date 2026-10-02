import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import {
  enrollmentRulesFrom,
  formsDue,
  offerValidUntil,
  trialOffset,
  type Acceptance,
  type CurrentForm,
} from '../src/policies';

const rules = enrollmentRulesFrom(DEFAULT_ORG_RULES);

describe('rules with defaults', () => {
  it('reads R-SWIM’s regulations and falls back to the documented defaults', () => {
    expect(rules).toEqual({
      offsetEnabled: true,
      offsetAmount: 'full_trial_fee',
      offsetFixedAgorot: 0,
      offsetValidDays: 14,
      healthRequired: true,
      healthValidMonths: 12,
      regulationsRequired: true,
    });
    expect(enrollmentRulesFrom({})).toEqual(rules);
  });
});

describe('trialOffset', () => {
  const trial = { feeAgorot: 5000, trialDate: '2026-10-05', enrollDate: '2026-10-12' };
  it('offsets the whole trial fee within the window, through its last day', () => {
    expect(offerValidUntil('2026-10-05', rules)).toBe('2026-10-19');
    expect(trialOffset(trial, rules)).toEqual({
      offsetAgorot: 5000,
      explanation: {
        code: 'enrollment.decision.offsetApplied',
        params: { amount: 5000, until: '2026-10-19' },
      },
    });
    expect(trialOffset({ ...trial, enrollDate: '2026-10-19' }, rules).offsetAgorot).toBe(5000);
  });
  it('offsets nothing after the window, without a fee, or when the regulations turn it off', () => {
    expect(trialOffset({ ...trial, enrollDate: '2026-10-20' }, rules)).toEqual({
      offsetAgorot: 0,
      explanation: { code: 'enrollment.decision.offsetExpired', params: { until: '2026-10-19' } },
    });
    expect(trialOffset({ ...trial, feeAgorot: null }, rules).explanation.code).toBe(
      'enrollment.decision.noFee',
    );
    expect(trialOffset({ ...trial, feeAgorot: 0 }, rules).explanation.code).toBe(
      'enrollment.decision.noFee',
    );
    expect(trialOffset(trial, { ...rules, offsetEnabled: false }).explanation.code).toBe(
      'enrollment.decision.offsetOff',
    );
  });
  it('a fixed offset never exceeds the fee', () => {
    const fixed = { ...rules, offsetAmount: 'fixed' as const };
    expect(trialOffset(trial, { ...fixed, offsetFixedAgorot: 3000 }).offsetAgorot).toBe(3000);
    expect(trialOffset(trial, { ...fixed, offsetFixedAgorot: 9000 }).offsetAgorot).toBe(5000);
  });
});

describe('formsDue', () => {
  const current: CurrentForm[] = [
    { id: 'reg2', kind: 'regulations', version: 2 },
    { id: 'h1', kind: 'health_declaration', version: 1 },
    { id: 'photo1', kind: 'photo_consent', version: 1 },
  ];
  const acc = (over: Partial<Acceptance>): Acceptance => ({
    formTemplateId: 'reg2',
    kind: 'regulations',
    version: 2,
    studentId: null,
    acceptedOn: '2026-09-01',
    ...over,
  });
  const due = (acceptances: Acceptance[], r = rules, today = '2026-10-02') =>
    formsDue({ current, acceptances, studentIds: ['a', 'b'], today }, r).map((d) => [
      d.kind,
      d.studentId,
      d.why.code.replace('enrollment.decision.', ''),
    ]);

  it('asks for the regulations once and a health declaration per child', () => {
    expect(due([])).toEqual([
      ['regulations', null, 'missing'],
      ['health_declaration', 'a', 'missing'],
      ['health_declaration', 'b', 'missing'],
    ]);
  });
  it('is satisfied by the current versions, and asks again for a new version', () => {
    const health = (studentId: string) =>
      acc({ formTemplateId: 'h1', kind: 'health_declaration', version: 1, studentId });
    expect(due([acc({}), health('a'), health('b')])).toEqual([]);
    expect(due([acc({ formTemplateId: 'reg1', version: 1 }), health('a'), health('b')])).toEqual([
      ['regulations', null, 'newVersion'],
    ]);
  });
  it('renews a health declaration after health.declaration_valid_months', () => {
    const old = acc({
      formTemplateId: 'h1',
      kind: 'health_declaration',
      studentId: 'a',
      acceptedOn: '2025-10-02',
    });
    const fresh = acc({
      formTemplateId: 'h1',
      kind: 'health_declaration',
      studentId: 'a',
      acceptedOn: '2026-09-15',
    });
    expect(due([acc({}), old])).toEqual([
      ['health_declaration', 'a', 'renew'],
      ['health_declaration', 'b', 'missing'],
    ]);
    // The latest acceptance counts.
    expect(due([acc({}), old, fresh])).toEqual([['health_declaration', 'b', 'missing']]);
  });
  it('skips kinds the regulations do not require, and kinds with no published form', () => {
    expect(due([], { ...rules, healthRequired: false, regulationsRequired: false })).toEqual([]);
    expect(
      formsDue({ current: [], acceptances: [], studentIds: ['a'], today: '2026-10-02' }, rules),
    ).toEqual([]);
  });
});
