import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createInvoicing,
  InvoicingNotLiveError,
  invalidInvoicingField,
  invoicingHints,
  invoicingLive,
  MORNING_DOC,
  morningPayment,
  MorningInvoicing,
  platformMorningCredentials,
} from '../src';

const ctx = { organizationId: 'org', idempotencyKey: 'k' };
const CREDS = { apiKeyId: 'key-id-not-real', apiKeySecret: 'secret-not-real-9931' };
const NOW = Date.parse('2026-11-27T10:00:00Z');

interface Call {
  url: string;
  body: Record<string, unknown>;
  auth: string | null;
}

/** A fake Morning: answers the token endpoint and /documents from a queue of responses. */
function morning(answers: { status: number; body: unknown }[], token: unknown = null) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const headers = init.headers as Record<string, string>;
    calls.push({ url, body, auth: headers.authorization ?? null });
    if (url.endsWith('/idp/v1/oauth/token')) {
      tokens += 1;
      const t = token ?? {
        accessToken: `tok${tokens}`,
        tokenType: 'Bearer',
        expiresAt: NOW / 1000 + 3600,
      };
      const status = (t as { error?: string }).error ? 401 : 200;
      return new Response(JSON.stringify(t), { status });
    }
    const a = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  const inv = new MorningInvoicing(CREDS, { fetch: fetchFn, now: () => NOW });
  return { inv, calls, docs: () => calls.filter((c) => c.url.endsWith('/documents')) };
}

const created = (id: string, number: number) => ({
  status: 201,
  body: { id, number, url: { origin: `https://x/${id}`, he: `https://x/${id}/he` } },
});
const line = { description: 'שיעור שחייה', quantity: 1, amount: agorot(33_000) };

describe('Morning fields', () => {
  it('checks the key id and secret and masks the secret', () => {
    expect(invalidInvoicingField('morning', CREDS)).toBeNull();
    expect(invalidInvoicingField('morning', { ...CREDS, apiKeyId: 'short' })).toBe('apiKeyId');
    expect(invalidInvoicingField('morning', { apiKeyId: CREDS.apiKeyId })).toBe('apiKeySecret');
    expect(invoicingHints('morning', CREDS)).toEqual({
      apiKeyId: 'key-id-not-real',
      apiKeySecret: '••••9931',
    });
  });

  it('runs only when switched on, against the sandbox when asked', () => {
    expect(invoicingLive('morning', {})).toBe(false);
    expect(() => createInvoicing('morning', CREDS, { env: {} })).toThrow(InvoicingNotLiveError);
    const live = createInvoicing('morning', CREDS, {
      env: { RSWIM_MORNING_LIVE: '1', MORNING_SANDBOX: '1' },
    });
    expect(live).toBeInstanceOf(MorningInvoicing);
    expect(() => new MorningInvoicing({ apiKeyId: 'x' })).toThrow(/missing/);
  });

  it('reads the platform account from the environment', () => {
    expect(platformMorningCredentials({})).toBeNull();
    expect(
      platformMorningCredentials({
        PLATFORM_MORNING_API_KEY_ID: 'a',
        PLATFORM_MORNING_API_KEY_SECRET: 'b',
      }),
    ).toEqual({ apiKeyId: 'a', apiKeySecret: 'b' });
  });

  it('maps our payment methods to Morning payment rows', () => {
    expect(morningPayment('credit_card')).toEqual({ type: 3 });
    expect(morningPayment('standing_order')).toEqual({ type: 3 });
    expect(morningPayment('bit')).toEqual({ type: 10, appType: 1 });
    expect(morningPayment('paybox')).toEqual({ type: 10, appType: 3 });
    expect(morningPayment('cash')).toEqual({ type: 1 });
    expect(morningPayment('bank_transfer')).toEqual({ type: 4 });
    expect(morningPayment('cheque')).toEqual({ type: 2 });
    expect(morningPayment('something')).toEqual({ type: 11 });
  });
});

describe('Morning connection check', () => {
  it('passes when Morning gives the key a token', async () => {
    const m = morning([]);
    expect(await m.inv.testConnection()).toEqual({ ok: true });
    expect(m.calls[0]?.body).toEqual({
      grant_type: 'client_credentials',
      client_id: CREDS.apiKeyId,
      client_secret: CREDS.apiKeySecret,
    });
    expect(m.docs()).toHaveLength(0);
  });

  it('names a wrong key and a plan without API access', async () => {
    expect(await morning([], { error: 'invalid_client' }).inv.testConnection()).toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    expect(await morning([], { error: 'unauthorized_client' }).inv.testConnection()).toEqual({
      ok: false,
      reason: 'plan_without_api',
    });
    expect(await morning([], { error: 'server_error' }).inv.testConnection()).toEqual({
      ok: false,
      reason: 'morning_server_error',
    });
  });
});

describe('Morning documents', () => {
  it('issues an invoice-receipt with the payment row, reusing one token', async () => {
    const m = morning([created('d1', 50001), created('d2', 50002)]);
    const r = await m.inv.issueInvoiceReceipt(ctx, {
      client: { name: 'משפחת בדיקה', email: 'test@example.invalid', nationalId: '000000018' },
      lines: [line, { description: 'כובע', quantity: 2, amount: agorot(4_000) }],
      paymentMethod: 'bit',
      notes: 'נובמבר',
    });
    expect(r).toEqual({ documentId: 'd1', number: '50001', pdfUrl: 'https://x/d1/he' });
    const body = m.docs()[0]?.body;
    expect(body).toMatchObject({
      type: MORNING_DOC.invoiceReceipt,
      lang: 'he',
      currency: 'ILS',
      vatType: 0,
      remarks: 'נובמבר',
      client: {
        name: 'משפחת בדיקה',
        emails: ['test@example.invalid'],
        taxId: '000000018',
        add: false,
      },
      payment: [{ date: '2026-11-27', price: 370, currency: 'ILS', type: 10, appType: 1 }],
    });
    expect(body?.income).toEqual([
      { description: 'שיעור שחייה', quantity: 1, price: 330, currency: 'ILS', vatType: 1 },
      { description: 'כובע ×2', quantity: 1, price: 40, currency: 'ILS', vatType: 1 },
    ]);
    expect(m.docs()[0]?.auth).toBe('Bearer tok1');
    await m.inv.issueTaxInvoice(ctx, {
      client: { name: 'מוסד' },
      lines: [line],
      dueOn: '2026-12-31',
    });
    expect(m.calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    expect(m.docs()[1]?.body).toMatchObject({
      type: MORNING_DOC.taxInvoice,
      dueDate: '2026-12-31',
    });
    expect(m.docs()[1]?.body.client).toEqual({ name: 'מוסד', add: false });
  });

  it('falls back to a receipt for an exempt dealer (2403)', async () => {
    const m = morning([{ status: 400, body: { errorCode: 2403 } }, created('r1', 7)]);
    const r = await m.inv.issueInvoiceReceipt(ctx, {
      client: { name: 'א' },
      lines: [line],
      paymentMethod: 'cash',
    });
    expect(r.number).toBe('7');
    expect(m.docs().map((d) => d.body.type)).toEqual([
      MORNING_DOC.invoiceReceipt,
      MORNING_DOC.receipt,
    ]);
  });

  it('gets a fresh token once on 401, and surfaces other errors', async () => {
    const m = morning([
      { status: 401, body: {} },
      created('d1', 1),
      { status: 400, body: { code: 1010 } },
    ]);
    await m.inv.issueReceipt(ctx, {
      client: { name: 'א' },
      invoiceDocumentId: 'inv1',
      amount: agorot(10_000),
      paymentMethod: 'credit_card',
    });
    expect(m.docs().map((d) => d.auth)).toEqual(['Bearer tok1', 'Bearer tok2']);
    expect(m.docs()[1]?.body).toMatchObject({
      type: MORNING_DOC.receipt,
      linkedDocumentIds: ['inv1'],
      linkType: 'link',
      payment: [{ price: 100, type: 3 }],
    });
    await expect(
      m.inv.issueCreditNote(ctx, { originalDocumentId: 'd1', lines: [line] }),
    ).rejects.toThrow(/1010/);
    expect(m.docs()[2]?.body).toMatchObject({
      type: MORNING_DOC.creditNote,
      linkedDocumentIds: ['d1'],
      linkType: 'cancel',
    });
  });

  it('issues a credit note and refuses an answer without an id', async () => {
    const m = morning([created('c1', 9), { status: 201, body: {} }]);
    expect(await m.inv.issueCreditNote(ctx, { originalDocumentId: 'd1', lines: [line] })).toEqual({
      documentId: 'c1',
      number: '9',
    });
    await expect(
      m.inv.issueTaxInvoice(ctx, { client: { name: 'א' }, lines: [line], dueOn: '2026-12-01' }),
    ).rejects.toThrow(/unexpected/);
  });
});
