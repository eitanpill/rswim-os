/**
 * Phase 9 insights: the owner's copilot (brief §6.15) and the weekly digest. A copilot request stores what the owner
 * asked and what the model answered; every action it proposes waits in `copilot_actions` until the owner confirms it,
 * and then runs through the ordinary domain services.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  COPILOT_ACTION_KINDS,
  COPILOT_ACTION_STATUSES,
  COPILOT_REQUEST_STATUSES,
  INSIGHT_KINDS,
  INSIGHT_SEVERITIES,
  INSIGHT_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

export const copilotRequests = pgTable(
  'copilot_requests',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    prompt: text('prompt').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    answer: text('answer'),
    /** The read tools the model called, with a short summary of each result. */
    trace: jsonb('trace').notNull().default([]),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('copilot_requests_org_id').on(t.organizationId, t.id),
    index('copilot_requests_recent').on(t.organizationId, t.createdAt),
    check(
      'copilot_requests_status_check',
      sql.raw(`status in (${inList(COPILOT_REQUEST_STATUSES)})`),
    ),
  ],
);

export const copilotActions = pgTable(
  'copilot_actions',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    params: jsonb('params').notNull(),
    /** What the owner reads before confirming: an i18n code and params built from the params, never the model's words. */
    summary: jsonb('summary').notNull(),
    status: text('status').notNull().default('proposed'),
    /** What the confirmed action did (ids an undo needs). */
    result: jsonb('result'),
    errorCode: text('error_code'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('copilot_actions_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'copilot_actions_request_fk',
      columns: [t.organizationId, t.requestId],
      foreignColumns: [copilotRequests.organizationId, copilotRequests.id],
    }).onDelete('cascade'),
    index('copilot_actions_request').on(t.requestId),
    check('copilot_actions_kind_check', sql.raw(`kind in (${inList(COPILOT_ACTION_KINDS)})`)),
    check(
      'copilot_actions_status_check',
      sql.raw(`status in (${inList(COPILOT_ACTION_STATUSES)})`),
    ),
  ],
);

/** The owner's Sunday-morning digest: the facts it was built from and the items it shows. */
export const weeklyDigests = pgTable(
  'weekly_digests',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** The Sunday the digest's week starts. */
    weekOf: date('week_of').notNull(),
    facts: jsonb('facts').notNull(),
    items: jsonb('items').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('weekly_digests_org_id').on(t.organizationId, t.id),
    unique('weekly_digests_once').on(t.organizationId, t.weekOf),
  ],
);

/**
 * The owner's insights feed: what the daily check noticed (a group emptying, families at risk of leaving, lessons with
 * no instructor). One row per insight key, kept current by the check; advisory only, nothing here changes data.
 */
export const ownerInsights = pgTable(
  'owner_insights',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stable identity: the kind plus its subject (a group id, or a fingerprint of the families listed). */
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    /** i18n params for the title and the recommendation, and the screen it points to. */
    params: jsonb('params').notNull(),
    /** The subjects behind it (families, lessons) as structured facts: the list the screen shows and Claude reads. */
    detail: jsonb('detail').notNull().default([]),
    href: text('href'),
    /** Claude's Hebrew explanation and recommendation for these params; cleared when the params change. */
    note: jsonb('note'),
    status: text('status').notNull().default('open'),
    firstSeenOn: date('first_seen_on').notNull(),
    lastSeenOn: date('last_seen_on').notNull(),
    /** A dismissed insight comes back after this date if the rule still fires. */
    snoozedUntil: date('snoozed_until'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('owner_insights_org_id').on(t.organizationId, t.id),
    unique('owner_insights_key').on(t.organizationId, t.key),
    index('owner_insights_status').on(t.organizationId, t.status),
    check('owner_insights_kind_check', sql.raw(`kind in (${inList(INSIGHT_KINDS)})`)),
    check('owner_insights_severity_check', sql.raw(`severity in (${inList(INSIGHT_SEVERITIES)})`)),
    check('owner_insights_status_check', sql.raw(`status in (${inList(INSIGHT_STATUSES)})`)),
  ],
);
