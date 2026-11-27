/**
 * The SUMIT adapter against recorded answers (shapes from SUMIT's published schema as public integrations quote it,
 * values invented). No test talks to SUMIT: a fake `fetch` answers each endpoint and records what was sent.
 */
import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createGateway,
  gatewayLive,
  GatewayNotLiveError,
  invalidCredentialField,
  PAYMENT_GATEWAYS,
  parseSumitMandate,
  SumitError,
  SumitGateway,
  sumitAgorot,
  sumitExternalIdentifier,
  sumitMandateId,
  sumitPaymentApproved,
  sumitPlaceholderId,
  sumitShekels,
  sumitWebhookPaymentId,
} from '../src';

const CREDS = { companyId: '123456', apiKey: 'test-sumit-api-key' };
const REF = '00000000-0000-4000-8000-0000000000aa';

type Answer = { status?: number; body: unknown } | 'network';
function fakeSumit(answers: Record<string, Answer | Answer[]>) {
  const calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace('https://sumit.test/', '').replace(/\/$/, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ endpoint, body });
    let a = answers[endpoint];
    if (Array.isArray(a)) a = a.shift();
    if (!a) return new Response('not found', { status: 404 });
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, baseUrl: 'https://sumit.test' };
}

const ok = (data: unknown) => ({
  body: { Status: 'Success', UserErrorMessage: null, TechnicalErrorDetails: null, Data: data },
});
const refused = (msg: string) => ({
  body: { Status: 1, UserErrorMessage: msg, TechnicalErrorDetails: null, Data: null },
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
const ctx = { organizationId: 'o', idempotencyKey: 'checkout:x:card' };

const payment = (over: Record<string, unknown> = {}) => ({
  ID: 777001,
  CustomerID: 4242,
  ValidPayment: true,
  Status: '000',
  StatusDescription: 'מאושר',
  Amount: 123.45,
  Currency: 0,
  ExternalIdentifier: sumitExternalIdentifier(REF, 'card'),
  DocumentID: 9001,
  AuthNumber: '0123456',
  PaymentMethod: { CreditCard_LastDigits: '4242' },
  ...over,
});

const gateway = (answers: Record<string, Answer | Answer[]>) => {
  const f = fakeSumit(answers);
  return { gw: new SumitGateway(CREDS, f), calls: f.calls };
};

describe('helpers', () => {
  it('converts agorot and shekels both ways', () => {
    expect(sumitShekels(12345)).toBe(123.45);
    expect(sumitAgorot(123.45)).toBe(12345);
    expect(sumitAgorot(0.1 + 0.2)).toBe(30);
  });

  it('keeps a saved card as the SUMIT customer id', () => {
    expect(sumitMandateId(4242)).toBe('sumit-customer:4242');
    expect(parseSumitMandate('sumit-customer:4242')).toBe(4242);
    expect(parseSumitMandate('4242')).toBeNull();
    expect(parseSumitMandate('sumit-customer:abc')).toBeNull();
  });

  it('approves only a valid payment with a zero status', () => {
    const p = (o: Record<string, unknown>) => payment(o) as never;
    expect(sumitPaymentApproved(p({}))).toBe(true);
    expect(sumitPaymentApproved(p({ Status: '0' }))).toBe(true);
    expect(sumitPaymentApproved(p({ Status: null }))).toBe(true);
    expect(sumitPaymentApproved(p({ ValidPayment: false }))).toBe(false);
    expect(sumitPaymentApproved(p({ Status: '033' }))).toBe(false);
    expect(sumitPaymentApproved(p({ ValidPayment: null, Status: null }))).toBe(false);
  });

  it('reads the payment id from each IPN shape and nothing else', () => {
    expect(sumitWebhookPaymentId(JSON.stringify({ PaymentID: 777001 }))).toBe('777001');
    expect(sumitWebhookPaymentId(JSON.stringify({ Payment: { ID: 777001 } }))).toBe('777001');
    expect(sumitWebhookPaymentId(JSON.stringify({ Data: { Payment: { ID: '777001' } } }))).toBe(
      '777001',
    );
    expect(sumitWebhookPaymentId('Payment.ID=777001&Payment.Status=000')).toBe('777001');
    expect(sumitWebhookPaymentId('OG-PaymentID=777001')).toBe('777001');
    expect(
      sumitWebhookPaymentId(`json=${encodeURIComponent(JSON.stringify({ PaymentID: 5 }))}`),
    ).toBe('5');
    // A document's id is not a payment's.
    expect(sumitWebhookPaymentId(JSON.stringify({ ID: 9001, DocumentID: 9001 }))).toBeNull();
    expect(sumitWebhookPaymentId(JSON.stringify({ PaymentID: '1; drop' }))).toBeNull();
    expect(sumitWebhookPaymentId('')).toBeNull();
  });
});

describe('the connection', () => {
  it('asks for the company number and the API key', () => {
    expect(PAYMENT_GATEWAYS.sumit.fields.map((f) => f.key)).toEqual(['companyId', 'apiKey']);
    expect(invalidCredentialField('sumit', CREDS)).toBeNull();
    expect(invalidCredentialField('sumit', { ...CREDS, companyId: 'abc' })).toBe('companyId');
    expect(invalidCredentialField('sumit', { companyId: '1', apiKey: '' })).toBe('apiKey');
    expect(PAYMENT_GATEWAYS.sumit.methods).not.toContain('bit');
  });

  it('stays off until RSWIM_SUMIT_LIVE=1, and the sandbox plays it', () => {
    expect(gatewayLive('sumit', {})).toBe(false);
    expect(() =>
      createGateway('sumit', CREDS, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    expect(
      createGateway('sumit', CREDS, {
        webhookSecret: 's',
        sandbox: false,
        env: { RSWIM_SUMIT_LIVE: '1' },
      }),
    ).toBeInstanceOf(SumitGateway);
    expect(createGateway('sumit', CREDS, { webhookSecret: 's', sandbox: true, env: {} }).kind).toBe(
      'sumit',
    );
  });

  it('refuses a bad company number before calling SUMIT', () => {
    expect(() => new SumitGateway({ companyId: 'x', apiKey: 'k' })).toThrow(SumitError);
  });

  it('checks the credentials with a page nobody is sent to', async () => {
    const { gw, calls } = gateway({
      'billing/payments/beginredirect': ok({ RedirectURL: 'https://pay.sumit.co.il/x' }),
    });
    expect(await gw.testConnection()).toEqual({ ok: true });
    expect(calls[0]!.body.Credentials).toEqual({ CompanyID: 123456, APIKey: 'test-sumit-api-key' });
  });

  it('reports a refused key as auth_failed', async () => {
    const { gw } = gateway({ 'billing/payments/beginredirect': refused('Invalid API Key') });
    expect(await gw.testConnection()).toEqual({ ok: false, reason: 'auth_failed' });
    const http = gateway({ 'billing/payments/beginredirect': { status: 401, body: '' } });
    expect(await http.gw.testConnection()).toEqual({ ok: false, reason: 'auth_failed' });
  });

  it('reports other failures', async () => {
    const { gw } = gateway({ 'billing/payments/beginredirect': refused('משהו אחר') });
    expect(await gw.testConnection()).toEqual({ ok: false, reason: 'sumit_refused' });
    const net = gateway({ 'billing/payments/beginredirect': 'network' });
    expect(await net.gw.testConnection()).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('checkout', () => {
  it('opens SUMIT’s page for a card charge, VAT included, without saving the card', async () => {
    const { gw, calls } = gateway({
      'billing/payments/beginredirect': ok({ RedirectURL: 'https://pay.sumit.co.il/abc' }),
    });
    const s = await gw.createCheckout(ctx, checkoutReq('card'));
    expect(s.redirectUrl).toBe('https://pay.sumit.co.il/abc');
    const b = calls[0]!.body;
    expect(b.ExternalIdentifier).toBe(`${REF}|card`);
    expect(b.Items).toEqual([
      { Item: { Name: 'שיעורי שחייה נובמבר' }, Quantity: 1, UnitPrice: 123.45, Currency: 0 },
    ]);
    expect(b).toMatchObject({
      VATIncluded: true,
      MaximumPayments: 1,
      PreventSavingPaymentMethod: true,
      RedirectURL: 'https://a.test/pay/t?back=1',
      CancelRedirectURL: 'https://a.test/pay/t',
      IPNURL: 'https://a.test/api/webhooks/pay/c1',
      Customer: { Name: 'דנה כהן', Phone: '+972500000001', SearchMode: 0 },
    });
  });

  it('saves the card for a standing order', async () => {
    const { gw, calls } = gateway({
      'billing/payments/beginredirect': ok({ RedirectURL: 'https://pay.sumit.co.il/so' }),
    });
    await gw.createCheckout(ctx, checkoutReq('standing_order'));
    expect(calls[0]!.body.PreventSavingPaymentMethod).toBe(false);
    expect(calls[0]!.body.ExternalIdentifier).toBe(`${REF}|standing_order`);
  });

  it('refuses Bit and a page with nothing to charge', async () => {
    const { gw, calls } = gateway({});
    await expect(gw.createCheckout(ctx, checkoutReq('bit'))).rejects.toThrow('bit_not_enabled');
    await expect(gw.createCheckout(ctx, checkoutReq('standing_order', 0))).rejects.toThrow(
      SumitError,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws when SUMIT refuses the page', async () => {
    const { gw } = gateway({ 'billing/payments/beginredirect': refused('סכום לא תקין') });
    await expect(gw.createCheckout(ctx, checkoutReq('card'))).rejects.toThrow(SumitError);
  });
});

describe('the IPN', () => {
  it('trusts only the payment SUMIT reports to our own key', async () => {
    const { gw, calls } = gateway({ 'billing/payments/get': ok({ Payment: payment() }) });
    // The body claims a different amount; only the id is read from it.
    const e = await gw.readWebhook(JSON.stringify({ PaymentID: 777001, Amount: 1 }));
    expect(calls[0]).toMatchObject({
      endpoint: 'billing/payments/get',
      body: { PaymentID: 777001 },
    });
    expect(e).toMatchObject({
      eventId: 'sumit:777001',
      type: 'checkout.paid',
      reference: REF,
      method: 'card',
      externalPaymentId: '777001',
      amountAgorot: 12345,
    });
    expect(e?.mandate).toBeUndefined();
  });

  it('carries the saved card of a standing order', async () => {
    const { gw } = gateway({
      'billing/payments/get': ok({
        Payment: payment({ ExternalIdentifier: sumitExternalIdentifier(REF, 'standing_order') }),
      }),
    });
    const e = await gw.readWebhook('Payment.ID=777001');
    expect(e?.mandate).toEqual({ mandateId: 'sumit-customer:4242', cardLast4: '4242' });
  });

  it('reads a declined payment as failed', async () => {
    const { gw } = gateway({
      'billing/payments/get': ok({ Payment: payment({ ValidPayment: false, Status: '033' }) }),
    });
    expect(await gw.readWebhook('{"PaymentID":777001}')).toMatchObject({
      type: 'checkout.failed',
      amountAgorot: 0,
      failureReason: 'sumit_033',
    });
  });

  it('ignores a payment that is not one of our pages', async () => {
    const foreign = gateway({
      'billing/payments/get': ok({ Payment: payment({ ExternalIdentifier: 'someone-else' }) }),
    });
    expect(await foreign.gw.readWebhook('{"PaymentID":777001}')).toBeNull();
    const other = gateway({ 'billing/payments/get': ok({ Payment: payment({ ID: 5 }) }) });
    expect(await other.gw.readWebhook('{"PaymentID":777001}')).toBeNull();
    const none = gateway({});
    expect(await none.gw.readWebhook('{"hello":1}')).toBeNull();
    expect(none.calls).toHaveLength(0);
  });

  it('throws when SUMIT does not know the payment (the route answers an error, SUMIT retries)', async () => {
    const { gw } = gateway({ 'billing/payments/get': refused('Payment not found') });
    await expect(gw.readWebhook('{"PaymentID":777001}')).rejects.toThrow(SumitError);
  });
});

describe('standing orders', () => {
  const so = { mandateId: 'sumit-customer:4242', amount: agorot(45000), description: 'נובמבר' };

  it('charges the customer’s saved card at SUMIT', async () => {
    const { gw, calls } = gateway({
      'billing/payments/charge': ok({ Payment: payment({ ID: 777002, Amount: 450 }) }),
    });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: '777002',
      status: 'succeeded',
    });
    expect(calls[0]!.body).toMatchObject({
      Customer: { ID: 4242, SearchMode: 1 },
      VATIncluded: true,
      Items: [{ UnitPrice: 450, Quantity: 1, Currency: 0 }],
    });
    expect(calls[0]!.body.SingleUseToken).toBeUndefined();
  });

  it('reports a decline', async () => {
    const { gw } = gateway({
      'billing/payments/charge': ok({
        Payment: payment({ ID: 777003, ValidPayment: false, Status: '051' }),
      }),
    });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: '777003',
      status: 'failed',
      failureReason: 'sumit_051',
    });
    const refusedCharge = gateway({ 'billing/payments/charge': refused('אין אמצעי תשלום') });
    expect(await refusedCharge.gw.chargeStandingOrder(ctx, so)).toMatchObject({
      status: 'failed',
      failureReason: 'sumit_refused',
    });
  });

  it('never sends a charge again when its answer was lost: pending for the office', async () => {
    const { gw, calls } = gateway({ 'billing/payments/charge': ['network'] });
    expect(await gw.chargeStandingOrder(ctx, so)).toEqual({
      externalPaymentId: sumitPlaceholderId('unconfirmed', ctx.idempotencyKey),
      status: 'pending',
      failureReason: 'sumit_unconfirmed',
    });
    expect(calls).toHaveLength(1);
    // Each charge's placeholder is its own (a payment's external id is unique per processor).
    expect(sumitPlaceholderId('unconfirmed', 'a')).not.toBe(sumitPlaceholderId('unconfirmed', 'b'));
  });

  it('refuses a mandate that is not a SUMIT customer', async () => {
    const { gw, calls } = gateway({});
    expect(await gw.chargeStandingOrder(ctx, { ...so, mandateId: 'tok:1234' })).toMatchObject({
      status: 'failed',
      failureReason: 'bad_mandate',
    });
    expect(calls).toHaveLength(0);
  });

  it('has nothing to cancel at SUMIT, and refunds stay in SUMIT', async () => {
    const { gw, calls } = gateway({});
    await gw.cancelStandingOrder();
    await expect(gw.refund()).rejects.toThrow('refund in SUMIT');
    await expect(gw.createPaymentLink(ctx, {} as never)).rejects.toThrow(SumitError);
    await expect(gw.createStandingOrder()).rejects.toThrow(SumitError);
    expect(calls).toHaveLength(0);
  });
});
