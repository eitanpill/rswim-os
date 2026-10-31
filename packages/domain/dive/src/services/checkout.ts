/**
 * The diver's online checkout. A customer can never confirm their own booking (the database refuses it), so once
 * the payment provider says the money is in, the confirmation runs as the system for that one club (RLS still
 * scopes it), recording the signed-in diver as the actor. Until Grow is connected this is the demo checkout only.
 */
import type { Db } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { confirmOnlinePayment } from './actions';

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
