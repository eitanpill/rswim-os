import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeInsightWriter, type InsightForNote } from '../src/insights';

const fake = (response: unknown) => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (p: Record<string, unknown>) => {
        calls.push(p);
        return response;
      },
    },
  };
  return { calls, client: client as unknown as Anthropic };
};

const insights: InsightForNote[] = [
  {
    id: 'i1',
    kind: 'churn_risk',
    severity: 'high',
    params: { count: 1, names: 'משפחת דמו' },
    detail: [{ household: 'משפחת דמו', absencesInARow: 3 }],
  },
  { id: 'i2', kind: 'leaving', severity: 'medium', params: { count: 1 }, detail: [] },
];

const answer = (text: string, stop = 'end_turn') => ({
  stop_reason: stop,
  content: [{ type: 'text', text }],
});

describe('ClaudeInsightWriter', () => {
  it('sends the facts in one call and keeps the notes for the insights it was given', async () => {
    const { calls, client } = fake(
      answer(
        JSON.stringify({
          notes: [
            { id: 'i1', explanation: 'הילד החסיר שלושה שיעורים ברצף.', recommendation: 'להתקשר.' },
            { id: 'i2', explanation: ' ', recommendation: 'x' },
            { id: 'zz', explanation: 'לא קיים', recommendation: 'x' },
          ],
        }),
      ),
    );
    const w = new ClaudeInsightWriter({ client });
    expect(w.name).toBe('claude:claude-opus-5-5');
    const out = await w.write({ today: '2026-10-08', insights });
    expect(out).toEqual([
      { id: 'i1', explanation: 'הילד החסיר שלושה שיעורים ברצף.', recommendation: 'להתקשר.' },
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0]!.messages as { content: string }[])[0]!.content)).toMatchObject({
      today: '2026-10-08',
      insights: [{ id: 'i1' }, { id: 'i2' }],
    });
  });

  it('returns nothing for an empty feed, a cut-off answer, no text or bad JSON', async () => {
    const empty = fake(answer('{}'));
    expect(
      await new ClaudeInsightWriter({ client: empty.client }).write({ today: 'd', insights: [] }),
    ).toEqual([]);
    expect(empty.calls).toHaveLength(0);
    for (const r of [
      answer('{"notes":[]}', 'max_tokens'),
      { stop_reason: 'end_turn', content: [] },
      answer('not json'),
      answer('{}'),
    ]) {
      expect(
        await new ClaudeInsightWriter({ client: fake(r).client }).write({ today: 'd', insights }),
      ).toEqual([]);
    }
    expect(new ClaudeInsightWriter({ apiKey: 'k', model: 'm' }).name).toBe('claude:m');
  });
});
