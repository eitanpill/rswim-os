/**
 * The Tranzila adapter against recorded answers (shapes from docs.tranzila.com, values invented). No test talks to
 * Tranzila: a fake `fetch` answers each endpoint and records what was sent.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createGateway,
  gatewayLive,
  GatewayNotLiveError,
  invalidCredentialField,
  PAYMENT_GATEWAYS,
  parseTranzilaMandate,
  TranzilaError,
  TranzilaGateway,
  tranzilaAccessToken,
  tranzilaAgorot,
  tranzilaDuplicateKey,
  tranzilaMandateId,
  tranzilaNotify,
  tranzilaPlaceholderId,
  tranzilaRef,
  tranzilaShekels,
} from '../src';

const CREDS = { terminalName: 'swimtest', appKey: 'test-tz-app-key', secretKey: 'test-tz-secret' };
const REF = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'Z1234567890abcd';
const NONCE = 'ab'.repeat(40);

type Answer = { status?: number; body: unknown } | 'network';
function fakeTranzila(answers: Record<string, Answer | Answer[]>) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: u, headers: new Headers(init?.headers), body });
    const key = u.replace(/^https:\/\/(api|report)\.tz\.test\//, '$1:');
    let a = answers[key];
    if (Array.isArray(a)) a = a.shift();
    if (!a) return new Response('not found', { status: 404 });
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    apiUrl: 'https://api.tz.test',
    reportsUrl: 'https://report.tz.test',
    pageUrl: 'https://page.tz.test',
    clock: () => ({ time: 1764250000, nonce: NONCE }),
  };
}
const gateway = (answers: Record<string, Answer | Answer[]>) => {
  const f = fakeTranzila(answers);
  return { gw: new TranzilaGateway(CREDS, f), calls: f.calls };
};

const handshake = { body: { error_code: 0, message: 'Success', thtk: 'thtk-abc-123' } };
const report = (over: Record<string, unknown> = {}) => ({
  body: {
    transactions: [
      {
        index: '41711',
        amount: 123.45,
        credit_card_token: TOKEN,
        expiration_month: '12',
        expiration_year: '29',
        card_description: 'Visa 4242',
        processor_response_code: '000',
        authorization_number: '0587923',
        tranmode: 'A',
        ...over,
      },
    ],
    total: 1,
    rows: 1,
  },
});

const checkoutReq = (method: 'card' | 'bit' | 'standing_order', amount = 12345) => ({
  reference: REF,
  method,
  amount: agorot(amount),
  description: 'שיעורי שחייה נובמבר',
  customer: { name: 'דנה כהן', phoneE164: '+972500000001' },
  successUrl: 'https://a.test/pay/t?back=1',
  cancelUrl: 'https://a.test/pay/t',
  notifyUrl: 'https://a.test/api/webhooks/pay/c1',
  sandboxUrl: 'https://a.test/pay/t/sandbox',
});
const ctx = { organizationId: 'o', idempotencyKey: 'payment:1' };
const notify = (
  method: 'card' | 'bit' | 'standing_order' = 'card',
  extra: Record<string, string> = {},
) =>
  new URLSearchParams({
    Response: '000',
    index: '41711',
    sum: '1.00', // a lie: the amount comes from the report
    rswim_ref: tranzilaRef(REF, method),
    ...extra,
  }).toString();

describe('helpers', () => {
  it('signs API calls as the docs describe', () => {
    const expected = createHmac('sha256', `${CREDS.secretKey}1764250000${NONCE}`)
      .update(CREDS.appKey)
      .digest('hex');
    expect(tranzilaAccessToken(CREDS.appKey, CREDS.secretKey, 1764250000, NONCE)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('converts money and keeps a saved card with its expiry', () => {
    expect(tranzilaShekels(12345)).toBe(123.45);
    expect(tranzilaAgorot(123.45)).toBe(12345);
    const id = tranzilaMandateId(TOKEN, '3', '2029');
    expect(id).toBe(`tranzila:${TOKEN}:0329`);
    expect(parseTranzilaMandate(id)).toEqual({ token: TOKEN, month: '03', year: '29' });
    expect(parseTranzilaMandate('payplus:a:b')).toBeNull();
  });

  it('reads only the index and our reference from a notify', () => {
    expect(tranzilaNotify(notify())).toEqual({ index: '41711', reference: REF, method: 'card' });
    // The terminal echoed only pdesc.
    expect(
      tranzilaNotify(
        new URLSearchParams({ index: '5', pdesc: `שיעורים ${tranzilaRef(REF, 'bit')}` }).toString(),
      ),
    ).toEqual({ index: '5', reference: REF, method: 'bit' });
    expect(
      tranzilaNotify(JSON.stringify({ index: 7, rswim_ref: tranzilaRef(REF, 'card') })),
    ).toEqual({
      index: '7',
      reference: REF,
      method: 'card',
    });
    expect(tranzilaNotify(new URLSearchParams({ index: '5' }).toString())).toBeNull();
    expect(
      tranzilaNotify(
        new URLSearchParams({ index: 'x', rswim_ref: tranzilaRef(REF, 'card') }).toString(),
      ),
    ).toBeNull();
  });
});

describe('the connection', () => {
  it('asks for the terminal name and the API keys', () => {
    expect(PAYMENT_GATEWAYS.tranzila.fields.map((f) => f.key)).toEqual([
      'terminalName',
      'appKey',
      'secretKey',
    ]);
    expect(invalidCredentialField('tranzila', CREDS)).toBeNull();
  });

  it('stays off until RSWIM_TRANZILA_LIVE=1', () => {
    expect(gatewayLive('tranzila', {})).toBe(false);
    expect(() =>
      createGateway('tranzila', CREDS, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    expect(
      createGateway('tranzila', CREDS, {
        webhookSecret: 's',
        sandbox: false,
        env: { RSWIM_TRANZILA_LIVE: '1' },
      }),
    ).toBeInstanceOf(TranzilaGateway);
  });

  it('checks the keys with a ₪1 handshake, signed', async () => {
    const { gw, calls } = gateway({ 'api:v2/handshake/create': handshake });
    expect(await gw.testConnection()).toEqual({ ok: true });
    expect(calls[0]!.body).toEqual({ terminal_name: 'swimtest', sum: 1 });
    expect(calls[0]!.headers.get('X-tranzila-api-app-key')).toBe(CREDS.appKey);
    expect(calls[0]!.headers.get('X-tranzila-api-request-time')).toBe('1764250000');
    expect(calls[0]!.headers.get('X-tranzila-api-nonce')).toBe(NONCE);
    expect(calls[0]!.headers.get('X-tranzila-api-access-token')).toBe(
      tranzilaAccessToken(CREDS.appKey, CREDS.secretKey, 1764250000, NONCE),
    );
  });

  it('reports refused keys and other failures', async () => {
    expect(
      await gateway({ 'api:v2/handshake/create': { status: 401, body: {} } }).gw.testConnection(),
    ).toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    expect(
      await gateway({
        'api:v2/handshake/create': { body: { error_code: 912791, message: 'x' } },
      }).gw.testConnection(),
    ).toEqual({ ok: false, reason: 'tranzila_refused' });
    expect(await gateway({ 'api:v2/handshake/create': 'network' }).gw.testConnection()).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('refuses a bad terminal name before calling Tranzila', () => {
    expect(() => new TranzilaGateway({ ...CREDS, terminalName: 'a/b' })).toThrow(TranzilaError);
  });
});

describe('checkout', () => {
  it('opens a card page with a handshake for the exact sum', async () => {
    const { gw, calls } = gateway({ 'api:v2/handshake/create': handshake });
    const s = await gw.createCheckout(ctx, checkoutReq('card'));
    expect(calls[0]!.body).toEqual({ terminal_name: 'swimtest', sum: 123.45 });
    const url = new URL(s.redirectUrl);
    expect(url.origin + url.pathname).toBe('https://page.tz.test/swimtest/iframenew.php');
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      sum: '123.45',
      currency: '1',
      tranmode: 'A',
      thtk: 'thtk-abc-123',
      success_url_address: 'https://a.test/pay/t?back=1',
      fail_url_address: 'https://a.test/pay/t',
      notify_url_address: 'https://a.test/api/webhooks/pay/c1',
      rswim_ref: `${REF}|card`,
      contact: 'דנה כהן',
    });
    expect(q.pdesc!.endsWith(`${REF}|card`)).toBe(true);
    expect(q.bit_pay).toBeUndefined();
  });

  it('opens Bit, and a ₪1 J2 check for a standing order with nothing owed', async () => {
    const { gw } = gateway({ 'api:v2/handshake/create': [handshake, handshake] });
    const bit = new URL((await gw.createCheckout(ctx, checkoutReq('bit'))).redirectUrl);
    expect(bit.searchParams.get('bit_pay')).toBe('1');
    const so = new URL(
      (await gw.createCheckout(ctx, checkoutReq('standing_order', 0))).redirectUrl,
    );
    expect(so.searchParams.get('tranmode')).toBe('N');
    expect(so.searchParams.get('sum')).toBe('1');
    expect(so.searchParams.get('hidesum')).toBe('1');
  });

  it('opens nothing when the handshake is refused', async () => {
    const { gw } = gateway({
      'api:v2/handshake/create': { body: { error_code: 5, message: 'no' } },
    });
    await expect(gw.createCheckout(ctx, checkoutReq('card'))).rejects.toThrow(TranzilaError);
  });
});

describe('the notify', () => {
  it('takes the result, amount and token from Tranzila’s report, not the body', async () => {
    const { gw, calls } = gateway({ 'report:v1/transaction': report() });
    const e = await gw.readWebhook(notify());
    expect(calls[0]!.body).toEqual({ terminal_name: 'swimtest', transaction_index: 41711 });
    expect(e).toMatchObject({
      eventId: 'tranzila:41711',
      type: 'checkout.paid',
      reference: REF,
      method: 'card',
      externalPaymentId: '41711',
      amountAgorot: 12345,
    });
    expect(e?.mandate).toBeUndefined();
  });

  it('carries the saved card of a standing order; a J2 check pays nothing', async () => {
    const { gw } = gateway({
      'report:v1/transaction': [report(), report({ amount: 1, tranmode: 'N' })],
    });
    const paid = await gw.readWebhook(notify('standing_order'));
    expect(paid?.mandate).toEqual({ mandateId: `tranzila:${TOKEN}:1229`, cardLast4: '4242' });
    expect(paid?.amountAgorot).toBe(12345);
    const checked = await gw.readWebhook(notify('standing_order'));
    expect(checked).toMatchObject({ type: 'checkout.paid', amountAgorot: 0 });
    expect(checked?.mandate?.mandateId).toBe(`tranzila:${TOKEN}:1229`);
  });

  it('reads a decline from the report even when the body says approved', async () => {
    const { gw } = gateway({ 'report:v1/transaction': report({ processor_response_code: '004' }) });
    expect(await gw.readWebhook(notify())).toMatchObject({
      type: 'checkout.failed',
      amountAgorot: 0,
      failureReason: 'tranzila_004',
    });
  });

  it('ignores a notify Tranzila does not know, or without our reference', async () => {
    const unknown = gateway({
      'report:v1/transaction': { body: { transactions: [], total: 0, rows: 0 } },
    });
    expect(await unknown.gw.readWebhook(notify())).toBeNull();
    const other = gateway({ 'report:v1/transaction': report({ index: '999' }) });
    expect(await other.gw.readWebhook(notify())).toBeNull();
    const none = gateway({});
    expect(await none.gw.readWebhook('Response=000&index=41711')).toBeNull();
    expect(none.calls).toHaveLength(0);
  });
});

describe('standing orders', () => {
  const so = { mandateId: `tranzila:${TOKEN}:1229`, amount: agorot(45000), description: 'נובמבר' };
  const charged = (code = '000') => ({
    body: {
      error_code: 0,
      message: 'Success',
      transaction_result: {
        processor_response_code: code,
        transaction_id: '50001',
        auth_number: '123',
      },
    },
  });

  it('charges the token with its expiry and a duplicate guard', async () => {
    const { gw, calls } = gateway({ 'api:v1/transaction/credit_card/create': charged() });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: '50001',
      status: 'succeeded',
    });
    expect(calls[0]!.body).toMatchObject({
      terminal_name: 'swimtest',
      txn_type: 'debit',
      card_number: TOKEN,
      expire_month: 12,
      expire_year: 2029,
      items: [{ name: 'נובמבר', unit_price: 450, units_number: 1 }],
      user_defined_fields: [{ name: 'DCdisable', value: tranzilaDuplicateKey(ctx.idempotencyKey) }],
    });
  });

  it('reports a decline and a refusal', async () => {
    const { gw } = gateway({ 'api:v1/transaction/credit_card/create': charged('051') });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: '50001',
      status: 'failed',
      failureReason: 'tranzila_051',
    });
    const refused = gateway({
      'api:v1/transaction/credit_card/create': { status: 400, body: { x: 1 } },
    });
    expect(await refused.gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: tranzilaPlaceholderId('none', ctx.idempotencyKey),
      status: 'failed',
      failureReason: 'tranzila_refused',
    });
  });

  it('never sends a charge again when its answer was lost: pending for the office', async () => {
    const { gw, calls } = gateway({ 'api:v1/transaction/credit_card/create': ['network'] });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: tranzilaPlaceholderId('unconfirmed', ctx.idempotencyKey),
      status: 'pending',
      failureReason: 'tranzila_unconfirmed',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a mandate that is not Tranzila’s; refunds stay in Tranzila', async () => {
    const { gw, calls } = gateway({});
    expect(
      await gw.chargeStandingOrder(ctx, { ...so, mandateId: 'sumit-customer:1' }),
    ).toMatchObject({
      status: 'failed',
      failureReason: 'bad_mandate',
    });
    await gw.cancelStandingOrder();
    await expect(gw.refund()).rejects.toThrow('refund in Tranzila');
    await expect(gw.createPaymentLink(ctx, {} as never)).rejects.toThrow(TranzilaError);
    await expect(gw.createStandingOrder()).rejects.toThrow(TranzilaError);
    expect(calls).toHaveLength(0);
  });
});
