/**
 * Claude in the product (SaaS stage 6): which model each feature runs on, what a call costs, and the features a
 * school's monthly AI allowance covers. Decision 8 (docs/saas/DECISIONS.md): simple tasks on the small model,
 * important ones on the strong model; the cost is part of the plan, with a monthly cap per plan.
 */
import { z } from 'zod';

export const AI_FEATURES = [
  'copilot',
  'parent_bot',
  'triage',
  'insights',
  'import_columns',
] as const;
export const AiFeature = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof AiFeature>;

/** The model behind each feature. */
export const AI_MODEL_FOR: Record<AiFeature, string> = {
  // The owner's assistant and the parents' bot act on the school's data: the strong model.
  copilot: 'claude-opus-5-5',
  parent_bot: 'claude-opus-5-5',
  // Notes the owner reads every morning: the balanced model.
  insights: 'claude-sonnet-5-5',
  // Sorting an inbound message and naming a spreadsheet column: the small model.
  triage: 'claude-haiku-5-5',
  import_columns: 'claude-haiku-5-5',
};

/**
 * USD per million tokens, from Anthropic's pricing page (checked 2026-11-17; prompts up to 100K tokens). Cache writes
 * are the 5-minute rate, 1.25 × input. A model not listed is priced as the most expensive one, so a new model never
 * goes uncounted.
 */
export const CLAUDE_PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  // The pricing note gives no cache-read rate for this model: it is counted at the input rate.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.1, cacheWrite: 0.125 },
};
const FALLBACK_PRICE = CLAUDE_PRICES['claude-opus-5-5'] as (typeof CLAUDE_PRICES)[string];

/** What one call to Claude used, as the API reports it. */
export interface ClaudeUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** A call's cost in millionths of a dollar, rounded up. */
export function aiCostMicros(u: ClaudeUsage): number {
  const p = CLAUDE_PRICES[u.model] ?? FALLBACK_PRICE;
  // USD per million tokens × tokens = micro-dollars.
  return Math.ceil(
    p.input * u.inputTokens +
      p.output * u.outputTokens +
      p.cacheRead * u.cacheReadTokens +
      p.cacheWrite * u.cacheWriteTokens,
  );
}

/** Share of the monthly allowance at which the owner is told it is running out. */
export const AI_WARN_PERCENT = 80;
