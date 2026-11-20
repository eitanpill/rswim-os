/**
 * The weekly coach (docs/AI-BRAIN.md stages 7 and 8, WhatsApp track W8): every Sunday the owner's approvals number
 * gets the week in one message. Last week in a line, at most three things that matter this week with what to reply,
 * and the next holiday with how the same month went last year. Rules only; the text is in coach-policies.ts.
 */
import { addDays, dayInfo } from '@rswim/calendar';
import type { Tx } from '@rswim/db';
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
import { coachText, type CoachFacts } from './coach-policies';
import { listSnapshots } from './memory';
import { copilotAvailable } from './services';

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
    .map((a) => ({ ref: a.ref as number, summary: summaryText(a.summary, 'he') }));
  const ahead = holidaysAhead(today);
  const next = ahead[0];
  const period = next ? `${Number(next.date.slice(0, 4)) - 1}${next.date.slice(4, 7)}` : null;
  const then = period ? (await listSnapshots(tx, 40)).find((s) => s.period === period) : undefined;
  return {
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

/**
 * Sends the week's message to the owner's approvals number. Nothing without a number, with her summaries turned off,
 * or with nothing to say; once a week at most.
 */
export async function sendWeeklyCoach(
  tx: Tx,
  ctx: ServiceContext,
  /** The assistant's model in the worker, when there is one: the message then suggests asking it. */
  model: CopilotModel | null = null,
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getAgentSettings(tx);
  if (!s.approvalPhoneE164) return { sent: false, reason: 'no_phone' };
  if (!s.eveningSummary) return { sent: false, reason: 'off' };
  const assistant = (await copilotAvailable(tx, model)).ok && (await hasFeature(tx, 'copilot'));
  const facts = await coachFacts(tx, await todayIL(tx), assistant);
  if (!coachText(facts, 'he')) return { sent: false, reason: 'nothing' };
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
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
