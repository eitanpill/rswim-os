/**
 * Tranzila (https://docs.tranzila.com, read 2026-11-27) as a business's own processor. The owner enters the terminal
 * name and the API application key and secret from my.tranzila; customers pay on Tranzila's hosted page (DirectNG,
 * `directng.tranzila.com/<terminal>/iframenew.php`) by card or Bit, or save a card for a standing order (the terminal's
 * Token module), which we then charge every month by token (`/v1/transaction/credit_card/create`).
 *
 * Each page is opened with a handshake (`/v2/handshake/create`): Tranzila keeps the amount, so a page cannot be paid
 * for less than we asked. Tranzila does not sign its notify call. We never trust its body: it only names the
 * transaction's index and our reference, and we read that transaction from Tranzila's reports API with our own keys
 * (`report.tranzila.com/v1/transaction`), taking the result, the amount and the token from there.
 *
 * API calls carry `X-tranzila-api-app-key`, `-request-time`, `-nonce` and `-access-token` (HMAC-SHA256 of the app key
 * under secret + time + nonce, lowercase hex). Not yet checked against a real terminal: whether the notify echoes our
 * own field (`rswim_ref`; we also read it from the end of `pdesc`), whether the notify's `index` is the reports API's
 * `transaction_index`, the token charge's `items` shape, and whether a page with the Token module returns `TranzilaTK` on
 * a plain charge. Refunds are made in Tranzila. `docs/payments/TRANZILA.md` lists what to try before going live.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
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

export const TRANZILA_API_URL = 'https://api.tranzila.com';
export const TRANZILA_REPORTS_URL = 'https://report.tranzila.com';
export const TRANZILA_PAGE_URL = 'https://directng.tranzila.com';

export interface TranzilaCredentials {
  terminalName: string;
  appKey: string;
  secretKey: string;
}

export interface TranzilaOptions {
  apiUrl?: string;
  reportsUrl?: string;
  pageUrl?: string;
  /** Injected in tests (recorded Tranzila answers); the global fetch otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Injected in tests: the request time (seconds) and nonce of the next call. */
  clock?: () => { time: number; nonce: string };
}

export class TranzilaError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: string,
    message: string,
  ) {
    super(`tranzila ${endpoint}: ${message}`);
  }
}

// ─── Tranzila's answers, as much of them as we read ─────────────────────────

const optStr = z.coerce.string().nullish();
const optNum = z.coerce.number().nullish();

const Handshake = z.object({
  error_code: z.coerce.number(),
  message: z.string().nullish(),
  thtk: z.string().nullish(),
});

const ReportTransaction = z
  .object({
    index: z.coerce.string(),
    amount: optNum,
    credit_card_token: optStr,
    expiration_month: optStr,
    expiration_year: optStr,
    processor_response_code: z.coerce.string(),
    authorization_number: optStr,
    card_description: optStr,
    tranmode: optStr,
  })
  .passthrough();
export type TranzilaReportTransaction = z.infer<typeof ReportTransaction>;

const Report = z.object({ transactions: z.array(ReportTransaction) });

const ChargeResponse = z.object({
  error_code: z.coerce.number(),
  message: z.string().nullish(),
  transaction_result: z
    .object({
      processor_response_code: z.coerce.string(),
      transaction_id: optStr,
      auth_number: optStr,
    })
    .passthrough()
    .nullish(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

export const tranzilaShekels = (a: number) => Math.round(a) / 100;
export const tranzilaAgorot = (shekels: number): Agorot => agorot(Math.round(shekels * 100));

/** The API's access token: HMAC-SHA256 of the app key under secret + request time + nonce, lowercase hex. */
export function tranzilaAccessToken(
  appKey: string,
  secretKey: string,
  time: number,
  nonce: string,
) {
  return createHmac('sha256', `${secretKey}${time}${nonce}`).update(appKey).digest('hex');
}

/** Our reference and the chosen method, as the page carries them back. */
export function tranzilaRef(reference: string, method: CheckoutMethod) {
  return `${reference}|${method}`;
}

const REF =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|(card|bit|standing_order)$/i;

function readRef(v: string | null | undefined) {
  const m = v ? REF.exec(v.trim()) : null;
  const [, reference, method] = m ?? [];
  return reference && method
    ? { reference: reference.toLowerCase(), method: method as CheckoutMethod }
    : null;
}

/** A saved card is the token plus its expiry, both needed to charge it: `tranzila:<token>:<MMYY>`. */
export function tranzilaMandateId(token: string, month: string | number, year: string | number) {
  const mm = String(month).padStart(2, '0');
  const yy = String(year).slice(-2).padStart(2, '0');
  return `tranzila:${token}:${mm}${yy}`;
}

export function parseTranzilaMandate(
  mandateId: string,
): { token: string; month: string; year: string } | null {
  const m = /^tranzila:([A-Za-z0-9]{6,40}):(\d{2})(\d{2})$/.exec(mandateId);
  const [, token, month, year] = m ?? [];
  return token && month && year ? { token, month, year } : null;
}

/** A short, stable duplicate-check value from our idempotency key (Tranzila's `DCdisable`, max 254). */
export const tranzilaDuplicateKey = (idempotencyKey: string) =>
  `rs${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 30)}`;

/** Our payment's placeholder id when Tranzila gave none: unique per charge (a payment's external id is unique). */
export const tranzilaPlaceholderId = (kind: 'none' | 'unconfirmed', idempotencyKey: string) =>
  `tranzila_${kind}:${tranzilaDuplicateKey(idempotencyKey).slice(2, 26)}`;

/** The notify body (a form post, or JSON): only the index and our reference are read from it. */
export function tranzilaNotify(
  rawBody: string,
): { index: string; reference: string; method: CheckoutMethod } | null {
  let get: (k: string) => string | null;
  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    if (!json || typeof json !== 'object') return null;
    get = (k) => (json[k] == null ? null : String(json[k]));
  } catch {
    const form = new URLSearchParams(rawBody);
    get = (k) => form.get(k);
  }
  const index = get('index');
  const ref = readRef(get('rswim_ref')) ?? readRef(get('pdesc'));
  if (!index || !/^\d{1,18}$/.test(index) || !ref) return null;
  return { index, ...ref };
}

// ─── The client ─────────────────────────────────────────────────────────────

export class TranzilaClient {
  private readonly apiUrl: string;
  private readonly reportsUrl: string;
  readonly pageUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly clock: () => { time: number; nonce: string };

  constructor(
    readonly creds: TranzilaCredentials,
    opts: TranzilaOptions = {},
  ) {
    this.apiUrl = (opts.apiUrl ?? TRANZILA_API_URL).replace(/\/$/, '');
    this.reportsUrl = (opts.reportsUrl ?? TRANZILA_REPORTS_URL).replace(/\/$/, '');
    this.pageUrl = (opts.pageUrl ?? TRANZILA_PAGE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.clock =
      opts.clock ??
      (() => ({ time: Math.floor(Date.now() / 1000), nonce: randomBytes(40).toString('hex') }));
  }

  async post<T>(
    url: string,
    endpoint: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { time, nonce } = this.clock();
    const res = await this.fetchFn(`${url}/${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-tranzila-api-app-key': this.creds.appKey,
        'X-tranzila-api-request-time': String(time),
        'X-tranzila-api-nonce': nonce,
        'X-tranzila-api-access-token': tranzilaAccessToken(
          this.creds.appKey,
          this.creds.secretKey,
          time,
          nonce,
        ),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403)
      throw new TranzilaError(endpoint, 'auth_failed', `HTTP ${res.status}`);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new TranzilaError(endpoint, res.ok ? 'unexpected' : 'refused', `HTTP ${res.status}`);
    return parsed.data;
  }

  /** Tranzila keeps the page's amount for 20 minutes; the page must be paid for exactly that sum. */
  async handshake(sum: number): Promise<string> {
    const r = await this.post(
      this.apiUrl,
      'v2/handshake/create',
      { terminal_name: this.creds.terminalName, sum },
      Handshake,
    );
    if (r.error_code !== 0 || !r.thtk)
      throw new TranzilaError(
        'v2/handshake/create',
        r.error_code === 401 ? 'auth_failed' : 'refused',
        `code ${r.error_code}`,
      );
    return r.thtk;
  }

  async transaction(index: string): Promise<TranzilaReportTransaction | null> {
    const r = await this.post(
      this.reportsUrl,
      'v1/transaction',
      { terminal_name: this.creds.terminalName, transaction_index: Number(index) },
      Report,
    );
    return r.transactions.find((t) => t.index === index) ?? null;
  }

  chargeToken(req: {
    token: string;
    month: string;
    year: string;
    amount: number;
    description: string;
    duplicateKey: string;
  }) {
    return this.post(
      this.apiUrl,
      'v1/transaction/credit_card/create',
      {
        terminal_name: this.creds.terminalName,
        txn_type: 'debit',
        // A token stands in for the card number.
        card_number: req.token,
        expire_month: Number(req.month),
        expire_year: 2000 + Number(req.year),
        items: [
          {
            name: req.description.slice(0, 100),
            type: 'I',
            unit_price: req.amount,
            units_number: 1,
          },
        ],
        // Tranzila refuses a second charge with the same value within 24 hours (when set up on the terminal).
        user_defined_fields: [{ name: 'DCdisable', value: req.duplicateKey }],
      },
      ChargeResponse,
    );
  }

  /** A harmless call that proves the terminal and keys work: a ₪1 handshake nobody pays. */
  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.handshake(1);
      return { ok: true };
    } catch (e) {
      if (e instanceof TranzilaError)
        return {
          ok: false,
          reason: e.reason === 'auth_failed' ? 'auth_failed' : `tranzila_${e.reason}`,
        };
      return { ok: false, reason: 'unreachable' };
    }
  }
}

export function tranzilaCredentials(creds: GatewayCredentials): TranzilaCredentials {
  const terminalName = creds.terminalName ?? '';
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(terminalName))
    throw new TranzilaError('credentials', 'bad_terminal', 'bad terminal name');
  return { terminalName, appKey: creds.appKey ?? '', secretKey: creds.secretKey ?? '' };
}

const APPROVED = /^0+$/;

// ─── A business's own processor ─────────────────────────────────────────────

export class TranzilaGateway implements PaymentGateway {
  readonly kind = 'tranzila' as const;
  readonly client: TranzilaClient;

  constructor(creds: GatewayCredentials, opts: TranzilaOptions = {}) {
    this.client = new TranzilaClient(tranzilaCredentials(creds), opts);
  }

  testConnection() {
    return this.client.check();
  }

  /**
   * Opens Tranzila's page for a card charge, a Bit charge, or a card charge that also leaves a token for a standing
   * order (a J2 check of ₪1, not charged, when nothing is owed now).
   */
  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    const verifyOnly = req.method === 'standing_order' && req.amount <= 0;
    const sum = verifyOnly ? 1 : tranzilaShekels(req.amount);
    const thtk = await this.client.handshake(sum);
    const ref = tranzilaRef(req.reference, req.method);
    const params = new URLSearchParams({
      sum: String(sum),
      currency: '1',
      cred_type: '1',
      tranmode: verifyOnly ? 'N' : 'A',
      lang: 'il',
      thtk,
      success_url_address: req.successUrl,
      fail_url_address: req.cancelUrl,
      notify_url_address: req.notifyUrl,
      // Our reference, in our own field and (in case the terminal echoes only its known fields) the description.
      rswim_ref: ref,
      pdesc: `${req.description.slice(0, 120)} ${ref}`,
      contact: req.customer.name,
      ...(req.customer.email ? { email: req.customer.email } : {}),
      ...(req.customer.phoneE164 ? { phone: req.customer.phoneE164 } : {}),
      ...(req.method === 'bit' ? { bit_pay: '1' } : {}),
      ...(verifyOnly ? { hidesum: '1' } : {}),
    });
    const url = `${this.client.pageUrl}/${encodeURIComponent(this.client.creds.terminalName)}/iframenew.php?${params.toString()}`;
    return { redirectUrl: url, externalId: `tranzila:${thtk.slice(0, 60)}` };
  }

  async readWebhook(rawBody: string): Promise<GatewayEvent | null> {
    const n = tranzilaNotify(rawBody);
    if (!n) return null;
    // Everything but the index and our reference comes from Tranzila's own report, read with our keys.
    const t = await this.client.transaction(n.index);
    if (!t) return null;
    const base = {
      eventId: `tranzila:${t.index}`,
      reference: n.reference,
      method: n.method,
      externalPaymentId: t.index,
      occurredAt: new Date().toISOString(),
    };
    if (!APPROVED.test(t.processor_response_code))
      return {
        ...base,
        type: 'checkout.failed',
        amountAgorot: 0,
        failureReason: `tranzila_${t.processor_response_code}`.slice(0, 200),
      };
    const mandate =
      n.method === 'standing_order' &&
      t.credit_card_token &&
      t.expiration_month &&
      t.expiration_year
        ? {
            mandateId: tranzilaMandateId(
              t.credit_card_token,
              t.expiration_month,
              t.expiration_year,
            ),
            cardLast4: /(\d{4})\D*$/.exec(t.card_description ?? '')?.[1] ?? '0000',
          }
        : undefined;
    // A J2 check (₪1, not charged) pays nothing.
    const verifyOnly =
      n.method === 'standing_order' && t.amount === 1 && /N/.test(t.tranmode ?? '');
    return {
      ...base,
      type: 'checkout.paid',
      amountAgorot: verifyOnly || t.amount == null ? 0 : tranzilaAgorot(t.amount),
      ...(mandate ? { mandate } : {}),
    };
  }

  /**
   * Charges a saved token. `DCdisable` asks Tranzila to refuse a repeat, but only on a terminal set up for it, so a
   * call whose answer never arrived is not sent again: it comes back `pending` for the office to check in Tranzila.
   */
  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    const none = tranzilaPlaceholderId('none', ctx.idempotencyKey);
    const m = parseTranzilaMandate(req.mandateId);
    if (!m) return { externalPaymentId: none, status: 'failed', failureReason: 'bad_mandate' };
    try {
      const r = await this.client.chargeToken({
        ...m,
        amount: tranzilaShekels(req.amount),
        description: req.description,
        duplicateKey: tranzilaDuplicateKey(ctx.idempotencyKey),
      });
      const t = r.transaction_result;
      if (r.error_code === 0 && t?.transaction_id && APPROVED.test(t.processor_response_code))
        return { externalPaymentId: t.transaction_id, status: 'succeeded' };
      return {
        externalPaymentId: t?.transaction_id ?? none,
        status: 'failed',
        failureReason: `tranzila_${t?.processor_response_code ?? r.error_code}`.slice(0, 200),
      };
    } catch (e) {
      if (e instanceof TranzilaError && e.reason !== 'unexpected')
        return { externalPaymentId: none, status: 'failed', failureReason: `tranzila_${e.reason}` };
      return {
        externalPaymentId: tranzilaPlaceholderId('unconfirmed', ctx.idempotencyKey),
        status: 'pending',
        failureReason: 'tranzila_unconfirmed',
      };
    }
  }

  async createPaymentLink(_ctx: ProviderContext, _req: PaymentLinkRequest): Promise<never> {
    throw new TranzilaError('link', 'use_checkout', 'use a checkout');
  }

  async createStandingOrder(): Promise<never> {
    throw new TranzilaError('standing_order', 'use_checkout', 'use a standing_order checkout');
  }

  /** A token at Tranzila is only charged when we ask: cancelling is ours to record, nothing to call. */
  async cancelStandingOrder(): Promise<void> {}

  /** A refund needs the card's token and the authorization number of the charge: the office refunds in Tranzila. */
  async refund(): Promise<never> {
    throw new TranzilaError('refund', 'refund_in_tranzila', 'refund in Tranzila');
  }
}
