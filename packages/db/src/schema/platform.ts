import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, orgId } from './_helpers';
import { organizations } from './tenancy';

/** Append-only (trigger-enforced). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(), // insert | update | delete | sensitive_read | …
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    diff: jsonb('diff'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_at').on(t.organizationId, t.at)],
);

/** Transactional outbox (ADR-0002). Written in the same transaction as the change it announces. */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    unique('outbox_org_idempotency').on(t.organizationId, t.idempotencyKey),
    index('outbox_pending').on(t.availableAt).where(sqlPending()),
  ],
);

function sqlPending() {
  return sql`dispatched_at is null`;
}

/** A consumer records each event it handled; the primary key makes handling at-most-once per consumer. */
export const inboxReceipts = pgTable(
  'inbox_receipts',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    organizationId: orgId(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.eventId] })],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    raw: jsonb('raw').notNull(),
    status: text('status').notNull().default('received'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [unique('webhook_events_provider_external').on(t.provider, t.externalId)],
);

export const deadLetters = pgTable('dead_letters', {
  id: id(),
  organizationId: uuid('organization_id'),
  source: text('source').notNull(),
  refId: text('ref_id'),
  payload: jsonb('payload'),
  error: text('error').notNull(),
  createdAt: createdAt(),
});
