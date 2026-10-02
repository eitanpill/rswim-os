/**
 * Pure attendance and makeup rules (brief §6.4–6.5, docs/POLICIES.md §4–6): how an absence notice is classified,
 * whether it earns a makeup credit and until when, how a late arrival counts, what a closure does, which sessions a
 * credit may be spent in, and the closure's uptake report. Every decision returns i18n codes with parameters, so the
 * UI explains it in Hebrew, and the caller stores the policy version that decided it.
 */
import {
  windowAdmits,
  type AbsenceClassification,
  type AdmittedGender,
  type AttendanceStatus,
  type ClosureEndRule,
  type ClosureSource,
  type CreditReason,
  type CreditStatus,
  type GenderRestriction,
  type MakeupBookingStatus,
  type MakeupGuarantee,
  type PolicyRules,
  type StaffGender,
} from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `attendance.decision.${code}`,
  params,
});

// ─── Rules with defaults ────────────────────────────────────────────────────

export interface AttendanceRules {
  noticeMinHours: number;
  timelyEarnsMakeup: boolean;
  makeupsEnabled: boolean;
  maxPerMonth: number;
  expiry: 'end_of_source_month' | 'end_of_next_month' | 'event_deadline';
  requiresActiveSubscription: boolean;
  selfBooking: boolean;
  levelTolerance: number;
  enforcement: 'strict_with_override' | 'soft';
  lateThresholdMin: number;
  schoolMakeup: MakeupGuarantee;
  externalMakeup: MakeupGuarantee;
  eventEndRule: ClosureEndRule;
  capBypass: boolean;
}

/** The attendance part of resolved PolicyRules, with the documented defaults (docs/POLICIES.md). */
export function attendanceRulesFrom(rules: PolicyRules): AttendanceRules {
  return {
    noticeMinHours: rules.absence?.notice_min_hours ?? 12,
    timelyEarnsMakeup: rules.absence?.timely_earns_makeup ?? true,
    makeupsEnabled: rules.makeup?.enabled ?? true,
    maxPerMonth: rules.makeup?.max_per_month ?? 1,
    expiry: rules.makeup?.expiry ?? 'end_of_source_month',
    requiresActiveSubscription: rules.makeup?.requires_active_subscription ?? true,
    selfBooking: rules.makeup?.self_booking ?? true,
    levelTolerance: rules.makeup?.level_tolerance ?? 1,
    enforcement: rules.makeup?.enforcement ?? 'strict_with_override',
    lateThresholdMin: rules.attendance?.late_threshold_min ?? 10,
    schoolMakeup: rules.closure?.school_makeup ?? 'guaranteed',
    externalMakeup: rules.closure?.external_makeup ?? 'best_effort',
    eventEndRule: rules.closure?.event_end_rule ?? 'expire',
    capBypass: rules.closure?.makeup_cap_bypass ?? true,
  };
}

// ─── Dates (local YYYY-MM-DD) ───────────────────────────────────────────────

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Last day of the month `offset` months after the date's month. */
export function endOfMonth(date: string, offset = 0): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + offset;
  const [yy, mm] = [Math.floor(total / 12), (total % 12) + 1];
  return `${yy}-${String(mm).padStart(2, '0')}-${String(daysInMonth(yy, mm)).padStart(2, '0')}`;
}

/** "YYYY-MM" of a date: the calendar month the monthly cap counts in. */
export const monthOf = (date: string) => date.slice(0, 7);

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// ─── Absence notices ────────────────────────────────────────────────────────

export interface NoticeDecision {
  classification: AbsenceClassification;
  /** Whole minutes from receipt to the lesson's start; negative after it started. */
  minutesBefore: number;
  explanation: Explanation;
}

/**
 * Timely when the notice arrived at least `absence.notice_min_hours` before the lesson started (≥, so 12h00 before a
 * 12-hour rule is timely). Both are instants: the clock change between them does not matter.
 */
export function classifyAbsenceNotice(
  notice: { receivedAt: Date; startsAt: Date },
  rules: Pick<AttendanceRules, 'noticeMinHours'>,
): NoticeDecision {
  const minutesBefore = Math.floor(
    (notice.startsAt.getTime() - notice.receivedAt.getTime()) / 60_000,
  );
  const params = {
    hours: Math.floor(Math.abs(minutesBefore) / 60),
    minutes: Math.abs(minutesBefore) % 60,
    min: rules.noticeMinHours,
  };
  if (minutesBefore < 0) {
    return {
      classification: 'late_notice',
      minutesBefore,
      explanation: explain('afterStart', params),
    };
  }
  if (minutesBefore >= rules.noticeMinHours * 60) {
    return { classification: 'timely', minutesBefore, explanation: explain('timely', params) };
  }
  return {
    classification: 'late_notice',
    minutesBefore,
    explanation: explain('lateNotice', params),
  };
}

export interface EarnDecision {
  earns: boolean;
  explanation: Explanation;
}

/**
 * Whether a classified notice earns a makeup credit: makeups must be on for the program, the notice timely, the
 * regulations must grant makeups for timely notices, and the child must be under the monthly cap
 * (`creditsThisMonth` counts the credits in the lesson's month that count toward it).
 */
export function canEarnMakeup(
  input: { classification: AbsenceClassification; creditsThisMonth: number },
  rules: Pick<AttendanceRules, 'makeupsEnabled' | 'timelyEarnsMakeup' | 'maxPerMonth'>,
): EarnDecision {
  if (!rules.makeupsEnabled) return { earns: false, explanation: explain('makeupsOff') };
  if (input.classification === 'late_notice') {
    return { earns: false, explanation: explain('lateNoMakeup') };
  }
  if (!rules.timelyEarnsMakeup) return { earns: false, explanation: explain('timelyNoMakeup') };
  if (input.creditsThisMonth >= rules.maxPerMonth) {
    return { earns: false, explanation: explain('monthlyCap', { max: rules.maxPerMonth }) };
  }
  return { earns: true, explanation: explain('creditIssued') };
}

/** The last day a credit can be used (local date). `event_deadline` without an event falls back to the month's end. */
export function makeupExpiry(
  sourceDate: string,
  rule: AttendanceRules['expiry'],
  eventDeadline: string | null = null,
): string {
  if (rule === 'end_of_next_month') return endOfMonth(sourceDate, 1);
  if (rule === 'event_deadline' && eventDeadline) return eventDeadline;
  return endOfMonth(sourceDate);
}

// ─── Attendance ─────────────────────────────────────────────────────────────

/** Late up to `attendance.late_threshold_min` still attended; later than that counts as an absence. */
export function attendanceStatusForArrival(
  minutesLate: number | null,
  rules: Pick<AttendanceRules, 'lateThresholdMin'>,
): { status: AttendanceStatus; explanation: Explanation } {
  if (minutesLate === null || minutesLate <= 0) {
    return { status: 'present', explanation: explain('present') };
  }
  const params = { minutes: minutesLate, max: rules.lateThresholdMin };
  if (minutesLate <= rules.lateThresholdMin) {
    return { status: 'late', explanation: explain('late', params) };
  }
  return { status: 'absent', explanation: explain('tooLate', params) };
}

// ─── Closures ───────────────────────────────────────────────────────────────

export interface ClosureTreatment {
  sessionStatus: 'cancelled_by_school' | 'cancelled_external';
  creditReason: Extract<CreditReason, 'school_cancellation' | 'external_closure'>;
  guarantee: MakeupGuarantee;
  issuesCredits: boolean;
  countsTowardCap: boolean;
  endRule: ClosureEndRule;
  explanation: Explanation;
}

/**
 * What a closure does under the regulations: the school's own cancellations (and holidays it declares) guarantee a
 * makeup; external ones (venue, authorities, technical, water quality) offer one on a best-effort basis. Closure
 * credits skip the monthly cap when `closure.makeup_cap_bypass` is on.
 */
export function closureTreatment(source: ClosureSource, rules: AttendanceRules): ClosureTreatment {
  const bySchool = source === 'school' || source === 'holiday';
  const guarantee = bySchool ? rules.schoolMakeup : rules.externalMakeup;
  return {
    sessionStatus: bySchool ? 'cancelled_by_school' : 'cancelled_external',
    creditReason: bySchool ? 'school_cancellation' : 'external_closure',
    guarantee,
    issuesCredits: guarantee !== 'none',
    countsTowardCap: !rules.capBypass,
    endRule: rules.eventEndRule,
    explanation: explain(bySchool ? 'closureBySchool' : 'closureExternal', { guarantee }),
  };
}

/** Free seats in a session; mirrors app.session_free_seats for previews. Never below zero. */
export function freeSeats(s: {
  capacity: number;
  seatHolders: number;
  notifiedAbsent: number;
  makeupGuests: number;
}): number {
  return Math.max(0, s.capacity - s.seatHolders + s.notifiedAbsent - s.makeupGuests);
}

// ─── The makeup marketplace ─────────────────────────────────────────────────

export interface MakeupStudent {
  id: string;
  firstName: string;
  gender: StaffGender | null;
  ageMonths: number | null;
  isAdult: boolean;
  levelOrdinal: number | null;
  requiresFemaleInstructor: boolean;
  /** Groups the child already holds a seat in: a makeup goes elsewhere. */
  ownTemplateIds: readonly string[];
}

export interface MakeupCredit {
  id: string;
  programId: string;
  status: CreditStatus;
  expiresOn: string;
  /** Closure credits are spent inside the event's makeup window. */
  windowFrom: string | null;
}

export interface MarketSession {
  sessionId: string;
  date: string;
  classTemplateId: string;
  programId: string;
  admittedGender: AdmittedGender;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  levelMinOrdinal: number | null;
  levelMaxOrdinal: number | null;
  windowRestriction: GenderRestriction | null;
  leadGender: StaffGender | null;
  freeSeats: number;
}

export interface MakeupFit {
  sessionId: string;
  /** Never bookable: no seat, outside the credit's life, another program, the child's own group. */
  hard: Explanation[];
  /** Bookable by the office with an override (makeup.enforcement), never by the family. */
  soft: Explanation[];
}

/** How many levels a group's range is from the child's level (0 = inside it, or either is unknown). */
export function levelDistance(
  level: number | null,
  min: number | null,
  max: number | null,
): number {
  if (level === null) return 0;
  if (min !== null && level < min) return min - level;
  if (max !== null && level > max) return level - max;
  return 0;
}

/**
 * Which sessions a credit may be spent in: same program, a free seat, between today (and the closure window's start)
 * and the credit's expiry, not the child's own group, and a group that admits the child: pool window and group
 * gender, age band, level within `makeup.level_tolerance`, and a female instructor when the family requires one.
 */
export function makeupCandidates(
  student: MakeupStudent,
  credit: MakeupCredit,
  sessions: readonly MarketSession[],
  rules: Pick<AttendanceRules, 'levelTolerance'>,
  today: string,
): MakeupFit[] {
  const from = credit.windowFrom && credit.windowFrom > today ? credit.windowFrom : today;
  const name = student.firstName;
  return sessions.map((s) => {
    const hard: Explanation[] = [];
    const soft: Explanation[] = [];
    if (s.date < from) hard.push(explain('beforeWindow', { from }));
    if (s.date > credit.expiresOn) hard.push(explain('afterExpiry', { until: credit.expiresOn }));
    if (s.programId !== credit.programId) hard.push(explain('otherProgram'));
    if (student.ownTemplateIds.includes(s.classTemplateId)) hard.push(explain('ownGroup'));
    if (s.freeSeats <= 0) hard.push(explain('noSeat'));
    if (s.windowRestriction && s.windowRestriction !== 'mixed') {
      if (student.gender === null) soft.push(explain('genderUnknown', { name }));
      else if (
        !windowAdmits(s.windowRestriction, { gender: student.gender, isAdult: student.isAdult })
      )
        hard.push(explain('windowGender', { name, window: s.windowRestriction }));
    }
    if (s.admittedGender !== 'mixed' && student.gender !== s.admittedGender) {
      hard.push(explain('groupGender', { name, admitted: s.admittedGender }));
    }
    if (student.ageMonths !== null) {
      if (s.ageMinMonths !== null && student.ageMonths < s.ageMinMonths)
        soft.push(explain('tooYoung', { name }));
      else if (s.ageMaxMonths !== null && student.ageMonths > s.ageMaxMonths)
        soft.push(explain('tooOld', { name }));
    }
    const distance = levelDistance(student.levelOrdinal, s.levelMinOrdinal, s.levelMaxOrdinal);
    if (distance > rules.levelTolerance) {
      soft.push(explain('levelApart', { name, levels: distance, max: rules.levelTolerance }));
    }
    if (student.requiresFemaleInstructor && s.leadGender === 'male') {
      hard.push(explain('femaleInstructorRequired', { name }));
    }
    return { sessionId: s.sessionId, hard, soft };
  });
}

export interface BookingDecision {
  ok: boolean;
  violations: Explanation[];
  /** Soft rules the office booked past, kept with the booking. */
  overridden: Explanation[];
}

/**
 * Whether this actor may book this fit now. The family books only clean fits, and only when `makeup.self_booking` is
 * on. The office may book past soft rules (and a missing active enrollment) with an override note when
 * `makeup.enforcement` is `strict_with_override`; with `soft`, soft rules never block anyone.
 */
export function canBookMakeup(
  input: {
    actor: 'family' | 'office';
    credit: Pick<MakeupCredit, 'status'>;
    fit: MakeupFit;
    hasActiveEnrollment: boolean;
    overrideNote: string | null;
  },
  rules: Pick<AttendanceRules, 'selfBooking' | 'requiresActiveSubscription' | 'enforcement'>,
): BookingDecision {
  const hard = [...input.fit.hard];
  if (input.credit.status !== 'open') hard.unshift(explain('creditNotOpen'));
  if (input.actor === 'family' && !rules.selfBooking) hard.unshift(explain('selfBookingOff'));
  const soft = [...input.fit.soft];
  if (rules.requiresActiveSubscription && !input.hasActiveEnrollment) {
    soft.push(explain('noActiveEnrollment'));
  }
  if (hard.length > 0) return { ok: false, violations: hard, overridden: [] };
  if (soft.length === 0 || rules.enforcement === 'soft') {
    return { ok: true, violations: [], overridden: soft };
  }
  if (input.actor === 'office' && input.overrideNote) {
    return { ok: true, violations: [], overridden: soft };
  }
  return {
    ok: false,
    violations: input.actor === 'office' ? [...soft, explain('overrideNeeded')] : soft,
    overridden: [],
  };
}

// ─── Closure report and end ─────────────────────────────────────────────────

export interface UptakeCredit {
  id: string;
  groupId: string;
  groupName: string;
  status: CreditStatus;
  /** The credit's live booking, if any. */
  bookingStatus: MakeupBookingStatus | null;
}

export interface UptakeRow {
  groupId: string;
  groupName: string;
  issued: number;
  booked: number;
  used: number;
  missed: number;
  expired: number;
  converted: number;
  outstanding: number;
}

const emptyRow = (groupId: string, groupName: string): UptakeRow => ({
  groupId,
  groupName,
  issued: 0,
  booked: 0,
  used: 0,
  missed: 0,
  expired: 0,
  converted: 0,
  outstanding: 0,
});

/** Per group and in total: credits issued and where each one is now. Voided credits are not counted. */
export function uptakeReport(credits: readonly UptakeCredit[]): {
  rows: UptakeRow[];
  total: UptakeRow;
} {
  const rows = new Map<string, UptakeRow>();
  const total = emptyRow('', '');
  for (const c of credits) {
    if (c.status === 'void') continue;
    const row = rows.get(c.groupId) ?? emptyRow(c.groupId, c.groupName);
    rows.set(c.groupId, row);
    const bucket: keyof UptakeRow =
      c.status === 'open'
        ? 'outstanding'
        : c.status === 'booked'
          ? 'booked'
          : c.status === 'used'
            ? c.bookingStatus === 'missed'
              ? 'missed'
              : 'used'
            : c.status;
    for (const r of [row, total]) {
      r.issued += 1;
      r[bucket] += 1;
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, 'he')),
    total,
  };
}

/**
 * What closing an event does to its credits: open ones expire, or are converted into money (Phase 4 ledger) under
 * `convert_to_credit` / `partial_refund`. Booked credits stay so the lesson still happens; the rest are settled.
 */
export function closureEndActions(
  credits: readonly { id: string; status: CreditStatus }[],
  endRule: ClosureEndRule,
): { expire: string[]; convert: string[] } {
  const open = credits.filter((c) => c.status === 'open').map((c) => c.id);
  return endRule === 'expire' ? { expire: open, convert: [] } : { expire: [], convert: open };
}
