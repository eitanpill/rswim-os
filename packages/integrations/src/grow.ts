/**
 * Grow (Meshulam) webhooks, as this system reads them. The real adapter maps Grow's callback fields onto
 * `GrowWebhook` once Pit's account and its documentation are available; until then the fake provider and the tests
 * send this shape. Bodies are signed with HMAC-SHA256 over the raw body (`x-grow-signature`, hex).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const GROW_EVENT_TYPES = ['charge.succeeded', 'charge.failed', 'link.paid'] as const;

export const GrowWebhook = z.object({
  /** The provider's event id: a redelivery carries the same one. */
  id: z.string().min(1),
  type: z.enum(GROW_EVENT_TYPES),
  /** The provider's payment id (a standing-order charge, or the payment that paid a link). */
  paymentId: z.string().min(1),
  /** Set for `link.paid`. */
  linkId: z.string().min(1).optional(),
  mandateId: z.string().min(1).optional(),
  amountAgorot: z.number().int().positive(),
  failureReason: z.string().max(200).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type GrowWebhook = z.infer<typeof GrowWebhook>;

export function signGrowWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyGrowSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signGrowWebhook(rawBody, secret), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
