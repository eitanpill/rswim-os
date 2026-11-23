import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeTriageClassifier,
  FakeMessagingProvider,
  FakeWhatsAppAdmin,
  MetaWhatsAppAdmin,
  GhlApiError,
  GhlMessagingProvider,
  MetaApiError,
  MetaCloudMessagingProvider,
  signMetaBody,
  verifyMetaSignature,
} from '../src';

const ctx = { organizationId: 'org', idempotencyKey: 'msg-1' };
const msg = { toPhoneE164: '+972501234567', text: 'שלום', locale: 'he' as const };

describe('FakeMessagingProvider', () => {
  it('sends once per idempotency key and fails on demand', async () => {
    expect(new FakeMessagingProvider(true).window).toBe(true);
    const p = new FakeMessagingProvider();
    expect(p.window).toBe(false);
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

describe('MetaCloudMessagingProvider', () => {
  const capture = (reply: unknown, status = 200) => {
    const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('Authorization'),
      });
      return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
    }) as unknown as typeof fetch;
    return { requests, fetchImpl };
  };
  it('sends free text, and a template by name with its values in order', async () => {
    const { requests, fetchImpl } = capture({ messages: [{ id: 'wamid.1' }] });
    const p = new MetaCloudMessagingProvider({
      phoneNumberId: '1234567',
      accessToken: 'token',
      fetch: fetchImpl,
    });
    expect(p.window).toBe(true);
    expect(await p.send(ctx, msg)).toEqual({ providerMessageId: 'wamid.1' });
    expect(requests[0]).toMatchObject({
      url: 'https://graph.facebook.com/v21.0/1234567/messages',
      auth: 'Bearer token',
      body: { to: '972501234567', type: 'text', text: { body: 'שלום' } },
    });
    await p.send(ctx, {
      ...msg,
      template: { id: 'trial_reminder_v1', variables: {}, values: ['דנה', '21/11'] },
    });
    expect(requests[1]?.body).toMatchObject({
      type: 'template',
      template: {
        name: 'trial_reminder_v1',
        language: { code: 'he' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'דנה' },
              { type: 'text', text: '21/11' },
            ],
          },
        ],
      },
    });
    await p.send(ctx, { ...msg, text: undefined, template: { id: 'hello', variables: {} } });
    expect(requests[2]?.body).toMatchObject({ template: { components: [] } });
    await p.send(ctx, { ...msg, text: undefined });
    expect(requests[3]?.body).toMatchObject({ text: { body: '' } });
  });
  it('raises errors and answers without an id', async () => {
    const bad = capture('{"error":{"message":"bad"}}', 400);
    await expect(
      new MetaCloudMessagingProvider({
        phoneNumberId: '1',
        accessToken: 't',
        fetch: bad.fetchImpl,
      }).send(ctx, msg),
    ).rejects.toBeInstanceOf(MetaApiError);
    const empty = capture({});
    await expect(
      new MetaCloudMessagingProvider({
        phoneNumberId: '1',
        accessToken: 't',
        fetch: empty.fetchImpl,
      }).send(ctx, msg),
    ).rejects.toThrow(/Meta Cloud API 200/);
    expect(new MetaCloudMessagingProvider({ phoneNumberId: '1', accessToken: 't' })).toBeTruthy();
  });
  it("checks Meta's signature", () => {
    const secret = 'a'.repeat(32);
    const sig = signMetaBody('{"x":1}', secret);
    expect(verifyMetaSignature('{"x":1}', sig, secret)).toBe(true);
    expect(verifyMetaSignature('{"x":2}', sig, secret)).toBe(false);
    expect(verifyMetaSignature('{"x":1}', sig, 'b'.repeat(32))).toBe(false);
    expect(verifyMetaSignature('{"x":1}', 'sha1=abc', secret)).toBe(false);
    expect(verifyMetaSignature('{"x":1}', null, secret)).toBe(false);
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
    expect(c.name).toBe('claude:claude-haiku-5-5');
    expect(await c.classify(input)).toEqual(verdict);
    expect(calls[0]).toMatchObject({
      model: 'claude-haiku-5-5',
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

describe('MetaWhatsAppAdmin', () => {
  const capture = (replies: unknown[], status = 200) => {
    const requests: { url: string; method: string; body: unknown; type: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        method: String(init.method),
        body: init.body ? JSON.parse(String(init.body)) : null,
        type: new Headers(init.headers).get('Content-Type'),
      });
      const reply = replies.shift();
      return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
    }) as unknown as typeof fetch;
    return { requests, fetchImpl };
  };
  const admin = (fetchImpl: typeof fetch) =>
    new MetaWhatsAppAdmin({
      phoneNumberId: '1000001',
      businessAccountId: '2000001',
      accessToken: 'token',
      fetch: fetchImpl,
    });

  it('reads the number, with nulls for what Meta leaves out', async () => {
    const { requests, fetchImpl } = capture([
      {
        display_phone_number: '+972 50-123-4567',
        verified_name: 'Demo Swim',
        quality_rating: 'GREEN',
      },
      { id: '1000001', verified_name: '' },
    ]);
    const a = admin(fetchImpl);
    expect(await a.number()).toEqual({
      displayPhone: '+972 50-123-4567',
      verifiedName: 'Demo Swim',
      quality: 'GREEN',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/1000001?fields=display_phone_number,verified_name,quality_rating',
      method: 'GET',
      body: null,
      type: null,
    });
    expect(await a.number()).toEqual({ displayPhone: null, verifiedName: null, quality: null });
  });

  it('subscribes the app to the business account, then points it at our webhook address', async () => {
    const { requests, fetchImpl } = capture([
      { success: true },
      { success: true },
      { success: false },
      { success: true },
      { success: false },
    ]);
    const a = admin(fetchImpl);
    await a.subscribe('https://app.test/api/webhooks/whatsapp/c1', 'verify');
    expect(requests[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/2000001/subscribed_apps',
      method: 'POST',
      body: null,
      type: null,
    });
    expect(requests[1]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/2000001/subscribed_apps',
      method: 'POST',
      type: 'application/json',
      body: {
        override_callback_uri: 'https://app.test/api/webhooks/whatsapp/c1',
        verify_token: 'verify',
      },
    });
    await expect(a.subscribe('https://app.test/x', 'verify')).rejects.toBeInstanceOf(MetaApiError);
    await expect(a.subscribe('https://app.test/x', 'verify')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('registers the number on the Cloud API with its PIN', async () => {
    const { requests, fetchImpl } = capture([{ success: true }, { success: false }]);
    const a = admin(fetchImpl);
    await a.register('123456');
    expect(requests[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/1000001/register',
      method: 'POST',
      type: 'application/json',
      body: { messaging_product: 'whatsapp', pin: '123456' },
    });
    await expect(a.register('123456')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('creates a utility template with its examples, and one without placeholders', async () => {
    const { requests, fetchImpl } = capture([{ id: '900', status: 'PENDING' }, {}]);
    const a = admin(fetchImpl);
    const draft = {
      name: 'trial_he_ab12',
      language: 'he' as const,
      text: 'היי {{1}}, נתראה {{2}}.',
    };
    expect(await a.createTemplate({ ...draft, examples: ['דנה', '21.11'] })).toEqual({
      id: '900',
      name: 'trial_he_ab12',
      language: 'he',
      status: 'PENDING',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/2000001/message_templates',
      body: {
        name: 'trial_he_ab12',
        language: 'he',
        category: 'utility',
        parameter_format: 'positional',
        components: [
          {
            type: 'body',
            text: 'היי {{1}}, נתראה {{2}}.',
            example: { body_text: [['דנה', '21.11']] },
          },
        ],
      },
    });
    expect(await a.createTemplate({ ...draft, text: 'שלום', examples: [] })).toMatchObject({
      id: null,
      status: 'PENDING',
    });
    expect(requests[1]?.body).toMatchObject({ components: [{ type: 'body', text: 'שלום' }] });
    expect(
      (requests[1]?.body as { components: Record<string, unknown>[] }).components[0],
    ).not.toHaveProperty('example');
  });

  it('lists templates with their status, skipping rows it cannot read', async () => {
    const { requests, fetchImpl } = capture([
      {
        data: [
          { id: '900', name: 'a', language: 'he', status: 'APPROVED' },
          { name: 'b', language: 'en', status: 'REJECTED' },
          { name: 'broken' },
        ],
      },
      { paging: {} },
    ]);
    const a = admin(fetchImpl);
    expect(await a.templates()).toEqual([
      { id: '900', name: 'a', language: 'he', status: 'APPROVED' },
      { id: null, name: 'b', language: 'en', status: 'REJECTED' },
    ]);
    expect(requests[0]?.url).toContain('/2000001/message_templates?fields=id,name,language,status');
    expect(await a.templates()).toEqual([]);
  });

  it("raises Meta's refusal and an unreadable answer", async () => {
    const refused = capture(['{"error":{"message":"Invalid OAuth access token"}}'], 401);
    await expect(admin(refused.fetchImpl).number()).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('Invalid OAuth'),
    });
    const garbage = capture(['<html>']);
    await expect(admin(garbage.fetchImpl).templates()).rejects.toBeInstanceOf(MetaApiError);
    const plain = new MetaWhatsAppAdmin({
      phoneNumberId: '1',
      businessAccountId: '2',
      accessToken: 't',
      baseUrl: 'http://127.0.0.1:9',
      apiVersion: 'v27.0',
    });
    await expect(plain.number()).rejects.toThrow();
  });
});

describe('FakeWhatsAppAdmin', () => {
  it('keeps templates waiting until the review, and refuses a duplicate name', async () => {
    const a = new FakeWhatsAppAdmin({ phoneNumberId: '1000001', businessAccountId: '2000001' });
    expect(await a.number()).toMatchObject({ verifiedName: 'Demo Business', quality: 'GREEN' });
    await a.subscribe('https://app.test/hook', 'verify');
    expect(a.subscriptions).toEqual([
      { callbackUrl: 'https://app.test/hook', verifyToken: 'verify' },
    ]);
    const draft = { language: 'he' as const, text: 'שלום {{1}}', examples: ['דנה'] };
    expect(await a.createTemplate({ ...draft, name: 'one' })).toMatchObject({ status: 'PENDING' });
    await a.createTemplate({ ...draft, name: 'two' });
    await expect(a.createTemplate({ ...draft, name: 'one' })).rejects.toBeInstanceOf(MetaApiError);
    a.review(['two']);
    a.review();
    expect(await a.templates()).toEqual([
      { id: 'tpl_1', name: 'one', language: 'he', status: 'APPROVED' },
      { id: 'tpl_2', name: 'two', language: 'he', status: 'REJECTED' },
    ]);
  });

  it('refuses everything for a business account marked to fail', async () => {
    const a = new FakeWhatsAppAdmin({ phoneNumberId: '1', businessAccountId: '20000000' });
    await expect(a.number()).rejects.toBeInstanceOf(MetaApiError);
    await expect(a.subscribe('u', 'v')).rejects.toBeInstanceOf(MetaApiError);
    await expect(a.register('123456')).rejects.toBeInstanceOf(MetaApiError);
    await expect(
      a.createTemplate({ name: 'n', language: 'he', text: 't', examples: [] }),
    ).rejects.toBeInstanceOf(MetaApiError);
    await expect(a.templates()).rejects.toBeInstanceOf(MetaApiError);
  });
});
