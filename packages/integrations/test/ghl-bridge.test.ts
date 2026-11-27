/** The GHL bridge's adapter: GHL's current webhook signature, reading a conversation, and the in-memory sub-account. */
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FakeGhlBridgeClient,
  GhlApiError,
  HttpGhlBridgeClient,
  toGhlChatMessage,
  verifyGhlEd25519,
  verifyGhlWebhook,
} from '../src/ghl';

const ed = generateKeyPairSync('ed25519');
const edPem = ed.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const body = JSON.stringify({ type: 'InboundMessage', messageId: 'm1' });
const edSig = sign(null, Buffer.from(body), ed.privateKey).toString('base64');
const rsaSig = sign('sha256', Buffer.from(body), rsa.privateKey).toString('base64');

describe('GHL webhook signatures', () => {
  it('accepts X-GHL-Signature (Ed25519) over the raw body and refuses a changed body', () => {
    expect(verifyGhlEd25519(body, edSig, edPem)).toBe(true);
    expect(verifyGhlEd25519(`${body} `, edSig, edPem)).toBe(false);
    expect(verifyGhlEd25519(body, null, edPem)).toBe(false);
    expect(verifyGhlEd25519(body, edSig, 'not a key')).toBe(false);
    // GHL's own published key does not take a signature of ours.
    expect(verifyGhlEd25519(body, edSig)).toBe(false);
  });

  it('prefers the current header and falls back to the legacy RSA one only with its key', () => {
    expect(
      verifyGhlWebhook(body, { ghlSignature: edSig, whSignature: null }, { ed25519: edPem }),
    ).toBe(true);
    expect(
      verifyGhlWebhook(body, { ghlSignature: null, whSignature: rsaSig }, { rsa: rsaPem }),
    ).toBe(true);
    expect(verifyGhlWebhook(body, { ghlSignature: null, whSignature: rsaSig }, {})).toBe(false);
    expect(verifyGhlWebhook(body, { ghlSignature: null, whSignature: rsaSig })).toBe(false);
    // With no key given, the current header is checked against GHL's published key.
    expect(verifyGhlWebhook(body, { ghlSignature: edSig, whSignature: null })).toBe(false);
    // A bad current signature is not saved by a good legacy one.
    expect(
      verifyGhlWebhook(
        body,
        { ghlSignature: 'AAAA', whSignature: rsaSig },
        { ed25519: edPem, rsa: rsaPem },
      ),
    ).toBe(false);
  });
});

describe('reading a GHL conversation', () => {
  it('places GHL messages and drops the ones it cannot', () => {
    expect(
      toGhlChatMessage({
        id: 'a',
        direction: 'inbound',
        messageType: 'TYPE_WHATSAPP',
        body: 'שלום',
        dateAdded: '2026-11-27T08:00:00Z',
      }),
    ).toEqual({
      id: 'a',
      direction: 'inbound',
      whatsapp: true,
      body: 'שלום',
      at: new Date('2026-11-27T08:00:00Z'),
      userId: null,
    });
    expect(
      toGhlChatMessage({
        id: 'b',
        direction: 'outbound',
        messageType: 'TYPE_SMS',
        dateAdded: '2026-11-27T08:00:00Z',
        userId: 'u',
      }),
    ).toMatchObject({ whatsapp: false, body: '', userId: 'u' });
    expect(
      toGhlChatMessage({
        id: 'c',
        direction: 'inbound',
        type: 'WhatsApp',
        dateAdded: '2026-11-27T08:00:00Z',
      })?.whatsapp,
    ).toBe(true);
    expect(
      toGhlChatMessage({ direction: 'inbound', dateAdded: '2026-11-27T08:00:00Z' }),
    ).toBeNull();
    expect(
      toGhlChatMessage({ id: 'd', direction: 'sideways', dateAdded: '2026-11-27T08:00:00Z' }),
    ).toBeNull();
    expect(toGhlChatMessage({ id: 'e', direction: 'inbound', dateAdded: 'soon' })).toBeNull();
    expect(toGhlChatMessage({ id: 'f', direction: 'inbound' })).toBeNull();
  });

  it('asks GHL with the token for the location, the contact and its conversation', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reply = (json: unknown, status = 200) =>
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/locations/'))
        return reply({ location: { id: 'loc123', name: 'בית ספר' } });
      if (url.includes('/contacts/c-other'))
        return reply({ contact: { phone: '+972500000001', locationId: 'zzz' } });
      if (url.includes('/contacts/'))
        return reply({ contact: { phone: '050-555-1234', locationId: 'loc123' } });
      if (url.includes('/conversations/search')) return reply({ conversations: [{ id: 'conv1' }] });
      if (url.includes('/conversations/conv1/messages'))
        return reply({
          messages: {
            messages: [
              {
                id: 'm1',
                direction: 'inbound',
                messageType: 'TYPE_WHATSAPP',
                body: 'א',
                dateAdded: '2026-11-27T08:00:00Z',
              },
              {
                id: 'm2',
                direction: 'outbound',
                messageType: 'TYPE_WHATSAPP',
                body: 'ב',
                dateAdded: '2026-11-27T08:01:00Z',
              },
              { direction: 'inbound' },
            ],
          },
        });
      return reply({ message: 'nope' }, 401);
    }) as unknown as typeof fetch;
    const client = new HttpGhlBridgeClient({
      token: 'pit-token',
      locationId: 'loc123',
      fetch: fetchImpl,
    });
    expect(await client.location()).toEqual({ id: 'loc123', name: 'בית ספר' });
    expect(await client.contactPhone('c1')).toBe('050-555-1234');
    expect(await client.contactPhone('c-other')).toBeNull();
    const list = await client.recentMessages('c1');
    expect(list.map((m) => m.id)).toEqual(['m2', 'm1']);
    const search = calls.find((c) => c.url.includes('/conversations/search'));
    expect(search?.url).toContain('contactId=c1');
    expect(search?.url).toContain('locationId=loc123');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer pit-token',
    );
  });

  it('copes with GHL leaving fields out, and with messages as a bare list', async () => {
    let n = 0;
    const fetchImpl = (async (url: string) => {
      const json = url.includes('/conversations/search')
        ? n++ === 0
          ? {}
          : { conversations: [{ id: 'a' }, { id: 'b' }] }
        : url.includes('/conversations/a/')
          ? {
              messages: [
                {
                  id: 'x',
                  direction: 'inbound',
                  type: 'WhatsApp',
                  dateAdded: '2026-11-27T08:00:00Z',
                },
              ],
            }
          : {};
      return new Response(JSON.stringify(json), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new HttpGhlBridgeClient({ token: 'x', locationId: 'loc123', fetch: fetchImpl });
    expect(await client.location()).toEqual({ id: 'loc123', name: '' });
    expect(await client.contactPhone('c1')).toBeNull();
    expect(await client.recentMessages('c1')).toEqual([]);
    expect((await client.recentMessages('c1')).map((m) => m.id)).toEqual(['x']);
    // Without a fetch of its own it uses the platform's.
    expect(new HttpGhlBridgeClient({ token: 'x', locationId: 'loc123' })).toBeInstanceOf(
      HttpGhlBridgeClient,
    );
  });

  it('turns GHL’s refusal into an error that says why', async () => {
    const fetchImpl = (async () =>
      new Response('{"message":"Invalid JWT"}', { status: 401 })) as unknown as typeof fetch;
    const client = new HttpGhlBridgeClient({ token: 'x', locationId: 'loc123', fetch: fetchImpl });
    await expect(client.location()).rejects.toBeInstanceOf(GhlApiError);
  });

  it('keeps an in-memory sub-account for demos and tests', async () => {
    const fake = new FakeGhlBridgeClient('loc-fake');
    expect((await fake.location()).id).toBe('loc-fake');
    await expect(new FakeGhlBridgeClient('bad-loc').location()).rejects.toBeInstanceOf(GhlApiError);
    fake.add('c1', '+972500000002', {
      id: 'x1',
      direction: 'inbound',
      body: 'hi',
      at: new Date(1000),
      userId: null,
    });
    fake.add('c1', '+972500000002', {
      id: 'x2',
      direction: 'outbound',
      body: 'yo',
      at: new Date(2000),
      userId: null,
    });
    expect(await fake.contactPhone('c1')).toBe('+972500000002');
    expect(await fake.contactPhone('c2')).toBeNull();
    expect((await fake.recentMessages('c1', 1)).map((m) => m.id)).toEqual(['x2']);
    expect(await fake.recentMessages('c2')).toEqual([]);
  });
});
