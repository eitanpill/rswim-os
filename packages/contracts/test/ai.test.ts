import { describe, expect, it } from 'vitest';
import { AI_FEATURES, AI_MODEL_FOR, CLAUDE_PRICES, aiCostMicros } from '../src/ai';

describe('Claude cost', () => {
  it('prices a call by its model, in micro-dollars rounded up', () => {
    expect(
      aiCostMicros({
        model: 'claude-haiku-5-5',
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(200);
    expect(
      aiCostMicros({
        model: 'claude-opus-5-5',
        inputTokens: 10_000,
        outputTokens: 1_000,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 1_000,
      }),
    ).toBe(40_000 + 20_000 + 1_000 + 5_000);
    expect(
      aiCostMicros({
        model: 'claude-haiku-5-5',
        inputTokens: 3,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(1);
  });

  it('counts a model it does not know at the most expensive rate', () => {
    const u = { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(aiCostMicros({ ...u, model: 'claude-new' })).toBe(
      aiCostMicros({ ...u, model: 'claude-opus-5-5' }),
    );
  });

  it('runs every feature on a priced model', () => {
    for (const f of AI_FEATURES) expect(CLAUDE_PRICES[AI_MODEL_FOR[f]]).toBeDefined();
  });
});
