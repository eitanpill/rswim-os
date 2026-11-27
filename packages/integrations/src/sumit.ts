/**
 * SUMIT (formerly OfficeGuy, https://app.sumit.co.il/developers/api/) as a business's own processor. The owner enters
 * the company number and the API key from SUMIT's settings; customers pay on SUMIT's hosted page
 * (`billing/payments/beginredirect`) by card, or save a card for a standing order, which we then charge every month
 * through the customer's saved payment method at SUMIT. SUMIT issues the receipt for each payment itself.
 *
 * SUMIT does not sign its IPN callback. We never trust its body: it only names a payment id, and we ask SUMIT for that
 * payment with our own API key (`billing/payments/get`), then check that it carries the reference we gave the page
 * (`ExternalIdentifier`). A payment another company's key cannot read never reaches us.
 *
 * Every request carries `Credentials: { CompanyID, APIKey }` in its JSON body; answers are wrapped as
 * `{ Status, UserErrorMessage, TechnicalErrorDetails, Data }`. Field names follow SUMIT's published schema as quoted by
 * public integrations (read 2026-11-27); SUMIT's own swagger was not reachable from here. Not yet checked against a real
 * account: the IPN body's shape (we accept the usual spellings of the payment id), the payment method's last digits
 * field, Bit on the hosted page (not offered until checked), refunds over the API (none documented: the office refunds
 * in SUMIT), and a duplicate-charge guard (none documented: see `chargeStandingOrder`). `docs/payments/SUMIT.md` lists
 * what to try in a SUMIT test company before going live.
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

export const SUMIT_BASE_URL = 'https://api.sumit.co.il';

export interface SumitCredentials {
  companyId: number;
  apiKey: string;
}

export interface SumitOptions {
  baseUrl?: string;
  /** Injected in tests (recorded SUMIT answers); the global fetch otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SumitError extends Error {
  constructor(
    readonly endpoint: string,
    readonly reason: string,
    message: string,
  ) {
    super(`sumit ${endpoint}: ${message}`);
  }
}

// ─── SUMIT's answers, as much of them as we read ────────────────────────────

const optStr = z.string().nullish();
const optNum = z.coerce.number().nullish();

/** The outer wrapper: `Status` is "Success" (or 0) when the call itself worked, whatever the card said. */
const Envelope = z.object({
  Status: z.union([z.string(), z.number()]),
  UserErrorMessage: optStr,
  TechnicalErrorDetails: optStr,
  Data: z.unknown().nullish(),
});

const BeginRedirectData = z.object({ RedirectURL: z.url() });

const SumitPayment = z.object({
  ID: z.coerce.string(),
  CustomerID: optNum,
  ValidPayment: z.boolean().nullish(),
  Status: z.coerce.string().nullish(),
  StatusDescription: optStr,
  Amount: optNum,
  Currency: z.union([z.string(), z.number()]).nullish(),
  ExternalIdentifier: optStr,
  DocumentID: optNum,
  AuthNumber: optStr,
  PaymentMethod: z
    .object({
      CreditCard_LastDigits: z.union([z.string(), z.number()]).nullish(),
      CreditCard_CardMask: optStr,
    })
    .passthrough()
    .nullish(),
});
export type SumitPayment = z.infer<typeof SumitPayment>;

const PaymentData = z.object({ Payment: SumitPayment });

/** A charge answers with the payment and, for a new customer, its id at SUMIT. */
const ChargeData = z.object({
  Payment: SumitPayment.nullish(),
  CustomerID: optNum,
  DocumentID: optNum,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Shekels with two decimals, as SUMIT takes them. */
export const sumitShekels = (a: number) => Math.round(a) / 100;
/** SUMIT's decimal shekels back to integer agorot. */
export const sumitAgorot = (shekels: number): Agorot => agorot(Math.round(shekels * 100));

/** Our reference and the chosen method travel together in `ExternalIdentifier` and come back on the payment. */
export function sumitExternalIdentifier(reference: string, method: CheckoutMethod) {
  return `${reference}|${method}`;
}

const ExternalIdentifier = z
  .string()
  .transform((s) => s.split('|'))
  .pipe(z.tuple([z.uuid(), z.enum(['card', 'bit', 'standing_order'])]));

/** A saved card lives on the customer at SUMIT: our mandate id is that customer's id. */
export function sumitMandateId(customerId: number) {
  return `sumit-customer:${customerId}`;
}

export function parseSumitMandate(mandateId: string): number | null {
  const m = /^sumit-customer:(\d{1,15})$/.exec(mandateId);
  return m ? Number(m[1]) : null;
}

/** Card payments approve with "000" (some answers drop the zeros); `ValidPayment: false` always declines. */
export function sumitPaymentApproved(p: SumitPayment): boolean {
  if (p.ValidPayment === false) return false;
  if (p.Status != null && p.Status !== '' && !/^0+$/.test(p.Status)) return false;
  return p.ValidPayment === true || (p.Status != null && /^0+$/.test(p.Status));
}

const PAYMENT_ID_KEYS = ['PaymentID', 'PaymentId', 'OG-PaymentID', 'Payment.ID', 'Data.Payment.ID'];

/** The payment id inside a parsed body: a top-level key, `Payment.ID`, or the same under `Data`. */
function paymentIdIn(o: unknown): unknown {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  for (const k of PAYMENT_ID_KEYS) if (r[k] != null) return r[k];
  const payment = r.Payment as Record<string, unknown> | null | undefined;
  if (payment && typeof payment === 'object' && payment.ID != null) return payment.ID;
  return r.Data && typeof r.Data === 'object' ? paymentIdIn(r.Data) : null;
}

/**
 * The payment id an IPN names. SUMIT posts JSON, a form with dotted keys (`Payment.ID=…`) or a form whose `json` field
 * holds the object, depending on the account's settings; we read only the id and ask SUMIT for the rest.
 */
export function sumitWebhookPaymentId(rawBody: string): string | null {
  let id: unknown = null;
  try {
    id = paymentIdIn(JSON.parse(rawBody));
  } catch {
    const form = new URLSearchParams(rawBody);
    const json = form.get('json');
    if (json) {
      try {
        id = paymentIdIn(JSON.parse(json));
      } catch {
        id = null;
      }
    } else id = PAYMENT_ID_KEYS.map((k) => form.get(k)).find((v) => v) ?? null;
  }
  const s = typeof id === 'number' ? String(id) : id;
  return typeof s === 'string' && /^\d{1,18}$/.test(s) ? s : null;
}

/**
 * Our payment's placeholder id when SUMIT gave none (a refusal, a lost answer): unique per charge, since a payment's
 * external id is unique per processor.
 */
export const sumitPlaceholderId = (kind: 'none' | 'unconfirmed', idempotencyKey: string) =>
  `sumit_${kind}:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;

const last4 = (p: SumitPayment) => {
  const raw = p.PaymentMethod?.CreditCard_LastDigits ?? p.PaymentMethod?.CreditCard_CardMask;
  const digits = raw == null ? '' : String(raw).replace(/\D/g, '');
  return digits.length >= 1 ? digits.slice(-4).padStart(4, '0') : null;
};

// ─── The client ─────────────────────────────────────────────────────────────

export class SumitClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly creds: SumitCredentials,
    opts: SumitOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? SUMIT_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** One POST to `/<endpoint>/`; the wrapper's error becomes a `SumitError`, its `Data` is checked against `schema`. */
  async post<T>(endpoint: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/${endpoint}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        Credentials: { CompanyID: this.creds.companyId, APIKey: this.creds.apiKey },
        ...body,
      }),
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
      throw new SumitError(endpoint, 'auth_failed', `HTTP ${res.status}`);
    const env = Envelope.safeParse(json);
    if (!env.success) throw new SumitError(endpoint, 'unexpected', `HTTP ${res.status}`);
    const ok = env.data.Status === 'Success' || env.data.Status === 0 || env.data.Status === '0';
    if (!ok)
      throw new SumitError(
        endpoint,
        /api ?key|credential|הרשא|מפתח/i.test(env.data.UserErrorMessage ?? '')
          ? 'auth_failed'
          : 'refused',
        // SUMIT's own message (no card data in it), shortened for the log.
        (env.data.UserErrorMessage ?? String(env.data.Status)).slice(0, 200),
      );
    const data = schema.safeParse(env.data.Data);
    if (!data.success) throw new SumitError(endpoint, 'unexpected', 'unexpected Data');
    return data.data;
  }

  beginRedirect(req: {
    externalIdentifier: string;
    amount: number;
    description: string;
    saveCard: boolean;
    redirectUrl: string;
    cancelUrl: string;
    ipnUrl: string;
    customer?: { name?: string; phone?: string; email?: string };
  }) {
    return this.post(
      'billing/payments/beginredirect',
      {
        Customer: Object.fromEntries(
          Object.entries({
            Name: req.customer?.name,
            Phone: req.customer?.phone,
            EmailAddress: req.customer?.email,
            // Each checkout is its own customer card at SUMIT unless the business merges them there.
            SearchMode: 0,
          }).filter(([, v]) => v !== undefined && v !== ''),
        ),
        Items: [
          {
            Item: { Name: req.description.slice(0, 200) },
            Quantity: 1,
            UnitPrice: req.amount,
            Currency: 0,
          },
        ],
        // Our prices already include VAT.
        VATIncluded: true,
        MaximumPayments: 1,
        PreventSavingPaymentMethod: !req.saveCard,
        ExternalIdentifier: req.externalIdentifier,
        RedirectURL: req.redirectUrl,
        CancelRedirectURL: req.cancelUrl,
        IPNURL: req.ipnUrl,
      },
      BeginRedirectData,
    );
  }

  async getPayment(paymentId: string): Promise<SumitPayment> {
    const d = await this.post(
      'billing/payments/get',
      { PaymentID: Number(paymentId) },
      PaymentData,
    );
    return d.Payment;
  }

  /** Charges the customer's saved payment method at SUMIT (no card data passes through us). */
  chargeCustomer(req: { customerId: number; amount: number; description: string }) {
    return this.post(
      'billing/payments/charge',
      {
        Customer: { ID: req.customerId, SearchMode: 1 },
        Items: [
          {
            Item: { Name: req.description.slice(0, 200) },
            Quantity: 1,
            UnitPrice: req.amount,
            Currency: 0,
          },
        ],
        VATIncluded: true,
      },
      ChargeData,
    );
  }

  /**
   * Reads an IPN: the payment id it names, the payment fetched from SUMIT with our own key, and a check that it
   * carries a reference we gave a page. Null when the body names no payment or the payment is not one of ours.
   */
  async verifiedPayment(rawBody: string) {
    const id = sumitWebhookPaymentId(rawBody);
    if (!id) return null;
    const payment = await this.getPayment(id);
    if (payment.ID !== id) return null;
    const ext = ExternalIdentifier.safeParse(payment.ExternalIdentifier);
    if (!ext.success) return null;
    return { id, payment, reference: ext.data[0], method: ext.data[1] };
  }

  /** A harmless call that proves the company number and key work: a page nobody is sent to. */
  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.beginRedirect({
        externalIdentifier: 'connection-check',
        amount: 1,
        description: 'connection check',
        saveCard: false,
        redirectUrl: 'https://example.com/sumit-check',
        cancelUrl: 'https://example.com/sumit-check',
        ipnUrl: 'https://example.com/sumit-check',
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof SumitError)
        return {
          ok: false,
          reason: e.reason === 'auth_failed' ? 'auth_failed' : `sumit_${e.reason}`,
        };
      return { ok: false, reason: 'unreachable' };
    }
  }
}

/** The owner's two fields (strings, as the connection screen saves them) as SUMIT credentials. */
export function sumitCredentials(creds: GatewayCredentials): SumitCredentials {
  const companyId = Number(creds.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0)
    throw new SumitError('credentials', 'bad_company', 'bad company number');
  return { companyId, apiKey: creds.apiKey ?? '' };
}

// ─── A business's own processor ─────────────────────────────────────────────

export class SumitGateway implements PaymentGateway {
  readonly kind = 'sumit' as const;
  readonly client: SumitClient;

  constructor(creds: GatewayCredentials, opts: SumitOptions = {}) {
    this.client = new SumitClient(sumitCredentials(creds), opts);
  }

  testConnection() {
    return this.client.check();
  }

  /** Opens SUMIT's page for a card charge, or a card charge that also saves the card for a standing order. */
  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    if (req.method === 'bit')
      throw new SumitError('billing/payments/beginredirect', 'bit_not_enabled', 'bit_not_enabled');
    // SUMIT's page charges something: a standing order with nothing owed now is not offered on SUMIT yet.
    if (req.amount <= 0)
      throw new SumitError('billing/payments/beginredirect', 'zero_amount', 'nothing to charge');
    const page = await this.client.beginRedirect({
      externalIdentifier: sumitExternalIdentifier(req.reference, req.method),
      amount: sumitShekels(req.amount),
      description: req.description,
      saveCard: req.method === 'standing_order',
      redirectUrl: req.successUrl,
      cancelUrl: req.cancelUrl,
      ipnUrl: req.notifyUrl,
      customer: {
        name: req.customer.name,
        phone: req.customer.phoneE164,
        email: req.customer.email,
      },
    });
    // SUMIT returns only the page's address; the payment's id arrives with the IPN.
    return { redirectUrl: page.RedirectURL, externalId: `sumit:${req.reference}` };
  }

  async readWebhook(rawBody: string): Promise<GatewayEvent | null> {
    const v = await this.client.verifiedPayment(rawBody);
    if (!v) return null;
    const { payment } = v;
    const base = {
      eventId: `sumit:${v.id}`,
      reference: v.reference,
      method: v.method,
      externalPaymentId: v.id,
      occurredAt: new Date().toISOString(),
    };
    if (!sumitPaymentApproved(payment))
      return {
        ...base,
        type: 'checkout.failed',
        amountAgorot: 0,
        failureReason: `sumit_${payment.Status ?? 'declined'}`.slice(0, 200),
      };
    const mandate =
      v.method === 'standing_order' && payment.CustomerID
        ? { mandateId: sumitMandateId(payment.CustomerID), cardLast4: last4(payment) ?? '0000' }
        : undefined;
    return {
      ...base,
      type: 'checkout.paid',
      amountAgorot: payment.Amount != null ? sumitAgorot(payment.Amount) : 0,
      ...(mandate ? { mandate } : {}),
    };
  }

  /**
   * Charges the customer's saved card at SUMIT. SUMIT documents no idempotency key for a charge, so a call whose answer
   * never arrived is not sent again (that could charge twice): it comes back `pending` for the office to check in SUMIT.
   */
  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    const none = sumitPlaceholderId('none', ctx.idempotencyKey);
    const customerId = parseSumitMandate(req.mandateId);
    if (!customerId)
      return { externalPaymentId: none, status: 'failed', failureReason: 'bad_mandate' };
    try {
      const d = await this.client.chargeCustomer({
        customerId,
        amount: sumitShekels(req.amount),
        description: req.description,
      });
      const p = d.Payment;
      if (p && sumitPaymentApproved(p)) return { externalPaymentId: p.ID, status: 'succeeded' };
      return {
        externalPaymentId: p?.ID ?? none,
        status: 'failed',
        failureReason: `sumit_${p?.Status ?? 'declined'}`.slice(0, 200),
      };
    } catch (e) {
      if (e instanceof SumitError && e.reason !== 'unexpected')
        return { externalPaymentId: none, status: 'failed', failureReason: `sumit_${e.reason}` };
      return {
        externalPaymentId: sumitPlaceholderId('unconfirmed', ctx.idempotencyKey),
        status: 'pending',
        failureReason: 'sumit_unconfirmed',
      };
    }
  }

  /** Links go through our own payment page (`/pay/<token>`, a checkout); a bare link is never asked of a gateway. */
  async createPaymentLink(_ctx: ProviderContext, _req: PaymentLinkRequest): Promise<never> {
    throw new SumitError('link', 'use_checkout', 'use a checkout');
  }

  /** A standing order needs the customer's card on SUMIT's page (a `standing_order` checkout). */
  async createStandingOrder(): Promise<never> {
    throw new SumitError('standing_order', 'use_checkout', 'use a standing_order checkout');
  }

  /** A saved card at SUMIT is only charged when we ask: cancelling is ours to record, nothing to call. */
  async cancelStandingOrder(): Promise<void> {}

  /** SUMIT documents no refund call: the office refunds in SUMIT itself, which also issues the credit document. */
  async refund(): Promise<never> {
    throw new SumitError('refund', 'refund_in_sumit', 'refund in SUMIT');
  }
}
