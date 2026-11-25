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
 * - An instructor asks for their day or for attendance (WhatsApp track W7): the lessons they lead that day, one line
 *   each, and the link to their screen. A club's instructor gets their sessions the same way.
 * - The owner writes anything else from the approvals number (W7): the assistant answers it like the chat in the app,
 *   as the owner. An action it proposes runs or waits by the brain's levels, and one that waits comes back with its
 *   "כן N". This is the only part a model reads, and only when the worker has one.
 *
 * Everything else stays in the inbox. The rules decide the rest; no model reads those messages.
 */
import { and, asc, desc, eq, schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import { instructorDay } from '@rswim/domain-dive';
import { aiAllowed, hasFeature } from '@rswim/domain-platform';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import type { CopilotModel } from '@rswim/integrations';
import { getAgentSettings } from './agent';
import {
  decisionText,
  ownerAnswerText,
  ownerReply,
  staffAbsence,
  staffAttendanceAsk,
  staffAttendanceText,
  staffDayAsk,
  staffDayText,
  staffReplyText,
  summaryText,
  type DecisionOutcome,
  type OwnerReply,
  type StaffLesson,
} from './agent-policies';
import { remember } from './memory';
import { rememberRequest, rememberedText } from './memory-policies';
import type { Explanation } from './policies';
import {
  askCopilot,
  confirmCopilotAction,
  copilotAvailable,
  dismissCopilotAction,
  substituteSummary,
  takeAction,
} from './services';

const { copilotActions, copilotRequests, inboundMessages } = schema;

export interface BrainInboundOptions {
  /** The assistant's model, for the owner's free questions; without one they stay in the inbox. */
  model?: CopilotModel | null;
  /** The site's address, for the instructor's links. */
  publicUrl?: string;
}

export type BrainInboundResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'remembered'; memoryId: string }
  | { outcome: 'owner_decided'; decision: DecisionOutcome; actionId: string | null }
  | { outcome: 'owner_asked'; requestId: string; waiting: number }
  | { outcome: 'staff_day'; date: string; lessons: number }
  | { outcome: 'staff_attendance'; lesson: boolean }
  | {
      outcome: 'staff_request';
      date: string;
      actions: { id: string; status: 'done' | 'waiting' | 'failed' }[];
    };

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/**
 * Whether a message from the approvals number is the brain's (the parents' bot leaves those alone): an answer to a
 * waiting action, "תזכור ש...", or anything at all once the owner's assistant is on (it answers her there).
 */
export async function isOwnerReply(
  tx: Tx,
  m: { fromPhoneE164: string | null; body: string },
): Promise<boolean> {
  if (!m.fromPhoneE164) return false;
  if ((await getAgentSettings(tx)).approvalPhoneE164 !== m.fromPhoneE164) return false;
  if (ownerReply(m.body) || rememberRequest(m.body)) return true;
  const today = await todayIL(tx);
  return (await resolvePolicyFor(tx, { date: today })).rules.copilot?.enabled === true;
}

/** Reads one inbound message for the brain: an owner's decision, an instructor's request, or nothing. */
export async function runBrainInbound(
  tx: Tx,
  ctx: ServiceContext,
  inboundMessageId: string,
  opts: BrainInboundOptions = {},
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
    const today = await todayIL(tx);
    const ask = staffAbsence(row.body, today);
    if (ask) {
      if (settings.effective.substitute === 'off') return { outcome: 'skipped', reason: 'off' };
      return staffRequest(tx, ctx, row, ask.date);
    }
    const base = (opts.publicUrl ?? '').replace(/\/$/, '');
    if (staffAttendanceAsk(row.body)) return staffAttendance(tx, ctx, row, today, base);
    const day = staffDayAsk(row.body, today);
    if (day) return staffDay(tx, ctx, row, day.date, today, base);
  }
  // An owner who also teaches gets the instructor's answers above; anything else of hers is for her assistant.
  if (fromOwner) return ownerQuestion(tx, ctx, row, opts.model ?? null);
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

/** The owner's free message from the approvals number: the assistant answers it as her, like the chat in the app. */
async function ownerQuestion(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  model: CopilotModel | null,
): Promise<BrainInboundResult> {
  const text = row.body.trim();
  if (!text || text.length > 2000) return { outcome: 'skipped', reason: 'not_for_brain' };
  // With the assistant off, or no model in the worker, her message stays in the inbox.
  if (!(await copilotAvailable(tx, model)).ok)
    return { outcome: 'skipped', reason: 'not_for_brain' };
  // The assistant belongs to plans that include it, on WhatsApp as on its screen.
  if (!(await hasFeature(tx, 'copilot'))) return { outcome: 'skipped', reason: 'not_for_brain' };
  if (!(await aiAllowed(tx))) return { outcome: 'skipped', reason: 'ai_cap' };
  const userId = await schoolOwner(tx);
  if (!userId) return { outcome: 'skipped', reason: 'no_owner' };
  const requestId = await askCopilot(tx, { orgId: ctx.orgId, userId }, model, text);
  const [req] = await tx
    .select({ answer: copilotRequests.answer })
    .from(copilotRequests)
    .where(eq(copilotRequests.id, requestId));
  const acts = await tx
    .select({
      ref: copilotActions.ref,
      status: copilotActions.status,
      summary: copilotActions.summary,
    })
    .from(copilotActions)
    .where(eq(copilotActions.requestId, requestId))
    .orderBy(asc(copilotActions.ref));
  const line = (a: (typeof acts)[number]) => summaryText(a.summary as Explanation, 'he');
  const waiting = acts.flatMap((a) =>
    a.status === 'proposed' && a.ref !== null ? [{ ref: a.ref, summary: line(a) }] : [],
  );
  await replyTo(
    tx,
    ctx,
    row,
    ownerAnswerText(
      {
        answer: req?.answer?.trim() || null,
        waiting,
        done: acts.filter((a) => a.status === 'confirmed').map(line),
      },
      'he',
    ),
  );
  await markHandled(tx, row, 'actioned');
  return { outcome: 'owner_asked', requestId, waiting: waiting.length };
}

/** The lessons a staff member leads on a date: a swim school's sessions, and a club's sessions (today and tomorrow). */
async function staffLessons(tx: Tx, staffId: string, date: string): Promise<StaffLesson[]> {
  const swim = await rows<StaffLesson & { at: string }>(
    tx,
    sql`select to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "time", t.name title, v.name place,
               (select count(*)::int from enrollments e
                where e.class_template_id = t.id and e.status = 'active' and e.starts_on <= s.date
                  and (e.ends_on is null or e.ends_on > s.date)) people,
               s.starts_at::text at
        from sessions s join class_templates t on t.id = s.class_template_id join venues v on v.id = s.venue_id
        where s.date = ${date}::date and s.status = 'scheduled'
          and coalesce((select ss.staff_member_id from session_staff ss
                        where ss.session_id = s.id and ss.role = 'lead'), t.lead_staff_id) = ${staffId}
        order by s.starts_at`,
  );
  if (swim.length > 0)
    return swim.map(({ time, title, place, people }) => ({ time, title, place, people }));
  const il = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', ...o }).format(new Date(iso));
  const dive = (await instructorDay(tx, staffId)).sessions;
  return dive
    .filter((d) => il(d.startsAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) === date)
    .map((d) => ({
      time: il(d.startsAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
      title: d.title,
      place: d.siteName,
      people: d.booked,
    }));
}

/** Whether the business is a freediving club (its staff's screens live under /dive). */
async function staffScreen(tx: Tx, base: string): Promise<string> {
  if (!base) return '';
  const [org] = await rows<{ vertical: string }>(
    tx,
    sql`select vertical from organizations limit 1`,
  );
  return org?.vertical === 'freediving' ? `${base}/dive/instructor` : `${base}/instructor`;
}

/** "מה יש לי היום": the instructor's lessons that day and the link to their screen. */
async function staffDay(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  date: string,
  today: string,
  base: string,
): Promise<BrainInboundResult> {
  const lessons = await staffLessons(tx, row.staffMemberId as string, date);
  await replyTo(
    tx,
    ctx,
    row,
    staffDayText({ date, today, lessons, url: await staffScreen(tx, base) }, 'he'),
  );
  await markHandled(tx, row, 'actioned');
  return { outcome: 'staff_day', date, lessons: lessons.length };
}

/** "נוכחות": the link to the instructor's screen, naming the next lesson of today that has not ended long ago. */
async function staffAttendance(
  tx: Tx,
  ctx: ServiceContext,
  row: InboundRow,
  today: string,
  base: string,
): Promise<BrainInboundResult> {
  const url = await staffScreen(tx, base);
  // Without the site's address there is no link to give: a person reads the message.
  if (!url) return { outcome: 'skipped', reason: 'no_url' };
  const lessons = await staffLessons(tx, row.staffMemberId as string, today);
  const [{ now } = { now: '00:00' }] = await rows<{ now: string }>(
    tx,
    sql`select to_char(now() at time zone 'Asia/Jerusalem' - interval '90 minutes', 'HH24:MI') now`,
  );
  const next = lessons.find((l) => l.time >= now) ?? null;
  await replyTo(tx, ctx, row, staffAttendanceText({ next, url }, 'he'));
  await markHandled(tx, row, 'actioned');
  return { outcome: 'staff_attendance', lesson: next !== null };
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
