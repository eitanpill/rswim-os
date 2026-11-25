/**
 * The conversations screen (WhatsApp track W9): every WhatsApp conversation of the business in one list, by phone,
 * whoever the person is (a family, a new customer, a diver, staff). The office reads the whole thread, answers, and
 * takes a conversation over: while it holds it no bot answers that number.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requiredText } from '@rswim/contracts';
import { and, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { leadNames } from '@rswim/domain-crm';
import { guardiansOfHouseholds } from '@rswim/domain-people';
import { botScore, chatKind, windowOpen, type BotScore, type ChatKind } from '../policies';
import { replyToInbound, replyToLead } from './inbox';
import { enqueueMessage } from './outbound';

const { chatHolds, inboundMessages } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/** A stored phone (+972…), as the list links to it. */
export const ChatPhone = z.string().regex(/^\+\d{8,15}$/, 'common.errors.invalid');

export const CHAT_FILTERS = ['all', 'waiting', 'held'] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

export interface ChatRow {
  phone: string;
  kind: ChatKind;
  name: string | null;
  householdId: string | null;
  leadId: string | null;
  /** The newest line of the conversation, either direction. */
  lastBody: string;
  lastAt: Date;
  lastDirection: 'in' | 'out';
  /** Messages of this person still waiting in the inbox. */
  open: number;
  /** A person took the conversation: the bot stays quiet. */
  held: boolean;
  /** What the bot did with the person's last message. */
  bot: 'answered' | 'handed_off' | null;
}

interface RawChat {
  phone: string;
  householdId: string | null;
  guardianId: string | null;
  leadId: string | null;
  staffMemberId: string | null;
  inBody: string;
  inAt: Date | string;
  outBody: string | null;
  outAt: Date | string | null;
  open: number;
  held: boolean;
  bot: 'answered' | 'handed_off' | null;
}

async function namesFor(
  tx: Tx,
  list: { householdId: string | null; guardianId: string | null; leadId: string | null }[],
) {
  const guardians = await guardiansOfHouseholds(tx, [
    ...new Set(list.map((r) => r.householdId).filter((h): h is string => h !== null)),
  ]);
  const leads = await leadNames(tx, [
    ...new Set(list.map((r) => r.leadId).filter((l): l is string => l !== null)),
  ]);
  return (r: { guardianId: string | null; leadId: string | null }): string | null => {
    const g = guardians.find((x) => x.id === r.guardianId);
    if (g) return `${g.firstName} ${g.lastName}`.trim();
    return (r.leadId ? leads.get(r.leadId) : null) ?? null;
  };
}

/** Every conversation, the latest first. `waiting` keeps the ones with a message in the inbox, `held` the taken ones. */
export async function listChats(
  tx: Tx,
  q: { filter?: ChatFilter; limit?: number } = {},
): Promise<ChatRow[]> {
  const filter =
    q.filter === 'waiting'
      ? sql`where coalesce(o.n, 0) > 0`
      : q.filter === 'held'
        ? sql`where h.id is not null`
        : sql``;
  const list = await rows<RawChat>(
    tx,
    sql`with last_in as (
          select distinct on (from_phone_e164) from_phone_e164 phone, id, body, received_at, household_id,
                 guardian_id, lead_id, staff_member_id
          from inbound_messages where from_phone_e164 is not null
          order by from_phone_e164, received_at desc
        ), waiting as (
          select from_phone_e164 phone, count(*)::int n from inbound_messages
          where from_phone_e164 is not null and status in ('new', 'needs_human') group by 1
        ), last_out as (
          select distinct on (to_phone_e164) to_phone_e164 phone, body, created_at
          from messages where to_phone_e164 is not null and body is not null and status <> 'blocked'
          order by to_phone_e164, created_at desc
        )
        select i.phone, i.household_id "householdId", i.guardian_id "guardianId", i.lead_id "leadId",
               i.staff_member_id "staffMemberId", i.body "inBody", i.received_at "inAt", m.body "outBody",
               m.created_at "outAt", coalesce(o.n, 0) open, h.id is not null held, b.outcome bot
        from last_in i
        left join waiting o on o.phone = i.phone
        left join last_out m on m.phone = i.phone
        left join chat_holds h on h.phone_e164 = i.phone
        left join bot_replies b on b.inbound_message_id = i.id
        ${filter}
        order by greatest(i.received_at, coalesce(m.created_at, i.received_at)) desc
        limit ${q.limit ?? 100}`,
  );
  const nameOf = await namesFor(tx, list);
  return list.map((r) => {
    const inAt = new Date(r.inAt);
    const outAt = r.outAt ? new Date(r.outAt) : null;
    const outLast = outAt !== null && r.outBody !== null && outAt > inAt;
    return {
      phone: r.phone,
      kind: chatKind(r),
      name: nameOf(r),
      householdId: r.householdId,
      leadId: r.leadId,
      lastBody: outLast ? (r.outBody as string) : r.inBody,
      lastAt: outLast ? (outAt as Date) : inAt,
      lastDirection: outLast ? 'out' : 'in',
      open: r.open,
      held: r.held,
      bot: r.bot,
    };
  });
}

export interface ChatLine {
  id: string;
  direction: 'in' | 'out';
  body: string;
  at: Date;
  /** Who wrote an outgoing line: the bot, a person at the office, or an automatic message. */
  by: 'person' | 'bot' | 'office' | 'auto';
  /** An outgoing line's delivery status. */
  status: string | null;
}

/** One conversation, both directions, oldest first, with who the person is and whether a person holds it. */
export async function getChat(tx: Tx, rawPhone: string, now = new Date()) {
  const phone = ChatPhone.parse(rawPhone);
  const ins = await rows<{
    id: string;
    body: string;
    at: Date | string;
    householdId: string | null;
    guardianId: string | null;
    leadId: string | null;
    staffMemberId: string | null;
  }>(
    tx,
    sql`select id, body, received_at at, household_id "householdId", guardian_id "guardianId", lead_id "leadId",
               staff_member_id "staffMemberId"
        from inbound_messages where from_phone_e164 = ${phone} order by received_at desc limit 100`,
  );
  const last = ins[0];
  if (!last) throw new DomainError('common.errors.notFound');
  const outs = await rows<{
    id: string;
    body: string;
    at: Date | string;
    status: string;
    office: boolean;
    bot: boolean;
  }>(
    tx,
    sql`select m.id, m.body, m.created_at at, m.status, m.created_by is not null office,
               exists (select 1 from bot_replies b where b.message_id = m.id) bot
        from messages m
        where m.to_phone_e164 = ${phone} and m.body is not null and m.status <> 'blocked'
        order by m.created_at desc limit 100`,
  );
  const [hold] = await tx
    .select({ takenAt: chatHolds.takenAt })
    .from(chatHolds)
    .where(eq(chatHolds.phoneE164, phone));
  const lines: ChatLine[] = [
    ...ins.map((m) => ({
      id: m.id,
      direction: 'in' as const,
      body: m.body,
      at: new Date(m.at),
      by: 'person' as const,
      status: null,
    })),
    ...outs.map((m) => ({
      id: m.id,
      direction: 'out' as const,
      body: m.body,
      at: new Date(m.at),
      by: m.bot ? ('bot' as const) : m.office ? ('office' as const) : ('auto' as const),
      status: m.status,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    phone,
    kind: chatKind(last),
    name: (await namesFor(tx, [last]))(last),
    householdId: last.householdId,
    leadId: last.leadId,
    heldSince: hold?.takenAt ?? null,
    /** Free text may go only while WhatsApp's 24-hour window is open. */
    windowOpen: windowOpen(new Date(last.at), now),
    lines: lines.slice(-150),
  };
}

/** Whether a person took this number's conversation (every bot checks before it answers). */
export async function chatHeld(tx: Tx, phoneE164: string | null): Promise<boolean> {
  if (!phoneE164) return false;
  const [h] = await tx
    .select({ id: chatHolds.id })
    .from(chatHolds)
    .where(eq(chatHolds.phoneE164, phoneE164));
  return h !== undefined;
}

export const ChatHoldInput = z.object({ phone: ChatPhone });

/** "I'm taking over": from now on the bot leaves this number to the office. Taking twice changes nothing. */
export async function takeOverChat(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof ChatHoldInput>,
) {
  const { phone } = ChatHoldInput.parse(raw);
  await tx
    .insert(chatHolds)
    .values({ organizationId: ctx.orgId, phoneE164: phone, takenBy: ctx.userId })
    .onConflictDoNothing();
}

/** The conversation goes back to the bot. */
export async function releaseChat(tx: Tx, raw: z.input<typeof ChatHoldInput>) {
  const { phone } = ChatHoldInput.parse(raw);
  await tx.delete(chatHolds).where(eq(chatHolds.phoneE164, phone));
}

export const ChatReplyInput = z.object({ phone: ChatPhone, text: requiredText(1000) });
export type ChatReplyInput = z.input<typeof ChatReplyInput>;

/**
 * The office answers in the conversation, whoever the person is: a family through the inbox's reply (the bot learns
 * from it), a new customer through the lead's reply (the lead moves to "talking"), anyone else as free text. The
 * person's waiting messages leave the inbox.
 */
export async function replyToChat(tx: Tx, ctx: ServiceContext, raw: ChatReplyInput) {
  const input = ChatReplyInput.parse(raw);
  const [last] = await rows<{
    id: string;
    householdId: string | null;
    guardianId: string | null;
    leadId: string | null;
  }>(
    tx,
    sql`select id, household_id "householdId", guardian_id "guardianId", lead_id "leadId"
        from inbound_messages where from_phone_e164 = ${input.phone} order by received_at desc limit 1`,
  );
  if (!last) throw new DomainError('common.errors.notFound');
  const message =
    last.householdId && last.guardianId
      ? await replyToInbound(tx, ctx, { inboundMessageId: last.id, text: input.text })
      : last.leadId
        ? await replyToLead(tx, ctx, { leadId: last.leadId, text: input.text })
        : await enqueueMessage(tx, ctx, {
            guardian: {
              id: null,
              householdId: null,
              firstName: '',
              phoneE164: input.phone,
              whatsappOptIn: true,
              locale: 'he',
            },
            templateKey: 'free_text',
            vars: { text: input.text },
            idempotencyKey: `chat-reply:${last.id}:${randomUUID()}`,
            inboundMessageId: last.id,
          });
  await tx
    .update(inboundMessages)
    .set({ status: 'actioned', handledBy: ctx.userId, handledAt: new Date() })
    .where(
      and(
        eq(inboundMessages.fromPhoneE164, input.phone),
        inArray(inboundMessages.status, ['new', 'needs_human']),
      ),
    );
  return message;
}

export interface BotPerformance extends BotScore {
  answered: number;
  handedOff: number;
  /** Answers the office marked wrong. */
  bad: number;
  /** Conversations a person holds right now. */
  held: number;
  /** Conversations with a message waiting in the inbox. */
  waiting: number;
  /** Why the bot passed messages on, the most common first. */
  reasons: { reason: string; n: number }[];
}

/** The bot's last 30 days, for the head of the conversations screen. */
export async function botPerformance(tx: Tx): Promise<BotPerformance> {
  const [s] = await rows<{
    answered: number;
    handedOff: number;
    bad: number;
    held: number;
    waiting: number;
  }>(
    tx,
    sql`select count(*) filter (where outcome = 'answered')::int answered,
               count(*) filter (where outcome = 'handed_off')::int "handedOff",
               count(*) filter (where review = 'bad')::int bad,
               (select count(*) from chat_holds)::int held,
               (select count(distinct from_phone_e164) from inbound_messages
                 where from_phone_e164 is not null and status in ('new', 'needs_human'))::int waiting
        from bot_replies where created_at > now() - interval '30 days'`,
  );
  const reasons = await rows<{ reason: string; n: number }>(
    tx,
    sql`select handoff_reason reason, count(*)::int n from bot_replies
        where outcome = 'handed_off' and created_at > now() - interval '30 days'
        group by 1 order by 2 desc, 1`,
  );
  const stats = s as NonNullable<typeof s>;
  return { ...stats, ...botScore(stats), reasons };
}
