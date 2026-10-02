/** Private, pair, trio, therapy, trial and makeup slots (brief §6.3): open them, book a child, cancel. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  optionalInt,
  optionalText,
  requiredDate,
  requiredInt,
  SLOT_DEFAULT_CAPACITY,
  SLOT_KINDS,
  TimeOfDay,
} from '@rswim/contracts';
import { addDays, dayInfo } from '@rswim/calendar';
import { and, asc, eq, gte, inArray, lte, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { checkInstructor, toMinutes } from '../policies';
import {
  byIds,
  instructorFacts,
  localInstant,
  optionalUuid,
  refuse,
  rulesFor,
  todayIL,
} from './shared';

const { privateSlots, slotBookings, sessions, sessionStaff } = schema;

export const SlotInput = z
  .object({
    staffMemberId: z.uuid(),
    venueId: z.uuid(),
    poolId: optionalUuid(),
    programId: optionalUuid(),
    kind: z.enum(SLOT_KINDS),
    date: requiredDate(),
    startsAt: TimeOfDay,
    endsAt: TimeOfDay,
    capacity: optionalInt(1, 10),
    repeatWeeks: requiredInt(1, 26).default(1),
    notes: optionalText(300),
  })
  .refine((s) => toMinutes(s.endsAt) > toMinutes(s.startsAt), {
    message: 'forms.errors.timesReversed',
    path: ['endsAt'],
  });
export type SlotInput = z.infer<typeof SlotInput>;

/** Is the instructor teaching (a group session or another slot) at this time on this date? */
async function busyAt(tx: Tx, staffId: string, date: string, startsAt: string, endsAt: string) {
  const range = sql`tstzrange(${localInstant(date, startsAt)}, ${localInstant(date, endsAt)})`;
  const [s] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .innerJoin(sessionStaff, eq(sessionStaff.sessionId, sessions.id))
    .where(
      and(
        eq(sessionStaff.staffMemberId, staffId),
        eq(sessions.date, date),
        ne(sessions.status, 'cancelled_by_school'),
        sql`tstzrange(${sessions.startsAt}, ${sessions.endsAt}) && ${range}`,
      ),
    );
  const [p] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(privateSlots)
    .where(
      and(
        eq(privateSlots.staffMemberId, staffId),
        eq(privateSlots.date, date),
        ne(privateSlots.status, 'cancelled'),
        sql`tstzrange(${privateSlots.startsAt}, ${privateSlots.endsAt}) && ${range}`,
      ),
    );
  return (s?.n ?? 0) + (p?.n ?? 0) > 0;
}

/**
 * Opens a slot, or the same slot weekly for N weeks. Each date must fit the instructor's availability and not clash
 * with a group session or another slot of theirs.
 */
export async function openSlots(tx: Tx, ctx: ServiceContext, input: SlotInput): Promise<string[]> {
  const instructor = await instructorFacts(tx, input.staffMemberId);
  const seriesId = input.repeatWeeks > 1 ? randomUUID() : null;
  const ids: string[] = [];
  for (let i = 0; i < input.repeatWeeks; i++) {
    const date = addDays(input.date, i * 7);
    const rules = await rulesFor(tx, {
      date,
      venueId: input.venueId,
      programId: input.programId ?? '',
    });
    refuse(
      checkInstructor(
        {
          venueId: input.venueId,
          poolId: input.poolId ?? '',
          weekday: dayInfo(date).weekday,
          startsAt: input.startsAt,
          durationMin: toMinutes(input.endsAt) - toMinutes(input.startsAt),
          laneIds: [],
          admittedGender: 'mixed',
          ageMinMonths: null,
          effectiveFrom: date,
          effectiveTo: null,
          requiredInstructorGender: null,
          requiredSkills: input.kind === 'therapy' ? ['therapy'] : [],
          leadStaffId: input.staffMemberId,
        },
        instructor,
        [],
        rules.scheduling,
        null,
        date,
      ).violations,
    );
    if (await busyAt(tx, input.staffMemberId, date, input.startsAt, input.endsAt)) {
      throw new DomainError('scheduling.rules.instructorBusyOn', { name: instructor.name, date });
    }
    const [row] = await tx
      .insert(privateSlots)
      .values({
        organizationId: ctx.orgId,
        staffMemberId: input.staffMemberId,
        venueId: input.venueId,
        poolId: input.poolId,
        programId: input.programId,
        kind: input.kind,
        date,
        startsAt: localInstant(date, input.startsAt),
        endsAt: localInstant(date, input.endsAt),
        capacity: input.capacity ?? SLOT_DEFAULT_CAPACITY[input.kind],
        seriesId,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: privateSlots.id });
    ids.push((row as { id: string }).id);
  }
  return ids;
}

export async function listSlots(
  tx: Tx,
  filter: { from: string; to: string; staffMemberId?: string | null },
) {
  const slots = await tx
    .select()
    .from(privateSlots)
    .where(
      and(
        gte(privateSlots.date, filter.from),
        lte(privateSlots.date, filter.to),
        ne(privateSlots.status, 'cancelled'),
        filter.staffMemberId ? eq(privateSlots.staffMemberId, filter.staffMemberId) : undefined,
      ),
    )
    .orderBy(asc(privateSlots.startsAt));
  const bookings = slots.length
    ? await tx
        .select()
        .from(slotBookings)
        .where(
          and(
            inArray(
              slotBookings.slotId,
              slots.map((s) => s.id),
            ),
            eq(slotBookings.status, 'booked'),
          ),
        )
    : [];
  const kids = byIds(
    await studentsByIds(
      tx,
      bookings.map((b) => b.studentId),
    ),
  );
  return slots.map((s) => ({
    ...s,
    bookings: bookings
      .filter((b) => b.slotId === s.id)
      .map((b) => ({ ...b, student: kids.get(b.studentId) ?? null })),
  }));
}

/** Books a child into an open slot with a free seat. A slot that fills up is marked full. */
export async function bookSlot(tx: Tx, ctx: ServiceContext, slotId: string, studentId: string) {
  const [slot] = await tx
    .select()
    .from(privateSlots)
    .where(eq(privateSlots.id, slotId))
    .for('update');
  if (!slot) throw new DomainError('common.errors.notFound');
  if (slot.status !== 'open') throw new DomainError('scheduling.errors.slotNotOpen');
  if (slot.date < (await todayIL(tx))) throw new DomainError('scheduling.errors.slotPast');
  const booked = await tx
    .select({ studentId: slotBookings.studentId })
    .from(slotBookings)
    .where(and(eq(slotBookings.slotId, slotId), eq(slotBookings.status, 'booked')));
  if (booked.some((b) => b.studentId === studentId))
    throw new DomainError('scheduling.errors.alreadyBooked');
  if (booked.length >= slot.capacity)
    throw new DomainError('scheduling.rules.full', { capacity: slot.capacity });
  const [row] = await tx
    .insert(slotBookings)
    .values({ organizationId: ctx.orgId, slotId, studentId, bookedBy: ctx.userId })
    .returning({ id: slotBookings.id });
  if (booked.length + 1 >= slot.capacity) {
    await tx.update(privateSlots).set({ status: 'full' }).where(eq(privateSlots.id, slotId));
  }
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.slot_booked',
    payload: { bookingId: id, slotId, studentId, kind: slot.kind, date: slot.date },
    idempotencyKey: `scheduling.slot_booked:${id}`,
  });
  return id;
}

export async function cancelBooking(tx: Tx, ctx: ServiceContext, bookingId: string) {
  const [b] = await tx
    .update(slotBookings)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(eq(slotBookings.id, bookingId), eq(slotBookings.status, 'booked')))
    .returning({ slotId: slotBookings.slotId });
  if (!b) throw new DomainError('common.errors.notFound');
  await tx
    .update(privateSlots)
    .set({ status: 'open' })
    .where(and(eq(privateSlots.id, b.slotId), eq(privateSlots.status, 'full')));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.slot_booking_cancelled',
    payload: { bookingId, slotId: b.slotId },
    idempotencyKey: `scheduling.slot_booking_cancelled:${bookingId}`,
  });
}

/** Cancels a slot and every booking in it. */
export async function cancelSlot(tx: Tx, ctx: ServiceContext, slotId: string) {
  await tx.update(privateSlots).set({ status: 'cancelled' }).where(eq(privateSlots.id, slotId));
  const cancelled = await tx
    .update(slotBookings)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(eq(slotBookings.slotId, slotId), eq(slotBookings.status, 'booked')))
    .returning({ id: slotBookings.id, studentId: slotBookings.studentId });
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.slot_cancelled',
    payload: { slotId, studentIds: cancelled.map((c) => c.studentId) },
    idempotencyKey: `scheduling.slot_cancelled:${slotId}`,
  });
}
