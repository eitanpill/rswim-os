/**
 * The cross-tenant edges of checkouts (ADR-0005), like the Grow webhook intake: finding a checkout's business from the
 * token a signed-out customer holds, and a processor callback's business from its connection. Everything after that
 * runs in the business's own RLS scope.
 */
import { randomUUID } from 'node:crypto';
import type { CheckoutMethod } from '@rswim/contracts';
import { eq, schema, type Db } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { DomainError } from '@rswim/domain-core';
import { SANDBOX_SIGNATURE_HEADER, signSandboxEvent, type GatewayEvent } from '@rswim/integrations';
import {
  applyGatewayEvent,
  checkoutPage,
  openCheckout,
  startCheckout,
  type CheckoutUrls,
  type DivePaidHook,
  type GatewayEventOutcome,
  type OpenCheckoutInput,
} from './checkout';
import { loadGateway, paymentConnection, type GatewayFactory } from './gateway';

const { checkouts, paymentConnections, webhookEvents } = schema;

/** Finds a checkout's organization from its token (the customer is not signed in): a cross-tenant lookup. */
export async function checkoutByToken(
  db: Db,
  token: string,
): Promise<{ orgId: string; id: string } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const [row] = await asPlatform(db, (tx) =>
    tx
      .select({ orgId: checkouts.organizationId, id: checkouts.id })
      .from(checkouts)
      .where(eq(checkouts.token, token)),
  );
  return row ?? null;
}

export type IngestOutcome =
  GatewayEventOutcome | 'unknown_connection' | 'not_configured' | 'rejected' | 'duplicate';

/**
 * A processor callback for one business's connection (/api/webhooks/pay/<connectionId>). The connection names the
 * business (a cross-tenant lookup); its gateway verifies the callback with that business's own secrets; the event is
 * stored once by the processor's event id and applied at once in the business's scope, so the customer sees "paid"
 * when they come back. Receipts and messages follow from the outbox as for any payment.
 */
export async function ingestGatewayWebhook(
  db: Db,
  connectionId: string,
  rawBody: string,
  headers: Headers,
  opts: { build: GatewayFactory; onDivePaid?: DivePaidHook },
): Promise<IngestOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return 'unknown_connection';
  const [conn] = await asPlatform(db, (tx) =>
    tx
      .select({ orgId: paymentConnections.organizationId })
      .from(paymentConnections)
      .where(eq(paymentConnections.id, connectionId)),
  );
  if (!conn) return 'unknown_connection';
  const loaded = await withOrg(db, conn.orgId, (tx) =>
    loadGateway(tx, conn.orgId, { build: opts.build }),
  );
  if (!loaded?.gateway || loaded.connectionId !== connectionId) return 'not_configured';
  const event = await loaded.gateway.readWebhook(rawBody, headers);
  if (!event) return 'rejected';
  const source = `gateway:${connectionId}`;
  const [stored] = await asPlatform(db, (tx) =>
    tx
      .insert(webhookEvents)
      .values({
        organizationId: conn.orgId,
        provider: source,
        externalId: event.eventId,
        raw: event,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id }),
  );
  if (!stored) return 'duplicate';
  let outcome: GatewayEventOutcome;
  try {
    outcome = await withOrg(db, conn.orgId, (tx) =>
      applyGatewayEvent(tx, { orgId: conn.orgId, userId: null }, event, {
        onDivePaid: opts.onDivePaid,
      }),
    );
  } catch (e) {
    // Forget the event so the processor's retry applies it again (it retries on our error answer).
    await asPlatform(db, (tx) => tx.delete(webhookEvents).where(eq(webhookEvents.id, stored.id)));
    throw e;
  }
  await asPlatform(db, (tx) =>
    tx
      .update(webhookEvents)
      .set({ status: outcome, processedAt: new Date() })
      .where(eq(webhookEvents.id, stored.id)),
  );
  return outcome;
}

// ─── The signed-out payment page and one-click payments, each in the business's own scope ─────────────────────

/** The payment page's view for a token, read as the business's system role. */
export async function checkoutForToken(db: Db, token: string) {
  const found = await checkoutByToken(db, token);
  if (!found) return null;
  const view = await withOrg(db, found.orgId, (tx) => checkoutPage(tx, found.id));
  return view ? { ...found, view } : null;
}

/** The customer tapped a way to pay on the page: open the processor's page for it and return where to go. */
export async function startCheckoutForToken(
  db: Db,
  token: string,
  method: CheckoutMethod,
  opts: { build: GatewayFactory; urls: (connectionId: string) => CheckoutUrls },
): Promise<string> {
  const found = await checkoutByToken(db, token);
  if (!found) throw new DomainError('payments.errors.notOpen');
  return withOrg(db, found.orgId, async (tx) => {
    const loaded = await loadGateway(tx, found.orgId, { build: opts.build });
    if (!loaded?.gateway) throw new DomainError('payments.errors.notConnected');
    return startCheckout(
      tx,
      { orgId: found.orgId, userId: null },
      loaded.gateway,
      found.id,
      method,
      opts.urls(loaded.connectionId),
    );
  });
}

/** The connected processor's methods, or null (for the family's and the diver's pay buttons). */
export async function paymentsOfferFor(db: Db, orgId: string): Promise<CheckoutMethod[] | null> {
  const conn = await withOrg(db, orgId, (tx) => paymentConnection(tx));
  return conn?.status === 'connected' ? conn.methods : null;
}

/**
 * One click from the app: opens a checkout for what the signed-in customer is paying (checked by the caller, as
 * them) and returns the processor's page for the method they tapped. The customer is recorded as the actor.
 */
export async function payNowAs(
  db: Db,
  p: { orgId: string; userId: string },
  input: OpenCheckoutInput,
  method: CheckoutMethod,
  opts: { build: GatewayFactory; urls: (token: string, connectionId: string) => CheckoutUrls },
): Promise<string> {
  return withOrg(
    db,
    p.orgId,
    async (tx) => {
      const loaded = await loadGateway(tx, p.orgId, { build: opts.build });
      if (!loaded?.gateway) throw new DomainError('payments.errors.notConnected');
      const c = await openCheckout(tx, p, input);
      return startCheckout(
        tx,
        p,
        loaded.gateway,
        c.id,
        method,
        opts.urls(c.token, loaded.connectionId),
      );
    },
    { actorId: p.userId },
  );
}

/**
 * The demo processor's hosted page answered (sandboxed processes only; the caller checks). It signs its callback
 * with the business's webhook secret and sends it through the same intake a real processor's callback goes through.
 */
export async function answerSandboxCheckout(
  db: Db,
  token: string,
  method: CheckoutMethod,
  approve: boolean,
  opts: { build: GatewayFactory; onDivePaid?: DivePaidHook },
): Promise<IngestOutcome | 'not_open'> {
  const found = await checkoutByToken(db, token);
  if (!found) return 'not_open';
  let secret = '';
  const opened = await withOrg(db, found.orgId, async (tx) => ({
    page: await checkoutPage(tx, found.id),
    loaded: await loadGateway(tx, found.orgId, {
      build: (kind, creds, o) => {
        secret = o.webhookSecret;
        return opts.build(kind, creds, o);
      },
    }),
  }));
  if (!opened.page || opened.page.status !== 'open') return 'not_open';
  if (!opened.loaded?.gateway) return 'not_configured';
  const event: GatewayEvent = {
    eventId: `sbx_evt_${randomUUID()}`,
    type: approve ? 'checkout.paid' : 'checkout.failed',
    reference: found.id,
    externalPaymentId: `sbx_pay_${randomUUID().slice(0, 12)}`,
    method,
    amountAgorot: opened.page.amount,
    ...(approve && method === 'standing_order'
      ? { mandate: { mandateId: `sbx_tok_${randomUUID().slice(0, 12)}`, cardLast4: '4242' } }
      : {}),
    ...(approve ? {} : { failureReason: method === 'bit' ? 'bit_declined' : 'card_declined' }),
    occurredAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(event);
  return ingestGatewayWebhook(
    db,
    opened.loaded.connectionId,
    raw,
    new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(raw, secret) }),
    opts,
  );
}
