import { describe, expect, it } from 'vitest';
import {
  migrationRevertCheck,
  migrationRulesFrom,
  pickFreeLanes,
  priceChange,
  rankMergeTargets,
  type MigrationGroupFacts,
} from '../src/policies';

const group = (over: Partial<MigrationGroupFacts> = {}): MigrationGroupFacts => ({
  id: 'src',
  venueId: 'gush',
  programId: 'kids',
  weekday: 2,
  startsAt: '16:00',
  admittedGender: 'mixed',
  ageMinMonths: 60,
  ageMaxMonths: 96,
  levelMinOrdinal: 1,
  levelMaxOrdinal: 2,
  capacity: 6,
  seated: 4,
  ...over,
});
const codes = (r: { code: string }[]) => r.map((x) => x.code.split('.').pop());

describe('migration rules', () => {
  it('reads the revert window, 24 hours by default', () => {
    expect(migrationRulesFrom({})).toEqual({ revertHours: 24 });
    expect(migrationRulesFrom({ migration: { revert_hours: 48 } })).toEqual({ revertHours: 48 });
  });
});

describe('rankMergeTargets', () => {
  const source = group();

  it('prefers the same program at the same slot with room, and explains why', () => {
    const ranked = rankMergeTargets(source, [
      group({ id: 'same-venue', venueId: 'gush' }),
      group({ id: 'src', venueId: 'jlm' }),
      group({ id: 'girls', venueId: 'jlm', admittedGender: 'female' }),
      group({ id: 'best', venueId: 'jlm', seated: 1 }),
      group({ id: 'near', venueId: 'jlm', startsAt: '16:45', seated: 0 }),
      group({ id: 'close', venueId: 'jlm', startsAt: '16:10', programId: 'other', seated: 0 }),
      group({ id: 'far', venueId: 'jlm', startsAt: '18:00', seated: 0 }),
      group({ id: 'other-day', venueId: 'jlm', weekday: 4, seated: 0 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['best', 'near', 'far', 'close', 'other-day']);
    expect(ranked[0]).toMatchObject({ score: 100, fits: true });
    expect(codes(ranked[0]!.reasons)).toEqual([
      'sameProgram',
      'sameSlot',
      'ageOverlap',
      'levelOverlap',
      'room',
    ]);
    expect(ranked[1]!.reasons[1]).toEqual({
      code: 'scheduling.migration.why.sameDay',
      params: { minutes: 45 },
    });
    expect(ranked.at(-1)!.reasons[1]).toEqual({
      code: 'scheduling.migration.why.otherDay',
      params: { day: 4 },
    });
  });

  it('keeps a full group but marks it, and scores a different age band and level lower', () => {
    const [full, apart] = rankMergeTargets(source, [
      group({ id: 'full', venueId: 'jlm', seated: 5 }),
      group({
        id: 'apart',
        venueId: 'jlm',
        ageMinMonths: 120,
        ageMaxMonths: 180,
        levelMinOrdinal: 4,
        levelMaxOrdinal: 5,
        seated: 0,
      }),
    ]);
    expect(full).toMatchObject({ id: 'full', fits: false, score: 90 });
    expect(full!.reasons.at(-1)).toEqual({
      code: 'scheduling.migration.why.noRoom',
      params: { free: 1, needed: 4 },
    });
    expect(apart).toMatchObject({ id: 'apart', score: 80 });
    expect(codes(apart!.reasons)).toEqual(['sameProgram', 'sameSlot', 'ageApart', 'room']);
  });

  it('treats open age and level ranges as overlapping, and a same-gender group as fitting', () => {
    const girls = group({ admittedGender: 'female', ageMinMonths: null, levelMaxOrdinal: null });
    const [s] = rankMergeTargets(girls, [
      group({ id: 'g', venueId: 'jlm', admittedGender: 'female', seated: 2, capacity: 4 }),
    ]);
    expect(s).toMatchObject({ id: 'g', fits: false, score: 90 });
    const [t] = rankMergeTargets(source, [
      group({ id: 't', venueId: 'jlm', ageMaxMonths: null, levelMinOrdinal: null, seated: 0 }),
    ]);
    expect(t!.score).toBe(100);
  });

  it('breaks a tie by the earlier slot', () => {
    const ranked = rankMergeTargets(source, [
      group({ id: 'thu', venueId: 'jlm', weekday: 4, seated: 0 }),
      group({ id: 'wed', venueId: 'jlm', weekday: 3, seated: 0 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['wed', 'thu']);
  });
});

describe('pickFreeLanes', () => {
  it('takes the first free lanes, or none when too few are free', () => {
    expect(pickFreeLanes(['l1', 'l2', 'l3', 'l4'], ['l1', 'l3'], 2)).toEqual(['l2', 'l4']);
    expect(pickFreeLanes(['l1', 'l2'], ['l1'], 2)).toEqual([]);
  });
});

describe('priceChange', () => {
  it('compares the monthly price before and after', () => {
    expect(priceChange(null, 30000)).toEqual({ kind: 'unknown' });
    expect(priceChange(30000, null)).toEqual({ kind: 'unknown' });
    expect(priceChange(30000, 30000)).toEqual({ kind: 'same', before: 30000, after: 30000 });
    expect(priceChange(30000, 32000)).toEqual({
      kind: 'up',
      before: 30000,
      after: 32000,
      delta: 2000,
    });
    expect(priceChange(32000, 30000)).toMatchObject({ kind: 'down', delta: 2000 });
  });
});

describe('migrationRevertCheck', () => {
  const until = new Date('2026-10-07T08:00:00Z');
  it('allows a revert only for an executed migration inside its window', () => {
    expect(
      migrationRevertCheck(
        { status: 'executed', revertUntil: until },
        new Date('2026-10-07T07:59:00Z'),
      ),
    ).toEqual({ ok: true });
    expect(
      migrationRevertCheck(
        { status: 'executed', revertUntil: until },
        new Date('2026-10-07T08:01:00Z'),
      ),
    ).toEqual({ ok: false, code: 'scheduling.migration.errors.revertClosed' });
    expect(migrationRevertCheck({ status: 'executed', revertUntil: null }, until)).toMatchObject({
      ok: false,
    });
    expect(migrationRevertCheck({ status: 'draft', revertUntil: null }, until)).toEqual({
      ok: false,
      code: 'scheduling.migration.errors.notExecuted',
    });
    expect(migrationRevertCheck({ status: 'reverted', revertUntil: until }, until)).toMatchObject({
      ok: false,
    });
  });
});
