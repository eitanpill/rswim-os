/**
 * The monthly report (docs/AI-BRAIN.md, stage 8): reads the month that ended and sends it to the owner's approvals
 * number on the 1st (worker function `brain-monthly-report`). Rules only, no model; the text is in monthly-policies.ts.
 */
import { and, gte, lt, schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import { monthFacts, type MonthFacts } from '@rswim/domain-reports';
import { todayIL } from '@rswim/domain-scheduling';
import { getAgentSettings } from './agent';
import type { CoachReviewLine } from './coach-policies';
import { businessForecast } from './forecast';
import { shiftPeriod } from './memory-policies';
import { monthlyText, type MonthlyFacts } from './monthly-policies';

const { businessSnapshots, coachWeeks } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/** The month that ended before today's month, with what the report says about it. */
export async function monthlyFacts(tx: Tx, today: string): Promise<MonthlyFacts> {
  const period = shiftPeriod(today.slice(0, 7), -1);
  const from = `${period}-01`;
  const to = `${today.slice(0, 7)}-01`;
  const wanted = [period, shiftPeriod(period, -1), shiftPeriod(period, -12)];
  const stored = new Map(
    (
      await tx
        .select()
        .from(businessSnapshots)
        .where(sql`${businessSnapshots.period} in (${wanted[0]}, ${wanted[1]}, ${wanted[2]})`)
    ).map((s) => [s.period, s.facts as MonthFacts]),
  );
  // Before the memory kept the month, it is worked out now; earlier months only when remembered.
  const facts = stored.get(period) ?? (await monthFacts(tx, period, today));
  const weeks = await tx
    .select({ review: coachWeeks.review })
    .from(coachWeeks)
    .where(and(gte(coachWeeks.weekOf, from), lt(coachWeeks.weekOf, to)));
  const [a] = await rows<MonthlyFacts['actions']>(
    tx,
    sql`select
          count(*) filter (where ran_alone and status in ('confirmed', 'undone'))::int alone,
          count(*) filter (where not ran_alone and status in ('confirmed', 'undone'))::int approved,
          count(*) filter (where status = 'dismissed')::int dismissed,
          count(*) filter (where status = 'undone')::int undone
        from ${schema.copilotActions}
        where (decided_at at time zone 'Asia/Jerusalem')::date >= ${from}::date
          and (decided_at at time zone 'Asia/Jerusalem')::date < ${to}::date`,
  );
  return {
    period,
    facts,
    previous: stored.get(wanted[1] as string) ?? null,
    lastYear: stored.get(wanted[2] as string) ?? null,
    reviews: weeks.flatMap((w) => (w.review as CoachReviewLine[] | null) ?? []),
    actions: a ?? { alone: 0, approved: 0, dismissed: 0, undone: 0 },
    forecast: await businessForecast(tx, today),
  };
}

/**
 * Sends the month that ended to the owner's approvals number. Nothing without a number, with her summaries turned off,
 * or for an empty month; once a month at most.
 */
export async function sendMonthlyReport(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getAgentSettings(tx);
  if (!s.approvalPhoneE164) return { sent: false, reason: 'no_phone' };
  if (!s.eveningSummary) return { sent: false, reason: 'off' };
  const m = await monthlyFacts(tx, await todayIL(tx));
  if (!monthlyText(m, 'he')) return { sent: false, reason: 'nothing' };
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
    vars: (locale) => ({ text: monthlyText(m, locale) as string }),
    idempotencyKey: `agent.month:${m.period}`,
  });
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
