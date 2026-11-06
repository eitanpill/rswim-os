import { describe, expect, it } from 'vitest';
import { absencePct, monthChange, type MonthFacts } from '../src/policies';

const month = (over: Partial<MonthFacts> = {}): MonthFacts => ({
  period: '2026-10',
  placesAtEnd: 100,
  newPlaces: 10,
  endedPlaces: 5,
  lessonsHeld: 80,
  lessonsCancelled: 2,
  marks: 400,
  absences: 40,
  trialsHeld: 6,
  trialsEnrolled: 3,
  chargedAgorot: 5_000_000,
  collectedAgorot: 4_500_000,
  venues: [],
  ...over,
});

describe('a month against another', () => {
  it('counts absences as a share of the marks', () => {
    expect(absencePct(month())).toBe(10);
    expect(absencePct(month({ marks: 0, absences: 0 }))).toBeNull();
  });

  it('says how much each measure moved', () => {
    const now = month({ period: '2026-10', placesAtEnd: 110, lessonsCancelled: 2 });
    const before = month({
      period: '2025-10',
      placesAtEnd: 100,
      lessonsCancelled: 0,
      absences: 80,
    });
    const c = monthChange(now, before);
    expect(c.find((x) => x.measure === 'placesAtEnd')).toEqual({
      measure: 'placesAtEnd',
      now: 110,
      before: 100,
      delta: 10,
      pct: 10,
    });
    // From nothing, the move has no percent.
    expect(c.find((x) => x.measure === 'lessonsCancelled')).toMatchObject({ delta: 2, pct: null });
    expect(c.find((x) => x.measure === 'absencePct')).toMatchObject({
      now: 10,
      before: 20,
      delta: -10,
      pct: -50,
    });
  });

  it('has nothing to compare with before the first month', () => {
    const c = monthChange(month({ marks: 0, absences: 0 }), null);
    expect(c.every((x) => x.before === null && x.delta === null && x.pct === null)).toBe(true);
    expect(c.find((x) => x.measure === 'absencePct')!.now).toBeNull();
  });
});
