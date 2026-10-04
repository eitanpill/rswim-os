import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { allContacts, FakeGhlClient, GhlApiError, HttpGhlClient, verifyGhlSignature } from '../src';

const ctx = { organizationId: 'org', idempotencyKey: 'k' };

/** A fetch double that records requests and replays canned responses (recorded shapes, fake data). */
function recorder(responses: { status?: number; body: unknown }[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe('HttpGhlClient', () => {
  it('pages through /contacts/search with the searchAfter cursor', async () => {
    const { requests, fetchImpl } = recorder([
      {
        body: {
          contacts: [
            { id: 'a', searchAfter: [1, 'a'] },
            { id: 'b', searchAfter: [2, 'b'] },
          ],
        },
      },
      { body: { contacts: [{ id: 'c', searchAfter: [3, 'c'] }] } },
    ]);
    const client = new HttpGhlClient({
      token: 't0k',
      locationId: 'loc-1',
      fetch: fetchImpl,
      baseUrl: 'https://ghl.test',
    });
    const ids: string[] = [];
    for await (const c of allContacts(client, ctx, 2)) ids.push(c.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(requests.map((r) => [r.url, JSON.parse(String(r.init.body))])).toEqual([
      [
        'https://ghl.test/contacts/search',
        { locationId: 'loc-1', pageLimit: 2, sort: [{ field: 'dateAdded', direction: 'asc' }] },
      ],
      [
        'https://ghl.test/contacts/search',
        {
          locationId: 'loc-1',
          pageLimit: 2,
          sort: [{ field: 'dateAdded', direction: 'asc' }],
          searchAfter: [2, 'b'],
        },
      ],
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer t0k',
      Version: '2021-07-28',
    });
  });

  it('stops when a full page has no cursor', async () => {
    const { fetchImpl } = recorder([{ body: { contacts: [{ id: 'a' }] } }]);
    const page = await new HttpGhlClient({
      token: 't',
      locationId: 'l',
      fetch: fetchImpl,
    }).searchContacts(ctx, null, 1);
    expect(page.next).toBeNull();
  });

  it('upserts new contacts and updates linked ones by id', async () => {
    const { requests, fetchImpl } = recorder([
      { body: { contact: { id: 'new-1' } } },
      { body: { contact: { id: 'x-1' } } },
    ]);
    const client = new HttpGhlClient({ token: 't', locationId: 'loc', fetch: fetchImpl });
    expect(
      await client.upsertContact(ctx, {
        firstName: 'א',
        lastName: 'ב',
        phoneE164: '+972500000001',
        email: 'a@b.test',
        tags: ['x'],
        customFields: {},
      }),
    ).toEqual({ externalId: 'new-1' });
    expect(
      await client.upsertContact(ctx, {
        externalId: 'x-1',
        firstName: 'א',
        lastName: 'ב',
        tags: [],
        customFields: {},
      }),
    ).toEqual({
      externalId: 'x-1',
    });
    expect(requests.map((r) => [r.init.method, r.url, JSON.parse(String(r.init.body))])).toEqual([
      [
        'POST',
        'https://services.leadconnectorhq.com/contacts/upsert',
        {
          locationId: 'loc',
          firstName: 'א',
          lastName: 'ב',
          phone: '+972500000001',
          email: 'a@b.test',
          tags: ['x'],
        },
      ],
      [
        'PUT',
        'https://services.leadconnectorhq.com/contacts/x-1',
        { firstName: 'א', lastName: 'ב' },
      ],
    ]);
  });

  it('raises the status and body on API errors', async () => {
    const { fetchImpl } = recorder([{ status: 422, body: { message: 'bad phone' } }]);
    const client = new HttpGhlClient({ token: 't', locationId: 'l', fetch: fetchImpl });
    const err = await client.searchContacts(ctx, null, 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GhlApiError);
    expect(err).toMatchObject({ status: 422 });
  });

  it('moves an opportunity with /opportunities/upsert', async () => {
    const { requests, fetchImpl } = recorder([{ body: { opportunity: { id: 'o1' } } }]);
    const client = new HttpGhlClient({ token: 't', locationId: 'l', fetch: fetchImpl });
    await client.moveOpportunity(ctx, { contactExternalId: 'c1', pipelineId: 'p1', stageId: 's1' });
    expect(requests[0]?.url).toBe('https://services.leadconnectorhq.com/opportunities/upsert');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      locationId: 'l',
      contactId: 'c1',
      pipelineId: 'p1',
      pipelineStageId: 's1',
      status: 'open',
    });
  });

  it('defaults to the global fetch', () => {
    expect(new HttpGhlClient({ token: 't', locationId: 'l' })).toBeInstanceOf(HttpGhlClient);
  });
});

describe('FakeGhlClient', () => {
  it('pages, upserts by id or phone, and records calls', async () => {
    const fake = new FakeGhlClient([
      { id: 'a', firstName: 'א', phone: '+972500000001', tags: ['t'] },
      { id: 'b', firstName: 'ב' },
      { id: 'c', firstName: 'ג' },
    ]);
    const ids: string[] = [];
    for await (const c of allContacts(fake, ctx, 2)) ids.push(c.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(
      await fake.upsertContact(ctx, {
        firstName: 'X',
        lastName: 'Y',
        phoneE164: '+972500000001',
        tags: [],
        customFields: {},
      }),
    ).toEqual({
      externalId: 'a',
    });
    expect(fake.contacts.get('a')).toMatchObject({ firstName: 'X', tags: ['t'] });
    expect(
      await fake.upsertContact(ctx, {
        externalId: 'b',
        firstName: 'B',
        lastName: '',
        email: 'b@x.test',
        tags: ['n'],
        customFields: {},
      }),
    ).toEqual({
      externalId: 'b',
    });
    expect(fake.contacts.get('b')).toMatchObject({ email: 'b@x.test', tags: ['n'], phone: null });
    expect(
      (await fake.upsertContact(ctx, { firstName: 'N', lastName: '', tags: [], customFields: {} }))
        .externalId,
    ).toBe('fake-ghl-1');
    expect(fake.calls).toHaveLength(3);
    const move = { contactExternalId: 'c', pipelineId: 'p', stageId: 's' };
    await fake.moveOpportunity(ctx, move);
    await fake.moveOpportunity(ctx, move);
    expect(fake.moves).toHaveLength(1);
    expect(new FakeGhlClient().contacts.size).toBe(0);
  });
});

describe('verifyGhlSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = JSON.stringify({ type: 'ContactUpdate', id: 'c-1' });
  const good = sign('sha256', Buffer.from(body), privateKey).toString('base64');

  it('accepts a valid signature and rejects tampering, missing signatures and bad keys', () => {
    expect(verifyGhlSignature(body, good, pem)).toBe(true);
    expect(verifyGhlSignature(`${body} `, good, pem)).toBe(false);
    expect(verifyGhlSignature(body, null, pem)).toBe(false);
    expect(verifyGhlSignature(body, good, 'not a key')).toBe(false);
  });
});
