import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ADMITTED_GENDERS,
  BOOKING_STATUSES,
  ENROLLMENT_STATUSES,
  SESSION_STAFF_ROLES,
  SESSION_STATUSES,
  SHIFT_CHANGE_KINDS,
  SHIFT_CHANGE_STATUSES,
  SLOT_KINDS,
  SLOT_STATUSES,
  TERM_KINDS,
  COHORT_STATUSES,
  WAITLIST_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { programs } from './catalog';
import { staffMembers, students } from './people';
import { organizations } from './tenancy';
import { lanes, pools, venues } from './venues';

const SEAT_HOLDING = `'trial_booked', 'active', 'frozen', 'cancel_requested'`;

/** A school year, a summer, or a course window. Sessions are generated per term. */
export const terms = pgTable(
  'terms',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('school_year'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('terms_org_id').on(t.organizationId, t.id),
    unique('terms_org_name').on(t.organizationId, t.name),
    check('terms_kind_check', sql.raw(`kind in (${inList(TERM_KINDS)})`)),
    check('terms_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** An owner's exception to the Hebrew calendar: an extra day off, or a day that runs despite the rules. */
export const hebrewCalendarOverrides = pgTable(
  'hebrew_calendar_overrides',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    kind: text('kind').notNull(),
    /** null = every venue. */
    venueId: uuid('venue_id'),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('calendar_overrides_org_id').on(t.organizationId, t.id),
    unique('calendar_overrides_day').on(t.organizationId, t.venueId, t.date).nullsNotDistinct(),
    foreignKey({
      name: 'calendar_overrides_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    check('calendar_overrides_kind_check', sql`${t.kind} in ('closed', 'open')`),
  ],
);

/**
 * A course or camp cohort (brief §6.11): a fixed group of children over set dates, meeting in one or more groups (an
 * intensive course twice a week, a camp week every day). Registration is per cohort; a camp's weeks are separate
 * cohorts. Its own regulations are the program's policy version.
 */
export const cohorts = pgTable(
  'cohorts',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    capacity: smallint('capacity').notNull(),
    /** Registration closes at the end of this day (null = until the cohort starts). */
    registrationClosesOn: date('registration_closes_on'),
    status: text('status').notNull().default('open'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cohorts_org_id').on(t.organizationId, t.id),
    unique('cohorts_org_name').on(t.organizationId, t.name),
    foreignKey({
      name: 'cohorts_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    check('cohorts_status_check', sql.raw(`status in (${inList(COHORT_STATUSES)})`)),
    check('cohorts_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check('cohorts_capacity_check', sql`${t.capacity} between 1 and 500`),
  ],
);

/**
 * A recurring group (brief §5): venue, pool, lanes, weekday, start and duration, program, level range, age band, who
 * it admits, capacity and what its instructor needs. Changing the lead instructor goes through `shift_changes`.
 */
export const classTemplates = pgTable(
  'class_templates',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    programId: uuid('program_id').notNull(),
    venueId: uuid('venue_id').notNull(),
    poolId: uuid('pool_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    durationMin: smallint('duration_min').notNull(),
    levelMinId: uuid('level_min_id'),
    levelMaxId: uuid('level_max_id'),
    ageMinMonths: smallint('age_min_months'),
    ageMaxMonths: smallint('age_max_months'),
    admittedGender: text('admitted_gender').notNull().default('mixed'),
    capacity: smallint('capacity').notNull(),
    requiredInstructorGender: text('required_instructor_gender'),
    requiredSkills: text('required_skills')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    leadStaffId: uuid('lead_staff_id'),
    /** The course or camp cohort this group belongs to (its dates and registration); null for a regular group. */
    cohortId: uuid('cohort_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('class_templates_org_id').on(t.organizationId, t.id),
    unique('class_templates_org_pool_id').on(t.organizationId, t.poolId, t.id),
    foreignKey({
      name: 'class_templates_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'class_templates_pool_fk',
      columns: [t.organizationId, t.venueId, t.poolId],
      foreignColumns: [pools.organizationId, pools.venueId, pools.id],
    }).onDelete('cascade'),
    // level_min/max and lead_staff FKs use SET NULL on one column: added in 0005 (drizzle cannot express it).
    index('class_templates_venue_weekday').on(t.venueId, t.weekday),
    index('class_templates_lead').on(t.leadStaffId),
    check('class_templates_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('class_templates_duration_check', sql`${t.durationMin} between 5 and 240`),
    check('class_templates_capacity_check', sql`${t.capacity} between 1 and 100`),
    check(
      'class_templates_age_check',
      sql`${t.ageMinMonths} is null or ${t.ageMaxMonths} is null or ${t.ageMaxMonths} >= ${t.ageMinMonths}`,
    ),
    check(
      'class_templates_gender_check',
      sql.raw(`admitted_gender in (${inList(ADMITTED_GENDERS)})`),
    ),
    check(
      'class_templates_instructor_gender_check',
      sql`${t.requiredInstructorGender} is null or ${t.requiredInstructorGender} in ('female', 'male')`,
    ),
    check('class_templates_status_check', sql`${t.status} in ('active', 'archived')`),
    check(
      'class_templates_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/** Lanes a group uses. Both must belong to the group's pool. */
export const classTemplateLanes = pgTable(
  'class_template_lanes',
  {
    organizationId: orgId(),
    poolId: uuid('pool_id').notNull(),
    classTemplateId: uuid('class_template_id').notNull(),
    laneId: uuid('lane_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.classTemplateId, t.laneId] }),
    foreignKey({
      name: 'template_lanes_template_fk',
      columns: [t.organizationId, t.poolId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.poolId, classTemplates.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'template_lanes_lane_fk',
      columns: [t.organizationId, t.poolId, t.laneId],
      foreignColumns: [lanes.organizationId, lanes.poolId, lanes.id],
    }).onDelete('cascade'),
  ],
);

/** One generator run: what it created and every date it skipped with the reasons (explainability). */
export const sessionGenerationRuns = pgTable(
  'session_generation_runs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').notNull(),
    createdCount: integer('created_count').notNull().default(0),
    existingCount: integer('existing_count').notNull().default(0),
    /** [{ classTemplateId, date, reasons: [...], policyVersionKey }] */
    skipped: jsonb('skipped').notNull().default([]),
    requestedBy: uuid('requested_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('generation_runs_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'generation_runs_term_fk',
      columns: [t.organizationId, t.termId],
      foreignColumns: [terms.organizationId, terms.id],
    }).onDelete('cascade'),
    index('generation_runs_term').on(t.termId, t.createdAt),
  ],
);

/** A generated occurrence of a group. Instants are stored; `date` is the local lesson day. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    organizationId: orgId(),
    classTemplateId: uuid('class_template_id').notNull(),
    termId: uuid('term_id'),
    venueId: uuid('venue_id').notNull(),
    date: date('date').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('scheduled'),
    cancelReason: text('cancel_reason'),
    /** The mass cancellation that cancelled it (FK in 0007). */
    closureEventId: uuid('closure_event_id'),
    generationRunId: uuid('generation_run_id'),
    /** ResolvedPolicy.versionKey of the policy sets that decided this date. */
    policyVersionKey: text('policy_version_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('sessions_org_id').on(t.organizationId, t.id),
    unique('sessions_template_date').on(t.classTemplateId, t.date),
    foreignKey({
      name: 'sessions_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sessions_term_fk',
      columns: [t.organizationId, t.termId],
      foreignColumns: [terms.organizationId, terms.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'sessions_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    index('sessions_org_date').on(t.organizationId, t.date),
    index('sessions_venue_date').on(t.venueId, t.date),
    check('sessions_status_check', sql.raw(`status in (${inList(SESSION_STATUSES)})`)),
    check('sessions_time_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const sessionStaff = pgTable(
  'session_staff',
  {
    organizationId: orgId(),
    sessionId: uuid('session_id').notNull(),
    staffMemberId: uuid('staff_member_id').notNull(),
    role: text('role').notNull().default('lead'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.staffMemberId] }),
    uniqueIndex('session_staff_one_lead')
      .on(t.sessionId)
      .where(sql`role = 'lead'`),
    index('session_staff_staff').on(t.staffMemberId),
    foreignKey({
      name: 'session_staff_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'session_staff_staff_fk',
      columns: [t.organizationId, t.staffMemberId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }).onDelete('cascade'),
    check('session_staff_role_check', sql.raw(`role in (${inList(SESSION_STAFF_ROLES)})`)),
  ],
);

/**
 * A child's place in a group. Phase 2 uses it for the board; Phase 3 runs the lead → trial → enrollment flow on it.
 * A move ends one row (ends_on, status completed) and starts the next one on the same day.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    organizationId: orgId(),
    studentId: uuid('student_id').notNull(),
    classTemplateId: uuid('class_template_id').notNull(),
    status: text('status').notNull().default('active'),
    startsOn: date('starts_on').notNull(),
    /** Exclusive: the first day the child is no longer in the group. */
    endsOn: date('ends_on'),
    source: text('source'),
    previousEnrollmentId: uuid('previous_enrollment_id'),
    createdBy: uuid('created_by'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('enrollments_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'enrollments_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'enrollments_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
    index('enrollments_template').on(t.classTemplateId, t.status),
    index('enrollments_student').on(t.studentId),
    uniqueIndex('enrollments_one_seat')
      .on(t.studentId, t.classTemplateId)
      .where(sql.raw(`ends_on is null and status in (${SEAT_HOLDING})`)),
    check('enrollments_status_check', sql.raw(`status in (${inList(ENROLLMENT_STATUSES)})`)),
    check('enrollments_dates_check', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Bookable time with one instructor: privates, pairs, trios, therapy, trials and makeups (brief §5 private_slots). */
export const privateSlots = pgTable(
  'private_slots',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    venueId: uuid('venue_id').notNull(),
    poolId: uuid('pool_id'),
    programId: uuid('program_id'),
    kind: text('kind').notNull(),
    date: date('date').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: smallint('capacity').notNull(),
    status: text('status').notNull().default('open'),
    /** Slots opened together ("every Monday 18:00 for 8 weeks") share a series id. */
    seriesId: uuid('series_id'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('private_slots_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'private_slots_staff_fk',
      columns: [t.organizationId, t.staffMemberId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'private_slots_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'private_slots_pool_fk',
      columns: [t.organizationId, t.venueId, t.poolId],
      foreignColumns: [pools.organizationId, pools.venueId, pools.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'private_slots_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    index('private_slots_staff_date').on(t.staffMemberId, t.date),
    index('private_slots_org_date').on(t.organizationId, t.date),
    check('private_slots_kind_check', sql.raw(`kind in (${inList(SLOT_KINDS)})`)),
    check('private_slots_status_check', sql.raw(`status in (${inList(SLOT_STATUSES)})`)),
    check('private_slots_capacity_check', sql`${t.capacity} between 1 and 10`),
    check('private_slots_time_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const slotBookings = pgTable(
  'slot_bookings',
  {
    id: id(),
    organizationId: orgId(),
    slotId: uuid('slot_id').notNull(),
    studentId: uuid('student_id').notNull(),
    status: text('status').notNull().default('booked'),
    bookedBy: uuid('booked_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('slot_bookings_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'slot_bookings_slot_fk',
      columns: [t.organizationId, t.slotId],
      foreignColumns: [privateSlots.organizationId, privateSlots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'slot_bookings_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    uniqueIndex('slot_bookings_once')
      .on(t.slotId, t.studentId)
      .where(sql`status = 'booked'`),
    check('slot_bookings_status_check', sql.raw(`status in (${inList(BOOKING_STATUSES)})`)),
  ],
);

/** Demand that has no seat yet, with the family's preferences. Ranked by priority, then by when they asked. */
export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: id(),
    organizationId: orgId(),
    studentId: uuid('student_id').notNull(),
    programId: uuid('program_id').notNull(),
    venueId: uuid('venue_id'),
    classTemplateId: uuid('class_template_id'),
    preferredWeekdays: smallint('preferred_weekdays')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    earliestAt: time('earliest_at'),
    latestAt: time('latest_at'),
    priority: smallint('priority').notNull().default(0),
    status: text('status').notNull().default('waiting'),
    placedEnrollmentId: uuid('placed_enrollment_id'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('waitlist_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'waitlist_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'waitlist_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    // venue / template / placed enrollment FKs use SET NULL on one column: added in 0005.
    index('waitlist_org_status').on(t.organizationId, t.status),
    check('waitlist_status_check', sql.raw(`status in (${inList(WAITLIST_STATUSES)})`)),
    check(
      'waitlist_times_check',
      sql`${t.earliestAt} is null or ${t.latestAt} is null or ${t.latestAt} > ${t.earliestAt}`,
    ),
  ],
);

/**
 * The change-protection rule (brief §6.3): any change to an instructor's shift is a row here first. Nothing changes
 * on the schedule, and nobody else is told, until the respondent accepts and the change is applied.
 */
export const shiftChanges = pgTable(
  'shift_changes',
  {
    id: id(),
    organizationId: orgId(),
    kind: text('kind').notNull(),
    classTemplateId: uuid('class_template_id'),
    sessionId: uuid('session_id'),
    /** reassign_group: first lesson day the new instructor teaches. */
    effectiveFrom: date('effective_from'),
    fromStaffId: uuid('from_staff_id'),
    toStaffId: uuid('to_staff_id'),
    newStartsAt: timestamp('new_starts_at', { withTimezone: true }),
    newEndsAt: timestamp('new_ends_at', { withTimezone: true }),
    /** The instructor whose answer the change waits for. */
    respondentStaffId: uuid('respondent_staff_id').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason'),
    requestedBy: uuid('requested_by'),
    escalateAt: timestamp('escalate_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseNote: text('response_note'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('shift_changes_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'shift_changes_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'shift_changes_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'shift_changes_respondent_fk',
      columns: [t.organizationId, t.respondentStaffId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }).onDelete('cascade'),
    // from/to staff FKs use SET NULL on one column: added in 0005.
    index('shift_changes_respondent').on(t.respondentStaffId, t.status),
    index('shift_changes_org_status').on(t.organizationId, t.status),
    check('shift_changes_kind_check', sql.raw(`kind in (${inList(SHIFT_CHANGE_KINDS)})`)),
    check('shift_changes_status_check', sql.raw(`status in (${inList(SHIFT_CHANGE_STATUSES)})`)),
    check(
      'shift_changes_shape_check',
      sql`case ${t.kind}
        when 'reassign_group' then ${t.classTemplateId} is not null and ${t.effectiveFrom} is not null
          and ${t.toStaffId} is not null and ${t.sessionId} is null
        when 'reassign_session' then ${t.sessionId} is not null and ${t.toStaffId} is not null
        when 'reschedule_session' then ${t.sessionId} is not null and ${t.newStartsAt} is not null
          and ${t.newEndsAt} > ${t.newStartsAt}
      end`,
    ),
  ],
);

/** Counselors and helpers on a cohort besides the groups' instructors (a camp's staff ratio counts them). */
export const cohortStaff = pgTable(
  'cohort_staff',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    cohortId: uuid('cohort_id').notNull(),
    staffMemberId: uuid('staff_member_id').notNull(),
    role: text('role'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('cohort_staff_org_id').on(t.organizationId, t.id),
    unique('cohort_staff_once').on(t.cohortId, t.staffMemberId),
    foreignKey({
      name: 'cohort_staff_cohort_fk',
      columns: [t.organizationId, t.cohortId],
      foreignColumns: [cohorts.organizationId, cohorts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cohort_staff_staff_fk',
      columns: [t.organizationId, t.staffMemberId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }).onDelete('cascade'),
  ],
);
