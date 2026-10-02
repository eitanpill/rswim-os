import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CERTIFICATION_TYPES, ORG_ROLES, PAY_BASES, PAY_ROUTINGS } from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { programs } from './catalog';
import { staffMembers } from './people';
import { organizations } from './tenancy';
import { venues } from './venues';

const staffFk = (name: string, t: { organizationId: AnyPgColumn; staffMemberId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.organizationId, t.staffMemberId],
    foreignColumns: [staffMembers.organizationId, staffMembers.id],
  }).onDelete('cascade');

export const certifications = pgTable(
  'certifications',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    type: text('type').notNull(),
    issuer: text('issuer'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    fileId: uuid('file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('certifications_org_id').on(t.organizationId, t.id),
    staffFk('certifications_staff_fk', t),
    index('certifications_expiry').on(t.organizationId, t.expiresOn),
    check('certifications_type_check', sql.raw(`type in (${inList(CERTIFICATION_TYPES)})`)),
  ],
);

/** Weekly availability. venue_id null = any venue. */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    venueId: uuid('venue_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('availability_rules_org_id').on(t.organizationId, t.id),
    staffFk('availability_rules_staff_fk', t),
    foreignKey({
      name: 'availability_rules_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    check('availability_rules_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('availability_rules_time_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'availability_rules_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/** One-off changes: a vacation (unavailable) or an extra day (available). Times null = whole day. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    kind: text('kind').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    startsAt: time('starts_at'),
    endsAt: time('ends_at'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('availability_exceptions_org_id').on(t.organizationId, t.id),
    staffFk('availability_exceptions_staff_fk', t),
    check('availability_exceptions_kind_check', sql`${t.kind} in ('unavailable', 'available')`),
    check('availability_exceptions_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      'availability_exceptions_time_check',
      sql`(${t.startsAt} is null) = (${t.endsAt} is null) and (${t.endsAt} is null or ${t.endsAt} > ${t.startsAt})`,
    ),
  ],
);

/**
 * Versioned pay rules (brief §5). A hybrid instructor has e.g. a per-session group rule routed to the payslip and a
 * per-session private rule routed to transfer. program_id / venue_id null = any.
 */
export const payRules = pgTable(
  'pay_rules',
  {
    id: id(),
    organizationId: orgId(),
    staffMemberId: uuid('staff_member_id').notNull(),
    basis: text('basis').notNull(),
    amountAgorot: integer('amount_agorot').notNull(),
    programId: uuid('program_id'),
    venueId: uuid('venue_id'),
    routing: text('routing').notNull().default('payslip'),
    travelAllowanceAgorot: integer('travel_allowance_agorot').notNull().default(0),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pay_rules_org_id').on(t.organizationId, t.id),
    staffFk('pay_rules_staff_fk', t),
    foreignKey({
      name: 'pay_rules_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'pay_rules_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    check('pay_rules_basis_check', sql.raw(`basis in (${inList(PAY_BASES)})`)),
    check('pay_rules_routing_check', sql.raw(`routing in (${inList(PAY_ROUTINGS)})`)),
    check(
      'pay_rules_amount_check',
      sql`${t.amountAgorot} >= 0 and ${t.travelAllowanceAgorot} >= 0`,
    ),
    check(
      'pay_rules_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/** Owner invites staff by email or phone. Only the SHA-256 of the token is stored; acceptance is app.accept_invite(). */
export const staffInvites = pgTable(
  'staff_invites',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    email: text('email'),
    phoneE164: text('phone_e164'),
    staffMemberId: uuid('staff_member_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('staff_invites_org_id').on(t.organizationId, t.id),
    check(
      'staff_invites_role_check',
      sql.raw(`role in (${inList(ORG_ROLES.filter((r) => r !== 'parent'))})`),
    ),
    check('staff_invites_contact_check', sql`${t.email} is not null or ${t.phoneE164} is not null`),
  ],
);
