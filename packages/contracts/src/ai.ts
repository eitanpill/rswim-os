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
 * How strong a model the owner wants behind the work that talks: the bot (families, leads, divers) and her own
 * assistant. A stronger level answers better and uses the month's allowance faster. Sorting messages, the morning
 * notes and naming import columns keep their own model whatever the level.
 */
export const AI_LEVELS = ['frugal', 'balanced', 'smart'] as const;
export const AiLevel = z.enum(AI_LEVELS);
export type AiLevel = z.infer<typeof AiLevel>;
export const AI_DEFAULT_LEVEL: AiLevel = 'balanced';

/** The features the owner's level decides. */
export const AI_LEVELED_FEATURES: readonly AiFeature[] = ['copilot', 'parent_bot'];

export const AI_LEVEL_MODEL: Record<AiLevel, string> = {
  frugal: 'claude-haiku-5-5',
  balanced: 'claude-sonnet-5-5',
  smart: 'claude-opus-5-5',
};

/**
 * What one piece of leveled work takes from the monthly allowance, in tenths of an AI action. The plans' allowances
 * were sized for the strong model, so it stays a whole action and the cheaper levels stretch the same allowance.
 */
export const AI_LEVEL_TENTHS: Record<AiLevel, number> = { frugal: 1, balanced: 5, smart: 10 };

/** The model a feature runs on at the owner's level. */
export function aiModelFor(feature: AiFeature, level: AiLevel): string {
  return AI_LEVELED_FEATURES.includes(feature) ? AI_LEVEL_MODEL[level] : AI_MODEL_FOR[feature];
}

/**
 * Tenths of an AI action for one recorded piece of work. Work outside the leveled features, and a model the levels do
 * not know (or several models in one piece of work), counts as a whole action.
 */
export function aiActionTenths(feature: AiFeature, model: string): number {
  if (!AI_LEVELED_FEATURES.includes(feature)) return 10;
  const level = AI_LEVELS.find((l) => AI_LEVEL_MODEL[l] === model);
  return level ? AI_LEVEL_TENTHS[level] : 10;
}

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
