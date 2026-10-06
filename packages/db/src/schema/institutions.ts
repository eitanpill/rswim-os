/**
 * Institutions (brief §6.11): a school, council or after-school framework that pays for its children's swimming under
 * a contract. The contract names the groups it pays for; the roster is the children placed in them. Each month gets
 * one invoice (a tax invoice through the invoicing provider), and payments are tracked against it. Families of
 * children in those groups are not billed for them.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import {
  CONTRACT_PRICING,
  INSTITUTION_INVOICE_STATUSES,
  INSTITUTION_KINDS,
  INSTITUTION_PAYMENT_METHODS,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { classTemplates } from './scheduling';
import { organizations } from './tenancy';

const org = () => orgId().references(() => organizations.id, { onDelete: 'cascade' });

export const institutions = pgTable(
  'institutions',
  {
    id: id(),
    organizationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** Company or nonprofit number for the tax invoice (a business identifier, not personal data). */
    taxId: text('tax_id'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    address: text('address'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('institutions_org_id').on(t.organizationId, t.id),
    unique('institutions_org_name').on(t.organizationId, t.name),
    check('institutions_kind_check', sql.raw(`kind in (${inList(INSTITUTION_KINDS)})`)),
  ],
);

/** The agreement: dates, how a month is priced, and when the invoice falls due. */
export const institutionContracts = pgTable(
  'institution_contracts',
  {
    id: id(),
    organizationId: org(),
    institutionId: uuid('institution_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    pricing: text('pricing').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    /** Days from the invoice date to its due date (שוטף + N is written as N + days to month end). */
    paymentTermsDays: smallint('payment_terms_days').notNull().default(30),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('institution_contracts_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'institution_contracts_institution_fk',
      columns: [t.organizationId, t.institutionId],
      foreignColumns: [institutions.organizationId, institutions.id],
    }).onDelete('cascade'),
    check(
      'institution_contracts_pricing_check',
      sql.raw(`pricing in (${inList(CONTRACT_PRICING)})`),
    ),
    check('institution_contracts_amount_check', sql`${t.amountAgorot} >= 0`),
    check('institution_contracts_terms_check', sql`${t.paymentTermsDays} between 0 and 180`),
    check('institution_contracts_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** The groups a contract pays for. A group is paid by at most one contract at a time (checked by the service). */
export const institutionContractGroups = pgTable(
  'institution_contract_groups',
  {
    id: id(),
    organizationId: org(),
    contractId: uuid('contract_id').notNull(),
    classTemplateId: uuid('class_template_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('institution_contract_groups_org_id').on(t.organizationId, t.id),
    unique('institution_contract_groups_once').on(t.contractId, t.classTemplateId),
    foreignKey({
      name: 'institution_contract_groups_contract_fk',
      columns: [t.organizationId, t.contractId],
      foreignColumns: [institutionContracts.organizationId, institutionContracts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'institution_contract_groups_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
  ],
);

/** One month's invoice for a contract, with the lines it was computed from (children, lessons) frozen in. */
export const institutionInvoices = pgTable(
  'institution_invoices',
  {
    id: id(),
    organizationId: org(),
    contractId: uuid('contract_id').notNull(),
    period: text('period').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    lines: jsonb('lines').notNull(),
    explanation: jsonb('explanation').notNull(),
    status: text('status').notNull().default('draft'),
    dueOn: date('due_on'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    documentId: text('document_id'),
    documentNumber: text('document_number'),
    pdfUrl: text('pdf_url'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('institution_invoices_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'institution_invoices_contract_fk',
      columns: [t.organizationId, t.contractId],
      foreignColumns: [institutionContracts.organizationId, institutionContracts.id],
    }).onDelete('cascade'),
    uniqueIndex('institution_invoices_month')
      .on(t.contractId, t.period)
      .where(sql`status <> 'cancelled'`),
    check(
      'institution_invoices_status_check',
      sql.raw(`status in (${inList(INSTITUTION_INVOICE_STATUSES)})`),
    ),
    check('institution_invoices_period_check', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('institution_invoices_amount_check', sql`${t.amountAgorot} >= 0`),
  ],
);

/** A payment received against an invoice. Append-only: a mistake is corrected by a negative payment. */
export const institutionPayments = pgTable(
  'institution_payments',
  {
    id: id(),
    organizationId: org(),
    invoiceId: uuid('invoice_id').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    paidOn: date('paid_on').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    receiptDocumentId: text('receipt_document_id'),
    receiptNumber: text('receipt_number'),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('institution_payments_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'institution_payments_invoice_fk',
      columns: [t.organizationId, t.invoiceId],
      foreignColumns: [institutionInvoices.organizationId, institutionInvoices.id],
    }).onDelete('cascade'),
    check(
      'institution_payments_method_check',
      sql.raw(`method in (${inList(INSTITUTION_PAYMENT_METHODS)})`),
    ),
    check('institution_payments_amount_check', sql`${t.amountAgorot} <> 0`),
  ],
);
