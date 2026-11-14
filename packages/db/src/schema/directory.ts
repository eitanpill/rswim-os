import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { JOIN_REQUEST_KINDS, JOIN_REQUEST_STATUSES } from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { guardians } from './people';
import { organizations } from './tenancy';

/**
 * Someone who found a school (its link, its QR or the app's search) asks to join it or to book a trial lesson
 * (store launch, stage 4). The office accepts (the family and children are created, and the person gets the parent
 * app) or declines. Only the school's office sees these rows; the person sees their own through `my_join_requests`.
 */
export const joinRequests = pgTable(
  'join_requests',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** The signed-in person who asked (a verified phone sign-in). */
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull().default('join'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    email: text('email'),
    /** The children, as the parent typed them: [{ firstName, dob? }]. */
    children: jsonb('children').notNull().default([]),
    note: text('note'),
    status: text('status').notNull().default('new'),
    /** The family's contact once accepted (an existing one when the office already knew the phone). */
    guardianId: uuid('guardian_id'),
    handledBy: uuid('handled_by'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('join_requests_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'join_requests_guardian_fk',
      columns: [t.organizationId, t.guardianId],
      foreignColumns: [guardians.organizationId, guardians.id],
    }),
    uniqueIndex('join_requests_one_open')
      .on(t.organizationId, t.userId)
      .where(sql`status = 'new'`),
    index('join_requests_org_status').on(t.organizationId, t.status),
    check('join_requests_kind_check', sql.raw(`kind in (${inList(JOIN_REQUEST_KINDS)})`)),
    check('join_requests_status_check', sql.raw(`status in (${inList(JOIN_REQUEST_STATUSES)})`)),
  ],
);
