/**
 * A booking's deposit and payments (docs/LODGING.md, "Deposits and payments"). The office records what the guest paid
 * by hand, or sends a payment link (a checkout on the business's own processor, /pay/<token>); the processor's
 * verified callback records the payment through `settleLodgingCheckout`. A held booking is confirmed once its deposit
 * is in; one whose deposit never came frees its room when its hold ends (`releaseLapsedHolds`), and a payment that
 * still arrives brings it back while the room is free.
 */
import { z } from 'zod';
import {
  checkbox,
  LODGING_OFFICE_METHODS,
  optionalText,
  requiredInt,
  type LodgingPaymentKind,
  type LodgingPaymentMethod,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, isNotNull, schema, sql, type Tx } from '@rswim/db';
import { openCheckout, type CheckoutRow } from '@rswim/domain-billing';
import { enqueueMessage } from '@rswim/domain-comms';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import type { GatewayEvent } from '@rswim/integrations';
import { amountToRequest, bookingMoney, type BookingMoney } from './deposit';
import { getLodgingSettings } from './services';

const { lodgingStays, lodgingPayments, checkouts, paymentConnections } = schema;

export interface LodgingPaymentRow {
  id: string;
  kind: LodgingPaymentKind;
  method: LodgingPaymentMethod;
  amountAgorot: number;
  note: string | null;
  createdAt: Date;
}

export interface PaymentLinkRow {
  token: string;
  amountAgorot: number;
  status: string;
  expiresAt: Date;
}

export interface BookingView {
  bookingId: string;
  stayIds: string[];
  money: BookingMoney;
  depositPercent: number;
  payments: LodgingPaymentRow[];
  /** Payment links sent for this booking, newest first. */
  links: PaymentLinkRow[];
  /** The business connected its processor (payment links work). */
  processor: boolean;
}

async function stayOf(tx: Tx, stayId: string) {
  const [row] = await tx.select().from(lodgingStays).where(eq(lodgingStays.id, stayId));
  if (!row) throw new DomainError('common.errors.notFound');
  // A room closed for repair has nothing to pay.
  if (row.source === 'block') throw new DomainError('lodging.errors.notPayable');
  return row;
}

/** A booking's stays, price, payments and links (the stay page's money card). */
export async function bookingOf(tx: Tx, bookingId: string): Promise<BookingView> {
  const [stays, payments, links, settings, conn] = await Promise.all([
    tx.select().from(lodgingStays).where(eq(lodgingStays.bookingId, bookingId)),
    tx
      .select()
      .from(lodgingPayments)
      .where(eq(lodgingPayments.bookingId, bookingId))
      .orderBy(asc(lodgingPayments.createdAt)),
    tx
      .select({
        token: checkouts.token,
        amountAgorot: checkouts.amountAgorot,
        status: checkouts.status,
        expiresAt: checkouts.expiresAt,
      })
      .from(checkouts)
      .where(
        and(
          eq(checkouts.purpose, 'lodging_stay'),
          sql`${checkouts.ref} ->> 'bookingId' = ${bookingId}`,
        ),
      )
      .orderBy(desc(checkouts.createdAt)),
    getLodgingSettings(tx),
    tx
      .select({ id: paymentConnections.id })
      .from(paymentConnections)
      .where(eq(paymentConnections.status, 'connected')),
  ]);
  // Cancelled beds of a booking cost nothing; the price is what is still booked.
  const live = stays.filter((s) => s.status !== 'cancelled');
  const priced = live.length ? live : stays;
  const total = priced.some((s) => s.totalAgorot === null)
    ? null
    : priced.reduce((sum, s) => sum + (s.totalAgorot ?? 0), 0);
  const lines = payments.map((p) => ({
    id: p.id,
    kind: p.kind as LodgingPaymentKind,
    method: p.method as LodgingPaymentMethod,
    amountAgorot: p.amountAgorot,
    note: p.note,
    createdAt: p.createdAt,
  }));
  return {
    bookingId,
    stayIds: stays.map((s) => s.id),
    money: bookingMoney(total, lines, settings.depositPercent),
    depositPercent: settings.depositPercent,
    payments: lines,
    links: links.map((l) => ({
      ...l,
      status: l.status === 'open' && l.expiresAt.getTime() < Date.now() ? 'expired' : l.status,
    })),
    processor: conn.length > 0,
  };
}

/**
 * Once the deposit is in, a held booking is confirmed. A booking that lapsed while the guest was paying comes back
 * when its room is still free (otherwise it stays cancelled and the office refunds).
 */
async function confirmIfDeposited(
  tx: Tx,
  bookingId: string,
): Promise<'confirmed' | 'taken' | 'no'> {
  const view = await bookingOf(tx, bookingId);
  if (!view.money.depositPaid) return 'no';
  const held = await tx
    .update(lodgingStays)
    .set({ status: 'confirmed', holdUntil: null })
    .where(and(eq(lodgingStays.bookingId, bookingId), eq(lodgingStays.status, 'held')))
    .returning({ id: lodgingStays.id });
  const lapsed = await tx
    .select({ id: lodgingStays.id })
    .from(lodgingStays)
    .where(
      and(
        eq(lodgingStays.bookingId, bookingId),
        eq(lodgingStays.status, 'cancelled'),
        isNotNull(lodgingStays.holdUntil),
      ),
    );
  if (!lapsed.length) return held.length ? 'confirmed' : 'no';
  try {
    await tx.transaction((sp) =>
      sp
        .update(lodgingStays)
        .set({ status: 'confirmed', holdUntil: null })
        .where(
          inArray(
            lodgingStays.id,
            lapsed.map((s) => s.id),
          ),
        ),
    );
    return 'confirmed';
  } catch {
    return 'taken';
  }
}

export const PaymentInput = z.object({
  stayId: z.uuid(),
  /** Agorot (the form's shekels go through shekelFields). */
  amount: requiredInt(1, 100_000_000),
  method: z.enum(LODGING_OFFICE_METHODS, 'forms.errors.invalid'),
  refund: checkbox().default(false),
  note: optionalText(300),
});
export type PaymentInput = z.input<typeof PaymentInput>;

/** The office records what the guest paid (or what was given back); a deposit that is now in confirms a held booking. */
export async function recordPayment(
  tx: Tx,
  ctx: ServiceContext,
  input: PaymentInput,
): Promise<{ confirmed: boolean }> {
  const v = PaymentInput.parse(input);
  const stay = await stayOf(tx, v.stayId);
  if (v.refund) {
    const view = await bookingOf(tx, stay.bookingId);
    if (v.amount > view.money.paidAgorot) throw new DomainError('lodging.errors.refundTooMuch');
  }
  await tx.insert(lodgingPayments).values({
    organizationId: ctx.orgId,
    bookingId: stay.bookingId,
    kind: v.refund ? 'refund' : 'payment',
    method: v.method,
    amountAgorot: v.amount,
    note: v.note,
    createdBy: ctx.userId,
  });
  if (v.refund) return { confirmed: false };
  return { confirmed: (await confirmIfDeposited(tx, stay.bookingId)) === 'confirmed' };
}

export const PAY_REQUESTS = ['deposit', 'balance'] as const;
export const PayRequestInput = z.object({
  stayId: z.uuid(),
  what: z.enum(PAY_REQUESTS),
  send: checkbox().default(false),
});
export type PayRequestInput = z.input<typeof PayRequestInput>;

/**
 * A payment link for the deposit still missing or the whole balance: a checkout on the business's own processor. A
 * deposit link for a held booking lasts as long as the hold. With `send`, the guest gets it on WhatsApp (the caller
 * words the message). Returns the link's token.
 */
export async function requestPayment(
  tx: Tx,
  ctx: ServiceContext,
  input: PayRequestInput,
  words: {
    description: (stay: { guestName: string; checkIn: string; checkOut: string }) => string;
    message: (url: string, amountAgorot: number) => string;
    publicUrl: string;
  },
): Promise<{ token: string; url: string; amountAgorot: number; sent: boolean }> {
  const v = PayRequestInput.parse(input);
  const stay = await stayOf(tx, v.stayId);
  if (stay.status === 'cancelled' || stay.status === 'checked_out') {
    throw new DomainError('lodging.errors.notPayable');
  }
  const view = await bookingOf(tx, stay.bookingId);
  const amount = amountToRequest(view.money, v.what);
  if (amount <= 0) throw new DomainError('lodging.errors.nothingDue');
  const expiresAt =
    v.what === 'deposit' && stay.status === 'held' && stay.holdUntil ? stay.holdUntil : undefined;
  const made = await openCheckout(tx, ctx, {
    purpose: 'lodging_stay',
    amountAgorot: amount,
    description: words.description(stay),
    ref: { bookingId: stay.bookingId, stayId: stay.id, what: v.what },
    ...(expiresAt ? { expiresAt } : {}),
  });
  const url = `${words.publicUrl.replace(/\/$/, '')}/pay/${made.token}`;
  let sent = false;
  if (v.send) {
    if (!stay.phoneE164) throw new DomainError('lodging.errors.noPhone');
    const out = await enqueueMessage(tx, ctx, {
      guardian: {
        id: null,
        householdId: null,
        firstName: stay.guestName,
        phoneE164: stay.phoneE164,
        whatsappOptIn: true,
        locale: 'he',
      },
      templateKey: 'free_text',
      vars: { text: words.message(url, amount) },
      idempotencyKey: `lodging.pay_link:${made.id}`,
    });
    sent = out.status !== 'blocked';
  }
  return { token: made.token, url, amountAgorot: amount, sent };
}

/**
 * Settles a lodging checkout once the business's processor confirms it (the billing intake's module hook): the payment
 * is recorded once per checkout, and a held booking whose deposit is now in is confirmed.
 */
export async function settleLodgingCheckout(
  tx: Tx,
  ctx: ServiceContext,
  checkout: Pick<CheckoutRow, 'id' | 'ref' | 'amountAgorot' | 'description'>,
  event: Pick<GatewayEvent, 'externalPaymentId'>,
): Promise<'confirmed' | 'taken' | 'no'> {
  const ref = checkout.ref as { bookingId?: string };
  if (!ref.bookingId) throw new Error('lodging checkout without a booking');
  await tx
    .insert(lodgingPayments)
    .values({
      organizationId: ctx.orgId,
      bookingId: ref.bookingId,
      kind: 'payment',
      method: 'online',
      amountAgorot: checkout.amountAgorot,
      checkoutId: checkout.id,
      externalId: event.externalPaymentId,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing();
  return confirmIfDeposited(tx, ref.bookingId);
}
