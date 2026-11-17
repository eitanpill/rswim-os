/**
 * Claude's monthly allowance per school (SaaS stage 6, docs/saas/DECISIONS.md decision 8 and the price list). Every
 * piece of AI work is one "AI action": checked against the plan's monthly actions before it runs, and recorded after it
 * with its tokens and what it cost the platform. The month is the calendar month in Asia/Jerusalem.
 */
import {
  AI_FEATURES,
  AI_WARN_PERCENT,
  aiCostMicros,
  type AiFeature,
  type ClaudeUsage,
} from '@rswim/contracts';
import { schema, sql, type Tx } from '@rswim/db';
import { DomainError } from '@rswim/domain-core';
import { aiBudget, type AiBudget } from './policies';

const MONTH_START = sql`(date_trunc('month', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')`;

/** The school's plan cap (null: none) and how many AI actions it ran since the 1st. */
export async function aiAllowance(tx: Tx): Promise<AiBudget> {
  const r = await tx.execute<{ cap: number | null; used: string | number }>(
    sql`select (select p.ai_monthly_actions from org_subscriptions s join plans p on p.code = s.plan_code limit 1) cap,
               (select count(*) from ai_usage where created_at >= ${MONTH_START}) used`,
  );
  const row = r.rows[0] ?? { cap: null, used: 0 };
  return aiBudget(row.cap, Number(row.used), AI_WARN_PERCENT);
}

/** The month's AI actions and their cost (millionths of a dollar) by feature, for the usage meter. */
export async function aiUsageByFeature(
  tx: Tx,
): Promise<Record<AiFeature, { actions: number; micros: number }>> {
  const r = await tx.execute<{ feature: AiFeature; n: string | number; micros: string | number }>(
    sql`select feature, count(*) n, sum(cost_micros) micros from ai_usage
        where created_at >= ${MONTH_START} group by feature`,
  );
  const out = Object.fromEntries(AI_FEATURES.map((f) => [f, { actions: 0, micros: 0 }])) as Record<
    AiFeature,
    { actions: number; micros: number }
  >;
  for (const row of r.rows)
    out[row.feature] = { actions: Number(row.n), micros: Number(row.micros) };
  return out;
}

/** Whether the school may start more AI work this month. */
export async function aiAllowed(tx: Tx): Promise<boolean> {
  return (await aiAllowance(tx)).state !== 'over';
}

/** Throws `platform.errors.aiCap` when this month's allowance is used up. */
export async function assertAiAllowed(tx: Tx): Promise<void> {
  if (!(await aiAllowed(tx))) throw new DomainError('platform.errors.aiCap');
}

/** Records what one piece of AI work used (one row; nothing when Claude was not called). Returns its cost. */
export async function recordAiUsage(
  tx: Tx,
  orgId: string,
  feature: AiFeature,
  usage: readonly ClaudeUsage[],
): Promise<number> {
  if (usage.length === 0) return 0;
  const sum = (k: keyof Omit<ClaudeUsage, 'model'>) => usage.reduce((n, u) => n + u[k], 0);
  const cost = usage.reduce((n, u) => n + aiCostMicros(u), 0);
  const models = [...new Set(usage.map((u) => u.model))].join(',');
  await tx.insert(schema.aiUsage).values({
    organizationId: orgId,
    feature,
    model: models,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    costMicros: cost,
  });
  return cost;
}
