/**
 * The inbox (brief §6.12): a family's WhatsApp message, matched to the guardian, classified, and turned into a draft
 * action the office approves with one tap. Complaints and cancellations go to a person; nothing here ever answers a
 * family by itself. Runs inside the tenant (the webhook's intake as the tenant's worker, the inbox as the office).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Classification, requiredText, type TriageActionKind } from '@rswim/contracts';
import { and, desc, eq, inArray, schema, type Tx } from '@rswim/db';
import { reportAbsence } from '@rswim/domain-attendance';
import { DomainError, emit, isDomainError, type ServiceContext } from '@rswim/domain-core';
import { getHousehold, guardiansOfHouseholds, senderOf, studentsByIds } from '@rswim/domain-people';
import { lessonsOfStudents } from '@rswim/domain-scheduling';
import { todayInIsrael } from '@rswim/calendar';
import {
  classifyInbound,
  israelLocalDateTime,
  triageDecision,
  type CommsRules,
  type Explanation,
} from '../policies';
import { commsRules, enqueueMessage } from './outbound';

const { botKnowledge, botReplies, inboundMessages, triageActions } = schema;

export interface InboundInput {
  provider: string;
  externalId: string;
  phoneE164: string | null;
  ghlContactId: string | null;
  body: string;
  receivedAt: Date;
}

export type IntakeResult =
  | { outcome: 'duplicate' }
  | {
      outcome: 'stored';
      inboundMessageId: string;
      status: string;
      actionId: string | null;
      classification: Classification;
    };

type InboundRow = typeof inboundMessages.$inferSelect;

/**
 * Stores, matches and classifies one inbound message and drafts its action, all in one transaction, so the office
 * sees "Daniel won't come today" as a ready absence notice the moment the webhook answers.
 */
export async function intakeInbound(
  tx: Tx,
  ctx: ServiceContext,
  input: InboundInput,
): Promise<IntakeResult> {
  const sender = await senderOf(tx, {
    phoneE164: input.phoneE164,
    ghlContactId: input.ghlContactId,
  });
  const guardian = sender?.kind === 'guardian' ? sender : null;
  const classification = classifyInbound(input.body, {
    students: guardian?.students ?? [],
    today: todayInIsrael(input.receivedAt),
    known: guardian !== null,
    isStaff: sender?.kind === 'staff',
  });
  const [row] = await tx
    .insert(inboundMessages)
    .values({
      organizationId: ctx.orgId,
      provider: input.provider,
      externalId: input.externalId,
      fromPhoneE164: input.phoneE164,
      guardianId: guardian?.guardianId ?? null,
      householdId: guardian?.householdId ?? null,
      staffMemberId: sender?.kind === 'staff' ? sender.staffMemberId : null,
      body: input.body,
      receivedAt: input.receivedAt,
      intent: classification.intent,
      confidence: classification.confidence,
      classification,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { outcome: 'duplicate' };
  const triaged = await triage(tx, ctx, row, classification, await commsRules(tx));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'comms.inbound_received',
    payload: { inboundMessageId: row.id },
    idempotencyKey: `comms.inbound_received:${row.id}`,
  });
  return { outcome: 'stored', inboundMessageId: row.id, classification, ...triaged };
}

/** Decides the route and drafts the action. A draft absence names the lesson; with no lesson, a person decides. */
async function triage(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  c: Classification,
  rules: CommsRules,
): Promise<{ status: string; actionId: string | null }> {
  const decision = triageDecision(c, rules);
  let status = decision.route === 'human' ? 'needs_human' : 'new';
  let actionId: string | null = null;
  if (decision.route === 'action') {
    const draft = await draftFor(tx, decision.kind, c, row);
    if (draft) {
      const [a] = await tx
        .insert(triageActions)
        .values({
          organizationId: ctx.orgId,
          inboundMessageId: row.id,
          kind: decision.kind,
          payload: draft,
          explanation: decision.explanation,
        })
        .returning({ id: triageActions.id });
      actionId = a?.id ?? null;
    } else status = 'needs_human';
  }
  await tx.update(inboundMessages).set({ status }).where(eq(inboundMessages.id, row.id));
  return { status, actionId };
}

async function draftFor(
  tx: Tx,
  kind: TriageActionKind,
  c: Classification,
  row: InboundRow,
): Promise<Record<string, unknown> | null> {
  if (kind === 'absence_notice') {
    const lessons = await lessonsOfStudents(tx, c.studentIds, {
      date: c.date,
      from: todayInIsrael(row.receivedAt),
    });
    return lessons.length > 0 ? { studentIds: c.studentIds, date: c.date, lessons } : null;
  }
  return { studentIds: c.studentIds, date: c.date, householdId: row.householdId };
}

/**
 * The AI classifier's second opinion (`comms.ai_triage`). It replaces the rules' verdict only when more confident and
 * only while nobody has acted on the message.
 */
export async function applyAiClassification(
  tx: Tx,
  ctx: ServiceContext,
  inboundMessageId: string,
  raw: Classification,
): Promise<'applied' | 'kept' | 'closed'> {
  const c = Classification.parse(raw);
  const [row] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, inboundMessageId));
  if (!row || !['new', 'needs_human'].includes(row.status)) return 'closed';
  const decided = await tx
    .select({ id: triageActions.id })
    .from(triageActions)
    .where(and(eq(triageActions.inboundMessageId, row.id), eq(triageActions.status, 'approved')));
  if (decided.length > 0) return 'closed';
  if (c.confidence <= row.confidence) return 'kept';
  // Only the household's own children may be named.
  const own = row.householdId ? await studentsByIds(tx, c.studentIds) : [];
  const students = own.filter((s) => s.householdId === row.householdId).map((s) => s.id);
  const next = { ...c, studentIds: students };
  await tx
    .update(triageActions)
    .set({ status: 'dismissed', decidedAt: new Date() })
    .where(and(eq(triageActions.inboundMessageId, row.id), eq(triageActions.status, 'pending')));
  await tx
    .update(inboundMessages)
    .set({ intent: next.intent, confidence: next.confidence, classification: next })
    .where(eq(inboundMessages.id, row.id));
  await triage(tx, ctx, { ...row, classification: next }, next, await commsRules(tx));
  return 'applied';
}

/** What the AI classifier is told about a message: its text, the family's children and the day. */
export async function inboundContext(tx: Tx, inboundMessageId: string) {
  const [row] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, inboundMessageId));
  if (!row) return null;
  const household = row.householdId ? await getHousehold(tx, row.householdId) : null;
  return {
    text: row.body,
    today: todayInIsrael(row.receivedAt),
    known: row.householdId !== null,
    isStaff: row.staffMemberId !== null,
    students: (household?.students ?? []).map((s) => ({ id: s.id, firstName: s.firstName })),
  };
}

// ─── The office's side ──────────────────────────────────────────────────────

/** Inbound messages for the inbox, newest first, with their pending action and who wrote. */
export async function listInbox(tx: Tx, q: { status?: 'open' | 'closed'; limit?: number } = {}) {
  const open = ['new', 'needs_human'];
  const rows = await tx
    .select()
    .from(inboundMessages)
    .where(
      q.status === 'closed'
        ? inArray(inboundMessages.status, ['actioned', 'dismissed'])
        : q.status === 'open'
          ? inArray(inboundMessages.status, open)
          : undefined,
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(q.limit ?? 100);
  const ids = rows.map((r) => r.id);
  const actions = ids.length
    ? await tx.select().from(triageActions).where(inArray(triageActions.inboundMessageId, ids))
    : [];
  const guardians = await guardiansOfHouseholds(tx, [
    ...new Set(rows.map((r) => r.householdId).filter((h): h is string => h !== null)),
  ]);
  const studentIds = [
    ...new Set(rows.flatMap((r) => (r.classification as Classification).studentIds ?? [])),
  ];
  const students = new Map((await studentsByIds(tx, studentIds)).map((s) => [s.id, s]));
  const bot = ids.length
    ? await tx.select().from(botReplies).where(inArray(botReplies.inboundMessageId, ids))
    : [];
  return rows.map((r) => {
    const c = r.classification as Classification;
    return {
      ...r,
      classification: c,
      guardian: guardians.find((g) => g.id === r.guardianId) ?? null,
      students: c.studentIds.map((id) => students.get(id)).filter((s) => s !== undefined),
      action:
        actions.find((a) => a.inboundMessageId === r.id && a.status === 'pending') ??
        actions.find((a) => a.inboundMessageId === r.id && a.status === 'approved') ??
        null,
      bot: bot.find((b) => b.inboundMessageId === r.id) ?? null,
    };
  });
}

export async function openInboxCount(tx: Tx): Promise<number> {
  const rows = await tx
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(inArray(inboundMessages.status, ['new', 'needs_human']));
  return rows.length;
}

const AbsenceDraft = z.object({
  lessons: z.array(z.object({ sessionId: z.uuid(), studentId: z.uuid() })).min(1),
});

/**
 * One tap: the office approves a draft. An absence is recorded through the attendance service as a WhatsApp notice,
 * received when the family wrote, and decided by the regulations at once. Other drafts mark the request handled.
 */
export async function approveTriageAction(tx: Tx, ctx: ServiceContext, actionId: string) {
  const [a] = await tx.select().from(triageActions).where(eq(triageActions.id, actionId));
  if (!a) throw new DomainError('common.errors.notFound');
  if (a.status !== 'pending') throw new DomainError('comms.errors.actionClosed');
  const [inbound] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, a.inboundMessageId));
  if (!inbound) throw new DomainError('common.errors.notFound');
  let result: Record<string, unknown> = {};
  if (a.kind === 'absence_notice') {
    const draft = AbsenceDraft.parse(a.payload);
    const outcomes: { studentId: string; noticeId: string | null; notice: Explanation | null }[] =
      [];
    for (const l of draft.lessons) {
      try {
        const o = await reportAbsence(tx, ctx, {
          sessionId: l.sessionId,
          studentId: l.studentId,
          channel: 'whatsapp',
          receivedAt: israelLocalDateTime(inbound.receivedAt),
          note: inbound.body.slice(0, 500),
        });
        outcomes.push({ studentId: l.studentId, noticeId: o.noticeId, notice: o.notice });
      } catch (e) {
        if (!isDomainError(e) || e.code !== 'attendance.errors.alreadyReported') throw e;
        outcomes.push({ studentId: l.studentId, noticeId: null, notice: null });
      }
    }
    result = { absences: outcomes };
  }
  await tx
    .update(triageActions)
    .set({ status: 'approved', decidedBy: ctx.userId, decidedAt: new Date(), result })
    .where(eq(triageActions.id, a.id));
  await closeInbound(tx, ctx, inbound.id, 'actioned');
  return result;
}

async function closeInbound(
  tx: Tx,
  ctx: ServiceContext,
  id: string,
  status: 'actioned' | 'dismissed',
) {
  await tx
    .update(inboundMessages)
    .set({ status, handledBy: ctx.userId, handledAt: new Date() })
    .where(eq(inboundMessages.id, id));
}

/** Done with a message without its draft (handled elsewhere, or nothing to do). */
export async function resolveInbound(
  tx: Tx,
  ctx: ServiceContext,
  inboundMessageId: string,
  status: 'actioned' | 'dismissed',
) {
  await tx
    .update(triageActions)
    .set({ status: 'dismissed', decidedBy: ctx.userId, decidedAt: new Date() })
    .where(
      and(
        eq(triageActions.inboundMessageId, inboundMessageId),
        eq(triageActions.status, 'pending'),
      ),
    );
  await closeInbound(tx, ctx, inboundMessageId, status);
}

export const ReplyInput = z.object({ inboundMessageId: z.uuid(), text: requiredText(1000) });
export type ReplyInput = z.input<typeof ReplyInput>;

/**
 * The office answers a family in the conversation (free text, inside WhatsApp's 24-hour window). When the bot had
 * handed this message to the office, the question and the answer become a suggestion for the bot's knowledge, which
 * the office approves (and may edit) before the bot uses it.
 */
export async function replyToInbound(tx: Tx, ctx: ServiceContext, raw: ReplyInput) {
  const input = ReplyInput.parse(raw);
  const [row] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, input.inboundMessageId));
  if (!row) throw new DomainError('common.errors.notFound');
  const guardian = row.householdId
    ? (await guardiansOfHouseholds(tx, [row.householdId])).find((g) => g.id === row.guardianId)
    : undefined;
  if (!guardian) throw new DomainError('comms.errors.unknownSender');
  // A family that wrote to us has opted into this conversation.
  const message = await enqueueMessage(tx, ctx, {
    guardian: { ...guardian, whatsappOptIn: true },
    templateKey: 'free_text',
    vars: { text: input.text },
    idempotencyKey: `reply:${row.id}:${randomUUID()}`,
    inboundMessageId: row.id,
  });
  if (row.status === 'new' || row.status === 'needs_human')
    await closeInbound(tx, ctx, row.id, 'actioned');
  const [handedOff] = await tx
    .select({ id: botReplies.id })
    .from(botReplies)
    .where(and(eq(botReplies.inboundMessageId, row.id), eq(botReplies.outcome, 'handed_off')));
  if (handedOff) {
    await tx
      .insert(botKnowledge)
      .values({
        organizationId: ctx.orgId,
        question: row.body.slice(0, 500),
        answer: input.text,
        status: 'suggested',
        source: 'learned',
        sourceInboundMessageId: row.id,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing();
  }
  return message;
}

/** Messages and replies of one household, both directions, for the family card. */
export async function conversationOf(tx: Tx, householdId: string, limit = 50) {
  return tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.householdId, householdId))
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(limit);
}
