/**
 * Sessions and seats as other modules need them (attendance, enrollment): the facts of a session and its group, who
 * holds a seat on a date, and cancelling sessions for a closure. Other modules call these instead of reading the
 * scheduling tables.
 */
import { SEAT_HOLDING_STATUSES, type SessionStatus } from '@rswim/contracts';
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, schema, sql, type Tx } from '@rswim/db';
import { emit, type ServiceContext } from '@rswim/domain-core';

const { classTemplates, enrollments, sessions, sessionStaff } = schema;

const factsColumns = {
  id: sessions.id,
  date: sessions.date,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  status: sessions.status,
  cancelReason: sessions.cancelReason,
  closureEventId: sessions.closureEventId,
  venueId: sessions.venueId,
  classTemplateId: classTemplates.id,
  groupName: classTemplates.name,
  programId: classTemplates.programId,
  poolId: classTemplates.poolId,
  capacity: classTemplates.capacity,
  levelMinId: classTemplates.levelMinId,
  levelMaxId: classTemplates.levelMaxId,
  leadStaffId: sql<
    string | null
  >`coalesce(${sessionStaff.staffMemberId}, ${classTemplates.leadStaffId})`,
};

export type SessionFacts = Awaited<ReturnType<typeof sessionFacts>>[number];

/** Sessions by id with their group's facts and lead instructor (the session's own lead, else the group's). */
export async function sessionFacts(tx: Tx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select(factsColumns)
    .from(sessions)
    .innerJoin(classTemplates, eq(classTemplates.id, sessions.classTemplateId))
    .leftJoin(
      sessionStaff,
      and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
    )
    .where(inArray(sessions.id, [...ids]))
    .orderBy(asc(sessions.startsAt));
}

/** Scheduled sessions in a date range, at one venue or every venue (closure preview). */
export async function scheduledSessionsInRange(
  tx: Tx,
  range: { venueId: string | null; from: string; to: string },
) {
  return tx
    .select(factsColumns)
    .from(sessions)
    .innerJoin(classTemplates, eq(classTemplates.id, sessions.classTemplateId))
    .leftJoin(
      sessionStaff,
      and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
    )
    .where(
      and(
        eq(sessions.status, 'scheduled'),
        gte(sessions.date, range.from),
        lte(sessions.date, range.to),
        range.venueId ? eq(sessions.venueId, range.venueId) : undefined,
      ),
    )
    .orderBy(asc(sessions.startsAt));
}

/** Upcoming sessions of a child's groups (the family's absence form), from now until a date. */
export async function upcomingSessionsOfStudent(tx: Tx, studentId: string, until: string) {
  return tx
    .select(factsColumns)
    .from(sessions)
    .innerJoin(classTemplates, eq(classTemplates.id, sessions.classTemplateId))
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.classTemplateId, sessions.classTemplateId),
        eq(enrollments.studentId, studentId),
        inArray(enrollments.status, [...SEAT_HOLDING_STATUSES]),
        lte(enrollments.startsOn, sessions.date),
        or(isNull(enrollments.endsOn), gt(enrollments.endsOn, sessions.date)),
      ),
    )
    .leftJoin(
      sessionStaff,
      and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
    )
    .where(
      and(
        eq(sessions.status, 'scheduled'),
        gt(sessions.startsAt, sql`now()`),
        lte(sessions.date, until),
      ),
    )
    .orderBy(asc(sessions.startsAt));
}

export interface SeatHolder {
  enrollmentId: string;
  studentId: string;
  classTemplateId: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
}

/** Children holding a seat in these groups on a date (trials, frozen and leaving children included, with status). */
export async function seatHoldersOn(
  tx: Tx,
  templateIds: readonly string[],
  date: string,
): Promise<SeatHolder[]> {
  if (templateIds.length === 0) return [];
  return tx
    .select({
      enrollmentId: enrollments.id,
      studentId: enrollments.studentId,
      classTemplateId: enrollments.classTemplateId,
      status: enrollments.status,
      startsOn: enrollments.startsOn,
      endsOn: enrollments.endsOn,
    })
    .from(enrollments)
    .where(
      and(
        inArray(enrollments.classTemplateId, [...templateIds]),
        inArray(enrollments.status, [...SEAT_HOLDING_STATUSES]),
        lte(enrollments.startsOn, date),
        or(isNull(enrollments.endsOn), gt(enrollments.endsOn, date)),
      ),
    );
}

/** A child's seats on or after a date (places that start later included, with their start). */
export async function seatsOfStudent(tx: Tx, studentId: string, date: string) {
  return tx
    .select({
      enrollmentId: enrollments.id,
      classTemplateId: enrollments.classTemplateId,
      status: enrollments.status,
      startsOn: enrollments.startsOn,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.studentId, studentId),
        inArray(enrollments.status, [...SEAT_HOLDING_STATUSES]),
        or(isNull(enrollments.endsOn), gt(enrollments.endsOn, date)),
      ),
    );
}

/** Ends a one-day seat (a trial) the day after its lesson. */
export async function endSeatAfter(tx: Tx, enrollmentId: string, date: string) {
  await tx
    .update(enrollments)
    .set({ endsOn: sql`${date}::date + 1` })
    .where(eq(enrollments.id, enrollmentId));
}

/** Cancels scheduled sessions for a closure. Returns the ids it cancelled; already-cancelled ones are left alone. */
export async function cancelSessions(
  tx: Tx,
  ctx: ServiceContext,
  input: {
    sessionIds: readonly string[];
    status: Extract<SessionStatus, 'cancelled_by_school' | 'cancelled_external'>;
    reason: string;
    closureEventId: string | null;
  },
): Promise<string[]> {
  if (input.sessionIds.length === 0) return [];
  const rows = await tx
    .update(sessions)
    .set({
      status: input.status,
      cancelReason: input.reason,
      closureEventId: input.closureEventId,
    })
    .where(and(inArray(sessions.id, [...input.sessionIds]), eq(sessions.status, 'scheduled')))
    .returning({ id: sessions.id });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'scheduling.sessions_cancelled',
      payload: { sessionIds: ids, status: input.status, closureEventId: input.closureEventId },
      idempotencyKey: `scheduling.sessions_cancelled:${input.closureEventId ?? ids.join(',')}`,
    });
  }
  return ids;
}

/** How many sessions a closure event cancelled (its report). */
export async function countSessionsOfClosure(tx: Tx, closureEventId: string): Promise<number> {
  const rows = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.closureEventId, closureEventId));
  return rows.length;
}
