/**
 * The WhatsApp bot for new customers (docs/whatsapp/PLAN.md, W2). A message from a lead (a number that is not a
 * family, a staff member or a diver) reaches the same bot as families' messages; with `comms.lead_bot_enabled` on it
 * answers from what the business offers (programs, prices, open seats), its rules and approved answers, saves what
 * the person tells about themselves on the lead, and asks for the next missing detail, one question at a time. It
 * hands to the office whatever it can't answer, anything sensitive, and anyone who asks for a person; it keeps out of a
 * conversation the office is in. Swim schools and freediving clubs alike.
 *
 * Modules: an optional part of the business (lodging…) registers a LeadBotModule, which adds its facts to the bot's
 * instructions and its tools to the bot's toolbox, so one bot answers about everything the business offers.
 */
import { z } from 'zod';
import type { ClaudeUsage, LeadStage, Vertical } from '@rswim/contracts';
import { desc, eq, schema, sql, type Tx } from '@rswim/db';
import { commsRules, enqueueMessage } from '@rswim/domain-comms';
import { advanceLead, saveLeadDetails } from '@rswim/domain-crm';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { aiAllowed, hasFeature, recordAiUsage } from '@rswim/domain-platform';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  traced,
  trackUsage,
  type CopilotModel,
  type CopilotRunInput,
  type CopilotTool,
  type CopilotTraceStep,
} from '@rswim/integrations';
import { BotAnswer, BotHandoff, handoffNoteDue, matchKnowledge, policyFacts } from './bot-policies';
import {
  agesInWords,
  fakeLeadDetails,
  fakeLeadIntent,
  leadBotRoute,
  leadBotSystem,
  LeadDetailsPatch,
  mergeLeadDetails,
  nextLeadQuestion,
  offerLines,
  QUESTION_HE,
  type LeadDetailKey,
  type LeadKnown,
  type Offer,
} from './lead-bot-policies';

const { botKnowledge, botReplies, inboundMessages, leads, organizations } = schema;

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

// ─── Modules ────────────────────────────────────────────────────────────────

/** An optional part of the business that the bot can answer about (lodging, …). */
export interface LeadBotModule {
  key: string;
  /** Whether this business has the module on. */
  enabled(tx: Tx): Promise<boolean>;
  /** Plain lines for the bot's instructions (what is offered, prices, rules). */
  facts(tx: Tx): Promise<string[]>;
  tools: CopilotTool[];
  /** Runs one of the module's tools for this lead. */
  call(tx: Tx, ctx: ServiceContext, leadId: string, tool: string, input: unknown): Promise<unknown>;
}

const MODULES: LeadBotModule[] = [];

/** Called once by the module's package at the worker's start; registering the same key again does nothing. */
export function registerLeadBotModule(m: LeadBotModule): void {
  if (!MODULES.some((x) => x.key === m.key)) MODULES.push(m);
}

/** The registered modules (tests reset them). */
export function leadBotModules(): readonly LeadBotModule[] {
  return MODULES;
}

export function clearLeadBotModules(): void {
  MODULES.length = 0;
}

// ─── What the business offers ───────────────────────────────────────────────

const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const PRICE_LABEL: Record<string, string> = {
  trial: 'שיעור ניסיון',
  monthly: 'חודשי',
  single: 'שיעור בודד',
  package: 'כרטיסייה',
};

/** A swim school's programs with today's prices and the groups that still have places. */
async function swimOffers(tx: Tx, today: string): Promise<Offer[]> {
  const programs = await rows<{
    id: string;
    name: string;
    min: number | null;
    max: number | null;
  }>(
    tx,
    sql`select id, name_he name, min_age_months min, max_age_months max
        from programs where active order by sort_order, name_he`,
  );
  const prices = await rows<{
    program: string;
    kind: string;
    label: string | null;
    sessions: number | null;
    agorot: number;
  }>(
    tx,
    sql`select i.program_id program, i.kind, i.label, i.sessions_count sessions, i.amount_agorot agorot
        from price_items i join price_lists l on l.id = i.price_list_id
        where l.status = 'published' and l.effective_from <= ${today}::date
          and (l.effective_to is null or l.effective_to >= ${today}::date)
        order by i.amount_agorot`,
  );
  const groups = await rows<{
    program: string;
    weekday: number;
    time: string;
    venue: string;
    free: number;
  }>(
    tx,
    sql`select t.program_id program, t.weekday, to_char(t.starts_at, 'HH24:MI') time, v.name venue,
               t.capacity - (select count(*)::int from enrollments e where e.class_template_id = t.id
                             and e.status in ('trial_booked', 'active', 'frozen', 'cancel_requested')) free
        from class_templates t join venues v on v.id = t.venue_id
        where t.status = 'active' and t.effective_from <= ${today}::date
          and (t.effective_to is null or t.effective_to >= ${today}::date)
        order by t.weekday, t.starts_at`,
  );
  return programs
    .map((p) => ({
      name: p.name,
      who: agesInWords(p.min, p.max),
      prices: prices
        .filter((x) => x.program === p.id)
        .map((x) => ({
          label:
            x.label ??
            (x.kind === 'package' && x.sessions
              ? `כרטיסייה ${x.sessions}`
              : (PRICE_LABEL[x.kind] ?? x.kind)),
          agorot: x.agorot,
        })),
      openings: groups
        .filter((g) => g.program === p.id && g.free > 0)
        .slice(0, 6)
        .map(
          (g) => `יום ${HE_DAYS[g.weekday] ?? g.weekday} ${g.time}, ${g.venue}, ${g.free} מקומות`,
        ),
    }))
    .filter((o) => o.prices.length > 0 || o.openings.length > 0);
}

/** A freediving club's programs with their prices and the sessions in the next two weeks that have places. */
async function diveOffers(tx: Tx): Promise<Offer[]> {
  const programs = await rows<{
    id: string;
    name: string;
    level: number | null;
    agorot: number | null;
    depth: number | null;
  }>(
    tx,
    sql`select id, name_he name, min_level level, price_agorot agorot, max_depth_m depth
        from dive_programs where active order by price_agorot nulls last, name_he`,
  );
  const sessions = await rows<{ program: string; at: string; site: string | null; free: number }>(
    tx,
    sql`select s.program_id program,
               to_char(s.starts_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI') at,
               (select name from dive_sites x where x.id = s.site_id) site,
               s.capacity - (select count(*)::int from dive_bookings b
                             where b.session_id = s.id and app.dive_holds_seat(b.status, b.hold_until)) free
        from dive_sessions s
        where s.status = 'scheduled' and s.starts_at > now() and s.starts_at < now() + interval '14 days'
        order by s.starts_at`,
  );
  return programs.map((p) => ({
    name: p.name,
    who:
      [p.level ? `מרמה ${p.level}` : null, p.depth ? `עד ${p.depth} מ׳` : null]
        .filter(Boolean)
        .join(', ') || null,
    prices: p.agorot ? [{ label: 'מחיר', agorot: p.agorot }] : [],
    openings: sessions
      .filter((s) => s.program === p.id && s.free > 0)
      .slice(0, 6)
      .map((s) => `${s.at}${s.site ? `, ${s.site}` : ''}, ${s.free} מקומות`),
  }));
}

/** Everything a new customer may be told about the business: what it offers and where. */
export async function businessInfo(tx: Tx, vertical: Vertical, today: string) {
  const offers = vertical === 'freediving' ? await diveOffers(tx) : await swimOffers(tx, today);
  const places =
    vertical === 'freediving'
      ? await rows<{ name: string; address: string | null }>(
          tx,
          sql`select name, null::text address from dive_sites order by name limit 10`,
        )
      : await rows<{ name: string; address: string | null }>(
          tx,
          sql`select name, nullif(concat_ws(', ', address, city), '') address
              from venues where status = 'active' order by name limit 10`,
        );
  return { offers: offerLines(offers), places };
}

// ─── The toolbox ────────────────────────────────────────────────────────────

export const LEAD_BOT_TOOLS: CopilotTool[] = [
  {
    name: 'business_info',
    description:
      'What the business offers a new customer: programs with who they are for, prices, open places, and where.',
    input_schema: obj({}, []),
  },
  {
    name: 'search_knowledge',
    description: "The business's approved answers that match a question.",
    input_schema: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'save_details',
    description:
      'Saves what the person said about themselves: name, child_age, area, days (that suit them), experience, dates (of a visit), interest (the program), note.',
    input_schema: obj(
      {
        name: { type: 'string' },
        child_age: { type: 'string' },
        area: { type: 'string' },
        days: { type: 'string' },
        experience: { type: 'string' },
        dates: { type: 'string' },
        interest: { type: 'string' },
        note: { type: 'string' },
      },
      [],
    ),
  },
  {
    name: 'reply_to_lead',
    description: 'Sends the answer to the person on WhatsApp. Ends the turn.',
    input_schema: obj(
      {
        text: { type: 'string' },
        knowledgeIds: { type: 'array', items: { type: 'string' } },
      },
      ['text'],
    ),
  },
  {
    name: 'hand_off_to_office',
    description: 'Passes the message to the office with a short Hebrew summary. Ends the turn.',
    input_schema: obj(
      {
        summary: { type: 'string' },
        reason: { type: 'string', enum: ['unknown', 'needs_action', 'sensitive'] },
      },
      ['summary', 'reason'],
    ),
  },
];

type Knowledge = { id: string; question: string; answer: string };
type Decision =
  | { kind: 'answer'; text: string; knowledgeIds: string[] }
  | {
      kind: 'handoff';
      reason: 'unknown' | 'needs_action' | 'sensitive' | 'model_failed' | 'ai_cap';
      summary: string;
    };

interface LeadState extends LeadKnown {
  id: string;
}

/** The tools bound to one lead. The answer or handoff is collected, not applied. */
export function leadToolbox(
  tx: Tx,
  ctx: ServiceContext,
  lead: LeadState,
  vertical: Vertical,
  today: string,
  knowledge: Knowledge[],
  modules: readonly LeadBotModule[],
) {
  let decision: Decision | null = null;
  const call = async (name: string, input: unknown): Promise<unknown> => {
    if (decision) throw new DomainError('bot.errors.alreadyDecided');
    switch (name) {
      case 'business_info':
        return businessInfo(tx, vertical, today);
      case 'search_knowledge': {
        const { query } = z.object({ query: z.string().max(500) }).parse(input);
        return matchKnowledge(query, knowledge).slice(0, 5);
      }
      case 'save_details': {
        const r = LeadDetailsPatch.safeParse(input);
        if (!r.success) throw new DomainError('bot.errors.badAction');
        const merged = mergeLeadDetails(lead, r.data);
        await saveLeadDetails(tx, lead.id, merged);
        lead.name = merged.name;
        lead.details = merged.details;
        return { saved: true, next: nextLeadQuestion(vertical, lead) };
      }
      case 'reply_to_lead': {
        const r = BotAnswer.safeParse(input);
        if (!r.success) throw new DomainError('bot.errors.badAction');
        decision = { kind: 'answer', text: r.data.text, knowledgeIds: r.data.knowledgeIds };
        return { ok: true };
      }
      case 'hand_off_to_office': {
        const r = BotHandoff.safeParse(input);
        if (!r.success) throw new DomainError('bot.errors.badAction');
        decision = { kind: 'handoff', reason: r.data.reason, summary: r.data.summary };
        return { ok: true };
      }
      default: {
        const m = modules.find((x) => x.tools.some((t) => t.name === name));
        if (!m) throw new DomainError('bot.errors.unknownTool');
        return m.call(tx, ctx, lead.id, name, input);
      }
    }
  };
  return { call, decision: () => decision };
}

// ─── Running the bot on one lead's message ──────────────────────────────────

export type LeadBotRunResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'answered' | 'handed_off'; botReplyId: string };

/** The office wrote to this number within these hours: a person is in the conversation. */
const OFFICE_HOURS = 3;

/**
 * Runs the bot on one lead's inbound message, inside the tenant's worker transaction (runParentBot sends it here).
 * `model` null hands the message to the office.
 */
export async function runLeadBot(
  tx: Tx,
  ctx: ServiceContext,
  model: CopilotModel | null,
  row: typeof inboundMessages.$inferSelect,
): Promise<LeadBotRunResult> {
  if (!row.leadId) return { outcome: 'skipped', reason: 'not_lead' };
  const [lead] = await tx.select().from(leads).where(eq(leads.id, row.leadId));
  if (!lead || !lead.phoneE164) return { outcome: 'skipped', reason: 'not_lead' };
  const [office] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int n from messages
        where to_phone_e164 = ${lead.phoneE164} and created_by is not null
          and created_at > now() - make_interval(hours => ${OFFICE_HOURS})`,
  );
  const route = leadBotRoute({
    enabled: (await commsRules(tx)).leadBotEnabled && (await hasFeature(tx, 'parent_bot')),
    open: row.status === 'new' || row.status === 'needs_human',
    stage: lead.stage as LeadStage,
    officeTalking: (office?.n ?? 0) > 0,
    text: row.body,
  });
  if (route.route === 'skip') return { outcome: 'skipped', reason: route.reason };

  const [org] = await tx
    .select({ name: organizations.name, vertical: organizations.vertical })
    .from(organizations)
    .where(eq(organizations.id, ctx.orgId));
  const vertical: Vertical = org?.vertical === 'freediving' ? 'freediving' : 'swim';
  const state: LeadState = {
    id: lead.id,
    name: lead.name,
    details: (lead.details ?? {}) as Record<string, unknown>,
  };

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
    const today = await todayIL(tx);
    const knowledge = await tx
      .select({ id: botKnowledge.id, question: botKnowledge.question, answer: botKnowledge.answer })
      .from(botKnowledge)
      .where(eq(botKnowledge.status, 'active'))
      .orderBy(desc(botKnowledge.updatedAt))
      .limit(500);
    const modules: LeadBotModule[] = [];
    for (const m of MODULES) if (await m.enabled(tx)) modules.push(m);
    const moduleFacts = (await Promise.all(modules.map((m) => m.facts(tx)))).flat();
    const [city] = await rows<{ city: string | null }>(
      tx,
      sql`select city from venues where city is not null and status = 'active' limit 1`,
    );
    const box = leadToolbox(tx, ctx, state, vertical, today, knowledge, modules);
    const system = leadBotSystem({
      business: org?.name ?? '',
      vertical,
      today,
      city: city?.city ?? null,
      lead: { ...state, phone: lead.phoneE164 },
      next: nextLeadQuestion(vertical, state),
      facts: policyFacts((await resolvePolicyFor(tx, { date: today })).rules),
      moduleFacts,
      knowledge: knowledge.slice(0, 60),
    });
    let failed = false;
    const usage: ClaudeUsage[] = [];
    try {
      const out = await trackUsage(usage, () =>
        model.run({
          system,
          prompt: row.body,
          tools: [...LEAD_BOT_TOOLS, ...modules.flatMap((m) => m.tools)],
          callTool: box.call,
        }),
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
    firstName: state.name ?? '',
    phoneE164: lead.phoneE164,
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
    // Someone is talking with the business now.
    await advanceLead(tx, lead.id, 'talking');
  } else {
    const [last] = await rows<{ at: Date }>(
      tx,
      sql`select created_at at from bot_replies
          where lead_id = ${lead.id} and outcome = 'handed_off' and message_id is not null
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
      leadId: lead.id,
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

/**
 * The stand-in for demos and tests (RSWIM_BOT_FAKE=1, through FakeParentBotModel): it saves the details the message
 * gives, answers prices, open places and where from business_info or an approved answer, and asks the next question.
 */
export class FakeLeadBotModel implements CopilotModel {
  readonly name = 'fake:rules';

  async run(input: CopilotRunInput) {
    const trace: CopilotTraceStep[] = [];
    const use = async <T>(tool: string, args: unknown) => {
      const r = await traced(input, trace, tool, args);
      return r.error ? null : (JSON.parse(r.text) as T);
    };
    // The question the bot asked last is the one named in the instructions.
    const asked = /The next detail to ask for: (\w+)/.exec(input.system)?.[1] as
      LeadDetailKey | 'none' | undefined;
    const patch = fakeLeadDetails(input.prompt, asked && asked !== 'none' ? asked : null);
    let next: LeadDetailKey | null = asked && asked !== 'none' ? asked : null;
    if (Object.keys(patch).length) {
      const saved = await use<{ next: LeadDetailKey | null }>('save_details', patch);
      next = saved?.next ?? null;
    }
    const ask = next ? QUESTION_HE[next] : 'תודה! המשרד יחזור אליך עם מקום מתאים 🙏';
    const reply = async (text: string, knowledgeIds: string[] = []) => {
      await use('reply_to_lead', { text: `${text}\n${ask}`, knowledgeIds });
      return { answer: text, trace, incomplete: false };
    };

    const [hit] = (await use<Knowledge[]>('search_knowledge', { query: input.prompt })) ?? [];
    if (hit) return reply(hit.answer, [hit.id]);
    const intent = fakeLeadIntent(input.prompt);
    if (intent === 'price' || intent === 'schedule' || intent === 'where') {
      const info = await use<{
        offers: string[];
        places: { name: string; address: string | null }[];
      }>('business_info', {});
      const lines =
        intent === 'where'
          ? (info?.places ?? []).map((p) => (p.address ? `${p.name} (${p.address})` : p.name))
          : (info?.offers ?? []);
      if (lines.length) return reply(lines.slice(0, 3).join('\n'));
    }
    if (intent === 'greeting' || Object.keys(patch).length)
      return reply(intent === 'greeting' ? 'שלום! שמחים שפנית 😊' : 'מעולה, רשמתי.');
    await use('hand_off_to_office', {
      summary: `שאלה של לקוח/ה חדש/ה: "${input.prompt}"`,
      reason: 'unknown',
    });
    return { answer: '', trace, incomplete: false };
  }
}
