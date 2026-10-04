/**
 * Staff operations and payroll (brief §6.8–6.9). Hours come from lessons taught; a monthly run turns them into
 * payroll lines split by routing (payslip / transfer); substitutes are offered in waves; applicants move through a
 * light pipeline.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ADJUSTMENT_KINDS,
  APPLICANT_SOURCES,
  APPLICANT_STAGES,
  PAY_ROUTINGS,
  PAYROLL_LINE_KINDS,
  PAYROLL_RUN_STATUSES,
  SICK_ENTRY_KINDS,
  SUBSTITUTE_OFFER_STATUSES,
  SUBSTITUTE_REQUEST_STATUSES,
  TIMESHEET_STATUSES,
  WORK_KINDS,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { staffMembers } from './people';
import { sessions } from './scheduling';

const staffFk = (name: string, t: { organizationId: AnyPgColumn; staffMemberId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.organizationId, t.staffMemberId],
    foreignColumns: [staffMembers.organizationId, staffMembers.id],
  }).onDelete('cascade');

const period = (name: string) => text(name).notNull();
const periodCheck = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);

/** The instructor's month: hours come from lessons taught; they confirm them or dispute with a note. */
export const timesheets = pgTable(
  'timesheets',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    period: period('period'),
    status: text('status').notNull().default('open'),
    /** What the instructor saw when confirming: lesson count and minutes (so a later change is visible). */
    snapshot: jsonb('snapshot').notNull().default({}),
    disputeNote: text('dispute_note'),
    resolution: text('resolution'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('timesheets_org_id').on(t.organizationId, t.id),
    unique('timesheets_once').on(t.organizationId, t.staffMemberId, t.period),
    staffFk('timesheets_staff_fk', t),
    periodCheck('timesheets_period_check', t.period),
    check('timesheets_status_check', sql.raw(`status in (${inList(TIMESHEET_STATUSES)})`)),
    check(
      'timesheets_dispute_check',
      sql`${t.status} <> 'disputed' or ${t.disputeNote} is not null`,
    ),
  ],
);

/** A month's payroll: drafted (again and again), then approved and locked. */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    organizationId: orgId(),
    period: period('period'),
    status: text('status').notNull().default('draft'),
    policyVersionKey: text('policy_version_key'),
    totals: jsonb('totals').notNull().default({}),
    draftedBy: uuid('drafted_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payroll_runs_org_id').on(t.organizationId, t.id),
    unique('payroll_runs_once').on(t.organizationId, t.period),
    periodCheck('payroll_runs_period_check', t.period),
    check('payroll_runs_status_check', sql.raw(`status in (${inList(PAYROLL_RUN_STATUSES)})`)),
    check(
      'payroll_runs_approved_check',
      sql`(${t.status} = 'approved') = (${t.approvedAt} is not null)`,
    ),
  ],
);

/** One line of a run: a lesson, a day's travel or an adjustment, routed to the payslip or to a transfer. */
export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: id(),
    organizationId: orgId(),
    runId: uuid('run_id').notNull(),
    period: period('period'),
    staffMemberId: uuid('staff_member_id').notNull(),
    routing: text('routing').notNull(),
    kind: text('kind').notNull(),
    workKind: text('work_kind'),
    date: date('date'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unit: text('unit').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    payRuleId: uuid('pay_rule_id'),
    sessionId: uuid('session_id'),
    slotId: uuid('slot_id'),
    adjustmentId: uuid('adjustment_id'),
    explanation: jsonb('explanation').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique('payroll_lines_org_id').on(t.organizationId, t.id),
    index('payroll_lines_run_staff').on(t.runId, t.staffMemberId),
    periodCheck('payroll_lines_period_check', t.period),
    foreignKey({
      name: 'payroll_lines_run_fk',
      columns: [t.organizationId, t.runId],
      foreignColumns: [payrollRuns.organizationId, payrollRuns.id],
    }).onDelete('cascade'),
    staffFk('payroll_lines_staff_fk', t),
    check('payroll_lines_routing_check', sql.raw(`routing in (${inList(PAY_ROUTINGS)})`)),
    check('payroll_lines_kind_check', sql.raw(`kind in (${inList(PAYROLL_LINE_KINDS)})`)),
    check(
      'payroll_lines_work_kind_check',
      sql.raw(`work_kind is null or work_kind in (${inList(WORK_KINDS)})`),
    ),
  ],
);

/** Bonuses, corrections and expenses the owner adds to a month, routed like any line. */
export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    period: period('period'),
    kind: text('kind').notNull(),
    routing: text('routing').notNull().default('payslip'),
    amountAgorot: integer('amount_agorot').notNull(),
    note: text('note').notNull(),
    timesheetId: uuid('timesheet_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('payroll_adjustments_org_id').on(t.organizationId, t.id),
    index('payroll_adjustments_period').on(t.organizationId, t.period),
    staffFk('payroll_adjustments_staff_fk', t),
    periodCheck('payroll_adjustments_period_check', t.period),
    check('payroll_adjustments_kind_check', sql.raw(`kind in (${inList(ADJUSTMENT_KINDS)})`)),
    check('payroll_adjustments_routing_check', sql.raw(`routing in (${inList(PAY_ROUTINGS)})`)),
    check('payroll_adjustments_amount_check', sql`${t.amountAgorot} <> 0`),
  ],
);

/** Append-only sick leave in half days: accruals by an approved run (positive), days taken (negative). */
export const sickLeaveEntries = pgTable(
  'sick_leave_entries',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    kind: text('kind').notNull(),
    period: period('period'),
    date: date('date'),
    halfDays: smallint('half_days').notNull(),
    runId: uuid('run_id'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sick_leave_entries_org_id').on(t.organizationId, t.id),
    index('sick_leave_entries_staff').on(t.staffMemberId),
    uniqueIndex('sick_leave_accrual_once')
      .on(t.organizationId, t.staffMemberId, t.period)
      .where(sql`kind = 'accrual'`),
    staffFk('sick_leave_entries_staff_fk', t),
    periodCheck('sick_leave_entries_period_check', t.period),
    check('sick_leave_entries_kind_check', sql.raw(`kind in (${inList(SICK_ENTRY_KINDS)})`)),
    check(
      'sick_leave_entries_sign_check',
      sql`(${t.kind} = 'accrual' and ${t.halfDays} > 0) or (${t.kind} = 'taken' and ${t.halfDays} < 0 and ${t.date} is not null)`,
    ),
  ],
);

/** A lesson that needs another instructor: offered in waves, filled by the first to accept. */
export const substituteRequests = pgTable(
  'substitute_requests',
  {
    id: id(),
    organizationId: orgId(),
    sessionId: uuid('session_id').notNull(),
    fromStaffId: uuid('from_staff_id'),
    reason: text('reason'),
    /** The lesson as candidates see it (date, time, group, venue): instructors cannot read other groups' sessions. */
    lesson: jsonb('lesson').notNull().default({}),
    status: text('status').notNull().default('open'),
    wave: smallint('wave').notNull().default(0),
    nextWaveAt: timestamp('next_wave_at', { withTimezone: true }),
    filledBy: uuid('filled_by'),
    filledAt: timestamp('filled_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    requestedBy: uuid('requested_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('substitute_requests_org_id').on(t.organizationId, t.id),
    uniqueIndex('substitute_requests_one_open')
      .on(t.sessionId)
      .where(sql`status = 'open'`),
    index('substitute_requests_org_status').on(t.organizationId, t.status),
    foreignKey({
      name: 'substitute_requests_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('cascade'),
    check(
      'substitute_requests_status_check',
      sql.raw(`status in (${inList(SUBSTITUTE_REQUEST_STATUSES)})`),
    ),
    check(
      'substitute_requests_filled_check',
      sql`(${t.status} = 'filled') = (${t.filledBy} is not null)`,
    ),
  ],
);

export const substituteOffers = pgTable(
  'substitute_offers',
  {
    id: id(),
    organizationId: orgId(),
    requestId: uuid('request_id').notNull(),
    staffMemberId: uuid('staff_member_id').notNull(),
    wave: smallint('wave').notNull(),
    rank: smallint('rank').notNull(),
    /** Why this candidate ranked where they did ("taught this group", "at this venue that day"). */
    reasons: jsonb('reasons').notNull().default([]),
    status: text('status').notNull().default('queued'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('substitute_offers_org_id').on(t.organizationId, t.id),
    unique('substitute_offers_once').on(t.requestId, t.staffMemberId),
    // First accept wins: a second accepted offer on the same request cannot exist.
    uniqueIndex('substitute_offers_one_accepted')
      .on(t.requestId)
      .where(sql`status = 'accepted'`),
    index('substitute_offers_staff').on(t.staffMemberId, t.status),
    foreignKey({
      name: 'substitute_offers_request_fk',
      columns: [t.organizationId, t.requestId],
      foreignColumns: [substituteRequests.organizationId, substituteRequests.id],
    }).onDelete('cascade'),
    staffFk('substitute_offers_staff_fk', t),
    check(
      'substitute_offers_status_check',
      sql.raw(`status in (${inList(SUBSTITUTE_OFFER_STATUSES)})`),
    ),
  ],
);

/** ATS-lite (brief §6.9): who applied, from where, and how far they got. */
export const applicants = pgTable(
  'applicants',
  {
    id: id(),
    organizationId: orgId(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    phoneE164: text('phone_e164'),
    email: text('email'),
    gender: text('gender'),
    source: text('source').notNull().default('other'),
    stage: text('stage').notNull().default('new'),
    certifications: text('certifications'),
    rateExpectationAgorot: integer('rate_expectation_agorot'),
    availability: text('availability'),
    /** 1–5 per criterion: water skills, with kids, reliability. */
    scorecard: jsonb('scorecard').notNull().default({}),
    trialDayOn: date('trial_day_on'),
    notes: text('notes'),
    staffMemberId: uuid('staff_member_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('applicants_org_id').on(t.organizationId, t.id),
    index('applicants_org_stage').on(t.organizationId, t.stage),
    check('applicants_stage_check', sql.raw(`stage in (${inList(APPLICANT_STAGES)})`)),
    check('applicants_source_check', sql.raw(`source in (${inList(APPLICANT_SOURCES)})`)),
    check('applicants_gender_check', sql`${t.gender} is null or ${t.gender} in ('female', 'male')`),
    check(
      'applicants_rate_check',
      sql`${t.rateExpectationAgorot} is null or ${t.rateExpectationAgorot} >= 0`,
    ),
  ],
);
