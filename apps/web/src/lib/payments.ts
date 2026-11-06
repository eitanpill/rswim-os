import 'server-only';
import { headers } from 'next/headers';
import type { CheckoutMethod } from '@rswim/contracts';
import {
  checkoutForToken,
  payNowAs,
  paymentsOfferFor,
  type GatewayFactory,
  type OpenCheckoutInput,
} from '@rswim/domain-billing';
import { settleDiveCheckout } from '@rswim/domain-dive/checkout';
import { createGateway, gatewaySandbox } from '@rswim/integrations';
import { isDemoMode } from './auth/dev';
import { acrossSchools, db, dbFor } from './db';

/**
 * The business's own processor in the web app (docs/PAYMENTS.md). In a sandboxed process (local, E2E, the live
 * demo: RSWIM_PAYMENTS_SANDBOX, RSWIM_GROW_FAKE or RSWIM_DEMO_MODE) every processor runs as the demo processor, whose
 * hosted page is our own /pay/<token>/sandbox. Never set in production.
 */
export function paymentsSandbox(): boolean {
  return gatewaySandbox() || isDemoMode();
}

export const gatewayFactory: GatewayFactory = (kind, creds, opts) =>
  createGateway(kind, creds, { ...opts, sandbox: paymentsSandbox() });

/** What a paid dive checkout settles (a booking or a pass), passed to the billing intake. */
export const onDivePaid = settleDiveCheckout;

/** This request's public origin (behind the platform's proxy too), for the processor's return and callback URLs. */
export async function requestOrigin(): Promise<string> {
  if (process.env.RSWIM_PUBLIC_URL) return process.env.RSWIM_PUBLIC_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function checkoutUrls(origin: string, token: string, connectionId: string) {
  return {
    successUrl: `${origin}/pay/${token}?back=1`,
    cancelUrl: `${origin}/pay/${token}`,
    notifyUrl: `${origin}/api/webhooks/pay/${connectionId}`,
    sandboxUrl: `${origin}/pay/${token}/sandbox`,
  };
}

/** The connected processor's methods for this business, or null (the family's and the diver's pay buttons). */
export function paymentsOffer(orgId: string): Promise<CheckoutMethod[] | null> {
  return dbFor(orgId).then((d) => paymentsOfferFor(d, orgId));
}

/** One click from the app: a checkout for what the customer pays, straight to the processor's page. */
export async function payNow(
  p: { orgId: string; userId: string },
  input: OpenCheckoutInput,
  method: CheckoutMethod,
): Promise<string> {
  const origin = await requestOrigin();
  return payNowAs(await dbFor(p.orgId), p, input, method, {
    build: gatewayFactory,
    urls: (token, connectionId) => checkoutUrls(origin, token, connectionId),
  });
}

/** The database that holds this payment link's checkout (a school's own one, or the platform's). */
export async function payTokenDb(token: string) {
  let found = db();
  await acrossSchools(
    async (d) => {
      const hit = await checkoutForToken(d, token);
      if (hit) found = d;
      return hit;
    },
    (hit) => !hit,
  );
  return found;
}
