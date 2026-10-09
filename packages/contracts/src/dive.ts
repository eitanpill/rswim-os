/**
 * The freediving vertical (docs/FREEDIVING.md): a club's dive sites, programs (try-dives, agency courses, line
 * training, workshops, boat trips), scheduled sessions with bookings, every logged dive, safety incidents, rental gear,
 * passes, sales, the daily sea call, leads and staff certifications. Values here are shared by the database CHECKs,
 * the Zod inputs and the screens.
 */
import { z } from 'zod';

/** A school's kind of business. Swim schools and freediving clubs run on the same platform. */
export const VERTICALS = ['swim', 'freediving'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const DIVE_SITE_KINDS = ['shore', 'boat', 'pool'] as const;
export type DiveSiteKind = (typeof DIVE_SITE_KINDS)[number];

/** Certifying agencies a club teaches under; `club` is the club's own non-certifying program. */
export const DIVE_AGENCIES = ['molchanovs', 'aida', 'ssi', 'padi', 'club'] as const;
export type DiveAgency = (typeof DIVE_AGENCIES)[number];

export const DIVE_PROGRAM_KINDS = ['experience', 'course', 'training', 'workshop', 'trip'] as const;
export type DiveProgramKind = (typeof DIVE_PROGRAM_KINDS)[number];

/**
 * One ladder across agencies, so eligibility can compare a Molchanovs diver with an AIDA one:
 * 0 none, 1 tried it (discover), 2 beginner (Wave 1 / AIDA 2), 3 intermediate (Wave 2 / AIDA 3),
 * 4 advanced (Wave 3 / AIDA 4), 5 instructor.
 */
export const DIVE_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type DiveLevel = (typeof DIVE_LEVELS)[number];

export const DIVE_SESSION_STATUSES = ['scheduled', 'go', 'hold', 'cancelled', 'done'] as const;
export type DiveSessionStatus = (typeof DIVE_SESSION_STATUSES)[number];

export const DIVE_BOOKING_STATUSES = ['booked', 'checked_in', 'no_show', 'cancelled'] as const;
export type DiveBookingStatus = (typeof DIVE_BOOKING_STATUSES)[number];

export const DIVE_BOOKED_VIA = ['office', 'online', 'instructor', 'whatsapp'] as const;

/** AIDA / CMAS discipline codes. Depth ones log metres down, pool ones distance or time. */
export const DIVE_DISCIPLINES = [
  'CWT',
  'CWTB',
  'CNF',
  'FIM',
  'VWT',
  'STA',
  'DYN',
  'DYNB',
  'DNF',
] as const;
export const DiveDiscipline = z.enum(DIVE_DISCIPLINES);
export type DiveDiscipline = z.infer<typeof DiveDiscipline>;
export const DEPTH_DISCIPLINES: readonly DiveDiscipline[] = ['CWT', 'CWTB', 'CNF', 'FIM', 'VWT'];
export const DISTANCE_DISCIPLINES: readonly DiveDiscipline[] = ['DYN', 'DYNB', 'DNF'];

/** How a dive ended. lmc = loss of motor control (samba). */
export const DIVE_OUTCOMES = ['clean', 'early_turn', 'lmc', 'blackout', 'squeeze', 'ear'] as const;
export const DiveOutcome = z.enum(DIVE_OUTCOMES);
export type DiveOutcome = z.infer<typeof DiveOutcome>;

export const DIVE_INCIDENT_KINDS = [
  'blackout',
  'lmc',
  'squeeze',
  'barotrauma',
  'marine_life',
  'cut',
  'equipment',
  'other',
] as const;
export const DiveIncidentKind = z.enum(DIVE_INCIDENT_KINDS);
export const DIVE_SEVERITIES = ['low', 'medium', 'high'] as const;
export const DiveSeverity = z.enum(DIVE_SEVERITIES);
export type DiveSeverity = z.infer<typeof DiveSeverity>;
export const DIVE_INCIDENT_STATUSES = ['open', 'closed'] as const;

export const DIVE_ENROLLMENT_STATUSES = ['active', 'completed', 'dropped'] as const;

export const GEAR_KINDS = [
  'fins',
  'monofin',
  'mask',
  'snorkel',
  'wetsuit',
  'weight_belt',
  'neck_weight',
  'lanyard',
  'computer',
  'buoy',
  'noseclip',
] as const;
export type GearKind = (typeof GEAR_KINDS)[number];
export const GEAR_STATUSES = ['available', 'rented', 'maintenance', 'retired'] as const;
export type GearStatus = (typeof GEAR_STATUSES)[number];

/** Where a diver comes from: Eilat locals, Israelis visiting from the rest of the country, guests from abroad. */
export const DIVER_ORIGINS = ['eilat', 'israel', 'abroad'] as const;
export type DiverOrigin = (typeof DIVER_ORIGINS)[number];

export const LEAD_STAGES = ['new', 'contacted', 'booked', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SOURCES = [
  'instagram',
  'google',
  'referral',
  'hotel',
  'walk_in',
  'whatsapp',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const DIVE_PASS_KINDS = ['punch5', 'punch10', 'monthly', 'annual'] as const;
export type DivePassKind = (typeof DIVE_PASS_KINDS)[number];

export const DIVE_SALE_KINDS = [
  'course',
  'training',
  'experience',
  'workshop',
  'trip',
  'pass',
  'rental',
  'retail',
] as const;
export type DiveSaleKind = (typeof DIVE_SALE_KINDS)[number];
export const PAY_METHODS = ['card', 'cash', 'bit', 'transfer', 'pass'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/** The day's sea call for a site. */
export const SEA_CALLS = ['go', 'caution', 'no_go'] as const;
export type SeaCall = (typeof SEA_CALLS)[number];
export const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const CURRENTS = ['none', 'light', 'strong'] as const;

export const STAFF_CERT_KINDS = [
  'instructor',
  'first_aid',
  'oxygen',
  'insurance',
  'boat_license',
] as const;
export type StaffCertKind = (typeof STAFF_CERT_KINDS)[number];

/** Course skills an instructor ticks off, per level (agency-neutral wording). */
export const COURSE_SKILLS = {
  2: [
    'breathe_up',
    'recovery_breath',
    'duck_dive',
    'frenzel',
    'free_immersion',
    'buddy_rescue',
    'sta_2min',
    'cwt_12m',
  ],
  3: [
    'mouthfill_intro',
    'freefall',
    'lanyard_rescue',
    'sta_3min',
    'dyn_50m',
    'cwt_24m',
    'blackout_rescue_depth',
  ],
  4: ['mouthfill', 'co2_tables', 'sta_4min', 'dyn_75m', 'cwt_32m', 'deep_safety'],
} as const satisfies Record<number, readonly string[]>;

/**
 * The club's safety and operating rules (versioned in dive_rule_sets, effective-dated). Every key is optional in a
 * stored version; DEFAULT_DIVE_RULES fills the rest.
 */
const int = (min: number, max: number) => z.int().min(min).max(max);
export const DiveRules = z
  .object({
    sea: z
      .object({
        /** Above this wind the sea call is no-go; between caution and max it is caution. */
        max_wind_kts: int(5, 50),
        caution_wind_kts: int(3, 50),
        max_wave_cm: int(10, 400),
        caution_wave_cm: int(10, 400),
        min_visibility_m: int(1, 50),
        strong_current_no_go: z.boolean(),
      })
      .partial()
      .strict(),
    ratio: z
      .object({
        /** Divers per instructor in the water. */
        experience: int(1, 12),
        course: int(1, 12),
        training: int(1, 12),
        workshop: int(1, 40),
        trip: int(1, 20),
      })
      .partial()
      .strict(),
    depth: z
      .object({
        /** How much deeper than their personal best a diver may target in one session. */
        progression_step_m: int(0, 10),
        /** Deepest target per certification level (index = DIVE_LEVELS). */
        level_max_m: z.array(int(0, 150)).length(6),
      })
      .partial()
      .strict(),
    paperwork: z
      .object({
        medical_valid_months: int(1, 36),
        waiver_valid_months: int(1, 36),
        medical_warn_days: int(0, 90),
      })
      .partial()
      .strict(),
    staff: z
      .object({
        cert_warn_days: int(0, 120),
      })
      .partial()
      .strict(),
    gear: z
      .object({
        rental_grace_min: int(0, 240),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type DiveRules = z.infer<typeof DiveRules>;

export interface ResolvedDiveRules {
  sea: Required<NonNullable<DiveRules['sea']>>;
  ratio: Required<NonNullable<DiveRules['ratio']>>;
  depth: Required<NonNullable<DiveRules['depth']>>;
  paperwork: Required<NonNullable<DiveRules['paperwork']>>;
  staff: Required<NonNullable<DiveRules['staff']>>;
  gear: Required<NonNullable<DiveRules['gear']>>;
}

/** Sensible defaults for an Eilat club (fake demo numbers, not safety advice). */
export const DEFAULT_DIVE_RULES: ResolvedDiveRules = {
  sea: {
    max_wind_kts: 20,
    caution_wind_kts: 14,
    max_wave_cm: 120,
    caution_wave_cm: 70,
    min_visibility_m: 8,
    strong_current_no_go: true,
  },
  ratio: { experience: 4, course: 4, training: 6, workshop: 16, trip: 8 },
  depth: { progression_step_m: 3, level_max_m: [5, 10, 20, 30, 40, 100] },
  paperwork: { medical_valid_months: 12, waiver_valid_months: 12, medical_warn_days: 30 },
  staff: { cert_warn_days: 30 },
  gear: { rental_grace_min: 30 },
};

/** A stored version's overrides on top of the defaults. */
export function resolveDiveRules(rules: DiveRules | null | undefined): ResolvedDiveRules {
  const r = rules ?? {};
  return {
    sea: { ...DEFAULT_DIVE_RULES.sea, ...r.sea },
    ratio: { ...DEFAULT_DIVE_RULES.ratio, ...r.ratio },
    depth: { ...DEFAULT_DIVE_RULES.depth, ...r.depth },
    paperwork: { ...DEFAULT_DIVE_RULES.paperwork, ...r.paperwork },
    staff: { ...DEFAULT_DIVE_RULES.staff, ...r.staff },
    gear: { ...DEFAULT_DIVE_RULES.gear, ...r.gear },
  };
}
