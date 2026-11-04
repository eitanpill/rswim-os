/**
 * The diver's online checkout. A customer can never confirm their own booking (the database refuses it), so once
 * the payment provider says the money is in, the confirmation runs as the system for that one club (RLS still
 * scopes it), recording the signed-in diver as the actor. Until Grow is connected this is the demo checkout only.
 */
import type { Db, Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { withOrg } from '@rswim/db/service';
import { confirmOnlinePayment, sellPass } from './actions';

export async function confirmCheckout(
  db: Db,
  p: { orgId: string; userId: string; bookingId: string; externalId: string },
): Promise<{ confirmed: boolean }> {
  return withOrg(
    db,
    p.orgId,
    (tx) =>
      confirmOnlinePayment(
        tx,
        { orgId: p.orgId, userId: p.userId },
        { bookingId: p.bookingId, externalId: p.externalId },
      ),
    { actorId: p.userId },
  );
}

/** The diver paid online for a pass: it is issued to them as the system for that one club. */
export async function confirmPassCheckout(
  db: Db,
  p: { orgId: string; userId: string; diverId: string; kind: string; label: string },
): Promise<{ passId: string }> {
  return withOrg(
    db,
    p.orgId,
    (tx) =>
      sellPass(
        tx,
        { orgId: p.orgId, userId: p.userId },
        { diverId: p.diverId, kind: p.kind as 'punch10', method: 'card', label: p.label },
      ),
    { actorId: p.userId },
  );
}

/**
 * Settles a dive checkout once the club's processor confirms it (passed to the billing module's webhook intake as
 * its dive hook): a booking is confirmed, or a pass is issued, as the diver who opened the checkout.
 */
export async function settleDiveCheckout(
  tx: Tx,
  ctx: ServiceContext,
  checkout: { purpose: string; ref: unknown; createdBy: string | null },
  event: { externalPaymentId: string; method: string },
): Promise<void> {
  const actor = { orgId: ctx.orgId, userId: checkout.createdBy };
  const method = event.method === 'bit' ? 'bit' : 'card';
  const ref = checkout.ref as Record<string, string>;
  if (checkout.purpose === 'dive_booking') {
    await confirmOnlinePayment(tx, actor, {
      bookingId: ref.bookingId as string,
      externalId: event.externalPaymentId,
      method,
    });
  } else if (checkout.purpose === 'dive_pass') {
    await sellPass(tx, actor, {
      diverId: ref.diverId as string,
      kind: ref.kind as 'punch10',
      method,
      label: ref.label as string,
    });
  }
}
