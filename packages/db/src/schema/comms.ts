import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  BLOCK_REASONS,
  BOT_HANDOFF_REASONS,
  BOT_KNOWLEDGE_SOURCES,
  BOT_KNOWLEDGE_STATUSES,
  BOT_REPLY_OUTCOMES,
  BOT_REVIEWS,
  BROADCAST_STATUSES,
  HOLD_REASONS,
  INBOUND_INTENTS,
  INBOUND_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_STATUSES,
  TEMPLATE_KEYS,
  TRIAGE_ACTION_KINDS,
  TRIAGE_ACTION_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

/** The text of every message the school sends, per organization and language. Keys are fixed; the owner edits bodies. */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    locale: text('locale').notNull().default('he'),
    channel: text('channel').notNull().default('whatsapp'),
    /** `{{variable}}` placeholders; a message with a missing variable is blocked, never sent half-filled. */
    body: text('body').notNull(),
    /** The approved WhatsApp template in GHL, for messages outside the 24-hour window. */
    ghlTemplateId: text('ghl_template_id'),
    active: boolean('active').notNull().default(true),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('message_templates_org_id').on(t.organizationId, t.id),
    unique('message_templates_key_locale').on(t.organizationId, t.key, t.locale),
    check('message_templates_key_check', sql.raw(`key in (${inList(TEMPLATE_KEYS)})`)),
    check('message_templates_locale_check', sql`${t.locale} in ('he', 'en')`),
    check('message_templates_channel_check', sql.raw(`channel in (${inList(MESSAGE_CHANNELS)})`)),
  ],
);

/** Which domain event sends which template. The owner turns each one on or off. */
export const automationRules = pgTable(
  'automation_rules',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    templateKey: text('template_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    delayMin: integer('delay_min').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('automation_rules_org_id').on(t.organizationId, t.id),
    unique('automation_rules_event').on(t.organizationId, t.eventType),
    check('automation_rules_template_check', sql.raw(`template_key in (${inList(TEMPLATE_KEYS)})`)),
    check('automation_rules_delay_check', sql`${t.delayMin} between 0 and 10080`),
  ],
);

/** A message to a segment of families: a template or free text, now or at a set time. */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    segment: jsonb('segment').notNull().default({}),
    templateKey: text('template_key'),
    body: text('body'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: text('status').notNull().default('draft'),
    /** { recipients, queued, blocked } once sent. */
    counts: jsonb('counts').notNull().default({}),
    createdBy: uuid('created_by'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('broadcasts_org_id').on(t.organizationId, t.id),
    check('broadcasts_status_check', sql.raw(`status in (${inList(BROADCAST_STATUSES)})`)),
    check(
      'broadcasts_content_check',
      sql`${t.templateKey} is not null or coalesce(${t.body}, '') <> ''`,
    ),
  ],
);

/**
 * The outbound log and queue: every message the system meant to send, whatever happened to it. queued → sent or
 * failed; held waits for its send window; blocked never goes out and says why.
 */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id'),
    householdId: uuid('household_id'),
    toPhoneE164: text('to_phone_e164'),
    channel: text('channel').notNull().default('whatsapp'),
    templateKey: text('template_key').notNull(),
    locale: text('locale').notNull().default('he'),
    /** The rendered text (null when a variable was missing). */
    body: text('body'),
    status: text('status').notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).notNull().defaultNow(),
    holdReason: text('hold_reason'),
    blockReason: text('block_reason'),
    /** The decision's explanation ({ code, params }). */
    explanation: jsonb('explanation'),
    error: text('error'),
    attempts: smallint('attempts').notNull().default(0),
    sourceEventId: uuid('source_event_id'),
    sourceEventType: text('source_event_type'),
    broadcastId: uuid('broadcast_id'),
    inboundMessageId: uuid('inbound_message_id'),
    providerMessageId: text('provider_message_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('messages_org_id').on(t.organizationId, t.id),
    unique('messages_idempotency').on(t.organizationId, t.idempotencyKey),
    index('messages_due').on(t.status, t.notBefore),
    index('messages_org_created').on(t.organizationId, t.createdAt),
    index('messages_household').on(t.householdId),
    check('messages_channel_check', sql.raw(`channel in (${inList(MESSAGE_CHANNELS)})`)),
    check('messages_template_check', sql.raw(`template_key in (${inList(TEMPLATE_KEYS)})`)),
    check('messages_status_check', sql.raw(`status in (${inList(MESSAGE_STATUSES)})`)),
    check(
      'messages_hold_check',
      sql.raw(`hold_reason is null or hold_reason in (${inList(HOLD_REASONS)})`),
    ),
    check(
      'messages_block_check',
      sql.raw(
        `(status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in (${inList(BLOCK_REASONS)}))`,
      ),
    ),
    check('messages_sent_check', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
  ],
);

/** A family's (or anyone's) WhatsApp message, matched to a guardian when the phone is known, with its classification. */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('ghl'),
    externalId: text('external_id').notNull(),
    fromPhoneE164: text('from_phone_e164'),
    guardianId: uuid('guardian_id'),
    householdId: uuid('household_id'),
    staffMemberId: uuid('staff_member_id'),
    body: text('body').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    intent: text('intent').notNull(),
    confidence: smallint('confidence').notNull(),
    /** The full Classification (classifier, entities, signals). */
    classification: jsonb('classification').notNull(),
    status: text('status').notNull().default('new'),
    handledBy: uuid('handled_by'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('inbound_messages_org_id').on(t.organizationId, t.id),
    unique('inbound_messages_external').on(t.organizationId, t.provider, t.externalId),
    index('inbound_messages_org_status').on(t.organizationId, t.status, t.receivedAt),
    index('inbound_messages_household').on(t.householdId),
    check('inbound_messages_intent_check', sql.raw(`intent in (${inList(INBOUND_INTENTS)})`)),
    check('inbound_messages_status_check', sql.raw(`status in (${inList(INBOUND_STATUSES)})`)),
    check('inbound_messages_confidence_check', sql`${t.confidence} between 0 and 100`),
  ],
);

/** The draft action an inbound message produced, approved or dismissed by the office with one tap. */
export const triageActions = pgTable(
  'triage_actions',
  {
    id: id(),
    organizationId: orgId(),
    inboundMessageId: uuid('inbound_message_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    /** The pre-filled form: { studentIds, date, sessionIds… } by kind. */
    payload: jsonb('payload').notNull().default({}),
    explanation: jsonb('explanation'),
    /** What approving created: { absenceNoticeIds… }. */
    result: jsonb('result'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('triage_actions_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'triage_actions_inbound_fk',
      columns: [t.organizationId, t.inboundMessageId],
      foreignColumns: [inboundMessages.organizationId, inboundMessages.id],
    }).onDelete('cascade'),
    uniqueIndex('triage_actions_one_pending')
      .on(t.inboundMessageId)
      .where(sql`status = 'pending'`),
    check('triage_actions_kind_check', sql.raw(`kind in (${inList(TRIAGE_ACTION_KINDS)})`)),
    check('triage_actions_status_check', sql.raw(`status in (${inList(TRIAGE_ACTION_STATUSES)})`)),
  ],
);

/**
 * What the parents' bot did with one family message: the answer it sent, or the summary it handed to the office.
 * One row per inbound message; the office marks answers good or bad.
 */
export const botReplies = pgTable(
  'bot_replies',
  {
    id: id(),
    organizationId: orgId(),
    inboundMessageId: uuid('inbound_message_id').notNull(),
    householdId: uuid('household_id'),
    outcome: text('outcome').notNull(),
    /** The model (or `fake:rules`, or `rules` when the bot did not ask a model). */
    model: text('model').notNull(),
    answer: text('answer'),
    handoffReason: text('handoff_reason'),
    /** For the office: what the family asked and what is missing, in a line or two. */
    handoffSummary: text('handoff_summary'),
    /** The knowledge entries the answer leaned on. */
    knowledgeIds: jsonb('knowledge_ids').notNull().default([]),
    /** The read tools the model called, with their results. */
    trace: jsonb('trace').notNull().default([]),
    /** The outgoing WhatsApp message (the answer or the "we passed it on" note). */
    messageId: uuid('message_id'),
    review: text('review').notNull().default('unreviewed'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bot_replies_org_id').on(t.organizationId, t.id),
    unique('bot_replies_once').on(t.organizationId, t.inboundMessageId),
    foreignKey({
      name: 'bot_replies_inbound_fk',
      columns: [t.organizationId, t.inboundMessageId],
      foreignColumns: [inboundMessages.organizationId, inboundMessages.id],
    }).onDelete('cascade'),
    index('bot_replies_recent').on(t.organizationId, t.createdAt),
    index('bot_replies_household').on(t.householdId, t.createdAt),
    check('bot_replies_outcome_check', sql.raw(`outcome in (${inList(BOT_REPLY_OUTCOMES)})`)),
    check('bot_replies_review_check', sql.raw(`review in (${inList(BOT_REVIEWS)})`)),
    check(
      'bot_replies_handoff_check',
      sql.raw(
        `(outcome = 'handed_off') = (handoff_reason is not null) and (handoff_reason is null or handoff_reason in (${inList(BOT_HANDOFF_REASONS)}))`,
      ),
    ),
    check('bot_replies_answer_check', sql`${t.outcome} <> 'answered' or ${t.answer} is not null`),
  ],
);

/**
 * The bot's questions and answers. The office writes them, and every answer the office gives to a question the bot
 * handed off becomes a suggestion here; only active entries reach the bot.
 */
export const botKnowledge = pgTable(
  'bot_knowledge',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    status: text('status').notNull().default('active'),
    source: text('source').notNull().default('office'),
    sourceInboundMessageId: uuid('source_inbound_message_id'),
    createdBy: uuid('created_by'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bot_knowledge_org_id').on(t.organizationId, t.id),
    index('bot_knowledge_org_status').on(t.organizationId, t.status),
    uniqueIndex('bot_knowledge_one_per_inbound')
      .on(t.organizationId, t.sourceInboundMessageId)
      .where(sql`source_inbound_message_id is not null`),
    check('bot_knowledge_status_check', sql.raw(`status in (${inList(BOT_KNOWLEDGE_STATUSES)})`)),
    check('bot_knowledge_source_check', sql.raw(`source in (${inList(BOT_KNOWLEDGE_SOURCES)})`)),
    check('bot_knowledge_question_check', sql`length(${t.question}) between 1 and 500`),
    check('bot_knowledge_answer_check', sql`length(${t.answer}) between 1 and 1000`),
  ],
);
