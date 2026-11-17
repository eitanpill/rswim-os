/**
 * The platform's own card vault (SaaS stage 3): a school owner saves a card at the platform's processor (Grow's
 * "token only" page: the card is checked, not charged), and the processor calls back with a token the platform charges
 * every month. The card number never reaches us.
 *
 * Until the platform's Grow account and its sandbox exist, only the demo vault runs (sandboxed processes: local, CI,
 * the live demo), whose card page is our own `/billing/card/<setup>/sandbox`.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ProviderContext } from './index';
import { gatewaySandbox } from './gateways';

export interface CardSetupRequest {
  /** Our setup id: the processor echoes it back in its callback. */
  reference: string;
  customer: { name: string; email?: string };
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** Our own page that plays the processor in demo mode. */
  sandboxUrl: string;
}

/** A card-page callback, after verification, in our words. */
export const CardSetupEvent = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(['card.saved', 'card.failed']),
  reference: z.uuid(),
  mandateId: z.string().min(1).max(200).optional(),
  cardLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  failureReason: z.string().max(200).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type CardSetupEvent = z.infer<typeof CardSetupEvent>;

export interface CardVault {
  createCardSetup(
    ctx: ProviderContext,
    req: CardSetupRequest,
  ): Promise<{ redirectUrl: string; externalId: string }>;
  /** Verifies a callback came from the processor and reads it; null when it did not. */
  readCardWebhook(rawBody: string, headers: Headers): Promise<CardSetupEvent | null>;
}

export const CARD_SANDBOX_SIGNATURE_HEADER = 'x-rswim-card-signature';

export function signCardEvent(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** The demo vault: its card page is ours, and its callbacks are signed like a real processor's would be. */
export class SandboxCardVault implements CardVault {
  constructor(private readonly secret: string) {}

  async createCardSetup(ctx: ProviderContext, req: CardSetupRequest) {
    const externalId = `sbx_setup_${createHash('sha256').update(ctx.idempotencyKey).digest('hex').slice(0, 16)}`;
    const url = new URL(req.sandboxUrl);
    url.searchParams.set('x', externalId);
    return { redirectUrl: url.toString(), externalId };
  }

  /** What the demo card page sends when the owner approves or declines (signed with the vault's secret). */
  signedEvent(event: CardSetupEvent): { body: string; headers: Headers } {
    const body = JSON.stringify(event);
    return {
      body,
      headers: new Headers({ [CARD_SANDBOX_SIGNATURE_HEADER]: signCardEvent(body, this.secret) }),
    };
  }

  async readCardWebhook(rawBody: string, headers: Headers): Promise<CardSetupEvent | null> {
    const sig = headers.get(CARD_SANDBOX_SIGNATURE_HEADER);
    if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
    const expected = Buffer.from(signCardEvent(rawBody, this.secret), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const parsed = CardSetupEvent.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
}

/**
 * The platform's card vault, or null while none is live. A sandboxed process gets the demo vault (its secret is
 * `GROW_WEBHOOK_SECRET` when set). The real Grow adapter arrives with the platform's Grow sandbox account.
 */
export function platformCardVault(
  env: Record<string, string | undefined> = process.env,
): CardVault | null {
  if (gatewaySandbox(env))
    return new SandboxCardVault(env.GROW_WEBHOOK_SECRET ?? 'sandbox-card-vault');
  return null;
}
