/**
 * Phase 9 insights: the owner's copilot (brief §6.15) and the weekly digest. A copilot request stores what the owner
 * asked and what the model answered; every action it proposes waits in `copilot_actions` until the owner confirms it,
 * and then runs through the ordinary domain services.
 */
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
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AGENT_ACTION_KINDS,
  AGENT_PROFILES,
  AGENT_SOURCES,
  AUTONOMY_LEVELS,
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

/**
 * The brain's journal (docs/AI-BRAIN.md): every action it proposed or took, from any channel. A row from the owner's
 * chat carries its request; `autonomy` is the level the gate applied, and `ran_alone` marks an action that ran
 * without a person's tap (decided_by is then null).
 */
export const copilotActions = pgTable(
  'copilot_actions',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id'),
    source: text('source').notNull().default('owner_chat'),
    autonomy: text('autonomy'),
    ranAlone: boolean('ran_alone').notNull().default(false),
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
    index('copilot_actions_recent').on(t.organizationId, t.createdAt),
    check('copilot_actions_kind_check', sql.raw(`kind in (${inList(AGENT_ACTION_KINDS)})`)),
    check('copilot_actions_source_check', sql.raw(`source in (${inList(AGENT_SOURCES)})`)),
    check(
      'copilot_actions_autonomy_check',
      sql.raw(`autonomy is null or autonomy in (${inList(AUTONOMY_LEVELS)})`),
    ),
    check('copilot_actions_alone_check', sql`not ${t.ranAlone} or ${t.decidedBy} is null`),
    check(
      'copilot_actions_status_check',
      sql.raw(`status in (${inList(COPILOT_ACTION_STATUSES)})`),
    ),
  ],
);

/**
 * How much the brain may do on its own in one school (docs/AI-BRAIN.md): a level per kind of action, the caps above
 * them and the stop switch. One row per school; no row means the careful profile.
 */
export const agentSettings = pgTable(
  'agent_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profile: text('profile').notNull().default('careful'),
    /** { kind: level } for every kind the owner set; a missing kind takes the profile's level. */
    levels: jsonb('levels').notNull().default({}),
    maxAutoPerDay: integer('max_auto_per_day').notNull().default(30),
    maxAutoPaymentAgorot: integer('max_auto_payment_agorot').notNull().default(30000),
    paused: boolean('paused').notNull().default(false),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  () => [
    check('agent_settings_profile_check', sql.raw(`profile in (${inList(AGENT_PROFILES)})`)),
    check('agent_settings_caps_check', sql`max_auto_per_day >= 0 and max_auto_payment_agorot >= 0`),
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
