import { describe, expect, it } from 'vitest';
import {
  isStale,
  nextStage,
  onBoard,
  riderCheck,
  runSummary,
  runsOn,
  stageCheck,
  transportRulesFrom,
} from '../src/policies';

const rules = transportRulesFrom({ transport: { stale_after_min: 30, short_water_warn_min: 5 } });
const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+03:00`);

describe('rules', () => {
  it('reads the policy with defaults', () => {
    expect(transportRulesFrom({})).toEqual({ staleAfterMin: 30, shortWaterWarnMin: 5 });
    expect(rules).toEqual({ staleAfterMin: 30, shortWaterWarnMin: 5 });
  });
});

describe('stages', () => {
  it('moves forward once each, out of the water only after in', () => {
    expect(stageCheck([], 'left_school')).toEqual({ ok: true });
    expect(stageCheck(['left_school'], 'left_school')).toEqual({
      ok: false,
      code: 'transport.errors.stageDone',
    });
    expect(stageCheck(['arrived_pool'], 'left_school')).toEqual({
      ok: false,
      code: 'transport.errors.stageOrder',
    });
    expect(stageCheck(['arrived_pool'], 'out_of_water')).toEqual({
      ok: false,
      code: 'transport.errors.notInWater',
    });
    // A forgotten tap is skipped.
    expect(stageCheck([], 'arrived_pool')).toEqual({ ok: true });
  });

  it('suggests the stage after the latest one tapped', () => {
    expect(nextStage([])).toBe('left_school');
    expect(nextStage(['left_school', 'arrived_pool'])).toBe('in_water');
    expect(nextStage(['left_school', 'arrived_pool', 'in_water'])).toBe('out_of_water');
    expect(nextStage(['arrived_pool', 'left_pool'])).toBe('run_done');
    expect(nextStage(['left_school', 'run_done'])).toBeNull();
  });
});

describe('children', () => {
  it('marks on board or missing at pickup, once, until the pool', () => {
    expect(riderCheck([], [], 'boarded')).toEqual({ ok: true });
    expect(riderCheck(['left_school'], [], 'missing')).toEqual({ ok: true });
    expect(riderCheck([], ['boarded'], 'missing')).toEqual({
      ok: false,
      code: 'transport.errors.riderMarked',
    });
    expect(riderCheck([], ['missing'], 'missing')).toEqual({
      ok: false,
      code: 'transport.errors.riderMarked',
    });
    expect(riderCheck(['arrived_pool'], [], 'boarded')).toEqual({
      ok: false,
      code: 'transport.errors.pickupOver',
    });
  });

  it('drops off a child on board, after the group left the pool', () => {
    expect(riderCheck(['arrived_pool'], ['boarded'], 'dropped_off')).toEqual({
      ok: false,
      code: 'transport.errors.notLeftPool',
    });
    expect(riderCheck(['left_pool'], ['missing'], 'dropped_off')).toEqual({
      ok: false,
      code: 'transport.errors.notBoarded',
    });
    expect(riderCheck(['left_pool'], ['boarded'], 'dropped_off')).toEqual({ ok: true });
  });

  it('messages the children on board, or everyone not missing when nobody was marked', () => {
    const riders = ['a', 'b', 'c'];
    expect(onBoard(riders, [])).toEqual(['a', 'b', 'c']);
    expect(onBoard(riders, [{ studentId: 'b', mark: 'missing' }])).toEqual(['a', 'c']);
    expect(
      onBoard(riders, [
        { studentId: 'a', mark: 'boarded' },
        { studentId: 'c', mark: 'missing' },
      ]),
    ).toEqual(['a']);
  });

  it('does not message about an old tap', () => {
    expect(isStale(t('16:00'), t('16:30'), rules)).toBe(false);
    expect(isStale(t('16:00'), t('16:31'), rules)).toBe(true);
  });
});

describe('in-water time', () => {
  const lesson = { startsAt: t('16:15'), minutes: 45 };

  it('is unknown until both water stages are tapped', () => {
    expect(runSummary([{ stage: 'arrived_pool', at: t('16:25') }], lesson, rules)).toEqual({
      inWaterMin: null,
      plannedMin: 45,
      lateMin: 10,
      short: false,
      explanation: { code: 'transport.decision.waterUnknown', params: { late: 10 } },
    });
    expect(runSummary([], null, rules).explanation).toEqual({
      code: 'transport.decision.waterUnknown',
      params: { late: 0 },
    });
  });

  it('flags a lesson the children got only part of', () => {
    const s = runSummary(
      [
        { stage: 'arrived_pool', at: t('16:25') },
        { stage: 'in_water', at: t('16:32') },
        { stage: 'out_of_water', at: t('17:00') },
      ],
      lesson,
      rules,
    );
    expect(s).toMatchObject({ inWaterMin: 28, plannedMin: 45, lateMin: 10, short: true });
    expect(s.explanation).toEqual({
      code: 'transport.decision.waterShort',
      params: { minutes: 28, planned: 45, late: 10 },
    });
    // Without an arrival tap the lateness is unknown (0 in the text).
    expect(
      runSummary(
        [
          { stage: 'in_water', at: t('16:32') },
          { stage: 'out_of_water', at: t('17:00') },
        ],
        lesson,
        rules,
      ).explanation.params,
    ).toEqual({ minutes: 28, planned: 45, late: 0 });
  });

  it('is full when within the tolerance, and plain without a lesson', () => {
    const stages = [
      { stage: 'arrived_pool' as const, at: t('16:05') },
      { stage: 'in_water' as const, at: t('16:15') },
      { stage: 'out_of_water' as const, at: t('16:56') },
    ];
    expect(runSummary(stages, lesson, rules)).toMatchObject({
      inWaterMin: 41,
      lateMin: 0,
      short: false,
      explanation: { code: 'transport.decision.waterFull', params: { minutes: 41, planned: 45 } },
    });
    expect(runSummary(stages, null, rules)).toMatchObject({
      plannedMin: null,
      lateMin: null,
      explanation: { code: 'transport.decision.water', params: { minutes: 41 } },
    });
  });
});

describe('weekdays', () => {
  it('matches the date’s weekday', () => {
    expect(runsOn([1, 3], '2026-10-05')).toBe(true); // Monday
    expect(runsOn([0], '2026-10-05')).toBe(false);
  });
});
