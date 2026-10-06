/**
 * What institutions need from scheduling (brief §6.11): the children placed in a contract's groups during a month,
 * and those groups' lessons in it. Institutions call these instead of reading the scheduling tables.
 */
import { and, asc, gte, inArray, isNull, lt, lte, or, schema, sql, type Tx } from '@rswim/db';

const { enrollments, sessions } = schema;

/** Places in these groups that overlap [from, before), cancelled ones excluded. */
export async function placesInGroups(
  tx: Tx,
  templateIds: readonly string[],
  from: string,
  before: string,
) {
  if (templateIds.length === 0) return [];
  return tx
    .select({
      enrollmentId: enrollments.id,
      studentId: enrollments.studentId,
      classTemplateId: enrollments.classTemplateId,
      startsOn: enrollments.startsOn,
      endsOn: enrollments.endsOn,
      status: enrollments.status,
    })
    .from(enrollments)
    .where(
      and(
        inArray(enrollments.classTemplateId, [...templateIds]),
        inArray(enrollments.status, ['active', 'frozen', 'cancel_requested', 'completed']),
        lt(enrollments.startsOn, before),
        or(isNull(enrollments.endsOn), sql`${enrollments.endsOn} > ${from}::date`),
      ),
    )
    .orderBy(asc(enrollments.startsOn));
}

/** These groups' lessons dated in [from, to], with their status (cancelled ones too, for the report). */
export async function lessonsOfGroups(
  tx: Tx,
  templateIds: readonly string[],
  from: string,
  to: string,
) {
  if (templateIds.length === 0) return [];
  return tx
    .select({
      id: sessions.id,
      classTemplateId: sessions.classTemplateId,
      date: sessions.date,
      status: sessions.status,
    })
    .from(sessions)
    .where(
      and(
        inArray(sessions.classTemplateId, [...templateIds]),
        gte(sessions.date, from),
        lte(sessions.date, to),
      ),
    )
    .orderBy(asc(sessions.date));
}
