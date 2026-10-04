/**
 * Broadcasts and the holiday notice (brief §6.12): one message to a segment of families (a venue, a group, a program,
 * families who owe), now or at a set time, and the "no lessons over the holiday" notice before every holiday. The
 * audience is every guardian of a household with a running place that matches; opted-out guardians are logged as
 * blocked like any other message.
 */
import { z } from 'zod';
import { Segment, checkbox, requiredText, type TemplateKey } from '@rswim/contracts';
import { and, desc, eq, lte, schema, type Tx } from '@rswim/db';
import { balancesByHousehold } from '@rswim/domain-billing';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { guardiansOfHouseholds, studentsByIds } from '@rswim/domain-people';
import { calendarPolicyFrom, listOverrides, runningPlaces } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  holidayNotice,
  israelInstant,
  matchesSegment,
  messageDate,
  type SegmentFacts,
} from '../policies';
import { sendToTargets, type Target } from './automations';
import { commsRules, israelToday } from './outbound';

const { automationRules, broadcasts } = schema;

interface Household extends SegmentFacts {
  householdId: string;
  studentNames: string[];
}

/** Every household with a place running today, with what segments filter on. */
async function activeHouseholds(tx: Tx, today: string): Promise<Household[]> {
  const places = await runningPlaces(tx, today);
  const students = new Map(
    (await studentsByIds(tx, [...new Set(places.map((p) => p.studentId))])).map((s) => [s.id, s]),
  );
  const balances = await balancesByHousehold(tx);
  const out = new Map<string, Household>();
  for (const p of places) {
    const s = students.get(p.studentId);
    if (!s) continue;
    const h = out.get(s.householdId) ?? {
      householdId: s.householdId,
      venueIds: [],
      groupIds: [],
      programIds: [],
      owing: (balances.get(s.householdId) ?? 0) > 0,
      studentNames: [],
    };
    (h.venueIds as string[]).push(p.venueId);
    (h.groupIds as string[]).push(p.classTemplateId);
    (h.programIds as string[]).push(p.programId);
    if (!h.studentNames.includes(s.firstName)) h.studentNames.push(s.firstName);
    out.set(s.householdId, h);
  }
  return [...out.values()];
}

export async function segmentHouseholds(tx: Tx, segment: Segment) {
  return (await activeHouseholds(tx, await israelToday(tx))).filter((h) =>
    matchesSegment(h, segment),
  );
}

/** How many families and guardians a segment reaches, and how many can receive WhatsApp. */
export async function previewAudience(tx: Tx, raw: z.input<typeof Segment>) {
  const households = await segmentHouseholds(tx, Segment.parse(raw));
  const guardians = await guardiansOfHouseholds(
    tx,
    households.map((h) => h.householdId),
  );
  return {
    households: households.length,
    guardians: guardians.length,
    reachable: guardians.filter((g) => g.whatsappOptIn && g.phoneE164).length,
  };
}

const localDateTime = z
  .preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'forms.errors.dateTime')
      .optional(),
  )
  .transform((v) => v ?? null);

export const BroadcastInput = z.object({
  title: requiredText(120),
  body: requiredText(1000),
  venueIds: z.array(z.uuid()).default([]),
  groupIds: z.array(z.uuid()).default([]),
  programIds: z.array(z.uuid()).default([]),
  owing: checkbox(),
  /** "YYYY-MM-DDTHH:MM" Israel time; empty sends now. */
  scheduledFor: localDateTime,
});
export type BroadcastInput = z.input<typeof BroadcastInput>;

/** Saves a broadcast and sends it now, or keeps it for its time (the worker sends scheduled ones). */
export async function createBroadcast(tx: Tx, ctx: ServiceContext, raw: BroadcastInput) {
  const input = BroadcastInput.parse(raw);
  const segment = Segment.parse(input);
  const [row] = await tx
    .insert(broadcasts)
    .values({
      organizationId: ctx.orgId,
      title: input.title,
      body: input.body,
      templateKey: 'free_text',
      segment,
      scheduledFor: input.scheduledFor ? fromLocal(input.scheduledFor) : null,
      status: input.scheduledFor ? 'scheduled' : 'draft',
      createdBy: ctx.userId,
    })
    .returning();
  if (!row) throw new DomainError('forms.errors.invalid');
  if (!input.scheduledFor || (row.scheduledFor && row.scheduledFor <= new Date())) {
    return { id: row.id, ...(await expandBroadcast(tx, ctx, row.id)) };
  }
  return { id: row.id, status: 'scheduled', households: 0, queued: 0, blocked: 0 };
}

/** "YYYY-MM-DDTHH:MM" in Israel as an instant. */
function fromLocal(local: string): Date {
  const [date, time] = local.split('T') as [string, string];
  return israelInstant(date, time);
}

/** Queues the broadcast's message to everyone in its segment. Sending twice queues nothing new. */
export async function expandBroadcast(tx: Tx, ctx: ServiceContext, broadcastId: string) {
  const [b] = await tx.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
  if (!b) throw new DomainError('common.errors.notFound');
  if (!['draft', 'scheduled'].includes(b.status))
    throw new DomainError('comms.errors.broadcastClosed');
  const households = await segmentHouseholds(tx, Segment.parse(b.segment));
  const targets: Target[] = households.map((h) => ({
    key: h.householdId,
    householdId: h.householdId,
    vars: () => ({ text: b.body, student_name: h.studentNames.join(', ') }),
  }));
  const r = await sendToTargets(tx, ctx, targets, {
    templateKey: (b.templateKey ?? 'free_text') as TemplateKey,
    keyPrefix: `broadcast:${b.id}`,
    broadcastId: b.id,
  });
  const counts = { households: households.length, queued: r.queued, blocked: r.blocked };
  await tx
    .update(broadcasts)
    .set({ status: 'sent', sentAt: new Date(), counts })
    .where(eq(broadcasts.id, b.id));
  return { status: 'sent', ...counts };
}

export async function cancelBroadcast(tx: Tx, broadcastId: string) {
  const rows = await tx
    .update(broadcasts)
    .set({ status: 'cancelled' })
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, 'scheduled')))
    .returning({ id: broadcasts.id });
  if (rows.length === 0) throw new DomainError('comms.errors.broadcastClosed');
}

export async function listBroadcasts(tx: Tx, limit = 50) {
  return tx.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
}

/** Scheduled broadcasts whose time has come (the worker's minute tick). */
export async function dueBroadcasts(tx: Tx, now: Date = new Date()) {
  return tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.status, 'scheduled'), lte(broadcasts.scheduledFor, now)));
}

/**
 * The daily holiday check: when a run of holiday days without lessons starts within
 * `comms.holiday_notice_days_before` days, every active family gets the holiday template once per run.
 */
export async function sendHolidayNotice(tx: Tx, ctx: ServiceContext, today?: string) {
  const [rule] = await tx
    .select()
    .from(automationRules)
    .where(eq(automationRules.eventType, 'calendar.holiday_ahead'));
  if (rule && !rule.enabled) return { outcome: 'disabled' as const };
  const day = today ?? (await israelToday(tx));
  const rules = await commsRules(tx);
  const calendar = calendarPolicyFrom((await resolvePolicyFor(tx, { date: day })).rules);
  const overrides = (await listOverrides(tx, day))
    .filter((o) => o.venueId === null)
    .map((o) => ({ date: o.date, kind: o.kind as 'open' | 'closed', reason: o.reason }));
  const stretch = holidayNotice(day, rules.holidayNoticeDaysBefore, calendar, overrides);
  if (!stretch) return { outcome: 'none' as const };
  const households = await activeHouseholds(tx, day);
  const r = await sendToTargets(
    tx,
    ctx,
    households.map((h) => ({
      key: h.householdId,
      householdId: h.householdId,
      vars: (loc) => ({
        from: messageDate(stretch.start, loc),
        to: messageDate(stretch.end, loc),
        resume_on: messageDate(stretch.resumeOn, loc),
      }),
    })),
    { templateKey: 'holiday_schedule', keyPrefix: `holiday:${stretch.start}` },
  );
  return { outcome: 'sent' as const, stretch, queued: r.queued, blocked: r.blocked };
}
