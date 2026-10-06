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
  BILLING_LINE_KINDS,
  BILLING_RUN_STATUSES,
  CANCELLATION_STATUSES,
  PORTAL_REQUEST_KINDS,
  PORTAL_REQUEST_STATUSES,
  DUNNING_STATUSES,
  FISCAL_DOCUMENT_KINDS,
  FISCAL_DOCUMENT_STATUSES,
  CHURN_REASONS,
  FREEZE_REASONS,
  FREEZE_STATUSES,
  LEDGER_ENTRY_TYPES,
  LEDGER_SOURCES,
  PAYMENT_KINDS,
  PAYMENT_LINK_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PREFERRED_METHODS,
  REIMBURSEMENT_KINDS,
  STANDING_ORDER_STATUSES,
} from '@rswim/contracts';
import { bytea, createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { households } from './people';
import { enrollments } from './scheduling';
import { organizations } from './tenancy';

const PERIOD = `'^[0-9]{4}-(0[1-9]|1[0-2])$'`;

/**
 * How receipts are written for a family that claims the money back (Ministry of Defense, insurance, reservists, an
 * employer): the wording on every line, whether the ID number and the lesson dates are required, one receipt per month.
 */
export const reimbursementProfiles = pgTable(
  'reimbursement_profiles',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    wording: text('wording').notNull(),
    requiresNationalId: boolean('requires_national_id').notNull().default(true),
    includeSessionDates: boolean('include_session_dates').notNull().default(true),
    splitPerMonth: boolean('split_per_month').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('reimbursement_profiles_org_id').on(t.organizationId, t.id),
    unique('reimbursement_profiles_name').on(t.organizationId, t.name),
    check('reimbursement_profiles_kind_check', sql.raw(`kind in (${inList(REIMBURSEMENT_KINDS)})`)),
  ],
);

/** Who pays for a household and how: the payer on receipts (ID number encrypted), reimbursement mode, the method. */
export const householdBilling = pgTable(
  'household_billing',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    payerName: text('payer_name'),
    payerEmail: text('payer_email'),
    /** The payer's ID number, encrypted with the org's data key (ADR-0005). */
    encPayerNationalId: bytea('enc_payer_national_id'),
    /** The last four digits, so the office can tell which ID is on file without decrypting it. */
    payerIdLast4: text('payer_id_last4'),
    reimbursementProfileId: uuid('reimbursement_profile_id'),
    preferredMethod: text('preferred_method').notNull().default('standing_order'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('household_billing_org_id').on(t.organizationId, t.id),
    unique('household_billing_household').on(t.householdId),
    foreignKey({
      name: 'household_billing_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // profile FK uses SET NULL on one column: added in 0009.
    check(
      'household_billing_method_check',
      sql.raw(`preferred_method in (${inList(PREFERRED_METHODS)})`),
    ),
    check(
      'household_billing_last4_check',
      sql`${t.payerIdLast4} is null or ${t.payerIdLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
);

/** A freeze (הקפאה): the seat is kept, and approved freeze days are not charged (billing.freeze_charge). */
export const enrollmentFreezes = pgTable(
  'enrollment_freezes',
  {
    id: id(),
    organizationId: orgId(),
    enrollmentId: uuid('enrollment_id').notNull(),
    /** Inclusive. */
    fromDate: date('from_date').notNull(),
    /** Inclusive. */
    toDate: date('to_date').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    fileId: uuid('file_id'),
    status: text('status').notNull().default('requested'),
    requestedBy: uuid('requested_by'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    policyVersionKey: text('policy_version_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('enrollment_freezes_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'enrollment_freezes_enrollment_fk',
      columns: [t.organizationId, t.enrollmentId],
      foreignColumns: [enrollments.organizationId, enrollments.id],
    }).onDelete('cascade'),
    index('enrollment_freezes_enrollment').on(t.enrollmentId),
    check('enrollment_freezes_dates_check', sql`${t.toDate} >= ${t.fromDate}`),
    check('enrollment_freezes_reason_check', sql.raw(`reason in (${inList(FREEZE_REASONS)})`)),
    check('enrollment_freezes_status_check', sql.raw(`status in (${inList(FREEZE_STATUSES)})`)),
  ],
);

/**
 * A family's request from the portal to freeze a seat or to leave (Phase 7). The database stamps who asked and when;
 * the worker decides it with the office's own rules and links the freeze or cancellation it produced.
 */
export const portalRequests = pgTable(
  'portal_requests',
  {
    id: id(),
    organizationId: orgId(),
    enrollmentId: uuid('enrollment_id').notNull(),
    kind: text('kind').notNull(),
    /** Freeze only, inclusive. */
    fromDate: date('from_date'),
    toDate: date('to_date'),
    reason: text('reason'),
    note: text('note'),
    requestedBy: uuid('requested_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    freezeId: uuid('freeze_id'),
    cancellationId: uuid('cancellation_id'),
    /** Why it was refused (an i18n code and params). */
    error: jsonb('error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('portal_requests_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'portal_requests_enrollment_fk',
      columns: [t.organizationId, t.enrollmentId],
      foreignColumns: [enrollments.organizationId, enrollments.id],
    }).onDelete('cascade'),
    index('portal_requests_enrollment').on(t.enrollmentId),
    index('portal_requests_pending')
      .on(t.organizationId)
      .where(sql`status = 'pending'`),
    check('portal_requests_kind_check', sql.raw(`kind in (${inList(PORTAL_REQUEST_KINDS)})`)),
    check(
      'portal_requests_status_check',
      sql.raw(`status in (${inList(PORTAL_REQUEST_STATUSES)})`),
    ),
    check(
      'portal_requests_freeze_check',
      sql`${t.kind} <> 'freeze' or (${t.fromDate} is not null and ${t.toDate} >= ${t.fromDate} and ${t.reason} is not null)`,
    ),
    check(
      'portal_requests_reason_check',
      sql.raw(
        `reason is null or reason in (${inList([...new Set([...FREEZE_REASONS, ...CHURN_REASONS])])})`,
      ),
    ),
  ],
);

/** A family's request to leave a group, with the cut-off decision: the last month they pay for. */
export const cancellationRequests = pgTable(
  'cancellation_requests',
  {
    id: id(),
    organizationId: orgId(),
    enrollmentId: uuid('enrollment_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    lastChargedPeriod: text('last_charged_period').notNull(),
    /** Why the family leaves (reports' churn); older rows have none. */
    reason: text('reason'),
    /** The seat's exclusive end the decision set. */
    endsOn: date('ends_on').notNull(),
    explanation: jsonb('explanation').notNull(),
    policyVersionKey: text('policy_version_key'),
    status: text('status').notNull().default('active'),
    note: text('note'),
    recordedBy: uuid('recorded_by'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cancellation_requests_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'cancellation_requests_enrollment_fk',
      columns: [t.organizationId, t.enrollmentId],
      foreignColumns: [enrollments.organizationId, enrollments.id],
    }).onDelete('cascade'),
    uniqueIndex('cancellation_requests_one_active')
      .on(t.enrollmentId)
      .where(sql`status = 'active'`),
    check('cancellation_requests_period_check', sql.raw(`last_charged_period ~ ${PERIOD}`)),
    check(
      'cancellation_requests_reason_check',
      sql.raw(`reason is null or reason in (${inList(CHURN_REASONS)})`),
    ),
    check(
      'cancellation_requests_status_check',
      sql.raw(`status in (${inList(CANCELLATION_STATUSES)})`),
    ),
  ],
);

/** One month's billing: drafted, reviewed (diff and anomalies), then posted to the ledger. */
export const billingRuns = pgTable(
  'billing_runs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    status: text('status').notNull().default('draft'),
    /** { households, totalAgorot, previousTotalAgorot } at drafting. */
    totals: jsonb('totals').notNull().default({}),
    /** The pre-run review's flags: [{ kind, householdId, studentId, enrollmentId, explanation }]. */
    anomalies: jsonb('anomalies').notNull().default([]),
    draftedBy: uuid('drafted_by'),
    draftedAt: timestamp('drafted_at', { withTimezone: true }).notNull().defaultNow(),
    postedBy: uuid('posted_by'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('billing_runs_org_id').on(t.organizationId, t.id),
    uniqueIndex('billing_runs_one_per_period')
      .on(t.organizationId, t.period)
      .where(sql`status <> 'discarded'`),
    check('billing_runs_period_check', sql.raw(`period ~ ${PERIOD}`)),
    check('billing_runs_status_check', sql.raw(`status in (${inList(BILLING_RUN_STATUSES)})`)),
  ],
);

/** A statement line of a run: a seat, a month of private lessons, a trial, or a sibling discount (negative). */
export const billingRunLines = pgTable(
  'billing_run_lines',
  {
    id: id(),
    organizationId: orgId(),
    billingRunId: uuid('billing_run_id').notNull(),
    householdId: uuid('household_id').notNull(),
    studentId: uuid('student_id'),
    enrollmentId: uuid('enrollment_id'),
    kind: text('kind').notNull(),
    /** The period the line charges for (seats in advance; lessons and trials of the month before). */
    period: text('period').notNull(),
    description: text('description').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    /** The line this one settles with (a sibling discount with its child's seat). */
    appliesToLineId: uuid('applies_to_line_id'),
    /** Lesson dates the line covers (receipts list them). */
    sessionDates: jsonb('session_dates').notNull().default([]),
    missingPrice: boolean('missing_price').notNull().default(false),
    explanation: jsonb('explanation').notNull(),
    policyVersionKey: text('policy_version_key'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('billing_run_lines_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'billing_run_lines_run_fk',
      columns: [t.organizationId, t.billingRunId],
      foreignColumns: [billingRuns.organizationId, billingRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'billing_run_lines_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // student, enrollment and applies-to FKs use SET NULL on one column: added in 0009.
    index('billing_run_lines_run_household').on(t.billingRunId, t.householdId),
    check('billing_run_lines_kind_check', sql.raw(`kind in (${inList(BILLING_LINE_KINDS)})`)),
    check('billing_run_lines_period_check', sql.raw(`period ~ ${PERIOD}`)),
  ],
);

/** A Grow standing order (הוראת קבע): the card token the runs charge each month. */
export const standingOrders = pgTable(
  'standing_orders',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    provider: text('provider').notNull().default('grow'),
    mandateId: text('mandate_id').notNull(),
    status: text('status').notNull().default('active'),
    cardLast4: text('card_last4'),
    dayOfMonth: smallint('day_of_month'),
    /** The amount it was set up with at the provider (imported mandates), for information. */
    amountAgorot: integer('amount_agorot'),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastFailureReason: text('last_failure_reason'),
    createdBy: uuid('created_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('standing_orders_org_id').on(t.organizationId, t.id),
    unique('standing_orders_mandate').on(t.organizationId, t.provider, t.mandateId),
    foreignKey({
      name: 'standing_orders_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    index('standing_orders_household').on(t.householdId, t.status),
    check(
      'standing_orders_status_check',
      sql.raw(`status in (${inList(STANDING_ORDER_STATUSES)})`),
    ),
    check(
      'standing_orders_day_check',
      sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 28`,
    ),
  ],
);

/** A payment link sent to a family (no mandate, a trial, a one-off). */
export const paymentLinks = pgTable(
  'payment_links',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    description: text('description').notNull(),
    /** Printed on the link (how a trial fee is offset). */
    termsText: text('terms_text'),
    provider: text('provider').notNull().default('grow'),
    externalId: text('external_id'),
    url: text('url'),
    status: text('status').notNull().default('open'),
    billingRunId: uuid('billing_run_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payment_links_org_id').on(t.organizationId, t.id),
    unique('payment_links_idempotency').on(t.organizationId, t.idempotencyKey),
    foreignKey({
      name: 'payment_links_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // run FK uses SET NULL on one column: added in 0009.
    uniqueIndex('payment_links_external')
      .on(t.provider, t.externalId)
      .where(sql`external_id is not null`),
    index('payment_links_household').on(t.householdId, t.status),
    check('payment_links_amount_check', sql`${t.amountAgorot} > 0`),
    check('payment_links_status_check', sql.raw(`status in (${inList(PAYMENT_LINK_STATUSES)})`)),
  ],
);

/**
 * Money in (a payment) or out (a refund): from the provider (standing order charge, link) or recorded by hand (Bit,
 * PayBox, cash, transfer, cheque) with its proof. Its ledger entry is posted when it succeeds.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    kind: text('kind').notNull().default('payment'),
    method: text('method').notNull(),
    /** `provider` (Grow) or `manual`. */
    source: text('source').notNull(),
    status: text('status').notNull().default('pending'),
    amountAgorot: integer('amount_agorot').notNull(),
    provider: text('provider'),
    externalId: text('external_id'),
    billingRunId: uuid('billing_run_id'),
    standingOrderId: uuid('standing_order_id'),
    paymentLinkId: uuid('payment_link_id'),
    refundOfPaymentId: uuid('refund_of_payment_id'),
    attempt: smallint('attempt').notNull().default(1),
    failureReason: text('failure_reason'),
    paidOn: date('paid_on'),
    recordedBy: uuid('recorded_by'),
    /** Cash collected at the pool: who took it, and when it reached the business (handover log). */
    receivedByStaffId: uuid('received_by_staff_id'),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    proofFileId: uuid('proof_file_id'),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payments_org_id').on(t.organizationId, t.id),
    unique('payments_idempotency').on(t.organizationId, t.idempotencyKey),
    foreignKey({
      name: 'payments_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // run, standing order, link, refunded payment, staff and file FKs use SET NULL: added in 0009.
    uniqueIndex('payments_external')
      .on(t.provider, t.externalId)
      .where(sql`external_id is not null`),
    index('payments_household').on(t.householdId, t.status),
    check('payments_kind_check', sql.raw(`kind in (${inList(PAYMENT_KINDS)})`)),
    check('payments_method_check', sql.raw(`method in (${inList(PAYMENT_METHODS)})`)),
    check('payments_source_check', sql`${t.source} in ('provider', 'manual')`),
    check('payments_status_check', sql.raw(`status in (${inList(PAYMENT_STATUSES)})`)),
    check('payments_amount_check', sql`${t.amountAgorot} > 0`),
    check('payments_attempt_check', sql`${t.attempt} >= 1`),
  ],
);

/**
 * The money ledger. Append-only: balances are derived, corrections are new entries (a reversal names the entry it
 * reverses). Signed amounts: positive is owed by the family, negative reduces what they owe.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    studentId: uuid('student_id'),
    enrollmentId: uuid('enrollment_id'),
    type: text('type').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    period: text('period'),
    description: text('description').notNull(),
    occurredOn: date('occurred_on').notNull(),
    source: text('source').notNull(),
    billingRunId: uuid('billing_run_id'),
    billingRunLineId: uuid('billing_run_line_id'),
    paymentId: uuid('payment_id'),
    reversesEntryId: uuid('reverses_entry_id'),
    policyVersionKey: text('policy_version_key'),
    explanation: jsonb('explanation'),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ledger_entries_org_id').on(t.organizationId, t.id),
    unique('ledger_entries_idempotency').on(t.organizationId, t.idempotencyKey),
    unique('ledger_entries_reversal_once').on(t.reversesEntryId),
    foreignKey({
      name: 'ledger_entries_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ledger_entries_reverses_fk',
      columns: [t.organizationId, t.reversesEntryId],
      foreignColumns: [t.organizationId, t.id],
    }).onDelete('cascade'),
    // Every other reference is history, not a constraint: the entry keeps its ids if the row goes (0009 adds none).
    index('ledger_entries_household').on(t.householdId, t.occurredOn),
    check('ledger_entries_type_check', sql.raw(`type in (${inList(LEDGER_ENTRY_TYPES)})`)),
    check('ledger_entries_source_check', sql.raw(`source in (${inList(LEDGER_SOURCES)})`)),
    check('ledger_entries_period_check', sql.raw(`period is null or period ~ ${PERIOD}`)),
    check(
      'ledger_entries_sign_check',
      sql`${t.amountAgorot} <> 0 and case
        when ${t.reversesEntryId} is not null then true
        when ${t.type} in ('charge', 'refund') then ${t.amountAgorot} > 0
        when ${t.type} in ('discount', 'credit', 'payment', 'write_off') then ${t.amountAgorot} < 0
        else true end`,
    ),
  ],
);

/** An invoice-receipt (or credit note) issued through the invoicing provider, with exactly what was sent. */
export const fiscalDocuments = pgTable(
  'fiscal_documents',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    paymentId: uuid('payment_id'),
    kind: text('kind').notNull().default('invoice_receipt'),
    status: text('status').notNull().default('pending'),
    /** The month the document covers when receipts are split per month. */
    period: text('period'),
    provider: text('provider').notNull(),
    externalId: text('external_id'),
    number: text('number'),
    pdfUrl: text('pdf_url'),
    totalAgorot: integer('total_agorot').notNull(),
    /** The request sent to the provider: client, lines, method, notes. */
    request: jsonb('request').notNull(),
    error: jsonb('error'),
    idempotencyKey: text('idempotency_key').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fiscal_documents_org_id').on(t.organizationId, t.id),
    unique('fiscal_documents_idempotency').on(t.organizationId, t.idempotencyKey),
    foreignKey({
      name: 'fiscal_documents_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // payment FK uses SET NULL on one column: added in 0009.
    index('fiscal_documents_household').on(t.householdId),
    check('fiscal_documents_kind_check', sql.raw(`kind in (${inList(FISCAL_DOCUMENT_KINDS)})`)),
    check(
      'fiscal_documents_status_check',
      sql.raw(`status in (${inList(FISCAL_DOCUMENT_STATUSES)})`),
    ),
  ],
);

/** An unpaid charge being chased: retries, reminders, and the owner once it is escalated. */
export const dunningCases = pgTable(
  'dunning_cases',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    /** The failed payment that opened it. */
    paymentId: uuid('payment_id'),
    status: text('status').notNull().default('open'),
    openedOn: date('opened_on').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    retriesDone: smallint('retries_done').notNull().default(0),
    nextActionOn: date('next_action_on'),
    /** [{ at, action, explanation }] */
    log: jsonb('log').notNull().default([]),
    policyVersionKey: text('policy_version_key'),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('dunning_cases_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'dunning_cases_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    // payment FK uses SET NULL on one column: added in 0009.
    uniqueIndex('dunning_cases_one_open')
      .on(t.householdId)
      .where(sql`status in ('open', 'escalated')`),
    check('dunning_cases_status_check', sql.raw(`status in (${inList(DUNNING_STATUSES)})`)),
    check('dunning_cases_retries_check', sql`${t.retriesDone} >= 0`),
  ],
);
