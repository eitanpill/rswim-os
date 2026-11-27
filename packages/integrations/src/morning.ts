/**
 * Morning (formerly Green Invoice), a business's own receipts, written from Morning's OpenAPI document
 * (https://developers.morning.co/docs/openapi.bundled.json, read 2026-11-27). No test talks to Morning.
 *
 * - The owner creates an API key in Morning (Developer tools → API; the Best plan or higher) and enters its id and
 *   secret on the receipts screen. They are sealed with the school's data key, like a payment processor's.
 * - Auth is OAuth 2.0 client credentials: `POST https://api.morning.co/idp/v1/oauth/token` answers `accessToken`
 *   (a JWT, one hour, `expiresAt` in Unix seconds), sent as `Authorization: Bearer` to
 *   `https://api.greeninvoice.co.il/api/v1`.
 * - Documents: `POST /documents` with a type code (320 invoice-receipt, 400 receipt, 305 tax invoice, 330 credit),
 *   income rows (VAT included in our prices) and, for 320/400, payment rows. An exempt business (עוסק פטור) cannot
 *   issue 320; Morning answers error 2403 and we issue a receipt (400) instead.
 *
 * `docs/payments/MORNING.md` lists what is not verified yet and what to try in Morning's sandbox before
 * `RSWIM_MORNING_LIVE=1`.
 */
import { FISCAL_TEXT_HE, type PaymentMethod } from '@rswim/contracts';
import type { Agorot } from '@rswim/money';
import type { FiscalLine, InvoicingProvider, ProviderContext } from './index';

export const MORNING_API_URL = 'https://api.greeninvoice.co.il/api/v1';
export const MORNING_AUTH_URL = 'https://api.morning.co';
export const MORNING_SANDBOX_API_URL = 'https://sandbox.d.greeninvoice.co.il/api/v1';
export const MORNING_SANDBOX_AUTH_URL = 'https://api.sandbox.morning.dev';

/** What an owner enters for their receipts (one processor of documents per business). */
export const INVOICING_FIELDS = {
  morning: [
    { key: 'apiKeyId', secret: false, pattern: /^[A-Za-z0-9-]{8,80}$/ },
    { key: 'apiKeySecret', secret: true, pattern: /^[A-Za-z0-9._~+/=-]{8,200}$/ },
  ],
} as const;
export type InvoicingKind = keyof typeof INVOICING_FIELDS;
export const INVOICING_KINDS = Object.keys(INVOICING_FIELDS) as InvoicingKind[];

export type InvoicingCredentials = Record<string, string>;

export function invalidInvoicingField(
  kind: InvoicingKind,
  creds: InvoicingCredentials,
): string | null {
  for (const f of INVOICING_FIELDS[kind]) {
    const v = creds[f.key];
    if (typeof v !== 'string' || !f.pattern.test(v)) return f.key;
  }
  return null;
}

export function invoicingHints(kind: InvoicingKind, creds: InvoicingCredentials) {
  const out: Record<string, string> = {};
  for (const f of INVOICING_FIELDS[kind]) {
    const v = creds[f.key] ?? '';
    out[f.key] = f.secret ? `••••${v.slice(-4)}` : v;
  }
  return out;
}

export class MorningError extends Error {
  constructor(
    readonly endpoint: string,
    /** Morning's error code (its documented list), the OAuth error, or the HTTP status. */
    readonly code: number | string | null,
    message: string,
  ) {
    super(`morning ${endpoint}: ${message}`);
  }
}

export class InvoicingNotLiveError extends Error {
  constructor(readonly kind: InvoicingKind) {
    super(`invoicing ${kind} has no live adapter yet`);
  }
}

export interface MorningOptions {
  sandbox?: boolean;
  apiUrl?: string;
  authUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** For tests: the clock (milliseconds). */
  now?: () => number;
}

/** Morning's document type codes we issue. */
export const MORNING_DOC = {
  taxInvoice: 305,
  invoiceReceipt: 320,
  creditNote: 330,
  receipt: 400,
} as const;

/** Morning's payment row type codes (`payment[].type`) and payment apps (`appType`). */
const PAY = { cash: 1, cheque: 2, card: 3, transfer: 4, app: 10, other: 11 } as const;
const APP = { bit: 1, paybox: 3 } as const;

/** Our payment method, from the code or from the Hebrew wording the receipt policies print. */
export function morningPayment(method: string): { type: number; appType?: number } {
  const code = (Object.entries(FISCAL_TEXT_HE.methods).find(([, he]) => he === method)?.[0] ??
    method) as PaymentMethod | string;
  switch (code) {
    case 'credit_card':
    case 'standing_order':
      return { type: PAY.card };
    case 'bit':
      return { type: PAY.app, appType: APP.bit };
    case 'paybox':
      return { type: PAY.app, appType: APP.paybox };
    case 'cash':
      return { type: PAY.cash };
    case 'bank_transfer':
      return { type: PAY.transfer };
    case 'cheque':
      return { type: PAY.cheque };
    default:
      return { type: PAY.other };
  }
}

const shekels = (a: number) => Math.round(a) / 100;
const today = (now: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(now));

type Client = { name: string; nationalId?: string; email?: string };
const client = (c: Client) => ({
  name: c.name,
  ...(c.email ? { emails: [c.email] } : {}),
  ...(c.nationalId ? { taxId: c.nationalId } : {}),
  // A one-off client on the document; the business's client list stays as the owner keeps it.
  add: false,
});
const income = (lines: FiscalLine[]) =>
  lines.map((l) => ({
    description: l.quantity > 1 ? `${l.description} ×${l.quantity}` : l.description,
    quantity: 1,
    // Our line amounts are totals with VAT in them.
    price: shekels(l.amount),
    currency: 'ILS',
    vatType: 1,
  }));
const total = (lines: FiscalLine[]) => lines.reduce((s, l) => s + l.amount, 0);

interface Created {
  id: string;
  number: number | string;
  url?: { origin?: string; he?: string; en?: string };
}

export class MorningClient {
  private readonly apiUrl: string;
  private readonly authUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly creds: { apiKeyId: string; apiKeySecret: string },
    opts: MorningOptions = {},
  ) {
    this.apiUrl = (
      opts.apiUrl ?? (opts.sandbox ? MORNING_SANDBOX_API_URL : MORNING_API_URL)
    ).replace(/\/$/, '');
    this.authUrl = (
      opts.authUrl ?? (opts.sandbox ? MORNING_SANDBOX_AUTH_URL : MORNING_AUTH_URL)
    ).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  private async json(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** A token for the business's key, kept until a minute before Morning says it expires. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs - 60_000 > this.now()) return this.token.value;
    const res = await this.fetchFn(`${this.authUrl}/idp/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.creds.apiKeyId,
        client_secret: this.creds.apiKeySecret,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await this.json(res)) as {
      accessToken?: string;
      expiresAt?: number;
      error?: string;
    } | null;
    if (!res.ok || !body?.accessToken)
      throw new MorningError(
        'token',
        body?.error ?? res.status,
        body?.error ?? `http ${res.status}`,
      );
    const expiresAtMs =
      typeof body.expiresAt === 'number' ? body.expiresAt * 1000 : this.now() + 3_600_000;
    this.token = { value: body.accessToken, expiresAtMs };
    return body.accessToken;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const send = async () =>
      this.fetchFn(`${this.apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${await this.accessToken()}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    let res = await send();
    if (res.status === 401) {
      // The token ran out early (or was revoked): one fresh token, one more try.
      this.token = null;
      res = await send();
    }
    const json = (await this.json(res)) as Record<string, unknown> | null;
    if (!res.ok) {
      const code = json?.errorCode ?? json?.code ?? res.status;
      throw new MorningError(
        path,
        typeof code === 'number' || typeof code === 'string' ? code : res.status,
        `error ${String(code)}`,
      );
    }
    return json as T;
  }
}

/** A business's (or the platform's) Morning account as our invoicing provider. */
export class MorningInvoicing implements InvoicingProvider {
  readonly client: MorningClient;
  private readonly now: () => number;

  constructor(creds: InvoicingCredentials, opts: MorningOptions = {}) {
    if (!creds.apiKeyId || !creds.apiKeySecret)
      throw new MorningError('credentials', null, 'missing API key id or secret');
    this.client = new MorningClient(
      { apiKeyId: creds.apiKeyId, apiKeySecret: creds.apiKeySecret },
      opts,
    );
    this.now = opts.now ?? Date.now;
  }

  /** The key works when Morning gives it a token (no document is made). */
  async testConnection(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.client.accessToken();
      return { ok: true };
    } catch (e) {
      if (e instanceof MorningError && (e.code === 'invalid_client' || e.code === 401))
        return { ok: false, reason: 'auth_failed' };
      if (e instanceof MorningError && e.code === 'unauthorized_client')
        return { ok: false, reason: 'plan_without_api' };
      return {
        ok: false,
        reason: e instanceof MorningError ? `morning_${e.code}` : 'morning_error',
      };
    }
  }

  private async create(body: Record<string, unknown>) {
    const doc = await this.client.post<Created>('/documents', {
      lang: 'he',
      currency: 'ILS',
      vatType: 0,
      ...body,
    });
    if (!doc?.id) throw new MorningError('/documents', null, 'unexpected answer');
    return {
      documentId: doc.id,
      number: String(doc.number),
      pdfUrl: doc.url?.he ?? doc.url?.origin ?? '',
    };
  }

  async issueInvoiceReceipt(
    _ctx: ProviderContext,
    req: { client: Client; lines: FiscalLine[]; paymentMethod: string; notes?: string },
  ) {
    const payment = [
      {
        date: today(this.now()),
        price: shekels(total(req.lines)),
        currency: 'ILS',
        ...morningPayment(req.paymentMethod),
      },
    ];
    const body = {
      client: client(req.client),
      income: income(req.lines),
      payment,
      ...(req.notes ? { remarks: req.notes } : {}),
    };
    try {
      return await this.create({ type: MORNING_DOC.invoiceReceipt, ...body });
    } catch (e) {
      // 2403: this document type is not supported for the business (an exempt dealer issues receipts only).
      if (e instanceof MorningError && Number(e.code) === 2403)
        return this.create({ type: MORNING_DOC.receipt, ...body });
      throw e;
    }
  }

  async issueTaxInvoice(
    _ctx: ProviderContext,
    req: { client: Client; lines: FiscalLine[]; dueOn: string; notes?: string },
  ) {
    return this.create({
      type: MORNING_DOC.taxInvoice,
      dueDate: req.dueOn,
      client: client(req.client),
      income: income(req.lines),
      ...(req.notes ? { remarks: req.notes } : {}),
    });
  }

  async issueReceipt(
    _ctx: ProviderContext,
    req: { client: Client; invoiceDocumentId: string; amount: Agorot; paymentMethod: string },
  ) {
    return this.create({
      type: MORNING_DOC.receipt,
      client: client(req.client),
      // Linking the receipt to the invoice closes the invoice in Morning.
      linkedDocumentIds: [req.invoiceDocumentId],
      linkType: 'link',
      payment: [
        {
          date: today(this.now()),
          price: shekels(req.amount),
          currency: 'ILS',
          ...morningPayment(req.paymentMethod),
        },
      ],
    });
  }

  async issueCreditNote(
    _ctx: ProviderContext,
    req: { originalDocumentId: string; lines: FiscalLine[] },
  ) {
    const r = await this.create({
      type: MORNING_DOC.creditNote,
      linkedDocumentIds: [req.originalDocumentId],
      linkType: 'cancel',
      income: income(req.lines),
    });
    return { documentId: r.documentId, number: r.number };
  }
}

/**
 * Whether Morning's real adapter may run in this process: only with `RSWIM_MORNING_LIVE=1` (after a test in Morning's
 * sandbox). `MORNING_SANDBOX=1` sends the calls to Morning's sandbox hosts.
 */
export function invoicingLive(
  kind: InvoicingKind,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return kind === 'morning' && env.RSWIM_MORNING_LIVE === '1';
}

export function createInvoicing(
  kind: InvoicingKind,
  creds: InvoicingCredentials,
  opts: { env?: Record<string, string | undefined>; morning?: MorningOptions } = {},
): MorningInvoicing {
  const env = opts.env ?? process.env;
  if (!invoicingLive(kind, env)) throw new InvoicingNotLiveError(kind);
  return new MorningInvoicing(creds, { sandbox: env.MORNING_SANDBOX === '1', ...opts.morning });
}

/** The platform's own Morning account (tax invoice-receipts to schools), from the worker's environment. */
export function platformMorningCredentials(
  env: Record<string, string | undefined> = process.env,
): InvoicingCredentials | null {
  const apiKeyId = env.PLATFORM_MORNING_API_KEY_ID;
  const apiKeySecret = env.PLATFORM_MORNING_API_KEY_SECRET;
  return apiKeyId && apiKeySecret ? { apiKeyId, apiKeySecret } : null;
}
