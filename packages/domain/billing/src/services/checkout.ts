/**
 * Checkouts: the customer's one-click payment page (/pay/<token>) on the business's own processor. A checkout holds
 * one amount and what it pays for; the customer picks a card, Bit or a standing order, the processor's hosted page
 * takes the money, and its verified callback settles what the checkout was for: a family's balance or link (a
 * payment, its ledger entry and receipt, and a standing order when a card was saved), or a dive booking or pass (by
 * the hook the dive module passes in).
 */
import { randomBytes } from 'node:crypto';
import type {
  CheckoutMethod,
  CheckoutPurpose,
  PaymentGatewayKind,
  PaymentMethod,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import type { GatewayEvent, PaymentGateway } from '@rswim/integrations';
import { agorot } from '@rswim/money';
import { createPendingPayment, settlePayment } from './payments';
import { orgBillingRules, todayIL } from './shared';

const { checkouts, paymentConnections, paymentLinks, standingOrders } = schema;

export type CheckoutRow = typeof checkouts.$inferSelect;

const DAY = 24 * 60 * 60 * 1000;

/** Which methods fit a purpose: a standing order only for families; a mandate checkout is nothing else. */
export function methodsFor(purpose: CheckoutPurpose, offered: readonly CheckoutMethod[]) {
  if (purpose === 'mandate') return offered.filter((m) => m === 'standing_order');
  if (purpose === 'household') return [...offered];
  return offered.filter((m) => m !== 'standing_order');
}

export interface OpenCheckoutInput {
  purpose: CheckoutPurpose;
  amountAgorot: number;
  description: string;
  householdId?: string | null;
  paymentLinkId?: string | null;
  ref?: Record<string, string>;
  /** Defaults to 14 days. */
  expiresAt?: Date;
}

/**
 * Opens a checkout on the business's connected processor (as the office, or as the system for a customer's own
 * request). Fails when no processor is connected or none of its methods fits.
 */
export async function openCheckout(tx: Tx, ctx: ServiceContext, input: OpenCheckoutInput) {
  const [conn] = await tx
    .select({ provider: paymentConnections.provider, methods: paymentConnections.methods })
    .from(paymentConnections)
    .where(eq(paymentConnections.status, 'connected'));
  if (!conn) throw new DomainError('payments.errors.notConnected');
  const methods = methodsFor(input.purpose, conn.methods as CheckoutMethod[]);
  if (methods.length === 0) throw new DomainError('payments.errors.noMethod');
  const token = randomBytes(24).toString('base64url');
  const [row] = await tx
    .insert(checkouts)
    .values({
      organizationId: ctx.orgId,
      token,
      purpose: input.purpose,
      householdId: input.householdId ?? null,
      paymentLinkId: input.paymentLinkId ?? null,
      ref: input.ref ?? {},
      amountAgorot: input.amountAgorot,
      description: input.description,
      methods,
      provider: conn.provider,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 14 * DAY),
      createdBy: ctx.userId,
    })
    .returning({ id: checkouts.id, token: checkouts.token });
  return row as { id: string; token: string };
}

/** The open checkout already made for a payment link (the worker opens one per link). */
export async function checkoutForLink(tx: Tx, paymentLinkId: string) {
  const [row] = await tx
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.paymentLinkId, paymentLinkId), eq(checkouts.status, 'open')))
    .orderBy(desc(checkouts.createdAt));
  return row ?? null;
}

/**
 * The worker turns an office payment link into a checkout on the business's own processor: the link's url becomes
 * the customer's payment page, and the link is announced for messaging exactly as a processor link was.
 */
export async function createLinkAsCheckout(
  tx: Tx,
  ctx: ServiceContext,
  linkId: string,
  publicUrl: string,
) {
  const [link] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, linkId));
  if (!link) throw new DomainError('common.errors.notFound');
  if (link.url || link.status !== 'open') return link.url;
  const made =
    (await checkoutForLink(tx, linkId)) ??
    (await openCheckout(tx, ctx, {
      purpose: 'household',
      householdId: link.householdId,
      paymentLinkId: link.id,
      amountAgorot: link.amountAgorot,
      description: link.description,
      expiresAt: new Date(Date.now() + 60 * DAY),
    }));
  const url = `${publicUrl.replace(/\/$/, '')}/pay/${made.token}`;
  await tx.update(paymentLinks).set({ url }).where(eq(paymentLinks.id, linkId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.payment_link_created',
    payload: { linkId, householdId: link.householdId, url, amountAgorot: link.amountAgorot },
    idempotencyKey: `billing.payment_link_created:${linkId}`,
  });
  return url;
}

/** What the payment page shows, read as the business's system role. */
export async function checkoutPage(tx: Tx, checkoutId: string) {
  const r = await tx.execute<{
    id: string;
    token: string;
    purpose: CheckoutPurpose;
    status: string;
    amount: number;
    description: string;
    methods: CheckoutMethod[];
    method: CheckoutMethod | null;
    expiresAt: string;
    failureReason: string | null;
    orgName: string;
    provider: PaymentGatewayKind | null;
    connected: boolean;
    payer: string | null;
    phone: string | null;
    email: string | null;
    cardLast4: string | null;
    chargeDay: number | null;
  }>(sql`
    select c.id, c.token, c.purpose, c.status, c.amount_agorot as amount, c.description, c.methods, c.method,
           c.expires_at as "expiresAt", c.failure_reason as "failureReason", coalesce(os.branding ->> 'displayName', o.name) as "orgName",
           pc.provider, coalesce(pc.status = 'connected', false) as connected,
           coalesce(g.first_name || ' ' || g.last_name, h.display_name) as payer,
           g.phone_e164 as phone, g.email,
           so.card_last4 as "cardLast4", so.day_of_month as "chargeDay"
    from checkouts c
    join organizations o on o.id = c.organization_id
    left join org_settings os on os.organization_id = c.organization_id
    left join payment_connections pc on pc.organization_id = c.organization_id
    left join households h on h.id = c.household_id
    left join lateral (
      select first_name, last_name, phone_e164, email from guardians
      where household_id = c.household_id order by is_billing_contact desc, created_at limit 1) g on true
    left join standing_orders so on so.id = c.standing_order_id
    where c.id = ${checkoutId}`);
  const row = r.rows[0];
  if (!row) return null;
  const expired = row.status === 'open' && new Date(row.expiresAt).getTime() < Date.now();
  return { ...row, status: expired ? 'expired' : row.status };
}
export type CheckoutPageView = NonNullable<Awaited<ReturnType<typeof checkoutPage>>>;

export interface CheckoutUrls {
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  sandboxUrl: string;
}

/**
 * The customer chose how to pay: the processor opens its hosted page for that method and we send the customer
 * there. Choosing again (back from the processor) reuses the same idempotency key per method, so no second charge is
 * ever opened for the same thing.
 */
export async function startCheckout(
  tx: Tx,
  ctx: ServiceContext,
  gateway: PaymentGateway,
  checkoutId: string,
  method: CheckoutMethod,
  urls: CheckoutUrls,
) {
  const v = await checkoutPage(tx, checkoutId);
  if (!v || v.status !== 'open') throw new DomainError('payments.errors.notOpen');
  if (!v.connected) throw new DomainError('payments.errors.notConnected');
  if (!v.methods.includes(method)) throw new DomainError('payments.errors.methodNotSupported');
  const session = await gateway.createCheckout(
    { organizationId: ctx.orgId, idempotencyKey: `checkout:${checkoutId}:${method}` },
    {
      reference: checkoutId,
      method,
      amount: agorot(v.amount),
      description: v.description,
      customer: {
        name: v.payer ?? v.orgName,
        phoneE164: v.phone ?? undefined,
        email: v.email ?? undefined,
      },
      ...urls,
    },
  );
  await tx
    .update(checkouts)
    .set({ method, externalId: session.externalId, provider: gateway.kind, failureReason: null })
    .where(eq(checkouts.id, checkoutId));
  return session.redirectUrl;
}

const PAYMENT_METHOD: Record<CheckoutMethod, PaymentMethod> = {
  card: 'credit_card',
  bit: 'bit',
  standing_order: 'credit_card',
};

/** Settles a dive booking or pass checkout (passed in by the dive module's caller). */
export type DivePaidHook = (
  tx: Tx,
  ctx: ServiceContext,
  checkout: CheckoutRow,
  event: GatewayEvent,
) => Promise<void>;

export type GatewayEventOutcome = 'paid' | 'already' | 'failed' | 'mismatch' | 'unknown';

/**
 * Applies a verified processor callback inside the business's scope. A paid family checkout records the payment
 * (ledger, link, dunning and receipt follow as for any payment) and, when the customer saved a card for a standing
 * order, the standing order the monthly runs charge from now on. Applying twice changes nothing.
 */
export async function applyGatewayEvent(
  tx: Tx,
  ctx: ServiceContext,
  event: GatewayEvent,
  hooks: { onDivePaid?: DivePaidHook } = {},
): Promise<GatewayEventOutcome> {
  const [c] = await tx
    .select()
    .from(checkouts)
    .where(eq(checkouts.id, event.reference))
    .for('update');
  if (!c) return 'unknown';
  if (c.status === 'paid') return 'already';
  if (event.type === 'checkout.failed') {
    await tx
      .update(checkouts)
      .set({ failureReason: event.failureReason ?? 'failed', method: event.method })
      .where(eq(checkouts.id, c.id));
    return 'failed';
  }
  if (event.amountAgorot !== c.amountAgorot || (c.purpose === 'mandate' && !event.mandate)) {
    await tx
      .update(checkouts)
      .set({ failureReason: 'amount_mismatch' })
      .where(eq(checkouts.id, c.id));
    return 'mismatch';
  }
  const provider = c.provider ?? 'unknown';
  let standingOrderId: string | null = null;
  let paymentId: string | null = null;

  if (c.purpose === 'household' || c.purpose === 'mandate') {
    const householdId = c.householdId as string;
    if (event.mandate) {
      const { rules } = await orgBillingRules(tx, await todayIL(tx));
      await tx
        .insert(standingOrders)
        .values({
          organizationId: ctx.orgId,
          householdId,
          provider,
          mandateId: event.mandate.mandateId,
          cardLast4: event.mandate.cardLast4,
          dayOfMonth: Math.min(Math.max(rules.runDay, 1), 28),
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
      const [so] = await tx
        .select({ id: standingOrders.id })
        .from(standingOrders)
        .where(
          and(
            eq(standingOrders.provider, provider),
            eq(standingOrders.mandateId, event.mandate.mandateId),
          ),
        );
      standingOrderId = so?.id ?? null;
      // A new card replaces a failing or older one: the family has one standing order at a time.
      await tx
        .update(standingOrders)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(
          and(
            eq(standingOrders.householdId, householdId),
            inArray(standingOrders.status, ['active', 'failing']),
            sql`${standingOrders.id} <> ${standingOrderId}`,
          ),
        );
    }
    if (c.amountAgorot > 0) {
      const payment = await createPendingPayment(tx, ctx, {
        householdId,
        amountAgorot: c.amountAgorot,
        method: PAYMENT_METHOD[event.method],
        provider,
        idempotencyKey: `checkout:${c.id}`,
        paymentLinkId: c.paymentLinkId,
        note: c.description,
      });
      await settlePayment(tx, ctx, payment.id, { externalId: event.externalPaymentId });
      paymentId = payment.id;
    }
  } else {
    if (!hooks.onDivePaid) throw new Error('dive checkout without a dive hook');
    await hooks.onDivePaid(tx, ctx, c, event);
  }

  await tx
    .update(checkouts)
    .set({
      status: 'paid',
      paidAt: new Date(event.occurredAt),
      method: event.method,
      paymentId,
      standingOrderId,
      failureReason: null,
    })
    .where(eq(checkouts.id, c.id));
  return 'paid';
}

/** Checkouts of a family, newest first (the office's and the family's view). */
export async function checkoutsOf(tx: Tx, householdId: string) {
  return tx
    .select()
    .from(checkouts)
    .where(eq(checkouts.householdId, householdId))
    .orderBy(desc(checkouts.createdAt));
}
