/**
 * What billing needs from scheduling (brief §6.7): the monthly places that overlap a month with their group, program
 * and venue, the group's lesson dates, the per-lesson bookings of a month, and moving a seat's end for a
 * cancellation. Billing calls these instead of reading the scheduling tables.
 */
import { PER_LESSON_PROGRAMS } from '@rswim/contracts';
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, schema, sql, type Tx } from '@rswim/db';

const { classTemplates, enrollments, privateSlots, programs, sessions, slotBookings } = schema;

/** Statuses a place can be billed in: holding it, or ended inside the month (dates decide). */
const BILLABLE_STATUSES = ['active', 'frozen', 'cancel_requested', 'completed', 'cancelled'];

const placeColumns = {
  enrollmentId: enrollments.id,
  studentId: enrollments.studentId,
  status: enrollments.status,
  startsOn: enrollments.startsOn,
  endsOn: enrollments.endsOn,
  classTemplateId: classTemplates.id,
  groupName: classTemplates.name,
  venueId: classTemplates.venueId,
  durationMin: classTemplates.durationMin,
  programId: programs.id,
  programKind: programs.kind,
  programName: programs.nameHe,
};

export type BillablePlace = Awaited<ReturnType<typeof placesOverlapping>>[number];

/** Group places (not per-lesson programs) that overlap [from, before): started before it ends, not ended before it. */
export async function placesOverlapping(tx: Tx, from: string, before: string) {
  return tx
    .select(placeColumns)
    .from(enrollments)
    .innerJoin(classTemplates, eq(classTemplates.id, enrollments.classTemplateId))
    .innerJoin(programs, eq(programs.id, classTemplates.programId))
    .where(
      and(
        inArray(enrollments.status, BILLABLE_STATUSES),
        lt(enrollments.startsOn, before),
        or(isNull(enrollments.endsOn), sql`${enrollments.endsOn} > ${from}::date`),
        sql`${programs.kind} not in (${sql.join(
          PER_LESSON_PROGRAMS.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(asc(enrollments.startsOn));
}

/** The children's group places still running on a date (the family card's freezes and cancellations). */
export async function currentPlacesOfStudents(tx: Tx, studentIds: readonly string[], date: string) {
  if (studentIds.length === 0) return [];
  return tx
    .select(placeColumns)
    .from(enrollments)
    .innerJoin(classTemplates, eq(classTemplates.id, enrollments.classTemplateId))
    .innerJoin(programs, eq(programs.id, classTemplates.programId))
    .where(
      and(
        inArray(enrollments.studentId, [...studentIds]),
        inArray(enrollments.status, ['active', 'frozen', 'cancel_requested']),
        or(isNull(enrollments.endsOn), sql`${enrollments.endsOn} > ${date}::date`),
      ),
    )
    .orderBy(asc(enrollments.startsOn));
}

/** Places by id with their group, program and venue (freezes and cancellations decide by them). */
export async function placesByIds(tx: Tx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select(placeColumns)
    .from(enrollments)
    .innerJoin(classTemplates, eq(classTemplates.id, enrollments.classTemplateId))
    .innerJoin(programs, eq(programs.id, classTemplates.programId))
    .where(inArray(enrollments.id, [...ids]));
}

/** Each group's lesson dates in a range, whatever became of the lesson (a closure is made up, not refunded). */
export async function lessonDatesOfGroups(
  tx: Tx,
  templateIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (templateIds.length === 0) return out;
  const rows = await tx
    .select({ templateId: sessions.classTemplateId, date: sessions.date })
    .from(sessions)
    .where(
      and(
        inArray(sessions.classTemplateId, [...templateIds]),
        gte(sessions.date, from),
        lte(sessions.date, to),
      ),
    )
    .orderBy(asc(sessions.date));
  for (const r of rows) out.set(r.templateId, [...(out.get(r.templateId) ?? []), r.date]);
  return out;
}

/** Bookings of private, pair, trio and therapy lessons dated in a range, with what prices them. */
export async function lessonBookingsBetween(tx: Tx, from: string, to: string) {
  return tx
    .select({
      bookingId: slotBookings.id,
      studentId: slotBookings.studentId,
      status: slotBookings.status,
      cancelledAt: slotBookings.cancelledAt,
      slotId: privateSlots.id,
      kind: privateSlots.kind,
      date: privateSlots.date,
      startsAt: privateSlots.startsAt,
      endsAt: privateSlots.endsAt,
      venueId: privateSlots.venueId,
      programId: privateSlots.programId,
      programName: programs.nameHe,
    })
    .from(slotBookings)
    .innerJoin(privateSlots, eq(privateSlots.id, slotBookings.slotId))
    .leftJoin(programs, eq(programs.id, privateSlots.programId))
    .where(
      and(
        inArray(privateSlots.kind, ['private', 'pair', 'trio', 'therapy']),
        gte(privateSlots.date, from),
        lte(privateSlots.date, to),
      ),
    )
    .orderBy(asc(privateSlots.startsAt));
}

/** A cancellation request: the place ends on a date (unless it already ends earlier) and is marked as leaving. */
export async function endPlaceForCancellation(tx: Tx, enrollmentId: string, endsOn: string) {
  await tx
    .update(enrollments)
    .set({
      status: 'cancel_requested',
      endsOn: sql`case when ${enrollments.endsOn} is null or ${enrollments.endsOn} > ${endsOn}::date
                  then ${endsOn}::date else ${enrollments.endsOn} end`,
    })
    .where(
      and(eq(enrollments.id, enrollmentId), inArray(enrollments.status, ['active', 'frozen'])),
    );
}

/** A withdrawn cancellation: the place goes on as before. */
export async function restorePlace(tx: Tx, enrollmentId: string, endsOn: string) {
  await tx
    .update(enrollments)
    .set({
      status: 'active',
      endsOn: sql`case when ${enrollments.endsOn} = ${endsOn}::date then null else ${enrollments.endsOn} end`,
    })
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.status, 'cancel_requested')));
}
