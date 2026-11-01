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

/** `pending_payment` holds a seat until `hold_until`; it is not a confirmed booking until it is paid. */
export const DIVE_BOOKING_STATUSES = [
  'pending_payment',
  'booked',
  'checked_in',
  'no_show',
  'cancelled',
] as const;
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

/**
 * Filters on the staff's diver list. Every one is optional and they combine (all must hold). The windows below define
 * what the list calls "recent", "lapsed" and "ending soon"; they describe a view, not a club rule.
 */
export const DIVER_FILTER_WINDOWS = { recentDays: 30, lapsedDays: 90, passEndingDays: 14 } as const;
export const DIVER_FILTER_MEDICAL = ['ok', 'warn', 'expired', 'missing'] as const;
export const DIVER_FILTER_WAIVER = ['valid', 'missing'] as const;
export const DIVER_FILTER_PASS = ['active', 'ending', 'none'] as const;
export const DIVER_FILTER_BALANCE = ['owes', 'clear'] as const;
export const DIVER_FILTER_ACTIVITY = ['recent', 'lapsed', 'never'] as const;
export const DIVER_FILTER_UPCOMING = ['booked', 'none'] as const;
export const DIVER_SORTS = ['value', 'name', 'last', 'pb', 'level'] as const;
export type DiverSort = (typeof DIVER_SORTS)[number];

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional()).catch(undefined);

export const DiverFilterSchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  level: z
    .preprocess(blankToUndefined, z.coerce.number().int().min(0).max(5).optional())
    .catch(undefined),
  origin: optionalEnum(DIVER_ORIGINS),
  medical: optionalEnum(DIVER_FILTER_MEDICAL),
  insurance: optionalEnum(DIVER_FILTER_MEDICAL),
  waiver: optionalEnum(DIVER_FILTER_WAIVER),
  pass: optionalEnum(DIVER_FILTER_PASS),
  balance: optionalEnum(DIVER_FILTER_BALANCE),
  activity: optionalEnum(DIVER_FILTER_ACTIVITY),
  upcoming: optionalEnum(DIVER_FILTER_UPCOMING),
  tag: z
    .preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^[a-z_]{1,40}$/)
        .optional(),
    )
    .catch(undefined),
  sort: z.preprocess(blankToUndefined, z.enum(DIVER_SORTS).default('value')).catch('value'),
});
export type DiverFilter = z.infer<typeof DiverFilterSchema>;

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
export const PAY_METHODS = ['card', 'cash', 'bit', 'transfer', 'pass', 'comp'] as const;
/** `comp`: the desk gave it without charge. Recorded as a zero sale, so the owner sees who gave what. */
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

/**
 * The club's forms a diver signs: the health declaration (yes/no questions; a "yes" on a flagged question waits for
 * the club's medical clearance), the liability waiver, and the diver's own insurance (insurer, policy, valid until).
 */
export const DIVE_FORM_KINDS = ['health', 'waiver', 'insurance'] as const;
export type DiveFormKind = (typeof DIVE_FORM_KINDS)[number];
/** Where it was signed: by the diver on their phone, or on the club's tablet at the desk. */
export const DIVE_FORM_CHANNELS = ['online', 'desk'] as const;
export type DiveFormChannel = (typeof DIVE_FORM_CHANNELS)[number];
/**
 * `none` nothing to review; `pending` a flagged health answer waits for the club; `cleared` the club (with a
 * doctor's note) let the diver in the water; `refused` not cleared, the declaration does not count.
 */
export const DIVE_FORM_REVIEWS = ['none', 'pending', 'cleared', 'refused'] as const;
export type DiveFormReview = (typeof DIVE_FORM_REVIEWS)[number];
/** How the club treats insurance: not asked, asked and tracked (warns), or required to get in the water. */
export const DIVE_INSURANCE_MODES = ['off', 'track', 'require'] as const;
export type DiveInsuranceMode = (typeof DIVE_INSURANCE_MODES)[number];

/**
 * A diver's certification card as they uploaded it: `pending` until the club checks it, then `verified` (the diver's
 * level follows it) or `rejected`. The desk may record a card it saw as verified right away.
 */
export const DIVE_CERT_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type DiveCertStatus = (typeof DIVE_CERT_STATUSES)[number];
/** Agencies a diver may hold a card from: the club's teaching agencies, CMAS, or another one. */
export const DIVE_CERT_AGENCIES = ['molchanovs', 'aida', 'ssi', 'padi', 'cmas', 'other'] as const;
export type DiveCertAgency = (typeof DIVE_CERT_AGENCIES)[number];

/** A yes/no question on a form. `flag`: a "yes" needs the club's medical clearance. */
export const DiveFormQuestion = z
  .object({
    code: z.string().regex(/^[a-z0-9_]{1,40}$/),
    he: z.string().trim().min(1).max(400),
    flag: z.boolean(),
  })
  .strict();
export type DiveFormQuestion = z.infer<typeof DiveFormQuestion>;
export const DiveFormQuestions = z.array(DiveFormQuestion).max(40);

/**
 * A drawn signature: strokes of points on a 600x200 pad. Stored as points, never as markup, and drawn back as SVG by
 * the app.
 */
export const SIGNATURE_PAD = { width: 600, height: 200, maxPoints: 4000 } as const;
export const SignatureStrokes = z
  .array(
    z
      .array(
        z.tuple([
          z.int().min(0).max(SIGNATURE_PAD.width),
          z.int().min(0).max(SIGNATURE_PAD.height),
        ]),
      )
      .min(1)
      .max(SIGNATURE_PAD.maxPoints),
  )
  .min(1)
  .max(200)
  .refine(
    (s) => s.reduce((n, x) => n + x.length, 0) <= SIGNATURE_PAD.maxPoints,
    'dive.errors.signatureMissing',
  )
  .refine((s) => s.reduce((n, x) => n + x.length, 0) >= 8, 'dive.errors.signatureMissing');
export type SignatureStrokes = z.infer<typeof SignatureStrokes>;

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
const PassProductSchema = z
  .object({
    price_agorot: int(0, 10_000_000),
    sessions: int(1, 200).nullable(),
    valid_days: int(1, 800),
  })
  .strict();

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
        /** Insurance: not asked, tracked (warns), or required to get in the water. */
        insurance: z.enum(DIVE_INSURANCE_MODES),
        insurance_warn_days: int(0, 90),
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
    booking: z
      .object({
        /** A paid session is confirmed only once paid; until then it holds the seat. */
        require_payment: z.boolean(),
        /** How long an online booking holds its seat while the diver pays. */
        payment_hold_minutes: int(5, 1440),
      })
      .partial()
      .strict(),
    registration: z
      .object({
        /** Anyone with the club's join link may sign up as a diver. */
        self_signup: z.boolean(),
      })
      .partial()
      .strict(),
    /** What each pass costs, how many sessions it holds (none = unlimited) and how long it is valid. */
    passes: z
      .object({
        punch5: PassProductSchema,
        punch10: PassProductSchema,
        monthly: PassProductSchema,
        annual: PassProductSchema,
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type DiveRules = z.infer<typeof DiveRules>;
export interface PassProduct {
  price_agorot: number;
  sessions: number | null;
  valid_days: number;
}

export interface ResolvedDiveRules {
  sea: Required<NonNullable<DiveRules['sea']>>;
  ratio: Required<NonNullable<DiveRules['ratio']>>;
  depth: Required<NonNullable<DiveRules['depth']>>;
  paperwork: Required<NonNullable<DiveRules['paperwork']>>;
  staff: Required<NonNullable<DiveRules['staff']>>;
  gear: Required<NonNullable<DiveRules['gear']>>;
  booking: Required<NonNullable<DiveRules['booking']>>;
  registration: Required<NonNullable<DiveRules['registration']>>;
  passes: Record<DivePassKind, PassProduct>;
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
  paperwork: {
    medical_valid_months: 12,
    waiver_valid_months: 12,
    medical_warn_days: 30,
    insurance: 'track',
    insurance_warn_days: 30,
  },
  staff: { cert_warn_days: 30 },
  gear: { rental_grace_min: 30 },
  booking: { require_payment: true, payment_hold_minutes: 30 },
  registration: { self_signup: true },
  passes: {
    punch5: { price_agorot: 82000, sessions: 5, valid_days: 120 },
    punch10: { price_agorot: 150000, sessions: 10, valid_days: 120 },
    monthly: { price_agorot: 69000, sessions: null, valid_days: 30 },
    annual: { price_agorot: 590000, sessions: null, valid_days: 365 },
  },
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
    booking: { ...DEFAULT_DIVE_RULES.booking, ...r.booking },
    registration: { ...DEFAULT_DIVE_RULES.registration, ...r.registration },
    passes: { ...DEFAULT_DIVE_RULES.passes, ...r.passes },
  };
}
