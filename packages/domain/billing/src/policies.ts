/**
 * Pure billing rules (brief §6.7, docs/POLICIES.md §1–2 and "Rounding & money rules"): the cancellation cut-off,
 * proration, a seat's monthly charge with freezes and cancellation, per-lesson charges, the sibling discount, the
 * pre-run review, dunning steps, how payments settle charges (ledger allocation and aging) and what an
 * invoice-receipt says. Every decision returns an i18n code with parameters, and the caller stores the policy version.
 * Money is integer agorot throughout; rounding is half-up per line and a total is the sum of rounded lines.
 */
import {
  FISCAL_TEXT_HE,
  type AnomalyKind,
  type BillingLineKind,
  type LedgerEntryType,
  type PaymentMethod,
  type PolicyRules,
} from '@rswim/contracts';
import { agorot, percentOf, ratioOf, type Agorot } from '@rswim/money';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `billing.decision.${code}`,
  params,
});

// ─── Rules with defaults ────────────────────────────────────────────────────

export interface SiblingRules {
  kind: 'percent' | 'flat';
  percentBp: number;
  flatAgorot: number;
  appliesTo: 'cheapest_first' | 'youngest_first';
}

export interface DunningRules {
  firstRetryDays: number;
  retryIntervalDays: number;
  maxRetries: number;
  escalateAfterDays: number;
  pauseEnrollment: boolean;
}

export interface BillingRules {
  methodRequired: 'standing_order' | 'any';
  runDay: number;
  cancellationCutoffDay: number;
  proration: 'per_remaining_sessions' | 'per_remaining_days' | 'none';
  prorationMinSessions: number;
  freezeCharge: 'none_while_frozen' | 'full';
  freezeRequiresApproval: boolean;
  closureCredit: 'none' | 'credit';
  annualEarlyTermination: 'pay_difference_to_monthly' | 'no_refund';
  anomalyChangeBp: number;
  noticeMinHours: number;
  sibling: SiblingRules;
  dunning: DunningRules;
}

/** The billing part of resolved PolicyRules, with the documented defaults (docs/POLICIES.md). */
export function billingRulesFrom(rules: PolicyRules): BillingRules {
  const b = rules.billing ?? {};
  const s = rules.discount?.sibling ?? {};
  const d = rules.dunning ?? {};
  return {
    methodRequired: b.method_required ?? 'standing_order',
    runDay: b.run_day ?? 1,
    cancellationCutoffDay: b.cancellation_cutoff_day ?? 25,
    proration: b.proration ?? 'per_remaining_sessions',
    prorationMinSessions: b.proration_min_sessions ?? 1,
    freezeCharge: b.freeze_charge ?? 'none_while_frozen',
    freezeRequiresApproval: b.freeze_requires_approval ?? true,
    closureCredit: b.closure_credit ?? 'none',
    annualEarlyTermination: b.annual_early_termination ?? 'pay_difference_to_monthly',
    anomalyChangeBp: b.anomaly_change_bp ?? 3000,
    noticeMinHours: rules.absence?.notice_min_hours ?? 12,
    sibling: {
      kind: s.kind ?? 'percent',
      percentBp: s.percent_bp ?? 1000,
      flatAgorot: s.flat_agorot ?? 3000,
      appliesTo: s.applies_to ?? 'cheapest_first',
    },
    dunning: {
      firstRetryDays: d.first_retry_days ?? 1,
      retryIntervalDays: d.retry_interval_days ?? 3,
      maxRetries: d.max_retries ?? 3,
      escalateAfterDays: d.escalate_after_days ?? 10,
      pauseEnrollment: d.pause_enrollment ?? false,
    },
  };
}

// ─── Dates and periods (local YYYY-MM-DD, periods YYYY-MM) ──────────────────

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "YYYY-MM" of a local date. */
export const periodOf = (date: string) => date.slice(0, 7);

export const periodStart = (period: string) => `${period}-01`;

export function daysInPeriod(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return daysIn(y, m);
}

/** Last day of the period. */
export const periodEnd = (period: string) =>
  `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`;

/** The period `n` months after this one (negative for earlier). */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The calendar date in Israel at an instant (not UTC: 23:30 UTC on the 25th is already the 26th in Jerusalem). */
export function israelDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(instant);
}

/** "3.9.2026", as dates are printed on receipts. */
export function dmy(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

// ─── Cancellation cut-off ───────────────────────────────────────────────────

export interface CancellationDecision {
  /** The last month the family pays for. */
  lastChargedPeriod: string;
  /** The first day the child no longer holds the seat (exclusive end of the enrollment). */
  endsOn: string;
  explanation: Explanation;
}

/**
 * A request on or before the cut-off day (Israel date, end of day) makes the current month the last one charged; a
 * later request charges the next month too. A cut-off past the month's last day means the last day.
 */
export function cancellationEffectiveMonth(
  requestedAt: Date,
  rules: Pick<BillingRules, 'cancellationCutoffDay'>,
): CancellationDecision {
  const date = israelDate(requestedAt);
  const period = periodOf(date);
  const cutoff = Math.min(rules.cancellationCutoffDay, daysInPeriod(period));
  const before = Number(date.slice(8, 10)) <= cutoff;
  const last = before ? period : shiftPeriod(period, 1);
  return {
    lastChargedPeriod: last,
    endsOn: periodStart(shiftPeriod(last, 1)),
    explanation: explain(before ? 'cancelBeforeCutoff' : 'cancelAfterCutoff', {
      cutoff,
      requested: dmy(date),
      last,
    }),
  };
}

// ─── Proration ──────────────────────────────────────────────────────────────

export interface ProrateInput {
  price: Agorot;
  billableSessions: number;
  totalSessions: number;
  billableDays: number;
  totalDays: number;
}

export interface Charge {
  amount: Agorot;
  explanation: Explanation;
}

/**
 * A month's price for part of a month (DECISIONS #5): price × billable sessions ÷ the month's sessions, or by days,
 * or the full price for any lesson. Fewer billable lessons than `proration_min_sessions` charge nothing (the seat
 * starts being paid next month). Never more than the price.
 */
export function prorate(
  input: ProrateInput,
  rules: Pick<BillingRules, 'proration' | 'prorationMinSessions'>,
): Charge {
  const zero = agorot(0);
  const total = input.totalSessions;
  const billable = Math.min(input.billableSessions, total);
  if (total === 0) return { amount: zero, explanation: explain('noSessions') };
  if (billable === 0) return { amount: zero, explanation: explain('noBillableSessions') };
  if (billable < rules.prorationMinSessions) {
    return {
      amount: zero,
      explanation: explain('belowMinSessions', { billable, min: rules.prorationMinSessions }),
    };
  }
  const full = { amount: input.price, explanation: explain('fullMonth', { sessions: billable }) };
  if (rules.proration === 'none') return full;
  if (rules.proration === 'per_remaining_days') {
    const days = Math.min(input.billableDays, input.totalDays);
    if (days >= input.totalDays) return full;
    return {
      amount: ratioOf(input.price, days, input.totalDays),
      explanation: explain('proratedDays', { days, total: input.totalDays }),
    };
  }
  if (billable === total) return full;
  return {
    amount: ratioOf(input.price, billable, total),
    explanation: explain('proratedSessions', { billable, total }),
  };
}

// ─── A seat's monthly charge ────────────────────────────────────────────────

export interface DateRange {
  /** Inclusive. */
  from: string;
  /** Inclusive. */
  to: string;
}

export interface SeatChargeInput {
  period: string;
  /** The month's price for the group, or null when no price list covers it. */
  price: Agorot | null;
  /** Dates of the group's lessons in the month (cancelled ones included: closures are made up, not refunded). */
  sessionDates: readonly string[];
  startsOn: string;
  /** Exclusive. */
  endsOn: string | null;
  /** Approved freezes. */
  freezes: readonly DateRange[];
  /** A cancellation request: the family pays through this month whatever the seat's end. */
  cancellation: { lastChargedPeriod: string } | null;
}

export interface SeatCharge extends Charge {
  /** The lessons the charge covers (receipts list them). */
  sessionDates: string[];
  frozenSessions: number;
  /** True when the seat should be charged but nothing says how much: the review flags it. */
  missingPrice: boolean;
}

const inRanges = (d: string, ranges: readonly DateRange[]) =>
  ranges.some((r) => r.from <= d && d <= r.to);

/** One seat for one month, under the regulations (POLICIES §1). */
export function chargeForSeat(
  input: SeatChargeInput,
  rules: Pick<BillingRules, 'proration' | 'prorationMinSessions' | 'freezeCharge'>,
): SeatCharge {
  const zero = agorot(0);
  const none = { sessionDates: [], frozenSessions: 0, missingPrice: false };
  if (input.cancellation && input.period > input.cancellation.lastChargedPeriod) {
    return {
      amount: zero,
      explanation: explain('cancelled', { last: input.cancellation.lastChargedPeriod }),
      ...none,
    };
  }
  const monthStart = periodStart(input.period);
  const afterMonth = addDays(periodEnd(input.period), 1);
  const start = input.startsOn > monthStart ? input.startsOn : monthStart;
  // Paying through a cancellation month keeps the whole month; otherwise the seat's own end counts.
  const end =
    input.cancellation || input.endsOn === null || input.endsOn > afterMonth
      ? afterMonth
      : input.endsOn;
  const freezes = rules.freezeCharge === 'none_while_frozen' ? input.freezes : [];
  const inSeat = [...input.sessionDates].sort().filter((d) => start <= d && d < end);
  const billable = inSeat.filter((d) => !inRanges(d, freezes));
  const frozenSessions = inSeat.length - billable.length;
  let billableDays = 0;
  for (let d = monthStart; d < afterMonth; d = addDays(d, 1)) {
    if (start <= d && d < end && !inRanges(d, freezes)) billableDays++;
  }
  if (inSeat.length > 0 && billable.length === 0) {
    return {
      amount: zero,
      explanation: explain('frozen', { sessions: frozenSessions }),
      ...none,
      frozenSessions,
    };
  }
  if (
    input.price === null &&
    billable.length > 0 &&
    billable.length >= rules.prorationMinSessions
  ) {
    return { amount: zero, explanation: explain('noPrice'), ...none, missingPrice: true };
  }
  const charge = prorate(
    {
      price: input.price ?? zero,
      billableSessions: billable.length,
      totalSessions: input.sessionDates.length,
      billableDays,
      totalDays: daysInPeriod(input.period),
    },
    rules,
  );
  const covered = charge.amount > 0 ? billable : [];
  return {
    ...charge,
    explanation:
      frozenSessions > 0 && charge.amount > 0
        ? {
            ...charge.explanation,
            params: { ...charge.explanation.params, frozen: frozenSessions },
          }
        : charge.explanation,
    sessionDates: covered,
    frozenSessions,
    missingPrice: false,
  };
}

// ─── Per-lesson programs (private, pair, trio, therapy) ─────────────────────

export interface SlotBookingFact {
  id: string;
  date: string;
  startsAt: Date;
  status: 'booked' | 'cancelled';
  cancelledAt: Date | null;
  /** The single-lesson price, or null when no price list covers it. */
  price: Agorot | null;
}

export interface SlotCharge extends Charge {
  bookingId: string;
  date: string;
  charged: boolean;
  missingPrice: boolean;
}

/**
 * Each booked lesson is charged; a cancellation with less notice than `absence.notice_min_hours` (24h for privates)
 * is charged too, and one in time is free.
 */
export function chargeForSlots(
  bookings: readonly SlotBookingFact[],
  rules: Pick<BillingRules, 'noticeMinHours'>,
): SlotCharge[] {
  return [...bookings]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((b) => {
      let charged = true;
      let explanation = explain('slotBooked');
      if (b.status === 'cancelled') {
        const hours = b.cancelledAt
          ? (b.startsAt.getTime() - b.cancelledAt.getTime()) / 3_600_000
          : 0;
        charged = hours < rules.noticeMinHours;
        explanation = explain(charged ? 'slotLateCancel' : 'slotCancelledInTime', {
          hours: Math.max(0, Math.floor(hours)),
          min: rules.noticeMinHours,
        });
      }
      const missingPrice = charged && b.price === null;
      return {
        bookingId: b.id,
        date: b.date,
        charged,
        missingPrice,
        amount: charged && b.price !== null ? b.price : agorot(0),
        explanation: missingPrice ? explain('noPrice') : explanation,
      };
    });
}

// ─── Sibling discount ───────────────────────────────────────────────────────

export interface ChildTotal {
  studentId: string;
  /** For `youngest_first`; unknown birth dates count as the oldest. */
  birthDate: string | null;
  amount: Agorot;
}

export interface SiblingDiscount {
  studentId: string;
  /** Positive: the amount taken off. Never more than the child's charge. */
  discount: Agorot;
  explanation: Explanation;
}

/**
 * The second and later children charged this month get the sibling discount; one child pays in full. With
 * `cheapest_first` the most expensive child pays in full (the discount goes to the cheaper ones); with
 * `youngest_first` the oldest does. Ties go by id, so the result does not depend on the order of the input.
 */
export function applySiblingDiscount(
  children: readonly ChildTotal[],
  rules: SiblingRules,
): SiblingDiscount[] {
  const charged = children.filter((c) => c.amount > 0);
  if (charged.length < 2) return [];
  const byId = (a: ChildTotal, b: ChildTotal) => a.studentId.localeCompare(b.studentId);
  const order =
    rules.appliesTo === 'cheapest_first'
      ? [...charged].sort((a, b) => b.amount - a.amount || byId(a, b))
      : [...charged].sort(
          (a, b) => (a.birthDate ?? '').localeCompare(b.birthDate ?? '') || byId(a, b),
        );
  return order.slice(1).map((c) => {
    const raw =
      rules.kind === 'percent' ? percentOf(c.amount, rules.percentBp) : agorot(rules.flatAgorot);
    const discount = agorot(Math.min(raw, c.amount));
    return {
      studentId: c.studentId,
      discount,
      explanation:
        rules.kind === 'percent'
          ? explain('siblingPercent', { percent: rules.percentBp / 100 })
          : explain('siblingFlat', { amount: rules.flatAgorot }),
    };
  });
}

/** A statement's total: the sum of its already-rounded lines (never re-rounded). */
export function statementTotal(lines: readonly { amount: number }[]): Agorot {
  return agorot(lines.reduce((sum, l) => sum + l.amount, 0));
}

/** What one lesson of a monthly group is worth that month (a closure credit turned into money). */
export function lessonValue(monthlyPrice: Agorot, sessionsInMonth: number): Agorot {
  return sessionsInMonth > 0 ? ratioOf(monthlyPrice, 1, sessionsInMonth) : agorot(0);
}

/**
 * An annual subscription ended early: with `pay_difference_to_monthly` the family gets back what they paid minus
 * the months used at the monthly price (never below zero); with `no_refund` nothing.
 */
export function annualEarlyTermination(
  input: { paid: Agorot; monthsUsed: number; monthlyPrice: Agorot },
  rules: Pick<BillingRules, 'annualEarlyTermination'>,
): Charge {
  if (rules.annualEarlyTermination === 'no_refund') {
    return { amount: agorot(0), explanation: explain('annualNoRefund') };
  }
  const used = input.monthsUsed * input.monthlyPrice;
  return {
    amount: agorot(Math.max(0, input.paid - used)),
    explanation: explain('annualDifference', { months: input.monthsUsed }),
  };
}

// ─── Pre-run review ─────────────────────────────────────────────────────────

export interface ReviewLine {
  kind: BillingLineKind;
  enrollmentId: string | null;
  studentId: string | null;
  amount: number;
  missingPrice: boolean;
}

export interface HouseholdReview {
  householdId: string;
  /** Seats held at some point of the period (whatever the charge decided). */
  seats: readonly { enrollmentId: string; studentId: string }[];
  lines: readonly ReviewLine[];
  /** Standing orders that will be charged (active or failing). */
  mandateIds: readonly string[];
  /** Last posted period's total, or null when the family was not billed then. */
  previousTotal: number | null;
}

export interface Anomaly {
  kind: AnomalyKind;
  householdId: string;
  studentId: string | null;
  enrollmentId: string | null;
  explanation: Explanation;
}

/**
 * The mistakes Reut described (brief §1.4, §6.7): a mandate that will charge a family with no seat, a seat that
 * produces no charge, two mandates for one family, a family that owes money but has no mandate (a link goes out),
 * and a total that moved more than `billing.anomaly_change_bp` from last month.
 */
export function detectAnomalies(
  h: HouseholdReview,
  rules: Pick<BillingRules, 'methodRequired' | 'anomalyChangeBp'>,
): Anomaly[] {
  const out: Anomaly[] = [];
  const add = (
    kind: AnomalyKind,
    code: string,
    params: Record<string, string | number> = {},
    who: { studentId?: string | null; enrollmentId?: string | null } = {},
  ) =>
    out.push({
      kind,
      householdId: h.householdId,
      studentId: who.studentId ?? null,
      enrollmentId: who.enrollmentId ?? null,
      explanation: explain(code, params),
    });
  const total = statementTotal(h.lines);
  const seatIds = new Set(h.seats.map((s) => s.enrollmentId));

  if (h.mandateIds.length > 1) {
    add('duplicate_mandate', 'duplicateMandate', { count: h.mandateIds.length });
  }
  const otherCharges = h.lines.some((l) => l.kind !== 'seat' && l.amount > 0);
  if (h.mandateIds.length > 0 && h.seats.length === 0 && !otherCharges) {
    add('charge_without_enrollment', 'mandateWithoutSeat', { count: h.mandateIds.length });
  }
  for (const l of h.lines) {
    if (l.kind === 'seat' && l.amount > 0 && (!l.enrollmentId || !seatIds.has(l.enrollmentId))) {
      add('charge_without_enrollment', 'chargeWithoutSeat', {}, l);
    }
    if (l.missingPrice) add('enrollment_without_charge', 'noPrice', {}, l);
  }
  for (const s of h.seats) {
    if (!h.lines.some((l) => l.kind === 'seat' && l.enrollmentId === s.enrollmentId)) {
      add('enrollment_without_charge', 'seatWithoutLine', {}, s);
    }
  }
  if (total > 0 && rules.methodRequired === 'standing_order' && h.mandateIds.length === 0) {
    add('missing_mandate', 'noMandate', { amount: total });
  }
  if (h.previousTotal !== null && h.previousTotal > 0) {
    const change = Math.abs(total - h.previousTotal);
    if (change * 10_000 > h.previousTotal * rules.anomalyChangeBp) {
      add('amount_changed', total > h.previousTotal ? 'amountUp' : 'amountDown', {
        from: h.previousTotal,
        to: total,
        percent: Math.round((change * 100) / h.previousTotal),
      });
    }
  }
  return out;
}

// ─── Dunning ────────────────────────────────────────────────────────────────

export interface DunningCaseFacts {
  openedOn: string;
  status: 'open' | 'escalated';
  /** Automatic retries already made (the first failed charge is not one). */
  retriesDone: number;
  /** Whether a standing order can be retried; otherwise the family gets the payment link again. */
  hasMandate: boolean;
}

export interface DunningStep {
  action: 'retry' | 'remind' | 'escalate' | 'wait';
  /** When the next step is due (for `wait`), or null when only the owner can move the case. */
  nextOn: string | null;
  pauseEnrollment: boolean;
  explanation: Explanation;
}

/**
 * What to do with an unpaid charge today (brief §6.7 dunning): retry `first_retry_days` after the failure and every
 * `retry_interval_days` after that, up to `max_retries` (or resend the link when there is no mandate), and hand the
 * case to the owner `escalate_after_days` after it opened, optionally pausing the enrollment.
 */
export function dunningNextStep(
  c: DunningCaseFacts,
  today: string,
  rules: DunningRules,
): DunningStep {
  const escalateOn = addDays(c.openedOn, rules.escalateAfterDays);
  if (c.status === 'open' && today >= escalateOn) {
    return {
      action: 'escalate',
      nextOn: null,
      pauseEnrollment: rules.pauseEnrollment,
      explanation: explain('dunningEscalate', { days: rules.escalateAfterDays }),
    };
  }
  const nextRetryOn =
    c.retriesDone < rules.maxRetries
      ? addDays(c.openedOn, rules.firstRetryDays + c.retriesDone * rules.retryIntervalDays)
      : null;
  if (nextRetryOn !== null && today >= nextRetryOn) {
    return {
      action: c.hasMandate ? 'retry' : 'remind',
      nextOn: null,
      pauseEnrollment: false,
      explanation: explain(c.hasMandate ? 'dunningRetry' : 'dunningRemind', {
        attempt: c.retriesDone + 1,
        max: rules.maxRetries,
      }),
    };
  }
  const candidates = [nextRetryOn, c.status === 'open' ? escalateOn : null].filter(
    (d): d is string => d !== null,
  );
  const nextOn = candidates.sort()[0] ?? null;
  return {
    action: 'wait',
    nextOn,
    pauseEnrollment: false,
    explanation: nextOn ? explain('dunningWait', { on: dmy(nextOn) }) : explain('dunningOwner'),
  };
}

// ─── Ledger: balance, allocation, aging ─────────────────────────────────────

export interface LedgerFact {
  id: string;
  type: LedgerEntryType;
  /** Signed: positive is owed. */
  amount: number;
  occurredOn: string;
  /** Entries of one statement line (a charge and its discount) settle together. */
  lineId: string | null;
  reversesEntryId: string | null;
}

/** The balance is the sum of the ledger, whatever the order (positive: the family owes; negative: in credit). */
export function balanceOf(entries: readonly { amount: number }[]): Agorot {
  return statementTotal(entries);
}

export interface OpenItem {
  key: string;
  occurredOn: string;
  /** Still unpaid, positive. */
  amount: number;
}

export interface Allocation {
  /** Unpaid charges, oldest first. */
  outstanding: OpenItem[];
  /** Money paid or credited that no charge has used yet (positive). */
  unallocated: number;
  /** For each payment entry, which items it paid and how much. */
  byPayment: Record<string, { key: string; amount: number }[]>;
}

/**
 * Settles charges first in, first out: each payment or credit pays the oldest unpaid charges, and money left over
 * pays the next charges as they are posted. A reversal and the entry it reverses drop out together. Entries of one
 * statement line are netted first, so a sibling discount lowers its own charge.
 */
export function allocate(entries: readonly LedgerFact[]): Allocation {
  const reversed = new Set(entries.map((e) => e.reversesEntryId).filter(Boolean));
  const live = entries.filter((e) => !e.reversesEntryId && !reversed.has(e.id));
  const items = new Map<
    string,
    { key: string; amount: number; occurredOn: string; type: LedgerEntryType; seq: number }
  >();
  live.forEach((e, seq) => {
    const key = e.lineId ?? e.id;
    const cur = items.get(key);
    if (cur) {
      cur.amount += e.amount;
      if (e.occurredOn < cur.occurredOn) cur.occurredOn = e.occurredOn;
      if (e.amount > 0) cur.type = e.type;
    } else {
      items.set(key, { key, amount: e.amount, occurredOn: e.occurredOn, type: e.type, seq });
    }
  });
  const ordered = [...items.values()]
    .filter((i) => i.amount !== 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.seq - b.seq);

  const outstanding: OpenItem[] = [];
  const pool: { key: string; type: LedgerEntryType; left: number }[] = [];
  const byPayment: Allocation['byPayment'] = {};
  const record = (payer: { key: string; type: LedgerEntryType }, key: string, amount: number) => {
    if (payer.type !== 'payment') return;
    (byPayment[payer.key] ??= []).push({ key, amount });
  };
  for (const it of ordered) {
    if (it.amount > 0) {
      let due = it.amount;
      while (due > 0 && pool.length > 0) {
        const p = pool[0] as (typeof pool)[number];
        const take = Math.min(due, p.left);
        record(p, it.key, take);
        p.left -= take;
        due -= take;
        if (p.left === 0) pool.shift();
      }
      if (due > 0) outstanding.push({ key: it.key, occurredOn: it.occurredOn, amount: due });
    } else {
      let left = -it.amount;
      while (left > 0 && outstanding.length > 0) {
        const o = outstanding[0] as OpenItem;
        const take = Math.min(left, o.amount);
        record(it, o.key, take);
        o.amount -= take;
        left -= take;
        if (o.amount === 0) outstanding.shift();
      }
      if (left > 0) pool.push({ key: it.key, type: it.type, left });
    }
  }
  return {
    outstanding,
    unallocated: pool.reduce((s, p) => s + p.left, 0),
    byPayment,
  };
}

export interface AgingBuckets {
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

/** Unpaid charges by age (days since posted): 0–30, 31–60, 61–90 and more than 90. */
export function agingBuckets(outstanding: readonly OpenItem[], today: string): AgingBuckets {
  const b: AgingBuckets = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
  for (const o of outstanding) {
    const age = daysBetween(o.occurredOn, today);
    if (age <= 30) b.current += o.amount;
    else if (age <= 60) b.days31to60 += o.amount;
    else if (age <= 90) b.days61to90 += o.amount;
    else b.over90 += o.amount;
  }
  return b;
}

// ─── Receipts ───────────────────────────────────────────────────────────────

export interface ReimbursementProfileFacts {
  /** Printed on every line, e.g. "טיפולי הידרותרפיה". */
  wording: string;
  requiresNationalId: boolean;
  includeSessionDates: boolean;
  splitPerMonth: boolean;
}

export interface CoveredItem {
  description: string;
  /** The billing period it belongs to, or null (a manual charge). */
  period: string | null;
  studentName: string | null;
  sessionDates: readonly string[];
  amount: number;
}

export interface ReceiptInput {
  payment: { amount: number; method: PaymentMethod; paidOn: string };
  client: { name: string; nationalId: string | null; email: string | null };
  profile: ReimbursementProfileFacts | null;
  /** What this payment paid (from `allocate`). */
  covered: readonly CoveredItem[];
}

export interface ReceiptDocumentDraft {
  period: string | null;
  client: { name: string; nationalId?: string; email?: string };
  lines: { description: string; amount: Agorot; quantity: number }[];
  paymentMethod: string;
  notes: string;
  total: Agorot;
}

export type ReceiptDecision =
  { ok: true; documents: ReceiptDocumentDraft[] } | { ok: false; explanation: Explanation };

/**
 * The invoice-receipt(s) for one payment. In reimbursement mode every line carries the profile's wording and the
 * child, the notes list the ID number, the lesson dates and the payment method, and with `splitPerMonth` each month
 * gets its own document. Money the payment carried beyond its charges is a prepayment line. The documents always add
 * up to the payment.
 */
export function receiptDocuments(input: ReceiptInput): ReceiptDecision {
  const { profile, client } = input;
  if (profile?.requiresNationalId && !client.nationalId) {
    return { ok: false, explanation: explain('receiptNeedsNationalId') };
  }
  const covered = input.covered.filter((c) => c.amount > 0);
  const paidFor = covered.reduce((s, c) => s + c.amount, 0);
  const extra = input.payment.amount - paidFor;
  type Draft = { period: string | null; item: CoveredItem };
  const drafts: Draft[] = covered.map((item) => ({ period: item.period, item }));
  if (extra > 0) {
    drafts.push({
      period: null,
      item: {
        description: FISCAL_TEXT_HE.prepayment,
        period: null,
        studentName: null,
        sessionDates: [],
        amount: extra,
      },
    });
  }
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const key = profile?.splitPerMonth && d.period ? d.period : '';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  // A prepayment rides with the last month's document when receipts are split.
  if (profile?.splitPerMonth && groups.size > 1 && groups.has('')) {
    const loose = groups.get('') as Draft[];
    groups.delete('');
    const lastKey = [...groups.keys()].sort().at(-1) as string;
    groups.set(lastKey, [...(groups.get(lastKey) as Draft[]), ...loose]);
  }
  const method = FISCAL_TEXT_HE.methods[input.payment.method];
  const documents = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ds]) => {
      const lines = ds.map(({ item }) => ({
        description: lineDescription(item, profile),
        amount: agorot(item.amount),
        quantity: 1,
      }));
      const dates = ds.flatMap(({ item }) => item.sessionDates);
      const notes = [
        profile ? profile.wording : null,
        profile && client.nationalId ? `${FISCAL_TEXT_HE.nationalId} ${client.nationalId}` : null,
        profile?.includeSessionDates && dates.length > 0
          ? `${FISCAL_TEXT_HE.sessionDates}: ${[...dates].sort().map(dmy).join(', ')}`
          : null,
        method,
      ].filter((n): n is string => n !== null);
      return {
        period: key === '' ? null : key,
        client: {
          name: client.name,
          ...(client.nationalId ? { nationalId: client.nationalId } : {}),
          ...(client.email ? { email: client.email } : {}),
        },
        lines,
        paymentMethod: method,
        notes: notes.join('\n'),
        total: statementTotal(lines),
      };
    });
  return { ok: true, documents };
}

function lineDescription(item: CoveredItem, profile: ReimbursementProfileFacts | null): string {
  const month = item.period
    ? `${FISCAL_TEXT_HE.period} ${item.period.slice(5)}/${item.period.slice(0, 4)}`
    : null;
  const parts =
    profile && item.period
      ? [profile.wording, item.studentName, month]
      : [item.description, item.studentName, month];
  return parts.filter((p): p is string => !!p).join(' – ');
}
