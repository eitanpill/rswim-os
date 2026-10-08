/**
 * The parents' WhatsApp bot. A family's message arrives in the inbox as before; when the bot is on, the worker hands it
 * to a model with read tools that see only that family's lessons, balance and makeups, plus the school's rules and
 * knowledge. The bot either answers (queued like any reply, inside the send window) or hands the message to the office
 * with a short summary and tells the family someone will get back to them. It never changes data: anything that needs
 * doing waits for the office. The office's answers to handed-off questions become knowledge suggestions it approves.
 */
import { z } from 'zod';
import {
  checkbox,
  requiredText,
  type BotHandoffReason,
  type BotKnowledgeStatus,
  type BotReview,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { ledgerOfHousehold } from '@rswim/domain-billing';
import { commsRules, enqueueMessage, schoolName } from '@rswim/domain-comms';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { guardiansOfHouseholds } from '@rswim/domain-people';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  traced,
  type CopilotModel,
  type CopilotRunInput,
  type CopilotTool,
  type CopilotTraceStep,
} from '@rswim/integrations';
import {
  BotAnswer,
  BotHandoff,
  botRoute,
  botSystem,
  fakeBotIntent,
  handoffNoteDue,
  matchKnowledge,
  policyFacts,
} from './bot-policies';

const { botKnowledge, botReplies, inboundMessages, triageActions } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

const obj = (
  properties: Record<string, unknown>,
  required: string[],
): CopilotTool['input_schema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** How many knowledge entries go into the bot's instructions; the rest are found with search_knowledge. */
const KNOWLEDGE_IN_PROMPT = 60;

export const BOT_TOOLS: CopilotTool[] = [
  {
    name: 'family_lessons',
    description:
      "The family's lessons in the next 14 days, per child: date, weekday (0=Sunday), Israel time, group, pool, and status (scheduled or cancelled, with the reason).",
    input_schema: obj({}, []),
  },
  {
    name: 'family_balance',
    description:
      "The family's balance in agorot (positive: they owe; negative: in credit) and the unpaid charges, oldest first.",
    input_schema: obj({}, []),
  },
  {
    name: 'family_makeups',
    description:
      "The children's makeup credits that are open or booked, with their expiry and the booked lesson.",
    input_schema: obj({}, []),
  },
  {
    name: 'closures_ahead',
    description: 'Pool closures from today on, with dates and reason.',
    input_schema: obj({}, []),
  },
  {
    name: 'search_knowledge',
    description: "Search the school's answers to common questions.",
    input_schema: obj({ query: { type: 'string', description: 'Words from the question' } }, [
      'query',
    ]),
  },
  {
    name: 'reply_to_parent',
    description:
      'Send the answer to the parent. Ends the conversation turn. List the knowledge ids the answer used.',
    input_schema: obj(
      {
        text: { type: 'string', description: 'The answer, in the parent’s language' },
        knowledgeIds: { type: 'array', items: { type: 'string' } },
      },
      ['text', 'knowledgeIds'],
    ),
  },
  {
    name: 'hand_off_to_office',
    description:
      'Pass the message to the office when you cannot answer from the tools and knowledge, the parent wants something done, or the topic is sensitive. The parent is told someone will get back to them.',
    input_schema: obj(
      {
        summary: { type: 'string', description: 'For the office, in Hebrew, one or two lines' },
        reason: { type: 'string', enum: ['unknown', 'needs_action', 'sensitive'] },
      },
      ['summary', 'reason'],
    ),
  },
];

type Decision =
  | { kind: 'answer'; text: string; knowledgeIds: string[] }
  | { kind: 'handoff'; summary: string; reason: BotHandoffReason };

interface Knowledge {
  id: string;
  question: string;
  answer: string;
}

/** The tools bound to one family: every read is filtered by the household; the decision is collected, not applied. */
export function botToolbox(tx: Tx, householdId: string, today: string, knowledge: Knowledge[]) {
  let decision: Decision | null = null;
  const call = async (tool: string, input: unknown): Promise<unknown> => {
    switch (tool) {
      case 'family_lessons':
        return rows(
          tx,
          sql`select st.first_name child, s.date::text date, extract(dow from s.date)::int weekday,
                     to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "startsAt",
                     to_char(s.ends_at at time zone 'Asia/Jerusalem', 'HH24:MI') "endsAt",
                     t.name "group", v.name pool, s.status, s.cancel_reason "cancelReason",
                     e.status place
              from students st
              join enrollments e on e.student_id = st.id
                and e.status in ('trial_booked', 'active', 'frozen', 'cancel_requested')
              join sessions s on s.class_template_id = e.class_template_id
                and s.date between ${today}::date and ${today}::date + 14
                and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)
              join class_templates t on t.id = s.class_template_id
              join venues v on v.id = s.venue_id
              where st.household_id = ${householdId}
              order by s.starts_at, st.first_name limit 40`,
        );
      case 'family_balance': {
        const l = await ledgerOfHousehold(tx, householdId);
        return {
          balanceAgorot: l.balance,
          unpaid: l.outstanding.slice(0, 10).map((o) => ({ date: o.occurredOn, agorot: o.amount })),
        };
      }
      case 'family_makeups':
        return rows(
          tx,
          sql`select st.first_name child, c.status, c.reason, c.expires_on::text "expiresOn",
                     (select s.date::text || ' ' || to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
                        || ' ' || t.name
                      from makeup_bookings b join sessions s on s.id = b.session_id
                      join class_templates t on t.id = s.class_template_id
                      where b.credit_id = c.id and b.status <> 'cancelled' limit 1) booked
              from makeup_credits c join students st on st.id = c.student_id
              where st.household_id = ${householdId} and c.status in ('open', 'booked')
                and c.expires_on >= ${today}::date
              order by c.expires_on limit 20`,
        );
      case 'closures_ahead':
        return rows(
          tx,
          sql`select v.name pool, c.starts_on::text "from", c.ends_on::text "to", c.reason
              from venue_closures c join venues v on v.id = c.venue_id
              where c.ends_on >= ${today}::date order by c.starts_on limit 10`,
        );
      case 'search_knowledge': {
        const q = String((input as { query?: unknown } | null)?.query ?? '');
        return matchKnowledge(q, knowledge, 0.34).slice(0, 5);
      }
      case 'reply_to_parent': {
        if (decision) throw new DomainError('bot.errors.alreadyDecided');
        const a = BotAnswer.safeParse(input);
        if (!a.success) throw new DomainError('bot.errors.badAnswer');
        const known = new Set(knowledge.map((k) => k.id));
        decision = {
          kind: 'answer',
          text: a.data.text,
          knowledgeIds: a.data.knowledgeIds.filter((id) => known.has(id)),
        };
        return { sent: true };
      }
      case 'hand_off_to_office': {
        if (decision) throw new DomainError('bot.errors.alreadyDecided');
        const h = BotHandoff.safeParse(input);
        if (!h.success) throw new DomainError('bot.errors.badHandoff');
        decision = { kind: 'handoff', summary: h.data.summary, reason: h.data.reason };
        return { handedOff: true };
      }
      default:
        throw new DomainError('copilot.errors.unknownTool');
    }
  };
  return { call, decision: () => decision };
}

// ─── Running the bot on one message ─────────────────────────────────────────

export type BotRunResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'answered' | 'handed_off'; botReplyId: string };

async function activeKnowledge(tx: Tx): Promise<Knowledge[]> {
  return tx
    .select({ id: botKnowledge.id, question: botKnowledge.question, answer: botKnowledge.answer })
    .from(botKnowledge)
    .where(eq(botKnowledge.status, 'active'))
    .orderBy(desc(botKnowledge.updatedAt))
    .limit(500);
}

/**
 * Runs the bot on one inbound message, inside the tenant's worker transaction. Returns what it did; a message it
 * skips stays in the inbox exactly as before. `model` null (no key, no fake) hands every question to the office.
 */
export async function runParentBot(
  tx: Tx,
  ctx: ServiceContext,
  model: CopilotModel | null,
  inboundMessageId: string,
): Promise<BotRunResult> {
  const [row] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, inboundMessageId));
  if (!row) return { outcome: 'skipped', reason: 'not_found' };
  const [done] = await tx
    .select({ id: botReplies.id })
    .from(botReplies)
    .where(eq(botReplies.inboundMessageId, row.id));
  if (done) return { outcome: 'skipped', reason: 'already' };
  const drafted = await tx
    .select({ id: triageActions.id })
    .from(triageActions)
    .where(and(eq(triageActions.inboundMessageId, row.id), eq(triageActions.status, 'pending')));
  const route = botRoute({
    enabled: (await commsRules(tx)).botEnabled,
    family: row.householdId !== null && row.guardianId !== null,
    isStaff: row.staffMemberId !== null,
    open: row.status === 'new' || row.status === 'needs_human',
    intent: row.intent as Parameters<typeof botRoute>[0]['intent'],
    actionDrafted: drafted.length > 0,
    text: row.body,
  });
  if (route.route === 'skip') return { outcome: 'skipped', reason: route.reason };

  const householdId = row.householdId as string;
  const guardian = (await guardiansOfHouseholds(tx, [householdId])).find(
    (g) => g.id === row.guardianId,
  );
  if (!guardian) return { outcome: 'skipped', reason: 'not_family' };

  let decision: Decision;
  let trace: CopilotTraceStep[] = [];
  let modelName = 'rules';
  if (route.route === 'handoff' || !model) {
    decision = {
      kind: 'handoff',
      reason: route.route === 'handoff' ? route.reason : 'model_failed',
      summary: row.body.slice(0, 500),
    };
  } else {
    modelName = model.name;
    const today = await todayIL(tx);
    const knowledge = await activeKnowledge(tx);
    const children = await rows<{ n: string }>(
      tx,
      sql`select first_name n from students where household_id = ${householdId} order by dob`,
    );
    const box = botToolbox(tx, householdId, today, knowledge);
    const system = botSystem({
      school: await schoolName(tx, ctx.orgId),
      today,
      guardian: guardian.firstName,
      children: children.map((c) => c.n),
      facts: policyFacts((await resolvePolicyFor(tx, { date: today })).rules),
      knowledge: knowledge.slice(0, KNOWLEDGE_IN_PROMPT),
    });
    let failed = false;
    try {
      const out = await model.run({
        system,
        prompt: row.body,
        tools: BOT_TOOLS,
        callTool: box.call,
      });
      trace = out.trace;
    } catch {
      failed = true;
    }
    decision = box.decision() ?? {
      kind: 'handoff',
      reason: failed ? 'model_failed' : 'unknown',
      summary: row.body.slice(0, 500),
    };
  }

  const addressee = { ...guardian, whatsappOptIn: true };
  let messageId: string | null = null;
  if (decision.kind === 'answer') {
    const m = await enqueueMessage(tx, ctx, {
      guardian: addressee,
      templateKey: 'free_text',
      vars: { text: decision.text },
      idempotencyKey: `bot:${row.id}`,
      inboundMessageId: row.id,
    });
    messageId = m.id;
    await tx
      .update(inboundMessages)
      .set({ status: 'actioned', handledAt: new Date() })
      .where(eq(inboundMessages.id, row.id));
  } else {
    // The family hears once in a while that a person will answer, not after every message of a burst.
    const [last] = await rows<{ at: Date }>(
      tx,
      sql`select b.created_at at from bot_replies b
          where b.household_id = ${householdId} and b.outcome = 'handed_off' and b.message_id is not null
          order by b.created_at desc limit 1`,
    );
    if (handoffNoteDue(last ? new Date(last.at) : null, new Date())) {
      const m = await enqueueMessage(tx, ctx, {
        guardian: addressee,
        templateKey: 'bot_handoff',
        vars: {},
        idempotencyKey: `bot:${row.id}`,
        inboundMessageId: row.id,
      });
      messageId = m.id;
    }
    await tx
      .update(inboundMessages)
      .set({ status: 'needs_human' })
      .where(eq(inboundMessages.id, row.id));
  }
  const [saved] = await tx
    .insert(botReplies)
    .values({
      organizationId: ctx.orgId,
      inboundMessageId: row.id,
      householdId,
      outcome: decision.kind === 'answer' ? 'answered' : 'handed_off',
      model: modelName,
      answer: decision.kind === 'answer' ? decision.text : null,
      handoffReason: decision.kind === 'handoff' ? decision.reason : null,
      handoffSummary: decision.kind === 'handoff' ? decision.summary : null,
      knowledgeIds: decision.kind === 'answer' ? decision.knowledgeIds : [],
      trace,
      messageId,
    })
    .returning({ id: botReplies.id });
  return {
    outcome: decision.kind === 'answer' ? 'answered' : 'handed_off',
    botReplyId: (saved as { id: string }).id,
  };
}

// ─── The rules-based stand-in ───────────────────────────────────────────────

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dm = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;

/**
 * A model stand-in for demos and tests (RSWIM_BOT_FAKE=1): it answers from a matching knowledge entry, or the
 * family's next lessons, balance or makeups, and hands everything else to the office. It never sees an API key.
 */
export class FakeParentBotModel implements CopilotModel {
  readonly name = 'fake:rules';

  async run(input: CopilotRunInput) {
    const trace: CopilotTraceStep[] = [];
    const use = async <T>(tool: string, args: unknown) => {
      const r = await traced(input, trace, tool, args);
      return r.error ? null : (JSON.parse(r.text) as T);
    };
    const reply = async (text: string, knowledgeIds: string[] = []) => {
      await use('reply_to_parent', { text, knowledgeIds });
      return { answer: text, trace, incomplete: false };
    };
    const handoff = async (summary: string) => {
      await use('hand_off_to_office', { summary, reason: 'unknown' });
      return { answer: '', trace, incomplete: false };
    };
    const [hit] = (await use<Knowledge[]>('search_knowledge', { query: input.prompt })) ?? [];
    if (hit) return reply(hit.answer, [hit.id]);
    switch (fakeBotIntent(input.prompt)) {
      case 'lessons': {
        type Lesson = {
          child: string;
          date: string;
          weekday: number;
          startsAt: string;
          group: string;
          pool: string;
          status: string;
        };
        const l = (await use<Lesson[]>('family_lessons', {})) ?? [];
        const next = l.filter((x) => x.status === 'scheduled');
        if (!next.length)
          return handoff(
            `ההורה שואל/ת על שיעורים ואין שיעור מתוכנן בשבועיים הקרובים: "${input.prompt}"`,
          );
        const firsts = [...new Map(next.map((x) => [x.child, x])).values()];
        return reply(
          firsts
            .map(
              (x) =>
                `השיעור הבא של ${x.child}: יום ${HE_DAYS[x.weekday]} ${dm(x.date)} בשעה ${x.startsAt}, ${x.group} ב${x.pool}.`,
            )
            .join('\n'),
        );
      }
      case 'balance': {
        const b = await use<{ balanceAgorot: number }>('family_balance', {});
        if (!b) return handoff(`שאלה על תשלום: "${input.prompt}"`);
        const nis = Math.abs(Math.round(b.balanceAgorot / 100));
        return reply(
          b.balanceAgorot > 0
            ? `היתרה לתשלום כרגע היא ${nis} ₪.`
            : b.balanceAgorot < 0
              ? `יש לכם זיכוי של ${nis} ₪, אין מה לשלם כרגע.`
              : 'אין יתרה פתוחה, הכול שולם 🙂',
        );
      }
      case 'makeups': {
        const c =
          (await use<{ child: string; status: string; expiresOn: string; booked: string | null }[]>(
            'family_makeups',
            {},
          )) ?? [];
        if (!c.length) return reply('כרגע אין שיעורי השלמה פתוחים.');
        return reply(
          c
            .map((x) =>
              x.booked
                ? `ל${x.child} נקבעה השלמה: ${x.booked}.`
                : `ל${x.child} יש השלמה פתוחה עד ${dm(x.expiresOn)}. אפשר לקבוע אותה באזור האישי.`,
            )
            .join('\n'),
        );
      }
      default:
        return handoff(`שאלה שאין לי עליה תשובה: "${input.prompt}"`);
    }
  }
}

// ─── The office's side ──────────────────────────────────────────────────────

/** The bot's recent work, newest first, with the family's message. */
export async function listBotReplies(
  tx: Tx,
  q: { outcome?: 'answered' | 'handed_off'; review?: BotReview; limit?: number } = {},
) {
  const list = await tx
    .select({
      reply: botReplies,
      body: inboundMessages.body,
      receivedAt: inboundMessages.receivedAt,
      inboundStatus: inboundMessages.status,
    })
    .from(botReplies)
    .innerJoin(inboundMessages, eq(inboundMessages.id, botReplies.inboundMessageId))
    .where(
      and(
        q.outcome ? eq(botReplies.outcome, q.outcome) : undefined,
        q.review ? eq(botReplies.review, q.review) : undefined,
      ),
    )
    .orderBy(desc(botReplies.createdAt))
    .limit(q.limit ?? 100);
  const households = [...new Set(list.map((r) => r.reply.householdId).filter((h) => h !== null))];
  const names = households.length
    ? await tx
        .select({ id: schema.households.id, n: schema.households.displayName })
        .from(schema.households)
        .where(inArray(schema.households.id, households))
    : [];
  return list.map((r) => ({
    ...r.reply,
    body: r.body,
    receivedAt: r.receivedAt,
    inboundStatus: r.inboundStatus,
    family: names.find((n) => n.id === r.reply.householdId)?.n ?? null,
  }));
}

/** Counts for the bot screen's header. */
export async function botStats(tx: Tx) {
  const [s] = await rows<{
    answered: number;
    handedOff: number;
    unreviewed: number;
    bad: number;
    suggestions: number;
  }>(
    tx,
    sql`select count(*) filter (where outcome = 'answered')::int answered,
               count(*) filter (where outcome = 'handed_off')::int "handedOff",
               count(*) filter (where outcome = 'answered' and review = 'unreviewed')::int unreviewed,
               count(*) filter (where review = 'bad')::int bad,
               (select count(*) from bot_knowledge where status = 'suggested')::int suggestions
        from bot_replies where created_at > now() - interval '30 days'`,
  );
  return s as NonNullable<typeof s>;
}

export const BotReviewInput = z.object({ id: z.uuid(), review: z.enum(['good', 'bad']) });

/** The office marks an answer good or bad. */
export async function reviewBotReply(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof BotReviewInput>,
) {
  const input = BotReviewInput.parse(raw);
  const r = await tx
    .update(botReplies)
    .set({ review: input.review, reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(and(eq(botReplies.id, input.id), eq(botReplies.outcome, 'answered')))
    .returning({ id: botReplies.id });
  if (!r.length) throw new DomainError('common.errors.notFound');
}

export async function listKnowledge(tx: Tx, statuses: BotKnowledgeStatus[]) {
  return tx
    .select()
    .from(botKnowledge)
    .where(inArray(botKnowledge.status, statuses))
    .orderBy(desc(botKnowledge.updatedAt));
}

export const KnowledgeInput = z.object({
  /** Empty for a new entry. */
  id: z.union([z.uuid(), z.literal('')]).default(''),
  question: requiredText(500),
  answer: requiredText(1000),
  /** A suggestion saved with this ticked becomes active. */
  approve: checkbox().default(false),
});
export type KnowledgeInput = z.input<typeof KnowledgeInput>;

/**
 * The office writes or edits an entry. A new entry is active at once; editing a suggestion keeps it a suggestion unless
 * it is approved in the same step.
 */
export async function saveKnowledge(tx: Tx, ctx: ServiceContext, raw: KnowledgeInput) {
  const input = KnowledgeInput.parse(raw);
  if (!input.id) {
    const [r] = await tx
      .insert(botKnowledge)
      .values({
        organizationId: ctx.orgId,
        question: input.question,
        answer: input.answer,
        status: 'active',
        source: 'office',
        createdBy: ctx.userId,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
      })
      .returning({ id: botKnowledge.id });
    return (r as { id: string }).id;
  }
  const [cur] = await tx.select().from(botKnowledge).where(eq(botKnowledge.id, input.id));
  if (!cur) throw new DomainError('common.errors.notFound');
  const activate = input.approve && cur.status === 'suggested';
  await tx
    .update(botKnowledge)
    .set({
      question: input.question,
      answer: input.answer,
      ...(activate ? { status: 'active', decidedBy: ctx.userId, decidedAt: new Date() } : {}),
    })
    .where(eq(botKnowledge.id, input.id));
  return input.id;
}

export const KnowledgeStatusInput = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'archived']),
});

/** Approve a suggestion as it is, archive an entry (or a suggestion), or bring an archived entry back. */
export async function setKnowledgeStatus(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof KnowledgeStatusInput>,
) {
  const input = KnowledgeStatusInput.parse(raw);
  const r = await tx
    .update(botKnowledge)
    .set({ status: input.status, decidedBy: ctx.userId, decidedAt: new Date() })
    .where(eq(botKnowledge.id, input.id))
    .returning({ id: botKnowledge.id });
  if (!r.length) throw new DomainError('common.errors.notFound');
}
