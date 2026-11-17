import { describe, expect, it } from 'vitest';
import { collectUsage, reportUsage } from '../src/usage';

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 2,
  cache_creation_input_tokens: null,
} as Parameters<typeof reportUsage>[1];

describe('collectUsage', () => {
  it('gathers every call made inside it, across awaits', async () => {
    const { result, usage: got } = await collectUsage(async () => {
      reportUsage('claude-haiku-5-5', usage);
      await new Promise((r) => setTimeout(r, 1));
      reportUsage('claude-opus-5-5', undefined);
      reportUsage('claude-opus-5-5', { ...usage, cache_read_input_tokens: null } as never);
      return 'done';
    });
    expect(result).toBe('done');
    expect(got).toEqual([
      {
        model: 'claude-haiku-5-5',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
      },
      {
        model: 'claude-opus-5-5',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
  });

  it('drops a report made outside it', () => {
    expect(() => reportUsage('claude-haiku-5-5', usage)).not.toThrow();
  });
});
