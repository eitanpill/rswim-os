/**
 * Cardcom (API v11, https://secure.cardcom.solutions/swagger/v11/swagger.json). One client serves two uses:
 *
 * - a business's own processor (`CardcomGateway`, a `PaymentGateway`): the owner enters the terminal number, the API
 *   name and the API password on the connection screen; customers pay on Cardcom's hosted page ("Low Profile") by
 *   card or Bit, or save a card for a standing order, which we then charge by token every month;
 * - the platform's own card vault and monthly charges (`CardcomCardVault`, `CardcomPlatformProvider`), with the
 *   platform's terminal from the environment (`PLATFORM_CARDCOM_*`).
 *
 * Cardcom does not sign its webhook. We never trust its body: it only names a Low Profile id, and we ask Cardcom for
 * that page's result with our own credentials (`LowProfile/GetLpResult`), then check that the result is about our
 * terminal and carries the reference we gave the page (`ReturnValue`).
 *
 * Field names follow the v11 swagger (read 2026-11-27). Not yet checked against a real terminal: whether Bit pages
 * report `TranzactionInfo` like card pages, the exact minimum `Amount` of a token-only page, and the codes a wrong API
 * password returns. `docs/payments/CARDCOM.md` lists what to try in Cardcom's test terminal before going live.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CheckoutMethod } from '@rswim/contracts';
import { agorot, type Agorot } from '@rswim/money';
import type { CardSetupEvent, CardSetupRequest, CardVault } from './cards';
import type {
  CheckoutRequest,
  CheckoutSession,
  GatewayCredentials,
  GatewayEvent,
  PaymentGateway,
} from './gateways';
import type { ChargeResult, PaymentLinkRequest, ProviderContext } from './index';

export const CARDCOM_BASE_URL = 'https://secure.cardcom.solutions';

export interface CardcomCredentials {
  terminalNumber: number;
  apiName: string;
  /** Only refunds need it. */
  apiPassword: string;
}

export interface CardcomOptions {
  baseUrl?: string;
  /** Injected in tests (recorded Cardcom answers); the global fetch otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class CardcomError extends Error {
  constructor(
    readonly endpoint: string,
    readonly code: number | null,
    message: string,
  ) {
    super(`cardcom ${endpoint}: ${message}`);
  }
}

// ─── Cardcom's answers, as much of them as we read ──────────────────────────

const num = z.coerce.number();
const optStr = z.string().nullish();

const CreateLowProfileResponse = z.object({
  ResponseCode: num,
  Description: optStr,
  LowProfileId: optStr,
  Url: optStr,
  UrlToBit: optStr,
  UrlToPayPal: optStr,
});

const TransactionInfo = z.object({
  ResponseCode: num,
  Description: optStr,
  TranzactionId: num.nullish(),
  TerminalNumber: num.nullish(),
  Amount: num.nullish(),
  Last4CardDigitsString: optStr,
  Last4CardDigits: num.nullish(),
  CardMonth: num.nullish(),
  CardYear: num.nullish(),
  Token: optStr,
});
type TransactionInfo = z.infer<typeof TransactionInfo>;

const LowProfileResult = z.object({
  ResponseCode: num,
  Description: optStr,
  TerminalNumber: num.nullish(),
  LowProfileId: optStr,
  TranzactionId: num.nullish(),
  ReturnValue: optStr,
  Operation: optStr,
  TokenInfo: z
    .object({
      Token: z.string(),
      CardYear: num.nullish(),
      CardMonth: num.nullish(),
    })
    .nullish(),
  TranzactionInfo: TransactionInfo.nullish(),
});
export type CardcomLowProfileResult = z.infer<typeof LowProfileResult>;

const RefundResponse = z.object({
  ResponseCode: num,
  Description: optStr,
  NewTranzactionId: num.nullish(),
});

/** Cardcom's "pending" answers for a page the customer has not finished (3DS, a retry after a decline). */
const PENDING_CODES = new Set([5117, 5118, 5119]);
/** A token charge sent again with the same `ExternalUniqTranId`. */
const DUPLICATE_TRAN = 608;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Shekels with two decimals, as Cardcom takes them. */
export const toShekels = (a: number) => Math.round(a) / 100;
/** Cardcom's decimal shekels back to integer agorot. */
export const toAgorot = (shekels: number): Agorot => agorot(Math.round(shekels * 100));

/** Our reference and the chosen method travel together in `ReturnValue` and come back in the result. */
export function cardcomReturnValue(reference: string, method: CheckoutMethod | 'card_setup') {
  return `${reference}|${method}`;
}

const ReturnValue = z
  .string()
  .transform((s) => s.split('|'))
  .pipe(z.tuple([z.uuid(), z.enum(['card', 'bit', 'standing_order', 'card_setup'])]));

/**
 * A saved card is the token plus its expiry, both needed to charge it later: we keep them as one mandate id,
 * `<token>:<MMYY>`.
 */
export function cardcomMandateId(token: string, month: number, year: number) {
  return `${token}:${String(month).padStart(2, '0')}${String(year % 100).padStart(2, '0')}`;
}

export function parseCardcomMandate(mandateId: string): { token: string; mmyy: string } | null {
  if (!/^[0-9a-f-]{36}:\d{4}$/i.test(mandateId)) return null;
  return { token: mandateId.slice(0, 36), mmyy: mandateId.slice(37) };
}

/** A short, stable `ExternalUniqTranId` from our idempotency key (Cardcom refuses a second charge with it). */
export function cardcomUniqTranId(idempotencyKey: string) {
  return `rs${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 30)}`;
}

/** The Low Profile id a webhook names (JSON as the swagger documents it, or a form post as older terminals send). */
export function webhookLowProfileId(rawBody: string): string | null {
  let id: unknown = null;
  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    id = json?.LowProfileId ?? json?.lowprofileid ?? null;
  } catch {
    const form = new URLSearchParams(rawBody);
    id = form.get('LowProfileId') ?? form.get('lowprofilecode') ?? form.get('LowProfileCode');
  }
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

const last4 = (t: TransactionInfo | null | undefined) => {
  const s = String(t?.Last4CardDigitsString ?? t?.Last4CardDigits);
  return /^\d{1,4}$/.test(s) ? s.padStart(4, '0') : null;
};

// ─── The client ─────────────────────────────────────────────────────────────

export class CardcomClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly creds: CardcomCredentials,
    opts: CardcomOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? CARDCOM_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** One POST to `/api/v11/<endpoint>`; a 401 is an auth failure, other non-2xx answers carry Cardcom's code. */
  async post<T>(endpoint: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v11/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new CardcomError(endpoint, 401, 'auth_failed');
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new CardcomError(endpoint, res.status, `unexpected answer (HTTP ${res.status})`);
    return parsed.data;
  }

  private auth() {
    return { TerminalNumber: this.creds.terminalNumber, ApiName: this.creds.apiName };
  }

  createLowProfile(req: {
    operation: 'ChargeOnly' | 'ChargeAndCreateToken' | 'CreateTokenOnly';
    returnValue: string;
    amount: number;
    productName: string;
    successUrl: string;
    failedUrl: string;
    cancelUrl: string;
    webhookUrl: string;
    customer?: { name?: string; phone?: string; email?: string };
  }) {
    return this.post(
      'LowProfile/Create',
      {
        ...this.auth(),
        Operation: req.operation,
        ReturnValue: req.returnValue,
        Amount: req.amount,
        SuccessRedirectUrl: req.successUrl,
        FailedRedirectUrl: req.failedUrl,
        CancelRedirectUrl: req.cancelUrl,
        WebHookUrl: req.webhookUrl,
        ProductName: req.productName.slice(0, 200),
        Language: 'he',
        ISOCoinId: 1,
        // The customer's details prefill the page (only those we have).
        UIDefinition: Object.fromEntries(
          Object.entries({
            CardOwnerNameValue: req.customer?.name,
            CardOwnerPhoneValue: req.customer?.phone,
            CardOwnerEmailValue: req.customer?.email,
          }).filter(([, v]) => v),
        ),
        // A token-only page checks the card (J2) without charging it.
        ...(req.operation === 'CreateTokenOnly'
          ? { AdvancedDefinition: { JValidateType: 2 } }
          : {}),
      },
      CreateLowProfileResponse,
    );
  }

  getLowProfileResult(lowProfileId: string) {
    return this.post(
      'LowProfile/GetLpResult',
      { ...this.auth(), LowProfileId: lowProfileId },
      LowProfileResult,
    );
  }

  /** Charges a saved card. A repeat with the same key is answered with the first charge, never a second one. */
  async chargeToken(
    idempotencyKey: string,
    req: { token: string; mmyy: string; amount: number; description: string },
  ): Promise<TransactionInfo> {
    const uniq = cardcomUniqTranId(idempotencyKey);
    const info = await this.post(
      'Transactions/Transaction',
      {
        ...this.auth(),
        Amount: req.amount,
        Token: req.token,
        CardExpirationMMYY: req.mmyy,
        ExternalUniqTranId: uniq,
        ExternalUniqUniqTranIdResponse: true,
        ISOCoinId: 1,
      },
      TransactionInfo,
    );
    if (info.ResponseCode !== DUPLICATE_TRAN) return info;
    return this.post(
      'Transactions/GetTransactionByExternalUniqTran',
      { ...this.auth(), ExternalUniqTranId: uniq },
      TransactionInfo,
    );
  }

  refund(transactionId: number, amount: number) {
    return this.post(
      'Transactions/RefundByTransactionId',
      {
        ApiName: this.creds.apiName,
        ApiPassword: this.creds.apiPassword,
        TransactionId: transactionId,
        PartialSum: amount,
      },
      RefundResponse,
    );
  }

  /**
   * Reads a webhook: the Low Profile id it names, its result fetched from Cardcom with our own credentials, and a check
   * that the result belongs to our terminal. Null when the body names no page or the page is not ours.
   */
  async verifiedResult(rawBody: string) {
    const id = webhookLowProfileId(rawBody);
    if (!id) return null;
    const result = await this.getLowProfileResult(id);
    if (result.TerminalNumber != null && result.TerminalNumber !== this.creds.terminalNumber)
      return null;
    if (result.LowProfileId && result.LowProfileId.toLowerCase() !== id.toLowerCase()) return null;
    const rv = ReturnValue.safeParse(result.ReturnValue);
    if (!rv.success) return null;
    return { id, result, reference: rv.data[0], method: rv.data[1] };
  }

  /** A harmless call that proves the terminal and API name work: a page nobody is sent to. */
  async check(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const r = await this.createLowProfile({
        operation: 'ChargeOnly',
        returnValue: 'connection-check',
        amount: 1,
        productName: 'connection check',
        successUrl: 'https://example.com/cardcom-check',
        failedUrl: 'https://example.com/cardcom-check',
        cancelUrl: 'https://example.com/cardcom-check',
        webhookUrl: 'https://example.com/cardcom-check',
      });
      return r.ResponseCode === 0 && r.LowProfileId
        ? { ok: true }
        : { ok: false, reason: `cardcom_${r.ResponseCode}` };
    } catch (e) {
      if (e instanceof CardcomError)
        return { ok: false, reason: e.code === 401 ? 'auth_failed' : `cardcom_${e.code}` };
      return { ok: false, reason: 'unreachable' };
    }
  }
}

/** The owner's three fields (strings, as the connection screen saves them) as Cardcom credentials. */
export function cardcomCredentials(creds: GatewayCredentials): CardcomCredentials {
  const terminalNumber = Number(creds.terminalNumber);
  if (!Number.isInteger(terminalNumber) || terminalNumber <= 0)
    throw new CardcomError('credentials', null, 'bad terminal number');
  return {
    terminalNumber,
    apiName: creds.apiName ?? '',
    apiPassword: creds.apiPassword ?? '',
  };
}

/** A failed charge's id when Cardcom gave none: unique per charge, since a payment's external id is unique. */
export const cardcomNoneId = (idempotencyKey: string) =>
  `cardcom_none:${cardcomUniqTranId(idempotencyKey)}`;

function chargeResult(info: TransactionInfo, idempotencyKey: string): ChargeResult {
  const id = info.TranzactionId != null ? String(info.TranzactionId) : null;
  if (info.ResponseCode === 0 && id) return { externalPaymentId: id, status: 'succeeded' };
  return {
    externalPaymentId: id ?? cardcomNoneId(idempotencyKey),
    status: 'failed',
    failureReason: `cardcom_${info.ResponseCode}`,
  };
}

// ─── A business's own processor ─────────────────────────────────────────────

export class CardcomGateway implements PaymentGateway {
  readonly kind = 'cardcom' as const;
  readonly client: CardcomClient;

  constructor(creds: GatewayCredentials, opts: CardcomOptions = {}) {
    this.client = new CardcomClient(cardcomCredentials(creds), opts);
  }

  testConnection() {
    return this.client.check();
  }

  /**
   * Opens Cardcom's page for one way to pay: a card charge, the same page's Bit link, or saving a card for a standing
   * order (charged now as well when the checkout has an amount).
   */
  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    const saveCard = req.method === 'standing_order';
    const operation = saveCard
      ? req.amount > 0
        ? 'ChargeAndCreateToken'
        : 'CreateTokenOnly'
      : 'ChargeOnly';
    const page = await this.client.createLowProfile({
      operation,
      returnValue: cardcomReturnValue(req.reference, req.method),
      // A token-only page still needs an amount; J2 checks the card without charging it.
      amount: operation === 'CreateTokenOnly' ? 1 : toShekels(req.amount),
      productName: req.description,
      successUrl: req.successUrl,
      failedUrl: req.cancelUrl,
      cancelUrl: req.cancelUrl,
      webhookUrl: req.notifyUrl,
      customer: {
        name: req.customer.name,
        phone: req.customer.phoneE164,
        email: req.customer.email,
      },
    });
    const url = req.method === 'bit' ? page.UrlToBit : page.Url;
    if (page.ResponseCode !== 0 || !page.LowProfileId || !url)
      throw new CardcomError(
        'LowProfile/Create',
        page.ResponseCode,
        req.method === 'bit' && page.ResponseCode === 0
          ? 'bit_not_enabled'
          : `code ${page.ResponseCode}`,
      );
    return { redirectUrl: url, externalId: page.LowProfileId };
  }

  async readWebhook(rawBody: string): Promise<GatewayEvent | null> {
    const v = await this.client.verifiedResult(rawBody);
    if (!v || v.method === 'card_setup') return null;
    const { result } = v;
    if (PENDING_CODES.has(result.ResponseCode)) return null;
    const tran = result.TranzactionInfo;
    const base = {
      eventId: `cardcom:${v.id}`,
      reference: v.reference,
      method: v.method,
      externalPaymentId: String(tran?.TranzactionId ?? result.TranzactionId ?? v.id),
      occurredAt: new Date().toISOString(),
    };
    // The page's own code, or (on a finished page) the card's answer.
    const code = result.ResponseCode !== 0 ? result.ResponseCode : (tran?.ResponseCode ?? 0);
    if (code !== 0)
      return {
        ...base,
        type: 'checkout.failed',
        amountAgorot: 0,
        failureReason: `cardcom_${code}`,
      };
    const token = result.TokenInfo;
    const mandate =
      v.method === 'standing_order' && token?.Token && token.CardMonth && token.CardYear
        ? {
            mandateId: cardcomMandateId(token.Token, token.CardMonth, token.CardYear),
            // A token-only page charges nothing, so Cardcom may not report the digits; "0000" then.
            cardLast4: last4(tran) ?? '0000',
          }
        : undefined;
    return {
      ...base,
      type: 'checkout.paid',
      // A token-only page (amount 0 on our side) checked the card without charging it.
      amountAgorot: tran?.Amount != null ? toAgorot(tran.Amount) : 0,
      ...(mandate ? { mandate } : {}),
    };
  }

  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    const m = parseCardcomMandate(req.mandateId);
    if (!m)
      return {
        externalPaymentId: cardcomNoneId(ctx.idempotencyKey),
        status: 'failed',
        failureReason: 'bad_mandate',
      };
    const info = await this.client.chargeToken(ctx.idempotencyKey, {
      token: m.token,
      mmyy: m.mmyy,
      amount: toShekels(req.amount),
      description: req.description,
    });
    return chargeResult(info, ctx.idempotencyKey);
  }

  /**
   * Links go through our own payment page (`/pay/<token>`, a checkout) when a business has a processor, so a bare
   * link is never asked of a gateway; refusing keeps a mistake from sending money nowhere.
   */
  async createPaymentLink(_ctx: ProviderContext, _req: PaymentLinkRequest): Promise<never> {
    throw new CardcomError('link', null, 'use a checkout');
  }

  /** A standing order needs the customer's card on Cardcom's page (a `standing_order` checkout). */
  async createStandingOrder(): Promise<never> {
    throw new CardcomError('standing_order', null, 'use a standing_order checkout');
  }

  /** A token at Cardcom is only charged when we ask: cancelling is ours to record, nothing to call. */
  async cancelStandingOrder(): Promise<void> {}

  async refund(_ctx: ProviderContext, req: { externalPaymentId: string; amount: Agorot }) {
    const id = Number(req.externalPaymentId);
    if (!Number.isInteger(id)) throw new CardcomError('refund', null, 'not a Cardcom transaction');
    const r = await this.client.refund(id, toShekels(req.amount));
    if (r.ResponseCode !== 0 || r.NewTranzactionId == null)
      throw new CardcomError(
        'Transactions/RefundByTransactionId',
        r.ResponseCode,
        `code ${r.ResponseCode}`,
      );
    return { externalRefundId: String(r.NewTranzactionId) };
  }
}

// ─── The platform's own terminal ────────────────────────────────────────────

/** The platform's Cardcom terminal from the environment, or null while it is not set. */
export function platformCardcomCredentials(
  env: Record<string, string | undefined> = process.env,
): CardcomCredentials | null {
  const terminal = Number(env.PLATFORM_CARDCOM_TERMINAL_NUMBER);
  const apiName = env.PLATFORM_CARDCOM_API_NAME;
  if (!Number.isInteger(terminal) || terminal <= 0 || !apiName) return null;
  return {
    terminalNumber: terminal,
    apiName,
    apiPassword: env.PLATFORM_CARDCOM_API_PASSWORD ?? '',
  };
}

/** The owner's subscription card, saved on Cardcom's token-only page (checked, not charged). */
export class CardcomCardVault implements CardVault {
  readonly client: CardcomClient;

  constructor(creds: CardcomCredentials, opts: CardcomOptions = {}) {
    this.client = new CardcomClient(creds, opts);
  }

  async createCardSetup(_ctx: ProviderContext, req: CardSetupRequest) {
    const page = await this.client.createLowProfile({
      operation: 'CreateTokenOnly',
      returnValue: cardcomReturnValue(req.reference, 'card_setup'),
      amount: 1,
      productName: 'Aqua Swim',
      successUrl: req.successUrl,
      failedUrl: req.cancelUrl,
      cancelUrl: req.cancelUrl,
      webhookUrl: req.notifyUrl,
      customer: { name: req.customer.name, email: req.customer.email },
    });
    if (page.ResponseCode !== 0 || !page.LowProfileId || !page.Url)
      throw new CardcomError('LowProfile/Create', page.ResponseCode, `code ${page.ResponseCode}`);
    return { redirectUrl: page.Url, externalId: page.LowProfileId };
  }

  async readCardWebhook(rawBody: string): Promise<CardSetupEvent | null> {
    const v = await this.client.verifiedResult(rawBody);
    if (!v || v.method !== 'card_setup') return null;
    const { result } = v;
    if (PENDING_CODES.has(result.ResponseCode)) return null;
    const base = {
      eventId: `cardcom:${v.id}`,
      reference: v.reference,
      occurredAt: new Date().toISOString(),
    };
    const token = result.TokenInfo;
    if (result.ResponseCode !== 0 || !token?.Token || !token.CardMonth || !token.CardYear)
      return {
        ...base,
        type: 'card.failed',
        failureReason: `cardcom_${result.ResponseCode}`,
      };
    return {
      ...base,
      type: 'card.saved',
      mandateId: cardcomMandateId(token.Token, token.CardMonth, token.CardYear),
      cardLast4: last4(result.TranzactionInfo) ?? '0000',
    };
  }
}

/** Charges the schools' subscription cards on the platform's terminal (the worker's monthly billing). */
export class CardcomPlatformProvider extends CardcomGateway {
  constructor(creds: CardcomCredentials, opts: CardcomOptions = {}) {
    super(
      {
        terminalNumber: String(creds.terminalNumber),
        apiName: creds.apiName,
        apiPassword: creds.apiPassword,
      },
      opts,
    );
  }
}
