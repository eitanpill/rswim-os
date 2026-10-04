/**
 * What payroll needs from scheduling (brief §6.8): the lessons each instructor actually taught in a date range. A group
 * lesson counts when it was held (not cancelled) on or before today, for every instructor on it (lead, substitute or
 * assistant); a private or therapy slot counts when it was not cancelled and someone was booked into it. Payroll calls
 * this instead of reading the scheduling tables.
 */
import { sql, type Tx } from '@rswim/db';

export type TaughtLesson = {
  staffId: string;
  workKind: 'group' | 'slot';
  sessionId: string | null;
  slotId: string | null;
  date: string;
  time: string;
  venueId: string;
  programId: string | null;
  minutes: number;
  /** Children holding a seat (groups) or booked (slots). */
  heads: number;
  /** The group's name, or the slot's kind. */
  name: string;
};

export async function lessonsTaught(
  tx: Tx,
  q: { from: string; to: string; staffId?: string | null },
): Promise<TaughtLesson[]> {
  const staff = q.staffId ? sql`and x."staffId" = ${q.staffId}::uuid` : sql``;
  const r = await tx.execute<TaughtLesson>(sql`
    select * from (
      select ss.staff_member_id as "staffId", 'group' as "workKind", s.id as "sessionId", null::uuid as "slotId",
             s.date::text as date, to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time,
             s.venue_id as "venueId", ct.program_id as "programId",
             (extract(epoch from s.ends_at - s.starts_at) / 60)::int as minutes,
             (select count(*)::int from enrollments e
               where e.class_template_id = s.class_template_id
                 and e.status in ('active', 'frozen', 'cancel_requested', 'trial_booked')
                 and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)) as heads,
             ct.name as name
      from sessions s
      join session_staff ss on ss.session_id = s.id
      join class_templates ct on ct.id = s.class_template_id
      where s.status = 'scheduled' and s.date between ${q.from}::date and least(${q.to}::date, app.today())
      union all
      select p.staff_member_id, 'slot', null, p.id, p.date::text,
             to_char(p.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
             p.venue_id, p.program_id, (extract(epoch from p.ends_at - p.starts_at) / 60)::int,
             (select count(*)::int from slot_bookings b where b.slot_id = p.id and b.status = 'booked'),
             p.kind
      from private_slots p
      where p.status <> 'cancelled' and p.date between ${q.from}::date and least(${q.to}::date, app.today())
        and exists (select 1 from slot_bookings b where b.slot_id = p.id and b.status = 'booked')
    ) x
    where true ${staff}
    order by x.date, x.time, x.name`);
  return r.rows;
}
