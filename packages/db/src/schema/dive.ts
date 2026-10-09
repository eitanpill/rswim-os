/**
 * The freediving vertical (docs/FREEDIVING.md). A club runs sessions at dive sites (shore line training, boat trips,
 * pool), books divers into them, logs every dive, keeps a safety log, rents gear, sells passes and keeps the day's
 * sea call. Rules (sea limits, ratios, depth progression, paperwork) are versioned in dive_rule_sets.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CURRENTS,
  DIVE_AGENCIES,
  DIVE_BOOKED_VIA,
  DIVE_BOOKING_STATUSES,
  DIVE_DISCIPLINES,
  DIVE_ENROLLMENT_STATUSES,
  DIVE_INCIDENT_KINDS,
  DIVE_INCIDENT_STATUSES,
  DIVE_OUTCOMES,
  DIVE_PASS_KINDS,
  DIVE_PROGRAM_KINDS,
  DIVE_SALE_KINDS,
  DIVE_SESSION_STATUSES,
  DIVE_SEVERITIES,
  DIVE_SITE_KINDS,
  DIVER_ORIGINS,
  GEAR_KINDS,
  GEAR_STATUSES,
  LEAD_SOURCES,
  LEAD_STAGES,
  PAY_METHODS,
  SEA_CALLS,
  STAFF_CERT_KINDS,
  WIND_DIRS,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { guardians, staffMembers } from './people';
import { organizations } from './tenancy';

const orgRef = () => orgId().references(() => organizations.id, { onDelete: 'cascade' });
const oneOf = (col: string, values: readonly string[]) => sql.raw(`${col} in (${inList(values)})`);

/** The club's rules, effective-dated. The latest version on or before a date applies. */
export const diveRuleSets = pgTable(
  'dive_rule_sets',
  {
    id: id(),
    organizationId: orgRef(),
    effectiveFrom: date('effective_from').notNull(),
    rules: jsonb('rules').notNull().default({}),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('dive_rule_sets_org_id').on(t.organizationId, t.id),
    unique('dive_rule_sets_org_from').on(t.organizationId, t.effectiveFrom),
  ],
);

export const diveSites = pgTable(
  'dive_sites',
  {
    id: id(),
    organizationId: orgRef(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    kind: text('kind').notNull(),
    maxDepthM: smallint('max_depth_m').notNull(),
    hasLine: boolean('has_line').notNull().default(true),
    meetingPoint: text('meeting_point'),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_sites_org_id').on(t.organizationId, t.id),
    unique('dive_sites_org_name').on(t.organizationId, t.name),
    check('dive_sites_kind_check', oneOf('kind', DIVE_SITE_KINDS)),
  ],
);

export const divePrograms = pgTable(
  'dive_programs',
  {
    id: id(),
    organizationId: orgRef(),
    code: text('code').notNull(),
    nameHe: text('name_he').notNull(),
    nameEn: text('name_en').notNull(),
    kind: text('kind').notNull(),
    agency: text('agency').notNull().default('club'),
    /** Certification level needed to join (DIVE_LEVELS). */
    minLevel: smallint('min_level').notNull().default(0),
    /** Level a diver holds after completing it (courses only). */
    grantsLevel: smallint('grants_level'),
    days: smallint('days').notNull().default(1),
    durationMin: smallint('duration_min').notNull().default(150),
    maxDepthM: smallint('max_depth_m'),
    priceAgorot: integer('price_agorot').notNull(),
    color: text('color'),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_programs_org_id').on(t.organizationId, t.id),
    unique('dive_programs_org_code').on(t.organizationId, t.code),
    check('dive_programs_kind_check', oneOf('kind', DIVE_PROGRAM_KINDS)),
    check('dive_programs_agency_check', oneOf('agency', DIVE_AGENCIES)),
    check(
      'dive_programs_level_check',
      sql`min_level between 0 and 5 and (grants_level is null or grants_level between 0 and 5)`,
    ),
    check('dive_programs_price_check', sql`price_agorot >= 0`),
  ],
);

/** A customer of the club. Linked to a guardian (themself) when they sign in to the customer app. */
export const diveDivers = pgTable(
  'dive_divers',
  {
    id: id(),
    organizationId: orgRef(),
    guardianId: uuid('guardian_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phoneE164: text('phone_e164'),
    email: text('email'),
    origin: text('origin').notNull().default('israel'),
    city: text('city'),
    country: text('country'),
    dob: date('dob'),
    gender: text('gender'),
    certLevel: smallint('cert_level').notNull().default(0),
    certAgency: text('cert_agency'),
    certName: text('cert_name'),
    certNumber: text('cert_number'),
    pbCwtM: smallint('pb_cwt_m'),
    pbFimM: smallint('pb_fim_m'),
    pbStaSec: smallint('pb_sta_sec'),
    pbDynM: smallint('pb_dyn_m'),
    /** Deepest target an instructor has cleared this diver for (null = by the rules). */
    depthLimitM: smallint('depth_limit_m'),
    medicalExpiresOn: date('medical_expires_on'),
    waiverSignedOn: date('waiver_signed_on'),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    source: text('source'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    joinedOn: date('joined_on')
      .notNull()
      .default(sql`current_date`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_divers_org_id').on(t.organizationId, t.id),
    index('dive_divers_org_guardian').on(t.organizationId, t.guardianId),
    foreignKey({
      name: 'dive_divers_guardian_fk',
      columns: [t.organizationId, t.guardianId],
      foreignColumns: [guardians.organizationId, guardians.id],
    }),
    check('dive_divers_origin_check', oneOf('origin', DIVER_ORIGINS)),
    check('dive_divers_level_check', sql`cert_level between 0 and 5`),
    check('dive_divers_gender_check', sql`gender is null or gender in ('female', 'male')`),
  ],
);

export const diveSessions = pgTable(
  'dive_sessions',
  {
    id: id(),
    organizationId: orgRef(),
    programId: uuid('program_id').notNull(),
    siteId: uuid('site_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    leadStaffId: uuid('lead_staff_id'),
    assistStaffId: uuid('assist_staff_id'),
    capacity: smallint('capacity').notNull(),
    status: text('status').notNull().default('scheduled'),
    title: text('title'),
    boat: text('boat'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_sessions_org_id').on(t.organizationId, t.id),
    index('dive_sessions_org_starts').on(t.organizationId, t.startsAt),
    foreignKey({
      name: 'dive_sessions_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [divePrograms.organizationId, divePrograms.id],
    }),
    foreignKey({
      name: 'dive_sessions_site_fk',
      columns: [t.organizationId, t.siteId],
      foreignColumns: [diveSites.organizationId, diveSites.id],
    }),
    check('dive_sessions_status_check', oneOf('status', DIVE_SESSION_STATUSES)),
    check('dive_sessions_time_check', sql`ends_at > starts_at`),
    check('dive_sessions_capacity_check', sql`capacity between 1 and 60`),
  ],
);

export const divePasses = pgTable(
  'dive_passes',
  {
    id: id(),
    organizationId: orgRef(),
    diverId: uuid('diver_id').notNull(),
    kind: text('kind').notNull(),
    sessionsTotal: smallint('sessions_total'),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until').notNull(),
    priceAgorot: integer('price_agorot').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_passes_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'dive_passes_diver_fk',
      columns: [t.organizationId, t.diverId],
      foreignColumns: [diveDivers.organizationId, diveDivers.id],
    }).onDelete('cascade'),
    check('dive_passes_kind_check', oneOf('kind', DIVE_PASS_KINDS)),
    check('dive_passes_dates_check', sql`valid_until >= valid_from`),
  ],
);

export const diveBookings = pgTable(
  'dive_bookings',
  {
    id: id(),
    organizationId: orgRef(),
    sessionId: uuid('session_id').notNull(),
    diverId: uuid('diver_id').notNull(),
    status: text('status').notNull().default('booked'),
    targetDepthM: smallint('target_depth_m'),
    lineLabel: text('line_label'),
    buddyDiverId: uuid('buddy_diver_id'),
    passId: uuid('pass_id'),
    priceAgorot: integer('price_agorot').notNull().default(0),
    bookedVia: text('booked_via').notNull().default('office'),
    /** The rule set the booking was checked against. */
    ruleSetId: uuid('rule_set_id'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_bookings_org_id').on(t.organizationId, t.id),
    unique('dive_bookings_session_diver').on(t.sessionId, t.diverId),
    index('dive_bookings_org_diver').on(t.organizationId, t.diverId),
    foreignKey({
      name: 'dive_bookings_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [diveSessions.organizationId, diveSessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dive_bookings_diver_fk',
      columns: [t.organizationId, t.diverId],
      foreignColumns: [diveDivers.organizationId, diveDivers.id],
    }).onDelete('cascade'),
    check('dive_bookings_status_check', oneOf('status', DIVE_BOOKING_STATUSES)),
    check('dive_bookings_via_check', oneOf('booked_via', DIVE_BOOKED_VIA)),
  ],
);

/** One dive (or pool attempt) by one diver. */
export const diveLogs = pgTable(
  'dive_logs',
  {
    id: id(),
    organizationId: orgRef(),
    diverId: uuid('diver_id').notNull(),
    sessionId: uuid('session_id'),
    divedOn: date('dived_on').notNull(),
    discipline: text('discipline').notNull(),
    depthM: smallint('depth_m'),
    distanceM: smallint('distance_m'),
    durationSec: smallint('duration_sec'),
    outcome: text('outcome').notNull().default('clean'),
    notes: text('notes'),
    recordedBy: uuid('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dive_logs_org_id').on(t.organizationId, t.id),
    index('dive_logs_org_diver').on(t.organizationId, t.diverId, t.divedOn),
    foreignKey({
      name: 'dive_logs_diver_fk',
      columns: [t.organizationId, t.diverId],
      foreignColumns: [diveDivers.organizationId, diveDivers.id],
    }).onDelete('cascade'),
    check('dive_logs_discipline_check', oneOf('discipline', DIVE_DISCIPLINES)),
    check('dive_logs_outcome_check', oneOf('outcome', DIVE_OUTCOMES)),
    check('dive_logs_measure_check', sql`coalesce(depth_m, distance_m, duration_sec) is not null`),
  ],
);

export const diveIncidents = pgTable(
  'dive_incidents',
  {
    id: id(),
    organizationId: orgRef(),
    sessionId: uuid('session_id'),
    diverId: uuid('diver_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    depthM: smallint('depth_m'),
    description: text('description').notNull(),
    actionTaken: text('action_taken'),
    status: text('status').notNull().default('open'),
    reportedBy: uuid('reported_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_incidents_org_id').on(t.organizationId, t.id),
    check('dive_incidents_kind_check', oneOf('kind', DIVE_INCIDENT_KINDS)),
    check('dive_incidents_severity_check', oneOf('severity', DIVE_SEVERITIES)),
    check('dive_incidents_status_check', oneOf('status', DIVE_INCIDENT_STATUSES)),
  ],
);

/** A diver in a course: which skills are done, theory score, the certificate issued. */
export const diveEnrollments = pgTable(
  'dive_enrollments',
  {
    id: id(),
    organizationId: orgRef(),
    diverId: uuid('diver_id').notNull(),
    programId: uuid('program_id').notNull(),
    instructorStaffId: uuid('instructor_staff_id'),
    status: text('status').notNull().default('active'),
    startedOn: date('started_on').notNull(),
    completedOn: date('completed_on'),
    skills: text('skills')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    theoryScore: smallint('theory_score'),
    certNumber: text('cert_number'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_enrollments_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'dive_enrollments_diver_fk',
      columns: [t.organizationId, t.diverId],
      foreignColumns: [diveDivers.organizationId, diveDivers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dive_enrollments_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [divePrograms.organizationId, divePrograms.id],
    }),
    check('dive_enrollments_status_check', oneOf('status', DIVE_ENROLLMENT_STATUSES)),
  ],
);

export const diveGear = pgTable(
  'dive_gear',
  {
    id: id(),
    organizationId: orgRef(),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    size: text('size'),
    brand: text('brand'),
    status: text('status').notNull().default('available'),
    purchasedOn: date('purchased_on'),
    lastServiceOn: date('last_service_on'),
    serviceEveryDays: smallint('service_every_days'),
    rentalPriceAgorot: integer('rental_price_agorot').notNull().default(0),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_gear_org_id').on(t.organizationId, t.id),
    unique('dive_gear_org_code').on(t.organizationId, t.code),
    check('dive_gear_kind_check', oneOf('kind', GEAR_KINDS)),
    check('dive_gear_status_check', oneOf('status', GEAR_STATUSES)),
  ],
);

export const diveRentals = pgTable(
  'dive_rentals',
  {
    id: id(),
    organizationId: orgRef(),
    gearId: uuid('gear_id').notNull(),
    diverId: uuid('diver_id').notNull(),
    outAt: timestamp('out_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    priceAgorot: integer('price_agorot').notNull().default(0),
    conditionNote: text('condition_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_rentals_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'dive_rentals_gear_fk',
      columns: [t.organizationId, t.gearId],
      foreignColumns: [diveGear.organizationId, diveGear.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dive_rentals_diver_fk',
      columns: [t.organizationId, t.diverId],
      foreignColumns: [diveDivers.organizationId, diveDivers.id],
    }).onDelete('cascade'),
  ],
);

/** Money in (append-only, like the swim ledger): courses, sessions, passes, rentals, shop. */
export const diveSales = pgTable(
  'dive_sales',
  {
    id: id(),
    organizationId: orgRef(),
    diverId: uuid('diver_id'),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    method: text('method').notNull(),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    programId: uuid('program_id'),
    sessionId: uuid('session_id'),
    receiptNo: text('receipt_no'),
    soldBy: uuid('sold_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('dive_sales_org_id').on(t.organizationId, t.id),
    index('dive_sales_org_sold').on(t.organizationId, t.soldAt),
    check('dive_sales_kind_check', oneOf('kind', DIVE_SALE_KINDS)),
    check('dive_sales_method_check', oneOf('method', PAY_METHODS)),
  ],
);

/** The sea at a site on a day: observed (or forecast), and the call that follows from the rules. */
export const diveConditions = pgTable(
  'dive_conditions',
  {
    id: id(),
    organizationId: orgRef(),
    siteId: uuid('site_id'),
    observedOn: date('observed_on').notNull(),
    isForecast: boolean('is_forecast').notNull().default(false),
    windKts: smallint('wind_kts').notNull(),
    windDir: text('wind_dir').notNull(),
    waveCm: smallint('wave_cm').notNull(),
    visibilityM: smallint('visibility_m').notNull(),
    waterTempC: smallint('water_temp_c').notNull(),
    current: text('current').notNull().default('none'),
    call: text('call').notNull(),
    ruleSetId: uuid('rule_set_id'),
    note: text('note'),
    recordedBy: uuid('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dive_conditions_org_id').on(t.organizationId, t.id),
    index('dive_conditions_org_day').on(t.organizationId, t.observedOn),
    check('dive_conditions_dir_check', oneOf('wind_dir', WIND_DIRS)),
    check('dive_conditions_current_check', oneOf('current', CURRENTS)),
    check('dive_conditions_call_check', oneOf('call', SEA_CALLS)),
  ],
);

export const diveLeads = pgTable(
  'dive_leads',
  {
    id: id(),
    organizationId: orgRef(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    source: text('source').notNull(),
    origin: text('origin').notNull().default('israel'),
    interestProgramId: uuid('interest_program_id'),
    stage: text('stage').notNull().default('new'),
    note: text('note'),
    nextActionOn: date('next_action_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_leads_org_id').on(t.organizationId, t.id),
    check('dive_leads_stage_check', oneOf('stage', LEAD_STAGES)),
    check('dive_leads_source_check', oneOf('source', LEAD_SOURCES)),
    check('dive_leads_origin_check', oneOf('origin', DIVER_ORIGINS)),
  ],
);

export const diveStaffCerts = pgTable(
  'dive_staff_certs',
  {
    id: id(),
    organizationId: orgRef(),
    staffMemberId: uuid('staff_member_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    agency: text('agency'),
    number: text('number'),
    expiresOn: date('expires_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dive_staff_certs_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'dive_staff_certs_staff_fk',
      columns: [t.organizationId, t.staffMemberId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }).onDelete('cascade'),
    check('dive_staff_certs_kind_check', oneOf('kind', STAFF_CERT_KINDS)),
  ],
);
