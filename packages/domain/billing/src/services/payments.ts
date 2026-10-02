/**
 * Money in and out (brief §6.7): standing orders, payments from the provider or recorded by hand (Bit, PayBox, cash,
 * transfer, cheque, with the cash handover), payment links and refunds. A payment's ledger entry is posted when it
 * succeeds; `billing.payment_succeeded` then asks the worker for the invoice-receipt. Calls to Grow happen in the
 * worker (collect.ts); these functions only change rows and announce events.
 */
import { z } from 'zod';
import {
  MANUAL_PAYMENT_METHODS,
  optionalText,
  requiredDate,
  requiredText,
  type PaymentMethod,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, isNull, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { optionalInt } from '@rswim/contracts';
import { closeCaseIfPaid, openOrUpdateCase } from './dunning';
import { balanceOfHousehold, postEntry } from './ledger';
import { guarded, positiveAgorot, todayIL } from './shared';

const { paymentLinks, payments, standingOrders } = schema;

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);

export type PaymentRow = typeof payments.$inferSelect;

// ─── Standing orders ────────────────────────────────────────────────────────

export const StandingOrderInput = z.object({
  householdId: z.uuid(),
  mandateId: requiredText(100),
  cardLast4: z.preprocess(
    blank,
    z
      .string()
      .regex(/^\d{4}$/, 'forms.errors.last4')
      .optional(),
  ),
  dayOfMonth: optionalInt(1, 28),
  amountAgorot: z.preprocess(blank, positiveAgorot().optional()),
});
export type StandingOrderInput = z.input<typeof StandingOrderInput>;

/** Records a standing order the family set up at Grow (or one imported from the old account). */
export async function addStandingOrder(tx: Tx, ctx: ServiceContext, raw: StandingOrderInput) {
  const input = StandingOrderInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(standingOrders)
      .values({
        organizationId: ctx.orgId,
        householdId: input.householdId,
        mandateId: input.mandateId,
        cardLast4: input.cardLast4 ?? null,
        dayOfMonth: input.dayOfMonth,
        amountAgorot: input.amountAgorot ?? null,
        createdBy: ctx.userId,
      })
      .returning({ id: standingOrders.id }),
  );
  return (row as { id: string }).id;
}

/** Cancels a standing order here; the worker cancels it at the provider (`billing.standing_order_cancelled`). */
export async function cancelStandingOrder(tx: Tx, ctx: ServiceContext, id: string) {
  const [row] = await tx
    .update(standingOrders)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(eq(standingOrders.id, id), ne(standingOrders.status, 'cancelled')))
    .returning();
  if (!row) throw new DomainError('common.errors.notFound');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.standing_order_cancelled',
    payload: { standingOrderId: id, provider: row.provider, mandateId: row.mandateId },
    idempotencyKey: `billing.standing_order_cancelled:${id}`,
  });
}

export async function standingOrdersOf(tx: Tx, householdId: string) {
  return tx
    .select()
    .from(standingOrders)
    .where(eq(standingOrders.householdId, householdId))
    .orderBy(asc(standingOrders.createdAt));
}

/** The mandate a household is charged through: an active one first, else one that is failing (retries). */
export async function chargeableMandate(tx: Tx, householdId: string) {
  const rows = await tx
    .select()
    .from(standingOrders)
    .where(
      and(
        eq(standingOrders.householdId, householdId),
        inArray(standingOrders.status, ['active', 'failing']),
      ),
    )
    .orderBy(asc(standingOrders.createdAt));
  return rows.find((r) => r.status === 'active') ?? rows[0] ?? null;
}

// ─── Payments ───────────────────────────────────────────────────────────────

export const ManualPaymentInput = z.object({
  householdId: z.uuid(),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amountAgorot: positiveAgorot(),
  paidOn: requiredDate(),
  receivedByStaffId: z.preprocess(blank, z.uuid().optional()),
  note: optionalText(500),
  requestId: z.uuid(),
});
export type ManualPaymentInput = z.input<typeof ManualPaymentInput>;

/** The office records money that reached the business outside Grow; the receipt follows from the worker. */
export async function recordManualPayment(tx: Tx, ctx: ServiceContext, raw: ManualPaymentInput) {
  const input = ManualPaymentInput.parse(raw);
  const [row] = await tx
    .insert(payments)
    .values({
      organizationId: ctx.orgId,
      householdId: input.householdId,
      kind: 'payment',
      method: input.method,
      source: 'manual',
      status: 'pending',
      amountAgorot: input.amountAgorot,
      receivedByStaffId: input.receivedByStaffId ?? null,
      note: input.note,
      recordedBy: ctx.userId,
      idempotencyKey: `manual:${input.requestId}`,
    })
    .onConflictDoNothing({ target: [payments.organizationId, payments.idempotencyKey] })
    .returning({ id: payments.id });
  if (!row) throw new DomainError('forms.errors.duplicate');
  await settlePayment(tx, ctx, row.id, { paidOn: input.paidOn });
  return row.id;
}

/**
 * A payment succeeded: post its ledger entry, mark the mandate healthy and the link paid, close a dunning case the
 * balance no longer justifies, and ask for the receipt. Settling twice changes nothing.
 */
export async function settlePayment(
  tx: Tx,
  ctx: ServiceContext,
  paymentId: string,
  opts: { paidOn?: string; externalId?: string | null } = {},
) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
  if (!p) throw new DomainError('common.errors.notFound');
  if (p.status === 'succeeded') return { alreadySettled: true };
  const paidOn = opts.paidOn ?? (await todayIL(tx));
  await tx
    .update(payments)
    .set({
      status: 'succeeded',
      paidOn,
      failureReason: null,
      externalId: opts.externalId ?? p.externalId,
    })
    .where(eq(payments.id, paymentId));
  await postEntry(tx, ctx, {
    householdId: p.householdId,
    type: p.kind === 'refund' ? 'refund' : 'payment',
    amountAgorot: p.kind === 'refund' ? p.amountAgorot : -p.amountAgorot,
    description: p.note ?? '',
    source: p.kind === 'refund' ? 'refund' : 'payment',
    paymentId,
    occurredOn: paidOn,
    idempotencyKey: `payment:${paymentId}`,
  });
  if (p.kind === 'refund') return { alreadySettled: false };
  if (p.standingOrderId) {
    await tx
      .update(standingOrders)
      .set({ status: 'active' })
      .where(and(eq(standingOrders.id, p.standingOrderId), eq(standingOrders.status, 'failing')));
  }
  if (p.paymentLinkId) {
    await tx
      .update(paymentLinks)
      .set({ status: 'paid', paidAt: new Date() })
      .where(eq(paymentLinks.id, p.paymentLinkId));
  }
  await closeCaseIfPaid(tx, ctx, p.householdId);
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.payment_succeeded',
    payload: { paymentId, householdId: p.householdId, amountAgorot: p.amountAgorot },
    idempotencyKey: `billing.payment_succeeded:${paymentId}`,
  });
  return { alreadySettled: false };
}

/** A charge failed: the mandate is failing, and a dunning case opens (or records the failure). */
export async function failPayment(
  tx: Tx,
  ctx: ServiceContext,
  paymentId: string,
  opts: { reason: string; externalId?: string | null },
) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
  if (!p) throw new DomainError('common.errors.notFound');
  if (p.status === 'succeeded' || p.status === 'failed') return { caseId: null };
  await tx
    .update(payments)
    .set({
      status: 'failed',
      failureReason: opts.reason,
      externalId: opts.externalId ?? p.externalId,
    })
    .where(eq(payments.id, paymentId));
  if (p.standingOrderId) {
    await tx
      .update(standingOrders)
      .set({ status: 'failing', lastFailureAt: new Date(), lastFailureReason: opts.reason })
      .where(and(eq(standingOrders.id, p.standingOrderId), ne(standingOrders.status, 'cancelled')));
  }
  const caseId = await openOrUpdateCase(tx, ctx, {
    householdId: p.householdId,
    paymentId,
    amountAgorot: p.amountAgorot,
    reason: opts.reason,
  });
  return { caseId };
}

/** A provider payment waiting for its result. */
export async function createPendingPayment(
  tx: Tx,
  ctx: ServiceContext,
  input: {
    householdId: string;
    amountAgorot: number;
    method: PaymentMethod;
    idempotencyKey: string;
    billingRunId?: string | null;
    standingOrderId?: string | null;
    paymentLinkId?: string | null;
    attempt?: number;
    note?: string | null;
  },
) {
  await tx
    .insert(payments)
    .values({
      organizationId: ctx.orgId,
      householdId: input.householdId,
      kind: 'payment',
      method: input.method,
      source: 'provider',
      provider: 'grow',
      status: 'pending',
      amountAgorot: input.amountAgorot,
      billingRunId: input.billingRunId ?? null,
      standingOrderId: input.standingOrderId ?? null,
      paymentLinkId: input.paymentLinkId ?? null,
      attempt: input.attempt ?? 1,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: [payments.organizationId, payments.idempotencyKey] });
  const [row] = await tx
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, input.idempotencyKey));
  return row as PaymentRow;
}

export async function paymentsOf(tx: Tx, householdId: string) {
  return tx
    .select()
    .from(payments)
    .where(eq(payments.householdId, householdId))
    .orderBy(desc(payments.createdAt));
}

/** Cash taken at the pool and not yet handed over, per staff member (the handover log). */
export async function cashNotHandedOver(tx: Tx) {
  return tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.method, 'cash'),
        eq(payments.status, 'succeeded'),
        isNull(payments.handedOverAt),
        sql`${payments.receivedByStaffId} is not null`,
      ),
    )
    .orderBy(asc(payments.paidOn));
}

export async function markHandedOver(tx: Tx, paymentIds: readonly string[]) {
  if (paymentIds.length === 0) return 0;
  const rows = await tx
    .update(payments)
    .set({ handedOverAt: new Date() })
    .where(and(inArray(payments.id, [...paymentIds]), isNull(payments.handedOverAt)))
    .returning({ id: payments.id });
  return rows.length;
}

// ─── Refunds ────────────────────────────────────────────────────────────────

export const RefundInput = z.object({
  paymentId: z.uuid(),
  amountAgorot: positiveAgorot(),
  /** `provider` refunds the card through Grow; anything else records money already returned off-platform. */
  via: z.enum(['provider', ...MANUAL_PAYMENT_METHODS]),
  note: requiredText(500),
  requestId: z.uuid(),
});
export type RefundInput = z.input<typeof RefundInput>;

/**
 * A full or partial refund of a payment, never more than what is left of it. Through the provider it waits for the
 * worker (`billing.refund_requested`); off-platform (Bit back to the family) it is recorded at once.
 */
export async function refundPayment(tx: Tx, ctx: ServiceContext, raw: RefundInput) {
  const input = RefundInput.parse(raw);
  const [p] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, input.paymentId))
    .for('update');
  if (!p || p.kind !== 'payment' || p.status !== 'succeeded') {
    throw new DomainError('billing.errors.notRefundable');
  }
  if (input.via === 'provider' && (p.source !== 'provider' || !p.externalId)) {
    throw new DomainError('billing.errors.notProviderPayment');
  }
  const r = await tx.execute<{ s: number }>(
    sql`select coalesce(sum(amount_agorot), 0)::int as s from payments
        where refund_of_payment_id = ${p.id} and status in ('pending', 'succeeded')`,
  );
  const left = p.amountAgorot - (r.rows[0] as { s: number }).s;
  if (input.amountAgorot > left) {
    throw new DomainError('billing.errors.refundTooMuch', { left });
  }
  const viaProvider = input.via === 'provider';
  const [row] = await tx
    .insert(payments)
    .values({
      organizationId: ctx.orgId,
      householdId: p.householdId,
      kind: 'refund',
      method: viaProvider ? p.method : input.via,
      source: viaProvider ? 'provider' : 'manual',
      provider: viaProvider ? p.provider : null,
      status: 'pending',
      amountAgorot: input.amountAgorot,
      refundOfPaymentId: p.id,
      note: input.note,
      recordedBy: ctx.userId,
      idempotencyKey: `refund:${input.requestId}`,
    })
    .onConflictDoNothing({ target: [payments.organizationId, payments.idempotencyKey] })
    .returning({ id: payments.id });
  if (!row) throw new DomainError('forms.errors.duplicate');
  if (viaProvider) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'billing.refund_requested',
      payload: { refundId: row.id, paymentId: p.id, amountAgorot: input.amountAgorot },
      idempotencyKey: `billing.refund_requested:${row.id}`,
    });
  } else {
    await settlePayment(tx, ctx, row.id);
  }
  return row.id;
}

// ─── Payment links ──────────────────────────────────────────────────────────

export const LinkInput = z.object({
  householdId: z.uuid(),
  amountAgorot: positiveAgorot(),
  description: requiredText(200),
  termsText: optionalText(500),
  requestId: z.uuid(),
});
export type LinkInput = z.input<typeof LinkInput>;

/** A link the office sends (a trial, a one-off); the worker creates it at Grow and Phase 5 sends it. */
export async function requestPaymentLink(
  tx: Tx,
  ctx: ServiceContext,
  raw: LinkInput,
  opts: { billingRunId?: string | null; idempotencyKey?: string } = {},
) {
  const input = LinkInput.parse(raw);
  const key = opts.idempotencyKey ?? `link:${input.requestId}`;
  await tx
    .insert(paymentLinks)
    .values({
      organizationId: ctx.orgId,
      householdId: input.householdId,
      amountAgorot: input.amountAgorot,
      description: input.description,
      termsText: input.termsText,
      billingRunId: opts.billingRunId ?? null,
      idempotencyKey: key,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing({ target: [paymentLinks.organizationId, paymentLinks.idempotencyKey] });
  const [link] = await tx.select().from(paymentLinks).where(eq(paymentLinks.idempotencyKey, key));
  const id = (link as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.payment_link_requested',
    payload: { linkId: id },
    idempotencyKey: `billing.payment_link_requested:${id}`,
  });
  return id;
}

export async function cancelPaymentLink(tx: Tx, id: string) {
  const rows = await tx
    .update(paymentLinks)
    .set({ status: 'cancelled' })
    .where(and(eq(paymentLinks.id, id), eq(paymentLinks.status, 'open')))
    .returning({ id: paymentLinks.id });
  if (rows.length === 0) throw new DomainError('billing.errors.linkNotOpen');
}

export async function linksOf(tx: Tx, householdId: string) {
  return tx
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.householdId, householdId))
    .orderBy(desc(paymentLinks.createdAt));
}

export { balanceOfHousehold };
