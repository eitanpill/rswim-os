/**
 * What after-school transport needs from scheduling (brief §6.10): the group a route brings children to (its name,
 * venue and usual start), and that group's lesson on a given day. Transport calls these instead of reading the
 * scheduling tables.
 */
import { sql, type Tx } from '@rswim/db';

export type GroupText = {
  id: string;
  name: string;
  venueId: string;
  venueName: string;
  programId: string;
  weekday: number;
  time: string;
  durationMin: number;
};

/** Groups by id, with their venue and usual start time. */
export async function groupTexts(tx: Tx, templateIds: readonly string[]): Promise<GroupText[]> {
  if (templateIds.length === 0) return [];
  const r = await tx.execute<GroupText>(sql`
    select ct.id, ct.name, ct.venue_id as "venueId", v.name as "venueName", ct.program_id as "programId",
           ct.weekday, to_char(ct.starts_at, 'HH24:MI') as time, ct.duration_min as "durationMin"
    from class_templates ct join venues v on v.id = ct.venue_id
    where ct.id in (${sql.join(
      templateIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by ct.name`);
  return r.rows;
}

export type GroupLesson = {
  templateId: string;
  sessionId: string;
  startsAt: Date;
  minutes: number;
  status: string;
};

/** Each group's lesson on a date, cancelled ones included (the run then stays home). */
export async function groupLessonsOn(
  tx: Tx,
  templateIds: readonly string[],
  date: string,
): Promise<GroupLesson[]> {
  if (templateIds.length === 0) return [];
  const r = await tx.execute<{
    templateId: string;
    sessionId: string;
    startsAt: string;
    minutes: number;
    status: string;
  }>(sql`
    select s.class_template_id as "templateId", s.id as "sessionId", s.starts_at as "startsAt",
           (extract(epoch from s.ends_at - s.starts_at) / 60)::int as minutes, s.status
    from sessions s
    where s.date = ${date}::date and s.class_template_id in (${sql.join(
      templateIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by s.starts_at`);
  return r.rows.map((x) => ({ ...x, startsAt: new Date(x.startsAt) }));
}

/** Lessons by id with their start and length (for in-water time against the lesson). */
export async function lessonTimes(
  tx: Tx,
  sessionIds: readonly string[],
): Promise<Map<string, { startsAt: Date; minutes: number }>> {
  if (sessionIds.length === 0) return new Map();
  const r = await tx.execute<{ id: string; startsAt: string; minutes: number }>(sql`
    select s.id, s.starts_at as "startsAt", (extract(epoch from s.ends_at - s.starts_at) / 60)::int as minutes
    from sessions s where s.id in (${sql.join(
      sessionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return new Map(r.rows.map((x) => [x.id, { startsAt: new Date(x.startsAt), minutes: x.minutes }]));
}
