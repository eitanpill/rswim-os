/** Pure rules for venue operating windows (brief §6.2): times, dates and lane overlaps. */
import type { GenderRestriction, Weekday } from '@rswim/contracts';

export interface WindowInput {
  id?: string;
  poolId: string;
  weekday: Weekday;
  startsAt: string; // HH:MM or HH:MM:SS
  endsAt: string;
  genderRestriction: GenderRestriction;
  effectiveFrom: string;
  effectiveTo: string | null;
  laneIds: readonly string[];
}

export type WindowError =
  | { code: 'venues.errors.endBeforeStart' }
  | { code: 'venues.errors.datesReversed' }
  | { code: 'venues.errors.noLanes' }
  | { code: 'venues.errors.laneOverlap'; windowId: string; laneIds: string[] };

/** Minutes since midnight for "HH:MM" or "HH:MM:SS". */
export const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const datesOverlap = (a: WindowInput, b: WindowInput) =>
  a.effectiveFrom < (b.effectiveTo ?? '9999-12-31') &&
  b.effectiveFrom < (a.effectiveTo ?? '9999-12-31');

/**
 * A window is valid when it ends after it starts, has at least one lane, and no other window of the same pool uses
 * one of its lanes at an overlapping time on the same weekday while both are in effect. Two windows on the same lane
 * with different gender restrictions would be a contradiction, and the same restriction is a duplicate.
 */
export function validateWindow(w: WindowInput, existing: readonly WindowInput[]): WindowError[] {
  const errors: WindowError[] = [];
  if (toMinutes(w.endsAt) <= toMinutes(w.startsAt))
    errors.push({ code: 'venues.errors.endBeforeStart' });
  if (w.effectiveTo !== null && w.effectiveTo <= w.effectiveFrom)
    errors.push({ code: 'venues.errors.datesReversed' });
  if (w.laneIds.length === 0) errors.push({ code: 'venues.errors.noLanes' });
  for (const other of existing) {
    if (other.id === w.id || other.poolId !== w.poolId || other.weekday !== w.weekday) continue;
    const timeOverlap =
      toMinutes(w.startsAt) < toMinutes(other.endsAt) &&
      toMinutes(other.startsAt) < toMinutes(w.endsAt);
    if (!timeOverlap || !datesOverlap(w, other)) continue;
    const shared = w.laneIds.filter((l) => other.laneIds.includes(l));
    if (shared.length > 0)
      errors.push({
        code: 'venues.errors.laneOverlap',
        windowId: other.id as string,
        laneIds: shared,
      });
  }
  return errors;
}

/** Windows grouped by weekday (Sunday first, as the Israeli week runs) and sorted by start time, for the week view. */
export function weekGrid<T extends Pick<WindowInput, 'weekday' | 'startsAt'>>(
  windows: readonly T[],
): T[][] {
  const days: T[][] = [[], [], [], [], [], [], []];
  for (const w of windows) days[w.weekday]?.push(w);
  for (const d of days) d.sort((a, b) => toMinutes(a.startsAt) - toMinutes(b.startsAt));
  return days;
}
