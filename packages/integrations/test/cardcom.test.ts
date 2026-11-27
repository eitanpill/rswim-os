/**
 * The Cardcom adapter against recorded answers (shapes from the v11 swagger, values invented). No test talks to
 * Cardcom: a fake `fetch` answers each endpoint and records what was sent.
 */
import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  CardcomCardVault,
  CardcomError,
  CardcomGateway,
  CardcomPlatformProvider,
  cardcomMandateId,
  cardcomReturnValue,
  cardcomUniqTranId,
  createGateway,
  gatewayLive,
  GatewayNotLiveError,
  parseCardcomMandate,
  platformCardcomCredentials,
  platformCardVault,
  SandboxCardVault,
  toAgorot,
  toShekels,
  webhookLowProfileId,
} from '../src';

const CREDS = { terminalNumber: '1000', apiName: 'test-api-name', apiPassword: 'test-api-pass' };
const REF = '00000000-0000-4000-8000-0000000000aa';
const LP = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Answer = { status?: number; body: unknown };
function fakeCardcom(answers: Record<string, Answer | Answer[]>) {
  const calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace('https://cardcom.test/api/v11/', '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ endpoint, body });
    let a = answers[endpoint];
    if (Array.isArray(a)) a = a.shift();
    if (!a) return new Response('not found', { status: 404 });
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, baseUrl: 'https://cardcom.test' };
}

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

const created = {
  ResponseCode: 0,
  Description: 'OK',
  LowProfileId: LP,
  Url: `https://secure.cardcom.solutions/EA/LPC6/1000/${LP}`,
  UrlToBit: `https://secure.cardcom.solutions/EA/Bit/${LP}`,
  UrlToPayPal: null,
};

const lpResult = (over: Record<string, unknown> = {}) => ({
  ResponseCode: 0,
  Description: 'OK',
  TerminalNumber: 1000,
  LowProfileId: LP,
  TranzactionId: 98765,
  ReturnValue: cardcomReturnValue(REF, 'card'),
  Operation: 'ChargeOnly',
  TokenInfo: null,
  TranzactionInfo: {
    ResponseCode: 0,
    TranzactionId: 98765,
    TerminalNumber: 1000,
    Amount: 123.45,
    Last4CardDigitsString: '4242',
    Last4CardDigits: 4242,
    CardMonth: 12,
    CardYear: 2029,
  },
  ...over,
});

describe('Cardcom helpers', () => {
  it('converts money, mandates, references and unique ids', () => {
    expect(toShekels(12345)).toBe(123.45);
    expect(toAgorot(123.45)).toBe(12345);
    expect(toAgorot(0.1 + 0.2)).toBe(30);
    const m = cardcomMandateId(TOKEN, 3, 2029);
    expect(m).toBe(`${TOKEN}:0329`);
    expect(parseCardcomMandate(m)).toEqual({ token: TOKEN, mmyy: '0329' });
    expect(parseCardcomMandate('sbx_card_1')).toBeNull();
    expect(cardcomUniqTranId('k1')).toBe(cardcomUniqTranId('k1'));
    expect(cardcomUniqTranId('k1')).not.toBe(cardcomUniqTranId('k2'));
    expect(cardcomUniqTranId('k1')).toMatch(/^rs[0-9a-f]{30}$/);
  });

  it('finds the Low Profile id in a JSON or form webhook, and nothing else', () => {
    expect(webhookLowProfileId(JSON.stringify({ LowProfileId: LP }))).toBe(LP);
    expect(webhookLowProfileId(`terminalnumber=1000&lowprofilecode=${LP}`)).toBe(LP);
    expect(webhookLowProfileId(JSON.stringify({ LowProfileId: 'x' }))).toBeNull();
    expect(webhookLowProfileId('')).toBeNull();
    expect(webhookLowProfileId('null')).toBeNull();
  });
});

describe('Cardcom as a business processor', () => {
  it('runs only when switched on, never in a sandbox, and the demo never outside one', () => {
    expect(gatewayLive('cardcom', {})).toBe(false);
    expect(gatewayLive('cardcom', { RSWIM_CARDCOM_LIVE: '1' })).toBe(true);
    expect(gatewayLive('grow', { RSWIM_CARDCOM_LIVE: '1' })).toBe(false);
    expect(() =>
      createGateway('cardcom', CREDS, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    const live = createGateway('cardcom', CREDS, {
      webhookSecret: 's',
      sandbox: false,
      env: { RSWIM_CARDCOM_LIVE: '1' },
    });
    expect(live).toBeInstanceOf(CardcomGateway);
    expect(
      createGateway('cardcom', CREDS, {
        webhookSecret: 's',
        sandbox: true,
        env: { RSWIM_CARDCOM_LIVE: '1' },
      }),
    ).not.toBeInstanceOf(CardcomGateway);
    expect(() =>
      createGateway('grow', CREDS, {
        webhookSecret: 's',
        sandbox: false,
        env: { RSWIM_CARDCOM_LIVE: '1' },
      }),
    ).toThrow(GatewayNotLiveError);
    expect(() =>
      createGateway('fake', { merchantId: 'm' }, { webhookSecret: 's', sandbox: false, env: {} }),
    ).toThrow(GatewayNotLiveError);
    expect(() => new CardcomGateway({ ...CREDS, terminalNumber: 'abc' })).toThrow(CardcomError);
    expect(new CardcomGateway({ terminalNumber: '1000' }).client.creds).toEqual({
      terminalNumber: 1000,
      apiName: '',
      apiPassword: '',
    });
  });

  it('checks the connection with a page nobody visits', async () => {
    const ok = fakeCardcom({ 'LowProfile/Create': { body: created } });
    expect(await new CardcomGateway(CREDS, ok).testConnection()).toEqual({ ok: true });
    expect(ok.calls[0]!.body).toMatchObject({ TerminalNumber: 1000, ApiName: 'test-api-name' });
    expect(ok.calls[0]!.body).not.toHaveProperty('ApiPassword');

    const wrong = fakeCardcom({
      'LowProfile/Create': { body: { ResponseCode: 5005, Description: 'bad api name' } },
    });
    expect(await new CardcomGateway(CREDS, wrong).testConnection()).toEqual({
      ok: false,
      reason: 'cardcom_5005',
    });
    const denied = fakeCardcom({
      'LowProfile/Create': { status: 401, body: { ResponseCode: 401, Description: 'x' } },
    });
    expect(await new CardcomGateway(CREDS, denied).testConnection()).toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    const broken = fakeCardcom({ 'LowProfile/Create': { status: 500, body: '<html>' } });
    expect(await new CardcomGateway(CREDS, broken).testConnection()).toEqual({
      ok: false,
      reason: 'cardcom_500',
    });
    const down = {
      fetch: (async () => {
        throw new Error('ECONNRESET');
      }) as typeof fetch,
    };
    expect(await new CardcomGateway(CREDS, down).testConnection()).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('opens the hosted page for a card, Bit, and a standing order', async () => {
    const f = fakeCardcom({
      'LowProfile/Create': [
        { body: created },
        { body: created },
        { body: created },
        { body: created },
      ],
    });
    const g = new CardcomGateway(CREDS, f);

    const card = await g.createCheckout(ctx, checkoutReq('card'));
    expect(card).toEqual({ redirectUrl: created.Url, externalId: LP });
    expect(f.calls[0]!.body).toMatchObject({
      Operation: 'ChargeOnly',
      Amount: 123.45,
      ReturnValue: `${REF}|card`,
      WebHookUrl: 'https://a.test/api/webhooks/pay/c1',
      SuccessRedirectUrl: 'https://a.test/pay/t?back=1',
      FailedRedirectUrl: 'https://a.test/pay/t',
      Language: 'he',
      ISOCoinId: 1,
      UIDefinition: { CardOwnerNameValue: 'דנה כהן', CardOwnerPhoneValue: '+972500000001' },
    });

    const bit = await g.createCheckout(ctx, checkoutReq('bit'));
    expect(bit.redirectUrl).toBe(created.UrlToBit);

    await g.createCheckout(ctx, checkoutReq('standing_order', 12345));
    expect(f.calls[2]!.body).toMatchObject({ Operation: 'ChargeAndCreateToken', Amount: 123.45 });
    await g.createCheckout(ctx, checkoutReq('standing_order', 0));
    expect(f.calls[3]!.body).toMatchObject({
      Operation: 'CreateTokenOnly',
      Amount: 1,
      AdvancedDefinition: { JValidateType: 2 },
    });
  });

  it('refuses a page Cardcom did not open (an error, or no Bit on the terminal)', async () => {
    const err = fakeCardcom({
      'LowProfile/Create': { body: { ResponseCode: 5033, Description: 'x' } },
    });
    await expect(
      new CardcomGateway(CREDS, err).createCheckout(ctx, checkoutReq('card')),
    ).rejects.toThrow(CardcomError);
    const noBit = fakeCardcom({ 'LowProfile/Create': { body: { ...created, UrlToBit: null } } });
    await expect(
      new CardcomGateway(CREDS, noBit).createCheckout(ctx, checkoutReq('bit')),
    ).rejects.toThrow(/bit_not_enabled/);
    const garbage = fakeCardcom({ 'LowProfile/Create': { body: '<html>' } });
    await expect(
      new CardcomGateway(CREDS, garbage).createCheckout(ctx, checkoutReq('card')),
    ).rejects.toThrow(/unexpected answer/);
  });

  it('trusts a webhook only through GetLpResult with its own credentials', async () => {
    const f = fakeCardcom({ 'LowProfile/GetLpResult': { body: lpResult() } });
    const g = new CardcomGateway(CREDS, f);
    const ev = await g.readWebhook(
      JSON.stringify({ LowProfileId: LP, ResponseCode: 0, Amount: 999999 }),
    );
    expect(ev).toEqual({
      eventId: `cardcom:${LP}`,
      type: 'checkout.paid',
      reference: REF,
      method: 'card',
      externalPaymentId: '98765',
      amountAgorot: 12345,
      occurredAt: expect.any(String),
    });
    expect(f.calls[0]).toEqual({
      endpoint: 'LowProfile/GetLpResult',
      body: { TerminalNumber: 1000, ApiName: 'test-api-name', LowProfileId: LP },
    });
  });

  it('ignores webhooks about other terminals, other pages, or without our reference', async () => {
    const cases = [
      lpResult({ TerminalNumber: 2000 }),
      lpResult({ LowProfileId: '99999999-2222-4333-8444-555555555555' }),
      lpResult({ ReturnValue: 'someone-else' }),
      lpResult({ ReturnValue: cardcomReturnValue(REF, 'card_setup') }),
      lpResult({ ResponseCode: 5118 }),
    ];
    for (const body of cases) {
      const g = new CardcomGateway(CREDS, fakeCardcom({ 'LowProfile/GetLpResult': { body } }));
      expect(await g.readWebhook(JSON.stringify({ LowProfileId: LP }))).toBeNull();
    }
    const g = new CardcomGateway(CREDS, fakeCardcom({}));
    expect(await g.readWebhook('{"hello":1}')).toBeNull();
  });

  it('reads a declined page, a Bit payment and a saved card', async () => {
    const declined = new CardcomGateway(
      CREDS,
      fakeCardcom({
        'LowProfile/GetLpResult': {
          body: lpResult({
            ResponseCode: 0,
            TranzactionInfo: { ResponseCode: 33, TranzactionId: 5 },
          }),
        },
      }),
    );
    expect(await declined.readWebhook(JSON.stringify({ LowProfileId: LP }))).toMatchObject({
      type: 'checkout.failed',
      failureReason: 'cardcom_33',
      amountAgorot: 0,
    });
    const failedPage = new CardcomGateway(
      CREDS,
      fakeCardcom({
        'LowProfile/GetLpResult': { body: lpResult({ ResponseCode: 700, TranzactionInfo: null }) },
      }),
    );
    expect(await failedPage.readWebhook(JSON.stringify({ LowProfileId: LP }))).toMatchObject({
      type: 'checkout.failed',
      failureReason: 'cardcom_700',
    });

    const bit = new CardcomGateway(
      CREDS,
      fakeCardcom({
        'LowProfile/GetLpResult': {
          body: lpResult({ ReturnValue: cardcomReturnValue(REF, 'bit') }),
        },
      }),
    );
    expect(await bit.readWebhook(JSON.stringify({ LowProfileId: LP }))).toMatchObject({
      type: 'checkout.paid',
      method: 'bit',
      amountAgorot: 12345,
    });

    const saved = new CardcomGateway(
      CREDS,
      fakeCardcom({
        'LowProfile/GetLpResult': {
          body: lpResult({
            ReturnValue: cardcomReturnValue(REF, 'standing_order'),
            Operation: 'CreateTokenOnly',
            TranzactionId: null,
            TranzactionInfo: null,
            TokenInfo: { Token: TOKEN, CardMonth: 3, CardYear: 2029 },
          }),
        },
      }),
    );
    expect(await saved.readWebhook(JSON.stringify({ LowProfileId: LP }))).toMatchObject({
      type: 'checkout.paid',
      method: 'standing_order',
      amountAgorot: 0,
      externalPaymentId: LP,
      mandate: { mandateId: `${TOKEN}:0329`, cardLast4: '0000' },
    });

    // Paid now and saved: the digits come as a number only, or as something that is not digits.
    for (const [digits, want] of [
      [{ Last4CardDigits: 42 }, '0042'],
      [{ Last4CardDigitsString: 'abcd' }, '0000'],
    ] as const) {
      const both = new CardcomGateway(
        CREDS,
        fakeCardcom({
          'LowProfile/GetLpResult': {
            body: lpResult({
              ReturnValue: cardcomReturnValue(REF, 'standing_order'),
              TokenInfo: { Token: TOKEN, CardMonth: 3, CardYear: 2029 },
              TranzactionInfo: { ResponseCode: 0, TranzactionId: 1, Amount: 123.45, ...digits },
            }),
          },
        }),
      );
      expect(await both.readWebhook(JSON.stringify({ LowProfileId: LP }))).toMatchObject({
        amountAgorot: 12345,
        mandate: { cardLast4: want },
      });
    }
    // A saved-card page whose token Cardcom did not return is paid without a mandate (the intake refuses it).
    const noToken = new CardcomGateway(
      CREDS,
      fakeCardcom({
        'LowProfile/GetLpResult': {
          body: lpResult({
            ReturnValue: cardcomReturnValue(REF, 'standing_order'),
            TokenInfo: null,
          }),
        },
      }),
    );
    expect(await noToken.readWebhook(JSON.stringify({ LowProfileId: LP }))).not.toHaveProperty(
      'mandate',
    );
  });

  it('charges a saved card once per key, recovering the first charge on a repeat', async () => {
    const f = fakeCardcom({
      'Transactions/Transaction': [
        { body: { ResponseCode: 0, TranzactionId: 111 } },
        { body: { ResponseCode: 608, Description: 'duplicate' } },
        { body: { ResponseCode: 51, TranzactionId: 112 } },
      ],
      'Transactions/GetTransactionByExternalUniqTran': {
        body: { ResponseCode: 0, TranzactionId: 111 },
      },
    });
    const g = new CardcomGateway(CREDS, f);
    const req = { mandateId: `${TOKEN}:0329`, amount: agorot(45000), description: 'נובמבר' };
    const c = { organizationId: 'o', idempotencyKey: 'payment:1' };
    expect(await g.chargeStandingOrder(c, req)).toEqual({
      externalPaymentId: '111',
      status: 'succeeded',
    });
    expect(f.calls[0]!.body).toMatchObject({
      Token: TOKEN,
      CardExpirationMMYY: '0329',
      Amount: 450,
      ExternalUniqTranId: cardcomUniqTranId('payment:1'),
    });
    expect(await g.chargeStandingOrder(c, req)).toEqual({
      externalPaymentId: '111',
      status: 'succeeded',
    });
    expect(f.calls[2]!.endpoint).toBe('Transactions/GetTransactionByExternalUniqTran');
    expect(await g.chargeStandingOrder({ ...c, idempotencyKey: 'payment:2' }, req)).toEqual({
      externalPaymentId: '112',
      status: 'failed',
      failureReason: 'cardcom_51',
    });
    expect(await g.chargeStandingOrder(c, { ...req, mandateId: 'sbx_card_1' })).toMatchObject({
      status: 'failed',
      failureReason: 'bad_mandate',
    });
    const noId = new CardcomGateway(
      CREDS,
      fakeCardcom({ 'Transactions/Transaction': { body: { ResponseCode: 0 } } }),
    );
    expect(await noId.chargeStandingOrder(c, req)).toMatchObject({
      status: 'failed',
      externalPaymentId: 'cardcom_none',
    });
  });

  it('refunds with the API password, and never makes bare links or mandates', async () => {
    const f = fakeCardcom({
      'Transactions/RefundByTransactionId': [
        { body: { ResponseCode: 0, NewTranzactionId: 222 } },
        { body: { ResponseCode: 5, Description: 'no' } },
      ],
    });
    const g = new CardcomGateway(CREDS, f);
    const c = { organizationId: 'o', idempotencyKey: 'refund:1' };
    expect(await g.refund(c, { externalPaymentId: '111', amount: agorot(1000) })).toEqual({
      externalRefundId: '222',
    });
    expect(f.calls[0]!.body).toEqual({
      ApiName: 'test-api-name',
      ApiPassword: 'test-api-pass',
      TransactionId: 111,
      PartialSum: 10,
    });
    await expect(g.refund(c, { externalPaymentId: '111', amount: agorot(1000) })).rejects.toThrow(
      CardcomError,
    );
    await expect(g.refund(c, { externalPaymentId: 'sbx_1', amount: agorot(1) })).rejects.toThrow(
      /not a Cardcom transaction/,
    );
    await expect(
      g.createPaymentLink(c, { householdId: 'h', amount: agorot(1), description: 'x' }),
    ).rejects.toThrow(CardcomError);
    await expect(g.createStandingOrder()).rejects.toThrow(CardcomError);
    await expect(g.cancelStandingOrder()).resolves.toBeUndefined();
  });
});

describe('Cardcom as the platform terminal', () => {
  const ENV = {
    PLATFORM_CARDCOM_TERMINAL_NUMBER: '1000',
    PLATFORM_CARDCOM_API_NAME: 'platform-api',
    PLATFORM_CARDCOM_API_PASSWORD: 'platform-pass',
  };

  it('is chosen only when its terminal is set, and the demo vault wins in a sandbox', () => {
    expect(platformCardcomCredentials({})).toBeNull();
    expect(
      platformCardcomCredentials({ ...ENV, PLATFORM_CARDCOM_TERMINAL_NUMBER: 'x' }),
    ).toBeNull();
    expect(platformCardcomCredentials({ PLATFORM_CARDCOM_TERMINAL_NUMBER: '1000' })).toBeNull();
    expect(platformCardcomCredentials(ENV)).toEqual({
      terminalNumber: 1000,
      apiName: 'platform-api',
      apiPassword: 'platform-pass',
    });
    expect(
      platformCardcomCredentials({ ...ENV, PLATFORM_CARDCOM_API_PASSWORD: undefined }),
    ).toMatchObject({
      apiPassword: '',
    });
    expect(platformCardVault({})).toBeNull();
    expect(platformCardVault(ENV)).toBeInstanceOf(CardcomCardVault);
    expect(platformCardVault({ ...ENV, RSWIM_GROW_FAKE: '1' })).toBeInstanceOf(SandboxCardVault);
  });

  it('saves the owner card on a token-only page and reads the saved card', async () => {
    const creds = platformCardcomCredentials(ENV)!;
    const f = fakeCardcom({
      'LowProfile/Create': [{ body: created }, { body: { ResponseCode: 1, Description: 'x' } }],
      'LowProfile/GetLpResult': [
        {
          body: lpResult({
            ReturnValue: cardcomReturnValue(REF, 'card_setup'),
            TranzactionInfo: null,
            TokenInfo: { Token: TOKEN, CardMonth: 11, CardYear: 2030 },
          }),
        },
        {
          body: lpResult({
            ReturnValue: cardcomReturnValue(REF, 'card_setup'),
            ResponseCode: 33,
            TokenInfo: null,
          }),
        },
        { body: lpResult() },
        {
          body: lpResult({
            ReturnValue: cardcomReturnValue(REF, 'card_setup'),
            ResponseCode: 5117,
          }),
        },
      ],
    });
    const v = new CardcomCardVault(creds, f);
    const req = {
      reference: REF,
      customer: { name: 'בית ספר', email: 'owner@example.test' },
      successUrl: 'https://a.test/billing/card?card=saved',
      cancelUrl: 'https://a.test/billing/card',
      notifyUrl: 'https://a.test/api/webhooks/platform-card',
      sandboxUrl: 'https://a.test/billing/card/x/sandbox',
    };
    expect(await v.createCardSetup(ctx, req)).toEqual({ redirectUrl: created.Url, externalId: LP });
    expect(f.calls[0]!.body).toMatchObject({
      Operation: 'CreateTokenOnly',
      ReturnValue: `${REF}|card_setup`,
      WebHookUrl: 'https://a.test/api/webhooks/platform-card',
      UIDefinition: { CardOwnerEmailValue: 'owner@example.test' },
    });
    await expect(v.createCardSetup(ctx, { ...req, customer: { name: '' } })).rejects.toThrow(
      CardcomError,
    );

    const body = JSON.stringify({ LowProfileId: LP });
    expect(await v.readCardWebhook(body)).toMatchObject({
      type: 'card.saved',
      reference: REF,
      mandateId: `${TOKEN}:1130`,
      cardLast4: '0000',
    });
    expect(await v.readCardWebhook(body)).toMatchObject({
      type: 'card.failed',
      failureReason: 'cardcom_33',
    });
    // A customer checkout's result is not a card setup, and a page still pending is not final.
    expect(await v.readCardWebhook(body)).toBeNull();
    expect(await v.readCardWebhook(body)).toBeNull();
  });

  it('charges a school on the platform terminal', async () => {
    const f = fakeCardcom({
      'Transactions/Transaction': { body: { ResponseCode: 0, TranzactionId: 7 } },
    });
    const p = new CardcomPlatformProvider(platformCardcomCredentials(ENV)!, f);
    expect(
      await p.chargeStandingOrder(
        { organizationId: 'o', idempotencyKey: 'platform-invoice:1' },
        { mandateId: `${TOKEN}:1130`, amount: agorot(19900), description: 'Aqua Swim' },
      ),
    ).toEqual({ externalPaymentId: '7', status: 'succeeded' });
    expect(f.calls[0]!.body).toMatchObject({
      TerminalNumber: 1000,
      ApiName: 'platform-api',
      Amount: 199,
    });
  });
});
