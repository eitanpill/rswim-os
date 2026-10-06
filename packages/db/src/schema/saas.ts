/**
 * Phase 10 SaaS: plans and subscriptions, the platform's own invoices to schools, custom domains and the template
 * marketplace. Plans and templates are platform-wide; the rest belongs to one school. A school without a
 * subscription row (R-SWIM itself before Phase 10) has no limits.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
  DOMAIN_STATUSES,
  PLAN_FEATURES,
  PLATFORM_INVOICE_STATUSES,
  SUBSCRIPTION_STATUSES,
  TEMPLATE_KINDS,
  TEMPLATE_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

export const plans = pgTable(
  'plans',
  {
    code: text('code').primaryKey(),
    nameHe: text('name_he').notNull(),
    nameEn: text('name_en').notNull(),
    priceAgorot: integer('price_agorot').notNull(),
    /** null = unlimited. */
    maxStudents: integer('max_students'),
    maxStaff: integer('max_staff'),
    maxVenues: integer('max_venues'),
    features: text('features')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    trialDays: smallint('trial_days').notNull().default(14),
    /** Days a declined school stays past due before it is suspended. */
    graceDays: smallint('grace_days').notNull().default(10),
    active: boolean('active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check('plans_price_check', sql`${t.priceAgorot} >= 0`),
    check('plans_features_check', sql.raw(`features <@ array[${inList(PLAN_FEATURES)}]::text[]`)),
  ],
);

export const orgSubscriptions = pgTable(
  'org_subscriptions',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    status: text('status').notNull().default('trialing'),
    trialEndsOn: date('trial_ends_on'),
    /** The school's standing payment authorization with the platform's payment provider. */
    mandateId: text('mandate_id'),
    pastDueSince: date('past_due_since'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check(
      'org_subscriptions_status_check',
      sql.raw(`status in (${inList(SUBSCRIPTION_STATUSES)})`),
    ),
  ],
);

/** The platform's monthly bill to a school. One per school and month; corrections void and reissue. */
export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** First day of the billed month. */
    period: date('period').notNull(),
    planCode: text('plan_code').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    status: text('status').notNull().default('open'),
    attempts: smallint('attempts').notNull().default(0),
    externalPaymentId: text('external_payment_id'),
    failureCode: text('failure_code'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('platform_invoices_org_id').on(t.organizationId, t.id),
    unique('platform_invoices_org_period').on(t.organizationId, t.period),
    check('platform_invoices_amount_check', sql`${t.amountAgorot} >= 0`),
    check(
      'platform_invoices_status_check',
      sql.raw(`status in (${inList(PLATFORM_INVOICE_STATUSES)})`),
    ),
  ],
);

/** A school's own host name (white label). Verified by a DNS TXT record `_rswim.<host>` holding the token. */
export const orgDomains = pgTable(
  'org_domains',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    host: text('host').notNull().unique(),
    status: text('status').notNull().default('pending'),
    token: text('token').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('org_domains_org_id').on(t.organizationId, t.id),
    check('org_domains_status_check', sql.raw(`status in (${inList(DOMAIN_STATUSES)})`)),
    check(
      'org_domains_host_check',
      sql`${t.host} ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    ),
  ],
);

/** Shared starting points other schools can install: regulations, a catalog with prices, message wording. */
export const templates = pgTable(
  'templates',
  {
    id: id(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    name: text('name').notNull(),
    description: text('description'),
    payload: jsonb('payload').notNull(),
    /** The school that shared it; null for the platform's own. */
    sourceOrganizationId: uuid('source_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('templates_status_kind').on(t.status, t.kind),
    check('templates_kind_check', sql.raw(`kind in (${inList(TEMPLATE_KINDS)})`)),
    check('templates_status_check', sql.raw(`status in (${inList(TEMPLATE_STATUSES)})`)),
  ],
);

export const templateInstalls = pgTable(
  'template_installs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    installedBy: uuid('installed_by'),
    /** What the install created (policy version id, price list id, programs added, templates updated). */
    result: jsonb('result').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique('template_installs_org_id').on(t.organizationId, t.id),
    index('template_installs_org').on(t.organizationId, t.createdAt),
  ],
);
