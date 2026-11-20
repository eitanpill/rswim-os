/**
 * The lead list (WhatsApp track, stage 1): everyone who asked about the business and is not a customer yet, for swim
 * schools and freediving clubs alike. A new number writing on WhatsApp opens a lead (the inbox's intake calls
 * touchLeadFromMessage in the same transaction); a join request, a trial, a new family or a new diver move it on
 * (database triggers, migration 0065); the office moves it by hand on /admin/leads or the club's front desk.
 */
import { z } from 'zod';
import {
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STAGES,
  OPEN_LEAD_STAGES,
  optionalDate,
  optionalPhone,
  optionalText,
  type LeadLostReason,
  type LeadSource,
  type LeadStage,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  leadAttention,
  leadStageAfter,
  leadStageAfterMessage,
  sourcesReport,
  type LeadAttention,
  type SourceMonth,
} from './lead-policies';

const { leads, inboundMessages, messages } = schema;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/**
 * A WhatsApp message from a number the business does not know (no family, no staff member): opens its lead or brings
 * it up to date. A freediving club's diver is not a lead. Returns the lead, or null when the number is a diver.
 */
export async function touchLeadFromMessage(
  tx: Tx,
  ctx: ServiceContext,
  input: { phoneE164: string; body: string; receivedAt: Date },
): Promise<string | null> {
  // Divers are the club's customers (their own module has no "sender" lookup yet).
  const [diver] = await rows<{ id: string }>(
    tx,
    sql`select id from dive_divers where phone_e164 = ${input.phoneE164} limit 1`,
  );
  if (diver) return null;
  const [current] = await tx
    .select({ id: leads.id, stage: leads.stage })
    .from(leads)
    .where(eq(leads.phoneE164, input.phoneE164))
    .for('update');
  const snippet = input.body.slice(0, 300);
  if (!current) {
    const [row] = await tx
      .insert(leads)
      .values({
        organizationId: ctx.orgId,
        phoneE164: input.phoneE164,
        source: 'whatsapp',
        stage: leadStageAfterMessage(null),
        messageCount: 1,
        lastMessage: snippet,
        lastMessageAt: input.receivedAt,
      })
      .returning({ id: leads.id });
    return (row as { id: string }).id;
  }
  const before = current.stage as LeadStage;
  const stage = leadStageAfterMessage(before);
  await tx
    .update(leads)
    .set({
      stage,
      lostReason: stage === before ? undefined : null,
      stageChangedAt: stage === before ? undefined : input.receivedAt,
      messageCount: sql`${leads.messageCount} + 1`,
      lastMessage: snippet,
      lastMessageAt: input.receivedAt,
    })
    .where(eq(leads.id, current.id));
  return current.id;
}

// ─── The office's list ──────────────────────────────────────────────────────

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  source: LeadSource;
  stage: LeadStage;
  interest: string | null;
  note: string | null;
  lostReason: LeadLostReason | null;
  nextActionOn: string | null;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  householdId: string | null;
  /** What the bot collected (W2): child_age, area, days, experience, dates, note. */
  details: Record<string, unknown>;
  stageChangedAt: Date;
  createdAt: Date;
  attention: LeadAttention;
}

const cols = {
  id: leads.id,
  name: leads.name,
  phone: leads.phoneE164,
  source: leads.source,
  stage: leads.stage,
  interest: leads.interest,
  note: leads.note,
  lostReason: leads.lostReason,
  nextActionOn: leads.nextActionOn,
  messageCount: leads.messageCount,
  lastMessage: leads.lastMessage,
  lastMessageAt: leads.lastMessageAt,
  householdId: leads.householdId,
  details: leads.details,
  stageChangedAt: leads.stageChangedAt,
  createdAt: leads.createdAt,
};

type Raw = { [K in keyof typeof cols]: unknown };

async function today(tx: Tx): Promise<string> {
  const [r] = await rows<{ d: string }>(tx, sql`select app.today()::text as d`);
  return (r as { d: string }).d;
}

function toRow(r: Raw, now: Date, day: string): LeadRow {
  const row = r as unknown as Omit<LeadRow, 'attention'>;
  return { ...row, attention: leadAttention(row, now, day) };
}

/**
 * The open leads (newest activity first) and the ones that joined or dropped in the last 30 days. `q` finds a name or
 * a phone.
 */
export async function listLeads(tx: Tx, opts: { q?: string } = {}, now = new Date()) {
  const q = opts.q?.trim();
  // A phone as people type it (050-…) matches the stored +97250…: digits without the leading zero.
  const digits = q?.replace(/\D/g, '').replace(/^0/, '');
  const find = q
    ? sql`(${leads.name} ilike ${`%${q}%`} or ${leads.phoneE164} like ${`%${digits || q}%`})`
    : undefined;
  const list = await tx
    .select(cols)
    .from(leads)
    .where(
      and(
        find,
        sql`(${leads.stage} in ('new', 'talking', 'trial_booked') or ${leads.stageChangedAt} > now() - interval '30 days')`,
      ),
    )
    .orderBy(desc(sql`coalesce(${leads.lastMessageAt}, ${leads.createdAt})`));
  const day = await today(tx);
  return list.map((r) => toRow(r, now, day));
}

/** How many leads wait for the office (every new one, and follow-ups due): the home page's number. */
export async function leadCounts(tx: Tx, now = new Date()) {
  const open = await tx
    .select(cols)
    .from(leads)
    .where(inArray(leads.stage, [...OPEN_LEAD_STAGES]));
  const day = await today(tx);
  const withAttention = open.map((r) => toRow(r, now, day));
  return {
    open: open.length,
    new: withAttention.filter((l) => l.stage === 'new').length,
    waiting: withAttention.filter((l) => l.stage === 'new' || l.attention !== null).length,
  };
}

export interface LeadMessage {
  id: string;
  direction: 'in' | 'out';
  body: string;
  at: Date;
  status: string | null;
}

/** One lead with its WhatsApp conversation, both directions, oldest first. */
export async function getLead(tx: Tx, id: string, now = new Date()) {
  const [r] = await tx.select(cols).from(leads).where(eq(leads.id, id));
  if (!r) throw new DomainError('common.errors.notFound');
  const lead = toRow(r, now, await today(tx));
  const ins = await tx
    .select({ id: inboundMessages.id, body: inboundMessages.body, at: inboundMessages.receivedAt })
    .from(inboundMessages)
    .where(eq(inboundMessages.leadId, id));
  const outs = lead.phone
    ? await tx
        .select({
          id: messages.id,
          body: messages.body,
          at: messages.createdAt,
          status: messages.status,
        })
        .from(messages)
        .where(eq(messages.toPhoneE164, lead.phone))
    : [];
  const conversation: LeadMessage[] = [
    ...ins.map((m) => ({ ...m, direction: 'in' as const, status: null })),
    ...outs.map((m) => ({ ...m, body: m.body ?? '', direction: 'out' as const })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { lead, conversation: conversation.slice(-100) };
}

// ─── The office's changes ───────────────────────────────────────────────────

export const LeadInput = z
  .object({
    name: optionalText(120),
    phone: optionalPhone(),
    source: z.enum(LEAD_SOURCES).default('phone'),
    interest: optionalText(200),
    note: optionalText(2000),
    nextActionOn: optionalDate(),
  })
  .refine((v) => v.name !== null || v.phone !== null, {
    message: 'leads.errors.nameOrPhone',
    path: ['name'],
  });

/** A lead the office writes down itself (a phone call, someone at the pool). Returns it. */
export async function createLead(tx: Tx, ctx: ServiceContext, raw: z.input<typeof LeadInput>) {
  const input = LeadInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(leads)
      .values({
        organizationId: ctx.orgId,
        name: input.name,
        phoneE164: input.phone,
        source: input.source,
        interest: input.interest,
        note: input.note,
        nextActionOn: input.nextActionOn,
      })
      .returning({ id: leads.id }),
  );
  return (row as { id: string }).id;
}

export const LeadUpdate = z.object({
  id: z.uuid(),
  name: optionalText(120),
  interest: optionalText(200),
  note: optionalText(2000),
  nextActionOn: optionalDate(),
});

export async function updateLead(tx: Tx, raw: z.input<typeof LeadUpdate>) {
  const input = LeadUpdate.parse(raw);
  const done = await tx
    .update(leads)
    .set({
      name: input.name,
      interest: input.interest,
      note: input.note,
      nextActionOn: input.nextActionOn,
    })
    .where(eq(leads.id, input.id))
    .returning({ id: leads.id });
  if (!done.length) throw new DomainError('common.errors.notFound');
}

export const LeadStageMove = z
  .object({
    id: z.uuid(),
    stage: z.enum(LEAD_STAGES),
    lostReason: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.enum(LEAD_LOST_REASONS).optional(),
    ),
  })
  .refine((v) => v.stage === 'lost' || v.lostReason === undefined, {
    message: 'forms.errors.invalid',
    path: ['lostReason'],
  });

/** The office moves a lead to any stage (back too); marking it lost takes a reason when one is given. */
export async function moveLeadStage(tx: Tx, raw: z.input<typeof LeadStageMove>) {
  const input = LeadStageMove.parse(raw);
  const done = await tx
    .update(leads)
    .set({
      stage: input.stage,
      lostReason: input.stage === 'lost' ? (input.lostReason ?? null) : null,
      stageChangedAt: new Date(),
      nextActionOn: input.stage === 'joined' || input.stage === 'lost' ? null : undefined,
    })
    .where(eq(leads.id, input.id))
    .returning({ id: leads.id });
  if (!done.length) throw new DomainError('common.errors.notFound');
}

/** Something moved the lead on (the office answered it, the bot booked a trial): forward only, see leadStageAfter. */
export async function advanceLead(tx: Tx, id: string, happened: LeadStage): Promise<LeadStage> {
  const [r] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, id));
  if (!r) throw new DomainError('common.errors.notFound');
  const before = r.stage as LeadStage;
  const stage = leadStageAfter(before, happened);
  if (stage !== before)
    await tx
      .update(leads)
      .set({ stage, lostReason: null, stageChangedAt: new Date() })
      .where(eq(leads.id, id));
  return stage;
}

/**
 * The bot saved what a new customer told it (W2): the name when the lead has none or gave a new one, the interest, and
 * details merged into `details` (a later value replaces an earlier one).
 */
export async function saveLeadDetails(
  tx: Tx,
  id: string,
  patch: { name?: string | null; interest?: string | null; details: Record<string, unknown> },
) {
  await tx
    .update(leads)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.interest ? { interest: patch.interest } : {}),
      details: sql`${leads.details} || ${JSON.stringify(patch.details)}::jsonb`,
    })
    .where(eq(leads.id, id));
}

/**
 * Where this month's customers came from (WhatsApp track W4): the leads opened in `month` (YYYY-MM, Israel time) by
 * source, with how many booked a trial (or joined) and how many joined since.
 */
export async function leadSources(tx: Tx, month: string) {
  const list = await rows<SourceMonth>(
    tx,
    sql`select source, count(*)::int leads,
               count(*) filter (where stage in ('trial_booked', 'joined'))::int trials,
               count(*) filter (where stage = 'joined')::int joined
        from leads
        where to_char(created_at at time zone 'Asia/Jerusalem', 'YYYY-MM') = ${month}
        group by source`,
  );
  return sourcesReport(list);
}
