/**
 * The club's rules screen: the owner or the manager writes a new version of the rules (sea limits, ratios, depth
 * progression, paperwork, bookings, passes) from a date. Versions are kept: every decision in the system (closing the
 * sea, the deepest allowed target) reads the version in effect on its date, so the past never changes. A version
 * dated today or later may be corrected on the same date; older ones stay as they were.
 */
import { z } from 'zod';
import {
  DIVE_INSURANCE_MODES,
  DIVE_LEVELS,
  DIVE_PASS_KINDS,
  DiveRules,
  optionalText,
  requiredDate,
  resolveDiveRules,
  type ResolvedDiveRules,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { guarded, rows, todayIL } from './shared';

const num = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.int('forms.errors.invalid').min(min, 'forms.errors.invalid').max(max, 'forms.errors.invalid'),
  );
/** Shekels from the form (e.g. "820" or "820.50") into agorot. */
const shekels = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Math.round(Number(v) * 100)),
  z.int('forms.errors.invalid').min(0).max(10_000_000),
);
/** Sessions on a pass: empty = unlimited. */
const sessionsOrNone = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.int('forms.errors.invalid').min(1).max(200).nullable(),
);
const checkbox = z
  .union([z.boolean(), z.literal('on')])
  .optional()
  .transform((v) => v === true || v === 'on');

const levelFields = Object.fromEntries(
  DIVE_LEVELS.map((l) => [`depth_level_${l}`, num(0, 150)]),
) as Record<`depth_level_${(typeof DIVE_LEVELS)[number]}`, ReturnType<typeof num>>;
const passFields = Object.fromEntries(
  DIVE_PASS_KINDS.flatMap((k) => [
    [`pass_${k}_price`, shekels],
    [`pass_${k}_sessions`, sessionsOrNone],
    [`pass_${k}_days`, num(1, 800)],
  ]),
) as Record<string, z.ZodType>;

/** The rules form: one flat field per rule, so every rule has its own label and error. */
export const RulesInput = z
  .object({
    effectiveFrom: requiredDate(),
    notes: optionalText(300),
    sea_max_wind_kts: num(5, 50),
    sea_caution_wind_kts: num(3, 50),
    sea_max_wave_cm: num(10, 400),
    sea_caution_wave_cm: num(10, 400),
    sea_min_visibility_m: num(1, 50),
    sea_strong_current_no_go: checkbox,
    ratio_experience: num(1, 12),
    ratio_course: num(1, 12),
    ratio_training: num(1, 12),
    ratio_workshop: num(1, 40),
    ratio_trip: num(1, 20),
    depth_progression_step_m: num(0, 10),
    ...levelFields,
    paperwork_medical_valid_months: num(1, 36),
    paperwork_waiver_valid_months: num(1, 36),
    paperwork_medical_warn_days: num(0, 90),
    paperwork_insurance: z.enum(DIVE_INSURANCE_MODES),
    paperwork_insurance_warn_days: num(0, 90),
    staff_cert_warn_days: num(0, 120),
    gear_rental_grace_min: num(0, 240),
    booking_require_payment: checkbox,
    booking_payment_hold_minutes: num(5, 1440),
    registration_self_signup: checkbox,
    ...passFields,
  })
  .superRefine((r, ctx) => {
    if (r.sea_caution_wind_kts > r.sea_max_wind_kts)
      ctx.addIssue({
        code: 'custom',
        message: 'dive.rules.errors.cautionAboveMax',
        path: ['sea_caution_wind_kts'],
      });
    if (r.sea_caution_wave_cm > r.sea_max_wave_cm)
      ctx.addIssue({
        code: 'custom',
        message: 'dive.rules.errors.cautionAboveMax',
        path: ['sea_caution_wave_cm'],
      });
    const levels = DIVE_LEVELS.map((l) => r[`depth_level_${l}`] as number);
    for (let i = 1; i < levels.length; i++) {
      if ((levels[i] as number) < (levels[i - 1] as number))
        ctx.addIssue({
          code: 'custom',
          message: 'dive.rules.errors.levelsOrder',
          path: [`depth_level_${i}`],
        });
    }
  });
export type RulesInput = z.output<typeof RulesInput>;

/** The form's flat fields into the stored shape (every rule written out, so a version stands on its own). */
export function rulesFromForm(r: RulesInput): ResolvedDiveRules {
  const f = r as unknown as Record<string, unknown>;
  const passes = Object.fromEntries(
    DIVE_PASS_KINDS.map((k) => [
      k,
      {
        price_agorot: f[`pass_${k}_price`] as number,
        sessions: f[`pass_${k}_sessions`] as number | null,
        valid_days: f[`pass_${k}_days`] as number,
      },
    ]),
  ) as ResolvedDiveRules['passes'];
  const rules: ResolvedDiveRules = {
    sea: {
      max_wind_kts: r.sea_max_wind_kts,
      caution_wind_kts: r.sea_caution_wind_kts,
      max_wave_cm: r.sea_max_wave_cm,
      caution_wave_cm: r.sea_caution_wave_cm,
      min_visibility_m: r.sea_min_visibility_m,
      strong_current_no_go: r.sea_strong_current_no_go,
    },
    ratio: {
      experience: r.ratio_experience,
      course: r.ratio_course,
      training: r.ratio_training,
      workshop: r.ratio_workshop,
      trip: r.ratio_trip,
    },
    depth: {
      progression_step_m: r.depth_progression_step_m,
      level_max_m: DIVE_LEVELS.map((l) => f[`depth_level_${l}`] as number),
    },
    paperwork: {
      medical_valid_months: r.paperwork_medical_valid_months,
      waiver_valid_months: r.paperwork_waiver_valid_months,
      medical_warn_days: r.paperwork_medical_warn_days,
      insurance: r.paperwork_insurance,
      insurance_warn_days: r.paperwork_insurance_warn_days,
    },
    staff: { cert_warn_days: r.staff_cert_warn_days },
    gear: { rental_grace_min: r.gear_rental_grace_min },
    booking: {
      require_payment: r.booking_require_payment,
      payment_hold_minutes: r.booking_payment_hold_minutes,
    },
    registration: { self_signup: r.registration_self_signup },
    passes,
  };
  // The stored schema is the gate: anything it refuses never reaches the database.
  DiveRules.parse(rules);
  return rules;
}

export interface RuleVersion {
  id: string;
  effectiveFrom: string;
  notes: string | null;
  createdAt: Date;
  rules: ResolvedDiveRules;
}

/** Every version, newest first, each resolved on top of the defaults. */
export async function ruleVersions(tx: Tx): Promise<RuleVersion[]> {
  const list = await rows<{
    id: string;
    effective_from: string;
    notes: string | null;
    created_at: Date;
    rules: unknown;
  }>(
    tx,
    sql`select id, effective_from::text, notes, created_at, rules
        from dive_rule_sets order by effective_from desc`,
  );
  return list.map((v) => {
    const parsed = DiveRules.safeParse(v.rules);
    return {
      id: v.id,
      effectiveFrom: v.effective_from,
      notes: v.notes,
      createdAt: v.created_at,
      rules: resolveDiveRules(parsed.success ? parsed.data : null),
    };
  });
}

/**
 * Saves the rules as a version from a date (today or later). A version already on that date is replaced; versions
 * before today are history and are never touched. The database checks `settings.write` (owner and manager).
 * Takes the parsed form (RulesInput's output).
 */
export async function saveRules(tx: Tx, ctx: ServiceContext, input: RulesInput) {
  if (input.effectiveFrom < (await todayIL(tx))) throw new DomainError('dive.rules.errors.past');
  const rules = rulesFromForm(input);
  await guarded(() =>
    tx.execute(
      sql`insert into dive_rule_sets (organization_id, effective_from, rules, notes, created_by)
          values (${ctx.orgId}, ${input.effectiveFrom}, ${JSON.stringify(rules)}::jsonb, ${input.notes ?? null},
                  ${ctx.userId})
          on conflict (organization_id, effective_from)
          do update set rules = excluded.rules, notes = excluded.notes, created_by = excluded.created_by`,
    ),
  );
  return input.effectiveFrom;
}
