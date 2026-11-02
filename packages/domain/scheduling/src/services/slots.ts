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
    /** A ticked checkbox posts "on"; unticked posts nothing. */
    parentBookable: z
      .union([z.boolean(), z.literal('on')])
      .optional()
      .transform((v) => v === true || v === 'on'),
    notes: optionalText(300),
  })
  .refine((s) => toMinutes(s.endsAt) > toMinutes(s.startsAt), {
    message: 'forms.errors.timesReversed',
    path: ['endsAt'],
  });
export type SlotInput = Omit<z.infer<typeof SlotInput>, 'parentBookable'> & {
  parentBookable?: boolean;
};

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
        parentBookable: input.parentBookable ?? false,
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

// ─── The parent portal: families book slots the office opened to them ───────
// Parents cannot read the slot tables (other families' bookings), so these go through definer functions (0038).

export interface PortalSlot {
  id: string;
  kind: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  programName: string | null;
  instructorFirstName: string;
  capacity: number;
  seatsLeft: number;
}

export interface PortalSlotBooking {
  id: string;
  slotId: string;
  studentId: string;
  kind: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  instructorFirstName: string;
  bookedByFamily: boolean;
  canCancel: boolean;
}

const asDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const asDay = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Open slots the signed-in parent may book over the next four weeks (empty for anyone else). */
export async function portalOpenSlots(tx: Tx): Promise<PortalSlot[]> {
  const r = await tx.execute<Record<string, unknown>>(
    sql`select * from public.portal_open_slots()`,
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    kind: String(x.kind),
    date: asDay(x.date),
    startsAt: asDate(x.starts_at),
    endsAt: asDate(x.ends_at),
    venueName: String(x.venue_name),
    programName: x.program_name == null ? null : String(x.program_name),
    instructorFirstName: String(x.instructor_first_name),
    capacity: Number(x.capacity),
    seatsLeft: Number(x.seats_left),
  }));
}

/** The family's upcoming slot bookings, and which of them they may still cancel themselves. */
export async function portalMySlotBookings(tx: Tx): Promise<PortalSlotBooking[]> {
  const r = await tx.execute<Record<string, unknown>>(
    sql`select * from public.portal_my_slot_bookings()`,
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    slotId: String(x.slot_id),
    studentId: String(x.student_id),
    kind: String(x.kind),
    date: asDay(x.date),
    startsAt: asDate(x.starts_at),
    endsAt: asDate(x.ends_at),
    venueName: String(x.venue_name),
    instructorFirstName: String(x.instructor_first_name),
    bookedByFamily: x.booked_by_family === true,
    canCancel: x.can_cancel === true,
  }));
}

export const PortalBookSlotInput = z.object({ slotId: z.uuid(), studentId: z.uuid() });

/** The parent books their child into an open slot; the database checks seat, time and that it is their child. */
export async function portalBookSlot(
  tx: Tx,
  input: z.infer<typeof PortalBookSlotInput>,
): Promise<string> {
  const r = await tx.execute<{ id: string }>(
    sql`select public.portal_book_slot(${input.slotId}, ${input.studentId}) as id`,
  );
  return String(r.rows[0]?.id);
}

/** The parent cancels a booking they made, up to a day before the lesson. */
export async function portalCancelSlotBooking(tx: Tx, bookingId: string) {
  await tx.execute(sql`select public.portal_cancel_slot_booking(${bookingId})`);
}
