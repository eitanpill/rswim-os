/**
 * The guest's reminder (docs/LODGING.md, "The day before"): at 17:00 each guest arriving tomorrow hears on WhatsApp
 * when to come, which room is theirs, how to get here (the business's arrival note) and what is still owed, with a
 * payment link when the business takes payments online. Once per booking and arrival day.
 */
import { and, eq, inArray, isNotNull, ne, schema, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import { type ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { bookingOf, requestPayment } from './payments';
import { addDays, reminderPayFor, reminderText } from './policies';
import { getLodgingSettings, loadRooms, releaseLapsedHolds } from './services';

const { lodgingStays, organizations } = schema;

export interface RemindersResult {
  sent: number;
  reason?: 'off' | 'reminder_off';
}

export async function sendGuestReminders(
  tx: Tx,
  ctx: ServiceContext,
  publicUrl: string,
): Promise<RemindersResult> {
  const settings = await getLodgingSettings(tx);
  if (!settings.enabled) return { sent: 0, reason: 'off' };
  if (!settings.guestReminder) return { sent: 0, reason: 'reminder_off' };
  await releaseLapsedHolds(tx);
  const tomorrow = addDays(await todayIL(tx), 1);
  const stays = await tx
    .select()
    .from(lodgingStays)
    .where(
      and(
        eq(lodgingStays.checkIn, tomorrow),
        inArray(lodgingStays.status, ['held', 'confirmed']),
        ne(lodgingStays.source, 'block'),
        isNotNull(lodgingStays.phoneE164),
      ),
    );
  if (!stays.length) return { sent: 0 };
  const [rooms, [org]] = await Promise.all([
    loadRooms(tx),
    tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId)),
  ]);
  const byBooking = new Map<string, typeof stays>();
  for (const s of stays) byBooking.set(s.bookingId, [...(byBooking.get(s.bookingId) ?? []), s]);
  const base = publicUrl.replace(/\/$/, '');
  let sent = 0;
  for (const [bookingId, mine] of byBooking) {
    const [first] = mine;
    if (!first?.phoneE164) continue;
    const phone = first.phoneE164;
    const where = mine
      .map((s) => {
        const room = rooms.find((r) => r.id === s.roomId);
        const bed = s.bedId ? room?.beds.find((b) => b.id === s.bedId) : undefined;
        return bed ? `${room?.name ?? ''} ${bed.label}` : (room?.name ?? '');
      })
      .join(', ');
    const view = await bookingOf(tx, bookingId);
    const due = view.money.dueAgorot;
    let payUrl: string | null = null;
    if (due !== null && due > 0 && view.processor) {
      // A link already open for this amount (sent by the office, or by an earlier run) is sent again.
      const open = view.links.find((l) => l.status === 'open' && l.amountAgorot === due);
      payUrl = open
        ? `${base}/pay/${open.token}`
        : (
            await requestPayment(
              tx,
              ctx,
              { stayId: first.id, what: 'balance' },
              { publicUrl: base, description: (s) => reminderPayFor(s, 'he'), message: () => '' },
            )
          ).url;
    }
    const out = await enqueueMessage(tx, ctx, {
      guardian: {
        id: null,
        householdId: null,
        firstName: first.guestName,
        phoneE164: phone,
        whatsappOptIn: true,
        locale: 'he',
      },
      templateKey: 'free_text',
      vars: (locale) => ({
        text: reminderText(
          {
            guestName: first.guestName,
            business: org?.name ?? '',
            checkIn: first.checkIn,
            checkOut: first.checkOut,
            checkInTime: settings.checkInTime,
            checkOutTime: settings.checkOutTime,
            where,
            arrivalNote: settings.arrivalNote,
            dueAgorot: due,
            payUrl,
          },
          locale,
        ),
      }),
      idempotencyKey: `lodging.reminder:${bookingId}:${first.checkIn}`,
    });
    if (out.created && out.status !== 'blocked') sent++;
  }
  return { sent };
}
