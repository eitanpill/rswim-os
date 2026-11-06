/**
 * The business brain on WhatsApp, beyond the families (docs/AI-BRAIN.md, stage 3). Two kinds of message reach it:
 *
 * - The owner answers a waiting action from the number set for approvals: "כן 12" runs action 12 as the owner, "לא 12"
 *   drops it, and the owner gets one line back saying what happened.
 * - An instructor writes that they cannot teach on a day ("אני חולה היום"): each lesson they lead that day and that has
 *   not started becomes a substitute search through the brain's gate (runs alone, or waits for the owner, who is then
 *   asked on WhatsApp), and the instructor gets one line back.
 *
 * - The owner writes "תזכור ש..." from that number: the brain keeps it as a note (stage 5) and says so.
 *
 * Everything else stays in the inbox. The rules decide; no model reads these messages.
 */
import { and, desc, eq, schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { getAgentSettings } from './agent';
import {
  decisionText,
  ownerReply,
  staffAbsence,
  staffReplyText,
  summaryText,
  type DecisionOutcome,
  type OwnerReply,
} from './agent-policies';
import { remember } from './memory';
import { rememberRequest, rememberedText } from './memory-policies';
import type { Explanation } from './policies';
import {
  confirmCopilotAction,
  dismissCopilotAction,
  substituteSummary,
  takeAction,
} from './services';

const { copilotActions, inboundMessages } = schema;

export type BrainInboundResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'remembered'; memoryId: string }
  | { outcome: 'owner_decided'; decision: DecisionOutcome; actionId: string | null }
  | {
      outcome: 'staff_request';
      date: string;
      actions: { id: string; status: 'done' | 'waiting' | 'failed' }[];
    };

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/** Whether a message is the owner answering a waiting action or asking to remember (the parents' bot leaves those alone). */
export async function isOwnerReply(
  tx: Tx,
  m: { fromPhoneE164: string | null; body: string },
): Promise<boolean> {
  if (!m.fromPhoneE164 || (!ownerReply(m.body) && !rememberRequest(m.body))) return false;
  return (await getAgentSettings(tx)).approvalPhoneE164 === m.fromPhoneE164;
}

/** Reads one inbound message for the brain: an owner's decision, an instructor's request, or nothing. */
export async function runBrainInbound(
  tx: Tx,
  ctx: ServiceContext,
  inboundMessageId: string,
): Promise<BrainInboundResult> {
  const [row] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, inboundMessageId));
  if (!row) return { outcome: 'skipped', reason: 'not_found' };
  if (row.status !== 'new' && row.status !== 'needs_human')
    return { outcome: 'skipped', reason: 'handled' };
  const settings = await getAgentSettings(tx);
  const fromOwner =
    !!settings.approvalPhoneE164 && row.fromPhoneE164 === settings.approvalPhoneE164;
  const reply = ownerReply(row.body);
  if (reply && fromOwner) return decideFromWhatsApp(tx, ctx, row, reply);
  const note = fromOwner ? rememberRequest(row.body) : null;
  if (note) return rememberFromWhatsApp(tx, ctx, row, note.body);
  if (row.staffMemberId) {
    const ask = staffAbsence(row.body, await todayIL(tx));
    if (ask) {
      if (settings.effective.substitute === 'off') return { outcome: 'skipped', reason: 'off' };
      return staffRequest(tx, ctx, row, ask.date);
    }
  }
  return { outcome: 'skipped', reason: 'not_for_brain' };
}

type InboundRow = typeof inboundMessages.$inferSelect;

async function replyTo(tx: Tx, ctx: ServiceContext, row: InboundRow, text: string) {
  await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: row.fromPhoneE164,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: { text },
    idempotencyKey: `agent.reply:${row.id}`,
    inboundMessageId: row.id,
  });
}

async function markHandled(tx: Tx, row: InboundRow, status: 'actioned' | 'needs_human') {
  await tx
    .update(inboundMessages)
    .set({ status, handledAt: status === 'actioned' ? new Date() : null })
    .where(eq(inboundMessages.id, row.id));
}

/** The first active owner of the school: WhatsApp from the approvals number acts as them. */
async function schoolOwner(tx: Tx): Promise<string | null> {
  const [owner] = await rows<{ userId: string }>(
    tx,
    sql`select user_id "userId" from memberships where role = 'owner' and status = 'active'
        order by created_at limit 1`,
  );
  return owner?.userId ?? null;
}

/** "תזכור ש..." from the approvals number: a note in the owner's words, and one line back. */
async function rememberFromWhatsApp(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  body: string,
): Promise<BrainInboundResult> {
  const userId = await schoolOwner(tx);
  if (!userId) return { outcome: 'skipped', reason: 'no_owner' };
  const saved = await remember(tx, { orgId: ctx.orgId, userId }, { body }, 'owner_whatsapp');
  await replyTo(tx, ctx, row, rememberedText(body, 'he'));
  await markHandled(tx, row, 'actioned');
  return { outcome: 'remembered', memoryId: saved.id };
}

/** "כן 12" / "לא 12": the newest action with that number, decided as the school's owner. */
async function decideFromWhatsApp(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  reply: OwnerReply,
): Promise<BrainInboundResult> {
  const ownerId = await schoolOwner(tx);
  if (!ownerId) return { outcome: 'skipped', reason: 'no_owner' };
  const owner = { userId: ownerId };
  const [action] = await tx
    .select({
      id: copilotActions.id,
      status: copilotActions.status,
      summary: copilotActions.summary,
    })
    .from(copilotActions)
    .where(and(eq(copilotActions.ref, reply.ref)))
    .orderBy(desc(copilotActions.createdAt))
    .limit(1);
  let decision: DecisionOutcome;
  if (!action) decision = 'not_found';
  else if (action.status !== 'proposed') decision = 'already_decided';
  else if (reply.verb === 'dismiss') {
    await dismissCopilotAction(
      tx,
      { orgId: ctx.orgId, userId: owner.userId },
      action.id,
      reply.reason ?? null,
    );
    decision = 'dismissed';
  } else {
    const out = await confirmCopilotAction(
      tx,
      { orgId: ctx.orgId, userId: owner.userId },
      action.id,
    );
    decision = out.status;
  }
  await replyTo(
    tx,
    ctx,
    row,
    decisionText(
      {
        outcome: decision,
        ref: reply.ref,
        summary: action ? summaryText(action.summary as Explanation, 'he') : null,
      },
      'he',
    ),
  );
  await markHandled(tx, row, 'actioned');
  return { outcome: 'owner_decided', decision, actionId: action?.id ?? null };
}

/** An instructor cannot teach on a date: a substitute search for each lesson they lead that has not started. */
async function staffRequest(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  date: string,
): Promise<BrainInboundResult> {
  const lessons = await rows<{ id: string }>(
    tx,
    sql`select s.id from sessions s join class_templates t on t.id = s.class_template_id
        where s.date = ${date}::date and s.status = 'scheduled' and s.starts_at > now()
          and coalesce((select ss.staff_member_id from session_staff ss
                        where ss.session_id = s.id and ss.role = 'lead'), t.lead_staff_id) = ${row.staffMemberId}
        order by s.starts_at`,
  );
  const actions: { id: string; status: 'done' | 'waiting' | 'failed' }[] = [];
  for (const l of lessons) {
    const taken = await takeAction(tx, ctx, {
      source: 'staff',
      requestId: null,
      inboundMessageId: row.id,
      kind: 'substitute',
      params: { sessionId: l.id, reason: row.body.trim().slice(0, 300) },
      summary: await substituteSummary(tx, l.id),
      amountAgorot: null,
    });
    actions.push({ id: taken.id, status: taken.status });
  }
  await replyTo(
    tx,
    ctx,
    row,
    staffReplyText(
      {
        date,
        lessons: lessons.length,
        waiting: actions.filter((a) => a.status === 'waiting').length,
      },
      'he',
    ),
  );
  // With no lesson to cover, a person reads the message.
  await markHandled(tx, row, actions.length > 0 ? 'actioned' : 'needs_human');
  return { outcome: 'staff_request', date, actions };
}
