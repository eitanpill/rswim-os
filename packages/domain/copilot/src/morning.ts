/**
 * The business brain's daily rounds (docs/AI-BRAIN.md, stage 4). Every morning, after the insights feed is refreshed,
 * the brain acts on what it found instead of only pointing at it: a payment link to each family whose debt reached the
 * insights' attention age, and an instructor search for each uncovered lesson of the coming week. Each one goes
 * through the gate with source `morning_check`, so it runs alone or waits for the owner (and her WhatsApp) by her
 * levels. Every evening the owner's approvals number gets a short summary of the day. Rules only, no model.
 */
import { schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import { insightFacts, insightRulesFrom } from '@rswim/domain-reports';
import { todayIL } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { getAgentSettings } from './agent';
import { eveningText, morningPlan, type MorningPlan } from './agent-policies';
import { morningLessons } from './learning';
import { proposalSummary } from './policies';
import { substituteSummary, takeAction } from './services';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

export interface MorningResult {
  plan: MorningPlan;
  actions: {
    id: string;
    kind: 'payment_link' | 'substitute';
    status: 'done' | 'waiting' | 'failed';
  }[];
}

/** The morning check for one school. Returns null when the brain is not in use there (insights off). */
export async function runMorningCheck(tx: Tx, ctx: ServiceContext): Promise<MorningResult | null> {
  const today = await todayIL(tx);
  const rules = insightRulesFrom((await resolvePolicyFor(tx, { date: today })).rules);
  if (!rules.enabled) return null;
  const settings = await getAgentSettings(tx);
  const facts = await insightFacts(tx, today, rules);
  const asked = await rows<{ id: string }>(
    tx,
    sql`select params->>'householdId' id from copilot_actions
        where kind = 'payment_link' and status in ('proposed', 'confirmed')
          and created_at > now() - make_interval(days => ${rules.debtAttentionDays})
        union select household_id::text from payment_links where status = 'open'`,
  );
  const covered = await rows<{ id: string }>(
    tx,
    sql`select params->>'sessionId' id from copilot_actions
        where kind = 'substitute' and status in ('proposed', 'confirmed', 'dismissed')
        union select session_id::text from substitute_requests where status in ('open', 'unfilled', 'filled')`,
  );
  // What the owner taught it: families she dropped a link for, and balances she called too small (stage 6).
  const lessons = await morningLessons(tx, rules.debtAttentionDays);
  const plan = morningPlan({
    debts: facts.debts,
    uncovered: facts.uncovered,
    debtAttentionDays: rules.debtAttentionDays,
    askedHouseholds: [...asked.map((r) => r.id), ...lessons.skippedHouseholds],
    minLinkAgorot: lessons.minLinkAgorot,
    coveredSessions: covered.map((r) => r.id),
    levels: {
      payment_link: settings.effective.payment_link,
      substitute: settings.effective.substitute,
    },
  });
  const actions: MorningResult['actions'] = [];
  for (const p of plan.payments) {
    const family = facts.debts.find((d) => d.householdId === p.householdId)?.household ?? '';
    const description = 'יתרה פתוחה בבית הספר';
    const taken = await takeAction(tx, ctx, {
      source: 'morning_check',
      requestId: null,
      kind: 'payment_link',
      params: { householdId: p.householdId, amountAgorot: p.amountAgorot, description },
      summary: proposalSummary({
        kind: 'payment_link',
        family,
        amountAgorot: p.amountAgorot,
        description,
      }),
      amountAgorot: p.amountAgorot,
    });
    actions.push({ id: taken.id, kind: 'payment_link', status: taken.status });
  }
  for (const s of plan.substitutes) {
    const taken = await takeAction(tx, ctx, {
      source: 'morning_check',
      requestId: null,
      kind: 'substitute',
      params: { sessionId: s.sessionId, reason: null },
      summary: await substituteSummary(tx, s.sessionId, { open: true }),
      amountAgorot: null,
    });
    actions.push({ id: taken.id, kind: 'substitute', status: taken.status });
  }
  return { plan, actions };
}

/**
 * The evening summary to the owner's approvals number: today's actions by outcome, what still waits, and tomorrow's
 * lessons. Sent once a day; nothing without a number or with the summary turned off.
 */
export async function sendEveningSummary(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getAgentSettings(tx);
  if (!s.approvalPhoneE164) return { sent: false, reason: 'no_phone' };
  if (!s.eveningSummary) return { sent: false, reason: 'off' };
  const today = await todayIL(tx);
  const [d] = await rows<{
    alone: number;
    approved: number;
    waiting: number;
    failed: number;
    lessons: number;
    uncovered: number;
  }>(
    tx,
    sql`select
          count(*) filter (where ran_alone and (decided_at at time zone 'Asia/Jerusalem')::date = ${today}::date)::int alone,
          count(*) filter (where not ran_alone and status in ('confirmed', 'undone')
                           and (decided_at at time zone 'Asia/Jerusalem')::date = ${today}::date)::int approved,
          count(*) filter (where status = 'proposed')::int waiting,
          count(*) filter (where status = 'failed'
                           and (decided_at at time zone 'Asia/Jerusalem')::date = ${today}::date)::int failed,
          (select count(*)::int from sessions where date = ${today}::date + 1 and status = 'scheduled') lessons,
          (select count(*)::int from sessions s where s.date = ${today}::date + 1 and s.status = 'scheduled'
             and not exists (select 1 from session_staff ss where ss.session_id = s.id
                             and ss.role in ('lead', 'substitute'))) uncovered
        from ${schema.copilotActions}`,
  );
  const facts = d ?? { alone: 0, approved: 0, waiting: 0, failed: 0, lessons: 0, uncovered: 0 };
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
    vars: (locale) => ({
      text: eveningText(
        {
          date: today,
          alone: facts.alone,
          approved: facts.approved,
          waiting: facts.waiting,
          failed: facts.failed,
          tomorrowLessons: facts.lessons,
          tomorrowUncovered: facts.uncovered,
        },
        locale,
      ),
    }),
    idempotencyKey: `agent.evening:${today}`,
  });
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
