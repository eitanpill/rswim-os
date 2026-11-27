/**
 * PayPlus (REST API v1.0, https://docs.payplus.co.il, read 2026-11-27) as a business's own processor. The owner enters
 * the API key, the secret key, the payment page's uid, the terminal's uid and the cashier's uid from PayPlus's
 * dashboard; customers pay on PayPlus's hosted page (`PaymentPages/generateLink`) by card or Bit, or save a card for a
 * standing order, which we then charge every month by token (`Transactions/Charge`). PayPlus issues the receipt for
 * each payment (its Invoice+ module, `initial_invoice`).
 *
 * PayPlus signs its callback: a `hash` header with base64 HMAC-SHA256 of the body under the secret key, and the user
 * agent `PayPlus`. We check the hash against the raw body (and, as PayPlus's own sample does, against the body
 * serialized again), then read the transaction and our reference (`more_info`).
 *
 * Every call carries the `api-key` and `secret-key` headers. Not yet checked against a real terminal: where the
 * callback reports the saved card's token (the callback schema shows none; we read `card_information.token` as the
 * refund answer has it), whether the hash covers the raw bytes, whether a page with Invoice+ off refuses
 * `initial_invoice`, and an idempotency guard for a token charge (none documented: see `chargeStandingOrder`).
 * `docs/payments/PAYPLUS.md` lists what to try in PayPlus's staging before going live.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

export const PAYPLUS_BASE_URL = 'https://restapi.payplus.co.il/api/v1.0';
export const PAYPLUS_STAGING_URL = 'https://restapidev.payplus.co.il/api/v1.0';

export interface PayPlusCredentials {
  apiKey: string;
  secretKey: string;
  paymentPageUid: string;
  terminalUid: string;
  cashierUid: string;
}

export interface PayPlusOptions {
  baseUrl?: string;
  /** Injected in tests (recorded PayPlus answers); the global fetch otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class PayPlusError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: string,
    message: string,
  ) {
    super(`payplus ${endpoint}: ${message}`);
  }
}

// ─── PayPlus's answers, as much of them as we read ──────────────────────────

const optStr = z.string().nullish();
const optNum = z.coerce.number().nullish();

const Results = z.object({
  status: z.string(),
  code: z.coerce.number().nullish(),
  description: optStr,
});

const GenerateLinkResponse = z.object({
  results: Results,
  data: z.object({ page_request_uid: z.string(), payment_page_link: z.url() }).nullish(),
});

const Transaction = z.object({
  uid: z.string(),
  payment_request_uid: optStr,
  status_code: z.coerce.string(),
  amount: optNum,
  more_info: optStr,
});

const CardInformation = z
  .object({
    token: optStr,
    four_digits: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

const TransactionData = z
  .object({
    customer_uid: optStr,
    card_information: CardInformation.nullish(),
    token_uid: optStr,
  })
  .passthrough();

/** The callback PayPlus posts to `refURL_callback`. */
const Callback = z.object({
  transaction_type: optStr,
  transaction: Transaction,
  data: TransactionData.nullish(),
});

/** A charge's and a refund's answer. */
const TransactionResponse = z.object({
  results: Results,
  data: z.object({ transaction: Transaction.nullish(), data: TransactionData.nullish() }).nullish(),
});

const PaymentPagesList = z.union([
  z.array(z.object({ uid: z.string() }).passthrough()),
  z.object({ data: z.array(z.object({ uid: z.string() }).passthrough()) }),
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

export const payplusShekels = (a: number) => Math.round(a) / 100;
export const payplusAgorot = (shekels: number): Agorot => agorot(Math.round(shekels * 100));

/** Our reference and the chosen method travel together in `more_info` and come back in the callback. */
export function payplusMoreInfo(reference: string, method: CheckoutMethod) {
  return `${reference}|${method}`;
}

const MoreInfo = z
  .string()
  .transform((s) => s.split('|'))
  .pipe(z.tuple([z.uuid(), z.enum(['card', 'bit', 'standing_order'])]));

/** A token charge needs the card's token and the customer's uid at PayPlus: we keep both as the mandate id. */
export function payplusMandateId(customerUid: string, token: string) {
  return `payplus:${customerUid}:${token}`;
}

export function parsePayPlusMandate(
  mandateId: string,
): { customerUid: string; token: string } | null {
  const m = /^payplus:([A-Za-z0-9-]{8,64}):([A-Za-z0-9-]{8,64})$/.exec(mandateId);
  const [, customerUid, token] = m ?? [];
  return customerUid && token ? { customerUid, token } : null;
}

const APPROVED = /^0+$/;

/** PayPlus's signature of a body: base64 HMAC-SHA256 under the secret key. */
export function payplusSignature(body: string, secretKey: string) {
  return createHmac('sha256', secretKey).update(body, 'utf8').digest('base64');
}

function sameBase64(a: string, b: string) {
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  return x.length === 32 && x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Whether a callback is PayPlus's: its `hash` matches the raw body, or the body serialized again (PayPlus's own
 * sample hashes `JSON.stringify(body)`), and it came with PayPlus's user agent.
 */
export function payplusSigned(rawBody: string, headers: Headers, secretKey: string): boolean {
  const hash = headers.get('hash');
  if (!hash || !/^[A-Za-z0-9+/]{43}=$/.test(hash)) return false;
  if (!/payplus/i.test(headers.get('user-agent') ?? '')) return false;
  if (sameBase64(payplusSignature(rawBody, secretKey), hash)) return true;
  try {
    return sameBase64(payplusSignature(JSON.stringify(JSON.parse(rawBody)), secretKey), hash);
  } catch {
    return false;
  }
}

/** Our payment's placeholder id when PayPlus gave none: unique per charge (a payment's external id is unique). */
export const payplusPlaceholderId = (kind: 'none' | 'unconfirmed', idempotencyKey: string) =>
  `payplus_${kind}:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;

const last4 = (c: z.infer<typeof CardInformation> | null | undefined) => {
  const digits = c?.four_digits == null ? '' : String(c.four_digits).replace(/\D/g, '');
  return digits ? digits.slice(-4).padStart(4, '0') : null;
};

// ─── The client ─────────────────────────────────────────────────────────────

export class PayPlusClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly creds: PayPlusCredentials,
    opts: PayPlusOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? PAYPLUS_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    body: Record<string, unknown> | null,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/${endpoint}`, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'api-key': this.creds.apiKey,
        'secret-key': this.creds.secretKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403)
      throw new PayPlusError(endpoint, 'auth_failed', `HTTP ${res.status}`);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON (PayPlus answers some errors in plain text) */
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new PayPlusError(
        endpoint,
        res.ok ? 'unexpected' : 'refused',
        `HTTP ${res.status} ${text.slice(0, 120)}`,
      );
    return parsed.data;
  }

  generateLink(req: {
    chargeMethod: 1 | 5;
    createToken: boolean;
    amount: number;
    moreInfo: string;
    description: string;
    method: CheckoutMethod;
    successUrl: string;
    failureUrl: string;
    cancelUrl: string;
    callbackUrl: string;
    customer?: { name?: string; phone?: string; email?: string };
  }) {
    const bit = req.method === 'bit';
    return this.request(
      'POST',
      'PaymentPages/generateLink',
      {
        payment_page_uid: this.creds.paymentPageUid,
        amount: req.amount,
        currency_code: 'ILS',
        charge_method: req.chargeMethod,
        create_token: req.createToken,
        // PayPlus's Invoice+ issues the receipt (a token check charges nothing, so it issues none).
        initial_invoice: req.chargeMethod === 1,
        sendEmailApproval: false,
        sendEmailFailure: false,
        send_failure_callback: true,
        payments: 1,
        language_code: 'he',
        charge_default: bit ? 'bit' : 'credit-card',
        allowed_charge_methods: bit ? ['bit'] : ['credit-card'],
        hide_other_charge_methods: true,
        refURL_success: req.successUrl,
        refURL_failure: req.failureUrl,
        refURL_cancel: req.cancelUrl,
        refURL_callback: req.callbackUrl,
        more_info: req.moreInfo,
        customer: Object.fromEntries(
          Object.entries({
            customer_name: req.customer?.name,
            phone: req.customer?.phone,
            email: req.customer?.email,
          }).filter(([, v]) => v),
        ),
        items: [
          { name: req.description.slice(0, 200), quantity: 1, price: req.amount, vat_type: 0 },
        ],
      },
      GenerateLinkResponse,
    );
  }

  chargeToken(req: {
    customerUid: string;
    token: string;
    amount: number;
    description: string;
    ref: string;
  }) {
    return this.request(
      'POST',
      'Transactions/Charge',
      {
        terminal_uid: this.creds.terminalUid,
        cashier_uid: this.creds.cashierUid,
        amount: req.amount,
        currency_code: 'ILS',
        credit_terms: 1,
        use_token: true,
        token: req.token,
        customer_uid: req.customerUid,
        initial_invoice: true,
        more_info_1: req.ref,
        products: [
          { name: req.description.slice(0, 200), quantity: 1, price: req.amount, vat_type: 0 },
        ],
      },
      TransactionResponse,
    );
  }

  refund(transactionUid: string, amount: number) {
    return this.request(
      'POST',
      'Transactions/RefundByTransactionUID',
      { transaction_uid: transactionUid, amount, initial_invoice: true },
      TransactionResponse,
    );
  }

  /** Proves the keys work and that the payment page belongs to the terminal: the terminal's page list. */
  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const r = await this.request(
        'GET',
        `PaymentPages/list/?terminal_uid=${encodeURIComponent(this.creds.terminalUid)}`,
        null,
        PaymentPagesList,
      );
      const pages = Array.isArray(r) ? r : r.data;
      return pages.some((p) => p.uid === this.creds.paymentPageUid)
        ? { ok: true }
        : { ok: false, reason: 'payplus_page_not_on_terminal' };
    } catch (e) {
      if (e instanceof PayPlusError)
        return {
          ok: false,
          reason: e.reason === 'auth_failed' ? 'auth_failed' : `payplus_${e.reason}`,
        };
      return { ok: false, reason: 'unreachable' };
    }
  }
}

/** The owner's fields (strings, as the connection screen saves them) as PayPlus credentials. */
export function payplusCredentials(creds: GatewayCredentials): PayPlusCredentials {
  return {
    apiKey: creds.apiKey ?? '',
    secretKey: creds.secretKey ?? '',
    paymentPageUid: creds.paymentPageUid ?? '',
    terminalUid: creds.terminalUid ?? '',
    cashierUid: creds.cashierUid ?? '',
  };
}

// ─── A business's own processor ─────────────────────────────────────────────

export class PayPlusGateway implements PaymentGateway {
  readonly kind = 'payplus' as const;
  readonly client: PayPlusClient;

  constructor(creds: GatewayCredentials, opts: PayPlusOptions = {}) {
    this.client = new PayPlusClient(payplusCredentials(creds), opts);
  }

  testConnection() {
    return this.client.check();
  }

  /**
   * Opens PayPlus's page for one way to pay: a card charge, a Bit charge, or a card charge that also saves the card
   * for a standing order (a token check, J2, when nothing is owed now).
   */
  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    const saveCard = req.method === 'standing_order';
    const tokenOnly = saveCard && req.amount <= 0;
    const page = await this.client.generateLink({
      chargeMethod: tokenOnly ? 5 : 1,
      createToken: saveCard,
      amount: tokenOnly ? 0 : payplusShekels(req.amount),
      moreInfo: payplusMoreInfo(req.reference, req.method),
      description: req.description,
      method: req.method,
      successUrl: req.successUrl,
      failureUrl: req.cancelUrl,
      cancelUrl: req.cancelUrl,
      callbackUrl: req.notifyUrl,
      customer: {
        name: req.customer.name,
        phone: req.customer.phoneE164,
        email: req.customer.email,
      },
    });
    if (page.results.status !== 'success' || !page.data)
      throw new PayPlusError(
        'PaymentPages/generateLink',
        'refused',
        (page.results.description ?? page.results.status).slice(0, 200),
      );
    return { redirectUrl: page.data.payment_page_link, externalId: page.data.page_request_uid };
  }

  async readWebhook(rawBody: string, headers: Headers): Promise<GatewayEvent | null> {
    if (!payplusSigned(rawBody, headers, this.client.creds.secretKey)) return null;
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const cb = Callback.safeParse(json);
    if (!cb.success) return null;
    const { transaction: t, data } = cb.data;
    const ref = MoreInfo.safeParse(t.more_info);
    if (!ref.success) return null;
    const [reference, method] = ref.data;
    const base = {
      eventId: `payplus:${t.uid}`,
      reference,
      method,
      externalPaymentId: t.uid,
      occurredAt: new Date().toISOString(),
    };
    if (!APPROVED.test(t.status_code))
      return {
        ...base,
        type: 'checkout.failed',
        amountAgorot: 0,
        failureReason: `payplus_${t.status_code}`.slice(0, 200),
      };
    const token = data?.card_information?.token ?? data?.token_uid;
    const mandate =
      method === 'standing_order' && token && data?.customer_uid
        ? {
            mandateId: payplusMandateId(data.customer_uid, token),
            cardLast4: last4(data.card_information) ?? '0000',
          }
        : undefined;
    return {
      ...base,
      type: 'checkout.paid',
      amountAgorot: t.amount != null ? payplusAgorot(t.amount) : 0,
      ...(mandate ? { mandate } : {}),
    };
  }

  /**
   * Charges a saved card by token. PayPlus documents no idempotency key for a charge, so a call whose answer never
   * arrived is not sent again (that could charge twice): it comes back `pending` for the office to check in PayPlus.
   */
  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    const none = payplusPlaceholderId('none', ctx.idempotencyKey);
    const m = parsePayPlusMandate(req.mandateId);
    if (!m) return { externalPaymentId: none, status: 'failed', failureReason: 'bad_mandate' };
    try {
      const r = await this.client.chargeToken({
        ...m,
        amount: payplusShekels(req.amount),
        description: req.description,
        ref: none.slice('payplus_none:'.length),
      });
      const t = r.data?.transaction;
      if (r.results.status === 'success' && t && APPROVED.test(t.status_code))
        return { externalPaymentId: t.uid, status: 'succeeded' };
      return {
        externalPaymentId: t?.uid ?? none,
        status: 'failed',
        failureReason: `payplus_${t?.status_code ?? r.results.code ?? 'declined'}`.slice(0, 200),
      };
    } catch (e) {
      if (e instanceof PayPlusError && e.reason !== 'unexpected')
        return { externalPaymentId: none, status: 'failed', failureReason: `payplus_${e.reason}` };
      return {
        externalPaymentId: payplusPlaceholderId('unconfirmed', ctx.idempotencyKey),
        status: 'pending',
        failureReason: 'payplus_unconfirmed',
      };
    }
  }

  /** Links go through our own payment page (`/pay/<token>`, a checkout); a bare link is never asked of a gateway. */
  async createPaymentLink(_ctx: ProviderContext, _req: PaymentLinkRequest): Promise<never> {
    throw new PayPlusError('link', 'use_checkout', 'use a checkout');
  }

  /** A standing order needs the customer's card on PayPlus's page (a `standing_order` checkout). */
  async createStandingOrder(): Promise<never> {
    throw new PayPlusError('standing_order', 'use_checkout', 'use a standing_order checkout');
  }

  /** A token at PayPlus is only charged when we ask: cancelling is ours to record, nothing to call. */
  async cancelStandingOrder(): Promise<void> {}

  async refund(_ctx: ProviderContext, req: { externalPaymentId: string; amount: Agorot }) {
    const r = await this.client.refund(req.externalPaymentId, payplusShekels(req.amount));
    const t = r.data?.transaction;
    if (r.results.status !== 'success' || !t || !APPROVED.test(t.status_code))
      throw new PayPlusError(
        'Transactions/RefundByTransactionUID',
        'refused',
        `status ${t?.status_code ?? r.results.status}`,
      );
    return { externalRefundId: t.uid };
  }
}
