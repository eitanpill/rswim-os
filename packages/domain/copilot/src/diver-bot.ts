/**
 * The divers' WhatsApp bot (WhatsApp track W6, second part). A freediving club's registered diver writes; when the
 * bot is on, the worker hands the message to a model with tools bound to that diver: their coming dives (with the
 * payment link of one still unpaid), their passes, what they can book, and the forms they still owe. It books a
 * session the diver asked for exactly as the front desk would: a pass covers it, or the place is held until paid
 * (online or at the club). Everything else goes to the desk with a short summary.
 */
import { z } from 'zod';
import type { BotHandoffReason, ClaudeUsage } from '@rswim/contracts';
import { desc, eq, schema, sql, type Tx } from '@rswim/db';
import { commsRules, enqueueMessage, israelLocalDateTime, schoolName } from '@rswim/domain-comms';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { bookSession, diverHome, diverPaperwork, loadRules } from '@rswim/domain-dive';
import { aiAllowed, hasFeature, recordAiUsage } from '@rswim/domain-platform';
import {
  traced,
  trackUsage,
  type CopilotModel,
  type CopilotRunInput,
  type CopilotTool,
  type CopilotTraceStep,
} from '@rswim/integrations';
import { BotAnswer, BotHandoff, botRoute, handoffNoteDue, matchKnowledge } from './bot-policies';
import { diverBotSystem, fakeDiverIntent, pickedOption } from './diver-bot-policies';

const { botKnowledge, botReplies, inboundMessages } = schema;

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

export const DIVER_BOT_TOOLS: CopilotTool[] = [
  {
    name: 'my_dives',
    description:
      "The diver's coming bookings: date, Israel time, session, site, meeting point, status (booked, or pending_payment with its payLink) and price in agorot.",
    input_schema: obj({}, []),
  },
  {
    name: 'my_passes',
    description:
      "The diver's passes (sessions left, valid until, usable) and the passes the club sells, with the link to buy one.",
    input_schema: obj({}, []),
  },
  {
    name: 'open_sessions',
    description:
      'Sessions the diver can book in the next 10 days, soonest first: sessionId, date, time, title, site, places left, and the price in agorot (0 when their pass covers it).',
    input_schema: obj({}, []),
  },
  {
    name: 'my_forms',
    description:
      'The forms the diver still has to sign (health declaration, waiver, insurance) and the link where they sign them.',
    input_schema: obj({}, []),
  },
  {
    name: 'book_dive',
    description:
      'Book the diver into one of open_sessions. Answers booked, or pending_payment with the payLink (the place is held; they can also pay at the club).',
    input_schema: obj({ sessionId: { type: 'string' } }, ['sessionId']),
  },
  {
    name: 'search_knowledge',
    description: "Search the club's answers to common questions.",
    input_schema: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'reply_to_diver',
    description:
      'Send the answer to the diver. Ends the conversation turn. List the knowledge ids the answer used.',
    input_schema: obj(
      { text: { type: 'string' }, knowledgeIds: { type: 'array', items: { type: 'string' } } },
      ['text', 'knowledgeIds'],
    ),
  },
  {
    name: 'hand_off_to_office',
    description:
      'Pass the message to the front desk when you cannot answer from the tools and knowledge, the diver wants something you cannot do, or the topic is sensitive.',
    input_schema: obj(
      {
        summary: { type: 'string', description: 'For the desk, in Hebrew, one or two lines' },
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

const when = (iso: string | Date) => {
  const local = israelLocalDateTime(new Date(iso));
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

/** The tools bound to one diver: every read and the booking are for that diver alone. */
export function diverToolbox(
  tx: Tx,
  ctx: ServiceContext,
  diverId: string,
  knowledge: Knowledge[],
  publicUrl = '',
) {
  const base = publicUrl.replace(/\/+$/, '');
  const payLink = (bookingId: string) => `${base}/dive/me/pay/${bookingId}`;
  let decision: Decision | null = null;
  const booked: string[] = [];

  const home = async () => {
    const h = await diverHome(tx, diverId);
    if (!h) throw new DomainError('common.errors.notFound');
    return h;
  };
  const open = async () =>
    (await home()).bookable
      .filter((b) => b.decision.ok)
      .slice(0, 8)
      .map((b) => ({
        sessionId: b.id,
        ...when(b.startsAt),
        title: b.title,
        site: b.siteName,
        left: b.left,
        priceAgorot: b.price,
      }));

  const call = async (tool: string, input: unknown): Promise<unknown> => {
    switch (tool) {
      case 'my_dives':
        return (await home()).next.map((n) => ({
          ...when(n.startsAt),
          title: n.title,
          site: n.siteName,
          meetingPoint: n.meetingPoint,
          status: n.bookingStatus,
          priceAgorot: n.price,
          payLink: n.bookingStatus === 'pending_payment' ? payLink(n.bookingId) : null,
        }));
      case 'my_passes': {
        const h = await home();
        return {
          passes: h.passes.map((p) => ({
            kind: p.kind,
            remaining: p.remaining,
            validUntil: p.validUntil,
            usable: p.usable,
          })),
          offers: h.passOffers,
          link: `${base}/dive/me`,
        };
      }
      case 'open_sessions':
        return open();
      case 'my_forms': {
        const p = await diverPaperwork(tx, diverId);
        return { missing: p.toSign, link: `${base}/dive/me/forms` };
      }
      case 'book_dive': {
        const p = z.object({ sessionId: z.uuid() }).safeParse(input);
        if (!p.success) throw new DomainError('bot.errors.badAction');
        // Only what the diver's own app would offer them.
        if (!(await open()).some((s) => s.sessionId === p.data.sessionId))
          throw new DomainError('common.errors.notFound');
        const r = await bookSession(
          tx,
          { orgId: ctx.orgId, userId: null },
          { sessionId: p.data.sessionId, diverId, method: 'none' },
        );
        booked.push(r.bookingId);
        return r.status === 'pending_payment'
          ? { status: r.status, payLink: payLink(r.bookingId) }
          : { status: r.status };
      }
      case 'search_knowledge': {
        const q = String((input as { query?: unknown } | null)?.query ?? '');
        return matchKnowledge(q, knowledge, 0.34).slice(0, 5);
      }
      case 'reply_to_diver': {
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
  return { call, decision: () => decision, booked: () => booked };
}

/** The club's diver who owns a phone, or null. */
export async function diverByPhone(
  tx: Tx,
  phoneE164: string | null,
): Promise<{ id: string; firstName: string } | null> {
  if (!phoneE164) return null;
  const [d] = await rows<{ id: string; firstName: string }>(
    tx,
    sql`select id, first_name "firstName" from dive_divers where phone_e164 = ${phoneE164} limit 1`,
  );
  return d ?? null;
}

export type DiverBotRunResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'answered' | 'handed_off'; botReplyId: string };

/** Runs the bot on one diver's message, inside the tenant's worker transaction. */
export async function runDiverBot(
  tx: Tx,
  ctx: ServiceContext,
  model: CopilotModel | null,
  row: typeof inboundMessages.$inferSelect,
  diver: { id: string; firstName: string },
  opts: { publicUrl?: string } = {},
): Promise<DiverBotRunResult> {
  const route = botRoute({
    enabled: (await commsRules(tx)).botEnabled && (await hasFeature(tx, 'parent_bot')),
    family: true,
    isStaff: row.staffMemberId !== null,
    open: row.status === 'new' || row.status === 'needs_human',
    intent: row.intent as Parameters<typeof botRoute>[0]['intent'],
    actionDrafted: false,
    brainTakesDraft: false,
    text: row.body,
  });
  if (route.route === 'skip') return { outcome: 'skipped', reason: route.reason };

  let decision: Decision;
  let trace: CopilotTraceStep[] = [];
  let modelName = 'rules';
  const overCap = route.route !== 'handoff' && model !== null && !(await aiAllowed(tx));
  if (route.route === 'handoff' || !model || overCap) {
    decision = {
      kind: 'handoff',
      reason: route.route === 'handoff' ? route.reason : overCap ? 'ai_cap' : 'model_failed',
      summary: row.body.slice(0, 500),
    };
  } else {
    modelName = model.name;
    const knowledge = await tx
      .select({ id: botKnowledge.id, question: botKnowledge.question, answer: botKnowledge.answer })
      .from(botKnowledge)
      .where(eq(botKnowledge.status, 'active'))
      .orderBy(desc(botKnowledge.updatedAt))
      .limit(500);
    const { rules } = await loadRules(tx);
    const [today] = await rows<{ d: string }>(tx, sql`select app.today()::text d`);
    const box = diverToolbox(tx, ctx, diver.id, knowledge, opts.publicUrl);
    const system = diverBotSystem({
      club: await schoolName(tx, ctx.orgId),
      today: today?.d ?? '',
      diver: diver.firstName,
      facts: rules.booking.require_payment
        ? ['A booking is confirmed once it is paid (online or at the club) or covered by a pass.']
        : ['A booking is confirmed at once; payment can come later.'],
      knowledge: knowledge.slice(0, 60),
    });
    let failed = false;
    const usage: ClaudeUsage[] = [];
    try {
      const out = await trackUsage(usage, () =>
        model.run({ system, prompt: row.body, tools: DIVER_BOT_TOOLS, callTool: box.call }),
      );
      trace = out.trace;
    } catch {
      failed = true;
    }
    await recordAiUsage(tx, ctx.orgId, 'parent_bot', usage);
    decision = box.decision() ?? {
      kind: 'handoff',
      reason: failed ? 'model_failed' : 'unknown',
      summary: row.body.slice(0, 500),
    };
  }

  const addressee = {
    id: null,
    householdId: null,
    firstName: diver.firstName,
    phoneE164: row.fromPhoneE164,
    whatsappOptIn: true,
    locale: 'he',
  };
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
    const [last] = await rows<{ at: Date }>(
      tx,
      sql`select created_at at from bot_replies
          where diver_id = ${diver.id} and outcome = 'handed_off' and message_id is not null
          order by created_at desc limit 1`,
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
      householdId: null,
      diverId: diver.id,
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

const dm = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
const nis = (agorot: number) => `${Math.round(agorot / 100)} ₪`;
const FORM_HE: Record<string, string> = {
  health: 'הצהרת בריאות',
  waiver: 'כתב ויתור',
  insurance: 'ביטוח',
};

/** The stand-in for demos and tests (RSWIM_BOT_FAKE=1, through FakeParentBotModel). It never sees an API key. */
export class FakeDiverBotModel implements CopilotModel {
  readonly name = 'fake:rules';

  async run(input: CopilotRunInput) {
    const trace: CopilotTraceStep[] = [];
    const use = async <T>(tool: string, args: unknown) => {
      const r = await traced(input, trace, tool, args);
      return r.error ? null : (JSON.parse(r.text) as T);
    };
    const reply = async (text: string, knowledgeIds: string[] = []) => {
      await use('reply_to_diver', { text, knowledgeIds });
      return { answer: text, trace, incomplete: false };
    };
    const handoff = async (summary: string, reason = 'unknown') => {
      await use('hand_off_to_office', { summary, reason });
      return { answer: '', trace, incomplete: false };
    };
    type Open = {
      sessionId: string;
      date: string;
      time: string;
      title: string;
      site: string;
      left: number;
      priceAgorot: number;
    };
    const list = (o: Open[]) =>
      o
        .map(
          (s, i) =>
            `${i + 1}. ${dm(s.date)} ${s.time} ${s.title}, ${s.site} (${s.priceAgorot ? nis(s.priceAgorot) : 'בכרטיסייה'})`,
        )
        .join('\n');

    const [hit] = (await use<Knowledge[]>('search_knowledge', { query: input.prompt })) ?? [];
    if (hit) return reply(hit.answer, [hit.id]);
    switch (fakeDiverIntent(input.prompt)) {
      case 'forms': {
        const f = await use<{ missing: string[]; link: string }>('my_forms', {});
        if (!f) return handoff(`שאלה על טפסים: "${input.prompt}"`);
        if (!f.missing.length) return reply('כל הטפסים שלך חתומים ובתוקף 👍');
        return reply(
          `נשאר לחתום על: ${f.missing.map((k) => FORM_HE[k] ?? k).join(', ')}.\nאפשר לחתום כאן: ${f.link}`,
        );
      }
      case 'passes': {
        const p = await use<{
          passes: { remaining: number | null; validUntil: string; usable: boolean }[];
          link: string;
        }>('my_passes', {});
        const usable = p?.passes.find((x) => x.usable);
        if (!p) return handoff(`שאלה על כרטיסייה: "${input.prompt}"`);
        if (!usable) return reply(`אין לך כרגע כרטיסייה בתוקף. אפשר לקנות כאן: ${p.link}`);
        return reply(
          usable.remaining === null
            ? `יש לך מנוי בתוקף עד ${dm(usable.validUntil)}.`
            : `נשארו לך ${usable.remaining} כניסות בכרטיסייה, בתוקף עד ${dm(usable.validUntil)}.`,
        );
      }
      case 'open':
      case 'book': {
        const o = (await use<Open[]>('open_sessions', {})) ?? [];
        if (!o.length)
          return reply('כרגע אין מפגשים פתוחים להזמנה בימים הקרובים. נעדכן כשייפתחו 🌊');
        const n =
          fakeDiverIntent(input.prompt) === 'book' ? pickedOption(input.prompt, o.length) : null;
        if (n === null)
          return reply(`מה שפתוח להזמנה:\n${list(o)}\nכדי להזמין כתבו "להזמין" ואת המספר.`);
        const s = o[n - 1] as Open;
        const out = await use<{ status: string; payLink?: string }>('book_dive', {
          sessionId: s.sessionId,
        });
        if (!out)
          return handoff(`בקשה להזמין ${s.title} ב-${dm(s.date)} שלא הצליחה`, 'needs_action');
        return reply(
          out.status === 'pending_payment'
            ? `שמרנו לך מקום ב${s.title}, ${dm(s.date)} בשעה ${s.time} 🌊 לתשלום ואישור המקום: ${out.payLink}\nאפשר גם לשלם במועדון.`
            : `נרשמת ל${s.title}, ${dm(s.date)} בשעה ${s.time} ב${s.site}. נתראה 🌊`,
        );
      }
      case 'dives': {
        const d =
          (await use<
            {
              date: string;
              time: string;
              title: string;
              site: string;
              meetingPoint: string | null;
              status: string;
              payLink: string | null;
            }[]
          >('my_dives', {})) ?? [];
        if (!d.length)
          return reply('אין לך כרגע הזמנות קרובות. כתבו "מה פנוי" ואשלח מה אפשר להזמין.');
        return reply(
          d
            .map(
              (x) =>
                `${dm(x.date)} ${x.time} ${x.title}, ${x.site}${x.meetingPoint ? ` (נפגשים ב${x.meetingPoint})` : ''}${x.payLink ? `. ממתין לתשלום: ${x.payLink}` : ''}`,
            )
            .join('\n'),
        );
      }
      default:
        return handoff(`שאלה שאין לי עליה תשובה: "${input.prompt}"`);
    }
  }
}
