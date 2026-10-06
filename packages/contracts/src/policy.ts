import { z } from 'zod';

/**
 * The rules a policy set may hold (docs/POLICIES.md, ADR-0004). Every key is optional: a scope stores only what it
 * overrides, and the resolver merges scopes from org down to class template. Objects are strict so a typo in a key
 * fails validation instead of silently doing nothing.
 */
const int = (min: number, max: number) => z.int().min(min).max(max);
const bp = int(0, 10_000); // basis points: 1000 = 10%
const agorotAmount = int(0, 100_000_000);
const hours = int(0, 24 * 14);

const LESSON_BLOCKERS = [
  'shabbat',
  'erev_chag',
  'yom_tov',
  'yom_kippur',
  'tisha_bav',
  'yom_hazikaron_evening',
  'yom_hazikaron',
  'yom_haatzmaut',
] as const;

export const PolicyRules = z
  .object({
    billing: z
      .object({
        method_required: z.enum(['standing_order', 'any']),
        run_day: int(1, 28),
        cancellation_cutoff_day: int(1, 31),
        absence_refund: z.enum(['none', 'credit']),
        proration: z.enum(['per_remaining_sessions', 'per_remaining_days', 'none']),
        proration_min_sessions: int(0, 31),
        freeze_charge: z.enum(['none_while_frozen', 'full']),
        freeze_requires_approval: z.boolean(),
        annual_early_termination: z.enum(['pay_difference_to_monthly', 'no_refund']),
        closure_credit: z.enum(['none', 'credit']),
        /** How far a household's total may move from last month before the pre-run review flags it. */
        anomaly_change_bp: int(0, 100_000),
      })
      .partial()
      .strict(),
    dunning: z
      .object({
        first_retry_days: int(0, 30),
        retry_interval_days: int(1, 30),
        max_retries: int(0, 10),
        escalate_after_days: int(1, 90),
        pause_enrollment: z.boolean(),
      })
      .partial()
      .strict(),
    discount: z
      .object({
        sibling: z
          .object({
            kind: z.enum(['percent', 'flat']),
            percent_bp: bp,
            flat_agorot: agorotAmount,
            applies_to: z.enum(['cheapest_first', 'youngest_first']),
          })
          .partial()
          .strict(),
        stacking: z.enum(['best_single', 'additive']),
      })
      .partial()
      .strict(),
    trial: z
      .object({
        offset: z
          .object({
            enabled: z.boolean(),
            amount: z.enum(['full_trial_fee', 'fixed']),
            fixed_agorot: agorotAmount,
            valid_days: int(0, 365),
          })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
    attendance: z
      .object({
        late_threshold_min: int(0, 120),
        leave_early_counts_as: z.enum(['attended', 'absent']),
        no_water_counts_as: z.enum(['attended', 'absent']),
      })
      .partial()
      .strict(),
    absence: z
      .object({
        notice_min_hours: hours,
        timely_earns_makeup: z.boolean(),
        late_notice_charge: z.enum(['charged_no_makeup', 'charged_full']),
        no_show_charge: z.enum(['charged_no_makeup', 'charged_full']),
      })
      .partial()
      .strict(),
    makeup: z
      .object({
        enabled: z.boolean(),
        max_per_month: int(0, 31),
        expiry: z.enum(['end_of_source_month', 'end_of_next_month', 'event_deadline']),
        requires_active_subscription: z.boolean(),
        self_booking: z.boolean(),
        double_lesson_allowed: z.boolean(),
        enforcement: z.enum(['strict_with_override', 'soft']),
        level_tolerance: int(0, 5),
      })
      .partial()
      .strict(),
    closure: z
      .object({
        school_makeup: z.enum(['guaranteed', 'best_effort', 'none']),
        external_makeup: z.enum(['guaranteed', 'best_effort', 'none']),
        external_refund: z.enum(['none', 'credit', 'refund']),
        event_end_rule: z.enum(['expire', 'convert_to_credit', 'partial_refund']),
        makeup_cap_bypass: z.boolean(),
      })
      .partial()
      .strict(),
    calendar: z
      .object({
        no_lessons_on: z.array(z.enum(LESSON_BLOCKERS)),
        chol_hamoed: z.enum(['skip', 'run']),
        holiday_makeup: z.enum(['none', 'makeup']),
        holiday_notice_days_before: int(0, 30),
      })
      .partial()
      .strict(),
    health: z
      .object({
        declaration_required: z.boolean(),
        declaration_valid_months: int(1, 36),
        sick_children_allowed: z.boolean(),
      })
      .partial()
      .strict(),
    consent: z
      .object({ photo_default: z.enum(['granted_unless_opt_out', 'denied_unless_opt_in']) })
      .partial()
      .strict(),
    regulations: z.object({ acceptance_required: z.boolean() }).partial().strict(),
    venue: z
      .object({
        companions_per_child: int(0, 5),
        extra_child_fee_agorot: agorotAmount,
        entry_window: z.enum(['lesson_time_only', 'open']),
        father_escort_in_women_hours: z.boolean(),
      })
      .partial()
      .strict(),
    enrollment: z.object({ transfers_allowed: z.boolean() }).partial().strict(),
    payroll: z
      .object({
        pension_threshold_months: int(0, 24),
        sick_leave_accrual_halfdays_per_month: int(0, 10),
      })
      .partial()
      .strict(),
    scheduling: z
      .object({
        travel_buffer_min: int(0, 240),
        window_instructor_gender: z.enum(['match_window', 'any_gender']),
        open_group_min_waiting: int(1, 50),
      })
      .partial()
      .strict(),
    staffing: z
      .object({
        shift_change_requires_acceptance: z.boolean(),
        shift_change_escalate_after_hours: hours,
        substitute_wave_size: int(1, 50),
        substitute_wave_minutes: int(5, 1440),
      })
      .partial()
      .strict(),
    transport: z
      .object({
        stale_after_min: int(5, 240),
        short_water_warn_min: int(0, 60),
      })
      .partial()
      .strict(),
    camp: z
      .object({ children_per_staff: int(1, 30) })
      .partial()
      .strict(),
    migration: z
      .object({ revert_hours: int(1, 168) })
      .partial()
      .strict(),
    copilot: z.object({ enabled: z.boolean() }).partial().strict(),
    digest: z
      .object({
        enabled: z.boolean(),
        high_occupancy_pct: int(50, 100),
        low_occupancy_pct: int(0, 80),
        debt_attention_days: int(7, 365),
      })
      .partial()
      .strict(),
    comms: z
      .object({
        quiet_hours_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        quiet_hours_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        block_shabbat_and_chag: z.boolean(),
        lead_followup_max_nudges: int(0, 20),
        reminder_before_lesson_hours: int(0, 72),
        rate_per_minute: int(1, 600),
        holiday_notice_days_before: int(0, 14),
        ai_triage: z.boolean(),
        triage_min_confidence_pct: int(50, 100),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type PolicyRules = z.infer<typeof PolicyRules>;

/** One editable leaf of PolicyRules, for the form-based editor (ADR-0004: known keys only). */
export type PolicyField =
  | {
      path: string;
      type: 'int';
      min: number;
      max: number;
      unit?: 'hours' | 'minutes' | 'days' | 'agorot' | 'bp';
    }
  | { path: string; type: 'boolean' }
  | { path: string; type: 'enum'; options: readonly string[] }
  | { path: string; type: 'multi'; options: readonly string[] };

/** Walks the schema once and lists every leaf the editor can show. Arrays of enums become multi-selects. */
export function policyFields(): PolicyField[] {
  const out: PolicyField[] = [];
  const walk = (schema: z.ZodType, path: string[]) => {
    const def = unwrap(schema);
    if (def instanceof z.ZodObject) {
      for (const [k, v] of Object.entries(def.shape as Record<string, z.ZodType>))
        walk(v, [...path, k]);
      return;
    }
    const p = path.join('.');
    if (def instanceof z.ZodBoolean) out.push({ path: p, type: 'boolean' });
    else if (def instanceof z.ZodEnum)
      out.push({ path: p, type: 'enum', options: def.options as string[] });
    else if (def instanceof z.ZodArray) {
      out.push({
        path: p,
        type: 'multi',
        options: (unwrap(def.element as z.ZodType) as z.ZodEnum).options as string[],
      });
    } else if (def instanceof z.ZodNumber) {
      out.push({
        path: p,
        type: 'int',
        min: Number(def.minValue),
        max: Number(def.maxValue),
        ...unitFor(p),
      });
    }
  };
  walk(PolicyRules, []);
  return out;
}

function unwrap(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional ? unwrap(schema.unwrap() as z.ZodType) : schema;
}

function unitFor(path: string): { unit?: 'hours' | 'minutes' | 'days' | 'agorot' | 'bp' } {
  if (path.endsWith('_agorot')) return { unit: 'agorot' };
  if (path.endsWith('_bp')) return { unit: 'bp' };
  if (path.endsWith('_hours')) return { unit: 'hours' };
  if (path.endsWith('_min')) return { unit: 'minutes' };
  if (path.endsWith('_days') || path.endsWith('_days_before')) return { unit: 'days' };
  return {};
}

/** Reads a dotted path from rules, e.g. getRule(rules, 'absence.notice_min_hours'). */
export function getRule(rules: PolicyRules, path: string): unknown {
  let cur: unknown = rules;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Returns a copy of rules with one dotted path set, or removed when `value` is undefined. Empty parents are pruned. */
export function setRule(rules: PolicyRules, path: string, value: unknown): PolicyRules {
  const [head, ...rest] = path.split('.') as [string, ...string[]];
  const src = rules as Record<string, unknown>;
  let next = value;
  if (rest.length > 0) {
    const child = src[head];
    const sub = setRule(
      (child && typeof child === 'object' ? child : {}) as PolicyRules,
      rest.join('.'),
      value,
    );
    next = Object.keys(sub).length === 0 ? undefined : sub;
  }
  const copy = Object.fromEntries(Object.entries(src).filter(([k]) => k !== head));
  if (next !== undefined) copy[head] = next;
  return copy as PolicyRules;
}

/** R-SWIM's regulations as an org-scope policy set (docs/POLICIES.md defaults). Used by the seed and new tenants. */
export const DEFAULT_ORG_RULES: PolicyRules = {
  billing: {
    method_required: 'standing_order',
    run_day: 1,
    cancellation_cutoff_day: 25,
    absence_refund: 'none',
    proration: 'per_remaining_sessions',
    proration_min_sessions: 1,
    freeze_charge: 'none_while_frozen',
    freeze_requires_approval: true,
    annual_early_termination: 'pay_difference_to_monthly',
    closure_credit: 'none',
    anomaly_change_bp: 3000,
  },
  dunning: {
    first_retry_days: 1,
    retry_interval_days: 3,
    max_retries: 3,
    escalate_after_days: 10,
    pause_enrollment: false,
  },
  discount: {
    sibling: { kind: 'percent', percent_bp: 1000, flat_agorot: 3000, applies_to: 'cheapest_first' },
    stacking: 'best_single',
  },
  trial: { offset: { enabled: true, amount: 'full_trial_fee', valid_days: 14 } },
  attendance: {
    late_threshold_min: 10,
    leave_early_counts_as: 'attended',
    no_water_counts_as: 'attended',
  },
  absence: {
    notice_min_hours: 12,
    timely_earns_makeup: true,
    late_notice_charge: 'charged_no_makeup',
    no_show_charge: 'charged_no_makeup',
  },
  makeup: {
    enabled: true,
    max_per_month: 1,
    expiry: 'end_of_source_month',
    requires_active_subscription: true,
    self_booking: true,
    double_lesson_allowed: false,
    enforcement: 'strict_with_override',
    level_tolerance: 1,
  },
  closure: {
    school_makeup: 'guaranteed',
    external_makeup: 'best_effort',
    external_refund: 'none',
    event_end_rule: 'expire',
    makeup_cap_bypass: true,
  },
  calendar: {
    no_lessons_on: [
      'shabbat',
      'erev_chag',
      'yom_tov',
      'yom_kippur',
      'tisha_bav',
      'yom_hazikaron_evening',
    ],
    chol_hamoed: 'skip',
    holiday_makeup: 'none',
    holiday_notice_days_before: 3,
  },
  health: {
    declaration_required: true,
    declaration_valid_months: 12,
    sick_children_allowed: false,
  },
  consent: { photo_default: 'granted_unless_opt_out' },
  regulations: { acceptance_required: true },
  venue: {
    companions_per_child: 1,
    entry_window: 'lesson_time_only',
    father_escort_in_women_hours: false,
  },
  enrollment: { transfers_allowed: true },
  payroll: { pension_threshold_months: 3, sick_leave_accrual_halfdays_per_month: 3 },
  scheduling: {
    travel_buffer_min: 30,
    window_instructor_gender: 'match_window',
    open_group_min_waiting: 5,
  },
  staffing: {
    shift_change_requires_acceptance: true,
    shift_change_escalate_after_hours: 12,
    substitute_wave_size: 3,
    substitute_wave_minutes: 30,
  },
  transport: { stale_after_min: 30, short_water_warn_min: 5 },
  camp: { children_per_staff: 8 },
  migration: { revert_hours: 24 },
  copilot: { enabled: false },
  digest: {
    enabled: true,
    high_occupancy_pct: 90,
    low_occupancy_pct: 40,
    debt_attention_days: 60,
  },
  comms: {
    quiet_hours_start: '21:30',
    quiet_hours_end: '08:00',
    block_shabbat_and_chag: true,
    lead_followup_max_nudges: 3,
    reminder_before_lesson_hours: 2,
    rate_per_minute: 20,
    holiday_notice_days_before: 2,
    ai_triage: false,
    triage_min_confidence_pct: 80,
  },
};
