import { describe, expect, it } from 'vitest';
import {
  AI_DEFAULT_LEVEL,
  AI_FEATURES,
  AI_LEVELS,
  AI_LEVEL_MODEL,
  AI_MODEL_FOR,
  CLAUDE_PRICES,
  aiActionTenths,
  aiCostMicros,
  aiModelFor,
} from '../src/ai';

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

  it('the level the owner picks decides the model of the bot and the assistant only', () => {
    expect(AI_DEFAULT_LEVEL).toBe('balanced');
    expect(AI_LEVELS.map((l) => aiModelFor('parent_bot', l))).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ]);
    expect(aiModelFor('copilot', 'smart')).toBe('claude-opus-5-5');
    expect(aiModelFor('triage', 'smart')).toBe(AI_MODEL_FOR.triage);
    for (const l of AI_LEVELS) expect(CLAUDE_PRICES[AI_LEVEL_MODEL[l]]).toBeDefined();
  });

  it('a cheaper level takes less of the allowance; everything else is a whole action', () => {
    expect(aiActionTenths('parent_bot', 'claude-haiku-5-5')).toBe(1);
    expect(aiActionTenths('copilot', 'claude-sonnet-5-5')).toBe(5);
    expect(aiActionTenths('copilot', 'claude-opus-5-5')).toBe(10);
    // Several models in one piece of work, or a model the levels do not know.
    expect(aiActionTenths('parent_bot', 'claude-haiku-5-5,claude-opus-5-5')).toBe(10);
    // Sorting a message runs on the small model and still counts as one action.
    expect(aiActionTenths('triage', 'claude-haiku-5-5')).toBe(10);
  });
});
