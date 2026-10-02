/**
 * Grow webhooks. A callback names the provider's payment or link, not our tenant, so finding the organization is a
 * cross-tenant lookup on the owner connection (like GHL's, ADR-0005). Intake only stores the verified body once (by
 * the provider's event id) and queues it; the worker applies it inside the organization's RLS scope.
 */
import { and, eq, schema, type Db, type Tx } from '@rswim/db';
import { asPlatform } from '@rswim/db/service';
import { emit, type ServiceContext } from '@rswim/domain-core';
import { GrowWebhook } from '@rswim/integrations';
import { applyChargeResult } from './collect';
import { createPendingPayment } from './payments';

const { paymentLinks, payments, webhookEvents } = schema;

export type GrowIntake = 'queued' | 'duplicate' | 'ignored' | 'unknown_payment';

export async function ingestGrowWebhook(db: Db, rawBody: string): Promise<GrowIntake> {
  const parsed = GrowWebhook.safeParse(JSON.parse(rawBody));
  if (!parsed.success) return 'ignored';
  const body = parsed.data;
  return asPlatform(db, async (tx) => {
    const orgId =
      body.type === 'link.paid' && body.linkId
        ? (
            await tx
              .select({ org: paymentLinks.organizationId })
              .from(paymentLinks)
              .where(
                and(eq(paymentLinks.provider, 'grow'), eq(paymentLinks.externalId, body.linkId)),
              )
          )[0]?.org
        : (
            await tx
              .select({ org: payments.organizationId })
              .from(payments)
              .where(and(eq(payments.provider, 'grow'), eq(payments.externalId, body.paymentId)))
          )[0]?.org;
    if (!orgId) return 'unknown_payment';
    const [row] = await tx
      .insert(webhookEvents)
      .values({ organizationId: orgId, provider: 'grow', externalId: body.id, raw: body })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!row) return 'duplicate';
    await emit(tx, {
      organizationId: orgId,
      type: 'billing.provider_webhook_received',
      payload: { webhookEventId: row.id },
      idempotencyKey: `billing.provider_webhook_received:${row.id}`,
    });
    return 'queued';
  });
}

/** The stored body of a Grow webhook, for the worker. Scoped to the event's organization. */
export async function growWebhookBody(
  db: Db,
  orgId: string,
  webhookEventId: string,
): Promise<GrowWebhook | null> {
  const [row] = await asPlatform(db, (tx) =>
    tx
      .select({ raw: webhookEvents.raw })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.id, webhookEventId),
          eq(webhookEvents.organizationId, orgId),
          eq(webhookEvents.provider, 'grow'),
        ),
      ),
  );
  return row ? GrowWebhook.parse(row.raw) : null;
}

/**
 * Applies a Grow event as the tenant's worker: a standing-order charge settles or fails its payment (a failure
 * opens dunning); a paid link records the payment that paid it. Returns what happened.
 */
export async function applyGrowWebhook(
  tx: Tx,
  ctx: ServiceContext,
  body: GrowWebhook,
): Promise<'settled' | 'failed' | 'unknown' | 'already'> {
  if (body.type === 'link.paid') {
    const [link] = await tx
      .select()
      .from(paymentLinks)
      .where(
        and(eq(paymentLinks.provider, 'grow'), eq(paymentLinks.externalId, body.linkId ?? '')),
      );
    if (!link) return 'unknown';
    if (link.status === 'paid') return 'already';
    const payment = await createPendingPayment(tx, ctx, {
      householdId: link.householdId,
      amountAgorot: body.amountAgorot,
      method: 'credit_card',
      idempotencyKey: `grow:${body.paymentId}`,
      billingRunId: link.billingRunId,
      paymentLinkId: link.id,
      note: link.description,
    });
    await applyChargeResult(tx, ctx, payment.id, {
      externalPaymentId: body.paymentId,
      status: 'succeeded',
    });
    return 'settled';
  }
  const [p] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.provider, 'grow'), eq(payments.externalId, body.paymentId)));
  if (!p) return 'unknown';
  if (p.status !== 'pending') return 'already';
  const status = await applyChargeResult(tx, ctx, p.id, {
    externalPaymentId: body.paymentId,
    status: body.type === 'charge.succeeded' ? 'succeeded' : 'failed',
    failureReason: body.failureReason,
  });
  return status === 'succeeded' ? 'settled' : 'failed';
}

export async function markGrowWebhookProcessed(db: Db, webhookEventId: string, status: string) {
  await asPlatform(db, (tx) =>
    tx
      .update(webhookEvents)
      .set({ status, processedAt: new Date() })
      .where(eq(webhookEvents.id, webhookEventId)),
  );
}
