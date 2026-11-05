/**
 * The business's own payment processor (סליקה). Each business connects its processor in-app; an adapter per processor
 * turns our requests into its API calls, so another Israeli processor plugs in without touching the domain.
 *
 * A gateway can do everything the monthly billing needs (`PaymentProvider`: charge a standing order, links, refunds)
 * and, for the customer's one-click payment, open a hosted checkout for a card, Bit or a new standing order, and read
 * the processor's callback once it has verified it really came from the processor.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CheckoutMethod, PaymentGatewayKind } from '@rswim/contracts';
import type { Agorot } from '@rswim/money';
import { FakePaymentProvider } from './fakes';
import type { PaymentProvider, ProviderContext } from './index';

export interface CredentialField {
  key: string;
  /** Secret fields are never shown again after saving (only their last characters). */
  secret: boolean;
  pattern: RegExp;
}

export interface GatewaySpec {
  kind: PaymentGatewayKind;
  /** Display name (a brand name, the same in every language). */
  name: string;
  fields: readonly CredentialField[];
  methods: readonly CheckoutMethod[];
  /**
   * Whether a real adapter talks to this processor yet. Credentials can be saved before; payments start once the
   * adapter is checked against the processor's sandbox with the business's own account.
   */
  live: boolean;
}

const id = /^[A-Za-z0-9._-]{2,80}$/;
const secret = /^[A-Za-z0-9._~+/=-]{6,200}$/;

/** The processors a business can choose, and what each one asks for. */
export const PAYMENT_GATEWAYS: Record<PaymentGatewayKind, GatewaySpec> = {
  grow: {
    kind: 'grow',
    name: 'Grow (Meshulam)',
    fields: [
      { key: 'userId', secret: false, pattern: id },
      { key: 'pageCode', secret: false, pattern: id },
      { key: 'apiKey', secret: true, pattern: secret },
    ],
    methods: ['card', 'bit', 'standing_order'],
    live: false,
  },
  cardcom: {
    kind: 'cardcom',
    name: 'Cardcom',
    fields: [
      { key: 'terminalNumber', secret: false, pattern: /^\d{3,10}$/ },
      { key: 'apiName', secret: false, pattern: id },
      { key: 'apiPassword', secret: true, pattern: secret },
    ],
    methods: ['card', 'bit', 'standing_order'],
    live: false,
  },
  tranzila: {
    kind: 'tranzila',
    name: 'Tranzila',
    fields: [
      { key: 'terminalName', secret: false, pattern: id },
      { key: 'appKey', secret: false, pattern: id },
      { key: 'secretKey', secret: true, pattern: secret },
    ],
    methods: ['card', 'bit', 'standing_order'],
    live: false,
  },
  payplus: {
    kind: 'payplus',
    name: 'PayPlus',
    fields: [
      { key: 'apiKey', secret: false, pattern: id },
      { key: 'secretKey', secret: true, pattern: secret },
      { key: 'paymentPageUid', secret: false, pattern: id },
    ],
    methods: ['card', 'bit', 'standing_order'],
    live: false,
  },
  fake: {
    kind: 'fake',
    name: 'Demo',
    fields: [{ key: 'merchantId', secret: false, pattern: id }],
    methods: ['card', 'bit', 'standing_order'],
    live: true,
  },
};

export type GatewayCredentials = Record<string, string>;

/** Checks credentials against a processor's fields; returns the first bad field's key, or null. */
export function invalidCredentialField(
  kind: PaymentGatewayKind,
  creds: GatewayCredentials,
): string | null {
  for (const f of PAYMENT_GATEWAYS[kind].fields) {
    const v = creds[f.key];
    if (typeof v !== 'string' || !f.pattern.test(v)) return f.key;
  }
  return null;
}

/** The last characters of each field, for the owner's screen (secrets show only the last 4). */
export function credentialHints(
  kind: PaymentGatewayKind,
  creds: GatewayCredentials,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of PAYMENT_GATEWAYS[kind].fields) {
    const v = creds[f.key] ?? '';
    out[f.key] = f.secret ? `••••${v.slice(-4)}` : v;
  }
  return out;
}

export interface CheckoutRequest {
  /** Our checkout id: the processor echoes it back in its callback. */
  reference: string;
  method: CheckoutMethod;
  amount: Agorot;
  description: string;
  customer: { name: string; phoneE164?: string; email?: string };
  /** Where the processor sends the customer back, and where it posts the result. */
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** Our own page that plays the processor in demo mode. */
  sandboxUrl: string;
}

export interface CheckoutSession {
  redirectUrl: string;
  externalId: string;
}

/** A processor callback, after verification, in our words. */
export const GatewayEvent = z.object({
  /** The processor's event id: a redelivery carries the same one. */
  eventId: z.string().min(1).max(200),
  type: z.enum(['checkout.paid', 'checkout.failed']),
  reference: z.uuid(),
  externalPaymentId: z.string().min(1).max(200),
  method: z.enum(['card', 'bit', 'standing_order']),
  amountAgorot: z.number().int().nonnegative(),
  /** A card saved for a standing order (its token at the processor). */
  mandate: z
    .object({ mandateId: z.string().min(1).max(200), cardLast4: z.string().regex(/^\d{4}$/) })
    .optional(),
  failureReason: z.string().max(200).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type GatewayEvent = z.infer<typeof GatewayEvent>;

export interface PaymentGateway extends PaymentProvider {
  readonly kind: PaymentGatewayKind;
  /** A harmless call that proves the credentials work. */
  testConnection(): Promise<{ ok: true } | { ok: false; reason: string }>;
  createCheckout(ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies a callback came from the processor and reads it; null when it did not or is not about a checkout. */
  readWebhook(rawBody: string, headers: Headers): Promise<GatewayEvent | null>;
}

// ─── The demo processor ─────────────────────────────────────────────────────

export const SANDBOX_SIGNATURE_HEADER = 'x-rswim-sandbox-signature';

export function signSandboxEvent(rawBody: string, webhookSecret: string): string {
  return createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');
}

/**
 * The demo processor: approves everything (a merchant id or card containing "fail" is declined, as with the Grow
 * fake), and its hosted page is our own sandbox page. Its callbacks are signed with the connection's webhook secret,
 * exactly as a real processor's would be verified.
 */
export class SandboxGateway extends FakePaymentProvider implements PaymentGateway {
  constructor(
    readonly kind: PaymentGatewayKind,
    private readonly creds: GatewayCredentials,
    private readonly webhookSecret: string,
  ) {
    super();
  }

  async testConnection() {
    return Object.values(this.creds).some((v) => v.includes('fail'))
      ? ({ ok: false, reason: 'auth_failed' } as const)
      : ({ ok: true } as const);
  }

  async createCheckout(ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutSession> {
    this.calls.push({ op: 'link', ctx, req });
    const externalId = `sbx_${createHash('sha256').update(ctx.idempotencyKey).digest('hex').slice(0, 16)}`;
    const url = new URL(req.sandboxUrl);
    url.searchParams.set('m', req.method);
    url.searchParams.set('x', externalId);
    return { redirectUrl: url.toString(), externalId };
  }

  async readWebhook(rawBody: string, headers: Headers): Promise<GatewayEvent | null> {
    const sig = headers.get(SANDBOX_SIGNATURE_HEADER);
    if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
    const expected = Buffer.from(signSandboxEvent(rawBody, this.webhookSecret), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const parsed = GatewayEvent.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
}

export class GatewayNotLiveError extends Error {
  constructor(readonly kind: PaymentGatewayKind) {
    super(`payment gateway ${kind} has no live adapter yet`);
  }
}

/**
 * Builds the gateway for a business's connection. With `sandbox` (local, CI, the live demo) every processor runs as
 * the demo processor, so a demo can show "Grow connected" without a real account. Without it, a processor whose
 * adapter is not live yet (and the demo processor itself) throws `GatewayNotLiveError`, and nothing is charged.
 */
export function createGateway(
  kind: PaymentGatewayKind,
  creds: GatewayCredentials,
  opts: { webhookSecret: string; sandbox: boolean },
): PaymentGateway {
  if (opts.sandbox) return new SandboxGateway(kind, creds, opts.webhookSecret);
  // The demo processor approves everything: it never runs outside a sandboxed process.
  throw new GatewayNotLiveError(kind);
}

/** Whether this process runs processors as the demo processor (never set in production). */
export function gatewaySandbox(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.RSWIM_PAYMENTS_SANDBOX === '1' || env.RSWIM_GROW_FAKE === '1' || env.RSWIM_DEMO_MODE === '1'
  );
}
