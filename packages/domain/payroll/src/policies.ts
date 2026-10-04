/**
 * Pure payroll rules (brief §6.8, docs/POLICIES.md §11): which pay rule prices a lesson, what the lesson pays, travel,
 * how a month splits into the payslip part and the transfer part, pension eligibility and sick-leave accrual. Every
 * line carries an i18n explanation; money is integer agorot, rounded half-up per line, and a total is the sum of lines.
 */
import type { EmploymentType, PayBasis, PayRouting, PolicyRules, WorkKind } from '@rswim/contracts';
import { agorot, ratioOf, type Agorot } from '@rswim/money';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `payroll.decision.${code}`,
  params,
});

// ─── Rules with defaults ────────────────────────────────────────────────────

export interface PayrollRules {
  pensionThresholdMonths: number;
  sickHalfDaysPerMonth: number;
}

export function payrollRulesFrom(rules: PolicyRules): PayrollRules {
  return {
    pensionThresholdMonths: rules.payroll?.pension_threshold_months ?? 3,
    sickHalfDaysPerMonth: rules.payroll?.sick_leave_accrual_halfdays_per_month ?? 3,
  };
}

// ─── Periods ────────────────────────────────────────────────────────────────

/** "2026-10" → "2026-09". */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** First and last local date of a period. */
export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

// ─── Pay rules ──────────────────────────────────────────────────────────────

export interface PayRuleRow {
  id: string;
  basis: PayBasis;
  amountAgorot: number;
  programId: string | null;
  venueId: string | null;
  routing: PayRouting;
  travelAllowanceAgorot: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** One lesson an instructor taught: a group session held, or a booked private / therapy slot. */
export interface WorkItem {
  workKind: WorkKind;
  sessionId: string | null;
  slotId: string | null;
  date: string;
  venueId: string;
  programId: string | null;
  minutes: number;
  /** Children in the water (per-head pay). */
  heads: number;
  /** "בנים דולפין · 16:00" — shown on the line. */
  label: string;
}

const effectiveOn = (r: PayRuleRow, date: string) =>
  r.effectiveFrom <= date && (r.effectiveTo === null || date < r.effectiveTo);

/**
 * The rule that prices a lesson: effective on its date, matching its program and venue where the rule names them,
 * the most specific first (program and venue > program > venue > any), the latest version on a tie.
 */
export function ruleFor(item: WorkItem, rules: readonly PayRuleRow[]): PayRuleRow | null {
  const specificity = (r: PayRuleRow) => (r.programId ? 2 : 0) + (r.venueId ? 1 : 0);
  const fits = rules.filter(
    (r) =>
      effectiveOn(r, item.date) &&
      (r.programId === null || r.programId === item.programId) &&
      (r.venueId === null || r.venueId === item.venueId),
  );
  fits.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      (b.effectiveFrom > a.effectiveFrom ? 1 : b.effectiveFrom < a.effectiveFrom ? -1 : 0),
  );
  return fits[0] ?? null;
}

export type PayUnit = 'hour' | 'session' | 'head' | 'day' | 'item';

/** What one lesson pays under a rule. Per hour is by the minute, rounded half-up to the agora. */
export function payForItem(
  item: WorkItem,
  rule: PayRuleRow,
): { quantity: number; unit: PayUnit; amount: Agorot; explanation: Explanation } {
  const rate = agorot(rule.amountAgorot);
  switch (rule.basis) {
    case 'per_hour':
      return {
        quantity: Math.round((item.minutes / 60) * 100) / 100,
        unit: 'hour',
        amount: ratioOf(rate, item.minutes, 60),
        explanation: explain('perHour', { minutes: item.minutes, rate: rule.amountAgorot }),
      };
    case 'per_session':
      return {
        quantity: 1,
        unit: 'session',
        amount: rate,
        explanation: explain('perSession', { rate: rule.amountAgorot }),
      };
    case 'per_head':
      return {
        quantity: item.heads,
        unit: 'head',
        amount: agorot(rule.amountAgorot * item.heads),
        explanation: explain('perHead', { heads: item.heads, rate: rule.amountAgorot }),
      };
  }
}

// ─── A month's pay ──────────────────────────────────────────────────────────

export interface AdjustmentRow {
  id: string;
  kind: string;
  routing: PayRouting;
  amountAgorot: number;
  note: string;
}

export interface PayLine {
  routing: PayRouting;
  kind: 'work' | 'travel' | 'adjustment';
  workKind: WorkKind | null;
  date: string | null;
  description: string;
  quantity: number;
  unit: PayUnit;
  amount: Agorot;
  payRuleId: string | null;
  sessionId: string | null;
  slotId: string | null;
  adjustmentId: string | null;
  explanation: Explanation;
}

export interface StaffPay {
  lines: PayLine[];
  /** Lessons no rule prices: the run's review shows them, and they pay nothing until a rule exists. */
  unpriced: WorkItem[];
  payslip: Agorot;
  transfer: Agorot;
}

/**
 * One instructor's month. Each lesson is priced by its rule and routed with it, so a hybrid instructor's groups go to
 * the payslip and their privates to a transfer when their rules say so. Travel is paid once per working day and
 * venue: the largest allowance among that day's rules there, routed with that rule (payslip first on a tie).
 */
export function computeStaffPay(
  items: readonly WorkItem[],
  rules: readonly PayRuleRow[],
  adjustments: readonly AdjustmentRow[] = [],
): StaffPay {
  const lines: PayLine[] = [];
  const unpriced: WorkItem[] = [];
  const travel = new Map<string, { date: string; rule: PayRuleRow }>();
  const sorted = [...items].sort((a, b) =>
    a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? -1 : 1,
  );
  for (const item of sorted) {
    const rule = ruleFor(item, rules);
    if (!rule) {
      unpriced.push(item);
      continue;
    }
    const pay = payForItem(item, rule);
    lines.push({
      routing: rule.routing,
      kind: 'work',
      workKind: item.workKind,
      date: item.date,
      description: item.label,
      quantity: pay.quantity,
      unit: pay.unit,
      amount: pay.amount,
      payRuleId: rule.id,
      sessionId: item.sessionId,
      slotId: item.slotId,
      adjustmentId: null,
      explanation: pay.explanation,
    });
    if (rule.travelAllowanceAgorot > 0) {
      const key = `${item.date}|${item.venueId}`;
      const seen = travel.get(key);
      const better =
        !seen ||
        rule.travelAllowanceAgorot > seen.rule.travelAllowanceAgorot ||
        (rule.travelAllowanceAgorot === seen.rule.travelAllowanceAgorot &&
          rule.routing === 'payslip' &&
          seen.rule.routing === 'transfer');
      if (better) travel.set(key, { date: item.date, rule });
    }
  }
  for (const { date, rule } of travel.values()) {
    lines.push({
      routing: rule.routing,
      kind: 'travel',
      workKind: null,
      date,
      description: '',
      quantity: 1,
      unit: 'day',
      amount: agorot(rule.travelAllowanceAgorot),
      payRuleId: rule.id,
      sessionId: null,
      slotId: null,
      adjustmentId: null,
      explanation: explain('travel', { rate: rule.travelAllowanceAgorot }),
    });
  }
  for (const a of adjustments) {
    lines.push({
      routing: a.routing,
      kind: 'adjustment',
      workKind: null,
      date: null,
      description: a.note,
      quantity: 1,
      unit: 'item',
      amount: agorot(a.amountAgorot),
      payRuleId: null,
      sessionId: null,
      slotId: null,
      adjustmentId: a.id,
      explanation: explain(`adjustment.${a.kind}`),
    });
  }
  const total = (routing: PayRouting) =>
    agorot(lines.filter((l) => l.routing === routing).reduce((s, l) => s + l.amount, 0));
  return { lines, unpriced, payslip: total('payslip'), transfer: total('transfer') };
}

// ─── Pension and sick leave ─────────────────────────────────────────────────

export interface PensionStatus {
  /** Months in a row, ending with this one, with payslip work. */
  continuousMonths: number;
  eligible: boolean;
  /** Became eligible this month: the accountant contributes back to the first month of the streak. */
  newlyEligible: boolean;
  retroFrom: string | null;
  explanation: Explanation;
}

/**
 * Pension eligibility after `threshold` continuous months of payslip work (POLICIES §11, DECISIONS #6). A month
 * without payslip work breaks the streak. When the streak reaches the threshold, the retro flag names its first month.
 */
export function pensionStatus(
  monthsWorked: readonly string[],
  period: string,
  threshold: number,
): PensionStatus {
  const worked = new Set(monthsWorked);
  let continuous = 0;
  let first = period;
  for (let p = period; worked.has(p); p = previousPeriod(p)) {
    continuous++;
    first = p;
  }
  const eligible = continuous > 0 && continuous >= threshold;
  const newlyEligible = eligible && continuous === Math.max(threshold, 1);
  return {
    continuousMonths: continuous,
    eligible,
    newlyEligible,
    retroFrom: newlyEligible ? first : null,
    explanation: newlyEligible
      ? explain('pension.newlyEligible', { months: continuous, from: first })
      : eligible
        ? explain('pension.eligible', { months: continuous })
        : explain('pension.notYet', { months: continuous, threshold }),
  };
}

/**
 * Sick leave accrued for the month, in half days: employees (and the payslip side of a hybrid) who worked on the
 * payslip this month accrue the policy's rate; freelancers paid by transfer accrue none.
 */
export function sickAccrual(
  employmentType: EmploymentType,
  workedOnPayslip: boolean,
  rules: PayrollRules,
): number {
  if (!workedOnPayslip) return 0;
  return employmentType === 'employee' || employmentType === 'hybrid'
    ? rules.sickHalfDaysPerMonth
    : 0;
}
