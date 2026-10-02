import { describe, expect, it } from 'vitest';
import { toMinutes, validateWindow, weekGrid, type WindowInput } from '../src/policies';

const base: WindowInput = {
  id: 'w1',
  poolId: 'p1',
  weekday: 1,
  startsAt: '15:00',
  endsAt: '19:00',
  genderRestriction: 'female',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  laneIds: ['l1', 'l2'],
};
const w = (p: Partial<WindowInput>): WindowInput => ({ ...base, id: undefined, ...p });

describe('toMinutes', () => {
  it('reads HH:MM and HH:MM:SS', () => {
    expect(toMinutes('15:40')).toBe(940);
    expect(toMinutes('07:05:00')).toBe(425);
  });
});

describe('validateWindow', () => {
  it('accepts a clean window', () => {
    expect(validateWindow(w({}), [])).toEqual([]);
  });
  it('rejects reversed times, reversed dates and no lanes', () => {
    expect(
      validateWindow(
        w({ startsAt: '19:00', endsAt: '15:00', effectiveTo: '2026-08-01', laneIds: [] }),
        [],
      ),
    ).toEqual([
      { code: 'venues.errors.endBeforeStart' },
      { code: 'venues.errors.datesReversed' },
      { code: 'venues.errors.noLanes' },
    ]);
  });
  it('rejects a second window on a shared lane at an overlapping time', () => {
    expect(
      validateWindow(
        w({ startsAt: '18:00', endsAt: '20:00', laneIds: ['l2', 'l3'], genderRestriction: 'male' }),
        [base],
      ),
    ).toEqual([{ code: 'venues.errors.laneOverlap', windowId: 'w1', laneIds: ['l2'] }]);
  });
  it('allows back-to-back windows, other lanes, other weekdays, other pools and other date ranges', () => {
    const ok = [
      w({ startsAt: '19:00', endsAt: '20:00' }),
      w({ laneIds: ['l3'] }),
      w({ weekday: 3 }),
      w({ poolId: 'p2' }),
      w({ effectiveFrom: '2027-01-01' }),
    ];
    const ended = { ...base, effectiveTo: '2027-01-01' };
    for (const x of ok) expect(validateWindow(x, [ended]), JSON.stringify(x)).toEqual([]);
    expect(
      validateWindow(w({ effectiveFrom: '2026-01-01', effectiveTo: '2026-09-01' }), [base]),
    ).toEqual([]);
  });
  it('ignores the window being edited', () => {
    expect(validateWindow({ ...base, endsAt: '20:00' }, [base])).toEqual([]);
  });
});

describe('weekGrid', () => {
  it('groups by weekday, Sunday first, sorted by start time', () => {
    const grid = weekGrid([
      { weekday: 3, startsAt: '17:00' },
      { weekday: 1, startsAt: '16:00' },
      { weekday: 1, startsAt: '15:00' },
    ]);
    expect(grid.map((d) => d.map((x) => x.startsAt))).toEqual([
      [],
      ['15:00', '16:00'],
      [],
      ['17:00'],
      [],
      [],
      [],
    ]);
  });
});
