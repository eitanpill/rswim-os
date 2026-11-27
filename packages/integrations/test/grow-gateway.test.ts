/**
 * The Grow adapter against answers in the shapes of Grow's documentation (developers.grow.business, values invented).
 * No test talks to Grow: a fake `fetch` answers each endpoint and records the form that was sent.
 */
import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createGateway,
  gatewayLive,
  GatewayNotLiveError,
  growCallbackFields,
  growFullName,
  growMandateId,
  growPaymentId,
  growPhone,
  GrowGateway,
  growUniqueId,
  invalidCredentialField,
  parseGrowMandate,
  parseGrowPaymentId,
  credentialHints,
} from '../src';

const CREDS = { userId: 'u1234567', pageCode: 'cardpage01', bitPageCode: 'bitpage01' };
const REF = '00000000-0000-4000-8000-0000000000aa';
const BASE = 'https://grow.test/api/light/server/1.0';

type Answer = { status?: number; body: unknown };
function fakeGrow(answers: Record<string, Answer | Answer[]>) {
  const calls: { endpoint: string; form: Record<string, string>; headers: Headers }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace(`${BASE}/`, '');
    const form: Record<string, string> = {};
    if (init?.body instanceof FormData)
      for (const [k, v] of init.body.entries()) form[k] = String(v);
    calls.push({ endpoint, form, headers: new Headers(init?.headers) });
    let a = answers[endpoint];
    if (Array.isArray(a)) a = a.shift();
    if (!a) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, baseUrl: BASE };
}

const ok = (data: unknown) => ({ body: { status: 1, err: '', data } });
const err = (id: number) => ({ body: { status: 0, err: { id, message: 'שגיאה' }, data: '' } });

const created = ok({
  processId: '734754',
  processToken: 'tok2153287cd9af46',
  url: 'https://grow.test/far?l=89a7',
});

const paidTran = (over: Record<string, unknown> = {}) => ({
  asmachta: '30012345',
  cardSuffix: '1234',
  cardType: 'Local',
  cardTypeCode: '1',
  cardBrand: 'Visa',
  cardBrandCode: '3',
  cardExp: '1128',
  firstPaymentSum: '0',
  periodicalPaymentSum: '0',
  status: 'שולם',
  statusCode: '2',
  transactionTypeId: '1',
  paymentType: '2',
  sum: '123.45',
  paymentsNum: '0',
  allPaymentsNum: '1',
  paymentDate: '27/11/26',
  description: 'שיעורי שחייה',
  fullName: 'דנה כהן',
  payerPhone: '0500000001',
  payerEmail: '',
  transactionId: '33123456',
  transactionToken: 'ttok9ac26ed383f9',
  ...over,
});

const info = (trans: unknown[], customField: unknown = [{ cField1: REF, cField2: 'card' }]) =>
  ok({ processId: '734754', processToken: 'tok2153287cd9af46', customField, transactions: trans });

const callback = new URLSearchParams({
  'data[processId]': '734754',
  'data[processToken]': 'tok2153287cd9af46',
  'data[customFields][cField1]': REF,
  'data[customFields][cField2]': 'card',
}).toString();
const formHeaders = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });

const checkoutReq = (method: 'card' | 'bit' | 'standing_order', amount = 12345) => ({
  reference: REF,
  method,
  amount: agorot(amount),
  description: 'שיעורי שחייה <נובמבר>',
  customer: { name: 'דנה כהן', phoneE164: '+972500000001' },
  successUrl: 'https://a.test/pay/t?back=1',
  cancelUrl: 'https://a.test/pay/t',
  notifyUrl: 'https://a.test/api/webhooks/pay/c1',
  sandboxUrl: 'https://a.test/pay/t/sandbox',
});
const ctx = { organizationId: 'o', idempotencyKey: 'statement:x' };

describe('Grow credentials', () => {
  it('takes the Bit page and a business key as optional', () => {
    expect(invalidCredentialField('grow', { userId: 'u1234567', pageCode: 'p12345' })).toBeNull();
    expect(invalidCredentialField('grow', { userId: 'u1234567', pageCode: '' })).toBe('pageCode');
    expect(
      invalidCredentialField('grow', { userId: 'u1234567', pageCode: 'p12345', apiKey: '!' }),
    ).toBe('apiKey');
    expect(credentialHints('grow', { userId: 'u1', pageCode: 'p1', apiKey: 'abcdef1234' })).toEqual(
      {
        userId: 'u1',
        pageCode: 'p1',
        apiKey: '••••1234',
      },
    );
  });

  it('runs only with RSWIM_GROW_LIVE=1, and never in place of the sandbox', () => {
    expect(gatewayLive('grow', {})).toBe(false);
    expect(gatewayLive('grow', { RSWIM_GROW_LIVE: '1' })).toBe(true);
    expect(() =>
      createGateway('grow', CREDS, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    const g = createGateway('grow', CREDS, {
      webhookSecret: 's',
      sandbox: false,
      env: { RSWIM_GROW_LIVE: '1' },
    });
    expect(g).toBeInstanceOf(GrowGateway);
    expect(createGateway('grow', CREDS, { webhookSecret: 's', sandbox: true }).kind).toBe('grow');
  });
});

describe('Grow helpers', () => {
  it('formats phones, names and ids as Grow wants them', () => {
    expect(growPhone('+972500000001')).toBe('0500000001');
    expect(growPhone('+97225000000')).toBeNull();
    expect(growPhone(undefined)).toBeNull();
    expect(growFullName('דנה')).toBe('דנה דנה');
    expect(growFullName('דנה <כהן>')).toBe('דנה כהן');
    expect(
      parseGrowPaymentId(growPaymentId({ transactionId: '1', transactionToken: 'abcdefgh1' })),
    ).toEqual({ transactionId: '1', transactionToken: 'abcdefgh1' });
    expect(parseGrowPaymentId('nope')).toBeNull();
    const m = growMandateId('cardtok12345', '0500000001', 'דנה כהן');
    expect(parseGrowMandate(m)).toEqual({
      token: 'cardtok12345',
      phone: '0500000001',
      fullName: 'דנה כהן',
    });
    expect(parseGrowMandate('cardtok12345')).toBeNull();
    expect(growUniqueId('a')).toBe(growUniqueId('a'));
    expect(growUniqueId('a')).not.toBe(growUniqueId('b'));
  });

  it('reads a callback as a form, nested data[...] or JSON', async () => {
    expect(await growCallbackFields(callback, formHeaders)).toMatchObject({
      processId: '734754',
      cField1: REF,
    });
    expect(
      await growCallbackFields(
        JSON.stringify({ status: '1', data: { processId: '9', processToken: 'x' } }),
        new Headers(),
      ),
    ).toMatchObject({ processId: '9', processToken: 'x' });
  });
});

describe('Grow checkout', () => {
  it('opens the card page with our reference and the platform key', async () => {
    const f = fakeGrow({ createPaymentProcess: created });
    const g = new GrowGateway(CREDS, { ...f, platformApiKey: 'platform-key' });
    const s = await g.createCheckout(ctx, checkoutReq('card'));
    expect(s).toEqual({ redirectUrl: 'https://grow.test/far?l=89a7', externalId: '734754' });
    const c = f.calls[0]!;
    expect(c.headers.get('x-api-key')).toBe('platform-key');
    expect(c.form).toMatchObject({
      userId: 'u1234567',
      pageCode: 'cardpage01',
      chargeType: '1',
      sum: '123.45',
      description: 'שיעורי שחייה נובמבר',
      'pageField[fullName]': 'דנה כהן',
      'pageField[phone]': '0500000001',
      cField1: REF,
      cField2: 'card',
      notifyUrl: 'https://a.test/api/webhooks/pay/c1',
    });
    expect(c.form.saveCardToken).toBeUndefined();
  });

  it('uses the Bit page for Bit, and refuses Bit without one', async () => {
    const f = fakeGrow({ createPaymentProcess: created });
    await new GrowGateway(CREDS, f).createCheckout(ctx, checkoutReq('bit'));
    expect(f.calls[0]!.form.pageCode).toBe('bitpage01');
    const noBit = new GrowGateway({ userId: 'u1234567', pageCode: 'cardpage01' }, f);
    await expect(noBit.createCheckout(ctx, checkoutReq('bit'))).rejects.toThrow('bit_not_enabled');
  });

  it('saves the card for a standing order, token-only (₪1, chargeType 3) when nothing is due', async () => {
    const f = fakeGrow({ createPaymentProcess: [created, created] });
    const g = new GrowGateway(CREDS, f);
    await g.createCheckout(ctx, checkoutReq('standing_order'));
    expect(f.calls[0]!.form).toMatchObject({ chargeType: '1', saveCardToken: '1', sum: '123.45' });
    await g.createCheckout(ctx, checkoutReq('standing_order', 0));
    expect(f.calls[1]!.form).toMatchObject({ chargeType: '3', saveCardToken: '1', sum: '1' });
  });

  it('needs an Israeli mobile, and passes Grow errors on', async () => {
    const f = fakeGrow({ createPaymentProcess: err(54) });
    const g = new GrowGateway(CREDS, f);
    const req = checkoutReq('card');
    await expect(g.createCheckout(ctx, { ...req, customer: { name: 'x' } })).rejects.toThrow(
      'phone_required',
    );
    await expect(g.createCheckout(ctx, req)).rejects.toThrow('error 54');
  });
});

describe('Grow callback', () => {
  it('trusts only what Grow answers about the process, then acknowledges it', async () => {
    const f = fakeGrow({ getPaymentProcessInfo: info([paidTran()]), approveTransaction: ok('') });
    const e = await new GrowGateway(CREDS, f).readWebhook(callback, formHeaders);
    expect(e).toMatchObject({
      eventId: 'grow:33123456',
      type: 'checkout.paid',
      reference: REF,
      method: 'card',
      amountAgorot: 12345,
      externalPaymentId: '33123456:ttok9ac26ed383f9',
    });
    expect(f.calls[0]!.form).toEqual({
      pageCode: 'cardpage01',
      processId: '734754',
      processToken: 'tok2153287cd9af46',
    });
    expect(f.calls[1]!.endpoint).toBe('approveTransaction');
    expect(f.calls[1]!.form).toMatchObject({
      transactionId: '33123456',
      asmachta: '30012345',
      pageCode: 'cardpage01',
    });
  });

  it('tries the Bit page when the card page does not know the process', async () => {
    const f = fakeGrow({
      getPaymentProcessInfo: [
        err(716),
        info([paidTran({ transactionTypeId: '6' })], [{ cField1: REF, cField2: 'bit' }]),
      ],
      approveTransaction: ok(''),
    });
    const e = await new GrowGateway(CREDS, f).readWebhook(callback, formHeaders);
    expect(e?.method).toBe('bit');
    expect(f.calls[1]!.form.pageCode).toBe('bitpage01');
  });

  it('turns a saved card into a mandate; a held token-only page charged nothing', async () => {
    const tran = paidTran({
      statusCode: '11',
      status: 'עסקה מושהית',
      sum: '1',
      cardToken: 'cardtok9294decf1',
    });
    const f = fakeGrow({
      getPaymentProcessInfo: info([tran], [{ cField1: REF, cField2: 'standing_order' }]),
    });
    const e = await new GrowGateway(CREDS, f).readWebhook(callback, formHeaders);
    expect(e).toMatchObject({ type: 'checkout.paid', amountAgorot: 0, method: 'standing_order' });
    expect(e?.mandate?.cardLast4).toBe('1234');
    expect(parseGrowMandate(e!.mandate!.mandateId)).toEqual({
      token: 'cardtok9294decf1',
      phone: '0500000001',
      fullName: 'דנה כהן',
    });
    // Held: no acknowledgment call.
    expect(f.calls.map((c) => c.endpoint)).toEqual(['getPaymentProcessInfo']);
  });

  it('ignores callbacks Grow does not confirm', async () => {
    const g = (a: Answer | Answer[]) =>
      new GrowGateway(CREDS, fakeGrow({ getPaymentProcessInfo: a }));
    expect(await g(ok('')).readWebhook('processId=1', formHeaders)).toBeNull(); // no token
    expect(await g([err(716), err(716)]).readWebhook(callback, formHeaders)).toBeNull();
    expect(
      await g(info([paidTran({ statusCode: '3' })])).readWebhook(callback, formHeaders),
    ).toBeNull();
    expect(
      await g(info([paidTran()], [])).readWebhook(
        'data[processId]=734754&data[processToken]=tok2153287cd9af46',
        formHeaders,
      ),
    ).toBeNull();
    const other = ok({ processId: '999', customField: [], transactions: [paidTran()] });
    expect(await g(other).readWebhook(callback, formHeaders)).toBeNull();
  });

  it('falls back to the callback’s custom fields when Grow’s answer has none', async () => {
    const f = fakeGrow({
      getPaymentProcessInfo: info([paidTran()], []),
      approveTransaction: err(1),
    });
    const e = await new GrowGateway(CREDS, f).readWebhook(callback, formHeaders);
    expect(e?.reference).toBe(REF);
  });
});

describe('Grow charges and refunds', () => {
  const mandate = growMandateId('cardtok12345', '0500000001', 'דנה כהן');

  it('charges a saved card once per idempotency key', async () => {
    const f = fakeGrow({ createTransactionWithToken: ok(paidTran({ statusCode: 2 })) });
    const r = await new GrowGateway(CREDS, f).chargeStandingOrder(ctx, {
      mandateId: mandate,
      amount: agorot(12345),
      description: 'נובמבר',
    });
    expect(r).toEqual({ externalPaymentId: '33123456:ttok9ac26ed383f9', status: 'succeeded' });
    expect(f.calls[0]!.form).toMatchObject({
      cardToken: 'cardtok12345',
      sum: '123.45',
      paymentType: '2',
      'pageField[phone]': '0500000001',
      transactionUniqueIdentifier: growUniqueId('statement:x'),
    });
  });

  it('reports a refused token charge as failed', async () => {
    const g = new GrowGateway(CREDS, fakeGrow({ createTransactionWithToken: err(140) }));
    expect(
      await g.chargeStandingOrder(ctx, {
        mandateId: mandate,
        amount: agorot(100),
        description: 'x',
      }),
    ).toEqual({
      externalPaymentId: expect.stringMatching(/^grow_none:[0-9a-f]{24}$/),
      status: 'failed',
      failureReason: 'grow_140',
    });
    expect(
      await g.chargeStandingOrder(ctx, { mandateId: 'bad', amount: agorot(100), description: 'x' }),
    ).toMatchObject({ status: 'failed', failureReason: 'bad_mandate' });
  });

  it('refunds with both of Grow’s ids', async () => {
    const f = fakeGrow({
      refundTransaction: ok(
        paidTran({ statusCode: 3, transactionId: '425856', refundedTransactionId: 425855 }),
      ),
    });
    const r = await new GrowGateway(CREDS, f).refund(ctx, {
      externalPaymentId: '425855:ttok9ac26ed383f9',
      amount: agorot(200),
    });
    expect(r).toEqual({ externalRefundId: '425856' });
    expect(f.calls[0]!.form).toMatchObject({
      transactionId: '425855',
      refundSum: '2',
      userId: 'u1234567',
    });
    await expect(
      new GrowGateway(CREDS, f).refund(ctx, { externalPaymentId: 'x', amount: agorot(1) }),
    ).rejects.toThrow('not a Grow transaction');
  });
});

describe('Grow connection check', () => {
  it('opens a ₪1 page nobody visits; refused details are auth_failed', async () => {
    expect(
      await new GrowGateway(CREDS, fakeGrow({ createPaymentProcess: created })).testConnection(),
    ).toEqual({
      ok: true,
    });
    expect(
      await new GrowGateway(CREDS, fakeGrow({ createPaymentProcess: err(701) })).testConnection(),
    ).toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    expect(
      await new GrowGateway(
        CREDS,
        fakeGrow({ createPaymentProcess: { status: 403, body: {} } }),
      ).testConnection(),
    ).toEqual({ ok: false, reason: 'auth_failed' });
    expect(
      await new GrowGateway(CREDS, fakeGrow({ createPaymentProcess: err(54) })).testConnection(),
    ).toEqual({
      ok: false,
      reason: 'grow_54',
    });
  });
});
