/**
 * The business's own receipts account (docs/payments/MORNING.md), against a real database with RLS: the owner
 * connects Morning; the key is sealed (no signed-in user can read it) and only the business's system role opens it;
 * the office sees that it is connected, a family does not; an adapter that is not live is saved as not working.
 * Every key is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { createDataKey, DomainError, type ServiceContext } from '@rswim/domain-core';
import { createInvoicing, FakeInvoicingProvider } from '@rswim/integrations';
import {
  connectInvoicing,
  disconnectInvoicing,
  invoicingConnection,
  loadInvoicing,
  type InvoicingFactory,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let admin = '';
let parent = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const as = <T>(user: string, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: user, org_id: ctx.orgId }, fn);
const owner = <T>(fn: (tx: Tx) => Promise<T>) => as(ctx.userId as string, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};

const KEY = { apiKeyId: 'demo-key-id-1', apiKeySecret: 'demo-secret-not-real-5521' };
let opened: Record<string, string> | null = null;
/** A Morning whose check passes; it remembers the credentials it was opened with. */
const working: InvoicingFactory = (_kind, creds) => {
  opened = creds;
  return Object.assign(new FakeInvoicingProvider(), {
    testConnection: async () => ({ ok: true as const }),
  });
};
const refused: InvoicingFactory = () =>
  Object.assign(new FakeInvoicingProvider(), {
    testConnection: async () => ({ ok: false as const, reason: 'auth_failed' }),
  });
const notLive: InvoicingFactory = (kind, creds) => createInvoicing(kind, creds, { env: {} });

beforeAll(async () => {
  t = await createTestDatabase();
  const master = Buffer.alloc(32, 7);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  const [org] = await q(
    `insert into organizations (slug, name) values ('docs', 'בית ספר קבלות (דמו)') returning id`,
  );
  await q(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
    org.id,
    createDataKey(master, org.id).wrapped,
  ]);
  const user = async (email: string, role: string) => {
    const [u] = await q(`insert into auth.users (email) values ($1) returning id`, [email]);
    await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, $3)`, [
      org.id,
      u.id,
      role,
    ]);
    return u.id as string;
  };
  ctx = { orgId: org.id, userId: await user('owner@docs.test', 'owner') };
  admin = await user('admin@docs.test', 'admin');
  const [hh] = await q(
    `insert into households (organization_id, display_name) values ($1, 'משפחת דמו') returning id`,
    [org.id],
  );
  const [g] = await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, is_billing_contact)
     values ($1, $2, 'דנה', 'דמו', '+972500000777', true) returning id`,
    [org.id, hh.id],
  );
  const [pu] = await q(`insert into auth.users (email) values ('parent@docs.test') returning id`);
  parent = pu.id;
  await q(
    `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
    [org.id, parent, g.id],
  );
});
afterAll(async () => {
  await t.drop();
});

describe('connecting the business receipts account', () => {
  it('has nothing before the owner connects, and refuses a malformed key', async () => {
    expect(await system((tx) => loadInvoicing(tx, ctx.orgId, { build: working }))).toBeNull();
    expect(
      await codeOf(
        owner((tx) =>
          connectInvoicing(
            tx,
            ctx,
            { provider: 'morning', credentials: { ...KEY, apiKeyId: 'x' } },
            { build: working },
          ),
        ),
      ),
    ).toBe('receipts.errors.field');
    expect(await codeOf(owner((tx) => disconnectInvoicing(tx)))).toBe(
      'receipts.errors.notConnected',
    );
  });

  it('saves an adapter that is not live as failed, and a refused key as failed', async () => {
    expect(
      await owner((tx) =>
        connectInvoicing(tx, ctx, { provider: 'morning', credentials: KEY }, { build: notLive }),
      ),
    ).toMatchObject({ status: 'failed', error: 'adapter_not_live' });
    expect(await system((tx) => loadInvoicing(tx, ctx.orgId, { build: working }))).toMatchObject({
      invoicing: null,
      reason: 'failed',
    });
    expect(
      await owner((tx) =>
        connectInvoicing(tx, ctx, { provider: 'morning', credentials: KEY }, { build: refused }),
      ),
    ).toMatchObject({ status: 'failed', error: 'auth_failed' });
  });

  it('connects Morning; the key is sealed and only the system role opens it', async () => {
    const r = await owner((tx) =>
      connectInvoicing(tx, ctx, { provider: 'morning', credentials: KEY }, { build: working }),
    );
    expect(r).toMatchObject({ status: 'connected', error: null });
    expect((await q(`select count(*)::int as n from invoicing_connections`))[0].n).toBe(1);
    expect(await owner((tx) => invoicingConnection(tx))).toMatchObject({
      provider: 'morning',
      status: 'connected',
      credentialHints: { apiKeyId: 'demo-key-id-1', apiKeySecret: '••••5521' },
    });
    const [raw] = await q(`select enc_credentials from invoicing_connections`);
    expect(raw.enc_credentials.toString('utf8')).not.toContain(KEY.apiKeySecret);
    for (const who of [ctx.userId as string, admin, parent]) {
      const err = await as(who, (tx) =>
        tx.execute(sql.raw('select enc_credentials from invoicing_connections')),
      ).catch((e: Error) => e);
      expect(String((err as Error).cause ?? err)).toMatch(/permission denied/);
    }
    expect(await as(admin, (tx) => invoicingConnection(tx))).toMatchObject({ status: 'connected' });
    expect(await as(parent, (tx) => invoicingConnection(tx))).toBeNull();

    opened = null;
    const loaded = await system((tx) => loadInvoicing(tx, ctx.orgId, { build: working }));
    expect(loaded?.invoicing).toBeTruthy();
    expect(opened).toEqual(KEY);
    expect(await system((tx) => loadInvoicing(tx, ctx.orgId, { build: notLive }))).toMatchObject({
      invoicing: null,
      reason: 'adapter_not_live',
    });
  });

  it('only the owner disconnects; then nothing is issued', async () => {
    expect(await codeOf(as(admin, (tx) => disconnectInvoicing(tx)))).toBe(
      'receipts.errors.notConnected',
    );
    await owner((tx) => disconnectInvoicing(tx));
    expect(await system((tx) => loadInvoicing(tx, ctx.orgId, { build: working }))).toMatchObject({
      invoicing: null,
      reason: 'disconnected',
    });
  });
});
