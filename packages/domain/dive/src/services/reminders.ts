/**
 * The day-before reminder: every diver booked for tomorrow gets a WhatsApp message with the time, the session and the
 * site (and a nudge to pay if their seat is still held for payment). The worker calls this once a day per club; each
 * booking emits one `dive.session_reminder` event, idempotent per booking, and the club's messaging automation (on by
 * default, switchable in the messages settings) renders and sends it within the send window.
 */
import { sql, type Tx } from '@rswim/db';
import { emit, type ServiceContext } from '@rswim/domain-core';
import { rows } from './shared';

/** Queues tomorrow's reminders (Israel date). Returns how many bookings were reminded. */
export async function queueSessionReminders(tx: Tx, ctx: ServiceContext): Promise<number> {
  const due = await rows<{ id: string; session_id: string; diver_id: string }>(
    tx,
    sql`select b.id, b.session_id, b.diver_id
        from dive_bookings b
        join dive_sessions s on s.id = b.session_id
        where (s.starts_at at time zone 'Asia/Jerusalem')::date = app.today() + 1
          and s.status not in ('cancelled', 'done')
          and b.status in ('booked', 'pending_payment')`,
  );
  for (const b of due) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'dive.session_reminder',
      payload: { bookingId: b.id, sessionId: b.session_id, diverId: b.diver_id },
      idempotencyKey: `dive.session_reminder:${b.id}`,
    });
  }
  return due.length;
}
