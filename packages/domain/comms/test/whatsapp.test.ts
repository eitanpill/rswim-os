/**
 * The business's own WhatsApp number on Meta's Cloud API (WhatsApp track W5), against a real database with RLS:
 * 1. the owner connects the number; its token and app secret are sealed and only the system role opens them;
 * 2. Meta's webhook is checked against the app secret: a forged one changes nothing, a real one brings the message
 *    into the inbox once (a redelivery is a duplicate) and the receipts onto our message;
 * 3. inside the 24-hour window free text goes out; outside it the approved Meta template goes with its values, or the
 *    message is blocked when the business has none.
 * Every phone, token and secret is fake.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { createDataKey, DomainError, type ServiceContext } from '@rswim/domain-core';
import { FakeMessagingProvider, signMetaBody } from '@rswim/integrations';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  dispatchDue,
  enqueueMessage,
  ingestMetaWebhook,
  israelInstant,
  loadWhatsApp,
  metaSubscriptionCheck,
  setMetaTemplate,
  whatsappConnection,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let guardianId: string;
let householdId: string;
const PHONE = '+972501234567';
const SECRET = randomBytes(16).toString('hex');
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(t.db, ctx.orgId, fn);
const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);

const MONDAY_9 = israelInstant('2026-10-12', '09:00');
const MONDAY_10 = israelInstant('2026-10-12', '10:00');
const THURSDAY_10 = israelInstant('2026-10-15', '10:00');

const webhook = (parts: { messages?: unknown[]; statuses?: unknown[] }) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '2000001',
        changes: [
          {
            field: 'messages',
            value: { metadata: { phone_number_id: '1000001' }, ...parts },
          },
        ],
      },
    ],
  });

beforeAll(async () => {
  t = await createTestDatabase();
  const master = Buffer.alloc(32, 7);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  const [org] = await q(
    `insert into organizations (slug, name) values ('wa', 'בית ספר וואטסאפ (דמו)') returning id`,
  );
  await q(`insert into org_settings (organization_id) values ($1)`, [org.id]);
  await q(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
    org.id,
    createDataKey(master, org.id).wrapped,
  ]);
  const [u] = await q(`insert into auth.users (email) values ('owner@wa.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  const [hh] = await q(
    `insert into households (organization_id, display_name) values ($1, 'כהן (דמו)') returning id`,
    [org.id],
  );
  householdId = hh.id;
  const [g] = await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, whatsapp_opt_in)
     values ($1, $2, 'דנה', 'כהן', $3, true) returning id`,
    [org.id, hh.id, PHONE],
  );
  guardianId = g.id;
});
afterAll(async () => {
  await t.drop();
});

const guardian = () => ({
  id: guardianId,
  householdId,
  firstName: 'דנה',
  phoneE164: PHONE,
  whatsappOptIn: true,
  locale: 'he' as const,
});

describe('connecting the business number', () => {
  it('seals the token and the secret, and keeps the verify token when the owner replaces them', async () => {
    const { id } = await asOwner((tx) =>
      connectWhatsApp(tx, ctx, {
        phoneNumberId: '1000001',
        businessAccountId: '2000001',
        displayPhone: '+972 2-555-0101',
        accessToken: 'fake-access-token-0123456789',
        appSecret: SECRET,
      }),
    );
    const view = await asOwner((tx) => whatsappConnection(tx));
    expect(view).toMatchObject({ id, status: 'connected', phoneNumberId: '1000001' });
    expect(Object.keys(view ?? {})).not.toContain('encAccessToken');
    const [raw] = await q(`select enc_access_token::text t from whatsapp_connections`);
    expect(raw.t).not.toContain('fake-access-token');
    expect(await system((tx) => loadWhatsApp(tx, ctx.orgId))).toEqual({
      connectionId: id,
      phoneNumberId: '1000001',
      accessToken: 'fake-access-token-0123456789',
      appSecret: SECRET,
      businessAccountId: '2000001',
      verifyToken: expect.stringMatching(/^[0-9a-f]{48}$/) as string,
    });
    await asOwner((tx) =>
      connectWhatsApp(tx, ctx, {
        phoneNumberId: '1000001',
        businessAccountId: '2000001',
        displayPhone: '+972 2-555-0101',
        accessToken: 'fake-access-token-replaced-0000',
        appSecret: SECRET,
      }),
    );
    const again = await asOwner((tx) => whatsappConnection(tx));
    expect(again?.verifyToken).toBe(view?.verifyToken);
    expect(
      await metaSubscriptionCheck(t.db, id, {
        mode: 'subscribe',
        token: view?.verifyToken ?? null,
        challenge: '42',
      }),
    ).toBe('42');
    expect(
      await metaSubscriptionCheck(t.db, id, { mode: 'subscribe', token: 'wrong', challenge: '42' }),
    ).toBeNull();
    expect(
      await metaSubscriptionCheck(t.db, 'not-a-uuid', {
        mode: 'subscribe',
        token: 'x',
        challenge: '1',
      }),
    ).toBeNull();
  });
});

describe("Meta's webhook", () => {
  it('refuses a forged body and stores a real message once', async () => {
    const conn = await asOwner((tx) => whatsappConnection(tx));
    const id = conn?.id as string;
    const body = webhook({
      messages: [
        {
          id: 'wamid.fake1',
          from: PHONE.slice(1),
          timestamp: String(Math.floor(MONDAY_9.getTime() / 1000)),
          type: 'text',
          text: { body: 'דניאל לא יגיע היום' },
        },
      ],
    });
    expect(await ingestMetaWebhook(t.db, id, body, signMetaBody(body, 'f'.repeat(32)))).toBe(
      'rejected',
    );
    expect(await ingestMetaWebhook(t.db, id, body, null)).toBe('rejected');
    expect(await ingestMetaWebhook(t.db, '00000000-0000-0000-0000-000000000000', body, null)).toBe(
      'unknown_connection',
    );
    expect(await ingestMetaWebhook(t.db, id, body, signMetaBody(body, SECRET))).toEqual({
      inbound: 1,
      duplicates: 0,
      receipts: 0,
    });
    expect(await ingestMetaWebhook(t.db, id, body, signMetaBody(body, SECRET))).toEqual({
      inbound: 0,
      duplicates: 1,
      receipts: 0,
    });
    const rows = await q(`select provider, body, guardian_id from inbound_messages`);
    expect(rows).toEqual([
      { provider: 'meta', body: 'דניאל לא יגיע היום', guardian_id: guardianId },
    ]);
    expect((await asOwner((tx) => whatsappConnection(tx)))?.lastInboundAt).toEqual(MONDAY_9);
  });
});

describe('the 24-hour window', () => {
  it('sends free text inside the window and records its receipts', async () => {
    const provider = new FakeMessagingProvider(true);
    const m = await system((tx) =>
      enqueueMessage(tx, ctx, {
        guardian: guardian(),
        templateKey: 'free_text',
        vars: { text: 'קיבלנו, תודה' },
        idempotencyKey: 'wa:inside',
        notBefore: MONDAY_10,
      }),
    );
    expect(await system((tx) => dispatchDue(tx, ctx, provider, MONDAY_10))).toMatchObject({
      sent: 1,
      blocked: 0,
    });
    expect(provider.sent[0]?.message).toMatchObject({ text: 'קיבלנו, תודה' });
    expect(provider.sent[0]?.message.template).toBeUndefined();
    const [row] = await q(`select provider_message_id from messages where id = $1`, [m.id]);
    const conn = await asOwner((tx) => whatsappConnection(tx));
    const at = String(Math.floor(MONDAY_10.getTime() / 1000) + 5);
    const receipts = webhook({
      statuses: [
        { id: row.provider_message_id, status: 'delivered', timestamp: at },
        { id: row.provider_message_id, status: 'read', timestamp: at },
        { id: 'wamid.unknown', status: 'read', timestamp: at },
      ],
    });
    expect(
      await ingestMetaWebhook(t.db, conn?.id as string, receipts, signMetaBody(receipts, SECRET)),
    ).toEqual({ inbound: 0, duplicates: 0, receipts: 2 });
    const [after] = await q(`select delivered_at, read_at from messages where id = $1`, [m.id]);
    expect(after.delivered_at).not.toBeNull();
    expect(after.read_at).not.toBeNull();
  });

  it('blocks a message outside the window when the business has no Meta template for it', async () => {
    const provider = new FakeMessagingProvider(true);
    const m = await system((tx) =>
      enqueueMessage(tx, ctx, {
        guardian: guardian(),
        templateKey: 'free_text',
        vars: { text: 'תזכורת' },
        idempotencyKey: 'wa:outside-none',
        notBefore: THURSDAY_10,
      }),
    );
    expect(await system((tx) => dispatchDue(tx, ctx, provider, THURSDAY_10))).toMatchObject({
      sent: 0,
      blocked: 1,
    });
    const [row] = await q(`select status, block_reason from messages where id = $1`, [m.id]);
    expect(row).toEqual({ status: 'blocked', block_reason: 'outside_window' });
    expect(provider.sent).toEqual([]);
  });

  it('sends the approved Meta template outside the window, with its values in order', async () => {
    await expect(
      asOwner((tx) =>
        setMetaTemplate(tx, ctx, {
          key: 'free_text',
          locale: 'he',
          metaName: 'business_update',
          metaParams: 'nope',
        }),
      ),
    ).rejects.toThrow(DomainError);
    await asOwner((tx) =>
      setMetaTemplate(tx, ctx, {
        key: 'free_text',
        locale: 'he',
        metaName: 'business_update',
        metaParams: '{{text}}',
      }),
    );
    const provider = new FakeMessagingProvider(true);
    await system((tx) =>
      enqueueMessage(tx, ctx, {
        guardian: guardian(),
        templateKey: 'free_text',
        vars: { text: 'השיעור מחר בוטל' },
        idempotencyKey: 'wa:outside-template',
        notBefore: THURSDAY_10,
      }),
    );
    expect(await system((tx) => dispatchDue(tx, ctx, provider, THURSDAY_10))).toMatchObject({
      sent: 1,
    });
    expect(provider.sent[0]?.message).toMatchObject({
      locale: 'he',
      template: { id: 'business_update', values: ['השיעור מחר בוטל'] },
    });
  });

  it('lets the owner switch the number off', async () => {
    await asOwner((tx) => disconnectWhatsApp(tx));
    expect(await system((tx) => loadWhatsApp(tx, ctx.orgId))).toBeNull();
    await expect(asOwner((tx) => disconnectWhatsApp(tx))).resolves.toBeUndefined();
  });
});
