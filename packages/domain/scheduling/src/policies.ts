/**
 * Pure scheduling rules (brief §6.3): which dates a group meets, whether a child may join a group, whether a group
 * fits its pool window, lanes and instructor, how well a placement fits soft preferences, and how a shift change
 * waits for the instructor. Every decision returns i18n codes with parameters, so the UI explains it in Hebrew.
 */
import {
  addDays,
  dayInfo,
  DEFAULT_CALENDAR_POLICY,
  lessonDay,
  type CalendarOverride,
  type CalendarPolicy,
  type NoLessonReason,
} from '@rswim/calendar';
import {
  windowAdmits,
  type AdmittedGender,
  type GenderRestriction,
  type PolicyRules,
  type ShiftChangeKind,
  type StaffGender,
} from '@rswim/contracts';

// ─── Small helpers ──────────────────────────────────────────────────────────

/** Minutes since midnight for "HH:MM" or "HH:MM:SS". */
export const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** "HH:MM" for minutes since midnight. */
export const fromMinutes = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const END_OF_TIME = '9999-12-31';

/** Half-open date ranges [from, to) overlap. `to` null = open-ended. */
export const datesOverlap = (
  a: { effectiveFrom: string; effectiveTo: string | null },
  b: { effectiveFrom: string; effectiveTo: string | null },
) =>
  a.effectiveFrom < (b.effectiveTo ?? END_OF_TIME) &&
  b.effectiveFrom < (a.effectiveTo ?? END_OF_TIME);

const activeOn = (v: { effectiveFrom: string; effectiveTo: string | null }, date: string) =>
  v.effectiveFrom <= date && date < (v.effectiveTo ?? END_OF_TIME);

interface TimeRange {
  weekday: number;
  startsAt: string;
  durationMin: number;
}
const timesOverlap = (a: TimeRange, b: TimeRange) => {
  const [as, bs] = [toMinutes(a.startsAt), toMinutes(b.startsAt)];
  return a.weekday === b.weekday && as < bs + b.durationMin && bs < as + a.durationMin;
};

/** Whole months between a date of birth and a date. */
export function ageInMonths(dob: string, on: string): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];
  return (oy - y) * 12 + (om - m) - (od < d ? 1 : 0);
}

export const ADULT_AGE_MONTHS = 18 * 12;

// ─── Session generation ─────────────────────────────────────────────────────

export type SkipReason =
  NoLessonReason | 'venue_closure' | 'before_group_start' | 'after_group_end';

/** The calendar part of resolved PolicyRules, with the R-SWIM defaults for anything a scope leaves unset. */
export function calendarPolicyFrom(rules: PolicyRules): CalendarPolicy {
  return {
    noLessonsOn: (rules.calendar?.no_lessons_on ??
      DEFAULT_CALENDAR_POLICY.noLessonsOn) as CalendarPolicy['noLessonsOn'],
    cholHaMoed: rules.calendar?.chol_hamoed ?? DEFAULT_CALENDAR_POLICY.cholHaMoed,
  };
}

export interface GroupCalendar {
  weekday: number;
  venueId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ClosureRange {
  venueId: string;
  startsOn: string; // inclusive
  endsOn: string; // inclusive
  reason: string;
}

export interface OverrideDay extends CalendarOverride {
  venueId: string | null;
}

export interface PlannedSession {
  date: string;
  policyVersionKey: string;
}

export interface SkippedDate {
  date: string;
  reasons: SkipReason[];
  /** Holiday names, or the closure / override reason, for the report. */
  details: string[];
  policyVersionKey: string;
}

/**
 * Every date of a term on the group's weekday, split into sessions to create and dates skipped with their reasons.
 * The calendar policy is resolved per date (a new version may start mid-term). A venue-specific override beats an
 * org-wide one; a closure beats an "open" override, because the pool itself is shut.
 */
export function planSessions(
  group: GroupCalendar,
  term: { startsOn: string; endsOn: string },
  policyFor: (date: string) => { calendar: CalendarPolicy; versionKey: string },
  closures: readonly ClosureRange[],
  overrides: readonly OverrideDay[],
): { sessions: PlannedSession[]; skipped: SkippedDate[] } {
  const sessions: PlannedSession[] = [];
  const skipped: SkippedDate[] = [];
  let date = term.startsOn;
  while (dayInfo(date).weekday !== group.weekday) date = addDays(date, 1);
  for (; date <= term.endsOn; date = addDays(date, 7)) {
    const { calendar, versionKey } = policyFor(date);
    if (date < group.effectiveFrom) {
      skipped.push({
        date,
        reasons: ['before_group_start'],
        details: [],
        policyVersionKey: versionKey,
      });
      continue;
    }
    if (group.effectiveTo !== null && date >= group.effectiveTo) {
      skipped.push({
        date,
        reasons: ['after_group_end'],
        details: [],
        policyVersionKey: versionKey,
      });
      continue;
    }
    const closure = closures.find(
      (c) => c.venueId === group.venueId && c.startsOn <= date && date <= c.endsOn,
    );
    if (closure) {
      skipped.push({
        date,
        reasons: ['venue_closure'],
        details: [closure.reason],
        policyVersionKey: versionKey,
      });
      continue;
    }
    const relevant = overrides
      .filter((o) => o.date === date && (o.venueId === null || o.venueId === group.venueId))
      .sort((a, b) => Number(b.venueId !== null) - Number(a.venueId !== null));
    const decision = lessonDay(date, calendar, relevant.slice(0, 1));
    if (decision.lessons) {
      sessions.push({ date, policyVersionKey: versionKey });
    } else {
      skipped.push({
        date,
        reasons: decision.reasons,
        details: decision.override
          ? [decision.override.reason]
          : dayInfo(date).holidays.map((h) => h.he),
        policyVersionKey: versionKey,
      });
    }
  }
  return { sessions, skipped };
}

// ─── Placement: may this child join this group? ─────────────────────────────

export interface PlacementStudent {
  id: string;
  firstName: string;
  gender: StaffGender | null;
  dob: string | null;
  levelOrdinal: number | null;
  requiresFemaleInstructor: boolean;
}

export interface PlacementGroup {
  id: string;
  name: string;
  weekday: number;
  startsAt: string;
  durationMin: number;
  capacity: number;
  admittedGender: AdmittedGender;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  levelMinOrdinal: number | null;
  levelMaxOrdinal: number | null;
  /** The pool window the group sits in, or null when it sits outside every window (checkTemplate reports that). */
  windowRestriction: GenderRestriction | null;
  leadGender: StaffGender | null;
  memberIds: readonly string[];
}

/** Groups the child is already in (other than the one they are leaving). */
export type OtherGroup = TimeRange & { id: string; name: string };

export type RuleIssue = { code: string; params: Record<string, string | number> };

export interface Decision {
  ok: boolean;
  /** Hard rules broken: the move is refused. */
  violations: RuleIssue[];
  /** Things to look at that do not block (missing data, near limits). */
  warnings: RuleIssue[];
}

const decision = (violations: RuleIssue[], warnings: RuleIssue[]): Decision => ({
  ok: violations.length === 0,
  violations,
  warnings,
});

/**
 * Hard rules for a child joining a group on a date (brief §6.3 constraint validation): not already there, a free
 * seat, the pool window's gender restriction, the group's own admitted gender, its age band and level range, no
 * clash with another of the child's groups, and a female instructor when the family requires one.
 */
export function checkPlacement(
  student: PlacementStudent,
  group: PlacementGroup,
  onDate: string,
  otherGroups: readonly OtherGroup[] = [],
): Decision {
  const v: RuleIssue[] = [];
  const w: RuleIssue[] = [];
  const name = student.firstName;
  if (group.memberIds.includes(student.id)) {
    return decision([{ code: 'scheduling.rules.alreadyInGroup', params: { name } }], []);
  }
  if (group.memberIds.length >= group.capacity) {
    v.push({ code: 'scheduling.rules.full', params: { capacity: group.capacity } });
  }
  const months = student.dob ? ageInMonths(student.dob, onDate) : null;
  const gender = student.gender ?? 'unknown';
  if (group.windowRestriction && group.windowRestriction !== 'mixed') {
    if (student.gender === null) {
      v.push({
        code: 'scheduling.rules.genderUnknown',
        params: { name, window: group.windowRestriction },
      });
    } else if (
      !windowAdmits(group.windowRestriction, {
        gender: student.gender,
        isAdult: months !== null && months >= ADULT_AGE_MONTHS,
      })
    ) {
      v.push({
        code: 'scheduling.rules.windowGender',
        params: { name, window: group.windowRestriction, gender },
      });
    }
  }
  if (group.admittedGender !== 'mixed' && student.gender !== group.admittedGender) {
    v.push({
      code: 'scheduling.rules.groupGender',
      params: { name, admitted: group.admittedGender, gender },
    });
  }
  if (group.ageMinMonths !== null || group.ageMaxMonths !== null) {
    if (months === null) w.push({ code: 'scheduling.rules.ageUnknown', params: { name } });
    else if (group.ageMinMonths !== null && months < group.ageMinMonths)
      v.push({
        code: 'scheduling.rules.tooYoung',
        params: { name, months, min: group.ageMinMonths },
      });
    else if (group.ageMaxMonths !== null && months > group.ageMaxMonths)
      v.push({
        code: 'scheduling.rules.tooOld',
        params: { name, months, max: group.ageMaxMonths },
      });
  }
  if (group.levelMinOrdinal !== null || group.levelMaxOrdinal !== null) {
    const lvl = student.levelOrdinal;
    if (lvl === null) w.push({ code: 'scheduling.rules.levelUnknown', params: { name } });
    else if (group.levelMinOrdinal !== null && lvl < group.levelMinOrdinal)
      v.push({ code: 'scheduling.rules.levelBelow', params: { name } });
    else if (group.levelMaxOrdinal !== null && lvl > group.levelMaxOrdinal)
      v.push({ code: 'scheduling.rules.levelAbove', params: { name } });
  }
  const clash = otherGroups.find((o) => o.id !== group.id && timesOverlap(o, group));
  if (clash) v.push({ code: 'scheduling.rules.timeClash', params: { name, group: clash.name } });
  if (student.requiresFemaleInstructor) {
    if (group.leadGender === 'male')
      v.push({ code: 'scheduling.rules.femaleInstructorRequired', params: { name } });
    else if (group.leadGender === null)
      w.push({ code: 'scheduling.rules.instructorUnknown', params: { name } });
  }
  if (v.length === 0 && group.memberIds.length + 1 === group.capacity) {
    w.push({ code: 'scheduling.rules.lastSeat', params: {} });
  }
  return decision(v, w);
}

// ─── Group (template) fit: window, lanes, instructor ────────────────────────

export interface TemplateDraft extends TimeRange {
  id?: string;
  venueId: string;
  poolId: string;
  laneIds: readonly string[];
  admittedGender: AdmittedGender;
  ageMinMonths: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  requiredInstructorGender: StaffGender | null;
  requiredSkills: readonly string[];
  leadStaffId: string | null;
}

export interface WindowRow {
  id: string;
  poolId: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  genderRestriction: GenderRestriction;
  effectiveFrom: string;
  effectiveTo: string | null;
  laneIds: readonly string[];
}

export interface OtherTemplate extends TimeRange {
  id: string;
  name: string;
  venueId: string;
  poolId: string;
  laneIds: readonly string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  leadStaffId: string | null;
}

export interface InstructorFacts {
  id: string;
  name: string;
  gender: StaffGender | null;
  status: string;
  skills: readonly string[];
  availability: readonly {
    weekday: number;
    startsAt: string;
    endsAt: string;
    venueId: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  exceptions: readonly {
    kind: 'unavailable' | 'available';
    startsOn: string;
    endsOn: string;
    startsAt: string | null;
    endsAt: string | null;
  }[];
}

export interface SchedulingRules {
  travelBufferMin: number;
  windowInstructorGender: 'match_window' | 'any_gender';
}

/** The scheduling part of resolved PolicyRules, with defaults (docs/POLICIES.md). */
export function schedulingRulesFrom(rules: PolicyRules): SchedulingRules {
  return {
    travelBufferMin: rules.scheduling?.travel_buffer_min ?? 30,
    windowInstructorGender: rules.scheduling?.window_instructor_gender ?? 'match_window',
  };
}

const femaleWindows: readonly GenderRestriction[] = ['female', 'women', 'girls'];
const maleWindows: readonly GenderRestriction[] = ['male', 'men', 'boys'];

/** The gender a window requires of the people in the water, or null for mixed. */
export const windowGender = (r: GenderRestriction): StaffGender | null =>
  femaleWindows.includes(r) ? 'female' : maleWindows.includes(r) ? 'male' : null;

/** The window that holds the whole group (time, lanes, and in effect when the group starts), if any. */
export function windowFor(
  t: Pick<
    TemplateDraft,
    'poolId' | 'weekday' | 'startsAt' | 'durationMin' | 'laneIds' | 'effectiveFrom'
  >,
  windows: readonly WindowRow[],
): WindowRow | null {
  const start = toMinutes(t.startsAt);
  return (
    windows.find(
      (w) =>
        w.poolId === t.poolId &&
        w.weekday === t.weekday &&
        toMinutes(w.startsAt) <= start &&
        start + t.durationMin <= toMinutes(w.endsAt) &&
        activeOn(w, t.effectiveFrom) &&
        t.laneIds.every((l) => w.laneIds.includes(l)),
    ) ?? null
  );
}

/**
 * Hard rules for a group: it sits inside one of our windows on its lanes, admits people the window admits, shares no
 * lane with another group at the same time, and its lead instructor (when set) can teach it.
 */
export function checkTemplate(
  t: TemplateDraft,
  windows: readonly WindowRow[],
  others: readonly OtherTemplate[],
  instructor: InstructorFacts | null,
  rules: SchedulingRules,
): Decision & { window: WindowRow | null } {
  const v: RuleIssue[] = [];
  const w: RuleIssue[] = [];
  if (t.laneIds.length === 0) v.push({ code: 'scheduling.rules.noLanes', params: {} });
  const window = windowFor(t, windows);
  if (!window) {
    v.push({ code: 'scheduling.rules.outsideWindow', params: {} });
  } else {
    const required = windowGender(window.genderRestriction);
    if (required && t.admittedGender !== required) {
      v.push({
        code: 'scheduling.rules.windowAdmits',
        params: { window: window.genderRestriction, admitted: t.admittedGender },
      });
    }
    if (window.effectiveTo !== null && (t.effectiveTo ?? END_OF_TIME) > window.effectiveTo) {
      w.push({ code: 'scheduling.rules.windowEnds', params: { date: window.effectiveTo } });
    }
  }
  const live = others.filter((o) => o.id !== t.id && datesOverlap(o, t) && timesOverlap(o, t));
  for (const o of live) {
    if (o.poolId === t.poolId && o.laneIds.some((l) => t.laneIds.includes(l))) {
      v.push({ code: 'scheduling.rules.laneTaken', params: { group: o.name } });
    }
  }
  if (instructor) {
    const issues = checkInstructor(t, instructor, others, rules, window);
    v.push(...issues.violations);
    w.push(...issues.warnings);
  }
  return { ...decision(v, w), window };
}

/**
 * Can this instructor lead this group? Active, of the gender the group (or, per policy, the window) requires, with
 * the skills, available every week at that time and venue, not teaching elsewhere at the same time, and with enough
 * travel time from a group at another venue on the same day. With `onDate`, one-off exceptions count too.
 */
export function checkInstructor(
  t: TemplateDraft,
  instructor: InstructorFacts,
  others: readonly OtherTemplate[],
  rules: SchedulingRules,
  window: WindowRow | null,
  onDate?: string,
): Decision {
  const v: RuleIssue[] = [];
  const name = instructor.name;
  if (instructor.status !== 'active')
    v.push({ code: 'scheduling.rules.instructorInactive', params: { name } });
  if (t.requiredInstructorGender && instructor.gender !== t.requiredInstructorGender) {
    v.push({
      code: 'scheduling.rules.instructorGender',
      params: { name, required: t.requiredInstructorGender },
    });
  }
  const windowRequires = window ? windowGender(window.genderRestriction) : null;
  if (
    rules.windowInstructorGender === 'match_window' &&
    windowRequires &&
    instructor.gender !== windowRequires &&
    t.requiredInstructorGender !== windowRequires
  ) {
    v.push({
      code: 'scheduling.rules.windowInstructorGender',
      params: { name, window: (window as WindowRow).genderRestriction },
    });
  }
  const missing = t.requiredSkills.filter((s) => !instructor.skills.includes(s));
  if (missing.length)
    v.push({
      code: 'scheduling.rules.instructorSkills',
      params: { name, count: missing.length, skills: missing.join(', ') },
    });
  const start = toMinutes(t.startsAt);
  const end = start + t.durationMin;
  const day = onDate ?? t.effectiveFrom;
  const weekly = instructor.availability.some(
    (a) =>
      a.weekday === t.weekday &&
      (a.venueId === null || a.venueId === t.venueId) &&
      toMinutes(a.startsAt) <= start &&
      end <= toMinutes(a.endsAt) &&
      activeOn(a, day),
  );
  const coversTime = (e: InstructorFacts['exceptions'][number]) =>
    e.startsAt === null || (toMinutes(e.startsAt) < end && start < toMinutes(e.endsAt as string));
  const todays = onDate
    ? instructor.exceptions.filter(
        (e) => e.startsOn <= onDate && onDate <= e.endsOn && coversTime(e),
      )
    : [];
  const off = todays.some((e) => e.kind === 'unavailable');
  const extra = todays.some((e) => e.kind === 'available');
  if (off) v.push({ code: 'scheduling.rules.instructorAway', params: { name } });
  else if (!weekly && !extra)
    v.push({ code: 'scheduling.rules.instructorUnavailable', params: { name } });
  for (const o of others) {
    if (o.id === t.id || o.leadStaffId !== instructor.id || !datesOverlap(o, t)) continue;
    if (timesOverlap(o, t)) {
      v.push({ code: 'scheduling.rules.instructorBusy', params: { name, group: o.name } });
    } else if (o.weekday === t.weekday && o.venueId !== t.venueId) {
      const oStart = toMinutes(o.startsAt);
      const gap = oStart >= end ? oStart - end : start - (oStart + o.durationMin);
      if (gap < rules.travelBufferMin) {
        v.push({
          code: 'scheduling.rules.travelBuffer',
          params: { name, group: o.name, minutes: rules.travelBufferMin },
        });
      }
    }
  }
  return decision(v, []);
}

// ─── Soft scoring ───────────────────────────────────────────────────────────

/**
 * Tuning weights, not business rules: they only order suggestions and never block anything (DECISIONS 2026-10-02).
 */
export const SCORE_WEIGHTS = {
  levelSame: 3,
  levelNear: 1,
  levelFar: -2,
  siblingsParallel: 3,
  siblingsSequential: 2,
  siblingsApart: -1,
  friendInGroup: 2,
  preferredInstructor: 2,
  weekdayPreferred: 2,
  weekdayNotPreferred: -2,
  timePreferred: 1,
  timeNotPreferred: -1,
  emptyGroup: -1,
} as const;

/** Siblings back to back within this many minutes count as "sequential". */
export const SEQUENTIAL_GAP_MIN = 15;

export interface ScoreInput {
  student: {
    levelOrdinal: number | null;
    preferredStaffId: string | null;
    friendIds: readonly string[];
    preference?: {
      weekdays: readonly number[];
      earliestAt: string | null;
      latestAt: string | null;
    };
  };
  group: TimeRange & {
    venueId: string;
    leadStaffId: string | null;
    memberIds: readonly string[];
    memberLevelOrdinals: readonly number[];
  };
  /** Groups the child's siblings are in. */
  siblingGroups: readonly (TimeRange & { venueId: string })[];
}

export interface Score {
  points: number;
  reasons: { code: string; points: number }[];
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Soft preferences (brief §6.3): higher is better. Each point comes with the reason that earned or cost it. */
export function scorePlacement(input: ScoreInput): Score {
  const { student, group, siblingGroups } = input;
  const reasons: Score['reasons'] = [];
  const add = (code: keyof typeof SCORE_WEIGHTS) =>
    reasons.push({ code: `scheduling.score.${code}`, points: SCORE_WEIGHTS[code] });

  if (group.memberIds.length === 0) add('emptyGroup');
  if (student.levelOrdinal !== null && group.memberLevelOrdinals.length > 0) {
    const gap = Math.abs(student.levelOrdinal - median(group.memberLevelOrdinals));
    add(gap === 0 ? 'levelSame' : gap <= 1 ? 'levelNear' : 'levelFar');
  }
  if (siblingGroups.length > 0) {
    const start = toMinutes(group.startsAt);
    const end = start + group.durationMin;
    const together = siblingGroups.some(
      (s) => s.venueId === group.venueId && timesOverlap(s, group),
    );
    const backToBack = siblingGroups.some((s) => {
      if (s.venueId !== group.venueId || s.weekday !== group.weekday) return false;
      const sStart = toMinutes(s.startsAt);
      const gap = sStart >= end ? sStart - end : start - (sStart + s.durationMin);
      return gap <= SEQUENTIAL_GAP_MIN;
    });
    add(together ? 'siblingsParallel' : backToBack ? 'siblingsSequential' : 'siblingsApart');
  }
  if (student.friendIds.some((f) => group.memberIds.includes(f))) add('friendInGroup');
  if (student.preferredStaffId !== null && student.preferredStaffId === group.leadStaffId) {
    add('preferredInstructor');
  }
  const pref = student.preference;
  if (pref) {
    if (pref.weekdays.length > 0) {
      add(pref.weekdays.includes(group.weekday) ? 'weekdayPreferred' : 'weekdayNotPreferred');
    }
    if (pref.earliestAt !== null || pref.latestAt !== null) {
      const start = toMinutes(group.startsAt);
      const fits =
        (pref.earliestAt === null || start >= toMinutes(pref.earliestAt)) &&
        (pref.latestAt === null || start + group.durationMin <= toMinutes(pref.latestAt));
      add(fits ? 'timePreferred' : 'timeNotPreferred');
    }
  }
  return { points: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

// ─── Change protection ──────────────────────────────────────────────────────

export interface ShiftChangeFacts {
  kind: ShiftChangeKind;
  /** Current lead of the group or session. */
  currentStaffId: string | null;
  /** New lead, for reassignments. */
  toStaffId: string | null;
  /** Staff member asking, when an instructor asks for their own change (e.g. a swap); null for the office. */
  requestedByStaffId: string | null;
  requestedAt: Date;
  requiresAcceptance: boolean;
  escalateAfterHours: number;
}

export type ShiftChangePlan =
  | { ok: true; respondentStaffId: string; needsAcceptance: boolean; escalateAt: Date | null }
  | { ok: false; code: string };

/**
 * The change-protection rule (brief §6.3): a change waits for the instructor it lands on. Reassignments wait for the
 * new instructor, a time change for the current one. Nobody waits for their own request, and the policy may turn
 * acceptance off. Unanswered changes escalate to the owner after the configured hours.
 */
export function planShiftChange(input: ShiftChangeFacts): ShiftChangePlan {
  const respondent = input.kind === 'reschedule_session' ? input.currentStaffId : input.toStaffId;
  if (respondent === null) return { ok: false, code: 'scheduling.shift.noInstructor' };
  if (input.kind !== 'reschedule_session' && input.toStaffId === input.currentStaffId) {
    return { ok: false, code: 'scheduling.shift.sameInstructor' };
  }
  const needsAcceptance = input.requiresAcceptance && input.requestedByStaffId !== respondent;
  return {
    ok: true,
    respondentStaffId: respondent,
    needsAcceptance,
    escalateAt: needsAcceptance
      ? new Date(input.requestedAt.getTime() + input.escalateAfterHours * 3_600_000)
      : null,
  };
}

/** The staffing part of resolved PolicyRules, with defaults. */
export function staffingRulesFrom(rules: PolicyRules) {
  return {
    requiresAcceptance: rules.staffing?.shift_change_requires_acceptance ?? true,
    escalateAfterHours: rules.staffing?.shift_change_escalate_after_hours ?? 12,
    substituteWaveSize: rules.staffing?.substitute_wave_size ?? 3,
    substituteWaveMinutes: rules.staffing?.substitute_wave_minutes ?? 30,
  };
}

// ─── Waitlist clusters ──────────────────────────────────────────────────────

export interface WaitingChild {
  id: string;
  programId: string;
  venueId: string | null;
  preferredWeekdays: readonly number[];
  earliestAt: string | null;
  ageMonths: number | null;
}

export interface Cluster {
  programId: string;
  venueId: string | null;
  weekday: number;
  /** Start of the hour families asked for, "16:00", or null when they did not say. */
  hour: string | null;
  ageFromYears: number | null;
  ageToYears: number | null;
  entryIds: string[];
}

/** Two-year age bands (1–2, 3–4, 5–6 …); babies under one are their own band. */
export function ageBand(months: number | null): [number, number] | [null, null] {
  if (months === null) return [null, null];
  const years = Math.floor(months / 12);
  if (years < 1) return [0, 0];
  const from = years % 2 === 1 ? years : years - 1;
  return [from, from + 1];
}

/**
 * "8 kids aged 3–4 waiting for Sunday 16:00 at Har Homa → open a group?" (brief §6.1). Children who named several
 * weekdays count for each; children who named none are left out (there is no day to suggest).
 */
export function waitlistClusters(entries: readonly WaitingChild[], minWaiting: number): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const e of entries) {
    const [from, to] = ageBand(e.ageMonths);
    const hour =
      e.earliestAt === null ? null : fromMinutes(Math.floor(toMinutes(e.earliestAt) / 60) * 60);
    for (const weekday of e.preferredWeekdays) {
      const key = [e.programId, e.venueId, weekday, hour, from].join('|');
      const c = map.get(key) ?? {
        programId: e.programId,
        venueId: e.venueId,
        weekday,
        hour,
        ageFromYears: from,
        ageToYears: to,
        entryIds: [],
      };
      c.entryIds.push(e.id);
      map.set(key, c);
    }
  }
  return [...map.values()]
    .filter((c) => c.entryIds.length >= minWaiting)
    .sort((a, b) => b.entryIds.length - a.entryIds.length || a.weekday - b.weekday);
}

// ─── Substitutes ────────────────────────────────────────────────────────────

/** One possible substitute for a lesson, with the hard checks already decided. */
export interface SubstituteCandidate {
  staffId: string;
  name: string;
  /** Violations from `checkInstructor` on the lesson's date and time (gender, skills, availability, travel). */
  violations: readonly RuleIssue[];
  /** Holds a valid swim-instructor certificate on the lesson's date. */
  certified: boolean;
  /** Already on another lesson that overlaps this one. */
  busy: boolean;
  /** Has taught this group before (the children know them). */
  knowsGroup: boolean;
  /** Teaches at the same venue that day (no extra trip). */
  atVenueThatDay: boolean;
  /** Lessons this week so far (spread the load). */
  lessonsThisWeek: number;
}

export interface RankedSubstitute {
  staffId: string;
  rank: number;
  wave: number;
  reasons: string[];
}

/**
 * Who to ask, in order (brief §6.8): only qualified, available, gender-appropriate instructors who are free then;
 * first those the group knows, then those already at the venue that day, then the least loaded this week, then by
 * name. Candidates go out in waves of `waveSize`.
 */
export function rankSubstitutes(
  candidates: readonly SubstituteCandidate[],
  waveSize: number,
): RankedSubstitute[] {
  const size = Math.max(1, waveSize);
  return candidates
    .filter((c) => c.certified && !c.busy && c.violations.length === 0)
    .map((c) => ({
      c,
      score:
        (c.knowsGroup ? 100 : 0) + (c.atVenueThatDay ? 10 : 0) - Math.min(c.lessonsThisWeek, 9),
    }))
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, 'he'))
    .map(({ c }, i) => ({
      staffId: c.staffId,
      rank: i + 1,
      wave: Math.floor(i / size) + 1,
      reasons: [
        ...(c.knowsGroup ? ['knowsGroup'] : []),
        ...(c.atVenueThatDay ? ['atVenueThatDay'] : []),
        `load:${c.lessonsThisWeek}`,
      ],
    }));
}

/** Why a candidate was left out, for the owner's view: the first hard reason, or null when they are offered. */
export function substituteExclusion(c: SubstituteCandidate): string | null {
  if (!c.certified) return 'scheduling.substitute.notCertified';
  if (c.busy) return 'scheduling.substitute.busy';
  return c.violations[0]?.code ?? null;
}

// ─── Staffing gaps ──────────────────────────────────────────────────────────

export interface LessonSlot {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  venueId: string;
  startsAt: string;
  endsAt: string;
  groupName: string;
  hasLead: boolean;
}

export interface StaffingGap {
  venueId: string;
  weekday: number;
  from: string;
  to: string;
  dates: string[];
  groups: string[];
}

/**
 * "Efrat Sunday 16:00–19:00 has no instructor for next month" (brief §6.8): lessons without a lead instructor,
 * merged per venue and weekday into continuous stretches of the afternoon (back-to-back or overlapping lessons join).
 */
export function staffingGaps(lessons: readonly LessonSlot[]): StaffingGap[] {
  const open = lessons.filter((l) => !l.hasLead);
  const byDay = new Map<string, LessonSlot[]>();
  for (const l of open) {
    const key = `${l.venueId}|${l.weekday}`;
    byDay.set(key, [...(byDay.get(key) ?? []), l]);
  }
  const gaps: StaffingGap[] = [];
  for (const list of byDay.values()) {
    list.sort((a, b) => toMinutes(a.startsAt) - toMinutes(b.startsAt));
    let cur: StaffingGap | null = null;
    for (const l of list) {
      if (cur && toMinutes(l.startsAt) <= toMinutes(cur.to)) {
        if (toMinutes(l.endsAt) > toMinutes(cur.to)) cur.to = l.endsAt;
      } else {
        cur = {
          venueId: l.venueId,
          weekday: l.weekday,
          from: l.startsAt,
          to: l.endsAt,
          dates: [],
          groups: [],
        };
        gaps.push(cur);
      }
      if (!cur.dates.includes(l.date)) cur.dates.push(l.date);
      if (!cur.groups.includes(l.groupName)) cur.groups.push(l.groupName);
    }
  }
  for (const g of gaps) g.dates.sort();
  return gaps.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      toMinutes(a.from) - toMinutes(b.from) ||
      a.venueId.localeCompare(b.venueId),
  );
}

// ─── Course and camp cohorts (brief §6.11) ──────────────────────────────────

export interface CohortRules {
  /** A camp takes at most this many children per staff member (instructors and counselors). */
  childrenPerStaff: number;
}

export function cohortRulesFrom(rules: PolicyRules): CohortRules {
  return { childrenPerStaff: rules.camp?.children_per_staff ?? 8 };
}

export interface CohortFacts {
  status: 'open' | 'closed' | 'cancelled';
  startsOn: string;
  endsOn: string;
  capacity: number;
  registrationClosesOn: string | null;
  /** Camps keep a staff ratio; courses do not. */
  isCamp: boolean;
  groups: number;
  registered: number;
  staff: number;
}

export type CohortDecision =
  { ok: true } | { ok: false; code: string; params: RuleIssue['params'] };
const cohortRefusal = (code: string, params: RuleIssue['params'] = {}): CohortDecision => ({
  ok: false,
  code: `scheduling.cohort.${code}`,
  params,
});

/**
 * Whether one more child may register: the cohort is open and has its groups, registration has not closed (its own
 * date, else the cohort's last day), there is a seat, and a camp keeps its staff ratio with one more child.
 */
export function cohortRegistrationCheck(
  c: CohortFacts,
  today: string,
  rules: CohortRules,
): CohortDecision {
  if (c.status !== 'open') return cohortRefusal(c.status);
  if (c.groups === 0) return cohortRefusal('noGroups');
  if (today > (c.registrationClosesOn ?? c.endsOn)) return cohortRefusal('registrationOver');
  if (c.registered >= c.capacity) return cohortRefusal('full', { capacity: c.capacity });
  const ratio = cohortRatio({ ...c, registered: c.registered + 1 }, rules);
  if (ratio.short) return cohortRefusal('ratio', ratio.explanation.params);
  return { ok: true };
}

export interface CohortRatio {
  /** Staff the registered children need (camps only; 0 for a course). */
  needed: number;
  /** Children the current staff can take (null for a course). */
  max: number | null;
  short: boolean;
  explanation: RuleIssue;
}

/** A camp's staff ratio: how many staff its children need, and whether it has them. */
export function cohortRatio(c: CohortFacts, rules: CohortRules): CohortRatio {
  if (!c.isCamp) {
    return {
      needed: 0,
      max: null,
      short: false,
      explanation: { code: 'scheduling.cohort.noRatio', params: {} },
    };
  }
  const needed = Math.ceil(c.registered / rules.childrenPerStaff);
  const max = c.staff * rules.childrenPerStaff;
  const short = c.staff < needed;
  return {
    needed,
    max,
    short,
    explanation: {
      code: short ? 'scheduling.cohort.ratioShort' : 'scheduling.cohort.ratioOk',
      params: { staff: c.staff, needed, ratio: rules.childrenPerStaff, max },
    },
  };
}
