/**
 * Grow (Meshulam), a business's own processor, written from Grow's documentation
 * (https://developers.grow.business, read 2026-11-27). No test talks to Grow: tests answer with the documented shapes.
 *
 * - The owner enters the business's `userId` and `pageCode` (the card page) and, when Grow opened Bit for them, the
 *   Bit page's code. Grow gives each method its own page code.
 * - Grow asks a platform that serves many businesses for its own `apiKey` and a signed platform agreement. The key
 *   comes from the environment (`GROW_PLATFORM_API_KEY`), or from the connection when Grow gave the business one.
 *   Grow's pages do not name where the key goes; we send it as the `X-API-KEY` header (the only header Grow names).
 * - Grow does not sign its callback. We never trust its body: it only names a payment process, and we ask Grow for
 *   that process (`getPaymentProcessInfo`) with the business's own page code, then read the result from Grow's answer.
 *   After a paid process we acknowledge it (`approveTransaction`), as Grow asks.
 *
 * `docs/payments/GROW.md` lists what is not verified yet and what to try in Grow's sandbox before `RSWIM_GROW_LIVE=1`.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CheckoutMethod } from '@rswim/contracts';
import { agorot, type Agorot } from '@rswim/money';
import type {
  CheckoutRequest,
  CheckoutSession,
  GatewayCredentials,
  GatewayEvent,
  PaymentGateway,
} from './gateways';
import type { ChargeResult, PaymentLinkRequest, ProviderContext } from './index';

export const GROW_BASE_URL = 'https://secure.meshulam.co.il/api/light/server/1.0';
export const GROW_SANDBOX_URL = 'https://sandbox.meshulam.co.il/api/light/server/1.0';

export interface GrowCredentials {
  userId: string;
  pageCode: string;
  bitPageCode?: string;
  apiKey?: string;
}

export interface GrowOptions {
  baseUrl?: string;
  /** The platform's key from Grow (`GROW_PLATFORM_API_KEY`); a key saved on the connection wins. */
  platformApiKey?: string;
  /** Our public address, for the connection check's (never visited) return pages. */
  publicUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class GrowError extends Error {
  constructor(
    readonly endpoint: string,
    /** Grow's error id (its `err.id`), or the HTTP status when `http`. */
    readonly code: number | null,
    message: string,
    readonly http = false,
  ) {
    super(`grow ${endpoint}: ${message}`);
  }
}

// ─── Grow's answers ─────────────────────────────────────────────────────────

const str = z.union([z.string(), z.number()]).transform(String);
const optStr = str.optional().nullable();

/** Every answer: `status` 1 = the call worked (not the payment's result), `err` on failure. */
const Envelope = z.object({
  status: z.coerce.number(),
  err: z.union([z.string(), z.object({ id: z.coerce.number(), message: z.string() })]).optional(),
  data: z.unknown(),
});

const ProcessCreated = z.object({ processId: str, processToken: str, url: z.string().url() });

/** A transaction as Grow reports it (callback, process info, token charge, refund). */
export const GrowTransaction = z
  .object({
    transactionId: str,
    transactionToken: str,
    statusCode: z.coerce.number(),
    sum: z.coerce.number(),
    transactionTypeId: optStr,
    paymentType: optStr,
    cardSuffix: optStr,
    cardToken: optStr,
    processId: optStr,
    processToken: optStr,
    refundedTransactionId: optStr,
  })
  .passthrough();
export type GrowTransaction = z.infer<typeof GrowTransaction>;

const ProcessInfo = z
  .object({
    processId: optStr,
    processToken: optStr,
    customField: z.unknown().optional(),
    transactions: z.array(GrowTransaction).default([]),
  })
  .passthrough();

/** Grow's payment states we act on: 2 paid, 3 refunded, 11 held (a card saved without a charge). */
export const GROW_PAID = 2;
export const GROW_HELD = 11;

// ─── Small helpers ──────────────────────────────────────────────────────────

export const growSum = (a: number) => Math.round(a) / 100;
export const growAgorot = (shekels: number): Agorot => agorot(Math.round(shekels * 100));

/** Grow wants an Israeli mobile number as dialled locally (05XXXXXXXX). */
export function growPhone(e164: string | undefined): string | null {
  if (!e164) return null;
  const m = /^\+9725(\d{8})$/.exec(e164.replace(/[\s-]/g, ''));
  return m ? `05${m[1]}` : null;
}

/** Grow asks for at least two names; a one-word name is repeated rather than invented. */
export function growFullName(name: string): string {
  const clean =
    name
      .replace(/[^\p{L}\p{N} '-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'לקוח';
  return clean.includes(' ') ? clean : `${clean} ${clean}`;
}

/** Grow refuses special characters in free-text fields. */
const plain = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} .,'()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'תשלום';

/** A paid transaction as our payment id: a refund needs both of Grow's ids. */
export const growPaymentId = (t: { transactionId: string; transactionToken: string }) =>
  `${t.transactionId}:${t.transactionToken}`;

export function parseGrowPaymentId(
  id: string,
): { transactionId: string; transactionToken: string } | null {
  const [, transactionId, transactionToken] = /^(\d{1,20}):([A-Za-z0-9]{8,100})$/.exec(id) ?? [];
  return transactionId && transactionToken ? { transactionId, transactionToken } : null;
}

/**
 * A saved card, as the mandate id: a token charge needs the payer's name and phone again, so they travel with the
 * token (`grow1:<token>:<phone>:<base64url name>`).
 */
export function growMandateId(token: string, phone: string, fullName: string): string {
  return `grow1:${token}:${phone}:${Buffer.from(fullName, 'utf8').toString('base64url')}`;
}

export function parseGrowMandate(
  mandateId: string,
): { token: string; phone: string; fullName: string } | null {
  const [, token, phone, name] =
    /^grow1:([A-Za-z0-9]{8,100}):(05\d{8}):([A-Za-z0-9_-]{1,120})$/.exec(mandateId) ?? [];
  if (!token || !phone || !name) return null;
  return { token, phone, fullName: Buffer.from(name, 'base64url').toString('utf8') };
}

/** Grow rejects a repeated `transactionUniqueIdentifier`: ours is a hash of our idempotency key. */
export const growUniqueId = (idempotencyKey: string) =>
  createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40);

/** Reads Grow's callback body (a form, or JSON in tests and some setups) as flat fields; `data[x]` becomes `x`. */
export async function growCallbackFields(
  rawBody: string,
  headers: Headers,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    // `data[processId]` and `data[customFields][cField1]` are read by their last name.
    const key = /\[([^\]]+)\]$/.exec(k)?.[1] ?? k;
    if (typeof v === 'string' || typeof v === 'number') out[key] = String(v);
    else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) put(k2, v2);
  };
  const trimmed = rawBody.trim();
  if (trimmed.startsWith('{')) {
    try {
      put('', JSON.parse(trimmed));
    } catch {
      /* not JSON */
    }
    return out;
  }
  const type = headers.get('content-type') ?? 'application/x-www-form-urlencoded';
  try {
    const form = await new Response(rawBody, { headers: { 'content-type': type } }).formData();
    for (const [k, v] of form.entries()) if (typeof v === 'string') put(k, v);
  } catch {
    for (const [k, v] of new URLSearchParams(rawBody)) put(k, v);
  }
  return out;
}

/** Our checkout id and method, from the custom fields we gave the page. */
function referenceOf(
  fields: Record<string, unknown>,
): { reference: string; method: CheckoutMethod } | null {
  const reference = String(fields.cField1 ?? '');
  const method = String(fields.cField2 ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference))
    return null;
  if (method !== 'card' && method !== 'bit' && method !== 'standing_order') return null;
  return { reference, method };
}

/** Grow's `customField` on a process (its shape is not documented: an array or an object of cFieldN). */
function customFieldsOf(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.assign(out, x);
  };
  walk(v);
  return out;
}

// ─── The client ─────────────────────────────────────────────────────────────

export function growCredentials(creds: GatewayCredentials): GrowCredentials {
  if (!creds.userId || !creds.pageCode)
    throw new GrowError('credentials', null, 'missing userId or pageCode');
  return {
    userId: creds.userId,
    pageCode: creds.pageCode,
    ...(creds.bitPageCode ? { bitPageCode: creds.bitPageCode } : {}),
    ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
  };
}

export class GrowClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(
    readonly creds: GrowCredentials,
    opts: GrowOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? GROW_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.apiKey = creds.apiKey ?? opts.platformApiKey;
  }

  /** One POST of form fields; answers `data` when Grow says `status: 1`, throws with Grow's error id otherwise. */
  async post(
    endpoint: string,
    fields: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields))
      if (v !== undefined && v !== '') form.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const res = await this.fetchFn(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403)
      throw new GrowError(endpoint, res.status, 'auth_failed', true);
    const env = Envelope.safeParse(json);
    if (!res.ok || !env.success)
      throw new GrowError(endpoint, res.status, `http ${res.status}`, true);
    if (env.data.status !== 1) {
      const err = typeof env.data.err === 'object' ? env.data.err : null;
      throw new GrowError(endpoint, err?.id ?? null, err ? `error ${err.id}` : 'failed');
    }
    return env.data.data;
  }

  async createProcess(fields: Record<string, string | number | undefined>) {
    const data = await this.post('createPaymentProcess', { userId: this.creds.userId, ...fields });
    const parsed = ProcessCreated.safeParse(data);
    if (!parsed.success) throw new GrowError('createPaymentProcess', null, 'unexpected answer');
    return parsed.data;
  }

  async processInfo(pageCode: string, processId: string, processToken: string) {
    const data = await this.post('getPaymentProcessInfo', { pageCode, processId, processToken });
    const parsed = ProcessInfo.safeParse(data);
    if (!parsed.success) throw new GrowError('getPaymentProcessInfo', null, 'unexpected answer');
    return parsed.data;
  }
}

/** Grow error ids that mean the business's own details were refused (701: a bad userId, from Grow's docs). */
const AUTH_ERRORS = new Set([701]);

// ─── A business's own processor ─────────────────────────────────────────────

export class GrowGateway implements PaymentGateway {
  readonly kind = 'grow' as const;
  readonly client: GrowClient;
  private readonly publicUrl: string;

  constructor(creds: GatewayCredentials, opts: GrowOptions = {}) {
    this.client = new GrowClient(growCredentials(creds), opts);
    this.publicUrl = (opts.publicUrl ?? 'https://app.aqua-swim.co.il').replace(/\/$/, '');
  }

  /**
   * Grow has no harmless call: we open a ₪1 card page that nobody is sent to. Grow answering with a page means the
   * user id, the page code and the platform key work.
   */
  async testConnection(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.client.createProcess({
        pageCode: this.client.creds.pageCode,
        chargeType: 1,
        sum: 1,
        description: 'בדיקת חיבור',
        successUrl: `${this.publicUrl}/`,
        cancelUrl: `${this.publicUrl}/`,
        'pageField[fullName]': 'בדיקת חיבור',
        'pageField[phone]': '0500000000',
      });
      return { ok: true };
    } catch (e) {
      if (
        e instanceof GrowError &&
        (e.http ? e.code === 401 || e.code === 403 : AUTH_ERRORS.has(e.code ?? -1))
      )
        return { ok: false, reason: 'auth_failed' };
      return {
        ok: false,
        reason: e instanceof GrowError ? `grow_${e.code ?? 'error'}` : 'grow_error',
      };
    }
  }

  /**
   * Opens Grow's page for one way to pay: the card page, the Bit page, or the card page saving the card for a
   * standing order (a charge now with the token, or Grow's token-only page at ₪1 when nothing is due now).
   */
  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    const phone = growPhone(req.customer.phoneE164);
    if (!phone) throw new GrowError('createPaymentProcess', null, 'phone_required');
    const { creds } = this.client;
    if (req.method === 'bit' && !creds.bitPageCode)
      throw new GrowError('createPaymentProcess', null, 'bit_not_enabled');
    const saveCard = req.method === 'standing_order';
    const tokenOnly = saveCard && req.amount <= 0;
    const page = await this.client.createProcess({
      pageCode: req.method === 'bit' ? creds.bitPageCode : creds.pageCode,
      // 1 = a regular charge, 3 = only create a token (Grow asks for a sum of exactly 1 then).
      chargeType: tokenOnly ? 3 : 1,
      sum: tokenOnly ? 1 : growSum(req.amount),
      ...(saveCard ? { saveCardToken: 1 } : {}),
      description: plain(req.description),
      successUrl: req.successUrl,
      cancelUrl: req.cancelUrl,
      notifyUrl: req.notifyUrl,
      'pageField[fullName]': growFullName(req.customer.name),
      'pageField[phone]': phone,
      'pageField[email]': req.customer.email,
      cField1: req.reference,
      cField2: req.method,
    });
    // The process id stays on our side: Grow asks that it is never shown to the payer.
    return { redirectUrl: page.url, externalId: page.processId };
  }

  /**
   * Grow's callback names a process; we ask Grow about it with the business's own page code and read only Grow's
   * answer. Our checkout id comes from the process's custom fields as Grow reports them (the callback's own copy only
   * when Grow's answer has none; the amount is checked against our checkout either way).
   */
  async readWebhook(rawBody: string, headers: Headers): Promise<GatewayEvent | null> {
    const fields = await growCallbackFields(rawBody, headers);
    const processId = fields.processId;
    const processToken = fields.processToken;
    if (
      !processId ||
      !processToken ||
      !/^\d{1,20}$/.test(processId) ||
      !/^[A-Za-z0-9]{8,100}$/.test(processToken)
    )
      return null;
    const { creds } = this.client;
    const pages = [creds.pageCode, creds.bitPageCode].filter((p): p is string => !!p);
    let info: z.infer<typeof ProcessInfo> | null = null;
    let pageCode = '';
    for (const p of pages) {
      try {
        info = await this.client.processInfo(p, processId, processToken);
        pageCode = p;
        break;
      } catch (e) {
        // Grow refused this page code for the process (an error id): try the next page. Anything else is retried.
        if (!(e instanceof GrowError) || e.http || e.code === null) throw e;
      }
    }
    if (!info || (info.processId != null && info.processId !== processId)) return null;
    const ref = referenceOf(customFieldsOf(info.customField)) ?? referenceOf(fields);
    if (!ref) return null;
    const tran =
      info.transactions.find((t) => t.statusCode === GROW_PAID) ??
      info.transactions.find((t) => t.statusCode === GROW_HELD && !!t.cardToken);
    if (!tran) return null;

    const held = tran.statusCode === GROW_HELD;
    const mandate =
      ref.method === 'standing_order' && tran.cardToken
        ? {
            mandateId: growMandateId(
              tran.cardToken,
              String(tran.payerPhone ?? fields.payerPhone ?? '').replace(/\D/g, '') || '0500000000',
              String(tran.fullName ?? fields.fullName ?? 'לקוח לקוח'),
            ),
            cardLast4: /^\d{4}$/.test(String(tran.cardSuffix)) ? String(tran.cardSuffix) : '0000',
          }
        : undefined;
    if (!held) await this.approve(pageCode, tran, processId, processToken);
    return {
      eventId: `grow:${tran.transactionId}`,
      type: 'checkout.paid',
      reference: ref.reference,
      externalPaymentId: growPaymentId(tran),
      method: ref.method,
      // A held token-only page (₪1, chargeType 3) charged nothing.
      amountAgorot: held ? 0 : growAgorot(tran.sum),
      ...(mandate && parseGrowMandate(mandate.mandateId) ? { mandate } : {}),
      occurredAt: new Date().toISOString(),
    };
  }

  /** Grow asks for an acknowledgment after each paid process; the payment stands even when it fails. */
  private async approve(
    pageCode: string,
    t: GrowTransaction,
    processId: string,
    processToken: string,
  ) {
    const keys = [
      'transactionTypeId',
      'paymentType',
      'sum',
      'firstPaymentSum',
      'periodicalPaymentSum',
      'paymentsNum',
      'allPaymentsNum',
      'paymentDate',
      'asmachta',
      'description',
      'fullName',
      'payerPhone',
      'payerEmail',
      'cardSuffix',
      'cardType',
      'cardTypeCode',
      'cardBrand',
      'cardBrandCode',
      'cardExp',
    ] as const;
    const rec = t as Record<string, unknown>;
    const fields: Record<string, string> = {
      pageCode,
      transactionId: t.transactionId,
      transactionToken: t.transactionToken,
      processId,
      processToken,
    };
    for (const k of keys) fields[k] = rec[k] == null ? '' : String(rec[k]);
    try {
      await this.client.post('approveTransaction', fields);
    } catch {
      /* Grow processes the payment either way; its log review is what checks the acknowledgments. */
    }
  }

  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    const m = parseGrowMandate(req.mandateId);
    if (!m)
      return { externalPaymentId: 'grow_none', status: 'failed', failureReason: 'bad_mandate' };
    try {
      const data = await this.client.post('createTransactionWithToken', {
        userId: this.client.creds.userId,
        cardToken: m.token,
        sum: growSum(req.amount),
        description: plain(req.description),
        paymentType: 2,
        'pageField[fullName]': m.fullName,
        'pageField[phone]': m.phone,
        transactionUniqueIdentifier: growUniqueId(ctx.idempotencyKey),
      });
      const t = GrowTransaction.safeParse(data);
      if (t.success && t.data.statusCode === GROW_PAID)
        return { externalPaymentId: growPaymentId(t.data), status: 'succeeded' };
      return {
        externalPaymentId: t.success ? growPaymentId(t.data) : 'grow_none',
        status: 'failed',
        failureReason: t.success ? `grow_status_${t.data.statusCode}` : 'grow_unexpected',
      };
    } catch (e) {
      // Grow answered with a refusal (an error id): the charge did not happen. A network or HTTP error is retried.
      if (e instanceof GrowError && !e.http && e.code !== null)
        return {
          externalPaymentId: 'grow_none',
          status: 'failed',
          failureReason: `grow_${e.code}`,
        };
      throw e;
    }
  }

  /** Links go through our own payment page (a checkout), as for every processor. */
  async createPaymentLink(_ctx: ProviderContext, _req: PaymentLinkRequest): Promise<never> {
    throw new GrowError('link', null, 'use a checkout');
  }

  /** A standing order needs the customer's card on Grow's page (a `standing_order` checkout). */
  async createStandingOrder(): Promise<never> {
    throw new GrowError('standing_order', null, 'use a standing_order checkout');
  }

  /** A token is charged only when we ask: cancelling is ours to record. */
  async cancelStandingOrder(): Promise<void> {}

  async refund(_ctx: ProviderContext, req: { externalPaymentId: string; amount: Agorot }) {
    const p = parseGrowPaymentId(req.externalPaymentId);
    if (!p) throw new GrowError('refundTransaction', null, 'not a Grow transaction');
    const data = await this.client.post('refundTransaction', {
      userId: this.client.creds.userId,
      pageCode: this.client.creds.pageCode,
      transactionId: p.transactionId,
      transactionToken: p.transactionToken,
      refundSum: growSum(req.amount),
    });
    const t = z.object({ transactionId: str }).passthrough().safeParse(data);
    if (!t.success) throw new GrowError('refundTransaction', null, 'unexpected answer');
    return { externalRefundId: t.data.transactionId };
  }
}
