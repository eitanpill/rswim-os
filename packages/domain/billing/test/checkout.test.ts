/**
 * The business's own processor (docs/PAYMENTS.md), against a real database with RLS:
 * 1. the owner connects a processor; its credentials are sealed (no signed-in user can read them, not even the owner)
 *    and only the business's system role opens them;
 * 2. a family pays its balance in one click by card or Bit: the verified callback records the payment and the
 *    receipt request; a redelivery or a forged callback changes nothing;
 * 3. a family sets up a standing order (הוראת קבע) from the payment page and the monthly runs charge it;
 * 4. an office payment link becomes a checkout on the business's processor;
 * 5. a processor whose adapter is not live is saved as not working, and nothing is charged through it.
 * Every person, card and amount is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { createDataKey, DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  createGateway,
  SANDBOX_SIGNATURE_HEADER,
  signSandboxEvent,
  type GatewayEvent,
} from '@rswim/integrations';
import {
  chargeMandate,
  checkoutByToken,
  checkoutPage,
  connectPaymentGateway,
  createLinkAsCheckout,
  disconnectPaymentGateway,
  ingestGatewayWebhook,
  loadGateway,
  openCheckout,
  paymentConnection,
  postAdjustment,
  requestPaymentLink,
  setPaymentMethods,
  startCheckout,
  type GatewayFactory,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let household = '';
let other = '';
let parent = '';
let admin = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(user: string, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: user, org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const sys = (): ServiceContext => ({ orgId: ctx.orgId, userId: null });
const sandbox: GatewayFactory = (kind, creds, o) =>
  createGateway(kind, creds, { ...o, sandbox: true });
const live: GatewayFactory = (kind, creds, o) =>
  createGateway(kind, creds, { ...o, sandbox: false });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const URLS = {
  successUrl: 'https://app.example.test/pay/x/done',
  cancelUrl: 'https://app.example.test/pay/x',
  notifyUrl: 'https://app.example.test/api/webhooks/pay/x',
  sandboxUrl: 'https://app.example.test/pay/x/sandbox',
};
const GROW = { userId: 'demo-user-1', pageCode: 'demo-page-1', apiKey: 'demo-key-123456' };

/** The demo processor's callback, signed with the connection's secret as the sandbox page signs it. */
async function callback(event: Partial<GatewayEvent> & { reference: string }, secret?: string) {
  const conn = await system((tx) => loadGateway(tx, ctx.orgId, { build: sandbox }));
  const body: GatewayEvent = {
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.paid',
    externalPaymentId: `sbx_pay_${Math.random().toString(36).slice(2)}`,
    method: 'card',
    amountAgorot: 0,
    occurredAt: '2026-11-04T10:00:00+02:00',
    ...event,
  };
  const raw = JSON.stringify(body);
  const realSecret = await webhookSecret();
  const headers = new Headers({
    [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(raw, secret ?? realSecret),
  });
  return {
    body,
    outcome: await ingestGatewayWebhook(t.db, conn!.connectionId, raw, headers, {
      build: sandbox,
    }),
    again: () => ingestGatewayWebhook(t.db, conn!.connectionId, raw, headers, { build: sandbox }),
  };
}

/** Reads the sealed webhook secret the way the gateway does (as the system), for signing test callbacks. */
async function webhookSecret() {
  let secret = '';
  await system(async (tx) => {
    const g = await loadGateway(tx, ctx.orgId, {
      build: (kind, creds, o) => {
        secret = o.webhookSecret;
        return sandbox(kind, creds, o);
      },
    });
    expect(g?.gateway).toBeTruthy();
  });
  return secret;
}

const balance = async (hh: string) =>
  Number(
    (
      await q(
        `select coalesce(sum(amount_agorot), 0)::int as b from ledger_entries where household_id = $1`,
        [hh],
      )
    )[0].b,
  );

beforeAll(async () => {
  t = await createTestDatabase();
  const master = Buffer.alloc(32, 9);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  const [org] = await q(
    `insert into organizations (slug, name) values ('pay', 'בית ספר תשלומים (דמו)') returning id`,
  );
  await q(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
    org.id,
    createDataKey(master, org.id).wrapped,
  ]);
  const [u] = await q(`insert into auth.users (email) values ('owner@pay.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  for (const name of ['משפחת כהן (דמו)', 'משפחת לוי (דמו)']) {
    const [hh] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, name],
    );
    if (household) other = hh.id;
    else household = hh.id;
  }
  const [g] = await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, is_billing_contact)
     values ($1, $2, 'מיכל', 'כהן', '+972500000101', true) returning id`,
    [ctx.orgId, household],
  );
  const [pu] = await q(`insert into auth.users (email) values ('parent@pay.test') returning id`);
  parent = pu.id;
  await q(
    `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
    [ctx.orgId, parent, g.id],
  );
  const [au] = await q(`insert into auth.users (email) values ('admin@pay.test') returning id`);
  admin = au.id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [
    ctx.orgId,
    admin,
  ]);
  // The family owes 450 ₪.
  await owner((tx) =>
    postAdjustment(tx, ctx, {
      householdId: household,
      amountAgorot: 45_000,
      kind: 'charge',
      description: 'נובמבר (דמו)',
      requestId: crypto.randomUUID(),
    }),
  );
});
afterAll(async () => {
  await t.drop();
});

describe('connecting the business processor', () => {
  it('refuses the demo processor outside a sandbox and bad credentials', async () => {
    expect(
      await codeOf(
        owner((tx) =>
          connectPaymentGateway(
            tx,
            ctx,
            { provider: 'fake', methods: ['card'], credentials: { merchantId: 'demo-1' } },
            { build: live, sandbox: false },
          ),
        ),
      ),
    ).toBe('payments.errors.demoOnly');
    expect(
      await codeOf(
        owner((tx) =>
          connectPaymentGateway(
            tx,
            ctx,
            { provider: 'grow', methods: ['card'], credentials: { ...GROW, apiKey: '' } },
            { build: sandbox, sandbox: true },
          ),
        ),
      ),
    ).toBe('payments.errors.field');
  });

  it('saves a processor whose adapter is not live as failed, with nothing to charge through', async () => {
    const r = await owner((tx) =>
      connectPaymentGateway(
        tx,
        ctx,
        {
          provider: 'cardcom',
          methods: ['card'],
          credentials: { terminalNumber: '1000', apiName: 'demo', apiPassword: 'demo-pass-1' },
        },
        { build: live, sandbox: false },
      ),
    );
    expect(r).toMatchObject({ status: 'failed', error: 'adapter_not_live' });
    const g = await system((tx) => loadGateway(tx, ctx.orgId, { build: live }));
    expect(g).toMatchObject({ gateway: null, reason: 'failed' });
    expect(
      await codeOf(
        owner((tx) =>
          openCheckout(tx, ctx, {
            purpose: 'household',
            householdId: household,
            amountAgorot: 100,
            description: 'x',
          }),
        ),
      ),
    ).toBe('payments.errors.notConnected');
  });

  it('connects Grow; the credentials are sealed and never readable by signed-in users', async () => {
    const r = await owner((tx) =>
      connectPaymentGateway(
        tx,
        ctx,
        { provider: 'grow', methods: ['card', 'bit', 'standing_order'], credentials: GROW },
        { build: sandbox, sandbox: true },
      ),
    );
    expect(r.status).toBe('connected');
    const view = await owner((tx) => paymentConnection(tx));
    expect(view).toMatchObject({
      provider: 'grow',
      status: 'connected',
      credentialHints: { userId: 'demo-user-1', apiKey: '••••3456' },
    });
    // The ciphertext is not even the plain key, and no signed-in role can select it.
    const [raw] = await q(`select enc_credentials from payment_connections`);
    expect(raw.enc_credentials.toString('utf8')).not.toContain('demo-key-123456');
    for (const who of [ctx.userId as string, admin, parent]) {
      const err = await as(who, (tx) =>
        tx.execute(sql.raw('select enc_credentials from payment_connections')),
      ).catch((e: Error) => e);
      expect(String((err as Error).cause ?? err)).toMatch(/permission denied/);
    }
    // The office sees that a processor is connected; a family does not see the connection at all.
    expect(await as(admin, (tx) => paymentConnection(tx))).toMatchObject({ provider: 'grow' });
    expect(await as(parent, (tx) => paymentConnection(tx))).toBeNull();
    // Only the owner changes it.
    expect(await codeOf(as(admin, (tx) => setPaymentMethods(tx, ['card'])))).toBe(
      'payments.errors.ownerOnly',
    );
    const g = await system((tx) => loadGateway(tx, ctx.orgId, { build: sandbox }));
    expect(g?.gateway?.kind).toBe('grow');
  });
});

describe('the family pays in one click', () => {
  it('pays the balance by Bit; a redelivery and a forged callback change nothing', async () => {
    const before = await balance(household);
    const c = await system((tx) =>
      openCheckout(tx, sys(), {
        purpose: 'household',
        householdId: household,
        amountAgorot: before,
        description: 'יתרה לתשלום',
      }),
    );
    expect(await checkoutByToken(t.db, c.token)).toEqual({ orgId: ctx.orgId, id: c.id });
    expect(await checkoutByToken(t.db, 'short')).toBeNull();
    const page = await system((tx) => checkoutPage(tx, c.id));
    expect(page).toMatchObject({
      status: 'open',
      methods: ['card', 'bit', 'standing_order'],
      payer: 'מיכל כהן',
      provider: 'grow',
    });
    const g = (await system((tx) => loadGateway(tx, ctx.orgId, { build: sandbox })))!.gateway!;
    const redirect = await system((tx) => startCheckout(tx, sys(), g, c.id, 'bit', URLS));
    expect(redirect).toContain('/pay/x/sandbox?m=bit');

    const forged = await callback(
      { reference: c.id, method: 'bit', amountAgorot: before },
      'not-the-secret',
    );
    expect(forged.outcome).toBe('rejected');
    const wrong = await callback({ reference: c.id, method: 'bit', amountAgorot: before - 1 });
    expect(wrong.outcome).toBe('mismatch');
    expect(await balance(household)).toBe(before);

    const paid = await callback({ reference: c.id, method: 'bit', amountAgorot: before });
    expect(paid.outcome).toBe('paid');
    expect(await paid.again()).toBe('duplicate');
    expect(await balance(household)).toBe(0);
    const [p] = await q(
      `select method, source, provider, status from payments where idempotency_key = $1`,
      [`checkout:${c.id}`],
    );
    expect(p).toEqual({ method: 'bit', source: 'provider', provider: 'grow', status: 'succeeded' });
    const receipt = await q(`select 1 from outbox where event_type = 'billing.payment_succeeded'`);
    expect(receipt.length).toBe(1);
    expect((await system((tx) => checkoutPage(tx, c.id)))?.status).toBe('paid');
    // The family sees its own checkouts, not another family's.
    expect(
      (await as(parent, (tx) => tx.execute(sql.raw('select household_id from checkouts')))).rows,
    ).toEqual([{ household_id: household }]);
  });

  it('sets up a standing order that the monthly runs then charge', async () => {
    await expect(
      system((tx) =>
        openCheckout(tx, sys(), {
          purpose: 'mandate',
          householdId: household,
          amountAgorot: 0,
          description: 'הוראת קבע',
        }),
      ),
    ).resolves.toBeTruthy();
    const [c] = await q(`select id, methods from checkouts where purpose = 'mandate'`);
    expect(c.methods).toEqual(['standing_order']);
    const noCard = await callback({ reference: c.id, method: 'standing_order', amountAgorot: 0 });
    expect(noCard.outcome).toBe('mismatch');
    const ok = await callback({
      reference: c.id,
      method: 'standing_order',
      amountAgorot: 0,
      mandate: { mandateId: 'sbx_tok_family_1', cardLast4: '4242' },
    });
    expect(ok.outcome).toBe('paid');
    const page = await system((tx) => checkoutPage(tx, c.id));
    expect(page).toMatchObject({ status: 'paid', cardLast4: '4242', chargeDay: 1 });
    const [so] = await q(
      `select provider, mandate_id, status from standing_orders where household_id = $1`,
      [household],
    );
    expect(so).toEqual({ provider: 'grow', mandate_id: 'sbx_tok_family_1', status: 'active' });

    // Next month's charge goes through the business's own processor.
    const g = (await system((tx) => loadGateway(tx, ctx.orgId, { build: sandbox })))!.gateway!;
    const charged = await system((tx) =>
      chargeMandate(tx, sys(), g, {
        householdId: household,
        amountAgorot: 38_000,
        idempotencyKey: 'run:dec:test',
        description: 'דצמבר (דמו)',
      }),
    );
    expect(charged.status).toBe('succeeded');
    // A second card replaces the first.
    const [c2] = [
      await system((tx) =>
        openCheckout(tx, sys(), {
          purpose: 'mandate',
          householdId: household,
          amountAgorot: 0,
          description: 'החלפת כרטיס',
        }),
      ),
    ];
    await callback({
      reference: c2.id,
      method: 'standing_order',
      amountAgorot: 0,
      mandate: { mandateId: 'sbx_tok_family_2', cardLast4: '1111' },
    });
    const all = await q(
      `select mandate_id, status from standing_orders where household_id = $1 order by created_at`,
      [household],
    );
    expect(all).toEqual([
      { mandate_id: 'sbx_tok_family_1', status: 'cancelled' },
      { mandate_id: 'sbx_tok_family_2', status: 'active' },
    ]);
  });

  it("turns an office payment link into a checkout on the business's processor", async () => {
    const linkId = await owner((tx) =>
      requestPaymentLink(tx, ctx, {
        householdId: other,
        amountAgorot: 12_000,
        description: 'שיעור ניסיון',
        requestId: crypto.randomUUID(),
      }),
    );
    const url = await system((tx) =>
      createLinkAsCheckout(tx, sys(), linkId, 'https://app.example.test/'),
    );
    expect(url).toMatch(/^https:\/\/app\.example\.test\/pay\/[A-Za-z0-9_-]{32}$/);
    const token = (url as string).split('/').pop() as string;
    const found = await checkoutByToken(t.db, token);
    const res = await callback({ reference: found!.id, method: 'card', amountAgorot: 12_000 });
    expect(res.outcome).toBe('paid');
    const [link] = await q(`select status from payment_links where id = $1`, [linkId]);
    expect(link.status).toBe('paid');
    const created = await q(
      `select payload from outbox where event_type = 'billing.payment_link_created'`,
    );
    expect(created[0].payload).toMatchObject({ linkId, url });
  });

  it('stops offering payment once the owner disconnects', async () => {
    await owner((tx) => disconnectPaymentGateway(tx));
    expect(
      await codeOf(
        system((tx) =>
          openCheckout(tx, sys(), {
            purpose: 'household',
            householdId: household,
            amountAgorot: 100,
            description: 'x',
          }),
        ),
      ),
    ).toBe('payments.errors.notConnected');
    expect(await system((tx) => loadGateway(tx, ctx.orgId, { build: sandbox }))).toMatchObject({
      gateway: null,
      reason: 'disconnected',
    });
  });
});
