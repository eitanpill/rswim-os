import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { ORG_ROLES, VERTICALS } from '@rswim/contracts';
import { bytea, createdAt, id, orgId, updatedAt } from './_helpers';

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    taxStatus: text('tax_status').notNull().default('licensed'), // עוסק מורשה
    vatNumber: text('vat_number'),
    timezone: text('timezone').notNull().default('Asia/Jerusalem'),
    defaultLocale: text('default_locale').notNull().default('he'),
    status: text('status').notNull().default('active'),
    /** Swim school or freediving club: decides which screens the school's people land on. */
    vertical: text('vertical').notNull().default('swim'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'organizations_vertical_check',
      sql`${t.vertical} in (${sql.raw(VERTICALS.map((v) => `'${v}'`).join(', '))})`,
    ),
  ],
);

export const orgSettings = pgTable('org_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  branding: jsonb('branding').notNull().default({}),
  encBusinessBankDetails: bytea('enc_business_bank_details'),
  vatRateBp: integer('vat_rate_bp').notNull().default(1800),
  billingRunDay: integer('billing_run_day').notNull().default(1),
  quietHours: jsonb('quiet_hours').notNull().default({ start: '21:30', end: '08:00' }),
  integrations: jsonb('integrations').notNull().default({}),
  updatedAt: updatedAt(),
});

/** Per-org data-encryption key, wrapped by the master key (ADR-0005). Never readable by app users. */
export const orgKeys = pgTable('org_keys', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  wrappedDek: bytea('wrapped_dek').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(), // FK to auth.users added in SQL (outside drizzle's schema)
    role: text('role', { enum: ORG_ROLES }).notNull(),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    staffMemberId: uuid('staff_member_id'),
    guardianId: uuid('guardian_id'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_org_user').on(t.organizationId, t.userId),
    check(
      'memberships_role_check',
      sql`${t.role} in (${sql.raw(ORG_ROLES.map((r) => `'${r}'`).join(', '))})`,
    ),
    check(
      'memberships_parent_has_guardian',
      sql`${t.role} <> 'parent' or ${t.guardianId} is not null`,
    ),
  ],
);

export const platformAdmins = pgTable('platform_admins', {
  userId: uuid('user_id').primaryKey(),
  createdAt: createdAt(),
});

export const featureFlags = pgTable(
  'feature_flags',
  {
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const files = pgTable(
  'files',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    purpose: text('purpose').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('files_org_id').on(t.organizationId, t.id),
    unique('files_bucket_path').on(t.bucket, t.path),
  ],
);
