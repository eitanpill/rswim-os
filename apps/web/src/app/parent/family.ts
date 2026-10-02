import 'server-only';
import { addDays } from '@rswim/calendar';
import type { Tx } from '@rswim/db';
import { bookingsOfCredits, listCredits, listNotices } from '@rswim/domain-attendance';
import { formsDueFor } from '@rswim/domain-enrollment';
import { getHousehold, searchHouseholds } from '@rswim/domain-people';
import { upcomingSessionsOfStudent } from '@rswim/domain-scheduling';
import { todayIL } from '@/lib/options';

/** The signed-in parent's household (RLS shows them only their own). */
export async function myHousehold(tx: Tx) {
  const [h] = await searchHouseholds(tx, '', 1);
  return h ? getHousehold(tx, h.id) : null;
}

/**
 * What the family portal shows: each child's lessons in the next two weeks with any notice already sent, live makeup
 * credits with their bookings, and the forms still owed.
 */
export async function familyOverview(tx: Tx) {
  const family = await myHousehold(tx);
  if (!family) return null;
  const ids = family.students.map((s) => s.id);
  const until = addDays(todayIL(), 14);
  const [lessons, notices, credits, forms] = await Promise.all([
    Promise.all(
      family.students.map(async (s) => ({
        student: s,
        sessions: await upcomingSessionsOfStudent(tx, s.id, until),
      })),
    ),
    ids.length ? listNotices(tx, { studentIds: ids, limit: 100 }) : Promise.resolve([]),
    ids.length
      ? listCredits(tx, { studentIds: ids, statuses: ['open', 'booked'] })
      : Promise.resolve([]),
    formsDueFor(tx, family.household.id),
  ]);
  const bookings = await bookingsOfCredits(
    tx,
    credits.map((c) => c.id),
  );
  return { family, lessons, notices, credits, bookings, forms };
}
