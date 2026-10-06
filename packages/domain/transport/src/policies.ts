/**
 * Pure transport rules (brief §6.10, docs/POLICIES.md §13): the order of a run's stages, what an escort may mark on a
 * child and when, whether an event is too old to message families about, and how long the children were really in
 * the water. Every refusal is an i18n code; every summary carries its explanation.
 */
import { RUN_STAGES, type PolicyRules, type RiderMark, type RunStage } from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `transport.decision.${code}`,
  params,
});

export type Check = { ok: true } | { ok: false; code: string };
const refuse = (code: string): Check => ({ ok: false, code: `transport.errors.${code}` });
const OK: Check = { ok: true };

// ─── Rules with defaults ────────────────────────────────────────────────────

export interface TransportRules {
  /** An event older than this is recorded but not messaged (a late tap would mislead families). */
  staleAfterMin: number;
  /** In-water time this much shorter than the lesson is flagged on the run report. */
  shortWaterWarnMin: number;
}

export function transportRulesFrom(rules: PolicyRules): TransportRules {
  return {
    staleAfterMin: rules.transport?.stale_after_min ?? 30,
    shortWaterWarnMin: rules.transport?.short_water_warn_min ?? 5,
  };
}

// ─── Stages ─────────────────────────────────────────────────────────────────

const order = (s: RunStage) => RUN_STAGES.indexOf(s);

/**
 * A stage may be recorded once, and never after a later stage (the run moves forward). "Out of the water" needs "in
 * the water" first; the other stages may be skipped (an escort who forgot to tap one keeps going).
 */
export function stageCheck(recorded: readonly RunStage[], stage: RunStage): Check {
  if (recorded.includes(stage)) return refuse('stageDone');
  if (recorded.some((r) => order(r) > order(stage))) return refuse('stageOrder');
  if (stage === 'out_of_water' && !recorded.includes('in_water')) return refuse('notInWater');
  return OK;
}

/** The stage the escort taps next: the first one after the latest recorded, or null once the run is done. */
export function nextStage(recorded: readonly RunStage[]): RunStage | null {
  // "Out of the water" can only follow "in the water", so it is next only once "in" was the last tap.
  const last = Math.max(-1, ...recorded.map(order));
  return RUN_STAGES[last + 1] ?? null;
}

// ─── Children ───────────────────────────────────────────────────────────────

/**
 * What an escort may mark on a child: on board or not at the pickup until the group reaches the pool (one or the
 * other), and dropped off once the group left the pool, only if the child was on board.
 */
export function riderCheck(
  stages: readonly RunStage[],
  marks: readonly RiderMark[],
  mark: RiderMark,
): Check {
  if (marks.includes(mark)) return refuse('riderMarked');
  if (mark === 'dropped_off') {
    if (!stages.includes('left_pool')) return refuse('notLeftPool');
    if (!marks.includes('boarded')) return refuse('notBoarded');
    return OK;
  }
  if (marks.includes('boarded') || marks.includes('missing')) return refuse('riderMarked');
  if (stages.some((s) => order(s) >= order('arrived_pool'))) return refuse('pickupOver');
  return OK;
}

/** Children a stage message goes to: those on board if the escort marked any, else every rider not marked missing. */
export function onBoard(
  riders: readonly string[],
  marks: readonly { studentId: string; mark: RiderMark }[],
): string[] {
  const boarded = new Set(marks.filter((m) => m.mark === 'boarded').map((m) => m.studentId));
  const missing = new Set(marks.filter((m) => m.mark === 'missing').map((m) => m.studentId));
  return riders.filter((r) => (boarded.size > 0 ? boarded.has(r) : !missing.has(r)));
}

/** True when an event is too old to tell families about now. */
export function isStale(at: Date, now: Date, rules: TransportRules): boolean {
  return now.getTime() - at.getTime() > rules.staleAfterMin * 60_000;
}

// ─── The run's report ───────────────────────────────────────────────────────

export interface RunSummary {
  /** Minutes between "in the water" and "out of the water"; null until both are tapped. */
  inWaterMin: number | null;
  /** The lesson's length, when the run brings children to a lesson. */
  plannedMin: number | null;
  /** Minutes after the lesson's start the group reached the pool (0 when on time); null if unknown. */
  lateMin: number | null;
  /** True when in-water time fell short of the lesson by more than the rule allows. */
  short: boolean;
  explanation: Explanation;
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Answers "how much time do they really get in the water?" for one run. */
export function runSummary(
  stages: readonly { stage: RunStage; at: Date }[],
  lesson: { startsAt: Date; minutes: number } | null,
  rules: TransportRules,
): RunSummary {
  const at = (s: RunStage) => stages.find((x) => x.stage === s)?.at ?? null;
  const into = at('in_water');
  const out = at('out_of_water');
  const arrived = at('arrived_pool');
  const inWaterMin = into && out ? minutesBetween(into, out) : null;
  const plannedMin = lesson?.minutes ?? null;
  const lateMin = arrived && lesson ? Math.max(0, minutesBetween(lesson.startsAt, arrived)) : null;
  if (inWaterMin === null) {
    return {
      inWaterMin,
      plannedMin,
      lateMin,
      short: false,
      explanation: explain('waterUnknown', { late: lateMin ?? 0 }),
    };
  }
  const short = plannedMin !== null && plannedMin - inWaterMin > rules.shortWaterWarnMin;
  return {
    inWaterMin,
    plannedMin,
    lateMin,
    short,
    explanation:
      plannedMin === null
        ? explain('water', { minutes: inWaterMin })
        : short
          ? explain('waterShort', {
              minutes: inWaterMin,
              planned: plannedMin,
              late: lateMin ?? 0,
            })
          : explain('waterFull', { minutes: inWaterMin, planned: plannedMin }),
  };
}

/** Whether a route runs on a date's weekday (0 = Sunday). */
export function runsOn(weekdays: readonly number[], date: string): boolean {
  return weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}
