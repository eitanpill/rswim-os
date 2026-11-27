/**
 * The weekly coach (docs/AI-BRAIN.md stage 8, WhatsApp track W8): every Sunday the owner's approvals number gets the
 * week in one message. Last week in a line, what went well, how last week's advice went, at most three things that
 * matter this week with one reply that does each ("כן 12 13"), and what is ahead. Each week's priorities are kept in
 * `coach_weeks`, so the next Sunday can check them. Rules only (no AI on any level); the text is in coach-policies.ts.
 */
import { addDays, dayInfo } from '@rswim/calendar';
import { desc, eq, schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import {
  digestFacts,
  digestRulesFrom,
  insightFacts,
  insightRulesFrom,
  sundayOf,
} from '@rswim/domain-reports';
import { hasFeature } from '@rswim/domain-platform';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import type { CopilotModel } from '@rswim/integrations';
import { getAgentSettings, listAgentActions } from './agent';
import { summaryText } from './agent-policies';
import {
  coachPriorities,
  coachReview,
  coachText,
  type CoachFacts,
  type CoachPriority,
  type CoachReviewLine,
} from './coach-policies';
import { businessForecast } from './forecast';
import { listSnapshots } from './memory';
import { copilotAvailable } from './services';

const { coachWeeks } = schema;

/** How far ahead the coach looks for a holiday. */
const AHEAD_DAYS = 42;

/** Holidays with no lessons in the coming weeks, the first day of each, nearest first. */
export function holidaysAhead(today: string, days = AHEAD_DAYS): CoachFacts['ahead'] {
  const out: { name: string; date: string; daysAway: number }[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    const d = dayInfo(date);
    const name = d.holidays[0]?.he;
    if (!name || !(d.isYomTov || d.isYomKippur || d.isYomHaAtzmaut)) continue;
    // The second day of a holiday is the same holiday.
    if (out.some((h) => h.daysAway === i - 1 || h.name === name)) continue;
    out.push({ name, date, daysAway: i });
  }
  return out;
}

/** Everything the coach's message says, as facts. */
export async function coachFacts(tx: Tx, today: string, assistant = false): Promise<CoachFacts> {
  const weekOf = sundayOf(today);
  const rules = (await resolvePolicyFor(tx, { date: today })).rules;
  const digest = digestRulesFrom(rules);
  const insights = insightRulesFrom(rules);
  const week = await digestFacts(tx, weekOf);
  const now = await insightFacts(tx, today, insights);
  const old = week.debts.filter((d) => d.oldestDays >= digest.debtAttentionDays);
  const waiting = (await listAgentActions(tx, { statuses: ['proposed'], limit: 50 }))
    .filter((a) => a.ref !== null)
    .sort((a, b) => (a.ref as number) - (b.ref as number))
    .map((a) => ({ ref: a.ref as number, summary: summaryText(a.summary, 'he'), kind: a.kind }));
  const ahead = holidaysAhead(today);
  const next = ahead[0];
  const period = next ? `${Number(next.date.slice(0, 4)) - 1}${next.date.slice(4, 7)}` : null;
  const then = period ? (await listSnapshots(tx, 40)).find((s) => s.period === period) : undefined;
  const [prev] = (
    await tx.execute<{ collected: number }>(
      sql`select coalesce(sum(case when kind = 'refund' then -amount_agorot else amount_agorot end), 0)::int collected
          from payments where status = 'succeeded'
            and paid_on between ${weekOf}::date - 14 and ${weekOf}::date - 8`,
    )
  ).rows;
  const last = await coachWeekRow(tx, addDays(weekOf, -7));
  return {
    forecast: await businessForecast(tx, today),
    prevCollectedAgorot: prev?.collected ?? 0,
    lastWeek: last ? (last.priorities as CoachPriority[]) : null,
    weekOf,
    newPlaces: week.newPlaces,
    endedPlaces: week.endedPlaces,
    collectedAgorot: week.collectedAgorot,
    waiting,
    uncovered: now.uncovered.length,
    debts: { count: old.length, amountAgorot: old.reduce((n, d) => n + d.balanceAgorot, 0) },
    groups: week.groups.map((g) => ({ name: g.name, held: g.held, capacity: g.capacity })),
    lowOccupancyPct: digest.lowOccupancyPct,
    ahead,
    assistant,
    lastYear: then
      ? {
          period: then.period,
          newPlaces: then.facts.newPlaces,
          endedPlaces: then.facts.endedPlaces,
        }
      : null,
  };
}

async function coachWeekRow(tx: Tx, weekOf: string) {
  const [row] = await tx.select().from(coachWeeks).where(eq(coachWeeks.weekOf, weekOf)).limit(1);
  return row ?? null;
}

/**
 * Keeps the week's priorities and the check on last week's, so next Sunday knows what was advised. Once the week's
 * message went out its priorities stay as they were sent: they are what next week is judged against.
 */
export async function recordCoachWeek(
  tx: Tx,
  ctx: ServiceContext,
  facts: CoachFacts,
  sent = false,
): Promise<void> {
  const priorities = coachPriorities(facts);
  const review = coachReview(facts);
  const existing = await coachWeekRow(tx, facts.weekOf);
  if (existing?.sentAt) return;
  if (existing)
    await tx
      .update(coachWeeks)
      .set({ priorities, review, ...(sent ? { sentAt: new Date() } : {}) })
      .where(eq(coachWeeks.id, existing.id));
  else
    await tx.insert(coachWeeks).values({
      organizationId: ctx.orgId,
      weekOf: facts.weekOf,
      priorities,
      review,
      sentAt: sent ? new Date() : null,
    });
}

export interface CoachWeekView {
  /** This week, as the coach sees it now: the Sunday note, or null when there is nothing to say. */
  text: string | null;
  facts: CoachFacts;
  /** The weeks the coach kept, newest first, with how their advice went (judged the Sunday after). */
  history: {
    weekOf: string;
    sent: boolean;
    priorities: CoachPriority[];
    review: CoachReviewLine[] | null;
  }[];
}

/** The coach's screen (`/admin/brain/coach`): this week's note in her language and the weeks before it. */
export async function coachWeekView(
  tx: Tx,
  locale: 'he' | 'en' = 'he',
  model: CopilotModel | null = null,
): Promise<CoachWeekView> {
  const assistant = (await copilotAvailable(tx, model)).ok && (await hasFeature(tx, 'copilot'));
  const facts = await coachFacts(tx, await todayIL(tx), assistant);
  const rows = await tx.select().from(coachWeeks).orderBy(desc(coachWeeks.weekOf)).limit(12);
  return {
    text: coachText(facts, locale),
    facts,
    history: rows.map((r) => ({
      weekOf: r.weekOf,
      sent: r.sentAt !== null,
      priorities: r.priorities as CoachPriority[],
      review: (r.review as CoachReviewLine[] | null) ?? null,
    })),
  };
}

/**
 * Sends the week's message to the owner's approvals number. Nothing without a number, with her summaries turned off,
 * or with nothing to say; once a week at most. The week is kept either way, for the screen and next week's check.
 */
export async function sendWeeklyCoach(
  tx: Tx,
  ctx: ServiceContext,
  /** The assistant's model in the worker, when there is one: the message then suggests asking it. */
  model: CopilotModel | null = null,
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getAgentSettings(tx);
  const assistant = (await copilotAvailable(tx, model)).ok && (await hasFeature(tx, 'copilot'));
  const facts = await coachFacts(tx, await todayIL(tx), assistant);
  const say = coachText(facts, 'he') !== null;
  if (!s.approvalPhoneE164 || !s.eveningSummary || !say) {
    await recordCoachWeek(tx, ctx, facts);
    return {
      sent: false,
      reason: !s.approvalPhoneE164 ? 'no_phone' : !s.eveningSummary ? 'off' : 'nothing',
    };
  }
  const out = await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: s.approvalPhoneE164,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: (locale) => ({ text: coachText(facts, locale) as string }),
    idempotencyKey: `agent.coach:${facts.weekOf}`,
  });
  await recordCoachWeek(tx, ctx, facts, out.created);
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
