/**
 * What each call to Claude used (SaaS stage 6). The Claude adapters report every response's usage here, and the caller
 * that wraps a piece of work in `collectUsage` gets the list back to record against the school's monthly allowance.
 * Outside `collectUsage` the report goes nowhere, so the adapters work the same without it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeUsage } from '@rswim/contracts';

const store = new AsyncLocalStorage<ClaudeUsage[]>();

/** Runs `fn`, adding every Claude call made inside it to `into`, which keeps them even when `fn` throws. */
export function trackUsage<T>(into: ClaudeUsage[], fn: () => Promise<T>): Promise<T> {
  return store.run(into, fn);
}

/** Runs `fn` and returns its result with every Claude call made inside it. */
export async function collectUsage<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: ClaudeUsage[] }> {
  const usage: ClaudeUsage[] = [];
  const result = await trackUsage(usage, fn);
  return { result, usage };
}

/** Adds one response's usage to the surrounding `collectUsage`, if any. */
export function reportUsage(model: string, u: Anthropic.Usage | undefined): void {
  if (!u) return;
  store.getStore()?.push({
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  });
}
