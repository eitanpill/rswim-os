import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeTriageClassifier,
  FakeMessagingProvider,
  GhlApiError,
  GhlMessagingProvider,
} from '../src';

const ctx = { organizationId: 'org', idempotencyKey: 'msg-1' };
const msg = { toPhoneE164: '+972501234567', text: 'שלום', locale: 'he' as const };

describe('FakeMessagingProvider', () => {
  it('sends once per idempotency key and fails on demand', async () => {
    const p = new FakeMessagingProvider();
    const a = await p.send(ctx, msg);
    expect(await p.send(ctx, msg)).toEqual(a);
    expect(p.sent).toHaveLength(1);
    await expect(
      p.send({ ...ctx, idempotencyKey: 'x' }, { ...msg, toPhoneE164: '+972500000000' }),
    ).rejects.toThrow();
    p.failNext = 1;
    await expect(p.send({ ...ctx, idempotencyKey: 'y' }, msg)).rejects.toThrow();
    await expect(p.send({ ...ctx, idempotencyKey: 'y' }, msg)).resolves.toBeTruthy();
  });
});

describe('GhlMessagingProvider', () => {
  it('upserts the contact by phone, then sends WhatsApp', async () => {
    const requests: { url: string; body: unknown; key: string | null }[] = [];
    const replies = [
      { contact: { id: 'c1' } },
      { messageId: 'm1' },
      { contact: { id: 'c1' } },
      { messageId: 'm2' },
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)),
        key: new Headers(init.headers).get('Idempotency-Key'),
      });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new GhlMessagingProvider({ token: 't', locationId: 'l', fetch: fetchImpl });
    expect(await p.send(ctx, { ...msg, template: { id: 'tpl', variables: {} } })).toEqual({
      providerMessageId: 'm1',
    });
    expect(requests.map((r) => r.url.split('.com')[1])).toEqual([
      '/contacts/upsert',
      '/conversations/messages',
    ]);
    expect(requests[1]).toMatchObject({
      body: { type: 'WhatsApp', contactId: 'c1', message: 'שלום', templateId: 'tpl' },
      key: 'msg-1',
    });
    await p.send(ctx, msg);
    expect(requests[3]?.body).not.toHaveProperty('templateId');
  });
  it('raises API errors', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const p = new GhlMessagingProvider({ token: 't', locationId: 'l', fetch: fetchImpl });
    await expect(p.send(ctx, msg)).rejects.toBeInstanceOf(GhlApiError);
    expect(new GhlMessagingProvider({ token: 't', locationId: 'l' })).toBeInstanceOf(
      GhlMessagingProvider,
    );
  });
});

describe('ClaudeTriageClassifier', () => {
  const input = {
    text: 'דניאל לא יגיע היום',
    today: '2026-10-07',
    known: true,
    isStaff: false,
    students: [{ id: 's1', firstName: 'דניאל' }],
    intents: ['absence_notice', 'personal_other'],
  };
  const fake = (response: unknown) => {
    const calls: unknown[] = [];
    const client = { messages: { create: async (p: unknown) => (calls.push(p), response) } };
    return { calls, client: client as unknown as Anthropic };
  };

  it('asks for a JSON verdict and returns it', async () => {
    const verdict = {
      intent: 'absence_notice',
      confidence: 95,
      studentIds: ['s1'],
      date: '2026-10-07',
      signals: [],
    };
    const { calls, client } = fake({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(verdict) }],
    });
    const c = new ClaudeTriageClassifier({ client });
    expect(c.name).toBe('claude:claude-opus-5-5');
    expect(await c.classify(input)).toEqual(verdict);
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { format: { type: 'json_schema' } },
    });
  });

  it('returns null on a refusal, no text or bad JSON', async () => {
    for (const response of [
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'end_turn', content: [] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] },
    ]) {
      expect(
        await new ClaudeTriageClassifier({ client: fake(response).client }).classify(input),
      ).toBeNull();
    }
    expect(new ClaudeTriageClassifier({ apiKey: 'k', model: 'm' }).name).toBe('claude:m');
  });
});
