/**
 * The PayPlus adapter against recorded answers (shapes from PayPlus's REST API v1.0 reference, values invented). No test
 * talks to PayPlus: a fake `fetch` answers each endpoint and records what was sent.
 */
import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createGateway,
  gatewayLive,
  GatewayNotLiveError,
  invalidCredentialField,
  PAYMENT_GATEWAYS,
  PAYPLUS_STAGING_URL,
  parsePayPlusMandate,
  PayPlusError,
  PayPlusGateway,
  payplusAgorot,
  payplusMandateId,
  payplusMoreInfo,
  payplusPlaceholderId,
  payplusShekels,
  payplusSignature,
  payplusSigned,
} from '../src';

const CREDS = {
  apiKey: 'test-payplus-api-key',
  secretKey: 'test-payplus-secret',
  paymentPageUid: 'page-0000-1111',
  terminalUid: 'term-0000-2222',
  cashierUid: 'cash-0000-3333',
};
const REF = '00000000-0000-4000-8000-0000000000aa';
const CUSTOMER = 'cust-aaaa-bbbb-cccc';
const TOKEN = 'tok-1111-2222-3333';

type Answer = { status?: number; body: unknown } | 'network';
function fakePayPlus(answers: Record<string, Answer | Answer[]>) {
  const calls: {
    endpoint: string;
    method: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace('https://payplus.test/', '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({
      endpoint,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    });
    let a = answers[endpoint.split('?')[0]!];
    if (Array.isArray(a)) a = a.shift();
    if (!a) return new Response('not found', { status: 404 });
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, baseUrl: 'https://payplus.test' };
}

const gateway = (answers: Record<string, Answer | Answer[]>) => {
  const f = fakePayPlus(answers);
  return { gw: new PayPlusGateway(CREDS, f), calls: f.calls };
};

const results = (status = 'success') => ({
  status,
  code: status === 'success' ? 0 : 1,
  description: 'x',
});
const linked = {
  body: {
    results: results(),
    data: {
      page_request_uid: 'req-123',
      payment_page_link: 'https://payments.payplus.co.il/req-123',
      qr_code_image: '',
    },
  },
};
const transaction = (over: Record<string, unknown> = {}) => ({
  uid: 'tx-777',
  payment_request_uid: 'req-123',
  number: 'PP-1',
  type: 'Charge',
  status_code: '000',
  amount: 123.45,
  currency: 'ILS',
  more_info: payplusMoreInfo(REF, 'card'),
  ...over,
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

function signed(body: unknown, secret = CREDS.secretKey) {
  const raw = JSON.stringify(body);
  return {
    raw,
    headers: new Headers({ hash: payplusSignature(raw, secret), 'user-agent': 'PayPlus' }),
  };
}

describe('helpers', () => {
  it('converts agorot and shekels both ways', () => {
    expect(payplusShekels(12345)).toBe(123.45);
    expect(payplusAgorot(123.45)).toBe(12345);
  });

  it('keeps a saved card as customer and token', () => {
    const id = payplusMandateId(CUSTOMER, TOKEN);
    expect(parsePayPlusMandate(id)).toEqual({ customerUid: CUSTOMER, token: TOKEN });
    expect(parsePayPlusMandate('tok:1234')).toBeNull();
    expect(parsePayPlusMandate(`payplus:${CUSTOMER}`)).toBeNull();
  });

  it('checks the hash on the raw body, the body serialized again, and the user agent', () => {
    const body = { transaction: transaction() };
    const { raw, headers } = signed(body);
    expect(payplusSigned(raw, headers, CREDS.secretKey)).toBe(true);
    // Pretty-printed raw bytes, hashed by PayPlus over the compact form (its own sample).
    expect(payplusSigned(JSON.stringify(body, null, 2), headers, CREDS.secretKey)).toBe(true);
    expect(payplusSigned(raw, headers, 'other-secret')).toBe(false);
    expect(payplusSigned(raw, new Headers({ hash: headers.get('hash')! }), CREDS.secretKey)).toBe(
      false,
    );
    expect(payplusSigned(raw, new Headers({ 'user-agent': 'PayPlus' }), CREDS.secretKey)).toBe(
      false,
    );
    expect(
      payplusSigned(raw, new Headers({ hash: 'nope', 'user-agent': 'PayPlus' }), CREDS.secretKey),
    ).toBe(false);
    expect(payplusSigned('not json', headers, CREDS.secretKey)).toBe(false);
  });
});

describe('the connection', () => {
  it('asks for both keys, the page, the terminal and the cashier', () => {
    expect(PAYMENT_GATEWAYS.payplus.fields.map((f) => f.key)).toEqual([
      'apiKey',
      'secretKey',
      'paymentPageUid',
      'terminalUid',
      'cashierUid',
    ]);
    expect(PAYMENT_GATEWAYS.payplus.fields.filter((f) => f.secret).map((f) => f.key)).toEqual([
      'apiKey',
      'secretKey',
    ]);
    expect(invalidCredentialField('payplus', CREDS)).toBeNull();
    expect(invalidCredentialField('payplus', { ...CREDS, cashierUid: '' })).toBe('cashierUid');
  });

  it('stays off until RSWIM_PAYPLUS_LIVE=1; PAYPLUS_STAGING=1 points at staging', async () => {
    expect(gatewayLive('payplus', {})).toBe(false);
    expect(() =>
      createGateway('payplus', CREDS, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    const urls: string[] = [];
    const g = createGateway('payplus', CREDS, {
      webhookSecret: 's',
      sandbox: false,
      env: { RSWIM_PAYPLUS_LIVE: '1', PAYPLUS_STAGING: '1' },
      payplus: {
        fetch: (async (u: string) => {
          urls.push(String(u));
          return new Response('[]');
        }) as typeof fetch,
      },
    });
    expect(g).toBeInstanceOf(PayPlusGateway);
    await g.testConnection();
    expect(urls[0]!.startsWith(`${PAYPLUS_STAGING_URL}/PaymentPages/list/`)).toBe(true);
  });

  it('checks the keys and that the page is on the terminal', async () => {
    const { gw, calls } = gateway({
      'PaymentPages/list/': {
        body: [{ uid: 'page-0000-1111', name: 'שחייה', terminal_uid: 'term-0000-2222' }],
      },
    });
    expect(await gw.testConnection()).toEqual({ ok: true });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.endpoint).toBe('PaymentPages/list/?terminal_uid=term-0000-2222');
    expect(calls[0]!.headers.get('api-key')).toBe(CREDS.apiKey);
    expect(calls[0]!.headers.get('secret-key')).toBe(CREDS.secretKey);
    const other = gateway({ 'PaymentPages/list/': { body: { data: [{ uid: 'another' }] } } });
    expect(await other.gw.testConnection()).toEqual({
      ok: false,
      reason: 'payplus_page_not_on_terminal',
    });
  });

  it('reports refused keys and other failures', async () => {
    expect(
      await gateway({ 'PaymentPages/list/': { status: 401, body: '' } }).gw.testConnection(),
    ).toEqual({ ok: false, reason: 'auth_failed' });
    expect(
      await gateway({
        'PaymentPages/list/': { status: 400, body: { error: 'Invalid request parameters.' } },
      }).gw.testConnection(),
    ).toEqual({ ok: false, reason: 'payplus_refused' });
    expect(await gateway({ 'PaymentPages/list/': 'network' }).gw.testConnection()).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});

describe('checkout', () => {
  it('opens a card charge with Invoice+ issuing the receipt', async () => {
    const { gw, calls } = gateway({ 'PaymentPages/generateLink': linked });
    const s = await gw.createCheckout(ctx, checkoutReq('card'));
    expect(s).toEqual({
      redirectUrl: 'https://payments.payplus.co.il/req-123',
      externalId: 'req-123',
    });
    expect(calls[0]!.body).toMatchObject({
      payment_page_uid: CREDS.paymentPageUid,
      amount: 123.45,
      currency_code: 'ILS',
      charge_method: 1,
      create_token: false,
      initial_invoice: true,
      send_failure_callback: true,
      charge_default: 'credit-card',
      allowed_charge_methods: ['credit-card'],
      refURL_success: 'https://a.test/pay/t?back=1',
      refURL_failure: 'https://a.test/pay/t',
      refURL_cancel: 'https://a.test/pay/t',
      refURL_callback: 'https://a.test/api/webhooks/pay/c1',
      more_info: `${REF}|card`,
      customer: { customer_name: 'דנה כהן', phone: '+972500000001' },
      items: [{ name: 'שיעורי שחייה נובמבר', quantity: 1, price: 123.45 }],
    });
  });

  it('opens the Bit tab alone for Bit', async () => {
    const { gw, calls } = gateway({ 'PaymentPages/generateLink': linked });
    await gw.createCheckout(ctx, checkoutReq('bit'));
    expect(calls[0]!.body).toMatchObject({
      charge_default: 'bit',
      allowed_charge_methods: ['bit'],
      more_info: `${REF}|bit`,
    });
  });

  it('saves the card for a standing order: charged now, or a token check when nothing is owed', async () => {
    const { gw, calls } = gateway({ 'PaymentPages/generateLink': [linked, linked] });
    await gw.createCheckout(ctx, checkoutReq('standing_order'));
    expect(calls[0]!.body).toMatchObject({
      charge_method: 1,
      create_token: true,
      initial_invoice: true,
    });
    await gw.createCheckout(ctx, checkoutReq('standing_order', 0));
    expect(calls[1]!.body).toMatchObject({
      charge_method: 5,
      create_token: true,
      amount: 0,
      initial_invoice: false,
    });
  });

  it('throws when PayPlus refuses the page', async () => {
    const { gw } = gateway({
      'PaymentPages/generateLink': { status: 422, body: 'can-not-find-payment-page' },
    });
    await expect(gw.createCheckout(ctx, checkoutReq('card'))).rejects.toThrow(PayPlusError);
    const failed = gateway({
      'PaymentPages/generateLink': { body: { results: results('error'), data: null } },
    });
    await expect(failed.gw.createCheckout(ctx, checkoutReq('card'))).rejects.toThrow(PayPlusError);
  });
});

describe('the callback', () => {
  const callback = (tx: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
    transaction_type: 'Charge',
    transaction: transaction(tx),
    data: {
      customer_uid: CUSTOMER,
      terminal_uid: CREDS.terminalUid,
      card_information: { four_digits: '4242', expiry_month: '12', expiry_year: '29' },
      ...data,
    },
  });

  it('reads a signed, approved charge', async () => {
    const { gw, calls } = gateway({});
    const { raw, headers } = signed(callback());
    expect(await gw.readWebhook(raw, headers)).toMatchObject({
      eventId: 'payplus:tx-777',
      type: 'checkout.paid',
      reference: REF,
      method: 'card',
      externalPaymentId: 'tx-777',
      amountAgorot: 12345,
    });
    expect(calls).toHaveLength(0);
  });

  it('carries the saved card of a standing order', async () => {
    const { gw } = gateway({});
    const { raw, headers } = signed(
      callback(
        { more_info: payplusMoreInfo(REF, 'standing_order') },
        { card_information: { token: TOKEN, four_digits: '4242' } },
      ),
    );
    expect((await gw.readWebhook(raw, headers))?.mandate).toEqual({
      mandateId: payplusMandateId(CUSTOMER, TOKEN),
      cardLast4: '4242',
    });
  });

  it('reads a decline as failed', async () => {
    const { gw } = gateway({});
    const { raw, headers } = signed(callback({ status_code: '003' }));
    expect(await gw.readWebhook(raw, headers)).toMatchObject({
      type: 'checkout.failed',
      amountAgorot: 0,
      failureReason: 'payplus_003',
    });
  });

  it('rejects an unsigned or forged callback, and one that is not ours', async () => {
    const { gw } = gateway({});
    const forged = signed(callback({ amount: 1 }), 'someone-elses-secret');
    expect(await gw.readWebhook(forged.raw, forged.headers)).toBeNull();
    const body = JSON.stringify(callback());
    expect(await gw.readWebhook(body, new Headers({ 'user-agent': 'PayPlus' }))).toBeNull();
    const foreign = signed(callback({ more_info: 'order-42' }));
    expect(await gw.readWebhook(foreign.raw, foreign.headers)).toBeNull();
    const junk = signed({ hello: 1 });
    expect(await gw.readWebhook(junk.raw, junk.headers)).toBeNull();
  });
});

describe('standing orders and refunds', () => {
  const so = {
    mandateId: payplusMandateId(CUSTOMER, TOKEN),
    amount: agorot(45000),
    description: 'נובמבר',
  };
  const charged = (tx: Record<string, unknown> = {}) => ({
    body: {
      results: results(),
      data: { transaction: transaction({ uid: 'tx-888', amount: 450, ...tx }), data: {} },
    },
  });

  it('charges the token on the terminal and cashier, with the receipt', async () => {
    const { gw, calls } = gateway({ 'Transactions/Charge': charged() });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: 'tx-888',
      status: 'succeeded',
    });
    expect(calls[0]!.body).toMatchObject({
      terminal_uid: CREDS.terminalUid,
      cashier_uid: CREDS.cashierUid,
      amount: 450,
      currency_code: 'ILS',
      credit_terms: 1,
      use_token: true,
      token: TOKEN,
      customer_uid: CUSTOMER,
      initial_invoice: true,
    });
  });

  it('reports a decline and a refusal', async () => {
    const { gw } = gateway({ 'Transactions/Charge': charged({ status_code: '051' }) });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: 'tx-888',
      status: 'failed',
      failureReason: 'payplus_051',
    });
    const refused = gateway({ 'Transactions/Charge': { status: 400, body: 'bad token' } });
    expect(await refused.gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: payplusPlaceholderId('none', ctx.idempotencyKey),
      status: 'failed',
      failureReason: 'payplus_refused',
    });
  });

  it('never sends a charge again when its answer was lost: pending for the office', async () => {
    const { gw, calls } = gateway({ 'Transactions/Charge': ['network'] });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: payplusPlaceholderId('unconfirmed', ctx.idempotencyKey),
      status: 'pending',
      failureReason: 'payplus_unconfirmed',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a mandate that is not PayPlus’s', async () => {
    const { gw, calls } = gateway({});
    expect(
      await gw.chargeStandingOrder(ctx, { ...so, mandateId: 'sumit-customer:1' }),
    ).toMatchObject({
      status: 'failed',
      failureReason: 'bad_mandate',
    });
    expect(calls).toHaveLength(0);
  });

  it('refunds by transaction uid', async () => {
    const { gw, calls } = gateway({
      'Transactions/RefundByTransactionUID': charged({ uid: 'tx-refund-1', type: 'Refund' }),
    });
    expect(await gw.refund(ctx, { externalPaymentId: 'tx-777', amount: agorot(5000) })).toEqual({
      externalRefundId: 'tx-refund-1',
    });
    expect(calls[0]!.body).toEqual({
      transaction_uid: 'tx-777',
      amount: 50,
      initial_invoice: true,
    });
    const declined = gateway({
      'Transactions/RefundByTransactionUID': charged({ status_code: '009' }),
    });
    await expect(
      declined.gw.refund(ctx, { externalPaymentId: 'tx-777', amount: agorot(5000) }),
    ).rejects.toThrow(PayPlusError);
  });

  it('never makes bare links or mandates, and has nothing to cancel', async () => {
    const { gw, calls } = gateway({});
    await gw.cancelStandingOrder();
    await expect(gw.createPaymentLink(ctx, {} as never)).rejects.toThrow(PayPlusError);
    await expect(gw.createStandingOrder()).rejects.toThrow(PayPlusError);
    expect(calls).toHaveLength(0);
  });
});
