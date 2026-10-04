/**
 * What the communications hub needs from scheduling (brief §6.12): a lesson's group, venue and local start time for
 * message text, who holds a seat in given lessons or in the lessons a closure cancelled, a child's lesson on a day
 * (an absence from WhatsApp), a private slot's time, and every running place for broadcast segments. Comms calls
 * these instead of reading the scheduling tables.
 */
import { sql, type Tx } from '@rswim/db';

const SEAT = sql.raw(`e.status in ('active', 'frozen', 'cancel_requested')
  and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)`);

export type LessonText = {
  sessionId: string;
  studentId: string | null;
  date: string;
  time: string;
  groupName: string;
  venueName: string;
};

/** Lessons by id with the words a message needs. */
export async function lessonTexts(tx: Tx, sessionIds: readonly string[]): Promise<LessonText[]> {
  if (sessionIds.length === 0) return [];
  const r = await tx.execute<LessonText>(sql`
    select s.id as "sessionId", null as "studentId", s.date::text as date,
           to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time,
           ct.name as "groupName", v.name as "venueName"
    from sessions s join class_templates ct on ct.id = s.class_template_id join venues v on v.id = s.venue_id
    where s.id in (${sql.join(
      sessionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by s.starts_at`);
  return r.rows;
}

/** Children holding a seat in these lessons on their dates. */
export async function studentsInLessons(tx: Tx, sessionIds: readonly string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const r = await tx.execute<{ id: string }>(sql`
    select distinct e.student_id as id from sessions s
    join enrollments e on e.class_template_id = s.class_template_id and ${SEAT}
    where s.id in (${sql.join(
      sessionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return r.rows.map((x) => x.id);
}

/** Children whose lessons a closure cancelled, with the venue of those lessons. */
export async function studentsOfClosure(
  tx: Tx,
  closureEventId: string,
): Promise<{ studentId: string; venueName: string }[]> {
  const r = await tx.execute<{ studentId: string; venueName: string }>(sql`
    select distinct on (e.student_id) e.student_id as "studentId", v.name as "venueName" from sessions s
    join enrollments e on e.class_template_id = s.class_template_id and ${SEAT}
    join venues v on v.id = s.venue_id
    where s.closure_event_id = ${closureEventId}
    order by e.student_id, s.starts_at`);
  return r.rows;
}

/**
 * Each child's scheduled group lesson on `date`, or, without a date, their next one from `from` on. One lesson per
 * child (the earliest that day).
 */
export async function lessonsOfStudents(
  tx: Tx,
  studentIds: readonly string[],
  q: { date: string | null; from: string },
): Promise<(LessonText & { studentId: string })[]> {
  if (studentIds.length === 0) return [];
  const day = q.date
    ? sql`s.date = ${q.date}::date`
    : sql`s.date >= ${q.from}::date and s.starts_at > now()`;
  const r = await tx.execute<LessonText & { studentId: string }>(sql`
    select distinct on (e.student_id) s.id as "sessionId", e.student_id as "studentId", s.date::text as date,
           to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time,
           ct.name as "groupName", v.name as "venueName"
    from sessions s
    join enrollments e on e.class_template_id = s.class_template_id and ${SEAT}
    join class_templates ct on ct.id = s.class_template_id join venues v on v.id = s.venue_id
    where s.status = 'scheduled' and ${day}
      and e.student_id in (${sql.join(
        studentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    order by e.student_id, s.starts_at`);
  return r.rows;
}

/** A private or small-group slot's date, time and venue. */
export async function slotText(tx: Tx, slotId: string): Promise<LessonText | null> {
  const r = await tx.execute<LessonText>(sql`
    select p.id as "sessionId", null as "studentId", p.date::text as date,
           to_char(p.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time,
           '' as "groupName", v.name as "venueName"
    from private_slots p join venues v on v.id = p.venue_id where p.id = ${slotId}`);
  return r.rows[0] ?? null;
}

export type RunningPlace = {
  studentId: string;
  venueId: string;
  classTemplateId: string;
  programId: string;
};

/** Every group place running on a date (broadcast segments, the holiday notice). */
export async function runningPlaces(tx: Tx, date: string): Promise<RunningPlace[]> {
  const r = await tx.execute<RunningPlace>(sql`
    select e.student_id as "studentId", ct.venue_id as "venueId", ct.id as "classTemplateId",
           ct.program_id as "programId"
    from enrollments e join class_templates ct on ct.id = e.class_template_id
    where e.status in ('active', 'frozen', 'cancel_requested')
      and (e.ends_on is null or e.ends_on > ${date}::date)`);
  return r.rows;
}
