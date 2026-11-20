import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { DIVER_ORIGINS, LEAD_LOST_REASONS, LEAD_SOURCES, LEAD_STAGES } from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

/**
 * Someone who asked about the business and is not a customer yet (WhatsApp track, stage 1), in a swim school or a
 * freediving club. One row per phone: a new number writing on WhatsApp opens it, a join request opens or updates it,
 * and a trial, a new family or a new diver moves it on (database triggers, migration 0064). Only the office sees it.
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null until the person says their name (a WhatsApp number alone). */
    name: text('name'),
    phoneE164: text('phone_e164'),
    source: text('source').notNull(),
    stage: text('stage').notNull().default('new'),
    /** What they asked about, in words (a program, an age group). */
    interest: text('interest'),
    /** A freediving club's lead: from Eilat, elsewhere in Israel or abroad. */
    origin: text('origin'),
    note: text('note'),
    lostReason: text('lost_reason'),
    nextActionOn: date('next_action_on'),
    /** What the bot or the office learned (children, ages, experience), for later stages. */
    details: jsonb('details').notNull().default({}),
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessage: text('last_message'),
    /** The family once the phone is on file (swim schools). */
    householdId: uuid('household_id'),
    /** The diver once the phone is on file (freediving clubs). */
    diverId: uuid('diver_id'),
    joinRequestId: uuid('join_request_id'),
    /**
     * The personal invite the bot sends (WhatsApp track): a link only this person's phone can use to sign in and land
     * in the business, valid for a while; kept once used so the office sees they came in.
     */
    inviteToken: text('invite_token'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    inviteUsedAt: timestamp('invite_used_at', { withTimezone: true }),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('leads_org_id').on(t.organizationId, t.id),
    uniqueIndex('leads_org_phone')
      .on(t.organizationId, t.phoneE164)
      .where(sql`phone_e164 is not null`),
    uniqueIndex('leads_invite_token')
      .on(t.inviteToken)
      .where(sql`invite_token is not null`),
    index('leads_org_stage').on(t.organizationId, t.stage, t.createdAt),
    check('leads_stage_check', sql.raw(`stage in (${inList(LEAD_STAGES)})`)),
    check('leads_source_check', sql.raw(`source in (${inList(LEAD_SOURCES)})`)),
    check('leads_origin_check', sql.raw(`origin is null or origin in (${inList(DIVER_ORIGINS)})`)),
    check(
      'leads_lost_check',
      sql.raw(
        `(lost_reason is null or stage = 'lost') and (lost_reason is null or lost_reason in (${inList(LEAD_LOST_REASONS)}))`,
      ),
    ),
    check('leads_who_check', sql`${t.name} is not null or ${t.phoneE164} is not null`),
  ],
);
