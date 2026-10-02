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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ABSENCE_CHANNELS,
  ABSENCE_CLASSIFICATIONS,
  ABSENCE_NOTICE_STATUSES,
  ATTENDANCE_KINDS,
  ATTENDANCE_STATUSES,
  CLOSURE_END_RULES,
  CLOSURE_EVENT_STATUSES,
  CLOSURE_SOURCES,
  CREDIT_REASONS,
  CREDIT_STATUSES,
  FORM_CHANNELS,
  FORM_KINDS,
  MAKEUP_BOOKING_STATUSES,
  MAKEUP_GUARANTEES,
  TRIAL_OUTCOMES,
  TRIAL_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { programs } from './catalog';
import { guardians, households, students } from './people';
import { classTemplates, sessions } from './scheduling';
import { organizations } from './tenancy';

/**
 * A mass cancellation (brief §6.5 closure workflow): a venue (or every venue) is closed for some days. Opening it
 * cancels the scheduled sessions in the range, issues makeup credits to the children who held a seat, and opens a
 * makeup window until the deadline; closing it applies the end rule to credits nobody used.
 */
export const closureEvents = pgTable(
  'closure_events',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** null = every venue. */
    venueId: uuid('venue_id'),
    /** The venue closure row the event created, so session generation skips the dates too. */
    venueClosureId: uuid('venue_closure_id'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    /** closure.school_makeup / closure.external_makeup at the time the event opened. */
    guarantee: text('guarantee').notNull(),
    makeupFrom: date('makeup_from').notNull(),
    makeupDeadline: date('makeup_deadline').notNull(),
    endRule: text('end_rule').notNull(),
    status: text('status').notNull().default('draft'),
    policyVersionKey: text('policy_version_key'),
    createdBy: uuid('created_by'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('closure_events_org_id').on(t.organizationId, t.id),
    // venue and venue-closure FKs use SET NULL on one column: added in 0007.
    index('closure_events_org_status').on(t.organizationId, t.status),
    check('closure_events_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check('closure_events_window_check', sql`${t.makeupDeadline} >= ${t.makeupFrom}`),
    check('closure_events_source_check', sql.raw(`source in (${inList(CLOSURE_SOURCES)})`)),
    check('closure_events_guarantee_check', sql.raw(`guarantee in (${inList(MAKEUP_GUARANTEES)})`)),
    check('closure_events_end_rule_check', sql.raw(`end_rule in (${inList(CLOSURE_END_RULES)})`)),
    check('closure_events_status_check', sql.raw(`status in (${inList(CLOSURE_EVENT_STATUSES)})`)),
  ],
);

/**
 * A trial lesson (brief §6.2 lead → trial → enrollment): one seat in one session, held by a `trial_booked` enrollment
 * for that day only. The instructor's verdict and the offer window follow; conversion links the real enrollment.
 */
export const trials = pgTable(
  'trials',
  {
    id: id(),
    organizationId: orgId(),
    studentId: uuid('student_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    classTemplateId: uuid('class_template_id').notNull(),
    /** The one-day seat. */
    enrollmentId: uuid('enrollment_id'),
    date: date('date').notNull(),
    status: text('status').notNull().default('booked'),
    /** Price list snapshot when it was booked (Phase 4 charges it). */
    feeAgorot: integer('fee_agorot'),
    outcome: text('outcome'),
    recommendedLevelId: uuid('recommended_level_id'),
    recommendedTemplateId: uuid('recommended_template_id'),
    verdictNote: text('verdict_note'),
    verdictBy: uuid('verdict_by'),
    verdictAt: timestamp('verdict_at', { withTimezone: true }),
    /** Last day the trial fee still offsets the first payment (trial.offset.valid_days). */
    offerValidUntil: date('offer_valid_until'),
    convertedEnrollmentId: uuid('converted_enrollment_id'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('trials_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'trials_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trials_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trials_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
    // enrollment, level, recommended group and converted enrollment FKs use SET NULL: added in 0007.
    uniqueIndex('trials_once')
      .on(t.studentId, t.sessionId)
      .where(sql`status <> 'cancelled'`),
    index('trials_org_date').on(t.organizationId, t.date),
    check('trials_status_check', sql.raw(`status in (${inList(TRIAL_STATUSES)})`)),
    check(
      'trials_outcome_check',
      sql.raw(`outcome is null or outcome in (${inList(TRIAL_OUTCOMES)})`),
    ),
    check('trials_fee_check', sql`${t.feeAgorot} is null or ${t.feeAgorot} >= 0`),
  ],
);

/** A versioned form text (registration, health declaration, regulations, photo consent). Published versions are frozen. */
export const formTemplates = pgTable(
  'form_templates',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    version: smallint('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Yes/no questions the family answers: [{ code, he }]. */
    questions: jsonb('questions').notNull().default([]),
    effectiveFrom: date('effective_from').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('form_templates_org_id').on(t.organizationId, t.id),
    unique('form_templates_version').on(t.organizationId, t.kind, t.version),
    check('form_templates_kind_check', sql.raw(`kind in (${inList(FORM_KINDS)})`)),
    check('form_templates_version_check', sql`${t.version} >= 1`),
  ],
);

/** A family's acceptance of one form version, with the exact text's hash. Append-only. */
export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: id(),
    organizationId: orgId(),
    formTemplateId: uuid('form_template_id').notNull(),
    householdId: uuid('household_id').notNull(),
    /** Set for per-child forms (health declaration, photo consent). */
    studentId: uuid('student_id'),
    guardianId: uuid('guardian_id'),
    answers: jsonb('answers').notNull().default({}),
    /** sha256 of the form body the family saw. */
    textHash: text('text_hash').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    channel: text('channel').notNull(),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('form_submissions_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'form_submissions_template_fk',
      columns: [t.organizationId, t.formTemplateId],
      foreignColumns: [formTemplates.organizationId, formTemplates.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'form_submissions_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'form_submissions_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'form_submissions_guardian_fk',
      columns: [t.organizationId, t.guardianId],
      foreignColumns: [guardians.organizationId, guardians.id],
    }).onDelete('cascade'),
    index('form_submissions_household').on(t.householdId),
    check('form_submissions_channel_check', sql.raw(`channel in (${inList(FORM_CHANNELS)})`)),
  ],
);

/** One mark per child per session. Offline marks carry the device's id and time; the latest device time wins. */
export const attendance = pgTable(
  'attendance',
  {
    id: id(),
    organizationId: orgId(),
    sessionId: uuid('session_id').notNull(),
    studentId: uuid('student_id').notNull(),
    kind: text('kind').notNull().default('member'),
    status: text('status').notNull(),
    minutesLate: smallint('minutes_late'),
    note: text('note'),
    recordedBy: uuid('recorded_by'),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    clientMarkId: text('client_mark_id'),
    policyVersionKey: text('policy_version_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('attendance_org_id').on(t.organizationId, t.id),
    unique('attendance_once').on(t.sessionId, t.studentId),
    foreignKey({
      name: 'attendance_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'attendance_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    index('attendance_student').on(t.studentId),
    check('attendance_kind_check', sql.raw(`kind in (${inList(ATTENDANCE_KINDS)})`)),
    check('attendance_status_check', sql.raw(`status in (${inList(ATTENDANCE_STATUSES)})`)),
    check(
      'attendance_late_check',
      sql`${t.minutesLate} is null or ${t.minutesLate} between 0 and 600`,
    ),
  ],
);

/**
 * A makeup credit (השלמה), the ledger the marketplace books from. Its status moves open → booked → used, or ends as
 * expired / converted / void; it is never deleted.
 */
export const makeupCredits = pgTable(
  'makeup_credits',
  {
    id: id(),
    organizationId: orgId(),
    studentId: uuid('student_id').notNull(),
    /** Makeups are booked into a group of the same program. */
    programId: uuid('program_id').notNull(),
    reason: text('reason').notNull(),
    sourceSessionId: uuid('source_session_id'),
    /** The lesson day the credit replaces: the monthly cap counts by it. */
    sourceDate: date('source_date'),
    closureEventId: uuid('closure_event_id'),
    issuedOn: date('issued_on').notNull(),
    /** First day it may be spent (a closure's makeup window); null = from today. */
    validFrom: date('valid_from'),
    expiresOn: date('expires_on').notNull(),
    status: text('status').notNull().default('open'),
    /** False for closure credits when closure.makeup_cap_bypass is on. */
    countsTowardCap: boolean('counts_toward_cap').notNull().default(true),
    policyVersionKey: text('policy_version_key'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('makeup_credits_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'makeup_credits_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'makeup_credits_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'makeup_credits_closure_fk',
      columns: [t.organizationId, t.closureEventId],
      foreignColumns: [closureEvents.organizationId, closureEvents.id],
    }).onDelete('cascade'),
    // source session FK uses SET NULL on one column: added in 0007.
    uniqueIndex('makeup_credits_one_per_lesson')
      .on(t.studentId, t.sourceSessionId)
      .where(sql`source_session_id is not null and status <> 'void'`),
    index('makeup_credits_student_status').on(t.studentId, t.status),
    index('makeup_credits_closure').on(t.closureEventId),
    check('makeup_credits_reason_check', sql.raw(`reason in (${inList(CREDIT_REASONS)})`)),
    check('makeup_credits_status_check', sql.raw(`status in (${inList(CREDIT_STATUSES)})`)),
    check('makeup_credits_dates_check', sql`${t.expiresOn} >= ${t.issuedOn}`),
  ],
);

/** An absence notice from the family (or recorded by the office), classified against the regulations. */
export const absenceNotices = pgTable(
  'absence_notices',
  {
    id: id(),
    organizationId: orgId(),
    sessionId: uuid('session_id').notNull(),
    studentId: uuid('student_id').notNull(),
    channel: text('channel').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    /** Minutes from receipt to the lesson's start (negative = after it started). */
    minutesBefore: integer('minutes_before'),
    classification: text('classification'),
    /** The decision's explanation: an i18n code with params ({ code, params }). */
    decision: jsonb('decision'),
    policyVersionKey: text('policy_version_key'),
    creditId: uuid('credit_id'),
    note: text('note'),
    reportedBy: uuid('reported_by'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('absence_notices_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'absence_notices_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'absence_notices_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    // credit FK uses SET NULL on one column: added in 0007.
    uniqueIndex('absence_notices_once')
      .on(t.sessionId, t.studentId)
      .where(sql`status <> 'withdrawn'`),
    index('absence_notices_org_status').on(t.organizationId, t.status),
    check('absence_notices_channel_check', sql.raw(`channel in (${inList(ABSENCE_CHANNELS)})`)),
    check(
      'absence_notices_status_check',
      sql.raw(`status in (${inList(ABSENCE_NOTICE_STATUSES)})`),
    ),
    check(
      'absence_notices_classification_check',
      sql.raw(`classification is null or classification in (${inList(ABSENCE_CLASSIFICATIONS)})`),
    ),
  ],
);

/** A credit spent on a seat in another session. The booking trigger checks the seat under a row lock. */
export const makeupBookings = pgTable(
  'makeup_bookings',
  {
    id: id(),
    organizationId: orgId(),
    creditId: uuid('credit_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    studentId: uuid('student_id').notNull(),
    status: text('status').notNull().default('booked'),
    bookedBy: uuid('booked_by'),
    /** Set when the owner booked past a soft rule (makeup.enforcement = strict_with_override). */
    overrideNote: text('override_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('makeup_bookings_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'makeup_bookings_credit_fk',
      columns: [t.organizationId, t.creditId],
      foreignColumns: [makeupCredits.organizationId, makeupCredits.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'makeup_bookings_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'makeup_bookings_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    uniqueIndex('makeup_bookings_one_per_credit')
      .on(t.creditId)
      .where(sql`status <> 'cancelled'`),
    uniqueIndex('makeup_bookings_once')
      .on(t.sessionId, t.studentId)
      .where(sql`status <> 'cancelled'`),
    index('makeup_bookings_session').on(t.sessionId),
    check(
      'makeup_bookings_status_check',
      sql.raw(`status in (${inList(MAKEUP_BOOKING_STATUSES)})`),
    ),
  ],
);

/** A level skill a child achieved (the instructor's progress ticks). */
export const progressMarks = pgTable(
  'progress_marks',
  {
    id: id(),
    organizationId: orgId(),
    studentId: uuid('student_id').notNull(),
    levelId: uuid('level_id').notNull(),
    skillCode: text('skill_code').notNull(),
    achievedOn: date('achieved_on').notNull(),
    sessionId: uuid('session_id'),
    staffMemberId: uuid('staff_member_id'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('progress_marks_org_id').on(t.organizationId, t.id),
    unique('progress_marks_once').on(t.studentId, t.levelId, t.skillCode),
    foreignKey({
      name: 'progress_marks_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    // level, session and staff FKs: added in 0007 (levels cascade; session and staff set null).
    index('progress_marks_student').on(t.studentId),
  ],
);
